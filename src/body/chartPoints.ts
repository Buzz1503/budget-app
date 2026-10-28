// The arithmetic behind every trend chart: which points to draw for a range,
// the y axis, where each value label goes and which labels survive a
// collision, the date labels along the bottom, and the protocol pins.
// Pure: the chart component only draws what these return.

export type RangeKey = 'Start' | '30D' | '90D' | '6M' | '1Y' | '2Y' | 'All'
/** `Start` runs from the starting point to today; it is only offered on charts that have one. */
export const RANGES: Array<{ key: RangeKey; days: number | null; label: string }> = [
  { key: 'Start', days: null, label: 'Since start' },
  { key: '30D', days: 30, label: '30D' }, { key: '90D', days: 90, label: '90D' }, { key: '6M', days: 182, label: '6M' },
  { key: '1Y', days: 365, label: '1Y' }, { key: '2Y', days: 730, label: '2Y' }, { key: 'All', days: null, label: 'All' },
]

export interface SeriesPoint {
  date: string
  value: number
  source?: string
  sourceLabel?: string
  estimated?: boolean
}

export interface PlotPoint {
  /** where the point is drawn: the day, the week's midpoint or the month's */
  x: string
  from: string
  to: string
  value: number
  n: number
  sources: string[]
  scan: boolean
  /** an estimated value (the starting entry): drawn as a dashed ring */
  estimated?: boolean
  /** points folded into this marker by mergeScans, oldest first; this point is the latest */
  members?: PlotPoint[]
}

const MS = 86400000
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / MS)
const fromNum = (n: number) => new Date(n * MS).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => fromNum(dayNum(d) + n)
const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp

export type Bucket = 'day' | 'week' | 'month'
/**
 * Daily for up to 45 days shown, weekly up to 200, monthly beyond. With the
 * window known the bucket follows what is actually on screen, so a 90 day
 * range fitted to three weeks of data is drawn day by day.
 */
export const bucketFor = (range: RangeKey, from?: string, to?: string): Bucket => {
  if (from && to) {
    const span = dayNum(to) - dayNum(from)
    return span <= 45 ? 'day' : span <= 200 ? 'week' : 'month'
  }
  return range === '30D' ? 'day' : range === '90D' || range === '6M' ? 'week' : 'month'
}

/** The narrowest window a chart is drawn over, in days. */
export const MIN_SPAN_DAYS = 14
/** A series younger than this many days opens on All. */
export const ALL_UNDER_DAYS = 90
/** A series with fewer points than this is a short list, not a chart. */
export const LIST_UNDER_POINTS = 3

const firstDate = (series: SeriesPoint[]) => series.reduce((m, p) => (p.date < m ? p.date : m), series[0].date)
const lastDate = (series: SeriesPoint[]) => series.reduce((m, p) => (p.date > m ? p.date : m), series[0].date)

/**
 * Fit a window to the data: when the first point comes after the window's
 * start, the axis starts at the first point, so there is never empty space
 * before the data. A window shorter than 14 days is widened to 14, centred on
 * the data, without running past the window's end.
 */
export function fitToData(bounds: { from: string; to: string }, series: SeriesPoint[]): { from: string; to: string } {
  if (!series.length) return bounds
  let from = bounds.from
  let to = bounds.to
  const first = firstDate(series)
  if (first > from) from = first
  if (dayNum(to) - dayNum(from) + 1 < MIN_SPAN_DAYS) {
    const last = lastDate(series) < to ? lastDate(series) : to
    const mid = Math.floor((dayNum(from) + dayNum(last)) / 2)
    let a = mid - Math.floor((MIN_SPAN_DAYS - 1) / 2)
    let b = a + MIN_SPAN_DAYS - 1
    const end = dayNum(bounds.to)
    if (b > end) { a -= b - end; b = end }
    from = fromNum(a)
    to = fromNum(b)
  }
  return { from, to }
}

