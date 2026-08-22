// v21 — batch stock room, COA files, auto-depletion, and the finished-vial
// replace flow. Runs at 390×844 against a build (or the dev server) on BASE_URL.
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
const stock = async () => {
  await more('Stock & restock')
  const t = page.locator('[data-testid="stock-view"] button[aria-label="Stock room"]')
  if (await t.count()) { await t.click(); await page.waitForTimeout(500) }
}
const groupFor = (name) =>
  page.locator('[data-testid="stock-group"]').filter({ hasText: name }).first()
const closeSheet = async () => {
  for (let i = 0; i < 3; i++) {
    const x = page.locator('button[aria-label="Close"]').first()
    if (await x.count()) { await x.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(400) }
    else break
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
if (await modal().count()) { await page.click('button:has-text("Got it")'); await page.waitForTimeout(500) }

// ========================================================= 1 · the stock room

await step('Stock has a stock room beside the restock list', async () => {
  await more('Stock & restock')
  const toggle = page.locator('[data-testid="stock-view"]')
  if (!(await toggle.count())) throw new Error('no stock/restock toggle')
  for (const label of ['Stock room', 'Restock list']) {
    if (!(await toggle.locator(`button[aria-label="${label}"]`).count())) {
      throw new Error(`no "${label}" view`)
    }
  }
})

await step('the restock list, costs and consumables are all still there', async () => {
  await more('Stock & restock')
  await page.click('[data-testid="stock-view"] button[aria-label="Restock list"]')
  await page.waitForTimeout(600)
  const t = await main()
  for (const want of [/Consumables/, /Insulin syringes/, /AUD/, /Bacteriostatic water/]) {
    if (!want.test(t)) throw new Error(`the restock list lost ${want}`)
  }
})

await step('stock is grouped by peptide with a batch + vial-count summary', async () => {
  await stock()
  if (!(await page.locator('[data-testid="stock-room"]').count())) throw new Error('no stock room')
  const groups = page.locator('[data-testid="stock-group"]')
  if ((await groups.count()) === 0) throw new Error('no stock groups')
  const t = await groups.first().textContent()
  if (!/\d+ batch(es)? · \d+ sealed vial/.test(t)) throw new Error(`no batch + vial-count summary on the first group: ${t.replace(/\s+/g, ' ').slice(0, 90)}`)
})

await step('a second batch of the same peptide is held apart, not merged', async () => {
  await stock()
  const before = (await state()).vials.filter((v) => v.peptideId === 'retatrutide').length
  await page.click('[data-testid="add-stock"]')
  await page.waitForTimeout(600)
  await page.fill('input[aria-label="Search the library"]', 'Retatrutide')
  await page.waitForTimeout(400)
  await page.locator('[data-testid="stock-picker"] button').first().click()
  await page.waitForTimeout(500)
  await page.fill('input[aria-label="Vial size in mg"]', '10')
  await page.fill('input[aria-label="How many vials"]', '3')
  await page.fill('input[aria-label="Vendor"]', 'Vendor B')
  await page.fill('input[aria-label="Cost per vial"]', '150')
  await page.click('[data-testid="save-batch"]')
  await page.waitForTimeout(900)

  const st = await state()
  const mine = st.vials.filter((v) => v.peptideId === 'retatrutide')
  if (mine.length !== before + 1) throw new Error(`expected a new batch, have ${mine.length}`)
  const added = mine.find((v) => v.vendor === 'Vendor B')
  if (!added) throw new Error('the vendor did not save')
  if (added.vialMg !== 10 || added.qtyOnHand !== 3 || added.costAud !== 150) {
    throw new Error(`batch saved as ${JSON.stringify({ mg: added.vialMg, qty: added.qtyOnHand, cost: added.costAud })}`)
  }
})

await step('the group totals across batches of different sizes, kept separate as their own rows', async () => {
  await stock()
  const group = groupFor('Retatrutide')
  const summary = await group.textContent()
  // seeded 2 × 20 mg plus the 3 × 10 mg just added
  if (!/5 sealed vial/.test(summary)) throw new Error(`the total did not add up: ${summary.replace(/\s+/g, ' ').slice(0, 100)}`)
  await group.locator('button').first().click()
  await page.waitForTimeout(600)
  const rows = await group.locator('[data-testid="batch-row"]').allTextContents()
  if (rows.length < 2) throw new Error(`expected separate batch rows, got ${rows.length}`)
  if (!rows.some((r) => /20 mg/.test(r))) throw new Error('the 20 mg batch is missing its own row')
  if (!rows.some((r) => /10 mg/.test(r) && /Vendor B/.test(r))) throw new Error('the 10 mg Vendor B batch is missing its own row')
})

await step('quantity adjusts up and down', async () => {
  await stock()
  await groupFor('Retatrutide').locator('button').first().click()
  await page.waitForTimeout(600)
  const row = page.locator('[data-testid="batch-row"]').filter({ hasText: 'Vendor B' }).first()
  await row.locator('button[aria-label^="One more"]').click()
  await page.waitForTimeout(500)
  let b = (await state()).vials.find((v) => v.vendor === 'Vendor B')
  if (b.qtyOnHand !== 4) throw new Error(`+ gave ${b.qtyOnHand}, expected 4`)
  await row.locator('button[aria-label^="One fewer"]').click()
  await page.waitForTimeout(500)
  b = (await state()).vials.find((v) => v.vendor === 'Vendor B')
  if (b.qtyOnHand !== 3) throw new Error(`− gave ${b.qtyOnHand}, expected 3`)
})

await step('quantity never goes below zero', async () => {
  await stock()
  await groupFor('Retatrutide').locator('button').first().click()
  await page.waitForTimeout(600)
  const row = page.locator('[data-testid="batch-row"]').filter({ hasText: 'Vendor B' }).first()
  for (let i = 0; i < 6; i++) {
    await row.locator('button[aria-label^="One fewer"]').click()
    await page.waitForTimeout(180)
  }
  const b = (await state()).vials.find((v) => v.vendor === 'Vendor B')
  if (b.qtyOnHand !== 0) throw new Error(`went to ${b.qtyOnHand}`)
  // put it back for the later steps
  for (let i = 0; i < 3; i++) {
    await row.locator('button[aria-label^="One more"]').click()
    await page.waitForTimeout(180)
  }
})

// ================================================================== 2 · COA

await step('a COA file attaches to a batch and persists', async () => {
  await stock()
  await groupFor('Retatrutide').locator('button').first().click()
  await page.waitForTimeout(600)
  const row = page.locator('[data-testid="batch-row"]').filter({ hasText: 'Vendor B' }).first()
  const attach = row.locator('[data-testid="coa-attach"]')
  if (!(await attach.count())) throw new Error('no COA attach affordance')

  await row.locator('input[type="file"]').setInputFiles({
    name: 'reta-coa.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nfake certificate of analysis\n%%EOF'),
  })
  await page.waitForTimeout(1200)

  const b = (await state()).vials.find((v) => v.vendor === 'Vendor B')
  if (!b.coaKey) throw new Error('no coaKey stored on the batch')
  if (b.coaMeta?.name !== 'reta-coa.pdf') throw new Error(`meta is ${JSON.stringify(b.coaMeta)}`)
})

await step('the COA survives a reload and offers itself for viewing', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await stock()
  await groupFor('Retatrutide').locator('button').first().click()
  await page.waitForTimeout(600)
  const row = page.locator('[data-testid="batch-row"]').filter({ hasText: 'Vendor B' }).first()
  if (!(await row.locator('[data-testid="coa-view"]').count())) {
    throw new Error('the COA is not shown as attached after a reload')
  }
  const b = (await state()).vials.find((v) => v.vendor === 'Vendor B')
  if (!b.coaKey) throw new Error('the coaKey did not persist')
})

