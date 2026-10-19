// The arithmetic behind every trend chart: which points to draw for a range,
// the y axis, where each value label goes and which labels survive a
// collision, the date labels along the bottom, and the protocol pins.
// Pure: the chart component only draws what these return.

export type RangeKey = '30D' | '90D' | '6M' | '1Y' | '2Y' | 'All'
export const RANGES: Array<{ key: RangeKey; days: number | null }> = [
  { key: '30D', days: 30 }, { key: '90D', days: 90 }, { key: '6M', days: 182 }, { key: '1Y', days: 365 }, { key: '2Y', days: 730 }, { key: 'All', days: null },
]

export interface SeriesPoint {
  date: string
  value: number
  source?: string
  sourceLabel?: string
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
}

const MS = 86400000
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / MS)
const fromNum = (n: number) => new Date(n * MS).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => fromNum(dayNum(d) + n)
const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp

export type Bucket = 'day' | 'week' | 'month'
export const bucketFor = (range: RangeKey): Bucket => (range === '30D' ? 'day' : range === '90D' || range === '6M' ? 'week' : 'month')

/** Monday of the week a date falls in. */
export function weekStart(d: string): string {
  const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(d, -dow)
}

export function rangeBounds(range: RangeKey, today: string, series: SeriesPoint[]): { from: string; to: string } {
  const r = RANGES.find((x) => x.key === range) || RANGES[1]
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
  for (const s of scans) out.push({ x: s.date, from: s.date, to: s.date, value: s.value, n: 1, sources: [s.sourceLabel || 'Scan'], scan: true })
  return out.sort((a, b) => a.x.localeCompare(b.x) || Number(a.scan) - Number(b.scan))
}

// ------------------------------------------------------------------ y axis

export const MIN_SPAN: Record<string, number> = {
  weight: 6, fatMass: 4, leanMass: 4, bodyFat: 4, muscleMass: 4, visceralFat: 2,
  rhr: 10, hrv: 20, sleep: 3, readiness: 40,
  vo2max: 4, bp: 20, waist: 4, // not in the brief's list: calls made here
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

const overlaps = (a: LabelBox, b: LabelBox) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h

/**
 * Which labels to show. First, last, highest, lowest and scan labels always
 * stay; any other label that collides with one already kept is hidden, the
 * later label winning over the earlier.
 */
export function pickLabels(boxes: LabelBox[]): Set<number> {
  const keep = new Set<number>()
  if (!boxes.length) return keep
  const vals = boxes.map((b) => b.value)
  const hi = vals.indexOf(Math.max(...vals))
  const lo = vals.indexOf(Math.min(...vals))
  ;[0, boxes.length - 1, hi, lo].forEach((i) => keep.add(i))
  boxes.forEach((b, i) => { if (b.scan) keep.add(i) })
  for (let i = boxes.length - 1; i >= 0; i--) {
    if (keep.has(i)) continue
    if ([...keep].every((k) => !overlaps(boxes[i], boxes[k]))) keep.add(i)
  }
  return keep
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
  const n = 5
  return Array.from({ length: n }, (_, i) => {
    const d = fromNum(Math.round(dayNum(from) + (span * i) / (n - 1)))
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
