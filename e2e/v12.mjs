import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}
const waitText = async (re, timeout = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (re.test(await page.textContent('body'))) return true
    await page.waitForTimeout(150)
  }
  throw new Error('timeout waiting for ' + re)
}
const PRIMARY_TABS = new Set(['Home', 'Calendar', 'Symptoms', 'Body', 'More'])
// v13 moved everything but the five primary tabs under the More hub, so a
// screen is reached by its More-hub description rather than a nav button.
const MORE_LINK = {
  Calculator: 'text=Reconstitution & syringe units',
  Mix: 'text=Can these two share a syringe',
  Stock: 'text=Vials, cost, expiry',
  Library: 'text=Your peptides, ladders',
  'Right Now': 'text=What your stack is doing today',
  History: 'text=Every dose, rates',
  Settings: 'text=Theme, badges',
  Needle: 'text=SubQ, IM and nasal',
  Wizard: 'text=Guided setup with suggestions',
}
const nav = async (label) => {
  if (PRIMARY_TABS.has(label)) {
    await page.click(`nav button[aria-label="${label}"]`)
  } else {
    await page.click('nav button[aria-label="More"]')
    await page.waitForTimeout(320)
    await page.click(MORE_LINK[label])
  }
  await page.waitForTimeout(380)
  // Home defaults to the current wall-clock slot; these suites want the morning
  if (label === 'Home') { await page.click('button:has-text("AM")'); await page.waitForTimeout(400) }
}
const modal = () => page.locator('div.fixed.inset-0.z-50 > div.card')
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
// v13 merged Stock and Restock into one screen
const openRestock = async () => { await nav('Stock'); await waitText(/what to order for/i) }
const openWizard = async () => { await nav('More'); await page.click('text=Build / rebuild my schedule'); await waitText(/A few minutes/) }
// the card for one restock line, found by the compound it names
const rowFor = (name) => page.locator('div.card', { hasText: name })
  .filter({ has: page.locator('button[aria-label*="as ordered"]') }).first()