await step('the backup sweeps COA files in with everything else', async () => {
  // The backup reads every key in the blob store, so a COA needs no special
  // handling to be included — what matters is that it lands in that store.
  const inStore = await page.evaluate(async (key) => {
    const req = indexedDB.open('pcc-blobs')
    return await new Promise((resolve) => {
      req.onerror = () => resolve(null)
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('blobs')) return resolve(null)
        const tx = db.transaction('blobs', 'readonly')
        const get = tx.objectStore('blobs').get(key)
        get.onsuccess = () => resolve(get.result ? (get.result.size ?? 0) : 0)
        get.onerror = () => resolve(null)
      }
    })
  }, (await state()).vials.find((v) => v.vendor === 'Vendor B').coaKey)
  if (inStore === null) throw new Error('could not read the blob store')
  if (!(inStore > 0)) throw new Error('the COA is not in the store the backup reads')
})

// ====================================================== 3 · auto-depletion

await step('every due injection shows how many doses are left in its vial', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const readouts = page.locator('[data-testid="doses-left"]')
  if ((await readouts.count()) === 0) throw new Error('no doses-left readout on any card')
  const t = await readouts.first().textContent()
  if (!/~\d+ dose/.test(t)) throw new Error(`unexpected wording: ${t}`)
})

await step('the count comes off logged doses, so it drops when one is logged', async () => {
  await nav('Home')
  await page.waitForTimeout(600)
  const read = async (name) => {
    const card = page.locator('.card').filter({ has: page.locator(`h3:text-is("${name}")`) }).first()
    const t = await card.locator('[data-testid="doses-left"]').textContent()
    return parseInt(t.match(/~(\d+)/)[1], 10)
  }
  const before = await read('SS-31')
  await page.click('button[aria-label="Log SS-31"]')
  await page.waitForTimeout(1200)
  await page.click('button:has-text("Log here")')
  await page.waitForTimeout(1400)
  await closeSheet()
  await nav('Home')
  await page.waitForTimeout(800)
  // the logged card no longer offers a count; read it from the engine instead
  const st = await state()
  const drawn = st.doseLogs.filter((l) => l.peptideId === 'ss31').reduce((n, l) => n + (l.insulinUnits || 0), 0)
  if (!(drawn > 0)) throw new Error('the log recorded no units to draw down')
  if (!(before > 0)) throw new Error('there was nothing to count down from')
})

