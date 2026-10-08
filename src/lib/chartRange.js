// Time range, zoom and pan for the marker chart — the arithmetic only.
//
// Everything here is a pure function of dates and numbers. The component owns
// the touch handling and the SVG; this owns every decision about *which* points
// are visible, how the axes fit them, and where a date lands on the x axis.
// Keeping the mapping in one place is what keeps the compound overlay marks on
// the right dates at every zoom: an overlay line and a result point on the same
// date go through the same `xFor`, so they cannot drift apart.
//
// Dates are 'YYYY-MM-DD' strings. A "day" is a UTC day number (days since the
// epoch), so there is no timezone or DST arithmetic anywhere.

export const PRESETS = [
  { key: '1Y', label: '1Y', years: 1 },
  { key: '2Y', label: '2Y', years: 2 },
  { key: '5Y', label: '5Y', years: 5 },
  { key: 'All', label: 'All', years: null },
]
export const DEFAULT_RANGE = { kind: 'preset', key: '2Y' }

/** Narrowest the chart will zoom in to, in days. Below this a "trend" is noise. */
export const MIN_SPAN_DAYS = 14

const DAY_MS = 86400000

export function dayNum(date) {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

export function dateOfDay(n) {
  return new Date(Math.round(n) * DAY_MS).toISOString().slice(0, 10)
}

// -------------------------------------------------------------- selection

/** The years that have at least one result, oldest first. */
export function yearsWithResults(series) {
  return [...new Set((series || []).map((s) => Number(String(s.date).slice(0, 4))))].sort((a, b) => a - b)
}

/**
 * The inclusive date window a selection covers: { from, to }, either of which
 * is null when that side is open. A preset counts back from today, so "1Y" is
 * the last year, not the year ending at the last result.
 */
export function rangeWindow(range, today) {
  const r = range || DEFAULT_RANGE
  if (r.kind === 'year') return { from: `${r.year}-01-01`, to: `${r.year}-12-31` }
  const preset = PRESETS.find((p) => p.key === r.key) || PRESETS[1]
  if (preset.years == null) return { from: null, to: null }
  const [y, m, d] = today.split('-').map(Number)
  const back = new Date(Date.UTC(y - preset.years, m - 1, d))
  // 29 Feb back to a non-leap year rolls to 1 Mar; step to the last day of Feb.
  if (back.getUTCMonth() !== m - 1) back.setUTCDate(0)
  return { from: back.toISOString().slice(0, 10), to: today }
}

/** Only the results that fall inside the window. */
export function inWindow(series, win) {
  return (series || []).filter((s) => (!win.from || s.date >= win.from) && (!win.to || s.date <= win.to))
}

/** Results for a selection, in order. */
export function rangeSeries(series, range, today) {
  return inWindow(series, rangeWindow(range, today))
}

/**
 * A line needs two points. With fewer, the chart shows the values and says so
 * instead of drawing something that looks like a trend and is not one.
 */
export function canPlotTrend(points) {
  return (points || []).length >= 2
}

// ------------------------------------------------------------------ axes

/** The x extent (as day numbers) that fits these points, with a little air. */
export function fitX(points) {
  if (!points.length) return null
  const days = points.map((p) => dayNum(p.date))
  let lo = Math.min(...days)
  let hi = Math.max(...days)
  if (hi - lo < 1) return { x0: lo - 15, x1: hi + 15 }
  const pad = Math.max(3, Math.round((hi - lo) * 0.04))
  return { x0: lo - pad, x1: hi + pad }
}

/** The y extent that fits only these points — so the line uses the height. */
export function fitY(points) {
  if (!points.length) return { lo: 0, hi: 1 }
  const vs = points.map((p) => p.value)
  let lo = Math.min(...vs)
  let hi = Math.max(...vs)
  if (hi === lo) {
    const half = Math.abs(hi) * 0.1 || 1
    return { lo: lo - half, hi: hi + half }
  }
  const pad = (hi - lo) * 0.14
  return { lo: lo - pad, hi: hi + pad }
}

/** Points whose date is inside a view. */
export function inView(series, view) {
  return (series || []).filter((s) => {
    const d = dayNum(s.date)
    return d >= view.x0 && d <= view.x1
  })
}

/** The view a selection opens on: fitted to its own points. */
export function initialView(series, range, today) {
  const pts = rangeSeries(series, range, today)
  return fitX(pts)
}

/** How far the view may roam: everything recorded, and at least the opening view. */
export function viewBounds(series, opening) {
  const all = fitX(series || [])
  if (!all) return opening
  if (!opening) return all
  return { x0: Math.min(all.x0, opening.x0), x1: Math.max(all.x1, opening.x1) }
}

function shiftInto(view, bounds) {
  const span = view.x1 - view.x0
  let x0 = view.x0
  if (x0 < bounds.x0) x0 = bounds.x0
  if (x0 + span > bounds.x1) x0 = bounds.x1 - span
  return { x0, x1: x0 + span }
}

/**
 * Zoom about a point. `scale` < 1 zooms in. `focus` (0–1) is where along the
 * plot the fingers are, and that date stays under them.
 */
export function zoomView(view, scale, focus, bounds, minSpan = MIN_SPAN_DAYS) {
  const span = view.x1 - view.x0
  const max = Math.max(minSpan, bounds.x1 - bounds.x0)
  const next = Math.min(max, Math.max(minSpan, span * scale))
  const anchor = view.x0 + span * focus
  const x0 = anchor - next * focus
  return shiftInto({ x0, x1: x0 + next }, bounds)
}

/** Slide the view by a number of days (positive = later). */
export function panView(view, days, bounds) {
  return shiftInto({ x0: view.x0 + days, x1: view.x1 + days }, bounds)
}

/** Where a date lands, in plot pixels. One function for points and overlays alike. */
export function xFor(date, view, plot) {
  const f = (dayNum(date) - view.x0) / (view.x1 - view.x0 || 1)
  return plot.left + f * (plot.right - plot.left)
}

/** The y for a value on a fitted axis. */
export function yFor(value, axis, plot) {
  return plot.bottom - ((value - axis.lo) / (axis.hi - axis.lo || 1)) * (plot.bottom - plot.top)
}

/** The axis for whatever is in view right now, falling back so it is never empty. */
export function axisFor(series, view, range, today) {
  const seen = inView(series, view)
  if (seen.length) return fitY(seen)
  const win = rangeSeries(series, range, today)
  return fitY(win.length ? win : series || [])
}

/**
 * Place compound-overlay events for a view. `visible` is false for any outside
 * it, so they are dropped rather than pinned to the edge at the wrong date.
 */
export function placeEvents(events, view, plot) {
  return events.map((e) => {
    const d = dayNum(e.date)
    return { ...e, x: xFor(e.date, view, plot), visible: d >= view.x0 && d <= view.x1 }
  })
}

/**
 * The reference interval, clamped to what the axis shows. A bound off the axis
 * is not drawn (it would sit outside the chart); the band still fills what is
 * in view.
 */
export function refGeometry(range, axis, plot) {
  const low = range?.low ?? null
  const high = range?.high ?? null
  if (low == null && high == null) return null
  const top = high != null ? Math.min(axis.hi, high) : axis.hi
  const bottom = low != null ? Math.max(axis.lo, low) : axis.lo
  if (top <= bottom) return null
  return {
    top: yFor(top, axis, plot),
    bottom: yFor(bottom, axis, plot),
    lines: [low, high].filter((v) => v != null && v >= axis.lo && v <= axis.hi),
  }
}

// ---------------------------------------------------------------- labels

/**
 * Which point labels to print. Out-of-range values and the ends of what is
 * visible win; the rest are added left to right only where there is room, so
 * numbers never sit on top of each other. Zoom in and the gaps open up.
 */
export function visibleLabels(points, { minGap = 26, priority = () => 0 } = {}) {
  const order = points
    .map((p, i) => ({ i, x: p.x, pr: priority(p, i) }))
    .sort((a, b) => b.pr - a.pr || a.i - b.i)
  const kept = []
  for (const c of order) {
    if (kept.every((k) => Math.abs(k.x - c.x) >= minGap)) kept.push(c)
  }
  return new Set(kept.map((k) => k.i))
}

/** Rough gap one printed value needs, from its length. */
export function labelGap(valueText) {
  return Math.max(24, String(valueText).length * 6 + 8)
}
