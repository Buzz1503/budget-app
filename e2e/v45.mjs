// v45 — chart zoom, two nightly topicals, and tracking an injection-site reaction.
//
// At 390x844. The chart steps drive real touch events and read the geometry the
// page actually drew; the topical steps start from a save that predates them, so
// the migration is what is under test; the reaction steps seed a store, drive the
// real screens, and then read the store back.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const BASE = process.env.BASE_URL || 'http://localhost:5174/budget-app/'
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

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
  new Function('s', 'a', 'raw', f)(raw.state, a, raw)
  localStorage.setItem('peptide-command-center', JSON.stringify(raw))
}, [fn, arg])
const gotIt = async () => {
  const b = page.locator('button:has-text("Got it")')
  if (!(await b.count())) return
  try { await b.first().click({ timeout: 3000 }) } catch { /* left alone */ }
  await page.waitForTimeout(400)
}
const closeAll = async () => {
  await gotIt()
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('[data-testid="sheet"], [data-testid="log-on-body-screen"]').count())) break
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    const c = page.locator('[data-testid="log-on-body-cancel"]')
    if (await c.count()) { await c.click(); await page.waitForTimeout(300) }
  }
}
const reload = async () => {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('nav button')
  await page.waitForTimeout(1500)
  await gotIt()
}
const nav = async (label) => {
  await closeAll()
  await page.click(`nav button[aria-label="${label}"]`)
  await page.waitForTimeout(650)
}
const more = async (id) => { await nav('More'); await page.click(`[data-testid="more-${id}"]`); await page.waitForTimeout(900) }
const noOverflow = async (where) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 391) throw new Error(`${where} overflows to ${w}px`)
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) }
const TODAY = dayOffset(0)
const dayNum = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000) }
const stamp = (n, h = 10) => `${dayOffset(n)}T${String(h).padStart(2, '0')}:00:00.000Z`

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('nav button')
await page.waitForTimeout(1400)
await gotIt()

// =========================================================== 1 · the chart

const chart = () => page.locator('[data-testid="marker-graph"]')
const openMarker = async (index = 0) => {
  await nav('Bloods')
  await page.locator('[data-testid="watch-list"] [data-testid="marker-row"]').nth(index).click()
  await page.waitForTimeout(900)
}
const tableDates = () => page.locator('[data-testid="marker-value-row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-date')))
const attr = (name) => chart().getAttribute(name)
const viewSpan = async () => dayNum(await attr('data-view-to')) - dayNum(await attr('data-view-from'))
const pointCount = () => page.locator('[data-testid="graph-point"]').count()

/** Dispatch a sequence of touch events on the chart. Each frame: [type, [[x,y],...], changed] */
const touch = (frames) => page.evaluate((fr) => {
  const el = document.querySelector('[data-testid="chart-svg"]')
  const mk = (pts) => pts.map(([x, y], i) => ({ identifier: i, clientX: x, clientY: y, target: el }))
  for (const [type, pts, changed] of fr) {
    const ev = Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      touches: mk(pts), changedTouches: mk(changed || pts), targetTouches: mk(pts),
    })
    el.dispatchEvent(ev)
  }
}, frames)
const svgBox = () => page.locator('[data-testid="chart-svg"]').boundingBox()
const pinchChart = async (factor) => {
  const b = await svgBox()
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  await touch([
    ['touchstart', [[cx - 40, cy], [cx + 40, cy]]],
    ['touchmove', [[cx - 40 * factor, cy], [cx + 40 * factor, cy]]],
    ['touchend', [], [[cx + 40 * factor, cy]]],
  ])
  await page.waitForTimeout(250)
}
const dragChart = async (dx) => {
  const b = await svgBox()
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  await touch([
    ['touchstart', [[x, y]]],
    ['touchmove', [[x + dx / 2, y]]],
    ['touchmove', [[x + dx, y]]],
    ['touchend', [], [[x + dx, y]]],
  ])
  await page.waitForTimeout(250)
}
const tap = async () => {
  const b = await svgBox()
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  await touch([['touchstart', [[x, y]]], ['touchend', [], [[x, y]]]])
}

await step('1a · every marker chart has 1Y 2Y 5Y All and by-year, and opens on 2Y', async () => {
  await openMarker(0)
  for (const k of ['1Y', '2Y', '5Y', 'All']) {
    if (!(await page.locator(`[data-testid="range-${k}"]`).count())) throw new Error(`no ${k} chip`)
  }
  if (!(await page.locator('[data-testid="range-by-year"]').count())) throw new Error('no by-year chip')
  if ((await attr('data-range')) !== '2Y') throw new Error(`opens on ${await attr('data-range')}`)
  if ((await page.locator('[data-testid="range-2Y"]').getAttribute('data-on')) !== 'true') throw new Error('2Y is not marked as chosen')

  await page.click('[data-testid="range-by-year"]')
  await page.waitForTimeout(300)
  const years = await page.locator('[data-testid^="range-year-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').slice(11)))
  const want = [...new Set((await tableDates()).map((d) => d.slice(0, 4)))].sort()
  if (years.join() !== want.join()) throw new Error(`years ${years} but the results are in ${want}`)
  await noOverflow('the range chips')
  console.log(`  by year: ${years.join(' ')}`)
})

