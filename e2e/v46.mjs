// v46 — stock tracking: the open vial counts down from the log, the question after a
// log, the recipe and Mixed, Undo, out of stock, the fridge-life question, the Stock
// screen, the weekly count, an order arriving, and a v24 save moving onto the model.
//
// At 390x844, against the real screens. Each step seeds the store through
// localStorage, reloads, drives the screen and reads the store back.
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

let failures = 0
const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { failures++; console.log('FAIL', name, '-', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}

const KEY = 'peptide-command-center'
const state = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)).state, KEY)
const setState = (fn, arg) => page.evaluate(([f, a, k]) => {
  const raw = JSON.parse(localStorage.getItem(k))
  // eslint-disable-next-line no-new-func
  new Function('s', 'a', 'raw', f)(raw.state, a, raw)
  localStorage.setItem(k, JSON.stringify(raw))
}, [fn, arg, KEY])
const gotIt = async () => {
  const b = page.locator('button:has-text("Got it")')
  if (!(await b.count())) return
  try { await b.first().click({ timeout: 3000 }) } catch { /* left alone */ }
  await page.waitForTimeout(400)
}
const reload = async () => {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1500)
  await gotIt()
}
const closeAll = async () => {
  await gotIt()
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('[data-testid="sheet"]').count())) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  }
}
const goStock = async () => {
  await closeAll()
  await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(500)
  await page.click('[data-testid="more-supplies"]'); await page.waitForTimeout(900)
}
const goHome = async () => { await closeAll(); await page.click('nav button[aria-label="Home"]'); await page.waitForTimeout(700) }
const noOverflow = async (where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 391) throw new Error(`${where} overflows to ${w}px`)
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) }
const TODAY = dayOffset(0)
const stamp = (n, h = 10) => `${dayOffset(n)}T${String(h).padStart(2, '0')}:00:00.000Z`

// SS-31: daily, 2.5 mg a dose, 50 mg vials, two sealed. A 3 mg open vial is emptied by one log.
const ss31Open = (over = {}) => ({
  id: 'o-ss31', peptideId: 'ss31', batchId: 'vial-ss31', vialMg: 3, volumeMl: 2, reconstitutedAt: TODAY, activatedAt: stamp(-1),
  adjustments: [], expiryAskedOn: null, ...over,
})
const seed = (open, extra = '') => setState(`
  s.openVials.ss31 = a.open
  s.doseLogs = s.doseLogs.filter((l) => l.peptideId !== 'ss31')
  s.finishedVials = []
  s.stockAdjustments = []
  s.vials = s.vials.map((v) => v.peptideId === 'ss31' ? { ...v, qtyOnHand: 2 } : v)
  ${extra}
`, { open })
const fresh = async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1400)
  await gotIt()
}
const logSs31 = async () => {
  await goHome()
  const row = page.locator('[data-testid="log-row"][aria-label="Log SS-31"]')
  if (!(await row.count())) throw new Error('SS-31 is not due today')
  await row.click()
  await page.waitForTimeout(700)
}

await fresh()

await step('a v24 save moves onto the open-vial model without losing what was left', async () => {
  // an old open vial: 4.2 mg left of 10 by the old running counter, three 1 mg logs since it was opened
  await setState(`
    raw.version = 24
    delete s.stockMigration
    delete s.stockAdjustments
    s.doseLogs = [1, 2, 3].map((n) => ({ id: 'old-' + n, peptideId: 'ss31', date: a.days[n], doseValue: 1, unit: 'mg', loggedAt: a.days[n] + 'T08:00:00.000Z' }))
    s.openVials.ss31 = { remainingMg: 4.2, vialMg: 10, batchId: 'vial-ss31', reconstitutedAt: a.days[0], activatedAt: a.days[0] + 'T00:00:00.000Z' }
  `, { days: [0, 1, 2, 3, 4, 5].map((n) => dayOffset(n - 5)) })
  await reload()
  const s = await state()
  const o = s.openVials.ss31
  if ('remainingMg' in o) throw new Error('the stored counter is still there')
  const adj = (o.adjustments || []).find((x) => x.reason === 'migration')
  if (!adj || Math.abs(adj.mg - (4.2 - 7)) > 1e-6) throw new Error(`no migration adjustment of -2.8 (${JSON.stringify(o.adjustments)})`)
  if (!s.stockMigration?.rows?.length) throw new Error('what the migration did was not kept')
  if (!(s.vials.length && s.vials.every((v) => 'addedAt' in v))) throw new Error('batches were not given an order')
  await goStock()
  const t = await page.locator('[data-testid="stock-group"][data-peptide="ss31"]').textContent()
  if (!/doses? left/.test(t)) throw new Error(`the row does not say doses left: ${t}`)
})

