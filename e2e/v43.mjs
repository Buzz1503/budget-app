// v43 — Supplies and equipment inventory.
//
// Walks the verify list at 390x844. Most steps read the store after driving the
// UI, because the claims are about what was recorded: a swap decrementing the
// right spare, a duplicate not creating a row, peptide stock not moving. The
// backup step goes through the real Back up and Restore buttons, not around them.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SEED = JSON.parse(readFileSync(new URL('../src/data/supplies_inventory.json', import.meta.url), 'utf8'))
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

let failures = 0
const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { failures++; console.log('FAIL', name, '—', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
}

const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const setState = (fn, arg) => page.evaluate(([f, a]) => {
  const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
  // eslint-disable-next-line no-new-func
  new Function('s', 'a', f)(raw.state, a)
  localStorage.setItem('peptide-command-center', JSON.stringify(raw))
}, [fn, arg])
const gotIt = async () => {
  const b = page.locator('button:has-text("Got it")')
  if (!(await b.count())) return
  try { await b.first().click({ timeout: 3000 }) } catch { /* left alone */ }
  await page.waitForTimeout(400)
}
const reload = async () => {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1400)
  await gotIt()
}
const closeAll = async () => {
  await gotIt()
  for (let i = 0; i < 5; i++) {
    if (!(await page.locator('[data-testid="sheet"]').count())) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  }
}
const gear = async () => {
  await closeAll()
  await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(600)
  await page.click('[data-testid="more-gear"]'); await page.waitForTimeout(700)
}
const noOverflow = async (where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 391) throw new Error(`${where} overflows to ${w}px`)
}
const items = async () => (await state()).gearItems
const find = async (pred) => (await items()).find(pred)
const rowOf = (id) => page.locator(`[data-testid="gear-row-${id}"]`)
const selectOptions = (testId) => page.$$eval(`[data-testid="${testId}"] option`, (os) => os.map((o) => o.value))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('nav button')
await page.waitForTimeout(1300)
await gotIt()

// everything that is not supplies, as it is before anything below runs
const NOT_GEAR = ['peptides', 'vials', 'openVials', 'doseLogs', 'titration', 'doseEvents', 'skips', 'pushes', 'pauses', 'finishedVials', 'sharedDraws', 'runs']
const stockSnapshot = async () => {
  const s = await state()
  return JSON.stringify(Object.fromEntries(NOT_GEAR.map((k) => [k, s[k]])))
}
const stockBefore = await stockSnapshot()

// ===================================================== 1 · the screen and the seed

await step('1 · Supplies opens under More, split In use / Spare stock with category headings', async () => {
  await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(600)
  // alongside Stock, in the same list
  const links = await page.$$eval('[data-testid^="more-"]', (els) => els.map((e) => e.dataset.testid))
  if (links.indexOf('more-gear') !== links.indexOf('more-supplies') + 1) throw new Error(`Supplies is not next to Stock: ${links.join(', ')}`)
  await page.click('[data-testid="more-gear"]'); await page.waitForTimeout(800)
  if (!(await page.locator('[data-testid="gear-screen"]').count())) throw new Error('the screen did not open')
  await noOverflow('Supplies')

  const inUse = page.locator('[data-testid="gear-in-use"]')
  const stock = page.locator('[data-testid="gear-stock"]')
  const heads = async (loc) => loc.locator('h3').evaluateAll((els) => els.map((e) => e.textContent))
  const a = await heads(inUse)
  const b = await heads(stock)
  const wantIn = ['Pen needles', 'Syringe needles', 'Syringes', 'Swabs & prep', 'Sharps disposal']
  const wantStock = ['Pen needles', 'Syringe needles']
  if (JSON.stringify(a) !== JSON.stringify(wantIn)) throw new Error(`in use headings are ${JSON.stringify(a)}`)
  if (JSON.stringify(b) !== JSON.stringify(wantStock)) throw new Error(`spare headings are ${JSON.stringify(b)}`)
  console.log(`  in use: ${a.join(', ')} | spare: ${b.join(', ')}`)
})

