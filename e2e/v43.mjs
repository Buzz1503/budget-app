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
  catch (e) { failures++; console.log('FAIL', name, '–', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
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

// ============================================ 1 · Supplies left the app (stage 2D)
// The Supplies screen and its adding, editing, flags and Finished flow were
// removed in stage 2D. What it stored stays in the store and in backups, which
// the backup steps below still check.

await step('1 · Supplies is not in More, and its items are still stored', async () => {
  await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(500)
  if (await page.locator('[data-testid="more-gear"]').count()) throw new Error('Supplies is still in More')
  const n = (await items()).length
  if (n !== SEED.items.length) throw new Error(`${n} stored items, expected the ${SEED.items.length} from the seed`)
  console.log(`  ${n} stored items kept, no screen`)
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

await step('8 · the other tabs are untouched', async () => {
  await closeAll()
  // Calendar, Reactions and Bloods are the first rows of More since stage 2D
  for (const label of ['Home', 'Body', 'Sauna', 'More', 'Calendar', 'Reactions', 'Bloods']) {
    if (label === 'Calendar' || label === 'Reactions' || label === 'Bloods') {
      await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(400)
      await page.click(`[data-testid="more-${label.toLowerCase()}"]`)
    } else {
      await page.click(`nav button[aria-label="${label}"]`)
    }
    await page.waitForTimeout(500)
    if ((await page.locator('nav button').count()) !== 4) throw new Error(`${label} broke the nav`)
    await noOverflow(label)
  }
  await page.click('nav button[aria-label="More"]'); await page.waitForTimeout(400)
  await page.click('[data-testid="more-supplies"]'); await page.waitForTimeout(700)
  if (!(await page.locator('text=Stock').count())) throw new Error('the Stock screen no longer opens')
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise.slice(0, 10)) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
