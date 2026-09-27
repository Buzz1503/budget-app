// v20 — skipping a dose.
//
// This suite also covered thigh-only injection zones, which v30 removed along
// with the rest of site rotation. Those steps are gone rather than left failing:
// a red board nobody believes is worse than a smaller one that means something.
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
// v30 moved Skip (and Vial done, and Log together) behind a per-row overflow
// control, so reaching it means opening that row's menu first.
const rowIndex = (name) => page.locator('[data-testid="log-row"]').evaluateAll(
  (els, n) => els.findIndex((e) => (e.getAttribute('aria-label') || '').includes(n)), name)
const openRowMenu = async (i) => {
  await page.locator('[data-testid="row-overflow"]').nth(i).click()
  await page.waitForTimeout(450)
}
const shutMenus = async () => {
  for (let i = 0; i < 8; i++) {
    const open = page.locator('[data-testid="row-overflow"][aria-expanded="true"]')
    if (!(await open.count())) break
    await open.first().click()
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(300)
}
const nameOfRow = async (i) => (await page.locator('[data-testid="log-row"]').nth(i)
  .getAttribute('aria-label')).replace(/^Log /, '').replace(/ logged$/, '')
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const modal = () => page.locator('div.fixed.inset-0.z-50 > div.card')
const nav = async (label) => { await page.click(`nav button:has-text("${label}")`); await page.waitForTimeout(500) }
const more = async (label) => {
  await nav('More')
  await page.click(`button:has-text("${label}")`)
  await page.waitForTimeout(700)
}
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
if (await modal().count()) { await page.click('button:has-text("Got it")'); await page.waitForTimeout(500) }

// ============================================================== 5 · skipping

await step('every outstanding dose can be skipped from its row', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const rows = await page.locator('[data-testid="log-row"]:not([data-done])').count()
  if (!rows) throw new Error('nothing outstanding on Home to skip')
  const overflows = await page.locator('[data-testid="row-overflow"]').count()
  if (overflows < rows) throw new Error(`${rows} outstanding doses but only ${overflows} menus`)
  // and the menu on one of them actually holds Skip
  await openRowMenu(0)
  if (!(await page.locator('[data-testid="skip-peptide"]').count())) {
    throw new Error('the row menu has no Skip')
  }
  await shutMenus()
})

// Whichever peptide happens to be due first — the suite must not depend on a
// particular compound's weekday landing on the day it runs.
let skipTarget = null
await step('skipping records it with an optional reason', async () => {
  await nav('Home')
  await page.waitForTimeout(600)
  await shutMenus()
  const i = await page.locator('[data-testid="log-row"]').evaluateAll(
    (els) => els.findIndex((e) => e.dataset.done !== 'true'))
  if (i < 0) throw new Error('nothing skippable on Home')
  skipTarget = await nameOfRow(i)
  await openRowMenu(i)
  await page.locator('[data-testid="skip-peptide"]').click()
  await page.waitForTimeout(600)
  if (!(await page.locator('[data-testid="skip-sheet"]').count())) throw new Error('no skip sheet')
  await page.click('button:has-text("Travelling")')
  await page.waitForTimeout(250)
  await page.click('[data-testid="skip-confirm"]')
  await page.waitForTimeout(900)
  const st = await state()
  const k = st.skips.find((x) => x.kind === 'peptide' && x.name === skipTarget)
  if (!k) throw new Error(`the skip for ${skipTarget} was not recorded`)
  if (k.reason !== 'travel') throw new Error(`the reason is "${k.reason}"`)
})

await step('a skip is not a dose — nothing is logged and no stock moves', async () => {
  const st = await state()
  const k = st.skips.find((x) => x.kind === 'peptide' && x.name === skipTarget)
  const pid = k.peptideId
  if (st.doseLogs.some((l) => l.peptideId === pid && l.date === k.date)) {
    throw new Error('a dose log was written for a skip')
  }
  const vial = st.openVials?.[pid]
  const seeded = st.peptides.find((p) => p.id === pid)?.recon?.vialMg
  if (vial && seeded != null && vial.remainingMg !== seeded) {
    throw new Error(`inventory moved on a skip: ${vial.remainingMg} vs ${seeded}`)
  }
})

// v31 removed the hero and its ring, so the skip is reported where the dose
// itself is. Both halves of the original claim still hold: the card says it
// was skipped, and it says the vial was not touched.
await step('a skipped dose reads as skipped, and leaves the stock alone', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const t = await main()
  if (!/Skipped today/.test(t)) throw new Error('the card does not read as skipped')
  if (!/nothing taken from stock/i.test(t)) throw new Error('the card does not say stock is untouched')
  const st = await state()
  if (!st.skips.length) throw new Error('nothing was recorded as skipped')
  if (st.doseLogs.some((l) => l.date === st.skips[0].date && l.peptideId === st.skips[0].peptideId)) {
    throw new Error('a skip also wrote a dose log')
  }
})

await step('a skip can be undone', async () => {
  await nav('Home')
  await page.waitForTimeout(600)
  await page.click(`button[aria-label="Undo skip: ${skipTarget}"]`)
  await page.waitForTimeout(800)
  const st = await state()
  if (st.skips.some((k) => k.kind === 'peptide' && k.name === skipTarget)) {
    throw new Error('the skip survived the undo')
  }
  if ((await rowIndex(skipTarget)) < 0) throw new Error('the dose did not come back onto the list')
})

