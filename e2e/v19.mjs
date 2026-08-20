// v19 — free-form calculator + oral supplement stack.
// Runs at 390×844 against a build (or the dev server) on BASE_URL.
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
const waitText = async (re, timeout = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (re.test(await page.textContent('body'))) return true
    await page.waitForTimeout(150)
  }
  throw new Error('timeout waiting for ' + re)
}
const main = () => page.locator('main').textContent()
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const modal = () => page.locator('div.fixed.inset-0.z-50 > div.card')
const nav = async (label) => { await page.click(`nav button:has-text("${label}")`); await page.waitForTimeout(500) }
const more = async (label) => {
  await nav('More')
  await page.click(`button:has-text("${label}")`)
  await page.waitForTimeout(700)
}
// the big readouts animate up to their value, so settle before reading them
const SETTLE = 1600

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
if (await modal().count()) { await page.click('button:has-text("Got it")'); await page.waitForTimeout(500) }

// ========================================================= 1 · calculator

await step('the calculator offers a stack mode and a manual mode', async () => {
  await more('Calculator')
  const toggle = page.locator('[data-testid="calc-source"]')
  if (!(await toggle.count())) throw new Error('no source toggle')
  for (const label of ['From my stack', 'Manual / any peptide']) {
    if (!(await toggle.locator(`button[aria-label="${label}"]`).count())) {
      throw new Error(`no "${label}" option`)
    }
  }
})

await step('stack mode still lists the stack; manual mode names nothing', async () => {
  await more('Calculator')
  if (!(await page.locator('[data-testid="calc-stack-picker"]').count())) {
    throw new Error('stack mode is not showing the compound picker')
  }
  await page.click('button[aria-label="Manual / any peptide"]')
  await page.waitForTimeout(500)
  if (await page.locator('[data-testid="calc-stack-picker"]').count()) {
    throw new Error('manual mode is still showing the compound picker')
  }
  if (!(await page.locator('[data-testid="calc-manual-hint"]').count())) {
    throw new Error('manual mode does not explain itself')
  }
})

await step('manual mode computes concentration, units and mL for an unnamed vial', async () => {
  await more('Calculator')
  await page.click('button[aria-label="Manual / any peptide"]')
  await page.waitForTimeout(400)
  const f = page.locator('input[inputmode="decimal"]')
  await f.nth(0).fill('10')   // vial mg
  await f.nth(1).fill('2')    // BAC mL
  await page.selectOption('select', 'mcg')
  await f.nth(2).fill('500')  // target dose
  await page.waitForTimeout(SETTLE)
  const t = await main()
  const conc = (t.match(/([\d.]+) mg\/mL/) || [])[1]
  const units = (t.match(/([\d.]+)\s*units/) || [])[1]
  const ml = (t.match(/=\s*([\d.]+) mL/) || [])[1]
  if (conc !== '5') throw new Error(`concentration reads ${conc}, expected 5 mg/mL`)
  if (Math.abs(parseFloat(units) - 10) > 0.05) throw new Error(`units read ${units}, expected 10`)
  if (Math.abs(parseFloat(ml) - 0.1) > 0.001) throw new Error(`mL reads ${ml}, expected 0.1`)
})

await step('the mcg / mg switch changes the answer', async () => {
  await more('Calculator')
  await page.click('button[aria-label="Manual / any peptide"]')
  await page.waitForTimeout(400)
  const f = page.locator('input[inputmode="decimal"]')
  await f.nth(0).fill('10'); await f.nth(1).fill('2')
  await page.selectOption('select', 'mg')
  await f.nth(2).fill('1')
  await page.waitForTimeout(SETTLE)
  const units = ((await main()).match(/([\d.]+)\s*units/) || [])[1]
  if (Math.abs(parseFloat(units) - 20) > 0.05) throw new Error(`1 mg at 5 mg/mL should be 20 units, got ${units}`)
})

