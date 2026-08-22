// v23 — the three layers kept apart, the removals, and the new screens.
// Runs at 390×844 against a build (or the dev server) on BASE_URL.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const SHOT = new URL('./shots', import.meta.url).pathname
mkdirSync(SHOT, { recursive: true })
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
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
const nav = async (label) => {
  await page.click(`nav button:has-text("${label}")`)
  await page.waitForTimeout(500)
  if (label === 'Home') { await page.click('button:has-text("AM")').catch(() => {}); await page.waitForTimeout(400) }
}
const more = async (label) => {
  await nav('More')
  await page.click(`button:has-text("${label}")`)
  await page.waitForTimeout(700)
}
const stockRoom = async () => {
  await more('Stock')
  const t = page.locator('[data-testid="stock-view"] button[aria-label="Stock room"]')
  if (await t.count()) { await t.click(); await page.waitForTimeout(500) }
}
const groupFor = (name) => page.locator('[data-testid="stock-group"]').filter({ hasText: name }).first()
const wizard = () => modal()
const openWizard = async () => {
  await nav('More')
  await page.click('text=Build / rebuild my protocol')
  await page.waitForTimeout(800)
}
const closeModal = async () => {
  const x = page.locator('button[aria-label="Close"]').first()
  if (await x.count()) await x.click({ timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(450)
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
if (await modal().count()) { await page.click('button:has-text("Got it")'); await page.waitForTimeout(500) }

// ============================= 1 · the three layers do not leak into each other

await step('adding stock creates no protocol entry', async () => {
  const before = (await state()).peptides.length
  await stockRoom()
  await page.click('[data-testid="add-stock"]')
  await page.waitForTimeout(600)
  await page.fill('input[aria-label="Search compounds"]', 'Thymosin Beta-4')
  await page.waitForTimeout(500)
  await page.locator('[data-testid="stock-picker"] button').filter({ hasText: 'TB-500' }).first().click()
  await page.waitForTimeout(500)
  await page.fill('input[aria-label="Vial size in mg"]', '5')
  await page.fill('input[aria-label="How many vials"]', '2')
  await page.fill('input[aria-label="Vendor"]', 'Test Labs')
  await page.click('[data-testid="save-batch"]')
  await page.waitForTimeout(900)

  const st = await state()
  if (st.peptides.length !== before) throw new Error('adding stock changed the protocol')
  if (st.peptides.some((p) => p.id === 'tb500')) throw new Error('TB-500 was put into the protocol unasked')
  if (!st.vials.some((v) => v.peptideId === 'tb500' && v.qtyOnHand === 2)) throw new Error('the batch was not recorded')
})

await step('a stock-only compound is scheduled nowhere', async () => {
  await nav('Home')
  const home = await page.textContent('body')
  if (/TB-500/.test(home)) throw new Error('a stock-only compound appeared on Home')
  await nav('Calendar')
  await page.waitForTimeout(600)
  if (/TB-500/.test(await page.textContent('body'))) throw new Error('a stock-only compound appeared on the calendar')
})

await step('removing from my protocol leaves stock and history intact', async () => {
  // log a dose first, so there is history that must survive
  await nav('Home')
  await page.click('button[aria-label="Log BPC-157"]')
  await page.waitForTimeout(1200)
  await page.click('button:has-text("Log here")')
  await page.waitForTimeout(1400)
  await closeModal()

  const before = await state()
  const logsBefore = before.doseLogs.filter((l) => l.peptideId === 'bpc157').length
  const vialsBefore = before.vials.filter((v) => v.peptideId === 'bpc157').length
  if (!logsBefore) throw new Error('nothing logged to protect')

  await openWizard()
  await wizard().locator('[data-testid="manage-row"]').filter({ hasText: 'BPC-157' }).first()
    .locator('[data-testid="manage-remove"]').click()
  await page.waitForTimeout(500)
  const warn = await wizard().locator('[data-testid="confirm-remove-compound"]').textContent()
  if (!/stay in stock/i.test(warn)) throw new Error('the confirm does not promise stock survives')
  if (!/stay in history/i.test(warn)) throw new Error('the confirm does not promise history survives')
  await wizard().locator('[data-testid="confirm-remove-compound-yes"]').click()
  await page.waitForTimeout(400)
  await wizard().locator('[data-testid="manage-save"]').click()
  await page.waitForTimeout(400)
  await wizard().locator('button:has-text("Save my protocol")').click()
  await page.waitForTimeout(700)
  await wizard().locator('button:text-is("Done")').click()
  await page.waitForTimeout(800)

  const after = await state()
  if (after.peptides.some((p) => p.id === 'bpc157')) throw new Error('the compound was not removed')
  if (after.vials.filter((v) => v.peptideId === 'bpc157').length !== vialsBefore) {
    throw new Error('removing from the protocol destroyed stock')
  }
  if (after.doseLogs.filter((l) => l.peptideId === 'bpc157').length !== logsBefore) {
    throw new Error('removing from the protocol destroyed logged history')
  }
})

await step('deleting a stock batch leaves the protocol and history intact', async () => {
  const before = await state()
  const peptidesBefore = before.peptides.length
  const logsBefore = before.doseLogs.length

  await stockRoom()
  const group = groupFor('TB-500')
  await group.locator('button').first().click()
  await page.waitForTimeout(600)
  await group.locator('[data-testid="batch-row"]').first().locator('button[aria-label^="Delete the"]').click()
  await page.waitForTimeout(500)
  const warn = await page.locator('[data-testid="confirm-delete-batch"]').textContent()
  if (!/protocol and your logged doses are untouched/i.test(warn.replace(/\s+/g, ' '))) {
    throw new Error(`the confirm does not say what survives — got: ${warn.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
  await page.click('[data-testid="confirm-delete-batch-yes"]')
  await page.waitForTimeout(700)

  const after = await state()
  if (after.vials.some((v) => v.peptideId === 'tb500')) throw new Error('the batch was not deleted')
  if (after.peptides.length !== peptidesBefore) throw new Error('deleting stock changed the protocol')
  if (after.doseLogs.length !== logsBefore) throw new Error('deleting stock changed the history')
})

// =================================== 2 · Build/rebuild manages the whole protocol

await step('Build / rebuild can add, edit and remove without wiping the rest', async () => {
  const before = await state()
  const beforeIds = before.peptides.map((p) => p.id)

  await openWizard()
  // edit one compound's frequency
  await wizard().locator('[data-testid="manage-row"]').filter({ hasText: 'Selank' }).first()
    .locator('[data-testid="manage-edit"]').click()
  await page.waitForTimeout(600)
  await wizard().locator('select').filter({ hasText: 'Daily' }).first().selectOption('weekly')
  await page.waitForTimeout(400)
  await wizard().locator('button:has-text("Done editing")').click()
  await page.waitForTimeout(400)
  await wizard().locator('[data-testid="manage-save"]').click()
  await page.waitForTimeout(400)
  await wizard().locator('button:has-text("Save my protocol")').click()
  await page.waitForTimeout(700)
  await wizard().locator('button:text-is("Done")').click()
  await page.waitForTimeout(800)

  const after = await state()
  if (after.peptides.find((p) => p.id === 'selank').frequency !== 'weekly') {
    throw new Error('the edit did not save')
  }
  for (const id of beforeIds) {
    if (!after.peptides.some((p) => p.id === id)) throw new Error(`editing one item dropped ${id}`)
  }
})

await step('a compound I only own can be added to my protocol from stock', async () => {
  // put TB-500 back on the shelf, then add it to the protocol
  await stockRoom()
  await page.click('[data-testid="add-stock"]')
  await page.waitForTimeout(600)
  await page.fill('input[aria-label="Search compounds"]', 'Thymosin Beta-4')
  await page.waitForTimeout(500)
  await page.locator('[data-testid="stock-picker"] button').filter({ hasText: 'TB-500' }).first().click()
  await page.waitForTimeout(500)
  await page.fill('input[aria-label="Vial size in mg"]', '5')
  await page.fill('input[aria-label="How many vials"]', '2')
  await page.click('[data-testid="save-batch"]')
  await page.waitForTimeout(900)

  await openWizard()
  await wizard().locator('[data-testid="manage-add"]').click()
  await page.waitForTimeout(600)
  const first = await wizard().locator('[data-testid="wizard-list"] > button').first().textContent()
  if (!/in my stock/.test(first)) throw new Error(`what I own should sort first — got: ${first.slice(0, 80)}`)

  await wizard().locator('input[placeholder*="Search"]').fill('Thymosin Beta-4')
  await page.waitForTimeout(500)
  await wizard().locator('[data-testid="wizard-list"] > button').filter({ hasText: 'TB-500' }).first().click()
  await page.waitForTimeout(400)
  await wizard().locator('button:has-text("Set up")').click()
  await page.waitForTimeout(600)
  await wizard().locator('button:has-text("Done editing")').click()
  await page.waitForTimeout(400)
  await wizard().locator('[data-testid="manage-save"]').click()
  await page.waitForTimeout(400)
  await wizard().locator('button:has-text("Save my protocol")').click()
  await page.waitForTimeout(700)
  await wizard().locator('button:text-is("Done")').click()
  await page.waitForTimeout(800)

  const st = await state()
  if (!st.peptides.some((p) => p.id === 'tb500')) throw new Error('TB-500 was not added to the protocol')
  if (!st.vials.some((v) => v.peptideId === 'tb500')) throw new Error('adding to the protocol lost the stock')
})

// ================================================= 3 · the removals are complete

await step('Library, Insights, Needle guide, weekly recap, badges and streaks are gone', async () => {
  await nav('More')
  const hub = await page.textContent('main')
  for (const gone of [/\bLibrary\b/, /Insights/, /Needle guide/, /Your week/, /Badges/, /streak/i, /\bXP\b/]) {
    if (gone.test(hub)) throw new Error(`More still offers ${gone}`)
  }
  await nav('Home')
  const home = await page.textContent('main')
  for (const gone of [/\bXP\b/, /streak/i, /Lvl \d/]) {
    if (gone.test(home)) throw new Error(`Home still shows ${gone}`)
  }
  await more('Settings, backup & export')
  const settings = await page.textContent('main')
  if (/Badges/.test(settings)) throw new Error('the badges shelf is still in Settings')
  const st = await state()
  if (st.gamification) throw new Error('the gamification slice survived the migration')
  if (st.recapSeen !== undefined) throw new Error('recapSeen survived the migration')
})

await step('More is grouped into sections', async () => {
  await nav('More')
  const hub = await page.textContent('main')
  for (const heading of ['My protocol', 'Tools', 'Data']) {
    if (!hub.includes(heading)) throw new Error(`More is missing the "${heading}" section`)
  }
})

// ================================================ 4 · the compound detail sheet

await step('the compound sheet opens from my protocol with reference data', async () => {
  await more('Protocol overview')
  await page.locator('[data-testid="protocol-row"]').first().click()
  await page.waitForTimeout(700)
  const sheet = page.locator('[data-testid="compound-sheet"]')
  if (!(await sheet.count())) throw new Error('the compound sheet did not open')
  const about = await sheet.textContent()
  if (!/How it works|No reference entry/.test(about)) throw new Error('no reference material in the sheet')
  await closeModal()
})

await step('the sheet carries my settings, my history and my own notes', async () => {
  await more('Protocol overview')
  await page.locator('[data-testid="protocol-row"]').filter({ hasText: 'Selank' }).first().click()
  await page.waitForTimeout(700)

  await page.click('[data-testid="sheet-tab-mine"]')
  await page.waitForTimeout(400)
  const mine = await page.locator('[data-testid="compound-sheet"]').textContent()
  for (const want of [/Dose now/, /Frequency/, /Route/, /Cycle/]) {
    if (!want.test(mine)) throw new Error(`my settings are missing ${want}`)
  }

  await page.fill('[data-testid="compound-note"]', 'Sleeping better on this one.')
  await page.waitForTimeout(600)
  const st = await state()
  if (st.peptides.find((p) => p.id === 'selank').note !== 'Sleeping better on this one.') {
    throw new Error('the note did not save')
  }

  await page.click('[data-testid="sheet-tab-history"]')
  await page.waitForTimeout(400)
  if (!(await page.locator('[data-testid="backfill-open"]').count())) throw new Error('no way to backfill a dose')
  await closeModal()
})

// ================================================= 5 · backfill and correct

await step('a forgotten dose can be added on a past date', async () => {
  await more('Protocol overview')
  await page.locator('[data-testid="protocol-row"]').filter({ hasText: 'Selank' }).first().click()
  await page.waitForTimeout(700)
  await page.click('[data-testid="sheet-tab-history"]')
  await page.waitForTimeout(400)

  const before = (await state()).doseLogs.length
  await page.click('[data-testid="backfill-open"]')
  await page.waitForTimeout(500)
  const past = await page.evaluate(() => {
    const d = new Date(Date.now() - 3 * 86400000)
    return d.toISOString().slice(0, 10)
  })
  await page.fill('input[aria-label="Dose date"]', past)
  await page.waitForTimeout(300)
  await page.click('[data-testid="backfill-save"]')
  await page.waitForTimeout(900)

  const st = await state()
  if (st.doseLogs.length !== before + 1) throw new Error('the backfilled dose was not recorded')
  const added = st.doseLogs.find((l) => l.peptideId === 'selank' && l.date === past)
  if (!added) throw new Error(`no log on ${past}`)
  if (!added.backfilled) throw new Error('the log does not record that it was added later')
  // the sheet is still open behind the backfill form — close it before moving on
  await closeModal()
})

await step('a past dose can be corrected, and the correction moves the vial', async () => {
  await more('Protocol overview')
  await page.locator('[data-testid="protocol-row"]').filter({ hasText: 'Selank' }).first().click()
  await page.waitForTimeout(700)
  await page.click('[data-testid="sheet-tab-history"]')
  await page.waitForTimeout(500)

  const beforeMg = (await state()).openVials.selank?.remainingMg
  await page.locator('[data-testid="history-edit"]').first().click()
  await page.waitForTimeout(500)
  await page.fill('input[aria-label="Dose value"]', '900')
  await page.waitForTimeout(300)
  await page.click('[data-testid="edit-log-save"]')
  await page.waitForTimeout(900)

  const st = await state()
  const edited = st.doseLogs.filter((l) => l.peptideId === 'selank').find((l) => l.doseValue === 900)
  if (!edited) throw new Error('the dose was not corrected')
  if (!edited.edited) throw new Error('the log does not record that it was edited')
  if (st.openVials.selank?.remainingMg === beforeMg) throw new Error('the vial did not move with the correction')
  await closeModal()
})

await step('a past dose can be deleted, and the drug goes back in the vial', async () => {
  await more('Protocol overview')
  await page.locator('[data-testid="protocol-row"]').filter({ hasText: 'Selank' }).first().click()
  await page.waitForTimeout(700)
  await page.click('[data-testid="sheet-tab-history"]')
  await page.waitForTimeout(500)

  const before = await state()
  const beforeCount = before.doseLogs.length
  const beforeMg = before.openVials.selank?.remainingMg ?? 0

  await page.locator('[data-testid="history-edit"]').first().click()
  await page.waitForTimeout(500)
  await page.click('[data-testid="delete-log"]')
  await page.waitForTimeout(400)
  if (!(await page.locator('[data-testid="confirm-delete-log"]').count())) throw new Error('no confirm before deleting a log')
  await page.click('[data-testid="confirm-delete-log-yes"]')
  await page.waitForTimeout(900)

  const st = await state()
  if (st.doseLogs.length !== beforeCount - 1) throw new Error('the dose was not deleted')
  if ((st.openVials.selank?.remainingMg ?? 0) <= beforeMg) throw new Error('the drug did not go back in the vial')
  await closeModal()
})

// ================================================== 6 · protocol overview

await step('the protocol overview lists everything and exports', async () => {
  await more('Protocol overview')
  const rows = await page.locator('[data-testid="protocol-row"]').count()
  const st = await state()
  if (rows !== st.peptides.length) throw new Error(`${rows} rows for ${st.peptides.length} compounds`)
  const body = await page.textContent('main')
  for (const want of [/cycle|ongoing/i, /SubQ|Nasal|IM/]) {
    if (!want.test(body)) throw new Error(`the overview is missing ${want}`)
  }
  const dl = page.waitForEvent('download', { timeout: 15000 })
  await page.click('[data-testid="protocol-export"]')
  const file = await dl
  if (!/my-protocol-\d{4}-\d{2}-\d{2}\.txt/.test(file.suggestedFilename())) {
    throw new Error(`unexpected export filename: ${file.suggestedFilename()}`)
  }
})

// =========================================================== 7 · undo

await step('logging a dose offers an Undo that fully reverses it', async () => {
  await nav('Home')
  const btn = page.locator('button[aria-label^="Log "]').first()
  if (!(await btn.count())) throw new Error('nothing left to log')
  const before = await state()
  await btn.click()
  await page.waitForTimeout(1200)
  await page.click('button:has-text("Log here")')
  await page.waitForTimeout(1400)
  await closeModal()

  const mid = await state()
  if (mid.doseLogs.length !== before.doseLogs.length + 1) throw new Error('the dose was not logged')

  const toast = page.locator('[data-testid="toast"]')
  if (!(await toast.count())) throw new Error('no toast after logging')
  await page.click('[data-testid="toast-undo"]')
  await page.waitForTimeout(800)

  const after = await state()
  if (after.doseLogs.length !== before.doseLogs.length) throw new Error('Undo did not remove the log')
})

// ================================================= 8 · 390px, errors, survival

await step('nothing overflows horizontally at 390px on the new screens', async () => {
  const bad = []
  for (const [how, label] of [
    ['nav', 'Home'], ['nav', 'Calendar'], ['more', 'Protocol overview'],
    ['more', 'Stock'], ['more', 'History & adherence'],
  ]) {
    if (how === 'nav') await nav(label); else await more(label)
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    if (over) bad.push(label)
  }
  if (bad.length) throw new Error(`horizontal overflow on: ${bad.join(', ')}`)
})

await step('everything survives a reload', async () => {
  const before = await state()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const after = await state()
  if (after.peptides.length !== before.peptides.length) throw new Error('protocol lost')
  if (after.vials.length !== before.vials.length) throw new Error('stock lost')
  if (after.doseLogs.length !== before.doseLogs.length) throw new Error('history lost')
  if (after.peptides.find((p) => p.id === 'selank')?.note !== 'Sleeping better on this one.') {
    throw new Error('the compound note did not persist')
  }
})

await step('no runtime errors anywhere in the run', async () => {
  const real = errors.filter((e) => e.startsWith('pageerror') || e.startsWith('console'))
  if (real.length) throw new Error(real.slice(0, 3).join(' | '))
})

await more('Protocol overview')
await page.screenshot({ path: `${SHOT}/v23-protocol.png`, fullPage: true })
await nav('More')
await page.screenshot({ path: `${SHOT}/v23-more.png`, fullPage: true })
await browser.close()

const failures = errors.filter((e) => e.startsWith('step ') || e.startsWith('pageerror') || e.startsWith('console'))
console.log(`\n${failures.length ? `${failures.length} FAILURE(S)` : 'ALL PASS'}`)
for (const f of failures) console.log(' -', f.split('\n')[0])
process.exit(failures.length ? 1 : 0)
