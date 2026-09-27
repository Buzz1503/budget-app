import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'fs'

// Read the matrix straight off disk rather than importing it in the page: the
// production build has no /src paths, and this has to run against both.
const MATRIX = JSON.parse(readFileSync(new URL('../src/data/peptide_mix_matrix.json', import.meta.url)))
const VERDICT = new Map(MATRIX.pairs.map((p) => [[p.peptide_a_id, p.peptide_b_id].sort().join('|'), p.verdict]))
const verdictOf = (a, b) => VERDICT.get([a, b].sort().join('|')) || 'NONE'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}
const waitText = async (re, timeout = 15000) => {
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
  Stock: 'text=Vials I own, run-out dates',
  Protocol: 'text=Everything I’m on, at a glance',
  'Right Now': 'text=What my protocol is doing for me today',
  History: 'text=Every dose, rates',
  Settings: 'text=Lead time, currency, backup and reset',
    Wizard: 'text=Add, remove or edit anything I take',
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
  // v21 split this screen into a stock room and the restock list, opening on
  // the stock room. These suites are about the restock plan, so switch to it.
  if (label === 'Stock') {
    const tab = page.locator('[data-testid="stock-view"] button[aria-label="Restock list"]')
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(450) }
  }
  // Home defaults to the current wall-clock slot; these suites want the morning
  if (label === 'Home') { await page.click('button:has-text("AM")'); await page.waitForTimeout(400) }
}
const modal = () => page.locator('div.fixed.inset-0.z-50 > div.card')
// v15 unboxed the combine plan and tucked its reasoning behind an info tap
const plan = () => page.locator('[data-testid="shot-plan"]').first()
const planNote = async () => {
  const info = page.locator('button[aria-label="Why these are combined"]').first()
  if (await info.count()) { await info.click(); await page.waitForTimeout(400) }
  const txt = await plan().textContent()
  if (await info.count()) { await info.click(); await page.waitForTimeout(300) }
  return txt
}
// the due card for a peptide, identified by the Log button only it has
const dueCard = (name) => page.locator('main div.p-4', { hasText: name })
  .filter({ has: page.locator(`button[aria-label="Log ${name}"], [aria-label="${name} cannot be co-drawn"]`) })
  .filter({ has: page.locator(`button[aria-label="Log ${name}"]`) }).first()


// v23: route, ladder and schedule are edited in Build / rebuild — the one
// editor — so these steps drive the wizard rather than the old Library card.
const wizard = () => page.locator('div.fixed.inset-0.z-50 > div.card')
const openEditor = async (name) => {
  await nav('More')
  await page.click('text=Build / rebuild my protocol')
  await page.waitForTimeout(700)
  const row = wizard().locator('[data-testid="manage-row"]').filter({ hasText: name }).first()
  await row.locator('[data-testid="manage-edit"]').click()
  await page.waitForTimeout(600)
}
const saveEditor = async () => {
  await wizard().locator('button:has-text("Done editing")').click()
  await page.waitForTimeout(400)
  await wizard().locator('[data-testid="manage-save"]').click()
  await page.waitForTimeout(400)
  await wizard().locator('button:has-text("Save my protocol")').click()
  await page.waitForTimeout(600)
  await wizard().locator('button:text-is("Done")').click()
  await page.waitForTimeout(700)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
await page.click('text=Got it')
// the seeded morning list is what these steps assume; without this the app
// opens on whichever slot the wall clock says
await page.click('button:has-text("AM")')
await page.waitForTimeout(500)
await waitText(/shots? instead of|nothing safely combinable/, 30000)

// ---------------- CHANGE 1 · only MIX pairs are combined ----------------
await step('every proposed group contains only MIX pairs', async () => {
  // read the plan out of the DOM, then check each group against the matrix
  // v16 lists every compound in the draw as its own <li> instead of one
  // truncated "A + B + …" line, so the group is read back from the items.
  // v31 slimmed the plan to one row and stopped printing the names, so the
  // group membership is read from the row's data rather than from its text.
  // The check itself is unchanged: every pair in every group must be a MIX.
  const groups = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="codraw-row"]')
    if (!row) return []
    const parsed = JSON.parse(row.dataset.groups || '[]')
    return [...new Set(parsed.filter((g) => g.length > 1).map((g) => g.join(' + ')))]
  })
  if (!groups.length) throw new Error('no combined group proposed at all')
  const NAME_TO_ID = {
    'Retatrutide': 'retatrutide', 'Selank': 'selank', 'Semax': 'semax', 'KPV': 'kpv',
    'SS-31': 'ss31', 'DSIP': 'dsip', 'MOTS-c': 'motsc', 'BPC-157': 'bpc157',
    'GHK-Cu': 'ghkcu', 'NAD+': 'nad', 'Tesamorelin': 'tesamorelin',
  }
  for (const g of groups) {
    const ids = g.split(' + ').map((n) => NAME_TO_ID[n.trim()])
    if (ids.some((x) => !x)) throw new Error(`unrecognised name in group "${g}"`)
    const verdicts = []
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) verdicts.push(verdictOf(ids[i], ids[j]))
    }
    for (const v of verdicts) {
      if (v !== 'MIX') throw new Error(`group "${g}" contains a ${v} pair`)
    }
    console.log(`  ${g} — ${verdicts.join(', ')}`)
  }
})

