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
  catch (e) { failures++; console.log('FAIL', name, '—', e.message.split('\n').slice(0, process.env.VERBOSE ? 8 : 1).join(' | ')) }
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
  await tab('Sleep')
  await seen('[data-testid="last-night"]')
  await seen('[data-testid="stage-deep"]')
  await page.click('[data-testid="sleep-planner"]')
  await seen('[data-testid="planner-inputs"]')
  await seen('[data-testid="sleep-duration-chart"]')
  await noOverflow('Sleep')
})

await step('Training: sessions, load, HRR trend', async () => {
  await tab('Body')
  await page.click('[data-testid="body-seg-training"]')
  await seen('[data-testid="training-view"]')
  await seen('[data-testid="hrr-trend"]')
  await noOverflow('Training')
})

await step('Measurements keeps its chips and adds the scale readings', async () => {
  await page.click('[data-testid="body-seg-composition"]')
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

await step('History › compound shows its Effects page', async () => {
  await tab('More')
  await page.click('[data-testid="more-history"]')
  await page.waitForTimeout(600)
  const row = page.locator('[data-testid="tenure-row"]').first()
  if (!(await row.count())) { console.log('  (no compounds in this profile; skipped)'); return }
  await row.click()
  await seen('[data-testid="compound-detail"]')
  await seen('[data-testid="compound-health"] [data-testid="effects-since"]')
  await noOverflow('Compound detail')
  await closeSheet()
})

await step('Composition hero: the newest weight from any source, with date and source', async () => {
  await tab('Body')
  await page.click('[data-testid="body-seg-composition"]')
  await seen('[data-testid="hero-weight"]')
  const hero = await page.locator('[data-testid="composition-hero"]').innerText()
  if (!/, (Withings|Manual|Scan|Apple Health)/.test(hero)) throw new Error(`hero source line missing: "${hero}"`)
  await page.click('[data-testid="body-section-stats"]')
  const weekly = await page.locator('[data-testid="weight-weekly"]').innerText()
  if (/Needs/.test(weekly)) throw new Error('change per week still says it needs weigh-ins')
})

await step('Trends: overall progress chart and the metric chart', async () => {
  await page.click('[data-testid="body-section-trends"]')
  await seen('[data-testid="progress-chart"] [data-testid="legend-row"]')
  await seen('[data-testid="trends-chart"] [data-testid="chart-label"]')
  await noOverflow('Trends')
})

await step('Effects: one row per tracked compound, each opening its own page', async () => {
  await page.click('[data-testid="body-seg-effects"]')
  await seen('[data-testid="effects-compound"]')
  if (await page.locator('[data-testid="phase-card"]').count()) throw new Error('the old combined phase cards are still there')
  await page.locator('[data-testid="effects-compound"]').first().click()
  await seen('[data-testid="compound-effects"]')
  await seen('[data-testid="effects-since"]')
  await seen('[data-testid="effects-clean"]')
  await seen('[data-testid="dose-strip"]')
  const text = await page.locator('[data-testid="compound-effects"]').innerText()
  if (/caused|improved|worked/i.test(text)) throw new Error('causal wording in Effects')
  // the demo protocol starts every compound on the same day: the overlap is named
  if (!/Changes in this section are shared with/.test(text)) throw new Error('no overlap warning for compounds started together')
  await noOverflow('Effects compound page')
  await page.click('[data-testid="effects-back"]')
  await seen('[data-testid="effects-view"]')
})

await step('Charts: a compound lane under the axis, a tapped change draws a guide', async () => {
  await page.click('[data-testid="body-seg-recovery"]')
  const hrv = page.locator('[data-testid="trend-chart-hrv"]')
  await hrv.locator('[data-testid="overlay-button"]').click()
  const toggles = hrv.locator('[data-testid^="lane-toggle-"]')
  if ((await toggles.count()) < 1) throw new Error('no compounds in the Overlay menu')
  await toggles.first().click()
  await hrv.locator('[data-testid^="lane-"] path').first().waitFor({ timeout: 5000 })
  const change = hrv.locator('[data-testid="lane-change"]').first()
  if (await change.count()) {
    await change.click()
    await hrv.locator('[data-testid="lane-guide"]').waitFor({ state: 'attached', timeout: 3000 }) // a vertical line has no width, so 'visible' never holds
    await hrv.locator('[data-testid="lane-popover"]').waitFor({ timeout: 3000 })
  }
  if (await hrv.locator('[data-testid="ov-ticks"]').count()) throw new Error('dose tick rows came back')
  await noOverflow('Recovery with a lane')
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

await step('Starting point: v22 imports the Evolt history and every "since" counts from 13 Jan 2025', async () => {
  // make this profile look like one saved before v21, then reopen the app
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    raw.version = 21
    raw.state.bodyStart = null
    raw.state.measurements = (raw.state.measurements || []).filter((m) => m.source !== 'scan')
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1500)
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state)
  if (st.bodyStart?.date !== '2025-01-13' || st.bodyStart?.values?.weight !== 105.6) throw new Error('the Evolt start was not set')
  const scans = st.measurements.filter((m) => m.source === 'scan' && !m.estimated)
  if (scans.length !== 15) throw new Error(`${scans.length} Evolt scans imported, expected 15`)
  if (!st.measurements.some((m) => m.id === 'm-evolt-2025-01-13-start' && m.hiddenFromCharts)) throw new Error('the adjusted start scan is missing or on the charts')
  await tab('Body')
  await page.click('[data-testid="body-seg-composition"]')
  await page.click('[data-testid="body-section-stats"]')
  const delta = await page.locator('[data-testid="hero-since"]').innerText()
  if (!/^Down .* kg since 13 Jan 2025$/.test(delta)) throw new Error(`weight change reads "${delta}"`)
  // body fat compares Evolt with Evolt
  const bfTile = await page.locator('[data-testid="key-tile-bodyFat"]').innerText()
  if (!/12 Oct, Evolt 360/.test(bfTile) || !/−6\.7 pts since 13 Jan 2025/.test(bfTile)) throw new Error(`body fat tile reads "${bfTile}", expected Evolt against Evolt`)
  const lost = await page.locator('[data-testid="lost-line"]').innerText()
  if (lost !== 'Down 9.3 kg since 13 Jan 2025.') throw new Error(`lost card reads "${lost}"`)
  if (!/91% of the loss was fat/.test(await page.locator('[data-testid="lost-card"]').innerText())) throw new Error('no fat share')
  await seen('[data-testid="lost-estimate"]')
  await noOverflow('Stats with starting point')
})

await step('Starting point sheet: use an entry, enter manually, reset to default', async () => {
  await page.click('[data-testid="hero-since"]')
  await seen('[data-testid="start-sheet"]')
  await seen('[data-testid="start-entry"]')
  // newest first
  const dates = await page.locator('[data-testid="start-entry"] span.w-\\[84px\\]').allInnerTexts()
  if (dates.length > 1 && new Date(dates[0]) < new Date(dates.at(-1))) throw new Error('entries are not newest first')
  await page.click('[data-testid="start-reset"]')
  await page.waitForTimeout(400)
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.bodyStart)
  if (st !== null) throw new Error('reset did not clear the starting point')
  await page.click('[data-testid="edit-start"]')
  await page.click('[data-testid="start-mode-manual"]')
  await page.click('[data-testid="start-date"]')
  await page.fill('[data-testid="start-date-input"]', '2025-02-01')
  await page.click('[data-testid="start-date-done"]')
  await page.fill('[data-testid="start-field-weight"]', '104')
  await page.click('[data-testid="start-save"]')
  await page.waitForTimeout(400)
  st = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.bodyStart)
  if (st?.date !== '2025-02-01' || st.values.weight !== 104) throw new Error(`manual start stored as ${JSON.stringify(st)}`)
  if (!/since 1 Feb 2025/.test(await page.locator('[data-testid="hero-since"]').innerText())) throw new Error('hero did not follow the manual start')
  // back to the Evolt scan, from the list
  await page.click('[data-testid="edit-start"]')
  await page.click('[data-testid="start-kind-scan"]')
  await page.click('[data-testid="start-entry"][data-entry="m-evolt-2025-01-13-start"]')
  await page.waitForTimeout(400)
  st = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.bodyStart)
  if (st?.entryId !== 'm-evolt-2025-01-13-start' || st.values.skeletalMuscleMass !== 35.6) throw new Error('picking the Evolt entry did not set it')
})