await step('1b · every item in the seed file is there, with its quantity and state', async () => {
  const got = await items()
  if (got.length !== SEED.items.length) throw new Error(`${got.length} items stored, the file has ${SEED.items.length}`)
  SEED.items.forEach((raw, i) => {
    const g = got[i]
    const checks = [
      ['category', g.category, raw.category], ['status', g.status, raw.status], ['qty', g.qty, raw.qty], ['unit', g.unit, raw.unit],
      ['gauge', g.gauge, raw.gauge], ['length', g.lengthMm, raw.length_mm], ['type', g.syringeType, raw.syringe_type], ['name', g.name, raw.name],
      ['verify', !!g.verify, !!raw.verify],
    ]
    for (const [field, have, want] of checks) {
      if (have !== want && !(have === undefined && want === undefined)) throw new Error(`item ${i + 1} ${field}: ${JSON.stringify(have)} vs ${JSON.stringify(want)}`)
    }
  })
  const rowsIn = await page.locator('[data-testid="gear-in-use"] [data-status="in_use"]').count()
  const rowsStock = await page.locator('[data-testid="gear-stock"] [data-status="stock"]').count()
  const wantIn = SEED.items.filter((x) => x.status === 'in_use').length
  const wantStock = SEED.items.filter((x) => x.status === 'stock').length
  if (rowsIn !== wantIn || rowsStock !== wantStock) throw new Error(`rows ${rowsIn}/${rowsStock}, expected ${wantIn}/${wantStock}`)
  console.log(`  ${got.length} items match the file; ${rowsIn} in use, ${rowsStock} spare`)
})

// ====================================================== 2 · adding, with dropdowns

await step('2 · adding uses dropdowns, with the file\'s lists, and the right default syringe', async () => {
  await page.click('[data-testid="gear-add"]'); await page.waitForTimeout(700)
  await noOverflow('add sheet')

  await page.selectOption('[data-testid="gear-category"]', 'Pen needles')
  for (const id of ['gear-field-gauge', 'gear-field-lengthMm', 'gear-unit']) {
    const tag = await page.$eval(`[data-testid="${id}"]`, (e) => e.tagName)
    if (tag !== 'SELECT') throw new Error(`${id} is a ${tag}, not a dropdown`)
  }
  const pg = (await selectOptions('gear-field-gauge')).filter((v) => v && v !== '__add__')
  const pl = (await selectOptions('gear-field-lengthMm')).filter((v) => v && v !== '__add__')
  if (JSON.stringify(pg) !== JSON.stringify(SEED.options.pen_needle_gauge)) throw new Error(`pen gauges ${pg}`)
  if (JSON.stringify(pl) !== JSON.stringify(SEED.options.pen_needle_length_mm.map(String))) throw new Error(`pen lengths ${pl}`)

  await page.selectOption('[data-testid="gear-category"]', 'Syringe needles')
  const sg = (await selectOptions('gear-field-gauge')).filter((v) => v && v !== '__add__')
  const sl = (await selectOptions('gear-field-lengthMm')).filter((v) => v && v !== '__add__')
  if (JSON.stringify(sg) !== JSON.stringify(SEED.options.syringe_needle_gauge)) throw new Error(`syringe gauges ${sg}`)
  if (JSON.stringify(sl) !== JSON.stringify(SEED.options.syringe_needle_length_mm.map(String))) throw new Error(`syringe lengths ${sl}`)

  await page.selectOption('[data-testid="gear-category"]', 'Syringes')
  const type = await page.$eval('[data-testid="gear-field-syringeType"]', (e) => e.value)
  const vol = await page.$eval('[data-testid="gear-field-volumeMl"]', (e) => e.value)
  if (type !== 'Luer lock 1 mL low dead space') throw new Error(`the default syringe is "${type}"`)
  if (vol !== '1') throw new Error(`the default volume is "${vol}"`)
  const types = (await selectOptions('gear-field-syringeType')).filter((v) => v && v !== '__add__')
  if (JSON.stringify(types) !== JSON.stringify(SEED.options.syringe_type)) throw new Error(`syringe types ${types}`)
  const vols = (await selectOptions('gear-field-volumeMl')).filter((v) => v && v !== '__add__')
  if (JSON.stringify(vols) !== JSON.stringify(SEED.options.syringe_volume_ml.map(String))) throw new Error(`volumes ${vols}`)
  const units = (await selectOptions('gear-unit')).filter((v) => v && v !== '__add__')
  if (JSON.stringify(units) !== JSON.stringify(SEED.options.unit)) throw new Error(`units ${units}`)
  console.log('  gauge, length, type, volume and unit are all dropdowns from the file; default syringe is Luer lock 1 mL low dead space')
})

