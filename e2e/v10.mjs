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
const nav = (label) => page.click(`nav button:has-text("${label}")`)
const modal = () => page.locator('div.fixed.inset-0.z-50 > div.card')
const plan = () => page.locator('div.card', { hasText: 'instead of' }).first()
// the due card for a peptide, identified by the Log button only it has
const dueCard = (name) => page.locator('div.card', { hasText: name })
  .filter({ has: page.locator(`button[aria-label="Log ${name}"]`) }).first()

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
await page.click('text=Got it')
await waitText(/shots? instead of|nothing safely combinable/, 30000)

// ---------------- CHANGE 1 · only MIX pairs are combined ----------------
await step('every proposed group contains only MIX pairs', async () => {
  // read the plan out of the DOM, then check each group against the matrix
  const groups = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('div')]
      .filter((d) => /Combine into 1 shot/.test(d.textContent) && d.querySelector('button'))
    const names = rows.map((r) => {
      const name = r.querySelector('span.block.truncate, span.truncate')
      return name ? name.textContent.trim() : ''
    }).filter(Boolean)
    return [...new Set(names)]
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
  const note = await plan().textContent()
  if (!/safe to mix/.test(note)) throw new Error('the plan does not say it only combines confirmed mixes')
})
await page.screenshot({ path: `${SHOT}/v10-01-mix-only-plan.png` })

