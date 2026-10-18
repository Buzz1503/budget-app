// _health-demo — the Health screens against the deterministic demo data.
//
// Needs the dev server started with the demo switched on, which is not the
// server the other suites use (hence the leading underscore: run-all skips it):
//   VITE_DEMO_HEALTH=1 npx vite --port 5175 --strictPort
//   BASE_URL=http://localhost:5175/budget-app/ node e2e/_health-demo.mjs
//
// It walks every Health surface once and fails on any console error, at 390px.
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:5175/budget-app/'
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const errors = []
const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

let failures = 0
const step = async (name, fn) => {
  try { await fn(); console.log('PASS', name) }
  catch (e) { failures++; console.log('FAIL', name, '—', e.message.split('\n')[0]) }
}
const gotIt = async () => {
  const b = page.locator('button:has-text("Got it")')
  if (!(await b.count())) return
  try { await b.first().click({ timeout: 3000 }) } catch { /* left alone */ }
  await page.waitForTimeout(300)
}
const tab = async (label) => { await page.click(`nav button[aria-label="${label}"]`); await page.waitForTimeout(600) }
const seen = (sel, timeout = 8000) => page.waitForSelector(sel, { timeout })
const noOverflow = async (where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 391) throw new Error(`${where} overflows to ${w}px`)
}
const closeSheet = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400) }

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('nav button')
await page.waitForTimeout(1200)
await gotIt()

await step('More › Health first run explains the reads, then connects', async () => {
  await tab('More')
  await page.click('[data-testid="more-health"]')
  await seen('[data-testid="health-connect"]')
  await page.click('[data-testid="health-connect-button"]')
  await seen('[data-testid="health-counts"]', 30000)
  await seen('[data-testid="health-sleep-priority"]')
  await seen('[data-testid="health-habits"]')
  await noOverflow('More › Health')
})

await step('Home card shows readiness and opens Recovery', async () => {
  await tab('Home')
  await seen('[data-testid="home-health-card"]')
  await page.click('[data-testid="home-checkin-toggle"]')
  await page.click('[data-testid="checkin-energy-4"]')
  await page.click('[data-testid="home-health-open"]')
  await seen('[data-testid="recovery-view"]')
})

await step('Recovery: rows, charts, info, overlay', async () => {
  await seen('[data-testid="row-hrv"]')
  await seen('[data-testid="health-chart-readiness"]')
  await page.click('[data-testid="readiness-info-button"]')
  await seen('[data-testid="readiness-info"]')
  await closeSheet()
  await page.locator('[data-testid="health-chart-hrv"] [data-testid="overlay-button"]').click()
  await page.locator('[data-testid="health-chart-hrv"] [data-testid="ov-ticks"]').click()
  await noOverflow('Recovery')
})

await step('Compare: dose timing, before and after, habits', async () => {
  await page.click('[data-testid="open-compare"]')
  await seen('[data-testid="compare-sheet"]')
  await seen('[data-testid="compare-caveat"]')
  await page.click('[data-testid="compare-tab-before"]')
  await page.waitForTimeout(300)
  await page.click('[data-testid="compare-tab-habits"]')
  await seen('[data-testid="compare-habits"]')
  await closeSheet()
})

await step('Sleep: last night with stages, planner, 14 nights', async () => {
  await page.click('[data-testid="body-seg-sleep"]')
  await seen('[data-testid="last-night"]')
  await seen('[data-testid="stage-deep"]')
  await page.click('[data-testid="sleep-planner"]')
  await seen('[data-testid="planner-inputs"]')
  await seen('[data-testid="sleep-duration-chart"]')
  await noOverflow('Sleep')
})

await step('Training: sessions, load, HRR trend', async () => {
  await page.click('[data-testid="body-seg-training"]')
  await seen('[data-testid="training-view"]')
  await seen('[data-testid="hrr-trend"]')
  await noOverflow('Training')
})

await step('Measurements keeps its chips and adds the scale readings', async () => {
  await page.click('[data-testid="body-seg-measurements"]')
  await seen('[data-testid="measurements-health"]')
  await seen('[data-testid="health-entry-source"]')
  await seen('[data-testid="bodyfat-footnote"]')
  await noOverflow('Measurements')
})

await step('Calendar day sheet has the Health snapshot', async () => {
  await tab('Calendar')
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await seen('[data-testid="day-workout-marker"]')
  const cell = page.locator(`[data-testid="cal-cell-${today}"], [data-testid="cal-day-${today}"]`).first()
  if (await cell.count()) {
    await cell.click()
    await seen('[data-testid="day-health"]')
    await closeSheet()
  } else {
    throw new Error('no calendar cell for today')
  }
})

await step('History › compound shows its Health before and after', async () => {
  await tab('More')
  await page.click('[data-testid="more-history"]')
  await page.waitForTimeout(600)
  const row = page.locator('[data-testid="tenure-row"]').first()
  if (!(await row.count())) { console.log('  (no compounds in this profile; skipped)'); return }
  await row.click()
  await seen('[data-testid="compound-detail"]')
  await seen('[data-testid="compound-health"]')
  await noOverflow('Compound detail')
  await closeSheet()
})

await browser.close()
if (errors.length) { console.log('FAIL console clean —', errors.slice(0, 5).join(' | ')); failures++ } else console.log('PASS console clean')
process.exit(failures ? 1 : 0)
