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
  await seen('[data-testid="trend-chart-readiness"] [data-testid="chart-point"]')
  await page.click('[data-testid="readiness-info-button"]')
  await seen('[data-testid="readiness-info"]')
  await closeSheet()
  const hrv = page.locator('[data-testid="trend-chart-hrv"]')
  await hrv.locator('[data-testid="overlay-button"]').click()
  await hrv.locator('[data-testid="ov-wobble"]').click()
  await hrv.locator('[data-testid="wobble-band"]').waitFor({ timeout: 5000 })
  if (await hrv.locator('[data-testid="ov-ticks"]').count()) throw new Error('dose tick rows are still offered')
  await hrv.locator('[data-testid="range-30D"]').click()
  if ((await hrv.getAttribute('data-bucket')) !== 'day') throw new Error('30 days is not daily')
  await hrv.locator('[data-testid="range-6M"]').click()
  if ((await hrv.getAttribute('data-bucket')) !== 'week') throw new Error('6 months is not weekly')
  await hrv.locator('[data-testid="chart-hit"]').last().click()
  await hrv.locator('[data-testid="point-popover"]').waitFor({ timeout: 3000 })
  const pin = hrv.locator('[data-testid="chart-pin"]').first()
  if (await pin.count()) { await pin.click(); await hrv.locator('[data-testid="pin-popover"]').waitFor({ timeout: 3000 }) }
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
  // the default view is this week; on a Monday it may hold no workout yet
  console.log(`  workout markers in view: ${await page.locator('[data-testid="day-workout-marker"]').count()}`)
  const cell = page.locator(`[data-testid="cal-cell-${today}"], [data-testid="cal-day-${today}"]`).first()
  if (await cell.count()) {
    await cell.click()
    await seen('[data-testid="day-health"]')
    await closeSheet()
  } else {
    throw new Error('no calendar cell for today')
  }
})

await step('History › compound shows its phase cards', async () => {
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

await step('Stats tiles show the newest reading from any source, with date and source', async () => {
  await tab('Body')
  await page.click('[data-testid="body-seg-measurements"]')
  await page.click('[data-testid="body-section-stats"]')
  const src = await page.locator('[data-testid="tile-weight-source"]').innerText()
  if (!/, (Withings|Manual|Scan|Apple Health)/.test(src)) throw new Error(`weight tile source reads "${src}"`)
  const weekly = await page.locator('[data-testid="weight-weekly"]').innerText()
  if (/Needs/.test(weekly)) throw new Error('change per week still says it needs weigh-ins')
})

await step('Trends: overall progress chart and the metric chart', async () => {
  await page.click('[data-testid="body-section-trends"]')
  await seen('[data-testid="progress-chart"] [data-testid="legend-row"]')
  await seen('[data-testid="trends-chart"] [data-testid="chart-label"]')
  await noOverflow('Trends')
})

await step('Effects: phase cards newest first, a row opens its chart', async () => {
  await page.click('[data-testid="body-section-effects"]')
  await seen('[data-testid="phase-card"]')
  const titles = await page.locator('[data-testid="phase-title"]').allInnerTexts()
  if (titles.at(-1) !== 'Before tracking') throw new Error(`last card is "${titles.at(-1)}"`)
  const text = await page.locator('[data-testid="effects-view"]').innerText()
  if (/caused|improved|worked/i.test(text)) throw new Error('causal wording in Effects')
  await page.locator('[data-testid="phase-row"]').first().click()
  await seen('[data-testid="effects-chart"] [data-testid="chart-point"]')
  await closeSheet()
  await noOverflow('Effects')
})

await step('Target wake time: set, then reset to auto', async () => {
  await tab('More')
  await page.click('[data-testid="more-health"]')
  const field = page.locator('[data-testid="health-wake-target"]')
  if (!/Auto/.test(await field.innerText())) throw new Error('unset wake time does not read Auto')
  await field.click()
  await page.fill('[data-testid="health-wake-target-input"]', '06:30')
  await page.click('[data-testid="health-wake-target-done"]')
  await page.waitForTimeout(300)
  if (!/06:30/.test(await field.innerText())) throw new Error('wake time did not save')
  await page.click('[data-testid="health-wake-target-clear"]')
  await page.waitForTimeout(300)
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.healthSettings.wakeTarget)
  if (st !== null) throw new Error(`wake time stored as ${st}`)
  const box = await field.boundingBox()
  if (box.x + box.width > 390) throw new Error('wake time field overflows')
  await seen('[data-testid="health-track-effects"]')
  await noOverflow('More › Health')
})

await browser.close()
if (errors.length) { console.log('FAIL console clean —', errors.slice(0, 5).join(' | ')); failures++ } else console.log('PASS console clean')
process.exit(failures ? 1 : 0)
