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
  catch (e) { console.log('FAIL', name, '–', e.message.split('\n')[0]); errors.push(`step ${name}: ${e.message}`) }
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

// v14 tested the Symptoms "how I feel" screen. Stage 2D removed it, the daily
// check-in and Supplies from the app; this suite now checks they stay
// unreachable and that everything they stored is kept.
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await waitText(/not medical advice/)
const gotIt = page.locator('button:has-text("Got it")')
if (await gotIt.count()) await gotIt.first().click().catch(() => {})

await step('an older save keeps its symptom check-ins, daily check-ins and Supplies', async () => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.state.symptomLogs = [{ id: 'sym-1', date: '2026-10-01', tags: [{ id: 'nausea', severity: 'mild' }], note: 'kept', activePeptides: [] }]
    raw.state.checkins = { '2026-10-01': { energy: 4, mood: 3 } }
    raw.state.gearItems = [{ id: 'g-keep', category: 'Syringe needles', gauge: '31G', lengthMm: 8, status: 'in_use', qty: 100 }]
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const st = await state()
  if (st.symptomLogs?.[0]?.note !== 'kept') throw new Error('symptom check-ins were dropped')
  if (st.checkins?.['2026-10-01']?.energy !== 4) throw new Error('daily check-ins were dropped')
  if (st.gearItems?.[0]?.id !== 'g-keep') throw new Error('Supplies items were dropped')
})

await step('the bottom bar is Home, Body, Sauna, More on the web', async () => {
  const labels = (await page.locator('nav button span:not(:has(svg))').allTextContents()).map((x) => x.trim())
  if (labels.join('|') !== 'Home|Body|Sauna|More') throw new Error(`nav is [${labels.join(', ')}]`)
})

await step('More starts with Calendar, Reactions, Bloods, Stock; no Symptoms or Supplies', async () => {
  await page.click('nav button[aria-label="More"]')
  await page.waitForTimeout(600)
  const ids = await page.locator('[data-testid^="more-"]').evaluateAll((els) => els.map((e) => e.dataset.testid))
  if (ids.slice(0, 4).join(',') !== 'more-calendar,more-reactions,more-bloods,more-supplies') throw new Error(`More starts ${ids.slice(0, 4)}`)
  if (ids.includes('more-symptoms') || ids.includes('more-gear')) throw new Error('a removed row is still in More')
})

await step('no feelings check-in on Home, in Reactions, the calendar or History', async () => {
  for (const go of [
    async () => page.click('nav button[aria-label="Home"]'),
    async () => { await page.click('nav button[aria-label="More"]'); await page.click('[data-testid="more-reactions"]') },
    async () => { await page.click('nav button[aria-label="More"]'); await page.click('[data-testid="more-history"]') },
  ]) {
    await go()
    await page.waitForTimeout(700)
    const text = await page.textContent('body')
    if (/How are you feeling|Today.s check-in|How the day felt|Energy, mood/i.test(text)) throw new Error('a feelings check-in is still on screen')
  }
  await page.click('nav button[aria-label="More"]')
  await page.click('[data-testid="more-calendar"]')
  await page.waitForTimeout(800)
  const cell = page.locator('[data-testid^="cal-cell-"], [data-testid^="cal-day-"]').first()
  if (await cell.count()) {
    await cell.click()
    await page.waitForTimeout(600)
    if (await page.locator('[data-testid="day-edit-symptoms"]').count()) throw new Error('the day sheet still offers symptoms')
    await page.keyboard.press('Escape')
  }
  const st = await state()
  if (st.symptomLogs.length !== 1 || !st.checkins['2026-10-01']) throw new Error('browsing changed the kept data')
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(noise.length ? `FAIL console clean, ${noise.slice(0, 3).join(' | ')}` : 'PASS console clean')
await browser.close()
process.exit(errors.length ? 1 : 0)