await step('supplements can be skipped too', async () => {
  // put one on the shelf first
  await more('Supplements')
  await page.click('[data-testid="add-supplement"]')
  await page.waitForTimeout(600)
  await page.fill('input[aria-label="Search supplements"]', 'B-Complex')
  await page.waitForTimeout(400)
  await page.locator('[data-testid="supplement-library"] button:has-text("B-Complex #12")').first().click()
  await page.waitForTimeout(700)

  await nav('Home')
  await page.waitForTimeout(700)
  if ((await page.locator('[data-testid="take-row"]').count()) === 0) {
    await page.click('button:has-text("AM")'); await page.waitForTimeout(600)
  }
  const skip = page.locator('[data-testid="skip-supplement"]').first()
  if (!(await skip.count())) throw new Error('no Skip action on a supplement')
  await skip.click()
  await page.waitForTimeout(600)
  await page.click('[data-testid="skip-confirm"]')
  await page.waitForTimeout(900)
  const st = await state()
  const k = st.skips.find((x) => x.kind === 'supplement')
  if (!k) throw new Error('the supplement skip was not recorded')
  if (st.supplementLogs.length) throw new Error('a taken-log was written for a skipped supplement')
  const row = await page.locator('[data-testid="take-row"]').first().textContent()
  if (!/Skipped today/.test(row)) throw new Error('the row does not read as skipped')
})

// v30 replaced the multi-select bar with per-row actions, so two doses are
// skipped by skipping two doses. The claim being kept is that skipping one
// leaves the others alone and each is recorded in its own right.
await step('doses are skipped one at a time, each recorded separately', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  await shutMenus()
  const before = (await state()).skips.length
  for (let n = 0; n < 2; n++) {
    const i = await page.locator('[data-testid="log-row"]').evaluateAll(
      (els) => els.findIndex((e) => e.dataset.done !== 'true' && !/Undo skip/.test(e.getAttribute('aria-label') || '')))
    if (i < 0) throw new Error(`ran out of outstanding doses after ${n}`)
    await openRowMenu(i)
    await page.locator('[data-testid="skip-peptide"]').click()
    await page.waitForTimeout(500)
    await page.click('[data-testid="skip-confirm"]')
    await page.waitForTimeout(900)
  }
  const after = (await state()).skips.length
  if (after !== before + 2) throw new Error(`expected 2 more skips, got ${after - before}`)
})

await step('History counts skipped apart from missed', async () => {
  await more('History & adherence')
  await waitText(/Adherence/)
  const box = page.locator('[data-testid="skip-summary"]')
  if (!(await box.count())) throw new Error('no skip figure in the adherence block')
  const t = await box.textContent()
  if (!/skipped/i.test(t)) throw new Error('the figure is not labelled skipped')
  if (!/missed/i.test(t)) throw new Error('missed is not shown alongside it')
})

// v30.1 took the flat skipped list off History — on a page about months of
// dose history it was a list of days, belonging to no compound in particular.
// The days themselves moved to the compound they happened to, which is where
// somebody asking "why is there a gap here" is already looking.
await step('and lists the days themselves on the compound they belong to', async () => {
  const skipped = (await state()).skips.find((k) => k.kind === 'peptide')
  if (!skipped) throw new Error('nothing was skipped to go looking for')
  const row = page.locator('[data-testid="tenure-row"]').filter({ hasText: skipped.name.split(' ')[0] }).first()
  if (!(await row.count())) throw new Error(`${skipped.name} has no row in the tenure table`)
  await row.click()
  await page.waitForTimeout(900)
  const block = page.locator('[data-testid="detail-skips"]')
  if (!(await block.count())) throw new Error('the compound detail does not list its skipped days')
  const lt = await block.textContent()
  if (!/not a lapse/i.test(lt)) throw new Error('it does not frame a skip as a decision')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
})

// ============================================================ 6 · 390px fit

await step('nothing overflows horizontally at 390px', async () => {
  const bad = []
  for (const [how, label] of [['nav', 'Home'], ['nav', 'Calendar'], ['more', 'Protocol overview'], ['more', 'History & adherence']]) {
    if (how === 'nav') await nav(label); else await more(label)
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (over) bad.push(label)
  }
  if (bad.length) throw new Error(`horizontal overflow on: ${bad.join(', ')}`)
})

// ============================================================= 7 · survival

await step('skips survive a reload', async () => {
  const before = await state()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const after = await state()
  if (after.skips.length !== before.skips.length) throw new Error('skips lost')
  if (after.peptides.length !== before.peptides.length) throw new Error('the stack changed')
})

await step('logging still works normally after all this', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  await shutMenus()
  const before = (await state()).doseLogs.length
  const row = page.locator('[data-testid="log-row"]:not([data-done])').first()
  if (!(await row.count())) throw new Error('nothing left to log')
  await row.click()
  await page.waitForTimeout(1000)
  const st = await state()
  if (st.doseLogs.length !== before + 1) throw new Error('the dose was not logged')
  if (st.doseLogs.at(-1).siteId !== undefined) throw new Error('a new log carries a siteId')
})

await step('no runtime errors anywhere in the run', async () => {
  const real = errors.filter((e) => e.startsWith('pageerror') || e.startsWith('console'))
  if (real.length) throw new Error(real.slice(0, 3).join(' | '))
})

await nav('Home')
await page.screenshot({ path: `${SHOT}/v20-home.png`, fullPage: true })
await browser.close()

const failures = errors.filter((e) => e.startsWith('step ') || e.startsWith('pageerror') || e.startsWith('console'))
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : 'ALL PASS'}`)
for (const f of failures) console.log(' -', f.split('\n')[0])
process.exit(failures.length ? 1 : 0)