await step('the plan never offers a caution combine path', async () => {
  const body = await page.textContent('body')
  if (/Caution pair/.test(body)) throw new Error('a caution combine row is still offered')
  if (/confirm the drawn solution is clear before it logs/.test(body)) {
    throw new Error('the caution-then-confirm combine path is still present')
  }
  // v31 put the reasoning behind the info tap rather than printing it, so the
  // row stays one line. It still has to be there, and still has to say this.
  const info = page.locator('button[aria-label="Why these are combined"]').first()
  if (!(await info.count())) throw new Error('no way to ask why these are combined')
  await info.click()
  await page.waitForTimeout(500)
  const note = await page.locator('[data-testid="codraw-note"]').first().textContent()
  if (!/safe to mix/.test(note)) throw new Error('the plan does not say it only combines confirmed mixes')
  await info.click()
  await page.waitForTimeout(300)
})
await page.screenshot({ path: `${SHOT}/v10-01-mix-only-plan.png` })

await step('manually selecting a CAUTION pair is refused, not gated', async () => {
  // Selank + SS-31 is CAUTION in the matrix, and both are due this morning.
  // v30 moved co-draw selection into each row's overflow menu.
  const pick = async (name) => {
    const i = await page.locator('[data-testid="log-row"]').evaluateAll(
      (els, n) => els.findIndex((e) => (e.getAttribute('aria-label') || '').includes(n)), name)
    if (i < 0) throw new Error(`${name} is not on today's list`)
    await page.locator('[data-testid="row-overflow"]').nth(i).click()
    await page.waitForTimeout(400)
    await page.locator('[data-testid="row-codraw"]').click()
    await page.waitForTimeout(350)
    const open = page.locator('[data-testid="row-overflow"][aria-expanded="true"]')
    if (await open.count()) { await open.first().click(); await page.waitForTimeout(300) }
  }
  await pick('Selank')
  await pick('SS-31')
  await page.waitForTimeout(400)
  await page.click('button:has-text("Log together")')
  await waitText(/Not one shot — inject these separately/)
  const body = await modal().textContent()
  if (!/not confirmed/.test(body)) throw new Error('the caution pair is not labelled as unconfirmed')
  if (/Confirm it's clear/.test(body)) throw new Error('still offering the visual-inspection continue path')

  await page.click('button:has-text("Got it — log separately")')
  // dismissing the panel also drops the selection, so the co-draw bar animates
  // away — wait for it to actually leave rather than racing the exit animation
  const gone = Date.now()
  while (Date.now() - gone < 8000) {
    if (!(await page.locator('[data-testid="codraw-bar"]').count())) break
    await page.waitForTimeout(150)
  }
  if (await page.locator('[data-testid="codraw-bar"]').count()) {
    throw new Error('the co-draw bar is still up after the pair was refused')
  }
})
await page.screenshot({ path: `${SHOT}/v10-02-caution-refused.png` })

// ---------------- CHANGE 2 · no contradiction ----------------
await step('no card carries a blanket "Inject separately" tag', async () => {
  for (const slot of ['AM', 'PM']) {
    await page.click(`button:has-text("${slot}")`)
    await page.waitForTimeout(600)
    const body = await page.textContent('body')
    if (/Inject separately/.test(body)) throw new Error(`a card still reads "Inject separately" in ${slot}`)
  }
})

// v30 removed the per-card "can combine with X" hint, so there is no longer a
// second place for the plan to disagree with. What is left of the claim — that
// DSIP and GHK-Cu are recognised as a safe pair and offered as one shot — is
// checked against the plan itself.
await step('DSIP and GHK-Cu are offered as one shot in the plan', async () => {
  await page.click('button:has-text("PM")')
  await waitText(/DSIP/, 15000)
  await waitText(/shots? instead of|nothing safely combinable/, 25000)
  const combined = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="codraw-row"]')
    if (!row) return null
    for (const items of JSON.parse(row.dataset.groups || '[]')) {
      if (items.includes('DSIP') && items.includes('GHK-Cu')) return items
    }
    return null
  })
  if (!combined) {
    throw new Error(`the plan does not combine them — got: ${(await plan().textContent()).slice(0, 200)}`)
  }
  console.log(`  the plan combines ${combined.join(' + ')}`)
})