await step('2b · Other takes free text', async () => {
  await page.selectOption('[data-testid="gear-category"]', 'Other')
  const tag = await page.$eval('[data-testid="gear-field-name"]', (e) => e.tagName)
  if (tag !== 'INPUT') throw new Error(`the Other name is a ${tag}`)
  await page.fill('[data-testid="gear-field-name"]', 'Tourniquet')
  await page.selectOption('[data-testid="gear-unit"]', 'each')
  await page.click('[data-testid="gear-status-in_use"]')
  await page.click('[data-testid="gear-save"]'); await page.waitForTimeout(700)
  const it = await find((i) => i.name === 'Tourniquet')
  if (!it) throw new Error('the Other item was not saved')
  if (it.category !== 'Other' || it.status !== 'in_use') throw new Error(`saved as ${it.category}/${it.status}`)
  if (!(await rowOf(it.id).count())) throw new Error('the item is not on screen')
})

await step('2c · a new needle is added with dropdowns and appears under Spare stock', async () => {
  await page.click('[data-testid="gear-add"]'); await page.waitForTimeout(600)
  await page.selectOption('[data-testid="gear-category"]', 'Pen needles')
  await page.selectOption('[data-testid="gear-field-gauge"]', '33G')
  await page.selectOption('[data-testid="gear-field-lengthMm"]', '5')
  await page.fill('[data-testid="gear-qty"]', '2')
  await page.fill('[data-testid="gear-brand"]', 'NovoFine')
  await page.fill('[data-testid="gear-vendor"]', 'Chemist')
  await page.fill('[data-testid="gear-cost"]', '12.5')
  await page.fill('[data-testid="gear-note"]', 'Plus tip')
  await page.click('[data-testid="gear-save"]'); await page.waitForTimeout(700)
  const it = await find((i) => i.gauge === '33G' && i.lengthMm === 5)
  if (!it) throw new Error('not saved')
  if (it.status !== 'stock' || it.qty !== 2 || it.unit !== 'box') throw new Error(`saved as ${it.status} ${it.qty} ${it.unit}`)
  if (it.brand !== 'NovoFine' || it.vendor !== 'Chemist' || it.cost !== 12.5 || it.note !== 'Plus tip') throw new Error('an optional field was lost')
  const inStock = await page.locator(`[data-testid="gear-stock"] [data-testid="gear-row-${it.id}"]`).count()
  if (!inStock) throw new Error('not under Spare stock')
})

await step('2d · adding what already exists offers to top it up instead of a second row', async () => {
  const n = (await items()).length
  const before = await find((i) => i.gauge === '33G' && i.lengthMm === 5)
  await page.click('[data-testid="gear-add"]'); await page.waitForTimeout(600)
  await page.selectOption('[data-testid="gear-category"]', 'Pen needles')
  await page.selectOption('[data-testid="gear-field-gauge"]', '33G')
  await page.selectOption('[data-testid="gear-field-lengthMm"]', '5')
  await page.fill('[data-testid="gear-qty"]', '3')
  await page.click('[data-testid="gear-save"]'); await page.waitForTimeout(500)
  if (!(await page.locator('[data-testid="gear-dup"]').count())) throw new Error('no duplicate prompt')
  await page.click('[data-testid="gear-dup-merge"]'); await page.waitForTimeout(700)
  const after = await items()
  if (after.length !== n) throw new Error(`a row was added (${n} -> ${after.length})`)
  const now = after.find((i) => i.id === before.id)
  if (now.qty !== before.qty + 3) throw new Error(`quantity ${before.qty} -> ${now.qty}, expected ${before.qty + 3}`)
})

await step('2e · a spare and an in-use box of the same needle are not duplicates of each other', async () => {
  const n = (await items()).length
  await page.click('[data-testid="gear-add"]'); await page.waitForTimeout(600)
  await page.selectOption('[data-testid="gear-category"]', 'Pen needles')
  await page.selectOption('[data-testid="gear-field-gauge"]', '33G')
  await page.selectOption('[data-testid="gear-field-lengthMm"]', '5')
  await page.click('[data-testid="gear-status-in_use"]')
  await page.click('[data-testid="gear-save"]'); await page.waitForTimeout(700)
  if (await page.locator('[data-testid="gear-dup"]').count()) throw new Error('the pair was treated as a duplicate')
  if ((await items()).length !== n + 1) throw new Error('the in-use row was not added')
})

// ============================================== 3 · edit, delete, add an option