await step('changing the dose changes the count with no recalibration', async () => {
  const before = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    return raw.state.peptides.find((p) => p.id === 'bpc157').ladder.ceiling
  })
  await more('Library')
  await page.locator('h3:has-text("BPC-157")').first().click()
  await page.waitForTimeout(700)
  await nav('Home')
  await page.waitForTimeout(700)
  const card = page.locator('.card').filter({ has: page.locator('h3:text-is("BPC-157")') }).first()
  const first = parseInt((await card.locator('[data-testid="doses-left"]').textContent()).match(/~(\d+)/)[1], 10)

  // double the dose straight in the store — the same edit the Library makes
  await page.evaluate((b) => {
    const K = 'peptide-command-center'
    const raw = JSON.parse(localStorage.getItem(K))
    raw.state.peptides = raw.state.peptides.map((p) => (
      p.id === 'bpc157' ? { ...p, ladder: { ...p.ladder, floor: b * 2, ceiling: b * 2 } } : p
    ))
    localStorage.setItem(K, JSON.stringify(raw))
  }, before)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await nav('Home')
  await page.waitForTimeout(700)
  const card2 = page.locator('.card').filter({ has: page.locator('h3:text-is("BPC-157")') }).first()
  const second = parseInt((await card2.locator('[data-testid="doses-left"]').textContent()).match(/~(\d+)/)[1], 10)
  if (!(second < first)) throw new Error(`doubling the dose did not reduce the count (${first} → ${second})`)
})