await step('Semax and Selank offer an intranasal route; others do not', async () => {
  await openEditor('Semax')
  const semaxRoutes = await wizard().textContent()
  if (!/Nasal spray/.test(semaxRoutes)) throw new Error('Semax has no intranasal option')
  await wizard().locator('button[aria-label="Close"]').click()
  await page.waitForTimeout(500)

  await openEditor('KPV')
  const kpvRoutes = await wizard().textContent()
  if (/Nasal spray/.test(kpvRoutes)) throw new Error('KPV should not offer an intranasal route')
  await wizard().locator('button[aria-label="Close"]').click()
  await page.waitForTimeout(500)
})

await step('switching Semax to nasal converts the dose to sprays', async () => {
  await openEditor('Semax')
  await wizard().locator('button:has-text("Nasal spray")').click()
  await page.waitForTimeout(500)
  await saveEditor()
  const p = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center'))
    .state.peptides.find((x) => x.id === 'semax'))
  if (p.route !== 'Nasal') throw new Error(`route is ${p.route}`)
  if (p.ladder.unit !== 'spray') throw new Error(`ladder unit is ${p.ladder.unit}`)
  for (const k of ['floor', 'step', 'ceiling']) {
    if (!Number.isInteger(p.ladder[k]) || p.ladder[k] < 1) throw new Error(`${k} is ${p.ladder[k]}, want a whole spray >= 1`)
  }
  console.log(`  ladder now ${p.ladder.floor}→${p.ladder.ceiling} sprays, step ${p.ladder.step}`)
})

await step('the nasal prep recipe is shown, with the exact numbers', async () => {
  // v23 removed the Needle guide; the recipe now sits beside the route switch
  // in Build / rebuild, which is where it is actually needed.
  await openEditor('Semax')
  const body = await wizard().textContent()
  for (const want of [
    /10 mg vial/,
    /2 mL BAC water/,
    /3 mL saline/,
    /5 mL/,
    /200 mcg a spray/,
    /50 sprays/,
  ]) {
    if (!want.test(body)) throw new Error(`recipe missing ${want} — got: ${body.slice(0, 400)}`)
  }
  await wizard().locator('button[aria-label="Close"]').click()
  await page.waitForTimeout(500)
})
await page.screenshot({ path: `${SHOT}/v10-04-nasal-recipe.png` })

await step('Home shows Semax in sprays with no insulin units', async () => {
  await nav('Home')
  await waitText(/Semax/, 15000)
  const i = await page.locator('[data-testid="log-row"]').evaluateAll(
    (els) => els.findIndex((e) => /Semax/.test(e.getAttribute('aria-label') || '')))
  if (i < 0) throw new Error('Semax is not on the list')
  const card = await page.locator('[data-testid="log-row"]').nth(i).innerText()
  if (!/\d+ sprays? \(\d+ mcg\)/.test(card)) throw new Error(`no spray dose on the card: ${card.replace(/\s+/g, ' ').slice(0, 160)}`)
  // v30 slimmed the card to name, dose, timing and the action, so the "nothing
  // to draw" note went with the rest of the prose. The claim that matters is
  // the one that would be wrong rather than merely absent: a spray has no
  // syringe units.
  if (/\d+(\.\d+)? units/.test(card)) throw new Error('a nasal dose is still showing insulin units')
})