await step('3 · every field can be edited after adding', async () => {
  const it = await find((i) => i.gauge === '33G' && i.status === 'stock')
  await page.click(`[data-testid="gear-edit-${it.id}"]`); await page.waitForTimeout(600)
  await page.selectOption('[data-testid="gear-field-gauge"]', '31G')
  await page.selectOption('[data-testid="gear-field-lengthMm"]', '8')
  await page.fill('[data-testid="gear-qty"]', '7')
  await page.selectOption('[data-testid="gear-unit"]', 'pack')
  await page.fill('[data-testid="gear-brand"]', 'BD')
  await page.fill('[data-testid="gear-vendor"]', 'Online')
  await page.fill('[data-testid="gear-cost"]', '9')
  await page.fill('[data-testid="gear-note"]', 'edited')
  await page.click('[data-testid="gear-save"]'); await page.waitForTimeout(700)
  const now = await find((i) => i.id === it.id)
  const want = { gauge: '31G', lengthMm: 8, qty: 7, unit: 'pack', brand: 'BD', vendor: 'Online', cost: 9, note: 'edited' }
  for (const [k, v] of Object.entries(want)) if (now[k] !== v) throw new Error(`${k} is ${JSON.stringify(now[k])}, expected ${JSON.stringify(v)}`)
})

await step('3b · a category change keeps no fields from the old one', async () => {
  const it = await find((i) => i.gauge === '31G' && i.status === 'stock')
  await page.click(`[data-testid="gear-edit-${it.id}"]`); await page.waitForTimeout(600)
  await page.selectOption('[data-testid="gear-category"]', 'Syringes')
  await page.click('[data-testid="gear-save"]'); await page.waitForTimeout(700)
  const now = await find((i) => i.id === it.id)
  if (now.category !== 'Syringes') throw new Error(`category is ${now.category}`)
  if (now.gauge !== undefined || now.lengthMm !== undefined) throw new Error(`stale needle fields remain: ${now.gauge} ${now.lengthMm}`)
  if (now.syringeType !== 'Luer lock 1 mL low dead space') throw new Error(`type is ${now.syringeType}`)
})

await step('3c · a missing option can be added to a dropdown and used straight away', async () => {
  await page.click('[data-testid="gear-add"]'); await page.waitForTimeout(600)
  await page.selectOption('[data-testid="gear-category"]', 'Pen needles')

  // a length that is not in the file's list
  await page.selectOption('[data-testid="gear-field-lengthMm"]', '__add__')
  await page.fill('[data-testid="gear-field-lengthMm-new"]', 'abc')
  await page.click('[data-testid="gear-field-lengthMm-add"]'); await page.waitForTimeout(300)
  if (!(await page.locator('text=not a value this list can take').count())) throw new Error('an invalid length was not refused')
  await page.fill('[data-testid="gear-field-lengthMm-new"]', '7')
  await page.click('[data-testid="gear-field-lengthMm-add"]'); await page.waitForTimeout(400)
  const opts = (await selectOptions('gear-field-lengthMm')).filter((v) => v && v !== '__add__')
  if (!opts.includes('7')) throw new Error(`7 is not offered: ${opts}`)
  const picked = await page.$eval('[data-testid="gear-field-lengthMm"]', (e) => e.value)
  if (picked !== '7') throw new Error(`7 was not selected (${picked})`)
  if (JSON.stringify(opts) !== JSON.stringify(['4', '5', '6', '7', '8', '10', '12'])) throw new Error(`not in numeric order: ${opts}`)

  // a gauge typed as "28" is stored as 28G
  await page.selectOption('[data-testid="gear-category"]', 'Syringe needles')
  await page.selectOption('[data-testid="gear-field-gauge"]', '__add__')
  await page.fill('[data-testid="gear-field-gauge-new"]', '28')
  await page.click('[data-testid="gear-field-gauge-add"]'); await page.waitForTimeout(400)
  const gauge = await page.$eval('[data-testid="gear-field-gauge"]', (e) => e.value)
  if (gauge !== '28G') throw new Error(`the new gauge is "${gauge}"`)

  const s = await state()
  if (!s.gearOptions.pen_needle_length_mm?.includes(7)) throw new Error('the new length was not saved for next time')
  if (!s.gearOptions.syringe_needle_gauge?.includes('28G')) throw new Error('the new gauge was not saved for next time')
  await closeAll()
})