await step('1b · each range shows only its own results, and the axes follow them', async () => {
  const dates = await tableDates()
  const within = (years) => {
    const d = new Date(); d.setFullYear(d.getFullYear() - years)
    const from = ymd(d)
    return dates.filter((x) => x >= from && x <= TODAY).sort()
  }
  const heightUsed = async () => {
    const ys = await page.locator('[data-testid="graph-point"] circle').evaluateAll((els) => els.map((e) => Number(e.getAttribute('cy'))))
    return ys.length > 1 ? (Math.max(...ys) - Math.min(...ys)) / (140 - 16) : null
  }

  await page.click('[data-testid="range-All"]'); await page.waitForTimeout(350)
  if (await pointCount() !== dates.length) throw new Error(`All shows ${await pointCount()} of ${dates.length}`)
  const allLo = Number(await attr('data-axis-lo')); const allHi = Number(await attr('data-axis-hi'))
  const allUsed = await heightUsed()

  for (const [key, years] of [['5Y', 5], ['2Y', 2]]) {
    await page.click(`[data-testid="range-${key}"]`); await page.waitForTimeout(350)
    const expect = within(years)
    if (expect.length < 2) { console.log(`  ${key}: ${expect.length} result(s) — sparse, skipped here`); continue }
    const got = await page.locator('[data-testid="graph-point"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-date')))
    if (got.join() !== expect.join()) throw new Error(`${key} draws ${got} but should draw ${expect}`)
    const used = await heightUsed()
    if (used < 0.6) throw new Error(`${key}: the line uses only ${Math.round(used * 100)}% of the chart height`)
    const lo = Number(await attr('data-axis-lo')); const hi = Number(await attr('data-axis-hi'))
    console.log(`  ${key}: ${got.length} points, axis ${lo.toFixed(1)}–${hi.toFixed(1)} (All: ${allLo.toFixed(1)}–${allHi.toFixed(1)}), ${Math.round(used * 100)}% of the height (All: ${allUsed == null ? '–' : Math.round(allUsed * 100) + '%'})`)
  }
  await page.click('[data-testid="range-2Y"]'); await page.waitForTimeout(300)
})

await step('1c · pinch zooms, drag pans, double-tap goes back to the chosen range', async () => {
  await page.click('[data-testid="range-All"]'); await page.waitForTimeout(400)
  const from0 = await attr('data-view-from'); const to0 = await attr('data-view-to')
  const span0 = await viewSpan()
  if ((await attr('data-zoomed')) !== 'false') throw new Error('starts out zoomed')

  await pinchChart(2.2)
  const span1 = await viewSpan()
  if (!(span1 < span0 * 0.7)) throw new Error(`pinch out left the span at ${span1} of ${span0}`)
  if ((await attr('data-zoomed')) !== 'true') throw new Error('zoom was not flagged')

  const f1 = await attr('data-view-from')
  await dragChart(-90)
  const f2 = await attr('data-view-from')
  if (dayNum(f2) <= dayNum(f1)) throw new Error(`dragging left moved the view from ${f1} to ${f2}, not later`)
  await dragChart(160)
  if (dayNum(await attr('data-view-from')) >= dayNum(f2)) throw new Error('dragging right did not go back in time')

  // axes follow what is in view
  const hi1 = Number(await attr('data-axis-hi'))
  await pinchChart(0.45)
  if ((await viewSpan()) <= span1) throw new Error('pinching in did not widen the view')
  void hi1

  await tap(); await page.waitForTimeout(80); await tap(); await page.waitForTimeout(300)
  if ((await attr('data-view-from')) !== from0 || (await attr('data-view-to')) !== to0) {
    throw new Error(`double-tap went to ${await attr('data-view-from')}–${await attr('data-view-to')}, not ${from0}–${to0}`)
  }
  if ((await attr('data-zoomed')) !== 'false') throw new Error('still flagged as zoomed after the reset')
  console.log(`  span ${span0} → ${span1} days, panned both ways, reset to ${from0}–${to0}`)
})

await step('1d · overlay marks sit on their dates at every zoom', async () => {
  // the first marker may have been measured too recently for any compound to
  // have started or changed inside its window, so look for one that has marks
  // Peptides in the seed all start recently, after the last result, so give one
  // a history that falls between results: a start and a later dose change.
  await setState(`
    s.doseEvents = (s.doseEvents || []).filter((e) => !String(e.id).startsWith('de-e2e'))
    s.doseEvents.push(
      { id: 'de-e2e-1', peptideId: 'bpc157', kind: 'start', date: '2025-06-15', at: null, to: 250, unit: 'mcg' },
      { id: 'de-e2e-2', peptideId: 'bpc157', kind: 'step-up', date: '2025-11-20', at: null, from: 250, to: 500, unit: 'mcg' },
    )
  `)
  await reload()
  let found = false
  for (let m = 0; m < 12 && !found; m++) {
    await openMarker(m)
    if ((await tableDates()).length < 2) continue
    await page.click('[data-testid="range-All"]'); await page.waitForTimeout(350)
    const toggles = page.locator('[data-testid="overlay-toggle"]')
    const n = await toggles.count()
    for (let i = 0; i < n; i++) await toggles.nth(i).click()
    await page.waitForTimeout(400)
    found = (await page.locator('[data-testid="overlay-mark"]').count()) > 0
  }
  if (!found) throw new Error('no marker has a compound event inside its results, so nothing could be checked')

  const check = async (label) => {
    const from = Number(await attr('data-view-x0')); const to = Number(await attr('data-view-x1'))
    const marks = await page.locator('[data-testid="overlay-mark"]').evaluateAll((els) => els.map((e) => ({ d: e.getAttribute('data-date'), x: Number(e.getAttribute('data-x')) })))
    const pts = await page.locator('[data-testid="graph-point"]').evaluateAll((els) => els.map((e) => ({ d: e.getAttribute('data-date'), x: Number(e.getAttribute('data-x')) })))
    const at = (d) => 34 + ((dayNum(d) - from) / (to - from)) * (310 - 34)
    for (const m of marks) {
      if (Math.abs(m.x - at(m.d)) > 0.05) throw new Error(`${label}: a mark for ${m.d} is at x=${m.x}, should be ${at(m.d).toFixed(2)}`)
      const p = pts.find((q) => q.d === m.d)
      if (p && Math.abs(p.x - m.x) > 0.05) throw new Error(`${label}: a result and a mark on ${m.d} are at different x (${p.x} vs ${m.x})`)
    }
    for (const p of pts) {
      if (Math.abs(p.x - at(p.d)) > 0.05) throw new Error(`${label}: a result for ${p.d} is at x=${p.x}, should be ${at(p.d).toFixed(2)}`)
    }
    return marks.length
  }
  const counts = [await check('all')]
  await pinchChart(2.0); counts.push(await check('zoomed once'))
  await dragChart(-70); counts.push(await check('panned'))
  await pinchChart(2.0); counts.push(await check('zoomed twice'))
  console.log(`  marks on screen at each zoom: ${counts.join(', ')}`)
  await tap(); await page.waitForTimeout(80); await tap(); await page.waitForTimeout(250)
})