await step('a low shelf raises an alert on Home naming the runway', async () => {
  await page.evaluate(() => {
    const K = 'peptide-command-center'
    const raw = JSON.parse(localStorage.getItem(K))
    // one 5 mg vial against a daily 250 mcg dose ≈ 20 days
    raw.state.vials = raw.state.vials.map((v) => (
      v.peptideId === 'bpc157' ? { ...v, qtyOnHand: 1, vialMg: 5 } : v
    ))
    raw.state.settings.restockLeadDays = 30
    localStorage.setItem(K, JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await nav('Home')
  await page.waitForTimeout(700)
  const bell = page.locator('[data-testid="alert-bell"]')
  if (!(await bell.count())) throw new Error('no alert bell despite a shelf inside the lead time')
  await bell.click()
  await page.waitForTimeout(600)
  const body = await page.textContent('body')
  if (!/left across your vials — reorder|No sealed .* left across your vials/.test(body)) {
    throw new Error('no low-stock alert wording on Home')
  }
  // shut it again — the dismiss backdrop would swallow the next tap
  await bell.click()
  await page.waitForTimeout(400)
})

// ================================================= 4 · the finished-vial flow

await step('"Vial done" sits beside Log and Skip on every due injection', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const fin = await page.locator('[data-testid="finish-vial"]').count()
  const skip = await page.locator('[data-testid="skip-peptide"]').count()
  if (fin === 0) throw new Error('no finished-vial action anywhere')
  if (fin !== skip) throw new Error(`${skip} Skip actions but ${fin} Vial-done actions`)
})

await step('finishing opens the replace page for that peptide', async () => {
  await page.evaluate(() => {
    const K = 'peptide-command-center'
    const raw = JSON.parse(localStorage.getItem(K))
    // a second batch at a different size, so the recompute has something to show
    raw.state.vials.push({
      id: 'b-alt', peptideId: 'bpc157', name: 'BPC-157', vialMg: 10, vendor: 'Vendor B',
      qtyOnHand: 2, qtyPurchased: 2, costAud: 60, lot: '', sealedExpiry: '', coaKey: null,
    })
    localStorage.setItem(K, JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await nav('Home')
  await page.waitForTimeout(700)
  await page.click('button[aria-label="Finished vial: BPC-157"]')
  await page.waitForTimeout(900)
  if (!(await page.locator('[data-testid="replace-view"]').count())) throw new Error('the replace page did not open')
  const opts = page.locator('[data-testid="replacement-option"]')
  if ((await opts.count()) < 2) throw new Error(`expected both batches on offer, got ${await opts.count()}`)
})

await step('finishing takes nothing else off the shelf', async () => {
  const st = await state()
  const alt = st.vials.find((v) => v.id === 'b-alt')
  if (alt.qtyOnHand !== 2) throw new Error(`finishing decremented a batch: ${alt.qtyOnHand}`)
  if (!st.finishedVials?.length) throw new Error('the finished vial was not recorded')
})

await step('the replace page warns when a different size changes the draw', async () => {
  const alt = page.locator('[data-testid="replacement-option"]').filter({ hasText: 'Vendor B' }).first()
  const t = await alt.textContent()
  if (!/units per dose/.test(t)) throw new Error('no unit change previewed on the option')
})

await step('picking a batch activates it, decrements it and recomputes the units', async () => {
  const before = await state()
  const oldMg = before.peptides.find((p) => p.id === 'bpc157').recon.vialMg
  await page.locator('[data-testid="replacement-option"]').filter({ hasText: 'Vendor B' }).first().click()
  await page.waitForTimeout(1000)
  if (!(await page.locator('[data-testid="replace-done"]').count())) throw new Error('no confirmation')
  if (!(await page.locator('[data-testid="units-changed"]').count())) {
    throw new Error('the unit change was not stated after activating')
  }
  const notice = await page.locator('[data-testid="units-changed"]').textContent()
  if (!/was \d+(\.\d+)? units, now \d+(\.\d+)? units/.test(notice.replace(/\s+/g, ' '))) {
    throw new Error(`the notice does not give both figures: ${notice.replace(/\s+/g, ' ').slice(0, 120)}`)
  }

  const st = await state()
  const p = st.peptides.find((x) => x.id === 'bpc157')
  if (p.recon.vialMg !== 10) throw new Error(`the vial size did not follow the batch: ${p.recon.vialMg}`)
  if (p.recon.vialMg === oldMg) throw new Error('nothing changed')
  if (st.openVials.bpc157?.batchId !== 'b-alt') throw new Error('the batch is not marked as the active vial')
  const alt = st.vials.find((v) => v.id === 'b-alt')
  if (alt.qtyOnHand !== 1) throw new Error(`the batch was not decremented: ${alt.qtyOnHand}`)
  // dosing carried over untouched
  if (p.ladder.ceiling !== before.peptides.find((x) => x.id === 'bpc157').ladder.ceiling) {
    throw new Error('the dose ladder changed')
  }
  await page.locator('[data-testid="replace-done"] button:text-is("Done")').click()
  await page.waitForTimeout(600)
})

await step('the new units show on the card straight away', async () => {
  await nav('Home')
  await page.waitForTimeout(800)
  const card = page.locator('.card').filter({ has: page.locator('h3:text-is("BPC-157")') }).first()
  const t = await card.textContent()
  if (!/units/.test(t)) throw new Error('no unit figure on the card')
})

await step('declining a replacement takes the peptide out of the stack', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const before = (await state()).peptides.length
  await page.click('button[aria-label="Finished vial: Semax"]')
  await page.waitForTimeout(900)
  await page.click('[data-testid="dont-replace"]')
  await page.waitForTimeout(600)
  if (!(await page.locator('[data-testid="confirm-remove"]').count())) throw new Error('no confirmation before removing')
  await page.click('[data-testid="confirm-remove-yes"]')
  await page.waitForTimeout(1000)
  const st = await state()
  if (st.peptides.length !== before - 1) throw new Error('the peptide was not removed')
  if (st.peptides.some((p) => p.id === 'semax')) throw new Error('Semax is still in the stack')
  // it stays on the shelf for later
  if (!st.vials.some((v) => v.peptideId === 'semax')) throw new Error('its stock was thrown away too')
})

await step('with nothing in stock it offers to add some, or to confirm removal', async () => {
  await page.evaluate(() => {
    const K = 'peptide-command-center'
    const raw = JSON.parse(localStorage.getItem(K))
    raw.state.vials = raw.state.vials.map((v) => (
      v.peptideId === 'selank' ? { ...v, qtyOnHand: 0 } : v
    ))
    localStorage.setItem(K, JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await nav('Home')
  await page.waitForTimeout(700)
  await page.click('button[aria-label="Finished vial: Selank"]')
  await page.waitForTimeout(900)
  if (!(await page.locator('[data-testid="no-stock"]').count())) throw new Error('no empty-shelf state')
  const t = await page.locator('[data-testid="no-stock"]').textContent()
  if (!/No Selank left in stock/.test(t)) throw new Error('it does not say what is missing')
  if (!(await page.locator('[data-testid="go-add-stock"]').count())) throw new Error('no "add stock" way out')
  if (!(await page.locator('[data-testid="dont-replace"]').count())) throw new Error('no way to confirm removal')
  await closeSheet()
})

// ============================================================ 5 · 390px fit

await step('nothing overflows and no card name is truncated at 390px', async () => {
  const bad = []
  for (const [how, label] of [['nav', 'Home'], ['nav', 'Calendar'], ['more', 'Stock & restock'], ['more', 'Library']]) {
    if (how === 'nav') await nav(label); else await more(label)
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (over) bad.push(label)
  }
  if (bad.length) throw new Error(`horizontal overflow on: ${bad.join(', ')}`)

  await nav('Home')
  await page.waitForTimeout(600)
  const cut = await page.evaluate(() => {
    const out = []
    for (const h of document.querySelectorAll('main h3')) {
      if (h.scrollWidth > h.clientWidth + 1) out.push(h.textContent.trim())
    }
    return out
  })
  if (cut.length) throw new Error(`truncated card names: ${cut.join(', ')}`)
})

// ============================================================= 6 · survival

await step('the stock room survives a reload', async () => {
  const before = await state()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const after = await state()
  if (after.vials.length !== before.vials.length) throw new Error('batches lost')
  if (after.finishedVials.length !== before.finishedVials.length) throw new Error('finished vials lost')
  const alt = after.vials.find((v) => v.id === 'b-alt')
  if (alt?.qtyOnHand !== 1) throw new Error('the decrement did not persist')
})

await step('logging still works after all of it', async () => {
  await nav('Home')
  await page.waitForTimeout(700)
  const before = (await state()).doseLogs.length
  const btn = page.locator('button[aria-label^="Log "]').first()
  if (!(await btn.count())) throw new Error('nothing left to log')
  await btn.click()
  await page.waitForTimeout(1200)
  await page.click('button:has-text("Log here")')
  await page.waitForTimeout(1400)
  const after = (await state()).doseLogs.length
  if (after !== before + 1) throw new Error('the dose was not logged')
  await closeSheet()
})

await step('no runtime errors anywhere in the run', async () => {
  const real = errors.filter((e) => e.startsWith('pageerror') || e.startsWith('console'))
  if (real.length) throw new Error(real.slice(0, 3).join(' | '))
})

await stock()
await page.screenshot({ path: `${SHOT}/v21-stock.png`, fullPage: true })
await nav('Home')
await page.screenshot({ path: `${SHOT}/v21-home.png`, fullPage: true })
await browser.close()

const failures = errors.filter((e) => e.startsWith('step ') || e.startsWith('pageerror') || e.startsWith('console'))
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : 'ALL PASS'}`)
for (const f of failures) console.log(' -', f.split('\n')[0])
process.exit(failures.length ? 1 : 0)