await step('manually selecting a CAUTION pair is refused, not gated', async () => {
  // Selank + SS-31 is CAUTION in the matrix, and both are due this morning
  await page.locator('button[aria-label="Select Selank to co-draw"]').click()
  await page.locator('button[aria-label="Select SS-31 to co-draw"]').click()
  await page.waitForTimeout(400)
  await page.click('button:has-text("Log together")')
  await waitText(/Not one shot — inject these separately/)
  const body = await modal().textContent()
  if (!/not confirmed/.test(body)) throw new Error('the caution pair is not labelled as unconfirmed')
  if (/Confirm it's clear/.test(body)) throw new Error('still offering the visual-inspection continue path')
  if (/pick one spot/i.test(body)) throw new Error('a site picker was offered for a caution pair')
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

await step('DSIP and GHK-Cu agree between the card hint and the plan', async () => {
  await page.click('button:has-text("PM")')
  await waitText(/DSIP/, 15000)
  await waitText(/shots? instead of|nothing safely combinable/, 25000)
  const dsip = await dueCard('DSIP').textContent()
  const ghk = await dueCard('GHK-Cu').textContent()
  if (!/Can combine with GHK-Cu tonight/.test(dsip)) {
    throw new Error(`DSIP hint should offer GHK-Cu — got: ${dsip.slice(0, 200)}`)
  }
  if (!/Can combine with DSIP tonight/.test(ghk)) {
    throw new Error(`GHK-Cu hint should offer DSIP — got: ${ghk.slice(0, 200)}`)
  }
  // and the plan agrees
  const planText = await plan().textContent()
  if (!/DSIP \+ GHK-Cu|GHK-Cu \+ DSIP/.test(planText)) {
    throw new Error(`the plan does not combine them — got: ${planText.slice(0, 200)}`)
  }
  console.log('  card hint and plan both combine DSIP + GHK-Cu')
})
await page.screenshot({ path: `${SHOT}/v10-03-no-contradiction.png` })

await step('a peptide with no MIX partner due says so instead', async () => {
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(800)
  const body = await page.textContent('body')
  if (!/Can combine with|Best on its own/.test(body)) throw new Error('no pairwise hint rendered at all')
  // whichever hint a card shows, it must be one of the two computed forms
  const stray = /Co-draw OK with/.test(body)
  if (stray) throw new Error('the legacy name-based hint is still rendering')
})

// ---------------- CHANGE 3 · intranasal ----------------
await step('Semax and Selank offer an intranasal route; others do not', async () => {
  await nav('More')
  await page.click('text=Library')
  await waitText(/Retatrutide/)
  await page.click('button:has-text("Semax")')
  await page.waitForTimeout(500)
  const opts = await page.locator('select').filter({ hasText: 'Subcutaneous' }).first().locator('option').allTextContents()
  if (!opts.some((o) => /Intranasal \(spray\)/.test(o))) throw new Error(`Semax has no intranasal option: ${opts}`)
  // an injectable-only peptide must not offer it
  await page.click('button:has-text("Semax")')
  await page.waitForTimeout(300)
  await page.click('button:has-text("KPV")')
  await page.waitForTimeout(500)
  const kpvOpts = await page.locator('select').filter({ hasText: 'Subcutaneous' }).first().locator('option').allTextContents()
  if (kpvOpts.some((o) => /Intranasal/.test(o))) throw new Error('KPV should not offer an intranasal route')
  await page.click('button:has-text("KPV")')
  await page.waitForTimeout(300)
})

await step('switching Semax to nasal converts the dose to sprays', async () => {
  await page.click('button:has-text("Semax")')
  await page.waitForTimeout(500)
  await page.locator('select').filter({ hasText: 'Subcutaneous' }).first().selectOption('Nasal')
  await page.waitForTimeout(600)
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
  const body = await page.textContent('body')
  for (const want of [
    /Reconstitute a 10 mg vial with 2 mL bacteriostatic water/,
    /Transfer the entire 2 mL \(all 10 mg\) into a nasal spray bottle/,
    /Add 3 mL sterile saline → final volume 5 mL/,
    /10 mg ÷ 5 mL = 2 mg\/mL/,
    /2,000 mcg\/mL/,
    /200 mcg per spray/,
    /50 sprays/,
  ]) {
    if (!want.test(body)) throw new Error(`recipe missing ${want}`)
  }
  if (!/1 spray = 200 mcg · 2 = 400 mcg · 3 = 600 mcg/.test(body)) throw new Error('spray reference table missing')
  if (!/No needle/.test(body)) throw new Error('needle note not switched for the nasal route')
})
await page.screenshot({ path: `${SHOT}/v10-04-nasal-recipe.png` })

await step('Home shows Semax in sprays with no insulin units', async () => {
  await nav('Home')
  await waitText(/Semax/, 15000)
  const card = await dueCard('Semax').textContent()
  if (!/\d+ sprays? \(\d+ mcg\)/.test(card)) throw new Error(`no spray dose on the card: ${card.slice(0, 160)}`)
  if (/\d+(\.\d+)? units/.test(card)) throw new Error('a nasal dose is still showing insulin units')
  if (!/Nasal spray — nothing to draw/.test(card)) throw new Error('card does not say it is sprayed, not drawn')
})

await step('it is excluded from injection co-draws and the combine plan', async () => {
  if (await page.locator('button[aria-label="Select Semax to co-draw"]').count()) {
    throw new Error('a nasal peptide is selectable for a co-draw')
  }
  if (!await page.locator('[aria-label="Semax cannot be co-drawn"]').count()) {
    throw new Error('no exclusion marker on the nasal card')
  }
  await waitText(/shots? instead of|nothing safely combinable/, 25000)
  const planText = await plan().textContent()
  if (/Semax/.test(planText)) throw new Error('a nasal peptide appears in the injection plan')
})

await step('logging it skips the site picker and records sprays', async () => {
  await page.click('button[aria-label="Log Semax"]')
  await waitText(/Take Semax/)
  const body = await modal().textContent()
  if (/Injection site map|INJECT HERE|Belly · upper-left/.test(body)) {
    throw new Error('the injection-site picker was shown for a nasal dose')
  }
  if (!/mcg per spray/.test(body)) throw new Error('spray strength not shown')
  if (!/sprays? left in the bottle/.test(body)) throw new Error('no bottle countdown')
  await modal().locator('button:has-text("How do I prepare the spray?")').click()
  await page.waitForTimeout(400)
  if (!/final volume 5 mL/.test(await modal().textContent())) throw new Error('recipe not reachable from the log flow')
  await modal().locator('button:has-text("Log ")').first().click()
  await waitText(/Logged — /)
  const confirm = await modal().textContent()
  if (!/sprays? \(\d+ mcg\)/.test(confirm)) throw new Error('confirmation does not name the spray dose')
  await modal().locator('button:has-text("Done")').click()
  await page.waitForTimeout(600)
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center'))
    .state.doseLogs.filter((l) => l.peptideId === 'semax').pop())
  if (!log) throw new Error('nothing logged')
  if (log.unit !== 'spray') throw new Error(`logged unit is ${log.unit}`)
  if (log.siteId !== null) throw new Error(`a nasal dose recorded an injection site: ${log.siteId}`)
  if (log.insulinUnits !== null) throw new Error(`a nasal dose recorded insulin units: ${log.insulinUnits}`)
  console.log(`  logged ${log.doseValue} sprays, no site, no units`)
})
await page.screenshot({ path: `${SHOT}/v10-05-nasal-log.png` })

await step('switching back to SubQ restores an injectable ladder', async () => {
  await nav('More')
  await page.click('text=Library')
  await waitText(/Semax/)
  await page.click('button:has-text("Semax")')
  await page.waitForTimeout(500)
  await page.locator('select').filter({ hasText: 'Subcutaneous' }).first().selectOption('SubQ')
  await page.waitForTimeout(600)
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
    raw.state.needleNotes = raw.state.needleNotes.filter((n) => n.id !== 'nasal')
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
  if (!s.needleNotes.some((n) => n.id === 'nasal')) throw new Error('nasal prep note not backfilled')
  if (!s.doseLogs?.length) throw new Error('the migration dropped existing logs')
  console.log('  migrated: Semax + Selank can now be switched to a spray')
})

console.log('\n--- console/page errors:', errors.length)
errors.forEach((e) => console.log(' ', e.slice(0, 220)))
await browser.close()
process.exit(errors.length ? 1 : 0)