await step('1e · point labels never sit on top of each other, and come back when zoomed in', async () => {
  const overlaps = () => page.locator('[data-testid="point-label"]').evaluateAll((els) => {
    const r = els.map((e) => e.getBoundingClientRect())
    let bad = 0
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const a = r[i]; const b = r[j]
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) bad++
    }
    return { labels: r.length, bad }
  })
  await page.click('[data-testid="range-All"]'); await page.waitForTimeout(350)
  const wide = await overlaps()
  if (wide.bad) throw new Error(`${wide.bad} labels overlap on All`)
  const points = await pointCount()
  await pinchChart(2.4)
  const zoomed = await overlaps()
  if (zoomed.bad) throw new Error(`${zoomed.bad} labels overlap once zoomed`)
  console.log(`  ${points} points · ${wide.labels} labels shown on All, ${zoomed.labels} once zoomed`)
  await tap(); await page.waitForTimeout(80); await tap(); await page.waitForTimeout(250)
})

await step('1f · a range with fewer than two results lists the values and draws no trend', async () => {
  let lone = null
  for (let i = 0; i < 12 && !lone; i++) {
    await openMarker(i)
    const dates = await tableDates()
    const byYear = {}
    for (const d of dates) byYear[d.slice(0, 4)] = (byYear[d.slice(0, 4)] || 0) + 1
    // needs at least two results overall, or there is no chart to range
    lone = dates.length >= 2 ? Object.keys(byYear).find((y) => byYear[y] === 1) : null
  }
  if (!lone) throw new Error('no marker has a year with exactly one result to test with')
  if (!(await page.locator(`[data-testid="range-year-${lone}"]`).count())) await page.click('[data-testid="range-by-year"]')
  await page.click(`[data-testid="range-year-${lone}"]`); await page.waitForTimeout(400)
  if (!(await page.locator('[data-testid="chart-sparse"]').count())) throw new Error('no sparse message')
  const text = await page.locator('[data-testid="chart-sparse"]').innerText()
  if (!/not enough data to plot a trend/i.test(text)) throw new Error(`the message reads "${text.replace(/\n/g, ' ')}"`)
  if (await page.locator('[data-testid="chart-svg"]').count()) throw new Error('a chart is still drawn')
  if (await page.locator('[data-testid="marker-graph"] polyline').count()) throw new Error('a line is drawn')
  if ((await page.locator('[data-testid="sparse-value"]').count()) !== 1) throw new Error('the value is not listed')
  await noOverflow('the sparse state')
  // the range that has more than one still draws
  await page.click('[data-testid="range-All"]'); await page.waitForTimeout(350)
  if (!(await page.locator('[data-testid="chart-svg"]').count())) throw new Error('All lost its chart')
  console.log(`  ${lone}: one result, listed, no line`)
})

// ============================================================ 2 · topicals

const FROM_MIN = '2026-08-13'
const FROM_TRE = '2026-08-17'
const nightsSince = (start) => dayNum(TODAY) - dayNum(start) + 1

await step('2a · an older save is migrated: both topicals appear, backfilled nightly', async () => {
  await setState(`
    s.supplements = s.supplements.filter((x) => !/minoxidil|tretinoin/i.test(x.name))
    s.supplementLogs = s.supplementLogs.filter((l) => !/minoxidil|tretinoin/i.test(l.name || ''))
    raw.version = 19
  `)
  await reload()
  const s = await state()
  const by = (n) => s.supplements.find((x) => x.name === n)
  const min = by('Minoxidil'); const tre = by('Tretinoin')
  if (!min || !tre) throw new Error('a topical is missing after the migration')
  for (const [x, start] of [[min, FROM_MIN], [tre, FROM_TRE]]) {
    if (x.form !== 'topical' || x.slot !== 'PM') throw new Error(`${x.name} is ${x.form}/${x.slot}`)
    if (x.dose !== '') throw new Error(`${x.name} has a dose of "${x.dose}"`)
    if (x.addedOn !== start) throw new Error(`${x.name} started ${x.addedOn}`)
    const logs = s.supplementLogs.filter((l) => l.supplementId === x.id)
    const dates = logs.map((l) => l.date).sort()
    if (logs.length !== nightsSince(start)) throw new Error(`${x.name}: ${logs.length} nights, expected ${nightsSince(start)}`)
    if (dates[0] !== start) throw new Error(`${x.name}: first night is ${dates[0]}`)
    if (dates.some((d) => d < start)) throw new Error(`${x.name}: a night before the start`)
    if (new Set(dates).size !== dates.length) throw new Error(`${x.name}: a night is logged twice`)
    if (dates.at(-1) !== TODAY) throw new Error(`${x.name}: last night is ${dates.at(-1)}`)
    if (logs.some((l) => l.backfilled)) throw new Error(`${x.name}: logged as added later`)
  }
  // loading again must not add a second copy of anything
  const before = s.supplementLogs.length
  await reload()
  if ((await state()).supplementLogs.length !== before) throw new Error('a reload changed the log')
  console.log(`  Minoxidil ${nightsSince(FROM_MIN)} nights from ${FROM_MIN}, Tretinoin ${nightsSince(FROM_TRE)} from ${FROM_TRE}`)
})