await step('3d · an item can be deleted, behind a confirm', async () => {
  const it = await find((i) => i.name === 'Tourniquet')
  const n = (await items()).length
  await page.click(`[data-testid="gear-edit-${it.id}"]`); await page.waitForTimeout(600)
  await page.click('[data-testid="gear-delete"]'); await page.waitForTimeout(300)
  if ((await items()).length !== n) throw new Error('it was deleted before the confirm')
  await page.click('[data-testid="gear-delete-confirm"]'); await page.waitForTimeout(700)
  if ((await items()).length !== n - 1) throw new Error('it was not deleted')
  if (await rowOf(it.id).count()) throw new Error('the row is still on screen')
})

// =========================================================== 5 · flags and prompts

await step('5 · low stock flags the in-use boxes with no spare, and only those', async () => {
  await reload(); await gear()
  const all = await items()
  const flagged = await page.$$eval('[data-testid^="gear-low-"]:not([data-testid="gear-low-summary"])', (els) => els.map((e) => e.dataset.testid.slice(9)))
  const expected = all.filter((i) => i.status === 'in_use' && !all.some((s) => s.status === 'stock' && s.qty > 0 && s.category === i.category
    && s.gauge === i.gauge && s.lengthMm === i.lengthMm && s.syringeType === i.syringeType && s.name === i.name)).map((i) => i.id)
  if (JSON.stringify([...flagged].sort()) !== JSON.stringify([...expected].sort())) throw new Error(`flagged ${flagged.length}, expected ${expected.length}`)
  if (!flagged.length) throw new Error('nothing was flagged')
  // 25G x 13 has a spare behind it; 29G x 13 has none
  const has = all.find((i) => i.status === 'in_use' && i.gauge === '25G' && i.lengthMm === 13)
  const hasnt = all.find((i) => i.status === 'in_use' && i.gauge === '29G' && i.lengthMm === 13)
  if (flagged.includes(has.id)) throw new Error('25G x 13 is flagged but has a spare')
  if (!flagged.includes(hasnt.id)) throw new Error('29G x 13 is not flagged but has no spare')
  console.log(`  ${flagged.length} of ${all.filter((i) => i.status === 'in_use').length} in use flagged`)
})

await step('5b · verify-flagged items ask for confirmation until edited or dismissed', async () => {
  const flagged = (await items()).filter((i) => i.verify)
  if (flagged.length !== 3) throw new Error(`${flagged.length} items need confirming, the file flags 3`)
  for (const f of flagged) {
    if (!(await page.locator(`[data-testid="gear-verify-${f.id}"]`).count())) throw new Error(`no prompt on ${f.id}`)
  }
  const text = await page.locator(`[data-testid="gear-verify-${flagged[0].id}"]`).innerText()
  if (!/Confirm quantity/.test(text)) throw new Error('the prompt does not say what it wants')
  if (!/confirm gauge and quantity/.test(text)) throw new Error('the note that explains why is missing')

  // dismiss one
  await page.click(`[data-testid="gear-confirm-${flagged[0].id}"]`); await page.waitForTimeout(400)
  if (await page.locator(`[data-testid="gear-verify-${flagged[0].id}"]`).count()) throw new Error('"Looks right" did not clear the prompt')
  if ((await find((i) => i.id === flagged[0].id)).qty !== flagged[0].qty) throw new Error('dismissing changed the quantity')

  // editing another clears it too
  await page.click(`[data-testid="gear-edit-${flagged[1].id}"]`); await page.waitForTimeout(600)
  await page.fill('[data-testid="gear-qty"]', '4')
  await page.click('[data-testid="gear-save"]'); await page.waitForTimeout(700)
  if (await page.locator(`[data-testid="gear-verify-${flagged[1].id}"]`).count()) throw new Error('editing did not clear the prompt')
  if ((await items()).filter((i) => i.verify).length !== 1) throw new Error('the wrong number of prompts remain')
})

