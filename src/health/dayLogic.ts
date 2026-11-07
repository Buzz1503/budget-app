// Turning raw Health samples into days, nights and workouts.
//
// Pure functions: everything they need is passed in, including the time zone,
// so the rules below are tested exactly as they run on the phone.
//
//  - Sleep samples from one source with gaps under an hour form a session.
//  - The main sleep is the longest session ending between 03:00 and 14:00
//    local. It belongs to the date you woke up. Everything else is a nap,
//    shown but never scored.
//  - One source per night: the chosen source (More › Health › Sleep source),
//    else the next one with data, marked as a fallback. Sources are never
//    merged, so a watch and a sleep mat cannot double count the same night.
//  - Overnight HRV is the mean of HRV samples inside the main sleep.

import type {
  RawQuantity, RawSleep, RawWorkout, RawBloodPressure, DayValue, SourceClass,
  SleepSession, SleepNight, SleepSegment, SleepingHR, HealthDaily, HealthWorkout,
} from './types'
import { EMPTY_DAILY } from './types'
import type { Tz } from './tz'
import { dateRange } from './tz'

export const SESSION_GAP_MIN = 60
export const MAIN_SLEEP_END_FROM_H = 3
export const MAIN_SLEEP_END_TO_H = 14
export const DEFAULT_SLEEP_PRIORITY: SourceClass[] = ['watch', 'withings', 'phone', 'other']

const MIN = 60000

/** Which kind of device wrote a sample, from its source name and bundle id. */
export function classifySource(name = '', id = ''): SourceClass {
  const n = name.toLowerCase()
  const b = id.toLowerCase()
  if (/withings|health ?mate|nokia/.test(n) || b.includes('withings')) return 'withings'
  if (b.startsWith('com.apple.health')) {
    if (/watch/.test(n)) return 'watch'
    if (/iphone|phone/.test(n)) return 'phone'
    // Apple's own source with no hint in the name: the watch writes stages,
    // so the session's own content decides later; call it a watch here
    return 'watch'
  }
  if (/watch/.test(n)) return 'watch'
  if (/iphone/.test(n)) return 'phone'
  return 'other'
}

// ---------------------------------------------------------- interval maths

type Interval = [number, number]

/** Total minutes covered by a set of intervals, overlaps counted once. */
export function unionMinutes(intervals: Interval[]): number {
  if (!intervals.length) return 0
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0
  let [curA, curB] = sorted[0] ?? [0, 0]
  for (let i = 1; i < sorted.length; i++) {
    const [a, b] = sorted[i]
    if (a <= curB) {
      curB = Math.max(curB, b)
    } else {
      total += curB - curA
      curA = a
      curB = b
    }
  }
  total += curB - curA
  return total / MIN
}


// stages that say what you were doing beat "asleep" (unspecified), which beats "in bed"
const STAGE_RANK: Record<string, number> = { awake: 3, rem: 3, core: 3, deep: 3, asleep: 2, inBed: 1 }

/**
 * One timeline for the night with every overlap resolved once. Where samples
 * overlap (the same source writing twice, a revised night, duplicates from
 * two reads), each stretch of time goes to one sample: the more specific
 * stage, then the shorter sample (a 4-minute wake inside a long core is the
 * wake), then the later one. Touching stretches of one stage (under a minute
 * apart) become one. "In bed" is left out.
 */
export function buildSegments(samples: RawSleep[]): SleepSegment[] {
  const list = samples.filter((s) => s.stage !== 'inBed' && s.end > s.start && STAGE_RANK[s.stage] != null)
  if (!list.length) return []
  const cuts = [...new Set(list.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b)
  const out: SleepSegment[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i]
    const b = cuts[i + 1]
    let best: RawSleep | null = null
    for (const s of list) {
      if (s.start > a || s.end < b) continue
      if (!best) { best = s; continue }
      const rs = STAGE_RANK[s.stage]
      const rb = STAGE_RANK[best.stage]
      if (rs > rb || (rs === rb && (s.end - s.start < best.end - best.start || (s.end - s.start === best.end - best.start && s.start > best.start)))) best = s
    }
    if (!best) continue
    const stage = best.stage as SleepSegment['stage']
    const prev = out[out.length - 1]
    if (prev && prev.stage === stage && a - prev.end < MIN) prev.end = b
    else out.push({ start: a, end: b, stage })
  }
  return out
}