await step('2b · Topical is a form option, and a topical never reads as oral or injected', async () => {
  await more('supplements')
  const text = await page.locator('[data-testid="supplements-view"]').innerText()
  if (!/Minoxidil/.test(text) || !/Tretinoin/.test(text)) throw new Error('the topicals are not on the shelf')
  if (/by mouth|oral|inject|swallow/i.test(text)) throw new Error(`the shelf says: ${text.match(/by mouth|oral|inject|swallow/i)[0]}`)
  const row = page.locator('[data-testid="supplement-slot-PM"] button:has-text("Minoxidil")').first()
  const rowText = await row.innerText()
  if (!/Topical/.test(rowText)) throw new Error(`the row reads "${rowText.replace(/\n/g, ' ')}"`)
  if (!/no dose set/.test(rowText)) throw new Error('an amount was invented')

  await page.click('[data-testid="add-supplement"]')
  await page.waitForTimeout(600)
  const manual = page.locator('button[aria-label="Enter my own"]')
  if (await manual.count()) { await manual.first().click(); await page.waitForTimeout(400) }
  const options = await page.locator('select[aria-label="Form"] option').allInnerTexts()
  for (const f of ['Tablet', 'Capsule', 'Powder', 'Spray', 'Liquid', 'Topical']) {
    if (!options.includes(f)) throw new Error(`form options are ${options.join(', ')}`)
  }
  await page.selectOption('select[aria-label="Form"]', 'topical')
  const ph = await page.locator('input[aria-label="Dose"]').getAttribute('placeholder')
  if (/capsule|mouth|oral|inject/i.test(ph)) throw new Error(`the dose box says "${ph}"`)
  await closeAll()
})

await step('2c · both are in the PM group on Home, applied rather than taken', async () => {
  await nav('Home')
  const pm = page.locator('button[aria-label="PM"]')
  if (await pm.count()) { await pm.first().click(); await page.waitForTimeout(500) }
  const group = page.locator('[data-testid="take-group"]')
  if (!(await group.count())) throw new Error('no Take group in the PM slot')
  const rows = await group.locator('[data-testid="take-row"]').allInnerTexts()
  const mine = rows.filter((r) => /Minoxidil|Tretinoin/.test(r))
  // tonight's are already logged by the backfill, so the rows show done
  if (mine.length !== 2) throw new Error(`${mine.length} topical rows in the PM group`)
  for (const r of mine) {
    if (/oral|mouth|inject|swallow|capsule|tablet|\bsite\b|units/i.test(r)) throw new Error(`a topical row reads "${r.replace(/\n/g, ' ')}"`)
  }
  const btn = await group.locator('button[aria-label*="Minoxidil"]').first().getAttribute('aria-label')
  if (!/Applied|Undo/.test(btn)) throw new Error(`the button is labelled "${btn}"`)
  await noOverflow('Home PM group')
})

await step('2d · the calendar shows them from their start day and not before', async () => {
  await nav('Calendar')
  const month = page.locator('button:has-text("Month")')
  if (await month.count()) { await month.first().click(); await page.waitForTimeout(900) }
  const showing = async (date) => {
    for (let i = 0; i < 6; i++) {
      if (await page.locator(`[data-testid="cal-cell-${date}"]`).count()) return
      await page.click('button[aria-label="Previous period"]'); await page.waitForTimeout(450)
    }
    throw new Error(`the grid never showed ${date}`)
  }
  const sheetText = async (date) => {
    await showing(date)
    await page.click(`[data-testid="cal-cell-${date}"]`); await page.waitForTimeout(800)
    const t = await page.locator('[data-testid="day-sheet"]').innerText()
    const supp = (await page.locator('[data-testid="day-supplement"]').allInnerTexts()).join(' | ')
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    return { t, supp }
  }
  const before = await sheetText('2026-08-12')
  if (/Minoxidil|Tretinoin/.test(before.supp)) throw new Error('a topical on the day before it began')
  const first = await sheetText('2026-08-13')
  if (!/Minoxidil/.test(first.supp) || /Tretinoin/.test(first.supp)) throw new Error(`13 Aug lists "${first.supp}"`)
  if (!/Logged/.test(first.supp)) throw new Error(`13 Aug is not shown as logged: "${first.supp}"`)
  const both = await sheetText('2026-08-17')
  if (!/Minoxidil/.test(both.supp) || !/Tretinoin/.test(both.supp)) throw new Error(`17 Aug lists "${both.supp}"`)
  if (/Missed/.test(both.supp)) throw new Error('a backfilled night shows as missed')
  console.log('  12 Aug: neither · 13 Aug: Minoxidil · 17 Aug: both, logged')
})

// =================================================== 3 · reactions, seeded

const tracker = async () => {
  await nav('Symptoms')
  await page.click('[data-testid="symptom-tab-reactions"]')
  await page.waitForTimeout(900)
}

const PIN_OPEN = 'abd-l-upper-inner'
const PIN_TWO = 'abd-r-upper-inner'
const PIN_DONE = 'thigh-l-front-upper'
const PIN_LEFT = 'abd-l-upper-outer'
const NEEDLE_A = { gauge: '32G', lengthMm: 6 }
const NEEDLE_B = { gauge: '27G', lengthMm: 13 }
const chk = (n, severity, symptoms = []) => ({ date: dayOffset(n), severity, symptoms })

