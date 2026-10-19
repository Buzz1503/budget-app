// One answer to "what is my weight (or body fat, or lean mass) now?".
//
// Body readings come from three places: entries typed into the app, scans
// imported into the app, and Apple Health (a Withings scale or another app).
// Each field is resolved on its own: the most recent day that has a value,
// from any source. Source priority only settles ties within the same day:
// scan, then manual, then Withings, then other apps. An older manual entry
// never beats a newer Health reading. Nothing here writes or deletes entries.

export type BodySource = 'scan' | 'manual' | 'withings' | 'other'
export type BodyField = 'weight' | 'bodyFat' | 'leanMass' | 'fatMass' | 'bp' | 'muscleMass' | 'visceralFat' | 'waist'

export const SOURCE_RANK: Record<BodySource, number> = { scan: 4, manual: 3, withings: 2, other: 1 }
export const STALE_DAYS = 14

export interface MeasurementLike {
  date: string
  source?: string | null
  scanType?: string | null
  weight?: number | string | null
  bodyFat?: number | string | null
  muscleMass?: number | string | null
  visceralFat?: number | string | null
  waist?: number | string | null
  leanMass?: number | string | null
}

export interface HealthBodyLike {
  date: string
  weight?: number | null
  weightSource?: string | null
  bodyFatPct?: number | null
  leanMass?: number | null
  bpSys?: number | null
  bpDia?: number | null
}

export interface BodyInput {
  measurements?: MeasurementLike[]
  health?: HealthBodyLike[]
}

export interface DayPoint {
  date: string
  value: number
  source: BodySource
  sourceLabel: string
  /** diastolic, for blood pressure */
  extra?: number | null
}

interface Reading {
  date: string
  order: number
  source: BodySource
  sourceLabel: string
  values: Partial<Record<'weight' | 'bodyFat' | 'leanMass' | 'muscleMass' | 'visceralFat' | 'waist' | 'bpSys' | 'bpDia', number>>
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp

export const sourceLabel = (source: BodySource, name?: string | null): string =>
  source === 'scan' ? (name || 'Scan') : source === 'manual' ? 'Manual' : source === 'withings' ? 'Withings' : (name || 'Apple Health')

function readingsFrom({ measurements = [], health = [] }: BodyInput): Reading[] {
  const out: Reading[] = []
  measurements.forEach((m, i) => {
    const source: BodySource = m.source === 'scan' ? 'scan' : 'manual'
    const values: Reading['values'] = {}
    for (const k of ['weight', 'bodyFat', 'muscleMass', 'visceralFat', 'waist', 'leanMass'] as const) {
      const v = num(m[k])
      if (v != null) values[k] = v
    }
    out.push({ date: m.date, order: i, source, sourceLabel: sourceLabel(source, m.scanType), values })
  })
  health.forEach((h, i) => {
    const source: BodySource = /withings/i.test(h.weightSource || '') ? 'withings' : 'other'
    const values: Reading['values'] = {}
    if (num(h.weight) != null) values.weight = num(h.weight) as number
    if (num(h.bodyFatPct) != null) values.bodyFat = num(h.bodyFatPct) as number
    if (num(h.leanMass) != null) values.leanMass = num(h.leanMass) as number
    if (num(h.bpSys) != null) values.bpSys = num(h.bpSys) as number
    if (num(h.bpDia) != null) values.bpDia = num(h.bpDia) as number
    out.push({ date: h.date, order: measurements.length + i, source, sourceLabel: sourceLabel(source, h.weightSource), values })
  })
  return out
}

/** One value per day for a stored field: the best source that day, the later entry on a tie. */
function resolveStored(readings: Reading[], key: keyof Reading['values']): Map<string, DayPoint> {
  const best = new Map<string, Reading>()
  for (const r of readings) {
    if (r.values[key] == null) continue
    const cur = best.get(r.date)
    if (!cur || SOURCE_RANK[r.source] > SOURCE_RANK[cur.source] || (SOURCE_RANK[r.source] === SOURCE_RANK[cur.source] && r.order > cur.order)) {
      best.set(r.date, r)
    }
  }
  const out = new Map<string, DayPoint>()
  for (const [date, r] of best) {
    out.set(date, {
      date, value: r.values[key] as number, source: r.source, sourceLabel: r.sourceLabel,
      ...(key === 'bpSys' ? { extra: r.values.bpDia ?? null } : {}),
    })
  }
  return out
}

const sorted = (m: Map<string, DayPoint>) => [...m.values()].sort((a, b) => a.date.localeCompare(b.date))

/**
 * The merged daily series for one field, oldest first. Fat mass is weight ×
 * body fat on days with both; lean mass is the reported value, else weight −
 * fat mass.
 */
export function dailySeries(field: BodyField, input: BodyInput): DayPoint[] {
  const readings = readingsFrom(input)
  if (field === 'bp') return sorted(resolveStored(readings, 'bpSys'))
  if (field === 'weight' || field === 'bodyFat' || field === 'muscleMass' || field === 'visceralFat' || field === 'waist') {
    return sorted(resolveStored(readings, field))
  }
  const weight = resolveStored(readings, 'weight')
  const fat = resolveStored(readings, 'bodyFat')
  const fatMass = new Map<string, DayPoint>()
  for (const [date, f] of fat) {
    const w = weight.get(date)
    if (w) fatMass.set(date, { date, value: round(w.value * f.value / 100), source: f.source, sourceLabel: f.sourceLabel })
  }
  if (field === 'fatMass') return sorted(fatMass)
  const lean = resolveStored(readings, 'leanMass')
  for (const [date, fm] of fatMass) {
    if (!lean.has(date)) lean.set(date, { date, value: round((weight.get(date) as DayPoint).value - fm.value), source: fm.source, sourceLabel: fm.sourceLabel })
  }
  return sorted(lean)
}

const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000)