/** Charts of the Sleep tab and the Sauna tab: pins and lanes start off there. */
export const SLEEP_CHARTS = ['sleep', 'sleepScore', 'deepSleep', 'remSleep', 'sleepHR', 'sleepHrv', 'bedtime', 'restlessness', 'snoring', 'awake', 'sleepLatency', 'waso', 'hrDip']
/** Whether a chart opens with overlay pins off (lanes are always off until chosen). */
export const pinsOffByDefault = (chartType: string) => chartType.startsWith('sauna') || chartType.startsWith('sleep') || SLEEP_CHARTS.includes(chartType)

/** A series with fewer than 3 points is shown as a short list of its values, not a chart. */
export const chartMode = (series: SeriesPoint[]): 'list' | 'chart' => (series.length < LIST_UNDER_POINTS ? 'list' : 'chart')

/** The range a chart opens on: All for a series with under 90 days of data, otherwise the chart's own default. */
export function defaultRangeFor(series: SeriesPoint[], today: string, fallback: RangeKey): RangeKey {
  if (!series.length) return fallback
  return dayNum(today) - dayNum(firstDate(series)) < ALL_UNDER_DAYS ? 'All' : fallback
}

/** Monday of the week a date falls in. */
export function weekStart(d: string): string {
  const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(d, -dow)
}

export function rangeBounds(range: RangeKey, today: string, series: SeriesPoint[], startDate?: string | null): { from: string; to: string } {
  const r = RANGES.find((x) => x.key === range) || RANGES[2]
  if (range === 'Start') {
    const first = series.length ? series.reduce((m, p) => (p.date < m ? p.date : m), series[0].date) : today
    return { from: startDate && startDate <= today ? startDate : first, to: today }
  }
  if (r.days == null) return fitToData({ from: series.length ? firstDate(series) : today, to: today }, series)
  return fitToData({ from: addDays(today, -(r.days - 1)), to: today }, series)
}

/**
 * Points for a range: daily for 30 days, weekly averages (Monday to Sunday,
 * drawn mid-week) for 90 days and 6 months, monthly averages for a year and
 * all time. A scan is always its own point and is not folded into an average.
 */
export function bucketPoints(series: SeriesPoint[], bucket: Bucket, from: string, to: string): PlotPoint[] {
  const inRange = series.filter((p) => p.date >= from && p.date <= to && Number.isFinite(p.value))
  const scans = inRange.filter((p) => p.source === 'scan')
  const rest = inRange.filter((p) => p.source !== 'scan')
  const groups = new Map<string, SeriesPoint[]>()
  const keyOf = (d: string) => (bucket === 'day' ? d : bucket === 'week' ? weekStart(d) : d.slice(0, 7))
  for (const p of rest) {
    const k = keyOf(p.date)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(p)
  }
  const out: PlotPoint[] = []
  for (const [k, pts] of groups) {
    let f: string
    let t: string
    let x: string
    if (bucket === 'day') { f = k; t = k; x = k } else if (bucket === 'week') { f = k; t = addDays(k, 6); x = addDays(k, 3) } else {
      f = `${k}-01`
      const next = new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 1)).toISOString().slice(0, 10)
      t = addDays(next, -1)
      x = `${k}-15`
    }
    // a week or month cut off by the range is drawn at the middle of the part shown
    if (bucket !== 'day' && (f < from || t > to)) {
      const a = f < from ? from : f
      const b = t > to ? to : t
      x = fromNum(Math.round((dayNum(a) + dayNum(b)) / 2))
    }
    out.push({
      x, from: f, to: t, n: pts.length, scan: false,
      value: round(pts.reduce((s, p) => s + p.value, 0) / pts.length),
      sources: [...new Set(pts.map((p) => p.sourceLabel || p.source || 'Manual'))],
    })
  }
  for (const s of scans) out.push({ x: s.date, from: s.date, to: s.date, value: s.value, n: 1, sources: [s.sourceLabel || 'Scan'], scan: true, ...(s.estimated ? { estimated: true } : {}) })
  return out.sort((a, b) => a.x.localeCompare(b.x) || Number(a.scan) - Number(b.scan))
}

// ------------------------------------------------------------------ y axis