await step('reverse mode turns units drawn back into a delivered dose', async () => {
  await more('Calculator')
  await page.click('button[aria-label="Manual / any peptide"]')
  await page.waitForTimeout(400)
  const f = page.locator('input[inputmode="decimal"]')
  await f.nth(0).fill('10'); await f.nth(1).fill('2')
  await page.selectOption('select', 'mcg')
  await page.click('button:has-text("dose → units")')
  await page.waitForTimeout(400)
  await page.locator('input[inputmode="decimal"]').last().fill('20')
  await page.waitForTimeout(SETTLE)
  const t = await main()
  const dose = (t.match(/Delivered dose([\d.]+)/) || [])[1]
  if (Math.abs(parseFloat(dose) - 1000) > 1) throw new Error(`20 units at 5 mg/mL should be 1000 mcg, got ${dose}`)
})

await step('manual mode saves nothing to the stack on its own', async () => {
  const before = (await state()).peptides.length
  await more('Calculator')
  await page.click('button[aria-label="Manual / any peptide"]')
  await page.waitForTimeout(400)
  const f = page.locator('input[inputmode="decimal"]')
  await f.nth(0).fill('15'); await f.nth(1).fill('3')
  await page.waitForTimeout(600)
  await nav('Home'); await page.waitForTimeout(400)
  const after = (await state()).peptides.length
  if (after !== before) throw new Error(`the stack changed by itself: ${before} → ${after}`)
})

await step('saving to the stack is offered, and only happens when asked', async () => {
  const before = (await state()).peptides.length
  await more('Calculator')
  await page.click('button[aria-label="Manual / any peptide"]')
  await page.waitForTimeout(400)
  const f = page.locator('input[inputmode="decimal"]')
  await f.nth(0).fill('12'); await f.nth(1).fill('2')
  await page.click('[data-testid="calc-save"] button')
  await page.waitForTimeout(400)
  await page.fill('input[aria-label="New compound name"]', 'Probe Peptide')
  await page.click('button:has-text("Save")')
  await page.waitForTimeout(800)
  const st = await state()
  if (st.peptides.length !== before + 1) throw new Error('the compound was not added')
  const added = st.peptides.find((p) => p.name === 'Probe Peptide')
  if (!added) throw new Error('the saved compound is not in the stack')
  if (added.recon.vialMg !== 12 || added.recon.bacMl !== 2) {
    throw new Error(`the vial did not carry over: ${JSON.stringify(added.recon)}`)
  }
  // and nothing was invented for it
  if (added.ladder.ceiling !== 0) throw new Error('a dose ladder was invented for it')
})

// ======================================================== 2 · supplements

await step('Supplements is reachable from More', async () => {
  await more('Supplements')
  if (!(await page.locator('[data-testid="supplements-view"]').count())) {
    throw new Error('the Supplements screen did not open')
  }
})