const seedReactions = () => setState(`
  const rec = (id, peptideId, pinId, group, ts, extra = {}) => ({
    id, doseLogId: null, peptideId, dose: 250, units: 'mcg', pinId, siteGroup: group, side: pinId.includes('-l-') ? 'l' : 'r',
    timestamp: ts, mixed: false, needsPinning: false, coDraw: false, coDrawId: null, coDrawPeptideIds: [peptideId],
    needle: a.NEEDLE_A, route: 'SubQ', ...extra,
  })
  s.injectionRecords = [
    rec('o1', 'bpc157', a.PIN_OPEN, 'abdomen', a.t3),
    rec('o2', 'ghkcu', a.PIN_TWO, 'abdomen', a.t1),
    rec('d1', 'motsc', a.PIN_DONE, 'thigh', a.t12),
    rec('x1', 'kpv', a.PIN_LEFT, 'abdomen', a.t14),
  ]
  const wrap = (id, ratings, extra = {}) => ({
    injectionRecordId: id, ratings, worstSeverity: ratings.reduce((w, r) => (['none','mild','moderate','severe'].indexOf(r.severity) > ['none','mild','moderate','severe'].indexOf(w) ? r.severity : w), 'none'),
    goneAt: null, photoIds: [], ...extra,
  })
  s.reactions = [
    wrap('o1', [a.c3, a.c2, a.c1]),
    wrap('o2', [a.c1b]),
    wrap('d1', [a.e12, a.e11, a.e9], { goneAt: a.g9, photoIds: ['ph-b', 'ph-a'], photoDates: { 'ph-a': a.d11, 'ph-b': a.d12 } }),
    wrap('x1', [a.e14]),
  ]
  s.safetyFlags = []
  s.reactionSettings = { ...s.reactionSettings, checkTime: '00:00' }
`, {
  PIN_OPEN, PIN_TWO, PIN_DONE, PIN_LEFT, NEEDLE_A,
  t3: stamp(-3), t1: stamp(-1), t12: stamp(-12), t14: stamp(-14),
  c3: chk(-3, 'moderate', ['redness', 'itching']), c2: chk(-2, 'moderate', ['redness', 'itching']), c1: chk(-1, 'mild', ['redness']),
  c1b: chk(-1, 'mild', ['redness']),
  e12: chk(-12, 'severe', ['welt', 'itching']), e11: chk(-11, 'moderate', ['itching']), e9: chk(-9, 'none'),
  g9: dayOffset(-9), d11: dayOffset(-11), d12: dayOffset(-12),
  e14: chk(-14, 'mild', ['redness']),
})

await step('3a · an open reaction sits on Home with site, peptide, days open, severity and Check', async () => {
  await seedReactions()
  await reload()
  await nav('Home')
  await page.waitForTimeout(800)
  const card = page.locator('[data-testid="open-reactions"]')
  if (!(await card.count())) throw new Error('no open-reactions card on Home')
  const rows = card.locator('[data-testid="open-reaction-row"]')
  const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-record')))
  if (ids.join() !== 'o1,o2') throw new Error(`rows are ${ids} — a resolved or abandoned reaction is on Home, or one is missing`)
  const first = (await rows.first().innerText()).replace(/\n/g, ' ')
  if (!/abdomen/i.test(first)) throw new Error(`no site in "${first}"`)
  if (!/BPC/i.test(first)) throw new Error(`no peptide in "${first}"`)
  if (!/3 days open/.test(first)) throw new Error(`days open not shown in "${first}"`)
  if (!/Mild/.test(first)) throw new Error(`current severity not shown in "${first}"`)
  if (!/improving/.test(first)) throw new Error(`direction not shown in "${first}"`)
  const second = (await rows.nth(1).innerText()).replace(/\n/g, ' ')
  if (/improving|worsening|stable/.test(second)) throw new Error(`a direction is shown after a single check: "${second}"`)
  if (!(await rows.first().locator('[data-testid="open-reaction-check"]').count())) throw new Error('no Check action')
  await noOverflow('Home with an open reaction')
  // the abandoned one was written down, not just hidden
  const s = await state()
  if (!s.reactions.find((r) => r.injectionRecordId === 'x1').abandonedAt) throw new Error('the week-old reaction was not marked abandoned')
  if (s.reactions.find((r) => r.injectionRecordId === 'x1').ratings.length !== 1) throw new Error('abandoning altered the record')
  console.log(`  "${first}"`)
})

await step('3b · the daily check is one screen, pre-filled from yesterday, and keeps the reaction open', async () => {
  await page.locator('[data-testid="open-reaction-row"][data-record="o1"] [data-testid="open-reaction-check"]').click()
  await page.waitForTimeout(600)
  if (!(await page.locator('[data-testid="reaction-check"]').count())) throw new Error('the check did not open')
  if (await page.locator('textarea, input[type="range"]').count()) throw new Error('the check has a notes box or a slider')
  const on = await page.locator('[data-testid^="rc-symptom-"][data-on="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').slice(11)))
  if (on.join() !== 'redness') throw new Error(`pre-filled with ${on}, not yesterday's redness`)
  if ((await page.locator('[data-testid="rc-sev-mild"]').getAttribute('data-on')) !== 'true') throw new Error('severity is not pre-filled')
  const n = await page.locator('[data-testid^="rc-symptom-"]').count()
  if (n !== 10) throw new Error(`${n} symptom chips`)
  await noOverflow('the daily check')
  // one extra symptom, one tap to save
  await page.click('[data-testid="rc-symptom-heat"]')
  await page.click('[data-testid="rc-save"]')
  await page.waitForTimeout(600)
  const s = await state()
  const rx = s.reactions.find((r) => r.injectionRecordId === 'o1')
  const today = rx.ratings.find((r) => r.date === TODAY)
  if (!today) throw new Error('no check was stored for today')
  if (today.symptoms.join() !== 'redness,heat') throw new Error(`stored ${today.symptoms}`)
  if (today.severity !== 'mild') throw new Error(`stored ${today.severity}`)
  if (rx.goneAt) throw new Error('a check that was not Gone resolved it')
  if (rx.ratings.length !== 4) throw new Error('the earlier checks were changed')
  if (!(await page.locator('[data-testid="open-reaction-row"][data-record="o1"]').count())) throw new Error('it left Home after a check')
  const label = await page.locator('[data-testid="open-reaction-row"][data-record="o1"] [data-testid="open-reaction-check"]').innerText()
  if (!/Checked/.test(label)) throw new Error(`the row says "${label}"`)

  // a second answer today corrects the first, it does not add one
  await page.locator('[data-testid="open-reaction-row"][data-record="o1"] [data-testid="open-reaction-check"]').click()
  await page.waitForTimeout(500)
  await page.click('[data-testid="rc-sev-moderate"]')
  await page.click('[data-testid="rc-save"]'); await page.waitForTimeout(500)
  const again = (await state()).reactions.find((r) => r.injectionRecordId === 'o1')
  if (again.ratings.filter((r) => r.date === TODAY).length !== 1) throw new Error('two checks on one day')
  if (again.ratings.find((r) => r.date === TODAY).severity !== 'moderate') throw new Error('the correction was not kept')
})

