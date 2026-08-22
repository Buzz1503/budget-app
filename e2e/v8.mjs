import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

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
const waitText = async (re, timeout = 12000) => {
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
  Settings: 'text=Theme, lead time, backup and reset',
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
const TE = 'Testosterone Enanthate'
// on Library there's one card for the compound; on Home the combine-plan card
// also names it, so the due card is identified by the Log button only it has
const libCard = () => page.locator('div.card', { hasText: TE }).first()
const teCard = () => page.locator('div.card', { hasText: TE })
  .filter({ has: page.locator(`button[aria-label="Log ${TE}"]`) }).first()
// modal content only — the page behind it still shows SubQ site labels
const modal = () => page.locator('div.fixed.inset-0.z-50')

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
await page.click('text=Got it')
// the seeded morning list is what these steps assume; without this the app
// opens on whichever slot the wall clock says
await page.click('button:has-text("AM")')
await page.waitForTimeout(500)

// ---------------- CHANGE 1 · rename ----------------
await step('app is named "Pepito +" in the title and the header', async () => {
  const title = await page.title()
  if (title !== 'Pepito +') throw new Error(`document.title is "${title}"`)
  await waitText(/Pepito \+/)
  const appleTitle = await page.getAttribute('meta[name="apple-mobile-web-app-title"]', 'content')
  if (appleTitle !== 'Pepito') throw new Error(`apple-mobile-web-app-title is "${appleTitle}"`)
})

// ---------------- CHANGE 2 · Testosterone Enanthate ----------------
// v20 moved it onto the SubQ map, into thigh fat, to keep a reaction-prone
// compound off the belly. Everything else about it is unchanged.
await step('my protocol lists it: 50 mg, 2×/week, SubQ, ongoing', async () => {
  await nav('More')
  await page.click('text=Everything I’m on, at a glance')
  await waitText(new RegExp(TE))
  const row = page.locator('[data-testid="protocol-row"]').filter({ hasText: TE }).first()
  const text = await row.textContent()
  for (const want of [/50 mg/, /2×\/week/, /SubQ/, /ongoing/]) {
    if (!want.test(text)) throw new Error(`protocol row missing ${want} — got: ${text.slice(0, 220)}`)
  }
})

await step('its detail sheet shows the concentration, and its flags are intact', async () => {
  const row = page.locator('[data-testid="protocol-row"]').filter({ hasText: TE }).first()
  await row.click()
  await page.waitForTimeout(700)
  await page.click('[data-testid="sheet-tab-mine"]')
  await page.waitForTimeout(400)
  const sheet = await page.locator('[data-testid="compound-sheet"]').textContent()
  if (!/250/.test(sheet)) throw new Error(`concentration 250 mg/mL not shown — got: ${sheet.slice(0, 300)}`)
  if (!/50 mg/.test(sheet)) throw new Error('the fixed 50 mg dose is not shown')
  await page.click('button[aria-label="Close"]')
  await page.waitForTimeout(400)
  const p = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center'))
    .state.peptides.find((x) => x.id === 'testosterone-e'))
  if (String(p.scheduleWeekdays) !== '1,4') throw new Error(`weekdays are ${p.scheduleWeekdays}, want Mon+Thu (1,4)`)
  if (p.route !== 'SubQ' || p.preparation !== 'premixed' || !p.alwaysSeparate) {
    throw new Error('route / preparation / exclusion flags wrong')
  }
  if (p.allowedZone !== 'thigh') throw new Error('it should be restricted to the thigh')
  if (p.ladder.floor !== 50 || p.ladder.ceiling !== 50) throw new Error('not a fixed dose')
  if (p.cycleOnDays || p.cycleOffDays) throw new Error('should be ongoing, not cycled')
})
await page.screenshot({ path: `${SHOT}/v8-01-library-test-e.png` })

await step('its schedule days are editable — in Build / rebuild, the one editor', async () => {
  const today = await page.evaluate(() => new Date().getDay())
  await nav('More')
  await page.click('text=Build / rebuild my protocol')
  await page.waitForTimeout(700)
  const wizard = page.locator('div.fixed.inset-0.z-50 > div.card')
  const row = wizard.locator('[data-testid="manage-row"]').filter({ hasText: TE }).first()
  await row.locator('[data-testid="manage-edit"]').click()
  await page.waitForTimeout(600)
  const dayBtn = (d) => wizard.locator('div.flex.gap-1 > button').nth(d)
  if (![1, 4].includes(today)) {
    // 2×/week caps the picker at two days, so free one before adding today
    await dayBtn(1).click()
    await page.waitForTimeout(250)
    await dayBtn(today).click()
    await page.waitForTimeout(400)
  }
  await wizard.locator('button:has-text("Done editing")').click()
  await page.waitForTimeout(400)
  await wizard.locator('[data-testid="manage-save"]').click()
  await page.waitForTimeout(400)
  await wizard.locator('button:has-text("Save my protocol")').click()
  await page.waitForTimeout(600)
  await wizard.locator('button:text-is("Done")').click()
  await page.waitForTimeout(700)
  const days = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center'))
    .state.peptides.find((x) => x.id === 'testosterone-e').scheduleWeekdays)
  if (!days.includes(today)) throw new Error(`editing weekdays did not stick (${days})`)
  console.log(`  scheduled weekdays now [${days}]`)
})