await step('5c · how long a box lasts appears only with enough history', async () => {
  const use = await find((i) => i.status === 'in_use' && i.gauge === '25G' && i.lengthMm === 13)
  // the spec key format is category|gauge|length|type|volume|name, lower-cased
  const KEY = 'syringe needles|25g|13|||'
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
  const swap = (date, i) => ({ id: `h${i}`, date, specKey: KEY, category: 'Syringe needles', label: '25G · 13 mm', outcome: 'promoted', sparesLeft: 0 })

  // no history, then one finish, then two (a single gap): none of these may show a number
  for (const dates of [[], [ago(80)], [ago(80), ago(38)]]) {
    await setState('s.gearSwaps = a.swaps', { swaps: dates.map(swap) })
    await reload(); await gear()
    if (await page.locator(`[data-testid="gear-estimate-${use.id}"]`).count()) throw new Error(`an estimate appeared with ${dates.length} finish(es)`)
  }

  // three finishes: two gaps of 42 days
  await setState('s.gearSwaps = a.swaps', { swaps: [ago(120), ago(78), ago(36)].map(swap) })
  await reload(); await gear()
  const el = page.locator(`[data-testid="gear-estimate-${use.id}"]`)
  if (!(await el.count())) throw new Error('no estimate with three finishes')
  const text = await el.innerText()
  if (!/about 6 weeks/.test(text)) throw new Error(`the average is wrong: "${text}"`)
  if (!/from 3 boxes/.test(text)) throw new Error(`the sample size is missing: "${text}"`)
  if (!/runs out around/.test(text)) throw new Error(`no run-out date: "${text}"`)
  // a different spec is untouched by this history
  const other = await find((i) => i.status === 'in_use' && i.gauge === '27G')
  if (await page.locator(`[data-testid="gear-estimate-${other.id}"]`).count()) throw new Error('another spec picked up this history')
  console.log(`  "${text.replace(/\s+/g, ' ')}"`)
})

// ==================================================================== 4 · Finished

await step('4 · Finished promotes a matching spare, decrements it, and records the date', async () => {
  await setState('s.gearSwaps = []')
  await reload(); await gear()
  const use = await find((i) => i.status === 'in_use' && i.gauge === '27G' && i.lengthMm === 13)
  const spare = await find((i) => i.status === 'stock' && i.gauge === '27G' && i.lengthMm === 13)
  const left = spare.qty
  await page.click(`[data-testid="gear-finish-${use.id}"]`); await page.waitForTimeout(600)
  await noOverflow('finish sheet')
  if ((await page.locator(`[data-testid="gear-spare-${spare.id}"]`).getAttribute('data-on')) !== 'true') throw new Error('the matching spare is not pre-selected')
  const day = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10)
  await page.fill('[data-testid="gear-finish-date"]', day)
  await page.click('[data-testid="gear-swap"]'); await page.waitForTimeout(800)

  const s = await state()
  const after = s.gearItems
  if (after.find((i) => i.id === use.id)) throw new Error('the finished box is still there')
  const spareNow = after.find((i) => i.id === spare.id)
  if (!spareNow || spareNow.qty !== left - 1) throw new Error(`the spare is ${spareNow?.qty}, expected ${left - 1}`)
  const promoted = after.find((i) => i.status === 'in_use' && i.gauge === '27G' && i.lengthMm === 13)
  if (!promoted || promoted.qty !== 1) throw new Error('no fresh in-use box after the swap')
  if (promoted.usedFrom !== day) throw new Error(`the box in use starts ${promoted.usedFrom}, expected ${day}`)
  if (s.gearSwaps.length !== 1 || s.gearSwaps[0].date !== day || s.gearSwaps[0].outcome !== 'promoted') throw new Error('the swap was not recorded with its date')
  if (!(await page.locator(`[data-testid="gear-swap-${s.gearSwaps[0].id}"]`).count())) throw new Error('the swap is not in the history list')
  if (!(await page.locator('[data-testid="gear-history"]').innerText()).includes(day.slice(0, 4))) throw new Error('the history does not show the date')
  console.log(`  27G x 13: spare ${left} -> ${left - 1}, swap dated ${day}`)
})

await step('4b · the oldest of several matching spares is chosen, and others are listed', async () => {
  const use = await find((i) => i.status === 'in_use' && i.gauge === '25G' && i.lengthMm === 13)
  const first = await find((i) => i.status === 'stock' && i.gauge === '25G' && i.lengthMm === 13)
  // a second spare of the same spec from another shop, added through the real form
  await page.click('[data-testid="gear-add"]'); await page.waitForTimeout(600)
  await page.selectOption('[data-testid="gear-category"]', 'Syringe needles')
  await page.selectOption('[data-testid="gear-field-gauge"]', '25G')
  await page.selectOption('[data-testid="gear-field-lengthMm"]', '13')
  await page.fill('[data-testid="gear-brand"]', 'Terumo')
  await page.click('[data-testid="gear-save"]'); await page.waitForTimeout(500)
  await page.click('[data-testid="gear-dup-separate"]'); await page.waitForTimeout(700)
  const second = await find((i) => i.status === 'stock' && i.gauge === '25G' && i.brand === 'Terumo')
  if (!second) throw new Error('the second spare was not added')

  await page.click(`[data-testid="gear-finish-${use.id}"]`); await page.waitForTimeout(600)
  const listed = await page.locator('[data-testid^="gear-spare-"]').count()
  if (listed !== 2) throw new Error(`${listed} spares listed, expected 2`)
  if ((await page.locator(`[data-testid="gear-spare-${first.id}"]`).getAttribute('data-on')) !== 'true') throw new Error('the older spare is not the pre-selected one')
  // choose the other and swap
  await page.click(`[data-testid="gear-spare-${second.id}"]`)
  await page.click('[data-testid="gear-swap"]'); await page.waitForTimeout(800)
  const promoted = await find((i) => i.status === 'in_use' && i.gauge === '25G' && i.lengthMm === 13)
  if (promoted.brand !== 'Terumo') throw new Error(`the box now in use is "${promoted.brand}", not the one chosen`)
  if (!(await find((i) => i.id === first.id))) throw new Error('the spare that was not chosen was touched')
})