await step('Stock lists a row per compound, with doses left, sealed, run-out and order-by', async () => {
  await fresh()
  await goStock()
  const rows = page.locator('[data-testid="stock-group"]')
  if ((await rows.count()) < 5) throw new Error('too few rows')
  const first = await rows.first().textContent()
  if (!/sealed/.test(first)) throw new Error(`no sealed count: ${first}`)
  const lines = await page.locator('[data-testid="stock-order-line"]').allTextContents()
  if (!lines.some((l) => /Runs out .+ · Order by /.test(l))) throw new Error(`no run-out and order-by line: ${lines.slice(0, 3).join(' | ')}`)
  const txt = await page.locator('[data-testid="stock-room"]').textContent()
  if (/–/.test(txt)) throw new Error('an em dash in the Stock copy')
  if (!/Wasted this year: 0 mg/.test(txt)) throw new Error('no Wasted this year line')
  await noOverflow('Stock')
})

await step('a log that leaves too little for the next dose asks once: "This vial should be about empty. Start a new one?"', async () => {
  await seed(ss31Open())
  await reload()
  await logSs31()
  const p = page.locator('[data-testid="vial-prompt"]')
  await p.waitFor({ timeout: 4000 })
  const t = await p.textContent()
  if (!t.includes('This vial should be about empty. Start a new one?')) throw new Error(`wrong words: ${t}`)
  await noOverflow('the question')
})

await step('Still some left keeps the vial open and the question comes back at the next log', async () => {
  await page.click('[data-testid="vial-still"]')
  await page.waitForTimeout(400)
  if (await page.locator('[data-testid="vial-prompt"]').count()) throw new Error('the question is still showing')
  const s = await state()
  if (s.openVials.ss31.finished) throw new Error('the vial was finished')
  if ((s.openVials.ss31.stillSomeAt || []).length !== 1) throw new Error('"still some left" was not recorded')
  if (s.finishedVials.length) throw new Error('a finished vial was written')
})

await step('Yes finishes it, opens the oldest batch and shows the recipe; Mixed sets the mixed date', async () => {
  await seed(ss31Open(), `s.vials = s.vials.map((v) => v.peptideId === 'ss31' ? { ...v, addedAt: '2026-01-01T00:00:00.000Z', qtyOnHand: 2 } : v)`)
  await reload()
  await logSs31()
  await page.click('[data-testid="vial-yes"]')
  await page.locator('[data-testid="vial-recipe"]').waitFor({ timeout: 4000 })
  const recipe = await page.locator('[data-testid="vial-recipe"]').textContent()
  if (!/^Add 2 mL bacteriostatic water\. [\d.]+ units = 2\.5 mg$/.test(recipe)) throw new Error(`recipe: ${recipe}`)
  let s = await state()
  if (s.finishedVials.length !== 1 || s.finishedVials[0].reason !== 'empty') throw new Error('the old vial was not finished')
  if (s.openVials.ss31.needsMixing !== true || s.openVials.ss31.reconstitutedAt) throw new Error('the new vial should wait to be mixed')
  const left = s.vials.find((v) => v.peptideId === 'ss31').qtyOnHand
  if (left !== 1) throw new Error(`a sealed vial should have come off the shelf, ${left} left`)
  await page.click('[data-testid="vial-mixed"]')
  await page.waitForTimeout(400)
  s = await state()
  if (s.openVials.ss31.reconstitutedAt !== TODAY) throw new Error('Mixed did not set today')
  await noOverflow('the recipe')
})

await step('Undo (for ten seconds) puts the old vial and the shelf back', async () => {
  await seed(ss31Open())
  await reload()
  await logSs31()
  await page.click('[data-testid="vial-yes"]')
  await page.locator('[data-testid="vial-undo"]').waitFor({ timeout: 4000 })
  const label = await page.locator('[data-testid="vial-undo"]').textContent()
  if (!/Undo \((10|9)\)/.test(label)) throw new Error(`the Undo does not count from ten: ${label}`)
  await page.click('[data-testid="vial-undo"]')
  await page.waitForTimeout(400)
  const s = await state()
  if (s.finishedVials.length) throw new Error('the finished record was kept')
  if (s.openVials.ss31.vialMg !== 3 || s.openVials.ss31.finished) throw new Error('the old vial is not back')
  if (s.vials.find((v) => v.peptideId === 'ss31').qtyOnHand !== 2) throw new Error('the shelf was not restored')
})

