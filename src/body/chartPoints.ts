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
export const bucketFor = (range: RangeKey, from?: string, to?: string): Bucket => {
  if (range === 'Start' && from && to) {
    const span = dayNum(to) - dayNum(from)
    return span <= 45 ? 'day' : span <= 200 ? 'week' : 'month'
  }
  return range === '30D' ? 'day' : range === '90D' || range === '6M' ? 'week' : 'month'
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
  if (r.days == null) return { from: series.length ? series.reduce((m, p) => (p.date < m ? p.date : m), series[0].date) : today, to: today }
  return { from: addDays(today, -(r.days - 1)), to: today }
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
}
const STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]

/**
 * A y axis that is never tighter than the metric's minimum span, centred on
 * the data, with 4 or 5 round gridlines. `zero` starts it at 0.
 */
export function yAxis(values: number[], minSpan = 1, { zero = false }: { zero?: boolean } = {}): { lo: number; hi: number; ticks: number[] } {
  let lo = values.length ? Math.min(...values) : 0
  let hi = values.length ? Math.max(...values) : 1
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
    const k = Math.max(1, Math.ceil(months.length / 6))
    const picked = months.filter((_, i) => i % k === 0)
    if (picked.length >= 4) {
      const multiYear = from.slice(0, 4) !== to.slice(0, 4) && span > 400
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