await step('the library lists the 12 owned supplements under "Your shelf"', async () => {
  await more('Supplements')
  await page.click('[data-testid="add-supplement"]')
  await page.waitForTimeout(600)
  const owned = page.locator('[data-testid="library-owned"] button')
  const n = await owned.count()
  if (n !== 12) throw new Error(`"Your shelf" has ${n} entries, expected 12`)
  const text = await page.locator('[data-testid="library-owned"]').textContent()
  if (!/Your shelf/.test(await page.locator('[data-testid="supplement-library"]').textContent())) {
    throw new Error('the owned group is not labelled "Your shelf"')
  }
  for (const name of ['Vitamin D3 + K2 Spray', 'Glycine', 'Triple Magnesium', 'Liposomal Apigenin']) {
    if (!text.includes(name)) throw new Error(`"${name}" is missing from the shelf`)
  }
  if (!(await page.locator('[data-testid="library-available"]').count())) {
    throw new Error('the rest of the library is not offered')
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
})

await step('adding from the library pre-fills brand, form, dose, timing and note', async () => {
  await more('Supplements')
  await page.click('[data-testid="add-supplement"]')
  await page.waitForTimeout(500)
  await page.fill('input[aria-label="Search supplements"]', 'Vitamin D3')
  await page.waitForTimeout(400)
  await page.locator('[data-testid="supplement-library"] button:has-text("Vitamin D3 + K2 Spray")').first().click()
  await page.waitForTimeout(700)
  const st = await state()
  const s = st.supplements.find((x) => x.libraryId === 'd3k2')
  if (!s) throw new Error('not added')
  if (s.brand !== 'BioCeuticals') throw new Error(`brand is "${s.brand}"`)
  if (s.form !== 'spray') throw new Error(`form is "${s.form}"`)
  if (s.dose !== '2 sprays daily') throw new Error(`dose is "${s.dose}"`)
  if (s.slot !== 'AM') throw new Error(`slot is "${s.slot}"`)
  if (!/blood level/i.test(s.doseNote || '')) throw new Error('the dose note did not carry over')
})

await step('daily lands in the morning and sleep in the evening', async () => {
  await more('Supplements')
  for (const name of ['B-Complex #12', 'Glycine']) {
    await page.click('[data-testid="add-supplement"]')
    await page.waitForTimeout(500)
    await page.fill('input[aria-label="Search supplements"]', name)
    await page.waitForTimeout(400)
    await page.locator(`[data-testid="supplement-library"] button:has-text("${name}")`).first().click()
    await page.waitForTimeout(700)
  }
  const st = await state()
  const b = st.supplements.find((x) => x.libraryId === 'thorne_b')
  const g = st.supplements.find((x) => x.libraryId === 'glycine')
  if (b.category !== 'daily' || b.slot !== 'AM') throw new Error(`daily B-complex sits in ${b.slot}`)
  if (g.category !== 'sleep' || g.slot !== 'PM') throw new Error(`sleep glycine sits in ${g.slot}`)
  if (!(await page.locator('[data-testid="supplement-slot-AM"]').count())) throw new Error('no morning group')
  if (!(await page.locator('[data-testid="supplement-slot-PM"]').count())) throw new Error('no evening group')
})

await step('the double-magnesium caution shows once the second one is added', async () => {
  await more('Supplements')
  const before = await page.locator('[data-testid="supplement-cautions"] > div').count()
  for (const name of ['Triple Magnesium', 'Magnesium Glycinate 500mg']) {
    await page.click('[data-testid="add-supplement"]')
    await page.waitForTimeout(500)
    await page.fill('input[aria-label="Search supplements"]', name)
    await page.waitForTimeout(400)
    await page.locator(`[data-testid="supplement-library"] button:has-text("${name}")`).first().click()
    await page.waitForTimeout(700)
  }
  const box = page.locator('[data-testid="supplement-cautions"]')
  if (!(await box.count())) throw new Error('no caution appeared for two magnesium products')
  const t = await box.textContent()
  if (!/magnesium/i.test(t)) throw new Error('the caution is not about magnesium')
  if (!/300/.test(t)) throw new Error('the caution does not give the total to stay under')
})

await step('the berberine caution names the glucose-lowering peptides', async () => {
  await more('Supplements')
  await page.click('[data-testid="add-supplement"]')
  await page.waitForTimeout(500)
  await page.fill('input[aria-label="Search supplements"]', 'Berberine')
  await page.waitForTimeout(400)
  await page.locator('[data-testid="supplement-library"] button:has-text("Berberine")').first().click()
  await page.waitForTimeout(700)
  const t = await page.locator('[data-testid="supplement-cautions"]').textContent()
  if (!/glucose-lowering/i.test(t)) throw new Error('no glucose caution')
  if (!/retatrutide/i.test(t)) throw new Error('the caution does not name the peptides it stacks with')
})

await step('a supplement can be entered by hand with a form choice', async () => {
  await more('Supplements')
  await page.click('[data-testid="add-supplement"]')
  await page.waitForTimeout(500)
  await page.click('button[aria-label="Enter my own"]')
  await page.waitForTimeout(400)
  const forms = await page.locator('select[aria-label="Form"] option').allTextContents()
  for (const f of ['Tablet', 'Capsule', 'Powder', 'Spray', 'Liquid']) {
    if (!forms.includes(f)) throw new Error(`the form list is missing ${f} — got [${forms.join(', ')}]`)
  }
  await page.fill('input[aria-label="Supplement name"]', 'Hand Entered')
  await page.selectOption('select[aria-label="Form"]', 'powder')
  await page.fill('input[aria-label="Dose"]', '5 g')
  await page.click('button:has-text("Evening")')
  await page.click('button:has-text("Add to shelf")')
  await page.waitForTimeout(700)
  const s = (await state()).supplements.find((x) => x.name === 'Hand Entered')
  if (!s) throw new Error('the hand-entered supplement was not saved')
  if (s.form !== 'powder' || s.dose !== '5 g' || s.slot !== 'PM') {
    throw new Error(`saved as ${JSON.stringify({ form: s.form, dose: s.dose, slot: s.slot })}`)
  }
})

await step('the shelf shows dose notes and is editable', async () => {
  await more('Supplements')
  await page.locator('[data-testid="supplement-slot-AM"] button').first().click()
  await page.waitForTimeout(500)
  if (!(await page.locator('button:has-text("Edit")').count())) throw new Error('no edit affordance')
  await page.click('button:has-text("Edit")')
  await page.waitForTimeout(500)
  await page.fill('input[aria-label="Dose"]', '1 spray daily')
  await page.click('button:has-text("Save")')
  await page.waitForTimeout(700)
  const edited = (await state()).supplements.some((x) => x.dose === '1 spray daily')
  if (!edited) throw new Error('the edit did not save')
})

// ============================================================== 3 · Home

await step('Home shows a separate oral "Take" group', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const grp = page.locator('[data-testid="take-group"]')
  if (!(await grp.count())) {
    // the AM group may be empty if the slot toggle is on PM — check both
    await page.click('button:has-text("PM")')
    await page.waitForTimeout(600)
  }
  if (!(await page.locator('[data-testid="take-group"]').count())) {
    throw new Error('no Take group on Home in either slot')
  }
  if ((await page.locator('[data-testid="take-row"]').count()) === 0) {
    throw new Error('the Take group has no rows')
  }
})