await step('Scan detail shows the device, estimate note and grouped extras', async () => {
  await page.click('[data-testid="edit-start"]')
  await page.click('[data-testid="start-view-entry"]')
  await seen('[data-testid="scan-details"]')
  if ((await page.locator('[data-testid="entry-device"]').inputValue()) !== 'Evolt 360') throw new Error('device not shown')
  await seen('[data-testid="entry-estimate-note"]')
  for (const g of ['Composition', 'Segmental', 'Energy', 'Scores']) await seen(`[data-testid="extras-${g}"]`)
  await page.click('[data-testid="entry-cancel"]')
  await page.waitForTimeout(400)
})

await step('Trends: Start line on the weight chart, one weight on 13 Jan 2025', async () => {
  await page.click('[data-testid="body-section-trends"]')
  await page.click('[data-testid="trend-chip-weight"]')
  const chart = page.locator('[data-testid="trends-chart"]')
  await chart.locator('[data-testid="chart-start-line"]').waitFor({ timeout: 5000 })
  await page.locator('[data-testid="legend-since"]').first().waitFor({ timeout: 5000 })
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.measurements.filter((m) => m.date === '2025-01-13'))
  if (st.length !== 2 || st.filter((m) => m.hiddenFromCharts).length !== 1) throw new Error('13 Jan should hold the real scan and the hidden adjusted start')
  await noOverflow('Trends with start line')
})

