// One answer to "what is my weight (or body fat, or lean mass) now?".
//
// Body readings come from three places: entries typed into the app, scans
// imported into the app, and Apple Health (a Withings scale or another app).
// Each field is resolved on its own: the most recent day that has a value,
// from any source. Source priority only settles ties within the same day:
// scan, then manual, then Withings, then other apps. An older manual entry
// never beats a newer Health reading. Nothing here writes or deletes entries.
//
// Every reading belongs to one of three families (src/body/sources.ts): Scale
// (Withings, typed-in and other-app weights), Evolt (scans) and DEXA (every
// other scan). DEXA is left out of every series here: it has its own page and
// is never charted or averaged with anything.

import { familyOfEntry, FAMILY_LABEL as SOURCE_FAMILY_LABEL, SCALE_RANK } from './sources'
import { suspectReadings } from './chartPoints'

export type BodySource = 'scan' | 'manual' | 'withings' | 'other'
/**
 * Any numeric field an entry can hold: weight, bodyFat, leanMass, fatMass, bp,
 * muscleMass, visceralFat, waist, the tape measurements, and the scan-only
 * fields (skeletalMuscleMass, visceralFatLevel, visceralFatMass,
 * visceralFatArea, subcutaneousFatMass). A field is only ever compared with
 * itself: a scan's skeletal muscle mass is not the app's muscle mass.
 */
export type BodyField = string

/** Numbers on an entry that describe the scan, not the body. */
const NOT_MEASURES = new Set(['heightCm', 'ageAtScan'])

/**
 * Same-day order: an Evolt scan, then Withings, then typed in, then other
 * apps (the Scale order from the brief; see SCALE_RANK).
 */
export const SOURCE_RANK: Record<BodySource, number> = { scan: 4, withings: SCALE_RANK.withings, manual: SCALE_RANK.manual, other: SCALE_RANK.other }
export const STALE_DAYS = 14

export interface MeasurementLike {
  date: string
  source?: string | null
  /** scan device: Evolt 360, DEXA, InBody, Other */
  device?: string | null
  scanType?: string | null
  /** an entry kept on record but left out of every series (an original scan behind an adjusted one) */
  hiddenFromCharts?: boolean
  [field: string]: unknown
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
  /** Scale weights left out of every line and number ("date|value"), see `suspectWeights`; never deleted */
  excludeWeight?: string[]
}

export interface DayPoint {
  date: string
  value: number
  source: BodySource
  sourceLabel: string
  /** source family: scale, evolt or dexa */
  family?: string
  /** an estimated value (the starting entry) */
  estimated?: boolean
  /** diastolic, for blood pressure */
  extra?: number | null
}

interface Reading {
  date: string
  order: number
  source: BodySource
  sourceLabel: string
  family: string
  estimated?: boolean
  values: Record<string, number>
}

/**
 * Body fat %, fat mass and lean mass depend heavily on the device: a scan and
 * a bathroom scale on the same morning disagree by several points. They are
 * kept as one series per family and never averaged or compared across
 * families. Weight is also offered per family, but the merged series still
 * answers "what is my weight now".
 */
export const FAMILY_FIELDS = new Set(['bodyFat', 'fatMass', 'leanMass'])
export const FAMILY_LABEL = SOURCE_FAMILY_LABEL