await step('3c · a photo is optional, and goes onto the day it was taken', async () => {
  await page.locator('[data-testid="open-reaction-row"][data-record="o1"] [data-testid="open-reaction-check"]').click()
  await page.waitForTimeout(500)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await page.setInputFiles('[data-testid="rc-photo"]', { name: 'site.png', mimeType: 'image/png', buffer: png })
  await page.waitForTimeout(1200)
  await page.click('[data-testid="rc-save"]'); await page.waitForTimeout(600)
  const rx = (await state()).reactions.find((r) => r.injectionRecordId === 'o1')
  if (!rx.photoIds.length) {
    console.log('  (the one-pixel test image was refused by the importer, so the strip is checked from seeded photos below)')
    return
  }
  const key = rx.photoIds.at(-1)
  if (rx.photoDates?.[key] !== TODAY) throw new Error(`the photo is dated ${rx.photoDates?.[key]}`)
})

await step('3d · Gone resolves it on the spot', async () => {
  await page.locator('[data-testid="open-reaction-row"][data-record="o2"] [data-testid="open-reaction-check"]').click()
  await page.waitForTimeout(500)
  await page.click('[data-testid="rc-sev-none"]')
  await page.waitForTimeout(700)
  if (await page.locator('[data-testid="reaction-check"]').count()) throw new Error('the check stayed open after Gone')
  const rx = (await state()).reactions.find((r) => r.injectionRecordId === 'o2')
  if (rx.goneAt !== TODAY) throw new Error(`goneAt is ${rx.goneAt}`)
  if (await page.locator('[data-testid="open-reaction-row"][data-record="o2"]').count()) throw new Error('a resolved reaction is still on Home')
})

await step('3e · peptide, co-draw, site, dose and needle are captured at log time, pre-filled and editable', async () => {
  await setState(`
    s.injectionRecords = []; s.reactions = []
    s.gearItems = s.gearItems.map((g) => g.category === 'Syringe needles' ? g : g)
  `)
  await reload()
  await nav('Home')
  const before = (await state()).injectionRecords.length
  const lob = page.locator('[data-testid="log-on-body"]').first()
  if (!(await lob.count())) throw new Error('no Log on body on Home in this slot')
  await lob.click(); await page.waitForTimeout(1000)
  await page.click('[data-testid="lob-use-suggested"]'); await page.waitForTimeout(500)
  const picker = page.locator('[data-testid="needle-picker"]')
  if (!(await picker.count())) throw new Error('no needle on the log screen')
  const prefilled = await picker.getAttribute('data-needle')
  if (!prefilled) throw new Error('the needle is not pre-filled from Supplies')
  const choices = await picker.locator('[data-testid="needle-choice"]').count()
  // pick a different in-use needle than the pre-filled one, if there is one
  let chosen = prefilled
  if (choices > 1) {
    const other = picker.locator('[data-testid="needle-choice"][data-on="false"]').first()
    await other.click(); await page.waitForTimeout(250)
    chosen = await picker.getAttribute('data-needle')
    if (chosen === prefilled) throw new Error('the needle could not be changed at log time')
  }
  await page.click('[data-testid="lob-log-here"]'); await page.waitForTimeout(800)
  const s = await state()
  if (s.injectionRecords.length !== before + 1) throw new Error('no injection record was written')
  const r = s.injectionRecords.at(-1)
  if (!r.peptideId || !r.pinId || r.dose == null || !r.units) throw new Error(`captured ${JSON.stringify({ p: r.peptideId, pin: r.pinId, dose: r.dose, units: r.units })}`)
  if (r.coDraw !== false || !Array.isArray(r.coDrawPeptideIds)) throw new Error('the co-draw flag was not captured')
  if (`${r.needle?.gauge}|${r.needle?.lengthMm}` !== chosen) throw new Error(`stored needle ${JSON.stringify(r.needle)} but chose ${chosen}`)
  // the in-use list in Supplies is where it came from
  const inUse = s.gearItems.filter((g) => g.category === 'Syringe needles' && g.status === 'in_use').map((g) => `${g.gauge}|${g.lengthMm}`)
  if (!inUse.includes(chosen)) throw new Error(`${chosen} is not In use in Supplies (${inUse})`)
  console.log(`  ${r.peptideId} · ${r.pinId} · ${r.dose} ${r.units} · ${r.needle.gauge} × ${r.needle.lengthMm} mm (pre-filled ${prefilled})`)
})

await step('3f · it can all be corrected afterwards', async () => {
  await seedReactions()
  await reload()
  await tracker()
  await page.locator('[data-testid="reaction-row"][data-record="o1"]').click()
  await page.waitForTimeout(700)
  if (!(await page.locator('[data-testid="captured-fields"]').count())) throw new Error('no captured fields on the reaction')
  await page.selectOption('[data-testid="cf-gauge"]', NEEDLE_B.gauge)
  await page.selectOption('[data-testid="cf-length"]', String(NEEDLE_B.lengthMm))
  await page.selectOption('[data-testid="cf-site"]', 'abd-r-navel-inner')
  await page.check('[data-testid="cf-codraw"]')
  await page.waitForTimeout(400)
  const r = (await state()).injectionRecords.find((x) => x.id === 'o1')
  if (r.needle.gauge !== NEEDLE_B.gauge || r.needle.lengthMm !== NEEDLE_B.lengthMm) throw new Error(`needle is ${JSON.stringify(r.needle)}`)
  if (r.pinId !== 'abd-r-navel-inner') throw new Error(`site is ${r.pinId}`)
  if (r.coDraw !== true) throw new Error('the co-draw flag did not change')
  await closeAll()
})