export const MIN_SPAN: Record<string, number> = {
  weight: 6, fatMass: 4, leanMass: 4, bodyFat: 4, muscleMass: 4, visceralFat: 2,
  rhr: 10, hrv: 20, sleep: 3, readiness: 40,
  vo2max: 4, bp: 20, waist: 4, // not in the brief's list: calls made here
  sleepScore: 30, deepSleep: 40, remSleep: 40, sleepHR: 10, bedtime: 60, saunaLength: 10, saunaTemp: 10,
  restlessness: 4, snoring: 20, awake: 30, sleepLatency: 20, waso: 30, hrDip: 10,
}
/** Share of the data's span added above and below the y axis. */
export const AXIS_PAD = 0.05
const STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]

/**
 * A y axis that is never tighter than the metric's minimum span, centred on
 * the data, with 4 or 5 round gridlines. `zero` starts it at 0.
 */
export function yAxis(values: number[], minSpan = 1, { zero = false, pad = AXIS_PAD }: { zero?: boolean; pad?: number } = {}): { lo: number; hi: number; ticks: number[] } {
  let lo = values.length ? Math.min(...values) : 0
  let hi = values.length ? Math.max(...values) : 1
  // a little room above and below, so no point sits on the edge of the plot
  if (!zero && hi > lo) {
    const room = (hi - lo) * pad
    // never below zero for data that never is (minutes, kg)
    lo = lo >= 0 ? Math.max(0, lo - room) : lo - room
    hi += room
  }
  if (zero) {
    lo = 0
    hi = Math.max(hi, minSpan)
  } else if (hi - lo < minSpan) {
    const c = (lo + hi) / 2
    lo = c - minSpan / 2
    hi = c + minSpan / 2
  }
  for (const step of STEPS) {
    const a = Math.floor(lo / step + 1e-9) * step
    const b = Math.ceil(hi / step - 1e-9) * step
    let n = Math.round((b - a) / step) + 1
    if (n > 5) continue
    let top = b
    let bottom = a
    while (n < 4) {
      // grow on the side with more room, keeping the data centred
      if (!zero && (lo - bottom) < (top - hi)) bottom -= step
      else top += step
      n++
    }
    const ticks = Array.from({ length: n }, (_, i) => round(bottom + i * step, 4))
    return { lo: bottom, hi: top, ticks }
  }
  return { lo, hi, ticks: [lo, hi] }
}

// ------------------------------------------------------------------ labels

/** Above a point if it sits higher than the average of its neighbours, else below. */
export function labelPlacement(values: number[]): Array<'above' | 'below'> {
  return values.map((v, i) => {
    const nb = [values[i - 1], values[i + 1]].filter((x) => x != null) as number[]
    if (!nb.length) return 'above'
    const avg = nb.reduce((a, b) => a + b, 0) / nb.length
    return v >= avg ? 'above' : 'below'
  })
}

export interface LabelBox { x: number; y: number; w: number; h: number; scan?: boolean; value: number }

/** At most one value label per this many pixels of width. */
export const LABEL_SPACING = 48

/**
 * Which labels to show. First, last, highest and lowest always stay. Any
 * other label stays only if it is at least 48 px (one label per 48 px of
 * width) from every label already kept: scan labels are offered first, then
 * the rest, the later point winning. Everything else is hidden.
 */
export function pickLabels(boxes: LabelBox[], spacing = LABEL_SPACING): Set<number> {
  const keep = new Set<number>()
  if (!boxes.length) return keep
  const vals = boxes.map((b) => b.value)
  const hi = vals.indexOf(Math.max(...vals))
  const lo = vals.indexOf(Math.min(...vals))
  ;[0, boxes.length - 1, hi, lo].forEach((i) => keep.add(i))
  const tryKeep = (i: number) => {
    if (keep.has(i)) return
    if ([...keep].every((k) => Math.abs(boxes[i].x - boxes[k].x) >= spacing)) keep.add(i)
  }
  for (let i = boxes.length - 1; i >= 0; i--) if (boxes[i].scan) tryKeep(i)
  for (let i = boxes.length - 1; i >= 0; i--) if (!boxes[i].scan) tryKeep(i)
  return keep
}