// Wizard controls live inside the modal; the screen behind it has a Back bar
// and buttons with the same words, so everything is scoped.
const wiz = (sel) => modal().locator(sel)
const atPicker = async () => (await wiz('[data-testid="wizard-list"]').count()) > 0
const waitPicker = async () => {
  const start = Date.now()
  while (Date.now() - start < 25000) {
    if (await atPicker()) return true
    await page.waitForTimeout(150)
  }
  throw new Error('the compound picker never appeared')
}
const backToPicker = async () => {
  for (let i = 0; i < 8; i++) {
    if (await atPicker()) return
    await wiz('button:has-text("Back")').click()
    await page.waitForTimeout(350)
  }
  throw new Error('could not get back to the compound picker')
}
const pickOnly = async (query, exact) => {
  await backToPicker()
  await wiz('input[placeholder*="Search"]').fill(query)
  await page.waitForTimeout(500)
  const row = exact
    ? wiz('[data-testid="wizard-list"] > button').filter({ hasText: exact }).first()
    : wiz('[data-testid="wizard-list"] > button').first()
  await row.click()
  await page.waitForTimeout(300)
  return row
}
const openPage = async (namePattern) => {
  await wiz('button:has-text("Set up")').click()
  await waitText(/Dose ladder/)
  for (let i = 0; i < 8; i++) {
    if (namePattern.test(await modal().locator('h2').textContent())) return
    await wiz('button:has-text("Next ·")').click()
    await page.waitForTimeout(400)
  }
  throw new Error(`could not reach the ${namePattern} page`)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
await page.click('text=Got it')

// ================= 1 · RESTOCK =================
await step('stock and the restock list are one screen under More', async () => {
  await openRestock()
  await waitText(/Compounds · soonest to run out first/i)
  const txt = await page.textContent('body')
  // both halves live here now: holdings and the order line
  for (const w of ['on hand', 'runs out', 'cost/dose', 'Consumables']) {
    if (!txt.includes(w)) throw new Error(`the merged screen is missing "${w}"`)
  }
})

await step('vials to order come from real burn-rate over the horizon', async () => {
  // cross-check one row against the numbers the app itself holds
  const shown = await rowFor('Tesamorelin').textContent()
  const m = shown.match(/(\d+) doses in (\d+) days at ([\d.]+) (mcg|mg)/)
  if (!m) throw new Error(`row does not state its own working: ${shown.slice(0, 160)}`)
  const [, doses, days, dose, unit] = m
  const s = await state()
  const p = s.peptides.find((x) => x.id === 'tesamorelin')
  const doseMg = unit === 'mcg' ? Number(dose) / 1000 : Number(dose)
  const neededMg = Number(doses) * doseMg
  const stockMg = s.vials.filter((v) => v.peptideId === 'tesamorelin')
    .reduce((t, v) => t + v.qtyOnHand * v.vialMg, 0) + (s.openVials.tesamorelin?.remainingMg || 0)
  const expect = Math.max(0, Math.ceil((neededMg - stockMg) / p.recon.vialMg))
  const qty = Number((shown.match(/−\s*(\d+)\s*\+/) || [])[1])
  if (qty !== expect) throw new Error(`suggests ${qty} vials, arithmetic says ${expect} (${neededMg} mg needed, ${stockMg} on hand)`)
  console.log(`  Tesamorelin: ${doses} doses / ${days} days → ${neededMg} mg needed, ${stockMg} on hand → ${qty} vials`)
})

await step('run-out dates and "order now" flags are consistent', async () => {
  const body = await page.textContent('body')
  const titles = (await page.locator('[title^="runs out "]').evaluateAll((els) => els.map((e) => e.getAttribute('title')))).join(' ')
  if (!/runs out \d{4}-\d{2}-\d{2}/.test(titles)) throw new Error('no run-out dates shown')
  if (!/Order now/.test(body)) throw new Error('nothing flagged "order now" despite a 30-day lead time')
  if (!/within your 30-day lead time/.test(body)) throw new Error('the lead time is not explained')
  // an "order now" row must run out sooner than a "coming up" row
  const rows = await page.evaluate(() => [...document.querySelectorAll('div.card')]
    .filter((d) => d.querySelector('button[aria-label*="as ordered"]') && d.querySelector('[title^="runs out"], [title^="no burn rate"]'))
    .map((d) => {
      const t = d.textContent
      const title = d.querySelector('[title^="runs out "]')?.getAttribute('title') || ''
      return {
        pri: /Order now/.test(t) ? 0 : /Coming up/.test(t) ? 1 : 2,
        date: (title.match(/runs out (\d{4}-\d{2}-\d{2})/) || [])[1] || null,
      }
    }))
  const dated = rows.filter((r) => r.date)
  for (let i = 1; i < dated.length; i++) {
    if (dated[i].date < dated[i - 1].date) throw new Error('rows are not sorted soonest-first')
  }
  const now = dated.filter((r) => r.pri === 0)
  const later = dated.filter((r) => r.pri === 1)
  if (now.length && later.length && now[now.length - 1].date > later[0].date) {
    throw new Error('an "order now" row runs out later than a "coming up" one')
  }
})

await step('the horizon selector recomputes everything', async () => {
  const before = await page.textContent('body')
  const d1 = Number(before.match(/·\s*(\d+) days/)[1])
  const q1 = Number((await rowFor('Tesamorelin').textContent()).match(/−\s*(\d+)\s*\+/)[1])
  await page.click('button:has-text("8 weeks")')
  await page.waitForTimeout(700)
  const after = await page.textContent('body')
  const d2 = Number(after.match(/·\s*(\d+) days/)[1])
  if (d2 !== 56) throw new Error(`8 weeks should be 56 days, shows ${d2}`)
  const q2 = Number((await rowFor('Tesamorelin').textContent()).match(/−\s*(\d+)\s*\+/)[1])
  if (d1 > d2 && !(q1 >= q2)) throw new Error(`a shorter horizon should not need more vials (${q1} → ${q2})`)
  await page.click('button:has-text("12 weeks")')
  await page.waitForTimeout(700)
  if (!/·\s*84 days/.test(await page.textContent('body'))) throw new Error('12 weeks is not 84 days')
  console.log(`  cycles ${d1}d (${q1} vials) → 8w 56d (${q2} vials) → 12w 84d`)
})

await step('consumables reflect the schedule, co-draws and routes', async () => {
  const body = await page.textContent('body')
  if (!/co-draws counted as one/.test(body)) throw new Error('co-draws are not being collapsed')
  const m = body.match(/(\d+) syringes? for (\d+) doses/)
  if (!m) throw new Error('no syringe-vs-dose summary')
  if (Number(m[1]) >= Number(m[2])) throw new Error(`co-draws saved nothing: ${m[0]}`)
  for (const want of [/Insulin syringes \(U-100\)/, /Bacteriostatic water/, /Alcohol swabs/, /Sharps container/]) {
    if (!want.test(body)) throw new Error(`consumable missing: ${want}`)
  }
  // testosterone is IM by default, so IM needles are listed
  if (!/IM needles \(23–25 g, 1–1\.5"\)/.test(body)) throw new Error('no IM needles despite an IM compound')
  console.log(`  ${m[0]}`)
})

await step('the AUD total adds up from the lines', async () => {
  const sums = await page.evaluate(() => {
    const money = (s) => Number((s.match(/\$([\d,.]+)/) || [])[1]?.replace(/,/g, '') || 0)
    const total = money(document.body.textContent.match(/\$[\d,.]+\s*AUD/)[0])
    const split = document.body.textContent.match(/\$([\d,.]+) compounds · \$([\d,.]+) consumables/)
    return { total, compounds: Number(split[1].replace(/,/g, '')), consumables: Number(split[2].replace(/,/g, '')) }
  })
  if (Math.abs(sums.total - (sums.compounds + sums.consumables)) > 0.02) {
    throw new Error(`total ${sums.total} != ${sums.compounds} + ${sums.consumables}`)
  }
  if (!(sums.total > 0)) throw new Error('total is zero')
  console.log(`  $${sums.total} = $${sums.compounds} compounds + $${sums.consumables} consumables`)
})

await step('an edited consumable price moves the total', async () => {
  const read = async () => Number((await page.textContent('body')).match(/\$([\d,.]+)\s*AUD/)[1].replace(/,/g, ''))
  const before = await read()
  await page.click('button:has-text("each (default)")')
  await page.waitForTimeout(300)
  const input = page.locator('input[aria-label^="Unit cost"]').first()
  await input.fill('5')
  await input.blur()
  await page.waitForTimeout(600)
  const after = await read()
  if (!(after > before)) throw new Error(`price rise did not raise the total (${before} → ${after})`)
})

await step('quantities are editable and tick off as ordered', async () => {
  const row = rowFor('Tesamorelin')
  await row.locator('button[aria-label="One more"]').click()
  await page.waitForTimeout(400)
  if (!/suggested \d+/.test(await row.textContent())) throw new Error('no way back to the suggested quantity')
  await row.locator('button[aria-label*="as ordered"]').click()
  await page.waitForTimeout(400)
  const s = await state()
  if (!s.restock.checked['vial:tesamorelin']) throw new Error('the tick did not persist')
  if (!(s.restock.qty['vial:tesamorelin'] > 0)) throw new Error('the quantity override did not persist')
})
await page.screenshot({ path: `${SHOT}/v12-01-restock.png`, fullPage: true })

await step('an expected delivery silences the low-stock alert and reaches the calendar', async () => {
  // Tesamorelin is the soonest to run out, so it drives a Home alert
  const row = rowFor('Tesamorelin')
  await row.locator('button:has-text("Add expected delivery")').click()
  await page.waitForTimeout(300)
  const soon = await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 3)
    return d.toISOString().slice(0, 10)
  })
  await row.locator('input[aria-label="Expected delivery date"]').fill(soon)
  await page.waitForTimeout(500)
  const s = await state()
  if (s.restock.delivery['vial:tesamorelin'] !== soon) throw new Error('delivery date did not persist')

  await nav('Home')
  // v15 moved the standing alerts off the main column into the bell
  const bell = page.locator('[data-testid="alert-bell"]')
  await bell.waitFor({ timeout: 15000 })
  await bell.click()
  await page.waitForTimeout(500)
  await waitText(/runs out in ~\d+d/, 15000)
  const home = await page.textContent('body')
  if (!new RegExp(`delivery expected ${soon}`).test(home)) {
    const shown = await page.evaluate(() => [...document.querySelectorAll('[data-testid="alert-panel"] button')]
      .map((b) => b.textContent.trim()).filter((x) => /runs out|expire|delivery/i.test(x)))
    throw new Error(`no delivery on the Home alert (eta ${soon}) — alerts read: ${JSON.stringify(shown)}`)
  }
  if (/Tesamorelin runs out in ~\d+d — restock soon/.test(home)) throw new Error('the plain restock nag is still there')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // and it rides along in the calendar export
  await nav('Settings')
  await waitText(/Calendar export/)
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('button:has-text("Download .ics")'),
  ])
  const path = await dl.path()
  const ics = await page.evaluate(async () => null) ?? null
  const fs = await import('fs')
  const text = fs.readFileSync(path, 'utf8')
  if (!/delivery expected/i.test(text)) throw new Error('the .ics carries no delivery event')
  if (!new RegExp(`DTSTART;VALUE=DATE:${soon.replace(/-/g, '')}`).test(text)) {
    throw new Error('the delivery event is on the wrong date')
  }
  console.log(`  delivery ${soon} shows on Home and in the .ics`)
})