await step('4c · with no match it says so, and offers to add stock or clear the slot', async () => {
  const use = await find((i) => i.status === 'in_use' && i.gauge === '29G' && i.lengthMm === 13)
  await page.click(`[data-testid="gear-finish-${use.id}"]`); await page.waitForTimeout(600)
  if (!(await page.locator('[data-testid="gear-no-match"]').count())) throw new Error('it did not say there is no match')
  for (const id of ['gear-add-stock', 'gear-clear']) {
    if (!(await page.locator(`[data-testid="${id}"]`).count())) throw new Error(`no ${id} option`)
  }
  if (await page.locator('[data-testid="gear-swap"]').count()) throw new Error('a swap is offered with nothing to swap in')

  // add stock from here: the form is pre-filled, and the sheet comes back with the new spare chosen
  await page.click('[data-testid="gear-add-stock"]'); await page.waitForTimeout(700)
  if ((await page.$eval('[data-testid="gear-category"]', (e) => e.value)) !== 'Syringe needles') throw new Error('the form did not carry the category')
  if ((await page.$eval('[data-testid="gear-field-gauge"]', (e) => e.value)) !== '29G') throw new Error('the form did not carry the gauge')
  if ((await page.$eval('[data-testid="gear-field-lengthMm"]', (e) => e.value)) !== '13') throw new Error('the form did not carry the length')
  await page.click('[data-testid="gear-save"]'); await page.waitForTimeout(800)
  if (!(await page.locator('[data-testid="gear-finish-sheet"]').count())) throw new Error('the finish sheet did not come back')
  if (!(await page.locator('[data-testid="gear-swap"]').count())) throw new Error('the new stock is not offered')
  await page.click('[data-testid="gear-swap"]'); await page.waitForTimeout(800)
  const now = await find((i) => i.status === 'in_use' && i.gauge === '29G' && i.lengthMm === 13)
  if (!now || now.id === use.id) throw new Error('the box was not swapped')
  if (await find((i) => i.status === 'stock' && i.gauge === '29G' && i.lengthMm === 13)) throw new Error('a one-box spare was not used up cleanly')
})

await step('4d · clearing the slot removes the box and still records the date', async () => {
  const use = await find((i) => i.status === 'in_use' && i.gauge === '31G' && i.lengthMm === 8)
  const n = (await state()).gearSwaps.length
  await page.click(`[data-testid="gear-finish-${use.id}"]`); await page.waitForTimeout(600)
  await page.click('[data-testid="gear-clear"]'); await page.waitForTimeout(800)
  const s = await state()
  if (s.gearItems.find((i) => i.id === use.id)) throw new Error('the box is still there')
  if (s.gearSwaps.length !== n + 1) throw new Error('no swap record was written')
  const last = s.gearSwaps[s.gearSwaps.length - 1]
  if (last.outcome !== 'cleared' || !last.date) throw new Error(`recorded as ${JSON.stringify(last)}`)
})

await step('4e · Undo on the toast puts a finished box back exactly', async () => {
  const use = await find((i) => i.status === 'in_use' && i.gauge === '27G' && i.lengthMm === 13)
  const before = JSON.stringify([(await state()).gearItems, (await state()).gearSwaps])
  await page.click(`[data-testid="gear-finish-${use.id}"]`); await page.waitForTimeout(600)
  await page.click('[data-testid="gear-swap"]'); await page.waitForTimeout(500)
  await page.click('[data-testid="toast-undo"]'); await page.waitForTimeout(500)
  const after = JSON.stringify([(await state()).gearItems, (await state()).gearSwaps])
  if (before !== after) throw new Error('Undo did not restore the inventory')
})