await step('with nothing sealed left, Yes raises Out of stock on the Home bell, the More dot and the Stock row', async () => {
  await seed(ss31Open(), `s.vials = s.vials.map((v) => v.peptideId === 'ss31' ? { ...v, qtyOnHand: 0 } : v)`)
  await reload()
  await logSs31()
  await page.click('[data-testid="vial-yes"]')
  await page.locator('[data-testid="vial-out"]').waitFor({ timeout: 4000 })
  await page.click('[data-testid="vial-open-stock"]')
  await page.waitForTimeout(900)
  const row = await page.locator('[data-testid="stock-group"][data-peptide="ss31"]').textContent()
  if (!/Out of stock/.test(row) || !/Order now/.test(row)) throw new Error(`the row does not say so: ${row}`)
  if (!(await page.locator('[data-testid="more-low-dot"]').count())) throw new Error('no dot on More')
  await goHome()
  await page.click('[aria-label="Alerts"], [data-testid="alert-bell"]').catch(() => {})
  const body = await page.locator('body').textContent()
  if (!/SS-31 is out of stock\. Order it now\./.test(body)) throw new Error('not on the Home bell')
})

await step('a mixed vial at the end of its fridge life is asked about once, and Yes records the waste', async () => {
  await closeAll()
  await seed(ss31Open({ vialMg: 50, reconstitutedAt: dayOffset(-14), activatedAt: stamp(-14) }),
    `s.peptides = s.peptides.map((p) => p.id === 'ss31' ? { ...p, recon: { ...p.recon, expiryDays: 14 } } : p)`)
  await reload()
  const p = page.locator('[data-testid="vial-prompt"][data-kind="expired"]')
  await p.waitFor({ timeout: 4000 })
  const t = await p.textContent()
  if (!t.includes('Has this vial been thrown out? Start a new one?')) throw new Error(`wrong words: ${t}`)
  await page.click('[data-testid="vial-yes"]')
  await page.locator('[data-testid="vial-waste"]').waitFor({ timeout: 4000 })
  const s = await state()
  if (s.finishedVials[0]?.reason !== 'expired' || !(s.finishedVials[0].wasteMg > 49)) throw new Error('waste was not recorded')
  await page.click('[data-testid="vial-mixed"]')
  await goStock()
  const txt = await page.locator('[data-testid="stock-waste"]').textContent()
  if (!/Wasted this year: 50 mg \(1 vial\)/.test(txt)) throw new Error(`waste line: ${txt}`)
})

await step('Use by shows on the row three days before it goes off', async () => {
  await closeAll()
  await seed(ss31Open({ vialMg: 50, reconstitutedAt: dayOffset(-12), activatedAt: stamp(-12) }),
    `s.peptides = s.peptides.map((p) => p.id === 'ss31' ? { ...p, recon: { ...p.recon, expiryDays: 14 } } : p)`)
  await reload()
  await goStock()
  const t = await page.locator('[data-testid="stock-group"][data-peptide="ss31"] [data-testid="stock-use-by"]').textContent()
  if (!/^Use by \d{1,2} [A-Z][a-z]{2}$/.test(t)) throw new Error(`use by: ${t}`)
})

await step('the vial sheet adjusts what is left, marks a vial finished and keeps a history', async () => {
  await closeAll()
  await seed(ss31Open({ vialMg: 50 }))
  await reload()
  await goStock()
  await page.click('[data-testid="stock-group"][data-peptide="ss31"]')
  await page.locator('[data-testid="vial-sheet"]').waitFor()
  await noOverflow('the vial sheet')
  await page.click('[data-testid="adjust-open"]')
  await page.fill('[data-testid="adjust-value"]', '12.5')
  await page.click('[data-testid="adjust-save"]')
  await page.waitForTimeout(400)
  let s = await state()
  const adj = s.openVials.ss31.adjustments.at(-1)
  if (!adj || adj.reason !== 'adjusted' || Math.abs(adj.mg - (12.5 - 50)) > 1e-6) throw new Error(`adjustment: ${JSON.stringify(adj)}`)
  const left = await page.locator('[data-testid="open-left"]').textContent()
  if (!/12\.5 of 50 mg left/.test(left)) throw new Error(`left: ${left}`)
  await page.click('[data-testid="finish-open"]')
  await page.click('[data-testid="finish-open-yes"]')
  await page.waitForTimeout(500)
  s = await state()
  if (s.finishedVials.length !== 1 || s.finishedVials[0].reason !== 'manual') throw new Error('not finished by hand')
  // finishing shows what happened, with Undo for ten seconds; Done closes it
  await page.locator('[data-testid="vial-change"]').waitFor()
  if (!/Vial finished/.test(await page.locator('[data-testid="sheet"]').last().textContent())) throw new Error('no Vial finished')
  await page.locator('[data-testid="vial-change"] button:has-text("Done")').click()
  await page.waitForTimeout(500)
  if (!/Vial history/.test(await page.locator('[data-testid="vial-sheet"]').textContent())) throw new Error('no vial history')
  // finishing by hand with sealed vials on the shelf does not say out of stock
  const t = await page.locator('[data-testid="vial-sheet"]').textContent()
  if (/Out of stock/.test(t)) throw new Error('said out of stock with vials on the shelf')
  await page.click('[data-testid="open-a-vial"]')
  await page.locator('[data-testid="vial-recipe"]').waitFor({ timeout: 4000 })
})