/** Minutes per stage from the resolved timeline. */
export function stageMinutes(segments: SleepSegment[]): { awake: number; rem: number; core: number; deep: number; asleep: number } {
  const m = { awake: 0, rem: 0, core: 0, deep: 0, asleep: 0 }
  for (const g of segments) m[g.stage as keyof typeof m] += (g.end - g.start) / MIN
  return m
}

/** Heart rate while asleep: the lowest and the mean of samples starting inside the window. */
export function sleepingHeartRate(hr: RawQuantity[], start: number, end: number): SleepingHR | null {
  // a reading of 25 bpm or less is a sensor gap, not a heartbeat
  const v = hr.filter((s) => s.start >= start && s.start <= end && s.value > 25).map((s) => s.value)
  if (!v.length) return null
  return { min: Math.round(Math.min(...v)), avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), n: v.length }
}

/** Describe one run of samples as a session. */
export function summariseSession(samples: RawSleep[], source: SourceClass): SleepSession {
  const iv = (pred: (s: RawSleep) => boolean): Interval[] => samples.filter(pred).map((s) => [s.start, s.end])
  const start = Math.min(...samples.map((s) => s.start))
  const end = Math.max(...samples.map((s) => s.end))
  const segments = buildSegments(samples)
  const m = stageMinutes(segments)
  // the old way, each stage on its own: kept for the "check the numbers" view
  const raw = {
    awake: unionMinutes(iv((s) => s.stage === 'awake')), rem: unionMinutes(iv((s) => s.stage === 'rem')),
    core: unionMinutes(iv((s) => s.stage === 'core')), deep: unionMinutes(iv((s) => s.stage === 'deep')),
    asleep: unionMinutes(iv((s) => s.stage === 'asleep')),
  }
  const r1 = (v: number) => Math.round(v * 10) / 10
  const overlapMin = r1(Object.values(raw).reduce((a, b) => a + b, 0) - Object.values(m).reduce((a, b) => a + b, 0))
  return {
    source,
    sourceName: samples[0]?.sourceName || '',
    start,
    end,
    inBedMin: unionMinutes(iv(() => true)),
    asleepMin: m.rem + m.core + m.deep + m.asleep,
    awakeMin: m.awake,
    deepMin: m.deep,
    coreMin: m.core,
    remMin: m.rem,
    unspecifiedMin: m.asleep,
    hasStages: samples.some((s) => s.stage === 'core' || s.stage === 'deep' || s.stage === 'rem'),
    segments,
    check: { raw: { awake: r1(raw.awake), rem: r1(raw.rem), core: r1(raw.core), deep: r1(raw.deep) }, overlapMin, samples: samples.length },
  }
}

/** Samples from one source, grouped wherever the gap is under an hour. */
export function groupSessions(samples: RawSleep[], source: SourceClass, gapMin = SESSION_GAP_MIN): SleepSession[] {
  const sorted = [...samples].sort((a, b) => a.start - b.start)
  const out: SleepSession[] = []
  let current: RawSleep[] = []
  let currentEnd = -Infinity
  for (const s of sorted) {
    if (current.length && s.start - currentEnd >= gapMin * MIN) {
      out.push(summariseSession(current, source))
      current = []
      currentEnd = -Infinity
    }
    current.push(s)
    currentEnd = Math.max(currentEnd, s.end)
  }
  if (current.length) out.push(summariseSession(current, source))
  return out
}

const sessionLength = (s: SleepSession) => s.end - s.start

/** A source that wrote a qualifying main sleep for a night: its name, kind and the stages it gave. */
export interface NightSource {
  name: string
  cls: SourceClass
  /** stages present in its samples, among awake, rem, core, deep, asleep (unspecified) */
  stages: string[]
}