// ===================================================== 6 · backup, and stock untouched

await step('6 · supplies go into a backup and come back from a restore', async () => {
  await reload()
  await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(600)
  await page.click('[data-testid="more-settings"]'); await page.waitForTimeout(800)
  const mine = await state()

  // back up through the real button
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('button:has-text("Back up everything")'),
  ])
  const path = await download.path()
  const bundle = JSON.parse(readFileSync(path, 'utf8'))
  const inFile = bundle.appState?.state
  if (!inFile?.gearItems?.length) throw new Error('the backup file has no supplies in it')
  if (JSON.stringify(inFile.gearItems) !== JSON.stringify(mine.gearItems)) throw new Error('the backup holds a different inventory')
  if (JSON.stringify(inFile.gearSwaps) !== JSON.stringify(mine.gearSwaps)) throw new Error('the backup holds different swap history')
  if (JSON.stringify(inFile.gearOptions) !== JSON.stringify(mine.gearOptions)) throw new Error('the backup holds different added options')

  // wreck the inventory, then restore through the real button
  await setState('s.gearItems = []; s.gearSwaps = []; s.gearOptions = {}')
  await reload()
  if ((await items()).length !== 0) throw new Error('the inventory was not emptied')
  await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(600)
  await page.click('[data-testid="more-settings"]'); await page.waitForTimeout(800)
  await page.setInputFiles('input[type="file"][accept^="application/json"]', path)
  await page.waitForTimeout(700)
  const prompt = await page.locator('text=Replace all current data?').locator('..').locator('..').innerText()
  if (!new RegExp(`${mine.gearItems.length} supplies`).test(prompt)) throw new Error(`the restore summary does not mention the supplies: "${prompt.slice(0, 160)}"`)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
    page.click('button:has-text("Yes, restore")'),
  ])
  await page.waitForSelector('nav button'); await page.waitForTimeout(1500); await gotIt()

  const back = await state()
  if (JSON.stringify(back.gearItems) !== JSON.stringify(mine.gearItems)) throw new Error(`restored ${back.gearItems.length} items, expected ${mine.gearItems.length}`)
  if (JSON.stringify(back.gearSwaps) !== JSON.stringify(mine.gearSwaps)) throw new Error('the swap history did not come back')
  if (JSON.stringify(back.gearOptions) !== JSON.stringify(mine.gearOptions)) throw new Error('the added options did not come back')
  console.log(`  ${back.gearItems.length} items, ${back.gearSwaps.length} swaps and ${Object.keys(back.gearOptions).length} added option list(s) survived a backup and restore`)
})

await step('6b · nothing in peptide stock, doses or run-out changed through all of it', async () => {
  const after = await stockSnapshot()
  if (after !== stockBefore) {
    const a = JSON.parse(stockBefore), b = JSON.parse(after)
    const diff = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    throw new Error(`these changed: ${diff.join(', ')}`)
  }
  console.log('  vials, open vials, doses, titration, pauses and runs are byte-identical')
})

await step('7 · the screen and every sheet fit 390px', async () => {
  await gear()
  await noOverflow('Supplies')
  await page.click('[data-testid="gear-add"]'); await page.waitForTimeout(600)
  await noOverflow('add sheet')
  await closeAll()
  const use = await find((i) => i.status === 'in_use')
  await page.click(`[data-testid="gear-finish-${use.id}"]`); await page.waitForTimeout(600)
  await noOverflow('finish sheet')
  await closeAll()
  await page.click(`[data-testid="gear-edit-${use.id}"]`); await page.waitForTimeout(600)
  await noOverflow('edit sheet')
  await closeAll()
  await page.screenshot({ path: `${SHOT}/v43-supplies.png`, fullPage: false })
})

await step('8 · the other tabs are untouched', async () => {
  await closeAll()
  for (const label of ['Home', 'Calendar', 'Symptoms', 'Body', 'Bloods', 'More']) {
    await page.click(`nav button[aria-label="${label}"]`); await page.waitForTimeout(500)
    if ((await page.locator('nav button').count()) !== 6) throw new Error(`${label} broke the nav`)
    await noOverflow(label)
  }
  await page.click('[data-testid="more-supplies"]'); await page.waitForTimeout(700)
  if (!(await page.locator('text=Stock').count())) throw new Error('the Stock screen no longer opens')
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise.slice(0, 10)) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
