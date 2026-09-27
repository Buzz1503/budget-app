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
const body = () => page.textContent('body')
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
const patch = (fn) => page.evaluate((src) => {
  const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
  // eslint-disable-next-line no-new-func
  new Function('s', src)(raw.state)
  localStorage.setItem('peptide-command-center', JSON.stringify(raw))
}, fn)
const TAB_MARK = {
  Home: /Pepito \+/, Calendar: /This week|Adherence this month/,
  Symptoms: /How are you feeling/i, Body: /How to measure/, More: /Build \/ rebuild my protocol/,
}
const nav = async (label) => {
  await page.click(`nav button[aria-label="${label}"]`)
  await waitText(TAB_MARK[label])
  await page.waitForTimeout(250)
}
const openPicker = async () => {
  await page.locator('[aria-label^="Log "]').first().click()
  await waitText(/INJECT HERE|Next on your path/, 12000)
}
const closeAny = async () => {
  for (const sel of ['[data-testid="site-detail"] button[aria-label="Close"]', 'button:text-is("Done")', 'div.fixed.inset-0.z-50 button[aria-label="Close"]']) {
    const b = page.locator(sel).first()
    if (await b.count()) { await b.click(); await page.waitForTimeout(400) }
  }
}

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
await page.click('text=Got it')
await page.click('button:has-text("AM")')
await page.waitForTimeout(400)

// ---------- 1 · motivation is gone ----------
await step('the AM motivation quote is gone, and nothing empty is left behind', async () => {
  // v30 made the row itself the log button — there is no picker in between any
  // more — but the claim is unchanged: logging works and leaves no empty slot
  // where the quote used to be.
  const row = page.locator('[data-testid="log-row"]:not([data-done])').first()
  if (!(await row.count())) throw new Error('nothing outstanding to log')
  await row.click()
  await page.waitForTimeout(1100)
  if (await page.locator('[data-testid="motivation-line"]').count()) {
    throw new Error('the motivation line is still rendered')
  }
  const st = await state()
  if (!st.doseLogs.length) throw new Error('the dose did not log')
  if (st.motivation) throw new Error('the motivation slice is still persisted')
})

// ---------- 2 · Home declutter ----------
await step('standing nudges are collapsed into one alert bell', async () => {
  await patch(`
    s.openVials.bpc157 = { remainingMg: 0.2, reconstitutedAt: new Date(Date.now() - 27*86400000).toISOString().slice(0,10) };
    s.backupMeta = { lastBackupAt: null, lastBackupEntryCount: 0, nudgeDismissedAt: null };
  `)
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(400)
  const bell = page.locator('[data-testid="alert-bell"]')
  if (!(await bell.count())) throw new Error('no alert bell')
  // and not as full-width cards in the main column
  if (await page.locator('main button:has-text("Back up now")').count()) {
    throw new Error('the backup nudge is still a card in the main column')
  }
  await bell.click()
  await page.waitForTimeout(400)
  const panel = page.locator('[data-testid="alert-panel"]')
  if (!(await panel.count())) throw new Error('the bell did not expand')
  if (!/Back up now|expires|runs out/i.test(await panel.textContent())) {
    throw new Error('the panel carries none of the nudges')
  }
  await page.keyboard.press('Escape')
  await bell.click()
  await page.waitForTimeout(300)
})

await step('the dose list leads the screen', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.settings.disclaimerDismissed = true
    raw.state.coachMarks = { 'log-button': true, 'site-map': true }
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  await page.click('button:has-text("AM")')
  await page.waitForTimeout(500)
  // v31 moved the combine row below the cards, so the dose list itself is the
  // first dose content on the screen. Measured to the list rather than to the
  // first unlogged Log button, which sits one card lower once one is logged.
  const y = await page.evaluate(() => {
    const list = document.querySelector('main .card.rows')
    const card = document.querySelector('main [aria-label^="Log "]')
    const tops = [list, card].filter(Boolean).map((el) => el.getBoundingClientRect().top + window.scrollY)
    return tops.length ? Math.min(...tops) : null
  })
  if (y == null) throw new Error('no dose content found')
  // v28: display title + the focal metric card sit above the list by design
  if (y > 340) throw new Error(`the dose content starts ${Math.round(y)}px down — too much above it`)
})

await step('the mix explanation is behind an info tap', async () => {
  const txt = await body()
  const essay = /Only pairs the matrix rates/
  if (essay.test(txt)) throw new Error('the explanation is still shown by default')
  const info = page.locator('button[aria-label="Why these are combined"]')
  if (!(await info.count())) throw new Error('no info control on the combine plan')
  await info.first().click()
  await page.waitForTimeout(400)
  if (!essay.test(await body())) throw new Error('the info tap did not reveal the explanation')
  await info.first().click()
  await page.waitForTimeout(300)
})

// v30 removed injection-site rotation in full — the living map, site recency,
// the reaction log, follow-the-path and the IM back view. The twelve steps that
// covered them are gone rather than left red; what this suite still guards is
// the Home decluttering it was written alongside, which is all live.

// ---------- 6 · layout + persistence ----------
await step('no horizontal overflow at 390px on any tab', async () => {
  await closeAny()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  for (const tab of ['Home', 'Calendar', 'Symptoms', 'Body', 'More']) {
    await nav(tab)
    await page.waitForTimeout(450)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 1) throw new Error(`${tab} overflows by ${over}px`)
  }
})

await step('logs survive a reload', async () => {
  const before = await state()
  await page.reload({ waitUntil: 'networkidle' })
  await waitText(/Pepito/)
  const st = await state()
  if (st.doseLogs.length !== before.doseLogs.length) throw new Error('dose logs lost on reload')
  if (st.peptides.length !== before.peptides.length) throw new Error('the stack changed on reload')
})

await nav('Home')
await page.screenshot({ path: `${SHOT}/v15-home.png`, fullPage: true })
await page.click('button:has-text("AM")')
await page.waitForTimeout(300)
if (await page.locator('[aria-label^="Log "]').count()) {
  await openPicker()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOT}/v15-map.png`, fullPage: true })
}

await browser.close()
if (errors.length) {
  console.log('\n--- FAILURES ---')
  for (const e of errors) console.log(e)
  process.exit(1)
}
console.log('\nv15 e2e: all green')