await step('it is excluded from injection co-draws and the combine plan', async () => {
  const si = await page.locator('[data-testid="log-row"]').evaluateAll(
    (els) => els.findIndex((e) => /Semax/.test(e.getAttribute('aria-label') || '')))
  if (si < 0) throw new Error('Semax is not on the list')
  await page.locator('[data-testid="row-overflow"]').nth(si).click()
  await page.waitForTimeout(450)
  if (await page.locator('[data-testid="row-codraw"]').count()) {
    throw new Error('a nasal peptide is offered for a co-draw')
  }
  await page.locator('[data-testid="row-overflow"]').nth(si).click()
  await page.waitForTimeout(350)
  await waitText(/shots? instead of|nothing safely combinable/, 25000)
  const planText = await plan().textContent()
  if (/Semax/.test(planText)) throw new Error('a nasal peptide appears in the injection plan')
})

// v30 made the row itself the log button, so the sheet this step walked — the
// spray strength, the bottle countdown, the reconstitution recipe — is no
// longer in the logging path. The recipe still lives on the compound page. What
// is asserted here is what a nasal log must never get wrong: it records sprays,
// not syringe units, and asks nothing on the way.
await step('logging a nasal dose records sprays and asks nothing', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const i = await page.locator('[data-testid="log-row"]').evaluateAll(
    (els) => els.findIndex((e) => /Semax/.test(e.getAttribute('aria-label') || '') && e.dataset.done !== 'true'))
  if (i < 0) throw new Error('Semax is not outstanding on the list')
  await page.locator('[data-testid="log-row"]').nth(i).click()
  await page.waitForTimeout(1200)
  if (await page.locator('[data-testid="sheet"]').count()) {
    throw new Error('a sheet opened between the tap and the log')
  }
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center'))
    .state.doseLogs.filter((l) => l.peptideId === 'semax').pop())
  if (!log) throw new Error('nothing logged')
  if (log.unit !== 'spray') throw new Error(`logged unit is ${log.unit}`)
  if (log.siteId != null) throw new Error(`a nasal dose recorded an injection site: ${log.siteId}`)
  if (log.insulinUnits != null) throw new Error(`a nasal dose recorded insulin units: ${log.insulinUnits}`)
  console.log(`  logged ${log.doseValue} sprays, no site, no units`)
})

await step('switching back to SubQ restores an injectable ladder', async () => {
  await openEditor('Semax')
  await wizard().locator('button:text-is("SubQ")').click()
  await page.waitForTimeout(500)
  await saveEditor()
  const p = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center'))
    .state.peptides.find((x) => x.id === 'semax'))
  if (p.route !== 'SubQ' || p.ladder.unit !== 'mcg') throw new Error(`did not switch back: ${p.route}/${p.ladder.unit}`)
  if (!(p.ladder.floor > 0)) throw new Error('ladder lost its floor on the way back')
  console.log(`  back to ${p.ladder.floor}–${p.ladder.ceiling} mcg`)
})

// ---------------- persistence ----------------
await step('everything still loads and persists', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (!s.peptides?.length) throw new Error('peptides lost')
  if (!s.doseLogs?.some((l) => l.unit === 'spray')) throw new Error('the spray log was lost')
  if (!s.peptides.find((p) => p.id === 'semax')?.intranasalCapable) throw new Error('intranasal flag lost')
  console.log(`  peptides ${s.peptides.length} · logs ${s.doseLogs.length}`)
})

await step('an existing save from before v10 gains the intranasal option', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.peptides = raw.state.peptides.map(({ intranasalCapable, ...p }) => p)
    raw.version = 1 // the shape a save written by v9 carries
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(600)
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  for (const id of ['semax', 'selank']) {
    if (!s.peptides.find((p) => p.id === id)?.intranasalCapable) throw new Error(`${id} did not gain the flag`)
  }
  if (s.peptides.some((p) => p.id === 'kpv' && p.intranasalCapable)) throw new Error('flag applied too widely')
  if (!s.doseLogs?.length) throw new Error('the migration dropped existing logs')
  console.log('  migrated: Semax + Selank can now be switched to a spray')
})

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 220)))
await browser.close()
process.exit(errors.length ? 1 : 0)