/** The source key: the name Health gives (each app or device on its own), else its kind. */
const keyOf = (s: RawSleep) => s.sourceName?.trim() || classifySource(s.sourceName, s.sourceId)

/**
 * Nights, keyed by wake-up date.
 *
 * Each source (by the name Health gives it) is grouped on its own and never
 * blended with another. The chosen source (`preferred`, a source name; by
 * default any Apple Watch) gives the night when it has a qualifying main sleep
 * that date. When it has none, the next source with one by kind (`priority`)
 * is used and the night is marked `fallback` ("Other source"): it is shown,
 * but kept out of baselines and the Sleep Lab. Every source that had a main
 * sleep that date is listed in `sources`, for the source picker.
 */
export function buildNights(
  samples: RawSleep[],
  { tz, priority = DEFAULT_SLEEP_PRIORITY, dates, preferred = null }: { tz: Tz; priority?: SourceClass[]; dates?: string[]; preferred?: string | null },
): Record<string, SleepNight> {
  const bySource = new Map<string, RawSleep[]>()
  for (const s of samples) {
    const k = keyOf(s)
    if (!bySource.has(k)) bySource.set(k, [])
    bySource.get(k)!.push(s)
  }
  // per source, per wake date: every session ending that day
  const sessions = new Map<string, Map<string, SleepSession[]>>()
  const clsOf = new Map<string, SourceClass>()
  for (const [k, list] of bySource) {
    const cls = classifySource(list[0].sourceName, list[0].sourceId)
    clsOf.set(k, cls)
    const byDate = new Map<string, SleepSession[]>()
    for (const sess of groupSessions(list, cls)) {
      const d = tz.dateOf(sess.end)
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d)!.push(sess)
    }
    sessions.set(k, byDate)
  }
  const isMain = (s: SleepSession) => {
    const h = tz.hourOf(s.end)
    return h >= MAIN_SLEEP_END_FROM_H && h < MAIN_SLEEP_END_TO_H
  }
  const classOrder = [...priority, ...DEFAULT_SLEEP_PRIORITY.filter((c) => !priority.includes(c))]
  // the chosen source first, then every other source by kind, then by name
  const keys = [...sessions.keys()].sort((a, b) => {
    const pa = a === preferred ? -1 : classOrder.indexOf(clsOf.get(a)!)
    const pb = b === preferred ? -1 : classOrder.indexOf(clsOf.get(b)!)
    return pa - pb || a.localeCompare(b)
  })
  const isChosen = (k: string) => (preferred ? k === preferred : clsOf.get(k) === classOrder[0])
  const allDates = new Set<string>()
  for (const byDate of sessions.values()) for (const d of byDate.keys()) allDates.add(d)
  const wanted = dates ? new Set(dates) : null
  const stagesIn = (sess: SleepSession) => [...new Set((sess.segments || []).map((g) => g.stage))].sort()

  const out: Record<string, SleepNight> = {}
  for (const date of allDates) {
    if (wanted && !wanted.has(date)) continue
    const sources: NightSource[] = []
    let night: SleepNight | null = null
    for (const k of keys) {
      const list = sessions.get(k)?.get(date) || []
      // a source counts once it wrote sleep: in bed alone (an iPhone's bedtime) is not a night
      const mains = list.filter((x) => isMain(x) && x.asleepMin > 0).sort((a, b) => sessionLength(b) - sessionLength(a))
      if (!mains.length) continue
      const main = mains[0]
      sources.push({ name: k, cls: clsOf.get(k)!, stages: stagesIn(main) })
      if (!night) {
        night = { ...main, sourceName: main.sourceName || k, date, naps: list.filter((s) => s !== main).sort((a, b) => a.start - b.start), fallback: !isChosen(k) }
      }
    }
    if (night) out[date] = { ...night, sources }
  }
  return out
}

// ------------------------------------------------------------------- days

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const round = (v: number | null, dp = 1) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp)

function byDate<T extends { start: number }>(rows: T[], tz: Tz, at: (r: T) => number = (r) => r.start): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const d = tz.dateOf(at(r))
    if (!out.has(d)) out.set(d, [])
    out.get(d)!.push(r)
  }
  return out
}

