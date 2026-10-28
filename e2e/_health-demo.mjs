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
  catch (e) { failures++; console.log('FAIL', name, '–', e.message.split('\n').slice(0, process.env.VERBOSE ? 8 : 1).join(' | ')) }
}
const gotIt = async () => {
  const b = page.locator('button:has-text("Got it")')
  if (!(await b.count())) return
  try { await b.first().click({ timeout: 3000 }) } catch { /* left alone */ }
  await page.waitForTimeout(300)
}
const tab = async (label) => { await page.click(`nav button[aria-label="${label}"]`); await page.waitForTimeout(600) }
const seen = (sel, timeout = 8000) => page.waitForSelector(sel, { timeout }).catch((e) => { throw new Error(`not found: ${sel}`) })
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

await step('Home is the readiness card, then the log, then the sauna row', async () => {
  await tab('Home')
  await seen('[data-testid="home-health-card"]')
  if (await page.locator('[data-testid="home-checkin-toggle"]').count()) throw new Error('the check-in is still on Home')
  const order = await page.evaluate(() => {
    const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? null
    return { card: y('[data-testid="home-health-card"]'), log: y('h1'), sauna: y('[data-testid="home-sauna-row"]') }
  })
  if (!(order.card < order.log && order.log < order.sauna)) throw new Error(`Home order ${JSON.stringify(order)}`)
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

await step('Sleep: hero, hypnogram, breakdown, stages, vitals, timing, plan, factors, trends, naps', async () => {
  await tab('Sleep')
  await seen('[data-testid="last-night"]')
  const score = Number(await page.textContent('[data-testid="sleep-score"]'))
  if (!(score >= 0 && score <= 100)) throw new Error(`score ${score}`)
  // hypnogram: four rows, a tap names the stretch
  await seen('[data-testid="hypnogram"]')
  await page.locator('[data-testid="hypno-seg-deep"]').first().click()
  const detail = await page.textContent('[data-testid="hypno-detail"]')
  if (!/^Deep · \d\d:\d\d to \d\d:\d\d · /.test(detail)) throw new Error(`hypno detail: ${detail}`)
  // press and drag: one line through every lane, the panel says what each lane says at that minute
  const box = await page.locator('[data-testid="night-card"] [data-testid="hypnogram"]').boundingBox()
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 6 })
  await page.mouse.up()
  await page.locator('[data-testid="night-crosshair"]').waitFor({ state: 'attached', timeout: 5000 })
  if (!/^\d\d:\d\d · /.test(await page.textContent('[data-testid="cross-time"]'))) throw new Error('crosshair panel has no time')
  await seen('[data-testid="night-summary"]')
  if (await page.locator('[data-testid="happened-row"]').count()) {
    await page.locator('[data-testid="happened-row"]').first().click()
    await page.locator('[data-testid="night-crosshair"]').waitFor({ state: 'attached', timeout: 5000 })
  }
  // lane info, then full screen with zoom down to 30 minutes
  await page.locator('[data-testid="night-card"] [data-testid="lane-info-stages"]').dispatchEvent('pointerup')
  await seen('[data-testid="lane-info"]')
  await closeSheet()
  await page.click('[data-testid="night-expand"]')
  await seen('[data-testid="night-fullscreen"]')
  for (let i = 0; i < 6; i++) await page.click('[data-testid="night-zoom-in"]')
  const win = await page.textContent('[data-testid="night-window"]')
  const [a, b] = win.split(' to ').map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5)))
  if (((b - a + 1440) % 1440) !== 30) throw new Error(`zoomed window is ${win}, expected 30 minutes`)
  await page.click('[data-testid="night-full-close"]')
  for (const k of ['duration', 'consistency', 'restorative', 'efficiency']) await seen(`[data-testid="part-${k}"]`)
  await seen('[data-testid="stage-deep"] [data-testid="stage-typical"]')
  await seen('[data-testid="stage-deep"] [data-testid="stage-avg"]')
  await page.click('[data-testid="stages-info"]')
  await seen('[data-testid="stages-info-sheet"]')
  await closeSheet()
  const hr = await page.textContent('[data-testid="vital-hrMin"] [data-testid="vital-words"]')
  if (!/Usual|Needs|Not recorded/.test(hr)) throw new Error(`vital words: ${hr}`)
  await seen('[data-testid="chronogram"]')
  await seen('[data-testid="chrono-target"]')
  await page.click('[data-testid="timing-30"]')
  const bars = await page.locator('[data-testid="chrono-bar"]').count()
  if (bars < 25) throw new Error(`chronogram bars ${bars}`)
  const split = await page.textContent('[data-testid="weekend-split"]')
  if (!/Weekend|weekday/.test(split)) throw new Error(`weekend split: ${split}`)
  await seen('[data-testid="debt-bars"]')
  await page.click('[data-testid="sleep-planner"]')
  await seen('[data-testid="planner-inputs"]')
  if (!/^Start winding down at \d\d:\d\d$/.test(await page.textContent('[data-testid="wind-down"]'))) throw new Error('wind down')
  // the evening entry point and the Sleep Lab links
  await seen('[data-testid="log-habits"]')
  await seen('[data-testid="lab-open-analysis"]')
  await seen('[data-testid="night-card"] [data-testid="strip-hr"]')
  await seen('[data-testid="sleep-duration-chart"]')
  await seen('[data-testid="trend-chart-bedtime"]')
  await seen('[data-testid="naps"]')
  // the date switcher and the calendar of nights
  await page.click('[data-testid="sleep-prev"]')
  if ((await page.textContent('[data-testid="sleep-date"]')) !== 'The night before') throw new Error('prev night')
  await page.click('[data-testid="sleep-date"]')
  await seen('[data-testid="sleep-calendar"]')
  await noOverflow('Sleep')
  await closeSheet()
})