await step('the weekly count lists batches, lets you correct one, and writes only the difference', async () => {
  await closeAll()
  await fresh()
  await goStock()
  await page.click('[data-testid="open-count"]')
  await page.locator('[data-testid="count-check"]').waitFor()
  await noOverflow('the count')
  if ((await page.locator('[data-testid="count-all-correct"]').textContent()).trim() !== 'All correct') throw new Error('no All correct')
  await page.locator('[data-testid="count-row"]').first().locator('button[aria-label="One fewer"]').click()
  if ((await page.locator('[data-testid="count-all-correct"]').textContent()).trim() !== 'Save counts') throw new Error('button did not change')
  await page.click('[data-testid="count-all-correct"]')
  await page.waitForTimeout(500)
  const s = await state()
  const counts = (s.stockAdjustments || []).filter((x) => x.reason === 'count check')
  if (counts.length !== 1 || counts[0].delta !== -1) throw new Error(`count adjustments: ${JSON.stringify(counts)}`)
  if (s.nativeState.countCheckOn !== TODAY) throw new Error('the week was not marked done')
})

await step('Order arrived adds vials with batch and price, and shows cost per mg and per dose', async () => {
  await closeAll()
  await goStock()
  const before = (await state()).vials.length
  await page.click('[data-testid="add-stock"]')
  await page.locator('[data-testid="stock-picker"]').waitFor()
  await page.fill('input[aria-label="Search compounds"]', 'SS-31')
  await page.waitForTimeout(500)
  await page.locator('[data-testid="stock-results"] button').first().click()
  await page.locator('[data-testid="stock-batch-form"]').waitFor()
  await page.fill('input[aria-label="Batch"]', 'B-77')
  await page.fill('[data-testid="batch-usd"]', '120')
  const cost = await page.locator('[data-testid="order-cost"]').textContent()
  if (!/per mg/.test(cost)) throw new Error(`no cost line: ${cost}`)
  await page.click('[data-testid="save-batch"]')
  await page.waitForTimeout(600)
  const s = await state()
  if (s.vials.length !== before + 1) throw new Error('the batch was not added')
  const added = s.vials.at(-1)
  if (added.lot !== 'B-77' || !added.addedAt) throw new Error(`batch: ${JSON.stringify(added)}`)
  if (!s.stockAdjustments.some((x) => x.reason === 'order arrived')) throw new Error('no order-arrived record')
})

await step('sealed batches: quantity moves by one, never below zero, with the reason kept; the price and a COA are kept', async () => {
  await closeAll()
  await fresh()
  await goStock()
  await page.click('[data-testid="stock-group"][data-peptide="ss31"]')
  const sheet = page.locator('[data-testid="vial-sheet"]')
  await sheet.waitFor()
  const row = sheet.locator('[data-testid="batch-row"]').first()
  const qty = async () => (await state()).vials.find((v) => v.peptideId === 'ss31').qtyOnHand
  const start = await qty()
  await row.locator('button[aria-label^="One more"]').click(); await page.waitForTimeout(250)
  if ((await qty()) !== start + 1) throw new Error('plus did not add one')
  for (let i = 0; i < start + 4; i++) { await row.locator('button[aria-label^="One fewer"]').click(); await page.waitForTimeout(80) }
  if ((await qty()) !== 0) throw new Error(`quantity went to ${await qty()}`)
  const s = await state()
  if (!s.stockAdjustments.some((x) => x.reason === 'adjusted' && x.delta === 1)) throw new Error('the change was not kept with its reason')
  // price
  await row.locator('[data-testid="vial-cost"]').click()
  await page.fill('input[aria-label="USD per vial"]', '150')
  await page.click('[data-testid="vial-price-save"]'); await page.waitForTimeout(300)
  if ((await state()).vials.find((v) => v.peptideId === 'ss31').usdPerVial !== 150) throw new Error('price not saved')
  // COA
  await row.locator('input[type="file"]').setInputFiles({ name: 'coa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') })
  await page.waitForTimeout(800)
  const v = (await state()).vials.find((x) => x.peptideId === 'ss31')
  if (!v.coaKey || v.coaMeta?.name !== 'coa.pdf') throw new Error('COA not attached')
  await reload()
  await goStock()
  await page.click('[data-testid="stock-group"][data-peptide="ss31"]')
  await page.locator('[data-testid="coa-view"]').waitFor({ timeout: 4000 })
})

console.log(errors.length ? `\n${errors.length} problem(s):\n` + errors.join('\n') : '\nno console errors')
await browser.close()
process.exit(failures || errors.some((e) => e.startsWith('pageerror') || e.startsWith('console')) ? 1 : 0)