/** The family a device name belongs to (a scan's device decides it). */
export function familyOfDevice(device: string | null | undefined): string {
  return familyOfEntry({ date: '', source: 'scan', device: device || '' })
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp

export const sourceLabel = (source: BodySource, name?: string | null): string =>
  source === 'scan' ? (name || 'Scan') : source === 'manual' ? 'Manual' : source === 'withings' ? 'Withings' : (name || 'Apple Health')

const isEstimated = (m: MeasurementLike) => m.estimated === true

function readingsFrom({ measurements = [], health = [], excludeWeight = [] }: BodyInput): Reading[] {
  const out: Reading[] = []
  const skip = new Set(excludeWeight)
  measurements.forEach((m, i) => {
    if (m.hiddenFromCharts) return
    const family = familyOfEntry(m)
    const source: BodySource = family === 'scale' ? 'manual' : 'scan'
    const values: Reading['values'] = {}
    for (const [k, raw] of Object.entries(m)) {
      if (NOT_MEASURES.has(k) || typeof raw === 'object' || typeof raw === 'boolean') continue
      if (typeof raw === 'string' && !/^-?\d+(\.\d+)?$/.test(raw.trim())) continue
      const v = num(raw)
      if (v != null) values[k] = v
    }
    const label = sourceLabel(source, m.device || m.scanType)
    out.push({ date: m.date, order: i, source, sourceLabel: label, family, estimated: isEstimated(m), values })
  })
  health.forEach((h, i) => {
    const source: BodySource = /withings/i.test(h.weightSource || '') ? 'withings' : 'other'
    const values: Reading['values'] = {}
    if (num(h.weight) != null) values.weight = num(h.weight) as number
    if (num(h.bodyFatPct) != null) values.bodyFat = num(h.bodyFatPct) as number
    if (num(h.leanMass) != null) values.leanMass = num(h.leanMass) as number
    if (num(h.bpSys) != null) values.bpSys = num(h.bpSys) as number
    if (num(h.bpDia) != null) values.bpDia = num(h.bpDia) as number
    out.push({ date: h.date, order: measurements.length + i, source, sourceLabel: sourceLabel(source, h.weightSource), family: 'scale', values })
  })
  if (skip.size) {
    for (const r of out) {
      if (r.family === 'scale' && r.values.weight != null && skip.has(weightKey(r.date, r.values.weight))) delete r.values.weight
    }
  }
  return out
}

/** The key a Scale weight is kept or hidden by: its day and value. */
export const weightKey = (date: string, value: number) => `${date}|${value}`

export interface SuspectWeight { date: string; value: number; sourceLabel?: string; key: string }

/**
 * Scale weigh-ins that look wrong: more than 3 kg from both neighbouring
 * weigh-ins, each within 14 days (`suspectReadings`). Only flagged; the
 * reading stays in the data and can be kept.
 */
export function suspectWeights(input: BodyInput): SuspectWeight[] {
  const daily = familySeries('weight', { measurements: input.measurements, health: input.health }, 'scale')
  return suspectReadings(daily).map((p) => ({ date: p.date, value: p.value, sourceLabel: p.sourceLabel, key: weightKey(p.date, p.value) }))
}

/** One value per day for a stored field: the best source that day, the later entry on a tie. */
function resolveStored(readings: Reading[], key: string): Map<string, DayPoint> {
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
      date, value: r.values[key] as number, source: r.source, sourceLabel: r.sourceLabel, family: r.family,
      ...(r.estimated ? { estimated: true } : {}),
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
  return seriesFromReadings(field, chartable(readingsFrom(input)))
}

/** Every reading except DEXA, which is never charted or merged. */
const chartable = (readings: Reading[]) => readings.filter((r) => r.family !== 'dexa')

function seriesFromReadings(field: BodyField, readings: Reading[]): DayPoint[] {
  if (field === 'bp') return sorted(resolveStored(readings, 'bpSys'))
  if (field !== 'fatMass' && field !== 'leanMass') return sorted(resolveStored(readings, field))
  const weight = resolveStored(readings, 'weight')
  const fat = resolveStored(readings, 'bodyFat')
  // a scan's own fat mass counts as is; otherwise weight × body fat that day
  const fatMass = resolveStored(readings, 'fatMass')
  for (const [date, f] of fat) {
    const w = weight.get(date)
    if (w && !fatMass.has(date)) fatMass.set(date, { date, value: round(w.value * f.value / 100), source: f.source, sourceLabel: f.sourceLabel, family: f.family })
  }
  if (field === 'fatMass') return sorted(fatMass)
  const lean = resolveStored(readings, 'leanMass')
  for (const [date, fm] of fatMass) {
    const w = weight.get(date)
    if (w && !lean.has(date)) lean.set(date, { date, value: round(w.value - fm.value), source: fm.source, sourceLabel: fm.sourceLabel, family: fm.family })
  }
  return sorted(lean)
}

const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000)

/** One family's series for a field: only its own readings, fat and lean worked out within it. DEXA has none. */
export function familySeries(field: BodyField, input: BodyInput, family: string): DayPoint[] {
  if (family === 'dexa') return []
  return seriesFromReadings(field, readingsFrom(input).filter((r) => r.family === family))
}