await step('Composition: all metrics, body map, scan compare, goal and device charts', async () => {
  await tab('Home'); await tab('Body')
  await page.click('[data-testid="all-metrics-toggle"]')
  for (const g of ['Composition', 'Fat distribution', 'Water', 'Energy', 'Scores', 'Index']) await seen(`[data-testid="metric-group-${g}"]`)
  const ffmi = await page.locator('[data-testid="metric-row-ffmi"]').innerText()
  if (!/22\.1/.test(ffmi)) throw new Error(`FFMI reads "${ffmi}"`)
  // skeletal muscle is its own row; the scale's "muscle mass" never shows a scan value
  await seen('[data-testid="metric-row-skeletalMuscleMass"]')
  await page.click('[data-testid="metric-row-visceralFatArea"]')
  await seen('[data-testid="metric-sheet"] [data-testid="chart-ref-band"]')
  await closeSheet()
  await seen('[data-testid="segment-map"]')
  if ((await page.getAttribute('[data-testid="segment-torso"]', 'data-tone')) !== 'bad') throw new Error('torso lean fell 0.28 kg since the first scan: should read amber')
  await page.click('[data-testid="segment-kind-fat"]')
  if ((await page.getAttribute('[data-testid="segment-torso"]', 'data-tone')) !== 'good') throw new Error('torso fat fell: should read in the accent')
  await seen('[data-testid="scan-compare"] [data-testid="compare-row"]')
  await page.click('[data-testid="goal-edit"]')
  await page.fill('[data-testid="goal-weight"]', '80')
  await page.click('[data-testid="goal-edit"]')
  await seen('[data-testid="goal-weight-line"]')
  await seen('[data-testid="family-chart-bodyFat"] [data-testid="family-line-evolt"]')
  await page.click('[data-testid="family-toggle-evolt"]')
  if (await page.locator('[data-testid="family-chart-bodyFat"] [data-testid="family-line-evolt"]').count()) throw new Error('turning Evolt off left its line')
  await seen('[data-testid="weekly-bars"]')
  await noOverflow('Composition')
})

await browser.close()
if (errors.length) { console.log('FAIL console clean —', errors.slice(0, 5).join(' | ')); failures++ } else console.log('PASS console clean')
process.exit(failures ? 1 : 0)