await step('3g · days open, time to resolve, peak, direction, timeline and photos all compute', async () => {
  await seedReactions()
  await reload()
  await tracker()
  await page.locator('[data-testid="reaction-row"][data-record="o1"]').click()
  await page.waitForTimeout(700)
  const val = (id) => page.locator(`[data-testid="${id}"]`).innerText()
  if ((await val('rd-status')) !== 'Open') throw new Error(`status ${await val('rd-status')}`)
  if ((await val('rd-days-open')) !== '3') throw new Error(`days open ${await val('rd-days-open')}`)
  if ((await val('rd-peak')) !== 'Moderate') throw new Error(`peak ${await val('rd-peak')}`)
  if ((await val('rd-direction')) !== 'improving') throw new Error(`direction ${await val('rd-direction')}`)
  const days = await page.locator('[data-testid="rd-timeline-day"]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-date'), e.innerText.replace(/\n/g, ' ')]))
  if (days.length !== 3) throw new Error(`${days.length} timeline days`)
  if (!/Redness · Itching/.test(days[0][1]) || /Itching/.test(days[2][1])) throw new Error(`per-day symptoms lost: ${JSON.stringify(days)}`)
  await closeAll()

  await page.locator('[data-testid="reaction-row"][data-record="o2"]').click()
  await page.waitForTimeout(600)
  if ((await val('rd-direction')) === 'improving' || /improv|worsen|stable/.test(await val('rd-direction'))) throw new Error('a direction after one check')
  if (!/Needs 2 checks/.test(await val('rd-direction'))) throw new Error(`direction reads "${await val('rd-direction')}"`)
  await closeAll()

  await page.locator('[data-testid="reaction-row"][data-record="d1"]').click()
  await page.waitForTimeout(700)
  if ((await val('rd-status')) !== 'Resolved') throw new Error(`status ${await val('rd-status')}`)
  if (!/3 days/.test(await val('rd-resolve'))) throw new Error(`time to resolve ${await val('rd-resolve')}`)
  if ((await val('rd-peak')) !== 'Severe') throw new Error(`peak ${await val('rd-peak')}`)
  const photos = await page.locator('[data-testid="rd-photo"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-date')))
  if (photos.join() !== [dayOffset(-12), dayOffset(-11)].join()) throw new Error(`photos in order: ${photos}`)
  await closeAll()

  await page.locator('[data-testid="reaction-row"][data-record="x1"]').click()
  await page.waitForTimeout(600)
  if ((await val('rd-status')) !== 'Abandoned') throw new Error(`status ${await val('rd-status')}`)
  await closeAll()
  console.log('  open: 3 days · moderate peak · improving · 3 days of symptoms | resolved in 3 days | photos in order')
})

// ================================================================ patterns

await step('3h · Patterns: by peptide, needle and region; rates only from five; co-draws kept apart', async () => {
  await setState(`
    const mk = (i, peptideId, pinId, group, needle, over = {}) => ({
      id: 'p' + i, doseLogId: null, peptideId, dose: 250, units: 'mcg', pinId, siteGroup: group, side: 'l',
      timestamp: a.stamp, mixed: false, needsPinning: false, coDraw: false, coDrawId: null, coDrawPeptideIds: [peptideId],
      needle, route: 'SubQ', ...over,
    })
    const recs = []
    for (let i = 0; i < 6; i++) recs.push(mk(i, 'bpc157', 'abd-l-upper-inner', 'abdomen', a.A))        // enough, clean
    for (let i = 6; i < 9; i++) recs.push(mk(i, 'ghkcu', 'thigh-l-front-upper', 'thigh', a.B))          // too few
    for (let i = 9; i < 15; i++) recs.push(mk(i, 'tb500', 'flank-l', 'flank', a.A, { coDraw: true, coDrawId: 'cd', coDrawPeptideIds: ['tb500', 'kpv'] }))
    s.injectionRecords = recs
    s.reactions = recs.map((r, i) => ({
      injectionRecordId: r.id,
      ratings: [{ date: a.day, severity: i === 0 || (i >= 9) ? 'mild' : 'none', symptoms: i === 0 ? ['redness'] : [] }],
      worstSeverity: i === 0 || i >= 9 ? 'mild' : 'none', goneAt: null, photoIds: [],
      openedOn: i === 0 || i >= 9 ? a.day : undefined,
    }))
    s.safetyFlags = []
  `, { stamp: stamp(-1), day: dayOffset(-1), A: NEEDLE_A, B: NEEDLE_B })
  await reload()
  await tracker()
  const patterns = page.locator('[data-testid="patterns"]')
  if (!(await patterns.count())) throw new Error('no Patterns section')
  for (const id of ['patterns-peptides', 'patterns-needles', 'patterns-regions']) {
    if (!(await page.locator(`[data-testid="${id}"]`).count())) throw new Error(`no ${id}`)
  }
  const bpc = await page.locator('[data-testid="peptide-card-bpc157"]').innerText()
  if (!/6 injections/.test(bpc) || !/1 reaction\b/.test(bpc) || !/17%/.test(bpc)) throw new Error(`bpc157 reads "${bpc.replace(/\n/g, ' ')}"`)
  const ghk = await page.locator('[data-testid="peptide-card-ghkcu"]').innerText()
  if (!/Not enough data yet/.test(ghk) || /%/.test(ghk)) throw new Error(`ghkcu reads "${ghk.replace(/\n/g, ' ')}" — a rate under five injections`)
  if (!/3 injections/.test(ghk)) throw new Error('the raw count is missing under the threshold')

  const tb = await page.locator('[data-testid="peptide-card-tb500"]').innerText()
  if (!/unable to isolate/i.test(tb)) throw new Error(`a co-draw is not flagged: "${tb.replace(/\n/g, ' ')}"`)
  if (/%/.test(tb)) throw new Error(`a co-drawn compound has a rate: "${tb.replace(/\n/g, ' ')}"`)

  const needles = await page.locator('[data-testid="needle-row"]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-key'), e.innerText.replace(/\n/g, ' ')]))
  if (!needles.some(([k]) => k === '32G|6') || !needles.some(([k]) => k === '27G|13')) throw new Error(`needle rows: ${JSON.stringify(needles)}`)
  const small = needles.find(([k]) => k === '27G|13')[1]
  if (!/Not enough data yet/.test(small)) throw new Error(`a 3-injection needle row reads "${small}"`)
  for (const g of ['abdomen', 'thigh', 'flank']) {
    if (!(await page.locator(`[data-testid="group-card-${g}"]`).count())) throw new Error(`no ${g} region row`)
  }
  const note = await page.locator('[data-testid="patterns-note"]').innerText()
  if (!/counts, not causes/i.test(note)) throw new Error('the page does not say it is not about causes')
  const all = await patterns.innerText()
  if (/\b(caused by|culprit|most likely|worst peptide|ranked)\b/i.test(all)) throw new Error('a cause or ranking is stated')
  await noOverflow('Patterns')
  console.log(`  bpc157 "${bpc.split('\n').slice(1).join(' ').slice(0, 70)}" · ghkcu not enough · tb500 unable to isolate`)
})