// ================= 2 · WIZARD =================
await step('the wizard opens from More and from Settings', async () => {
  await openWizard()
  await wiz('button[aria-label="Close"]').click()
  await page.waitForTimeout(400)
  await nav('Settings')
  await page.click('button:has-text("Build / rebuild my schedule")')
  await waitText(/A few minutes/)
  const intro = await modal().textContent()
  if (!/not medical advice/.test(intro)) throw new Error('the intro drops the framing')
  if (!/evidence tier and confidence/.test(intro)) throw new Error('the intro does not mention evidence tiers')
})

await step('a seeded compound opens with the app’s own protocol', async () => {
  await modal().locator('button:has-text("Start")').click()
  await waitPicker()
  await modal().locator('input[placeholder*="Search"]').fill('BPC-157')
  await page.waitForTimeout(500)
  await modal().locator('[data-testid="wizard-list"] > button').first().click()
  await page.waitForTimeout(300)
  await modal().locator('button:has-text("Set up")').click()
  await waitText(/Dose ladder/)
  const body = await modal().textContent()
  if (!/app protocol/.test(body)) throw new Error('not labelled as the app’s own protocol')
  const vals = await modal().locator('input[inputmode="decimal"], input[inputmode="numeric"]').evaluateAll((els) => els.map((e) => e.value))
  if (vals[0] !== '250' || vals[1] !== '500') throw new Error(`ladder should be 250→500, got ${vals.slice(0, 2)}`)
  if (!/mechanism|How it works/i.test(body)) throw new Error('no mechanism shown')
  if (!/2\.5 mg\/mL/.test(body)) throw new Error('reconstitution concentration not derived')
  if (!/first dose is 10 units/.test(body)) throw new Error('units to draw not shown')
})