/** Every chartable family that has the field, with its series (Scale and Evolt only). */
export function seriesByFamily(field: BodyField, input: BodyInput): Record<string, DayPoint[]> {
  const out: Record<string, DayPoint[]> = {}
  for (const f of ['scale', 'evolt']) {
    const s = familySeries(field, input, f)
    if (s.length) out[f] = s
  }
  return out
}

/**
 * Which family a comparison over [from, to] uses: Evolt when it has at least
 * two readings in the window, else Scale when it has any, else whichever has
 * the most readings there.
 */
export function pickFamily(field: BodyField, input: BodyInput, from: string, to: string): string | null {
  const by = seriesByFamily(field, input)
  const count = (f: string) => (by[f] || []).filter((p) => p.date >= from && p.date <= to).length
  if (count('evolt') >= 2) return 'evolt'
  if (count('scale') > 0) return 'scale'
  const ranked = Object.keys(by).map((f) => [f, count(f)] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  return ranked[0]?.[0] ?? null
}

export interface Latest extends DayPoint {
  ageDays: number
  stale: boolean
  count: number
}

/**
 * The headline weight: the newest weight reading from Scale or Evolt. On one
 * day Scale wins (Withings, then typed in, then other apps), then Evolt. DEXA
 * never counts, and neither does the estimated starting entry: it is a
 * starting point, not a weigh-in.
 */
export function headlineWeight(input: BodyInput): DayPoint | null {
  const pool = readingsFrom(input).filter((r) => r.values.weight != null && !r.estimated && (r.family === 'scale' || r.family === 'evolt'))
  let best: Reading | null = null
  const rank = (r: Reading) => (r.family === 'scale' ? 10 + SCALE_RANK[r.source === 'manual' ? 'manual' : r.source === 'withings' ? 'withings' : 'other'] : 0)
  for (const r of pool) {
    if (!best || r.date > best.date || (r.date === best.date && (rank(r) > rank(best) || (rank(r) === rank(best) && r.order > best.order)))) best = r
  }
  if (!best) return null
  return { date: best.date, value: best.values.weight as number, source: best.source, sourceLabel: best.sourceLabel, family: best.family }
}

/**
 * The current value of a field: the most recent day with one, from any
 * source. Weight follows headlineWeight (the newest Scale or Evolt reading);
 * everything else is the last point of its merged daily series.
 */
export function getLatestMeasurement(field: BodyField, input: BodyInput, today: string): Latest | null {
  const s = dailySeries(field, input)
  const last = field === 'weight' ? (headlineWeight(input) ?? s[s.length - 1]) : s[s.length - 1]
  if (!last) return null
  const ageDays = Math.max(0, dayNum(today) - dayNum(last.date))
  return {
    ...last,
    ageDays,
    stale: ageDays > STALE_DAYS,
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

/**
 * The headline reading when it comes from a different source than the chart is
 * showing (and that source has a line to switch to), else null: the chart's
 * "Latest reading is from Evolt, 26 Oct" caption shows only then.
 */
export function latestFromOtherSource(headline: { family?: string; date: string } | null, shown: string | null, available: string[]): { family: string; date: string } | null {
  if (!headline?.family || !shown || headline.family === shown || !available.includes(headline.family)) return null
  return { family: headline.family, date: headline.date }
}

export const SCALE_RATE = { windowDays: 28, minReadings: 2, minSpanDays: 7 }

/**
 * Change per week from the Scale readings of the last 4 weeks up to today:
 * one device only, never mixed with a scan. Hidden (null) with fewer than 2
 * readings, or when they are under a week apart (two readings a day apart
 * would turn ordinary noise into a rate).
 */
export function scaleWeeklyRate(input: BodyInput, today: string): number | null {
  const series = familySeries('weight', input, 'scale').filter((p) => dayNum(today) - dayNum(p.date) < SCALE_RATE.windowDays && p.date <= today)
  if (series.length < SCALE_RATE.minReadings) return null
  if (dayNum(series[series.length - 1].date) - dayNum(series[0].date) < SCALE_RATE.minSpanDays) return null
  const slope = slopePerDay(series)
  return slope == null ? null : round(slope * 7)
}

/** Mean of the readings in the 7 days up to the latest one. */
export function sevenDayAverage(series: DayPoint[]): number | null {
  if (!series.length) return null
  const end = dayNum(series[series.length - 1].date)
  const win = series.filter((p) => end - dayNum(p.date) < 7)
  return round(win.reduce((a, p) => a + p.value, 0) / win.length)
}