// ------------------------------------------------------------ connectors

/** A gap longer than this many days between two points draws as a faint dashed connector, not a break. */
export const GAP_DAYS = 120

export interface Segment { a: PlotPoint; b: PlotPoint; gap: boolean }

/** The line through a series: every neighbouring pair is joined, and a long silence is marked as a gap. */
export function lineSegments(points: PlotPoint[], gapDays = GAP_DAYS): Segment[] {
  const sortedPts = [...points].sort((p, q) => p.x.localeCompare(q.x))
  const out: Segment[] = []
  for (let i = 1; i < sortedPts.length; i++) {
    out.push({ a: sortedPts[i - 1], b: sortedPts[i], gap: dayNum(sortedPts[i].x) - dayNum(sortedPts[i - 1].x) > gapDays })
  }
  return out
}

// ----------------------------------------------------------- merged scans

/** Scans within this many days of the first one in a cluster draw as one marker. */
export const MERGE_DAYS = 10

/**
 * Scans close together draw as one marker: the latest of them, with a "+1"
 * badge for each of the others (tap it to see them all). A cluster runs for 10
 * days from its first scan. Averaged points (a week, a month) are left alone.
 */
export function mergeScans(points: PlotPoint[], days = MERGE_DAYS): PlotPoint[] {
  const scans = points.filter((p) => p.scan).sort((a, b) => a.x.localeCompare(b.x))
  const rest = points.filter((p) => !p.scan)
  const clusters: PlotPoint[][] = []
  for (const p of scans) {
    const last = clusters[clusters.length - 1]
    if (last && dayNum(p.x) - dayNum(last[0].x) <= days) last.push(p)
    else clusters.push([p])
  }
  const merged = clusters.map((c) => (c.length === 1 ? c[0] : { ...c[c.length - 1], members: c }))
  return [...rest, ...merged].sort((a, b) => a.x.localeCompare(b.x) || Number(a.scan) - Number(b.scan))
}

// ---------------------------------------------------------------- scrubbing

/** The point nearest to a horizontal position, or -1 for no points. */
export function nearestPoint(xs: number[], at: number): number {
  let best = -1
  let dist = Infinity
  xs.forEach((x, i) => {
    const d = Math.abs(x - at)
    if (d < dist) { dist = d; best = i }
  })
  return best
}

// ------------------------------------------------------------------ x axis

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`

/** 4 to 6 date labels: month names for long ranges, "12 Oct" for short ones. Never rotated. */
export function xTicks(from: string, to: string): Array<{ date: string; label: string }> {
  const span = dayNum(to) - dayNum(from)
  if (span > 150) {
    const months: string[] = []
    let y = Number(from.slice(0, 4))
    let m = Number(from.slice(5, 7))
    for (;;) {
      m += 1
      if (m > 12) { m = 1; y += 1 }
      const d = `${y}-${String(m).padStart(2, '0')}-01`
      if (d > to) break
      months.push(d)
    }
    const multiYear = from.slice(0, 4) !== to.slice(0, 4) && span > 400
    // "Feb 25" is twice as wide as "Feb": fewer of them, so 12 pt labels never touch
    const k = Math.max(1, Math.ceil(months.length / (multiYear ? 4 : 6)))
    const picked = months.filter((_, i) => i % k === 0)
    if (picked.length >= (multiYear ? 3 : 4)) {
      return picked.map((d) => ({ date: d, label: multiYear ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}` : MONTHS[Number(d.slice(5, 7)) - 1] }))
    }
  }
  // a window of a few days has fewer than five distinct dates: one tick each
  const n = Math.max(1, Math.min(5, span + 1))
  return Array.from({ length: n }, (_, i) => {
    const d = fromNum(Math.round(dayNum(from) + (n === 1 ? 0 : (span * i) / (n - 1))))
    return { date: d, label: shortDate(d) }
  })
}

// -------------------------------------------------------------------- pins

export interface EventGroup<E extends { date: string }> {
  date: string
  events: E[]
}