// ---------------- CHANGE 4 · units on Home ----------------
await step('Home shows every due dose as "X units" beside the mcg/mg', async () => {
  await nav('Home')
  await waitText(new RegExp(TE), 15000)
  const body = await page.textContent('body')
  if (!/\d+(\.\d+)?\s+units/.test(body)) throw new Error('no "X units" on any due card')
  const text = await teCard().textContent()
  if (!/50 mg/.test(text) || !/20 units/.test(text)) {
    throw new Error(`expected 50 mg / 20 units, got: ${text.slice(0, 160)}`)
  }
})

await step('the oil compound cannot be selected for a co-draw', async () => {
  const text = await teCard().textContent()
  if (!/Always its own shot/.test(text)) throw new Error('card does not say it is always its own shot')
  if (/Inject separately/.test(text)) throw new Error('the blanket "Inject separately" tag is back')
  if (await page.locator(`button[aria-label="Select ${TE} to co-draw"]`).count()) {
    throw new Error('oil compound is selectable for co-draw')
  }
  if (!await page.locator(`[aria-label="${TE} cannot be co-drawn"]`).count()) {
    throw new Error('no co-draw exclusion marker on the card')
  }
})

// ---------------- CHANGE 3 · combine suggestions ----------------
await step('Home groups same-slot doses into the fewest syringes', async () => {
  await waitText(/shots? instead of|nothing safely combinable/, 25000)
  const body = await page.textContent('body')
  if (!/Combine into 1 shot/.test(body)) throw new Error('no combinable group proposed for the seeded AM stack')
  if (!/units total/.test(body)) throw new Error('combined group does not show total units')
  const m = body.match(/(\d+) shots? instead of (\d+)/)
  if (!m) throw new Error('no "N shots instead of M" headline')
  if (Number(m[1]) >= Number(m[2])) throw new Error(`headline claims no saving: ${m[0]}`)
  console.log(`  ${m[0]}`)
})

await step('the plan keeps the oil compound as its own separate shot', async () => {
  const rows = await page.evaluate((name) => [...document.querySelectorAll('div')]
    .filter((d) => d.textContent.includes(name) && /Separate shot/.test(d.textContent)).length, TE)
  if (rows === 0) throw new Error('test E is not listed as its own separate shot')
  await waitText(/Oil-based and not in the peptide compatibility matrix|Always injected on its own/)
})

await step('no proposed group exceeds ~1.5 mL', async () => {
  const mls = await page.evaluate(() => [...document.body.textContent.matchAll(/([\d.]+) mL/g)].map((m) => Number(m[1])))
  for (const v of mls) if (v > 1.5 + 1e-9) throw new Error(`a group is ${v} mL, over the 1.5 mL cap`)
})
await page.screenshot({ path: `${SHOT}/v8-02-plan.png` })

await step('accepting a suggestion routes into log-together → one site', async () => {
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.doseLogs.length)
  await page.click('button:has-text("Log together")')
  await waitText(/Log together ·/)
  // a CAUTION group must clear the visual-inspection gate before a site appears
  const gate = page.locator('button:has-text("Confirm it\'s clear")')
  if (await gate.count()) await gate.first().click()
  await waitText(/pick one spot/i)
  await page.click('button:has-text("together —")')
  await page.waitForTimeout(1200)
  const after = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('peptide-command-center')).state
    const co = s.doseLogs.filter((l) => l.coDrawId)
    return {
      total: s.doseLogs.length,
      names: co.map((l) => l.peptideId),
      sites: new Set(co.map((l) => l.siteId)).size,
      stamps: new Set(co.map((l) => l.loggedAt)).size,
    }
  })
  if (after.total <= before) throw new Error('accepting the suggestion logged nothing')
  if (after.names.length < 2) throw new Error('group was not logged as a co-draw')
  if (after.names.includes('testosterone-e')) throw new Error('oil compound was swept into the co-draw')
  if (after.sites !== 1) throw new Error(`co-draw hit ${after.sites} sites — must be one`)
  if (after.stamps !== 1) throw new Error('co-draw did not share one timestamp')
  console.log(`  co-draw: ${after.names.length} peptides, 1 site, 1 timestamp`)
})