export interface Latest extends DayPoint {
  ageDays: number
  stale: boolean
  first: DayPoint
  /** latest − first on record; null with a single reading */
  sinceStart: number | null
  count: number
}

/** The current value of a field: the most recent day with one, from any source. */
export function getLatestMeasurement(field: BodyField, input: BodyInput, today: string): Latest | null {
  const s = dailySeries(field, input)
  if (!s.length) return null
  const last = s[s.length - 1]
  const ageDays = Math.max(0, dayNum(today) - dayNum(last.date))
  return {
    ...last,
    ageDays,
    stale: ageDays > STALE_DAYS,
    first: s[0],
    sinceStart: s.length > 1 ? round(last.value - s[0].value) : null,
    count: s.length,
  }
}

/** Least-squares slope, value per day. Needs two distinct days. */
export function slopePerDay(points: Array<{ date: string; value: number }>): number | null {
  if (points.length < 2) return null
  const xs = points.map((p) => dayNum(p.date))
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = points.reduce((a, p) => a + p.value, 0) / points.length
  let sxx = 0
  let sxy = 0
  points.forEach((p, i) => { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (p.value - my) })
  return sxx > 0 ? sxy / sxx : null
}

export const WEEKLY = { windowDays: 28, minReadings: 4, minSpanDays: 14 }

/**
 * Change per week: the trend of the merged series over the 28 days up to its
 * latest reading. Needs 4 readings spanning 14 days.
 */
export function weeklyChange(series: DayPoint[]): number | null {
  if (!series.length) return null
  const end = series[series.length - 1].date
  const win = series.filter((p) => dayNum(end) - dayNum(p.date) < WEEKLY.windowDays)
  if (win.length < WEEKLY.minReadings) return null
  if (dayNum(end) - dayNum(win[0].date) < WEEKLY.minSpanDays) return null
  const s = slopePerDay(win)
  return s == null ? null : round(s * 7)
}

/** Mean of the readings in the 7 days up to the latest one. */
export function sevenDayAverage(series: DayPoint[]): number | null {
  if (!series.length) return null
  const end = dayNum(series[series.length - 1].date)
  const win = series.filter((p) => end - dayNum(p.date) < 7)
  return round(win.reduce((a, p) => a + p.value, 0) / win.length)
}