await step('Body has Composition, Effects and Recovery; no Training', async () => {
  await tab('Body')
  const segs = await page.locator('[data-testid^="body-seg-"]').allTextContents()
  if (segs.join('|') !== 'Composition|Effects|Recovery') throw new Error(`segments ${segs}`)
})

await step('Measurements keeps its chips and adds the scale readings', async () => {
  await page.click('[data-testid="body-seg-composition"]')
  await seen('[data-testid="measurements-health"]')
  await seen('[data-testid="health-entry-source"]')
  await seen('[data-testid="bodyfat-footnote"]')
  await noOverflow('Measurements')
})

await step('Calendar day sheet has the Health snapshot', async () => {
  await tab('More')
  await page.click('[data-testid="more-calendar"]')
  await page.waitForTimeout(600)
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

await step('Composition hero: a weight with its date and source', async () => {
  await tab('Body')
  await page.click('[data-testid="body-seg-composition"]')
  await seen('[data-testid="hero-weight"]')
  // before the Evolt history is imported this is the Scale weight; box 1 is checked once the scans are in
  const hero = await page.locator('[data-testid="scan-box"], [data-testid="composition-hero"]').first().innerText()
  if (!/, (Withings|Manual|Scan|Apple Health|Evolt 360)/.test(hero)) throw new Error(`hero source line missing: "${hero}"`)
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

await step('Starting point: v22 imports the Evolt history and every "since" counts from 1 Jan 2025', async () => {
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
  if (st.bodyStart?.date !== '2025-01-01' || st.bodyStart?.values?.weight !== 105.6) throw new Error('the Evolt start was not set')
  const scans = st.measurements.filter((m) => m.source === 'scan' && !m.estimated)
  if (scans.length !== 15) throw new Error(`${scans.length} Evolt scans imported, expected 15`)
  if (!st.measurements.some((m) => m.id === 'm-evolt-2025-01-01-start' && m.estimated && !m.hiddenFromCharts && m.date === '2025-01-01')) throw new Error('the estimated start entry is missing or not on 1 Jan 2025')
  await tab('Body')
  await page.click('[data-testid="body-seg-composition"]')
  await page.click('[data-testid="body-section-stats"]')
  const delta = await page.locator('[data-testid="hero-since"]').innerText()
  if (!/^Down \d+\.\d kg since 1 Jan 2025$/.test(delta)) throw new Error(`weight change reads "${delta}"`)
  // body fat compares Evolt with Evolt
  const bfTile = await page.locator('[data-testid="key-tile-bodyFat"]').innerText() + ' ' + await page.locator('[data-testid="key-tile-bodyFat-delta"]').getAttribute('aria-label')
  if (!/12 Oct, Evolt 360/.test(bfTile) || !/−6\.7 pts since 1 Jan 2025/.test(bfTile)) throw new Error(`body fat tile reads "${bfTile}", expected Evolt against Evolt`)
  const lines = await page.locator('[data-testid="start-lines"]').innerText()
  if (!/Body fat mass\s+40\.4/.test(lines) || !/Body fat\s+38\.3/.test(lines) || !/Lean mass\s+65\.2/.test(lines)) throw new Error(`since start lines read "${lines}"`)
  if (!/^Estimated start\./.test(await page.locator('[data-testid="start-note"]').innerText())) throw new Error('no estimate note')
  if (/13 Jan 2025/.test(await page.locator('[data-testid="scan-box"]').innerText() + await page.locator('[data-testid="start-box"]').innerText())) throw new Error('the 13 Jan 2025 Evolt to Evolt line is still in the boxes')
  if (await page.locator('[data-testid="lost-card"], [data-testid="composition-hero"]').count()) throw new Error('the old weight card or the Evolt to Evolt card is still there')
  // box 1: the latest Evolt scan against the one before
  const src = await page.locator('[data-testid="hero-source"]').innerText()
  if (!/^\d+ \w+ \d{4}, Evolt 360$/.test(src)) throw new Error(`hero source line reads "${src}"`)
  const change = await page.locator('[data-testid="scan-change"]').innerText()
  if (!/^(Down|Up) \d+\.\d kg since \d+ \w+$|^No change since/.test(change)) throw new Error(`scan change reads "${change}"`)
  await seen('[data-testid="scan-lines-fatMass"]')
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
  await page.click('[data-testid="start-entry"][data-entry="m-evolt-2025-01-01-start"]')
  await page.waitForTimeout(400)
  st = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.bodyStart)
  if (st?.entryId !== 'm-evolt-2025-01-01-start' || st.values.skeletalMuscleMass !== 35.6) throw new Error('picking the Evolt entry did not set it')
})

await step('Scan detail shows the device, estimate note and grouped extras', async () => {
  await page.click('[data-testid="edit-start"]')
  await page.click('[data-testid="start-view-entry"]')
  await seen('[data-testid="scan-details"]')
  const head = await page.locator('[data-testid="scan-details"] p').first().innerText()
  if (!/^Evolt 360 · Start \(estimated\) · estimated$/.test(head)) throw new Error(`scan header reads "${head}"`)
  await seen('[data-testid="entry-estimate-note"]')
  for (const g of ['Composition', 'Segmental', 'Energy', 'Scores']) await seen(`[data-testid="extras-${g}"]`)
  await page.click('[data-testid="entry-cancel"]')
  await page.waitForTimeout(400)
})

await step('Trends: Start line on the weight chart, the start entry on 1 Jan 2025', async () => {
  await page.click('[data-testid="body-section-trends"]')
  await page.click('[data-testid="trend-chip-weight"]')
  const chart = page.locator('[data-testid="trends-chart"]')
  await chart.locator('[data-testid="chart-start-line"]').waitFor({ state: 'attached', timeout: 5000 })
  await page.locator('[data-testid="legend-since"]').first().waitFor({ timeout: 5000 })
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('peptide-command-center')).state.measurements.filter((m) => m.date === '2025-01-01'))
  if (st.length !== 1 || st[0].device !== 'Evolt 360' || !st[0].estimated) throw new Error('1 Jan 2025 should hold the one estimated Evolt start')
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
  await seen('[data-testid="metric-sheet"] [data-testid="chart-ref-band"], [data-testid="metric-sheet"] [data-testid="chart-off-range"]')
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
  // body fat is one source at a time: Evolt by default, joined by a line, with Scale a tap away
  await seen('[data-testid="family-chart-bodyFat"] [data-testid="chart-segment"]')
  if ((await page.getAttribute('[data-testid="family-chart-bodyFat"] [data-testid="source-evolt"]', 'data-on')) !== 'true') throw new Error('body fat should default to Evolt')
  await page.click('[data-testid="family-chart-bodyFat"] [data-testid="source-scale"]')
  await seen('[data-testid="family-chart-bodyFat"] [data-testid="chart-segment"]')
  await page.click('[data-testid="family-chart-bodyFat"] [data-testid="source-evolt"]')
  // scan to scan replaces the weekly bars: one group per Evolt scan, fat and lean
  if (await page.locator('[data-testid="weekly-bars"]').count()) throw new Error('the weekly bars are still there')
  const groups = await page.locator('[data-testid="scan-steps"] [data-testid="step-group"]').count()
  if (groups < 2) throw new Error(`scan to scan has ${groups} groups`)
  await seen('[data-testid="scan-steps"] [data-testid="step-fat"]')
  // a tap on the weight chart opens it full screen, zoom stays inside the range
  await page.click('[data-testid="composition-weight-chart"] [data-testid="chart-expand"]')
  await seen('[data-testid="chart-fullscreen"] [data-testid="chart-full"]')
  const before = await page.getAttribute('[data-testid="chart-full"]', 'data-from')
  await page.click('[data-testid="zoom-in"]')
  const after = await page.getAttribute('[data-testid="chart-full"]', 'data-from')
  if (!(after > before)) throw new Error(`zoom in did not narrow the window (${before} to ${after})`)
  await page.click('[data-testid="chart-full-close"]')
  if (await page.locator('[data-testid="chart-fullscreen"]').count()) throw new Error('full screen did not close')
  await noOverflow('Composition')
})


const todayIso = () => page.evaluate(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

await step('Sauna: a normal session is two taps, and the hero counts it', async () => {
  await tab('Sauna')
  await seen('[data-testid="sauna-hero"]')
  await page.click('[data-testid="sauna-log"]')
  await seen('[data-testid="sauna-log-sheet"]')
  if ((await page.textContent('[data-testid="sauna-length-value"]')).trim() !== '20min') throw new Error('length is not the usual 20')
  await page.click('[data-testid="sauna-save"]')
  // the optional rating step comes straight after
  await seen('[data-testid="sauna-rating-sheet"]')
  await page.click('[data-testid="sauna-feel-4"]')
  await page.click('[data-testid="sauna-rate-electrolytes"]')
  await page.click('[data-testid="sauna-water-plus"]')
  await page.click('[data-testid="sauna-rate-save"]')
  await page.waitForTimeout(500)
  if ((await page.getAttribute('[data-testid="sauna-week-ring"]', 'data-count')) !== '1') throw new Error('the ring did not count the session')
  if ((await page.textContent('[data-testid="sauna-rating-line"]')).trim() !== 'Felt 4 of 5 · Electrolytes after · 100 ml water') throw new Error('rating line')
  if ((await page.textContent('[data-testid="sauna-typical"]')).trim() !== 'Typical: 20 min at 60 C') throw new Error('typical line')
  // the last session card: tonight is not in yet
  await seen('[data-testid="sauna-last-card"]')
  if (!/Available tomorrow/.test(await page.textContent('[data-testid="sauna-last-card"]'))) throw new Error('that night should be available tomorrow')
  await noOverflow('Sauna')
})

await step('Sauna timer: elapsed time, no heat note, stop opens the log prefilled', async () => {
  await page.click('[data-testid="sauna-timer"]')
  await seen('[data-testid="sauna-timer-sheet"]')
  await page.click('[data-testid="timer-rounds-plus"]')
  await page.click('[data-testid="timer-start"]')
  await seen('[data-testid="sauna-running"]')
  // no heat or temperature warnings anywhere
  if (await page.locator('[data-testid="timer-note"]').count()) throw new Error('timer note is gone')
  if (await page.locator('[data-testid="round-marker"]').count() !== 1) throw new Error('round marker')
  await page.waitForTimeout(1300)
  if (!/^00:0[1-9]$/.test(await page.textContent('[data-testid="timer-elapsed"]'))) throw new Error('timer is not counting')
  // a reload keeps the time: it is worked out from the stored start
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await tab('Sauna')
  await seen('[data-testid="sauna-running"]')
  await page.click('[data-testid="timer-stop"]')
  await seen('[data-testid="sauna-log-sheet"]')
  if ((await page.textContent('[data-testid="sauna-length-value"]')).trim() !== '1min') throw new Error('stopped timer did not prefill one minute')
  await page.click('[data-testid="sauna-save"]')
  await seen('[data-testid="sauna-rating-sheet"]')
  await page.click('[data-testid="sauna-rate-skip"]')
  await page.waitForTimeout(400)
  if ((await page.getAttribute('[data-testid="sauna-week-ring"]', 'data-count')) !== '2') throw new Error('timer session not saved')
})

await step('Sauna: Apple Watch "Was this a sauna?" asks only the temperature', async () => {
  await seen('[data-testid="sauna-watch-card"]', 15000)
  const before = await page.locator('[data-testid="sauna-watch-card"]').count()
  await page.locator('[data-testid="sauna-watch-confirm"]').first().click()
  await seen('[data-testid="sauna-log-sheet"]')
  if (await page.locator('[data-testid="sauna-length"]').count()) throw new Error('confirm asked for more than the temperature')
  await page.click('[data-testid="sauna-temp-plus"]')
  await page.click('[data-testid="sauna-save"]')
  await page.waitForTimeout(500)
  const after = await page.locator('[data-testid="sauna-watch-card"]').count()
  if (after > before - 1 && after === 3 && before === 3) console.log('  (more candidates waiting)')
  if (await page.locator('[data-testid="sauna-watch-dismiss"]').count()) await page.locator('[data-testid="sauna-watch-dismiss"]').first().click()
})

await step('Sauna history, session detail with heart rate, effects and the info sheet', async () => {
  await seen('[data-testid="sauna-heatmap"]')
  // the grid starts at the week of the first session: whole weeks, never more than 12
  const cells = await page.locator('[data-testid="heat-cell"]').count()
  if (cells % 7 !== 0 || cells < 7 || cells > 84) throw new Error(`heatmap has ${cells} cells`)
  await seen('[data-testid="sauna-totals"]')
  // the Watch-confirmed session is the one with heart rate
  const rows = page.locator('[data-testid="sauna-list-row"]')
  let hr = false
  for (let i = 0; i < await rows.count(); i++) {
    await rows.nth(i).click()
    await seen('[data-testid="sauna-session-sheet"]')
    await page.waitForTimeout(400)
    if (await page.locator('[data-testid="sauna-hr"]').count()) { hr = true; await seen('[data-testid="sauna-zones"]') }
    await closeSheet()
    if (hr) break
  }
  if (!hr) throw new Error('no session showed Watch heart rate')
  // the length and temperature charts are gone; every early section is one locked line
  if (await page.locator('[data-testid="trend-chart-saunaLength"], [data-testid="trend-chart-saunaTemp"]').count()) throw new Error('session length or temperature chart is back')
  await seen('[data-testid="sauna-adaptation-locked"]')
  if (!/^Too early: needs 6 sessions (at \d+ to \d+ C|with Watch heart rate) \(you have \d\)$/.test((await page.textContent('[data-testid="sauna-adaptation-locked"]')).trim())) throw new Error('adaptation lock line')
  await seen('[data-testid="sauna-patterns-locked"]')
  if (!/^Needs 7 sauna days to compare\. You have \d\.$/.test((await page.textContent('[data-testid="sauna-patterns-locked"]')).trim())) throw new Error('patterns lock line')
  // since you started and inside sauna days lead the patterns; each locked line says what it needs and has
  await seen('[data-testid="sauna-before-since"]')
  await seen('[data-testid="sauna-within"]')
  if (!/^Needs 5 evening sessions/.test((await page.textContent('[data-testid="sauna-within-evening-locked"]')).trim())) throw new Error('within lock line')
  if (!/^\d+ sessions? this week · target \d+$/.test(await page.textContent('[data-testid="sauna-week-header"]'))) throw new Error('week header')
  if (await page.locator('[data-testid="sauna-pattern-row"]').count()) throw new Error('pattern rows before they unlock')
  await seen('[data-testid="sauna-longer-locked"]')
  if (await page.locator('[data-testid="sauna-weekly-rhr"], [data-testid="sauna-weekly-hrv"]').count()) throw new Error('the weekly scatter is back')
  const tabText = await page.textContent('[data-testid="sauna-tab"]')
  // "Too early: needs 6 sessions" is the heat adaptation verdict by design; causal words and em dashes never
  if (/caused|improved|worked|\u2014/i.test(tabText)) throw new Error('causal wording or an em dash')
  await page.click('[data-testid="sauna-info-open"]')
  await seen('[data-testid="sauna-info"]')
  await closeSheet()
  await noOverflow('Sauna')
})

await step('Sauna everywhere: chart lane, Effects entry, sleep factors, calendar day sheet', async () => {
  await tab('Body')
  await page.click('[data-testid="body-seg-recovery"]')
  const chart = page.locator('[data-testid="trend-chart-hrv"]').first()
  await chart.locator('[data-testid="overlay-button"]').click()
  await chart.locator('[data-testid="lane-toggle-sauna"]').click()
  await page.waitForTimeout(400)
  await chart.locator('[data-testid="lane-sauna"]').waitFor({ state: 'attached' })
  if (!(await chart.locator('[data-testid="lane-sauna-dot"]').count())) throw new Error('no sauna dots on the lane')
  await page.click('[data-testid="body-seg-effects"]')
  await page.click('[data-testid="effects-compound"][data-compound="sauna"]')
  await seen('[data-testid="effects-sauna"]')
  await page.click('[data-testid="effects-back"]')
  // sauna is an automatic factor in Sleep › Analysis
  await tab('Sleep')
  await page.click('[data-testid="lab-open-analysis"]')
  await seen('[data-testid="lab-factors"], [data-testid="lab-locked"]', 30000)
  const lab = await page.textContent('[data-testid="lab-analysis"]')
  if (!/Sauna/.test(lab)) throw new Error('sauna missing from the analysis')
  if (/caused|improved|worked/i.test(lab)) throw new Error('causal wording')
  await page.click('[data-testid="lab-back"]')
  await tab('More')
  await page.click('[data-testid="more-calendar"]')
  await page.waitForTimeout(600)
  const t = await todayIso()
  await page.locator(`[data-testid="cal-cell-${t}"], [data-testid="cal-day-${t}"]`).first().click()
  await seen('[data-testid="day-sauna"]')
  await closeSheet()
})

await step('Sleep: "Log this evening" opens the evening sheet, tonight and past evenings', async () => {
  await tab('Sleep')
  await page.click('[data-testid="log-habits"]')
  await seen('[data-testid="evening-sheet"]')
  await page.click('[data-testid="evening-drinks-plus"]')
  if (!/^1 drink$/.test((await page.textContent('[data-testid="evening-drinks"]')).trim())) throw new Error('drinks stepper')
  await page.click('[data-testid="evening-stress"]')
  await page.click('[data-testid="evening-prev"]')
  if ((await page.textContent('[data-testid="evening-date"]')) !== 'Last night') throw new Error('past evenings')
  await page.click('[data-testid="evening-nothing"]')
  await closeSheet()
  // the morning check sits on top until answered
  await seen('[data-testid="morning-check"]')
  await page.click('[data-testid="morning-rested-4"]')
  await page.click('[data-testid="morning-done"]')
  if (await page.locator('[data-testid="morning-check"]').count()) throw new Error('morning check still showing')
})

await step('Sleep sounds: row, last night, timeline, trend, session log, settings', async () => {
  // a session spanning the demo night, with a snoring burst every 20 minutes, filed under today
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('peptide-command-center'))
    const d = new Date()
    const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const end = Date.now() - 3600000
    const start = end - 25 * 3600000
    const events = []
    for (let i = 0; i < 70; i++) events.push({ s: start + i * 20 * 60000, e: start + i * 20 * 60000 + 4 * 60000, label: 'snoring', c: 0.8 })
    events.push({ s: start + 5 * 3600000, e: start + 5 * 3600000 + 2000, label: 'cough', c: 0.9 })
    const levels = Array.from({ length: 1500 }, (_, i) => [start + i * 60000, i % 200 < 3 ? -30 : -58])
    const gaps = Array.from({ length: 12 }, (_, i) => ({ s: start + (i * 2 + 1) * 3600000 + 600000, e: start + (i * 2 + 1) * 3600000 + 1500000, reason: 'interrupted' }))
    const session = { id: 'ss-demo', start, end, events, levels, loudMinutes: 6, movingMinutes: 0, lowConfidence: false, room: [], startedBy: 'shortcut', stopReason: 'focusOff', gaps, checkpoints: 300, open: false, recovered: false }
    raw.state.nightExtras = { ...(raw.state.nightExtras || {}), [t]: { ...((raw.state.nightExtras || {})[t] || {}), sounds: [session] } }
    raw.state.sleepSettings = { ...(raw.state.sleepSettings || {}), sleepSounds: true }
    raw.state.soundsLog = [{ at: end - 9 * 3600000, kind: 'start', by: 'shortcut', result: 'blockedLocked', error: 'error 561145187' }]
    localStorage.setItem('peptide-command-center', JSON.stringify(raw))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1500)
  await tab('Sleep')
  await seen('[data-testid="sounds-row"]')
  const line = await page.textContent('[data-testid="sounds-line"]')
  if (!/^Last night: .* snoring/.test(line)) throw new Error(`row reads "${line}"`)
  if (!/^Snoring /.test((await page.textContent('[data-testid="hero-snoring"]')).trim())) throw new Error('no snoring line in the night header')
  await seen('[data-testid="strip-snore"]')
  if ((await page.textContent('[data-testid="sounds-schedule-line"]')) !== 'Scheduled 9 pm to 5 am') throw new Error('the row does not show the schedule')
  await page.click('[data-testid="sounds-row"]')
  await seen('[data-testid="lab-sounds"]')
  for (const k of ['snoring', 'share', 'longest', 'loudest', 'coughs', 'talking', 'avg', 'loud']) await seen(`[data-testid="stat-${k}"]`)
  await seen('[data-testid="density-bin"]')
  await seen('[data-testid="density-gap"]')
  await page.locator('[data-testid="burst-chip"]').first().click()
  if (!/^Snoring \d\d:\d\d to \d\d:\d\d.* Confidence 80%\.$/.test((await page.textContent('[data-testid="burst-detail"]')).trim())) throw new Error('burst detail')
  await seen('[data-testid="sounds-chart"], [data-testid="sounds-trend"]')
  await page.locator('[data-testid="session-row"]').first().click()
  await seen('[data-testid="session-detail"]')
  if (!/Interrupted|call/.test(await page.textContent('[data-testid="detail-gaps"]'))) throw new Error('gap not listed')
  await closeSheet()
  const attempt = await page.locator('[data-testid="attempt-row"]').first().innerText()
  if (!/Blocked: the phone was locked/.test(attempt) || !/error 561145187/.test(attempt)) throw new Error(`start attempt reads "${attempt}"`)
  if (!/No audio is ever saved/.test(await page.textContent('[data-testid="sounds-no-audio"]'))) throw new Error('no audio statement')
  // the schedule: on by default, 9 pm to 5 am, the guided steps, and Check my setup
  await seen('[data-testid="sounds-schedule"] [data-testid="sounds-schedule-steps"]')
  if ((await page.getAttribute('[data-testid="sounds-schedule-on"]', 'data-on')) !== 'true') throw new Error('the schedule should be on by default')
  await page.click('[data-testid="sounds-check-setup"]')
  const verdict = await page.textContent('[data-testid="sounds-setup-verdict"]')
  if (!/^Didn't start on \w+, \w+ and \w+\. Check the automation\.$/.test(verdict)) throw new Error(`setup verdict reads "${verdict}"`)
  await noOverflow('Sleep sounds')
  // back, then the Morning check summary opens the same screen
  await page.click('[data-testid="lab-back"]')
  await seen('[data-testid="sleep-view"]')
})

await step('Sauna settings: switching off "Show sauna on Home" removes the row', async () => {
  await tab('Sauna')
  await page.click('[data-testid="sauna-settings-open"]')
  await page.click('[data-testid="sauna-show-home"]')
  await closeSheet()
  await tab('Home')
  if (await page.locator('[data-testid="home-sauna-row"]').count()) throw new Error('the sauna row is still on Home')
})

await browser.close()
if (errors.length) { console.log('FAIL console clean,', errors.slice(0, 5).join(' | ')); failures++ } else console.log('PASS console clean')
process.exit(failures ? 1 : 0)