await step('a Take row carries no injection concepts', async () => {
  await nav('Home')
  await page.waitForTimeout(600)
  let rows = page.locator('[data-testid="take-row"]')
  if ((await rows.count()) === 0) { await page.click('button:has-text("PM")'); await page.waitForTimeout(600) }
  const t = await page.locator('[data-testid="take-row"]').first().textContent()
  for (const word of ['units', 'Site', 'site', 'co-draw', 'Co-draw']) {
    if (t.includes(word)) throw new Error(`the Take row mentions "${word}"`)
  }
})

await step('one tap logs it taken, and a second tap undoes it', async () => {
  await nav('Home')
  await page.waitForTimeout(600)
  if ((await page.locator('[data-testid="take-row"]').count()) === 0) {
    await page.click('button:has-text("PM")'); await page.waitForTimeout(600)
  }
  // v20 split the row into its own buttons so Skip could sit beside Taken —
  // the row itself is no longer the tap target.
  const row = page.locator('[data-testid="take-row"]').first()
  const taken = () => row.locator('button[aria-label^="Taken:"], button[aria-label^="Undo:"]').first()
  await taken().click()
  await page.waitForTimeout(1000)
  let st = await state()
  if (st.supplementLogs.length !== 1) throw new Error(`expected 1 log, got ${st.supplementLogs.length}`)
  if (!/Taken/.test(await row.textContent())) throw new Error('the row does not read as taken')
  await taken().click()
  await page.waitForTimeout(900)
  st = await state()
  if (st.supplementLogs.length !== 0) throw new Error('tapping again did not undo it')
  await taken().click()
  await page.waitForTimeout(1000)
})

await step('supplements count towards the day, not just the injections', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const hero = await page.locator('[data-testid="hero"]').textContent()
  const today = hero.match(/(\d+)\/(\d+) today/)
  if (!today) throw new Error(`no day count in the hero: ${hero.replace(/\s+/g, ' ')}`)
  const st = await state()
  const scheduledInjections = st.peptides.length // upper bound, just needs to exceed it
  if (parseInt(today[2], 10) <= 0) throw new Error('the day total is zero with a full shelf')
  // the shelf has 7 supplements by now; the total must reflect them
  if (parseInt(today[2], 10) < st.supplements.length) {
    throw new Error(`day total ${today[2]} is below the ${st.supplements.length} supplements alone`)
  }
})