/** Mean of the samples that started inside a window, or null. */
export function meanInWindow(samples: RawQuantity[], start: number, end: number): number | null {
  return mean(samples.filter((s) => s.start >= start && s.start <= end).map((s) => s.value))
}

export interface DailyInputs {
  restingHR?: RawQuantity[]
  hrv?: RawQuantity[]
  respRate?: RawQuantity[]
  wristTemp?: RawQuantity[]
  spo2?: RawQuantity[]
  vo2max?: RawQuantity[]
  weight?: RawQuantity[]
  bodyFat?: RawQuantity[]
  leanMass?: RawQuantity[]
  bloodPressure?: RawBloodPressure[]
  hrRecovery?: RawQuantity[]
  steps?: DayValue[]
  activeEnergy?: DayValue[]
  dietEnergy?: DayValue[]
  dietProtein?: DayValue[]
  dietWater?: DayValue[]
  daylight?: DayValue[]
}

/** One row per date that has anything at all. */
export function buildDaily(
  input: DailyInputs,
  { tz, from, to, nights = {} }: { tz: Tz; from: string; to: string; nights?: Record<string, SleepNight> },
): HealthDaily[] {
  const q = (k: keyof DailyInputs) => byDate((input[k] as RawQuantity[] | undefined) || [], tz)
  const rhr = q('restingHR')
  const hrv = q('hrv')
  const resp = q('respRate')
  const spo2 = q('spo2')
  const vo2 = q('vo2max')
  const weight = q('weight')
  const fat = q('bodyFat')
  const lean = q('leanMass')
  const hrr = q('hrRecovery')
  // the watch writes one wrist temperature per night, timed to the sleep: it
  // belongs to the morning it ends on, like the night itself
  const temp = byDate(input.wristTemp || [], tz, (r) => r.end)
  const bp = byDate(input.bloodPressure || [], tz)
  const sum = (k: keyof DailyInputs) => new Map(((input[k] as DayValue[] | undefined) || []).map((r) => [r.date, r.value]))
  const steps = sum('steps')
  const energy = sum('activeEnergy')
  const dEnergy = sum('dietEnergy')
  const dProtein = sum('dietProtein')
  const dWater = sum('dietWater')
  const daylight = sum('daylight')
  const allHrv = input.hrv || []
  const allResp = input.respRate || []
  const last = (rows?: RawQuantity[]) => (rows?.length ? [...rows].sort((a, b) => a.start - b.start).at(-1)! : null)
  const vals = (rows?: RawQuantity[]) => (rows || []).map((r) => r.value)

  const out: HealthDaily[] = []
  for (const date of dateRange(from, to)) {
    const night = nights[date]
    const lastWeight = last(weight.get(date))
    const row: HealthDaily = {
      ...EMPTY_DAILY,
      date,
      restingHR: round(mean(vals(rhr.get(date)))),
      hrvDayMean: round(mean(vals(hrv.get(date)))),
      hrvOvernight: night ? round(meanInWindow(allHrv, night.start, night.end)) : null,
      respRate: round(night ? (meanInWindow(allResp, night.start, night.end) ?? mean(vals(resp.get(date)))) : mean(vals(resp.get(date)))),
      wristTemp: round(mean(vals(temp.get(date))), 2),
      spo2: round(mean(vals(spo2.get(date)))),
      vo2max: round(last(vo2.get(date))?.value ?? null),
      weight: round(lastWeight?.value ?? null, 2),
      weightSource: lastWeight ? (lastWeight.sourceName || 'Health') : null,
      weighIns: weight.get(date)?.length
        ? [...weight.get(date)!].sort((a, b) => a.start - b.start).map((w) => ({ t: w.start, kg: round(w.value, 2)!, source: w.sourceName || 'Health' }))
        : null,
      bodyFatPct: round(last(fat.get(date))?.value ?? null),
      leanMass: round(last(lean.get(date))?.value ?? null, 2),
      bpSys: round(mean((bp.get(date) || []).map((r) => r.sys)), 0),
      bpDia: round(mean((bp.get(date) || []).map((r) => r.dia)), 0),
      hrRecovery: round(mean(vals(hrr.get(date)))),
      steps: steps.has(date) ? Math.round(steps.get(date)!) : null,
      activeEnergy: energy.has(date) ? Math.round(energy.get(date)!) : null,
      dietEnergy: dEnergy.has(date) ? Math.round(dEnergy.get(date)!) : null,
      dietProtein: dProtein.has(date) ? Math.round(dProtein.get(date)!) : null,
      dietWater: dWater.has(date) ? round(dWater.get(date)!, 2) : null,
      daylightMin: daylight.has(date) ? Math.round(daylight.get(date)!) : null,
    }
    const hasAny = Object.entries(row).some(([k, v]) => k !== 'date' && v != null)
    if (hasAny) out.push(row)
  }
  return out
}