await step('tier, confidence and established-vs-reported are all there', async () => {
  const body = await modal().textContent()
  if (!/T[1-5]/.test(body)) throw new Error('no evidence tier badge')
  await wiz('summary:has-text("Evidence")').first().click()
  await page.waitForTimeout(400)
  const ev = await modal().textContent()
  if (!/Established/i.test(ev) || !/Reported/i.test(ev)) throw new Error('established and reported are not both shown')
})
await page.screenshot({ path: `${SHOT}/v12-02-wizard-seed.png`, fullPage: true })

await step('a reference-only compound gets a ladder built from its stated range', async () => {
  await pickOnly('Ipamorelin', /^Ipamorelin/)
  await openPage(/Ipamorelin/)
  const body = await modal().textContent()
  if (!/from the reference range/.test(body)) throw new Error('not labelled as coming from the reference')
  if (!/Reference range: 100–300 mcg/.test(body)) throw new Error(`range not quoted: ${body.slice(0, 200)}`)
  const vals = await wiz('input[inputmode="decimal"], input[inputmode="numeric"]').evaluateAll((els) => els.map((e) => e.value))
  if (vals[0] !== '100' || vals[1] !== '300') throw new Error(`ladder should be 100→300, got ${vals.slice(0, 2)}`)
  if (!/typical default — check your actual vial/.test(body)) throw new Error('the generic vial is not labelled as a default')
})