// ---------------- CHANGE 2 · IM rotation ----------------
// v20 made Test E SubQ, so no seeded compound is IM any more. The IM map is
// still a feature and still reachable — put a compound on that route the way
// the Library would, so this keeps testing the map rather than the seed.
await step('logging an IM compound opens the IM map, not the SubQ one', async () => {
  // the co-draw step before this leaves its written confirmation up
  for (const sel of ['button:text-is("Done")', 'div.fixed.inset-0.z-50 button[aria-label="Close"]']) {
    const el = page.locator(sel).first()
    if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(400) }
  }
  await page.evaluate(() => {
    const KEY = 'peptide-command-center'
    const raw = JSON.parse(localStorage.getItem(KEY))
    const te = raw.state.peptides.find((p) => p.id === 'testosterone-e')
    te.route = 'IM'
    delete te.allowedZone
    // and due today whatever day this runs on — the step is about the map, not
    // about whether Mon/Thu happens to be today
    te.frequency = 'daily'
    te.scheduleWeekdays = [0, 1, 2, 3, 4, 5, 6]
    localStorage.setItem(KEY, JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  const am = page.locator('button:has-text("AM")').first()
  if (await am.count()) { await am.click(); await page.waitForTimeout(500) }
  await page.click(`button[aria-label="Log ${TE}"]`)
  await waitText(/INJECT HERE/)
  const body = await modal().textContent()
  if (!/Intramuscular/.test(body)) throw new Error('no IM route banner')
  if (!/23–25 g/.test(body)) throw new Error('IM needle guidance missing from the picker')
  if (!/glute|deltoid|quad/i.test(body)) throw new Error('no IM site offered')
  if (/Abdomen|love handle/i.test(body)) throw new Error('SubQ sites offered for an IM injection')
  // v15 split the IM pool across a front and a back view — glutes need you to
  // turn around — so the six are counted across both faces.
  const onFace = () => modal().locator('svg [data-site]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-site')))
  const front = await onFace()
  await modal().locator('button[aria-label="back view"]').click()
  await page.waitForTimeout(500)
  const back = await onFace()
  const offered = new Set([...front, ...back])
  if (offered.size !== 6) throw new Error(`IM map should offer 6 sites, offers ${offered.size}: ${[...offered].join(', ')}`)
  if (!back.includes('im-glute-l')) throw new Error('the glutes are not on the back view')
  await modal().locator('button[aria-label="front view"]').click()
  await page.waitForTimeout(500)
  await page.click('button:has-text("Log here")')
  await page.waitForTimeout(400)
  await page.click('button:text-is("Done")') // v9: dismiss the written confirmation
  await page.waitForTimeout(400)
  await page.waitForTimeout(900)
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center'))
    .state.doseLogs.filter((l) => l.peptideId === 'testosterone-e').pop())
  if (!log) throw new Error('nothing logged')
  if (!/^im-/.test(log.siteId)) throw new Error(`logged to a non-IM site: ${log.siteId}`)
  if (Math.round(log.insulinUnits) !== 20) throw new Error(`logged ${log.insulinUnits} units, want 20`)
  console.log(`  logged 50 mg → ${log.insulinUnits} units at ${log.siteId}`)
  // put it back the way it ships
  await page.evaluate(() => {
    const KEY = 'peptide-command-center'
    const raw = JSON.parse(localStorage.getItem(KEY))
    const te = raw.state.peptides.find((p) => p.id === 'testosterone-e')
    te.route = 'SubQ'
    te.allowedZone = 'thigh'
    te.frequency = '2xweek'
    localStorage.setItem(KEY, JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
})
await page.screenshot({ path: `${SHOT}/v8-03-im-map.png` })

// ---------------- CHANGE 2 · calculator ----------------
await step('Calculator computes it in pre-mixed mg/mL mode', async () => {
  await nav('Calculator')
  await page.click(`button:has-text("${TE}")`)
  await page.waitForTimeout(400)
  const body = await page.textContent('body')
  if (!/Concentration \(mg\/mL\)/.test(body)) throw new Error('pre-mixed concentration field not shown')
  if (/BAC water \(mL\)/.test(body)) throw new Error('still showing the reconstitution flow')
  if (!/250 mg\/mL/.test(body)) throw new Error('concentration did not pre-fill to 250 mg/mL')
  if (!/no powder to dissolve/i.test(body)) throw new Error('pre-mixed mode not labelled')
  if (!/0\.2 mL/.test(body)) throw new Error('volume is not 0.2 mL')
  if (!/viscous/i.test(body)) throw new Error('no note that oil is viscous')
  // the draw figure counts up into place, so let it settle before reading it
  const drawP = page.locator('p:has-text("units")').first()
  const start = Date.now()
  let draw = ''
  while (Date.now() - start < 5000) {
    draw = (await drawP.textContent()).trim()
    if (/^20(\.0)?\s*units$/.test(draw)) break
    await page.waitForTimeout(120)
  }
  if (!/^20(\.0)?\s*units$/.test(draw)) throw new Error(`draw readout settled on "${draw}", want 20 units`)
})
await page.screenshot({ path: `${SHOT}/v8-04-calc-premixed.png` })

await step('Calculator still does reconstitution for aqueous peptides', async () => {
  await page.click('button:has-text("BPC-157")')
  await page.waitForTimeout(400)
  const body = await page.textContent('body')
  if (!/BAC water \(mL\)/.test(body)) throw new Error('did not switch back to the reconstitution flow')
  if (/Concentration \(mg\/mL\)/.test(body)) throw new Error('still in pre-mixed mode')
})

// ---------------- CHANGE 2 · mix tab ----------------
await step('Mix always reads "inject separately" for it', async () => {
  await nav('Mix')
  await waitText(/Compatibility Codex/, 25000)
  await page.click(`button:has-text("${TE}")`)
  await page.click('button:has-text("BPC-157")')
  await waitText(/Inject separately/, 10000)
  const body = await page.textContent('body')
  if (!/Always separate/.test(body)) throw new Error('no always-separate marker')
  if (/Safe to mix/.test(body)) throw new Error('offered a mix verdict for an oil compound')
  if (!/never draw it into the same barrel/i.test(body)) throw new Error('no explicit separate-syringe instruction')
})
await page.screenshot({ path: `${SHOT}/v8-05-mix-separate.png` })

await step('the verdict is the same whichever order it is picked in', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await nav('Mix')
  await waitText(/Compatibility Codex/, 25000)
  await page.click('button:has-text("KPV")')
  await page.click(`button:has-text("${TE}")`)
  await waitText(/Inject separately/, 10000)
})

// ---------------- persistence ----------------
await step('everything persists across a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  const te = s.peptides.find((p) => p.id === 'testosterone-e')
  if (!te) throw new Error('testosterone lost')
  if (te.ladder.floor !== 50 || te.ladder.ceiling !== 50) throw new Error('fixed dose lost')
  if (!s.doseLogs.some((l) => l.peptideId === 'testosterone-e')) throw new Error('IM log lost')
  if (!s.doseLogs.some((l) => l.coDrawId)) throw new Error('co-draw lost')
  console.log(`  peptides ${s.peptides.length} · logs ${s.doseLogs.length}`)
})