// --------------------------------------------------------------- workouts

const TYPE_LABEL: Record<string, string> = {
  traditionalStrengthTraining: 'Strength training',
  functionalStrengthTraining: 'Functional strength',
  strengthTraining: 'Strength training',
  weightlifting: 'Weightlifting',
  highIntensityIntervalTraining: 'HIIT',
  running: 'Run',
  walking: 'Walk',
  cycling: 'Ride',
  swimming: 'Swim',
  rowing: 'Row',
  hiking: 'Hike',
  yoga: 'Yoga',
  coreTraining: 'Core',
  mixedCardio: 'Mixed cardio',
  elliptical: 'Elliptical',
  stairClimbing: 'Stairs',
  crossTraining: 'Cross training',
  cooldown: 'Cooldown',
}

export function workoutLabel(type: string): string {
  if (TYPE_LABEL[type]) return TYPE_LABEL[type]
  const spaced = type.replace(/([A-Z])/g, ' $1').trim()
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1).toLowerCase() : 'Workout'
}

/** Heart rate inside a workout, kept as [seconds from start, bpm], oldest first. */
export function seriesFor(workout: { start: number; end: number }, hr: RawQuantity[]): Array<[number, number]> {
  return hr
    .filter((s) => s.start >= workout.start && s.start <= workout.end && s.value > 0)
    .sort((a, b) => a.start - b.start)
    .map((s) => [Math.round((s.start - workout.start) / 1000), Math.round(s.value)] as [number, number])
}

/**
 * The one-minute recovery Health recorded after a workout: the sample that
 * begins between two minutes before and ten minutes after the workout ends.
 */
export function recoveryFor(workout: { end: number }, hrr: RawQuantity[]): number | null {
  const near = hrr
    .filter((s) => s.start >= workout.end - 2 * MIN && s.start <= workout.end + 10 * MIN)
    .sort((a, b) => Math.abs(a.start - workout.end) - Math.abs(b.start - workout.end))
  return near.length ? Math.round(near[0].value) : null
}

export function buildWorkout(raw: RawWorkout, { tz, hr = [], hrr = [] }: { tz: Tz; hr?: RawQuantity[]; hrr?: RawQuantity[] }): HealthWorkout {
  const hrSeries = seriesFor(raw, hr)
  const bpms = hrSeries.map((p) => p[1])
  return {
    id: raw.id,
    date: tz.dateOf(raw.start),
    type: raw.type,
    title: raw.title || workoutLabel(raw.type),
    start: raw.start,
    end: raw.end,
    durationMin: Math.round(raw.durationSec / 6) / 10,
    energyKcal: raw.energyKcal != null ? Math.round(raw.energyKcal) : null,
    distanceM: raw.distanceM != null ? Math.round(raw.distanceM) : null,
    avgHR: bpms.length ? Math.round(bpms.reduce((s, x) => s + x, 0) / bpms.length) : null,
    maxHR: bpms.length ? Math.max(...bpms) : null,
    sourceName: raw.sourceName || '',
    sourceId: raw.sourceId || '',
    hrSeries,
    hrRecovery: recoveryFor(raw, hrr),
  }
}