await step('a TX compound gets no dose at all, only the reason', async () => {
  const row = await pickOnly('ACE-031')
  if (!/dosing withheld/.test(await row.textContent())) throw new Error('TX not flagged in the picker')
  await openPage(/ACE-031/)
  const body = await modal().textContent()
  if (!/Dosing is deliberately withheld/.test(body)) throw new Error('no withheld-dosing note')
  if (!/Why no dose is given/.test(body)) throw new Error('no safety reason shown')
  const vals = await wiz('input[inputmode="decimal"], input[inputmode="numeric"]').evaluateAll((els) => els.map((e) => e.value))
  if (vals[0] !== '0' || vals[1] !== '0') throw new Error(`a dose was invented for a TX compound: ${vals.slice(0, 2)}`)
})
await page.screenshot({ path: `${SHOT}/v12-03-wizard-tx.png`, fullPage: true })

await step('the route step offers intranasal only where it applies', async () => {
  await pickOnly('Semax', /^Semax/)
  await openPage(/Semax/)
  const body = await modal().textContent()
  if (!/Nasal spray/.test(body)) throw new Error('Semax does not offer the nasal route')
  await wiz('button:has-text("Nasal spray")').first().click()
  await page.waitForTimeout(500)
  const after = await modal().textContent()
  if (!/200 mcg a spray/.test(after)) throw new Error('nasal strength not pre-filled')
  if (!/\+ 3 mL saline = 5 mL, about 50 sprays/.test(after)) throw new Error('nasal recipe not pre-filled')
  if (!/Dose ladder \(sprays\)/.test(after)) throw new Error('ladder did not switch to sprays')
  // and an injectable-only compound never offers it
  await pickOnly('KPV', /^KPV/)
  await openPage(/KPV/)
  if (/Nasal spray/.test(await modal().textContent())) throw new Error('KPV should not offer a nasal route')
})

await step('start date and review build the schedule without wiping anything', async () => {
  const before = await state()
  const beforeIds = before.peptides.map((p) => p.id)
  for (let i = 0; i < 10 && !/Start date/.test(await modal().locator('h2').textContent()); i++) {
    await wiz('button:has-text("Next ·"), button:has-text("Start date")').first().click()
    await page.waitForTimeout(400)
  }
  await wiz('button:has-text("Review")').click()
  await wiz('button:has-text("Build my schedule")').waitFor({ timeout: 15000 })
  await page.waitForTimeout(400)
  const review = await modal().textContent()
  if (!/updates existing/.test(review)) throw new Error(`review does not flag existing entries — got: ${review.slice(0, 300)}`)
  await wiz('button:has-text("Build my schedule")').click()
  await waitText(/set up/, 15000)
  await wiz('button:has-text("Done")').click()
  await page.waitForTimeout(800)

  const after = await state()
  for (const id of beforeIds) {
    if (!after.peptides.some((p) => p.id === id)) throw new Error(`existing peptide ${id} was wiped`)
  }
  if (!after.peptides.some((p) => p.id === 'ipamorelin')) throw new Error('ipamorelin was not added')
  if (!after.peptides.some((p) => p.id === 'ace031')) throw new Error('ace031 was not added')
  const ipa = after.peptides.find((p) => p.id === 'ipamorelin')
  if (ipa.ladder.floor !== 100 || ipa.ladder.ceiling !== 300) throw new Error('ipamorelin ladder did not carry through')
  const ace = after.peptides.find((p) => p.id === 'ace031')
  if (ace.ladder.ceiling !== 0) throw new Error('a dose was written for the TX compound')
  const semax = after.peptides.find((p) => p.id === 'semax')
  if (semax.route !== 'Nasal' || semax.ladder.unit !== 'spray') throw new Error('the nasal route did not carry through')
  console.log(`  ${after.peptides.length} peptides after the wizard (was ${beforeIds.length})`)
})

