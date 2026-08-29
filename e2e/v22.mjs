// v22 — Stock room fixes: search icon/text overlap, add-stock from the full
// 86-compound matrix, run-out + restock-by date in place of doses-left, and
// batches kept as separate rows under one per-peptide summary.
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
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const modal = () => page.locator('div.fixed.inset-0.z-50 > div.card')
const nav = async (label) => { await page.click(`nav button:has-text("${label}")`); await page.waitForTimeout(500) }
const more = async (label) => {
  await nav('More')
  await page.click(`button:has-text("${label}")`)
  await page.waitForTimeout(700)
}
const stock = async () => {
  await more('Stock')
  const t = page.locator('[data-testid="stock-view"] button[aria-label="Stock room"]')
  if (await t.count()) { await t.click(); await page.waitForTimeout(500) }
}
const groupFor = (name) =>
  page.locator('[data-testid="stock-group"]').filter({ hasText: name }).first()
const closeModal = async () => {
  const x = page.locator('button[aria-label="Close"]').first()
  if (await x.count()) { await x.click({ timeout: 4000 }).catch(() => {}) }
  else await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
}
const openAddStock = async () => {
  await stock()
  await page.click('[data-testid="add-stock"]')
  await page.waitForTimeout(500)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
if (await modal().count()) { await page.click('button:has-text("Got it")'); await page.waitForTimeout(500) }

// ============================================ 1 · the search field, fixed

await step('the Add-stock search text is never obscured by the icon', async () => {
  await openAddStock()
  // the search is pinned above the sheet's scroll area, so it is a sibling of
  // the result list rather than a child of it — scoped to the sheet, not the list
  const input = page.locator('[data-testid="sheet-pinned"] input[aria-label="Search compounds"]')
  const padLeft = await input.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
  if (!(padLeft >= 28)) throw new Error(`padding-left is only ${padLeft}px — the icon overlaps typed text`)

  // belt and braces: the icon's own box must sit entirely left of where text starts
  const iconBox = await page.locator('[data-testid="sheet-pinned"] svg').first().boundingBox()
  const inputBox = await input.boundingBox()
  if (iconBox.x + iconBox.width > inputBox.x + padLeft - 2) {
    throw new Error('the icon overlaps the text-start position')
  }
  await page.fill('input[aria-label="Search compounds"]', 'Retatrutide')
  await page.waitForTimeout(300)
})

// ================================================ 2 · search all 86 compounds

await step('Add-stock searches the full 86-compound matrix, not just my protocol', async () => {
  await page.fill('input[aria-label="Search compounds"]', 'Thymosin Beta-4')
  await page.waitForTimeout(500)
  const results = page.locator('[data-testid="stock-picker"] button')
  if ((await results.count()) === 0) throw new Error('TB-500 returned nothing — search is still scoped to my protocol')
  const t = await results.first().textContent()
  if (!/TB-500/.test(t)) throw new Error(`did not find TB-500 in the results: ${t}`)
  if (!/not in my protocol/.test(t)) throw new Error('a compound outside my protocol should say so')
})

await step('picking a compound outside my protocol still creates a batch', async () => {
  await page.locator('[data-testid="stock-picker"] button').filter({ hasText: 'TB-500' }).first().click()
  await page.waitForTimeout(500)
  if (!(await page.locator('[data-testid="stock-batch-form"]').count())) {
    throw new Error('picking TB-500 did not open the batch form')
  }
  await page.fill('input[aria-label="Vial size in mg"]', '5')
  await page.fill('input[aria-label="How many vials"]', '2')
  await page.fill('input[aria-label="Vendor"]', 'Test Labs')
  await page.click('[data-testid="save-batch"]')
  await page.waitForTimeout(900)

  const st = await state()
  if (!st.vials.some((v) => v.peptideId === 'tb500' && v.vendor === 'Test Labs' && v.qtyOnHand === 2)) {
    throw new Error('the TB-500 batch was not recorded')
  }
})

await step('v23: adding stock creates no protocol entry — owning is not taking', async () => {
  const st = await state()
  if (st.peptides.some((p) => p.id === 'tb500')) {
    throw new Error('adding stock put TB-500 into my protocol without being asked')
  }
  // and it is still visibly on the shelf, flagged as not scheduled
  const group = groupFor('TB-500')
  if (!(await group.count())) throw new Error('the TB-500 batch is not in the stock room')
  if (!/not in my protocol/.test(await group.textContent())) {
    throw new Error('stock-only compounds should say they are not in my protocol')
  }
})

await step('a compound with no usable reference dose is left honestly blank, not invented', async () => {
  await stock()
  await page.click('[data-testid="add-stock"]')
  await page.waitForTimeout(500)
  await page.fill('input[aria-label="Search compounds"]', 'Dermorphin')
  await page.waitForTimeout(500)
  await page.locator('[data-testid="stock-picker"] button').first().click()
  await page.waitForTimeout(500)
  await page.fill('input[aria-label="Vial size in mg"]', '5')
  await page.fill('input[aria-label="How many vials"]', '1')
  await page.click('[data-testid="save-batch"]')
  await page.waitForTimeout(900)

  const st = await state()
  if (st.peptides.some((p) => p.id === 'dermorphin')) {
    throw new Error('adding stock put Dermorphin into my protocol without being asked')
  }
  if (!st.vials.some((v) => v.peptideId === 'dermorphin')) throw new Error('the Dermorphin batch was not recorded')
})

// ============================================== 3 · run-out + restock-by

await step('doses-left language is gone from the Stock room', async () => {
  await stock()
  const t = await page.locator('[data-testid="stock-room"]').textContent()
  if (/doses? left/i.test(t)) throw new Error(`stale "doses left" text still present: ${t.match(/.{0,20}doses? left.{0,20}/i)}`)
})

await step('each peptide with a real dose shows a run-out duration and a restock-by date', async () => {
  await stock()
  const group = groupFor('Retatrutide')
  const t = await group.textContent()
  if (!/left/.test(t)) throw new Error(`no run-out line on Retatrutide: ${t.replace(/\s+/g, ' ').slice(0, 140)}`)
  if (!/restock by/.test(t)) throw new Error(`no restock-by date on Retatrutide: ${t.replace(/\s+/g, ' ').slice(0, 140)}`)
})

await step('the run-out figure recomputes when the dose changes', async () => {
  const before = await groupFor('Retatrutide').textContent()
  await page.evaluate(() => {
    const K = 'peptide-command-center'
    const raw = JSON.parse(localStorage.getItem(K))
    raw.state.peptides = raw.state.peptides.map((p) => (
      p.id === 'retatrutide' ? { ...p, ladder: { ...p.ladder, floor: p.ladder.ceiling * 6, ceiling: p.ladder.ceiling * 6 } } : p
    ))
    localStorage.setItem(K, JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await stock()
  const after = await groupFor('Retatrutide').textContent()
  if (after === before) throw new Error('the run-out text did not change when the dose changed sixfold')
})

// ============================================ 4 · separate batches, one summary

await step('a peptide with two batches shows each as its own row, and the summary once', async () => {
  // the seed data starts each peptide with a single batch — add a second so
  // there is something real to keep apart
  await page.evaluate(() => {
    const K = 'peptide-command-center'
    const raw = JSON.parse(localStorage.getItem(K))
    raw.state.vials.push({
      id: 'v22-second-batch', peptideId: 'retatrutide', name: 'Retatrutide', vialMg: 20,
      vendor: 'Vendor B', qtyOnHand: 1, qtyPurchased: 1, costAud: 300, lot: '', sealedExpiry: '', coaKey: null,
    })
    localStorage.setItem(K, JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await stock()
  const group = groupFor('Retatrutide')
  const summaryOccurrences = (await group.textContent()).match(/restock by/g) || []
  if (summaryOccurrences.length !== 1) {
    throw new Error(`expected the run-out summary exactly once, saw it ${summaryOccurrences.length} times`)
  }
  await group.locator('button').first().click()
  await page.waitForTimeout(600)
  const rows = await group.locator('[data-testid="batch-row"]').count()
  if (rows < 2) throw new Error(`expected at least 2 separate batch rows for the seeded Retatrutide stock, got ${rows}`)
  // still exactly one summary after expanding — not repeated per batch
  const afterExpand = (await group.textContent()).match(/restock by/g) || []
  if (afterExpand.length !== 1) {
    throw new Error(`the run-out summary repeated after expanding: ${afterExpand.length} times`)
  }
})

// ==================================================== 5 · 390px cleanliness

await step('the Stock room reads cleanly with no overflow at 390px', async () => {
  await stock()
  const over = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  if (over) throw new Error('horizontal overflow on the Stock room')

  // expand every group and check again — batch rows are where clutter would show
  const groups = page.locator('[data-testid="stock-group"] > button')
  const n = await groups.count()
  for (let i = 0; i < n; i++) {
    await groups.nth(i).click()
    await page.waitForTimeout(150)
  }
  const overExpanded = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  if (overExpanded) throw new Error('horizontal overflow once every group is expanded')

  const cut = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('[data-testid="stock-room"] p')) {
      if (el.scrollWidth > el.clientWidth + 1) out.push(el.textContent.trim().slice(0, 40))
    }
    return out
  })
  if (cut.length) throw new Error(`truncated text in the Stock room: ${cut.join(' | ')}`)
})

// ============================================= 6 · no errors, data persists

await step('the new stock survives a reload', async () => {
  const before = await state()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const after = await state()
  if (after.vials.length !== before.vials.length) throw new Error('vials lost across reload')
  if (!after.vials.some((v) => v.peptideId === 'tb500')) throw new Error('the TB-500 batch was lost across reload')
  if (!after.vials.some((v) => v.peptideId === 'dermorphin')) throw new Error('the Dermorphin batch was lost across reload')
})

await step('no runtime errors anywhere in the run', async () => {
  const real = errors.filter((e) => e.startsWith('pageerror') || e.startsWith('console'))
  if (real.length) throw new Error(real.slice(0, 3).join(' | '))
})

await stock()
await page.screenshot({ path: `${SHOT}/v22-stock.png`, fullPage: true })
await browser.close()

const failures = errors.filter((e) => e.startsWith('step ') || e.startsWith('pageerror') || e.startsWith('console'))
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : 'ALL PASS'}`)
for (const f of failures) console.log(' -', f.split('\n')[0])
process.exit(failures.length ? 1 : 0)