/** Events within `days` of the previous one share a group: one phase boundary, one chart pin. */
export function groupEvents<E extends { date: string }>(events: E[], days = 7): Array<EventGroup<E>> {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date))
  const out: Array<EventGroup<E>> = []
  for (const e of sorted) {
    const last = out[out.length - 1]
    if (last && dayNum(e.date) - dayNum(last.events[last.events.length - 1].date) <= days) last.events.push(e)
    else out.push({ date: e.date, events: [e] })
  }
  return out
}

// ------------------------------------------------------------------ header

const longDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`

/** "down 2.0 kg over 90 days" (or just "down 2.0 kg" without the days) */
export function rangeChangeWords(points: PlotPoint[], unit: string, dp: number, from: string, to: string, withDays = true): string | null {
  if (points.length < 2) return null
  const d = points[points.length - 1].value - points[0].value
  const days = dayNum(to) - dayNum(from) + 1
  const v = Math.abs(d).toFixed(dp)
  const over = withDays ? ` over ${days} days` : ''
  if (Number(v) === 0) return `about the same${over}`
  return `${d > 0 ? 'up' : 'down'} ${v}${unit ? ` ${unit}` : ''}${over}`
}

const worded = (d: number, unit: string, dp: number, tail: string) => {
  const v = Math.abs(d).toFixed(dp)
  return Number(v) === 0 ? `about the same ${tail}` : `${d > 0 ? 'up' : 'down'} ${v}${unit ? ` ${unit}` : ''} ${tail}`
}

/**
 * The change in a chart's header, from the one series it shows.
 *
 *  - "Since start": the latest value against the starting value
 *    ("down 13.9 kg since 1 Jan 2025").
 *  - Any other range: the first value of the same series inside the range
 *    against the last ("down 0.6 kg over 78 days", counting the days between
 *    those two readings), never a mix of two sources or of averaged points and
 *    raw ones. Needs two readings in the range.
 */
export function rangeChange({ series, from, to, range, startValue = null, startDate = null, unit = '', dp = 1 }: {
  series: Array<{ date: string; value: number }>
  from: string
  to: string
  range: RangeKey
  startValue?: number | null
  startDate?: string | null
  unit?: string
  dp?: number
}): { delta: number | null; words: string | null } {
  const inRange = series.filter((p) => p.date >= from && p.date <= to && Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date))
  if (range === 'Start' && startValue != null && startDate && inRange.length) {
    const delta = round(inRange[inRange.length - 1].value - startValue, 4)
    return { delta, words: worded(delta, unit, dp, `since ${longDate(startDate)}`) }
  }
  if (inRange.length < 2) return { delta: null, words: null }
  const first = inRange[0]
  const last = inRange[inRange.length - 1]
  const delta = round(last.value - first.value, 4)
  const days = dayNum(last.date) - dayNum(first.date)
  return { delta, words: worded(delta, unit, dp, `over ${days} day${days === 1 ? '' : 's'}`) }
}

// ---------------------------------------------------------- reference band

export interface Band { lo: number; hi: number; label?: string }

/** The part of a reference band inside the axis, or null when none of it is. */
export function bandInView(band: Band | null, axis: { lo: number; hi: number }): { lo: number; hi: number } | null {
  if (!band) return null
  const lo = Math.max(band.lo, axis.lo)
  const hi = Math.min(band.hi, axis.hi)
  return hi > lo ? { lo, hi } : null
}

/** When the band is wholly outside the chart: "Evolt healthy range 15 to 20%, below this chart". */
export function bandCaption(band: Band | null, axis: { lo: number; hi: number }, unit = ''): string | null {
  if (!band || bandInView(band, axis)) return null
  const where = band.hi <= axis.lo ? 'below' : 'above'
  const u = unit === '%' ? '%' : unit ? ` ${unit}` : ''
  return `${band.label || 'Reference range'} ${band.lo} to ${band.hi}${u}, ${where} this chart`
}

// ------------------------------------------------------ label collisions

export interface Placed { id: string; x: number; y: number; w: number; h: number; anchor?: 'start' | 'middle' | 'end' }

/** A label's box from its anchor point (x is the text anchor, y the baseline). */
export function boxOf(p: Placed): { l: number; r: number; t: number; b: number } {
  const l = p.anchor === 'end' ? p.x - p.w : p.anchor === 'start' ? p.x : p.x - p.w / 2
  return { l, r: l + p.w, t: p.y - p.h, b: p.y + 2 }
}

const overlaps = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

/**
 * Which labels to draw: candidates in priority order (first wins), each kept
 * only if it overlaps no label already kept, no fixed obstacle (the axis
 * labels) and stays inside the bounds. Lower priority labels hide.
 */
export function placeLabels(candidates: Placed[], obstacles: Placed[] = [], bounds: { l: number; r: number; t: number; b: number } | null = null): Set<string> {
  const kept: Array<ReturnType<typeof boxOf>> = obstacles.map(boxOf)
  const out = new Set<string>()
  for (const c of candidates) {
    const b = boxOf(c)
    if (bounds && (b.l < bounds.l || b.r > bounds.r || b.t < bounds.t || b.b > bounds.b)) continue
    if (kept.some((k) => overlaps(k, b))) continue
    kept.push(b)
    out.add(c.id)
  }
  return out
}

/** The value labels worth reading, by priority: last, first, lowest, highest (indexes, no repeats). */
export function labelPriority(values: number[]): number[] {
  if (!values.length) return []
  const last = values.length - 1
  const lo = values.indexOf(Math.min(...values))
  const hi = values.indexOf(Math.max(...values))
  return [...new Set([last, 0, lo, hi])]
}

// ---------------------------------------------------------- zoom and pan

export interface Window { from: string; to: string }

/** The narrowest full-screen window, in days. */
export const ZOOM_MIN_DAYS = 14

/**
 * Zoom a date window by `factor` (under 1 zooms in) around a point `at` (0 left, 1 right),
 * never narrower than `minDays` and never outside `bounds`.
 */
export function zoomWindow(win: Window, factor: number, at: number, bounds: Window, minDays = ZOOM_MIN_DAYS): Window {
  const a = dayNum(win.from)
  const b = dayNum(win.to)
  const lo = dayNum(bounds.from)
  const hi = dayNum(bounds.to)
  const span = Math.max(minDays, Math.min(hi - lo, Math.round((b - a) * factor)))
  const centre = a + (b - a) * Math.min(1, Math.max(0, at))
  let from = Math.round(centre - span * Math.min(1, Math.max(0, at)))
  let to = from + span
  if (from < lo) { to += lo - from; from = lo }
  if (to > hi) { from -= to - hi; to = hi }
  return { from: fromNum(Math.max(lo, from)), to: fromNum(to) }
}

/** Slide a window by `days`, kept inside `bounds`. */
export function panWindow(win: Window, days: number, bounds: Window): Window {
  const a = dayNum(win.from)
  const b = dayNum(win.to)
  const lo = dayNum(bounds.from)
  const hi = dayNum(bounds.to)
  const shift = Math.max(lo - a, Math.min(hi - b, Math.round(days)))
  return { from: fromNum(a + shift), to: fromNum(b + shift) }
}

// --------------------------------------------------- likely bad readings

export const SUSPECT = { kg: 3, days: 14 }

/**
 * Readings that look wrong: more than `kg` away from both neighbouring readings,
 * each within `days`. They are only flagged here; nothing is ever deleted.
 */
export function suspectReadings<P extends { date: string; value: number }>(series: P[], { kg = SUSPECT.kg, days = SUSPECT.days } = {}): P[] {
  const s = [...series].sort((a, b) => a.date.localeCompare(b.date))
  const out: P[] = []
  for (let i = 1; i < s.length - 1; i++) {
    const p = s[i]
    const a = s[i - 1]
    const b = s[i + 1]
    const near = dayNum(p.date) - dayNum(a.date) <= days && dayNum(b.date) - dayNum(p.date) <= days
    if (near && Math.abs(p.value - a.value) > kg && Math.abs(p.value - b.value) > kg) out.push(p)
  }
  return out
}