// ---------------- upgrade path ----------------
await step('an existing save from before v8 gains the new compound on load', async () => {
  // strip test E and the version marker: exactly what a phone that installed
  // the app before this release has sitting in localStorage
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.peptides = raw.state.peptides.filter((p) => p.id !== 'testosterone-e')
    raw.state.doseLogs = raw.state.doseLogs.filter((l) => l.peptideId !== 'testosterone-e')
    raw.version = 0 // zustand's default — the shape every pre-v8 save carries
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(600)
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  const te = s.peptides.find((p) => p.id === 'testosterone-e')
  if (!te) throw new Error('migration did not add Testosterone Enanthate to an existing save')
  if (te.ladder.ceiling !== 50 || te.preparation !== 'premixed') throw new Error('migrated compound is misconfigured')
  if (!s.openVials['testosterone-e'] || !s.titration['testosterone-e']) throw new Error('inventory/titration not initialised')
  if (s.peptides.filter((p) => p.id === 'testosterone-e').length !== 1) throw new Error('added twice')
  // and the other peptides are untouched
  if (s.peptides.length < 12) throw new Error(`existing peptides lost (${s.peptides.length})`)
  console.log(`  migrated: ${s.peptides.length} peptides`)
})

await step('the migration does not re-add it after a deliberate delete', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.peptides = raw.state.peptides.filter((p) => p.id !== 'testosterone-e')
    localStorage.setItem('peptide-command-center', JSON.stringify(raw)) // version stays at 1
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(600)
  const has = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center'))
    .state.peptides.some((p) => p.id === 'testosterone-e'))
  if (has) throw new Error('a deleted compound came back on reload')
})

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 220)))
await browser.close()
process.exit(errors.length ? 1 : 0)