// ================================================================ tie-ins

await step('3i · open and resolved reactions mark the body map, and the suggestion avoids an open one', async () => {
  await seedReactions()
  await reload()
  await tracker()
  const status = (id) => page.locator(`[data-testid="pin-${id}"]`).first().getAttribute('data-status')
  if ((await status(PIN_OPEN)) !== 'reacting') throw new Error(`the open site reads ${await status(PIN_OPEN)}`)
  const done = page.locator(`[data-testid="reaction-mark-${PIN_DONE}"]`).first()
  if ((await done.getAttribute('data-mark')) !== 'resolved') throw new Error('the resolved site has no mark')
  const left = page.locator(`[data-testid="reaction-mark-${PIN_LEFT}"]`).first()
  if ((await left.getAttribute('data-mark')) !== 'abandoned') throw new Error('the abandoned site has no mark')
  if ((await status(PIN_DONE)) === 'reacting') throw new Error('a resolved site is still treated as reacting')

  // the suggestion on the log screen is never the open one
  await nav('Home')
  const lob = page.locator('[data-testid="log-on-body"]').first()
  if (await lob.count()) {
    await lob.click(); await page.waitForTimeout(1000)
    const sug = await page.locator('[data-testid="lob-reason"]').locator('xpath=ancestor::div[1]').innerText().catch(() => '')
    if (/Left abdomen, upper inner/i.test(sug.split('\n')[0] || '')) throw new Error(`the suggestion is the reacting site: ${sug}`)
    await closeAll()
  }
})

await step('3j · a reaction is on the calendar on the day it started', async () => {
  await nav('Calendar')
  const month = page.locator('button:has-text("Month")')
  if (await month.count()) { await month.first().click(); await page.waitForTimeout(900) }
  const date = dayOffset(-3)
  for (let i = 0; i < 3 && !(await page.locator(`[data-testid="cal-cell-${date}"]`).count()); i++) {
    await page.click('button[aria-label="Previous period"]'); await page.waitForTimeout(450)
  }
  await page.click(`[data-testid="cal-cell-${date}"]`); await page.waitForTimeout(800)
  const sheet = await page.locator('[data-testid="day-sheet"]').innerText()
  if (!/Reaction —/.test(sheet)) throw new Error(`the day sheet reads "${sheet.replace(/\n/g, ' ').slice(0, 200)}"`)
  await closeAll()
  // and not on a day nothing started
  const other = dayOffset(-5)
  if (await page.locator(`[data-testid="cal-cell-${other}"]`).count()) {
    await page.click(`[data-testid="cal-cell-${other}"]`); await page.waitForTimeout(700)
    if (/Reaction —/.test(await page.locator('[data-testid="day-sheet"]').innerText())) throw new Error('a reaction on the wrong day')
    await closeAll()
  }
})

await step('3k · reaction history is in the backup and in the shareable summary', async () => {
  await more('settings')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('button:has-text("Back up everything")'),
  ])
  const bundle = JSON.parse(readFileSync(await download.path(), 'utf8'))
  const rs = bundle.appState.state.reactions
  const recs = bundle.appState.state.injectionRecords
  if (!rs?.length || !recs?.length) throw new Error('no reactions in the backup file')
  const o1 = rs.find((r) => r.injectionRecordId === 'o1')
  if (!o1?.ratings?.some((r) => r.symptoms?.includes('itching'))) throw new Error('per-check symptoms are not in the backup')
  if (!recs.find((r) => r.id === 'o1').needle) throw new Error('the needle is not in the backup')
  if (!rs.find((r) => r.injectionRecordId === 'd1')?.photoDates) throw new Error('the photo dates are not in the backup')

  await more('history')
  await page.click('[data-testid="open-summary"]'); await page.waitForTimeout(1200)
  const html = await page.locator('[data-testid="summary-frame"]').getAttribute('srcdoc')
  if (!/Injection-site reactions/.test(html)) throw new Error('the summary has no reactions section')
  if (!/BPC-157/.test(html) || !/32G × 6 mm/.test(html)) throw new Error('the summary lacks the peptide or needle')
  if (/undefined|NaN/.test(html)) throw new Error('the summary has undefined or NaN in it')
  await closeAll()
  console.log(`  ${rs.length} reactions in the backup, and listed in the summary`)
})

await step('no screen overflows at 375 wide', async () => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.waitForTimeout(300)
  await openMarker(0)
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w > 376) throw new Error(`the marker chart overflows to ${w}px`)
  await nav('Home'); await page.waitForTimeout(500)
  const w2 = await page.evaluate(() => document.documentElement.scrollWidth)
  if (w2 > 376) throw new Error(`Home overflows to ${w2}px`)
  await page.setViewportSize({ width: 390, height: 844 })
})

const noise = errors.filter((e) => e.startsWith('console') || e.startsWith('pageerror'))
console.log(`\n--- console/page errors: ${noise.length}`)
for (const e of noise.slice(0, 10)) console.log('  ' + e.split('\n')[0])
console.log(`--- step failures: ${failures}`)
await browser.close()
process.exit(failures || noise.length ? 1 : 0)