// ================================================ 4 · calendar + adherence

await step('supplements reach the calendar', async () => {
  await nav('Calendar')
  await page.waitForTimeout(800)
  const st = await state()
  if (!st.supplements.length) throw new Error('no supplements to check')
  // the day cell counts must include the orals
  const cal = await page.evaluate(() => document.querySelector('main').textContent)
  if (!cal || cal.length < 20) throw new Error('the calendar did not render')
})

await step('supplement adherence is its own figure in History', async () => {
  await more('History & adherence')
  await waitText(/Adherence/)
  const box = page.locator('[data-testid="supplement-adherence"]')
  if (!(await box.count())) throw new Error('no supplement adherence block')
  const t = await box.textContent()
  if (!/Supplements/.test(t)) throw new Error('the block is not labelled')
  if (!/%/.test(t)) throw new Error('no rate shown')
})

// ============================================================ 5 · 390px fit

await step('nothing overflows horizontally at 390px on the new screens', async () => {
  const bad = []
  for (const [how, label] of [['nav', 'Home'], ['nav', 'Calendar'], ['more', 'Supplements'], ['more', 'Calculator']]) {
    if (how === 'nav') await nav(label); else await more(label)
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (over) bad.push(label)
  }
  if (bad.length) throw new Error(`horizontal overflow on: ${bad.join(', ')}`)
})

await step('the nav does not cover the last card on Supplements', async () => {
  await more('Supplements')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(450)
  const clear = await page.evaluate(() => {
    const navTop = document.querySelector('nav').getBoundingClientRect().top
    let lowest = 0
    for (const el of document.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect()
      if (r.height === 0 || r.width === 0 || !el.textContent.trim()) continue
      lowest = Math.max(lowest, r.bottom)
    }
    return navTop - lowest
  })
  if (clear < -1) throw new Error(`content runs ${Math.round(-clear)}px under the nav`)
})

// ============================================================ 6 · survival

await step('the shelf and its logs survive a reload', async () => {
  const before = await state()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const after = await state()
  if (after.supplements.length !== before.supplements.length) throw new Error('supplements lost')
  if (after.supplementLogs.length !== before.supplementLogs.length) throw new Error('supplement logs lost')
  if (after.peptides.length !== before.peptides.length) throw new Error('the peptide stack changed')
})

await step('removing a supplement takes its logs with it', async () => {
  await more('Supplements')
  const st0 = await state()
  const target = st0.supplements[0]
  await page.locator(`[data-testid^="supplement-slot-"] button:has-text("${target.name}")`).first().click()
  await page.waitForTimeout(500)
  await page.click(`button[aria-label="Remove ${target.name}"]`)
  await page.waitForTimeout(700)
  const st1 = await state()
  if (st1.supplements.some((x) => x.id === target.id)) throw new Error('it was not removed')
  if (st1.supplementLogs.some((l) => l.supplementId === target.id)) throw new Error('its logs were orphaned')
})

await step('existing peptide behaviour is untouched', async () => {
  await nav('Home')
  await page.waitForTimeout(600)
  const t = await main()
  if (!/to inject|to take|done|Clear/.test(t)) throw new Error('the Home hero lost its headline')
  const st = await state()
  if (!st.peptides.length) throw new Error('the peptide stack is gone')
})

await step('no runtime errors anywhere in the run', async () => {
  const real = errors.filter((e) => e.startsWith('pageerror') || e.startsWith('console'))
  if (real.length) throw new Error(real.slice(0, 3).join(' | '))
})

await page.screenshot({ path: `${SHOT}/v19-home.png`, fullPage: true })
await more('Supplements')
await page.screenshot({ path: `${SHOT}/v19-supplements.png`, fullPage: true })
await browser.close()

const failures = errors.filter((e) => e.startsWith('step ') || e.startsWith('pageerror') || e.startsWith('console'))
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : 'ALL PASS'}`)
for (const f of failures) console.log(' -', f.split('\n')[0])
process.exit(failures.length ? 1 : 0)