await step('the new compounds populate Home, Library and the restock list', async () => {
  await nav('Library')
  await waitText(/Ipamorelin/)
  const lib = await page.textContent('body')
  if (!/ACE-031/.test(lib)) throw new Error('the TX compound is not in the Library')
  if (!/Set your protocol/.test(lib)) throw new Error('the blank-dose compound is not flagged for setup')
  await openRestock()
  await waitText(/Ipamorelin/, 20000)
})
await page.screenshot({ path: `${SHOT}/v12-04-after-wizard.png`, fullPage: true })

await step('the wizard is offered unprompted when the stack is empty', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.peptides = []
    raw.state.coachMarks = {}
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/A few minutes/, 15000)
  await wiz('button[aria-label="Close"]').click()
  await page.waitForTimeout(500)
  // offered once only
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(900)
  if (/A few minutes/.test(await page.textContent('body'))) throw new Error('the wizard re-opens on every load')
})

await step('"start over" clears the stack but keeps the history', async () => {
  // the previous step left the stack empty, and the start-over checkbox only
  // exists when there's something to clear — reseed, then add a log to protect
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.doseLogs = [{ id: 'keep-me', peptideId: 'bpc157', date: '2026-01-01', doseValue: 250, unit: 'mcg', loggedAt: '2026-01-01T08:00:00Z' }]
    raw.state.coachMarks = { 'wizard-offered': true }
    // v16 shows the framing as a first-launch sheet; a mid-run localStorage
    // clear brings it back and it would block every click after this
    raw.state.settings.disclaimerDismissed = true
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  const seeded = (await state()).peptides.length
  if (seeded < 2) throw new Error('nothing to start over from')
  await openWizard()
  await wiz('input[type="checkbox"]').first().check()
  await wiz('button:has-text("Start")').click()
  await waitPicker()
  // "KPV" also matches the KLOW blend that contains it — anchor on the name
  const row = await pickOnly('KPV', /^KPV/)
  if (!/^KPV/.test((await row.textContent()).trim())) throw new Error('picked the wrong compound')
  await openPage(/KPV/)
  await wiz('button:has-text("Start date")').click()
  await waitText(/sets the clock/)
  await wiz('button:has-text("Review")').click()
  await wiz('button:has-text("Build my schedule")').waitFor({ timeout: 15000 })
  await wiz('button:has-text("Build my schedule")').click()
  await wiz('button:has-text("Done")').waitFor({ timeout: 15000 })
  await wiz('button:has-text("Done")').click()
  await page.waitForTimeout(900)
  const s = await state()
  if (s.peptides.length !== 1 || s.peptides[0].id !== 'kpv') {
    throw new Error(`start over left ${s.peptides.length} peptides: ${s.peptides.map((p) => p.id)}`)
  }
  if (!s.doseLogs.some((l) => l.id === 'keep-me')) throw new Error('start over destroyed the dose history')
})

await step('everything still loads and persists', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  const s = await state()
  if (!s.peptides.length) throw new Error('peptides lost')
  if (!s.restock) throw new Error('restock state lost')
  console.log(`  peptides ${s.peptides.length} · logs ${s.doseLogs.length}`)
})

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 220)))
await browser.close()
process.exit(errors.length ? 1 : 0)
