// Everything the Health screens compute, wired together once.
//
// buildModel takes the cached Health data, the user's settings and the
// protocol (compounds, dose timeline, logs, measurements, bloods, journal) and
// returns lookups and memoised calculations. Pure: no store, no clock — `today`
// and the time zone are passed in.

import type { HealthDaily, SleepNight, HealthWorkout, HealthCharacteristics, SourceClass } from '../types'
import type { Tz } from '../tz'
import { addDays } from '../tz'
import { SLEEP } from './config'
import { isNum, mean, round } from './stats'
import type { ProtocolEvent } from './baseline'
import { baselineFor } from './baseline'
import type { Readiness, ReadinessSeries } from './readiness'
import { readinessFor } from './readiness'
import type { SleepPerformance } from './sleep'
import { sleepPerformance, nightsEnding, sleepDebtH } from './sleep'
import type { Session, LoadVsUsual } from './training'
import { sessionsWithLoad, dailyLoad, loadVsUsual, ageOn, defaultMaxHR } from './training'
import type { BodyReading, BodyDay } from './bodyComp'
import { pickDaily } from './bodyComp'
import type { CompoundLike, TimelinePoint } from './protocol'
import { relevantEvents } from './protocol'
import type { Lookup } from './compare'

export interface HealthSettingsLike {
  sleepNeedH?: number
  maxHR?: number | null
  wakeTarget?: string | null
  sleepPriority?: SourceClass[]
}

export interface ProtocolInput {
  compounds: Array<CompoundLike & { points: TimelinePoint[]; runs: Array<{ startedOn: string; endedOn?: string | null }> }>
  doseLogs: Array<{ peptideId: string; date: string }>
  measurements: Array<{ date: string; source?: string; weight?: number | null; bodyFat?: number | null }>
  checkins: Record<string, Record<string, number>>
  habitLogs: Record<string, Record<string, boolean>>
  habits: Array<{ id: string; name: string }>
}

export interface Outcome {
  key: string
  label: string
  unit: string
  /** "night" = the night after the day, "morning" = the next morning, "day" = the same day */
  when: 'night' | 'morning' | 'day'
  fn: Lookup
  dp: number
}

export interface HealthModel {
  today: string
  tz: Tz
  daily: HealthDaily[]
  dailyBy: Map<string, HealthDaily>
  nightBy: Map<string, SleepNight>
  series: ReadinessSeries
  events: ProtocolEvent[]
  needH: number
  maxHR: number
  maxHRFromSetting: boolean
  age: number | null
  characteristics: HealthCharacteristics
  sessions: Session[]
  load: Map<string, number>
  firstDate: string | null
  readiness: (date: string) => Readiness
  sleepScore: (date: string) => SleepPerformance | null
  loadVsUsual: (date: string) => LoadVsUsual
  debtH: (date: string) => number
  body: BodyDay[]
  bodyBy: Map<string, BodyDay>
  outcomes: Outcome[]
  hasData: boolean
}

function mapOf<T>(rows: T[], key: (r: T) => string): Map<string, T> {
  return new Map(rows.map((r) => [key(r), r]))
}

function seriesFrom(rows: HealthDaily[], pick: (r: HealthDaily) => number | null): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    const v = pick(r)
    if (isNum(v)) out.set(r.date, v)
  }
  return out
}

export function buildModel({
  daily, nights, workouts, characteristics = {}, settings = {}, protocol, today, tz,
}: {
  daily: HealthDaily[]
  nights: SleepNight[]
  workouts: HealthWorkout[]
  characteristics?: HealthCharacteristics
  settings?: HealthSettingsLike
  protocol: ProtocolInput
  today: string
  tz: Tz
}): HealthModel {
  const dailyBy = mapOf(daily, (r) => r.date)
  const nightBy = mapOf(nights, (n) => n.date)
  const sleepH = new Map<string, number>()
  for (const n of nights) sleepH.set(n.date, n.asleepMin / 60)

  const series: ReadinessSeries = {
    hrv: seriesFrom(daily, (r) => r.hrvOvernight ?? r.hrvDayMean),
    rhr: seriesFrom(daily, (r) => r.restingHR),
    sleep: sleepH,
    resp: seriesFrom(daily, (r) => r.respRate),
    temp: seriesFrom(daily, (r) => r.wristTemp),
  }
  const events = relevantEvents(protocol.compounds)
  const needH = settings.sleepNeedH || SLEEP.defaultNeedH
  const age = ageOn(characteristics.dateOfBirth, today)
  const maxHRFromSetting = isNum(settings.maxHR) && (settings.maxHR as number) > 100
  const maxHR = maxHRFromSetting ? (settings.maxHR as number) : defaultMaxHR(age)
  const sessions = sessionsWithLoad(workouts, maxHR)
  const load = dailyLoad(sessions)
  const allDates = [...daily.map((r) => r.date), ...nights.map((n) => n.date), ...workouts.map((w) => w.date)].sort()
  const firstDate = allDates[0] || null

  const readinessCache = new Map<string, Readiness>()
  const readiness = (date: string) => {
    if (!readinessCache.has(date)) readinessCache.set(date, readinessFor(date, series, { events }))
    return readinessCache.get(date) as Readiness
  }
  const sleepCache = new Map<string, SleepPerformance | null>()
  const sleepScore = (date: string) => {
    if (!sleepCache.has(date)) {
      const n = nightBy.get(date)
      sleepCache.set(date, n ? sleepPerformance(n, { recent: nightsEnding(nightBy, date), needH, tz }) : null)
    }
    return sleepCache.get(date) as SleepPerformance | null
  }

  const readings: BodyReading[] = [
    ...protocol.measurements
      .filter((m) => isNum(m.weight) || isNum(m.bodyFat))
      .map((m) => ({
        date: m.date,
        source: (m.source === 'scan' ? 'scan' : 'manual') as BodyReading['source'],
        weight: m.weight ?? null,
        bodyFatPct: m.bodyFat ?? null,
      })),
    ...daily
      .filter((r) => isNum(r.weight) || isNum(r.bodyFatPct) || isNum(r.leanMass))
      .map((r) => ({
        date: r.date, source: 'health' as const, sourceLabel: r.weightSource,
        weight: r.weight, bodyFatPct: r.bodyFatPct, leanMass: r.leanMass,
      })),
  ]
  const body = pickDaily(readings)
  const bodyBy = mapOf(body, (b) => b.date)

  const sessionsOn = (d: string) => sessions.filter((s) => s.date === d)
  const next = (d: string) => addDays(d, 1)
  const outcomes: Outcome[] = [
    { key: 'sleepTotal', label: 'That night’s total sleep', unit: 'h', when: 'night', dp: 2, fn: (d) => { const n = nightBy.get(next(d)); return n ? n.asleepMin / 60 : null } },
    { key: 'deepRem', label: 'That night’s deep + REM', unit: 'min', when: 'night', dp: 0, fn: (d) => { const n = nightBy.get(next(d)); return n && n.hasStages ? n.deepMin + n.remMin : null } },
    { key: 'awake', label: 'That night’s time awake', unit: 'min', when: 'night', dp: 0, fn: (d) => { const n = nightBy.get(next(d)); return n ? n.awakeMin : null } },
    { key: 'sleepScore', label: 'That night’s sleep score', unit: '', when: 'night', dp: 0, fn: (d) => sleepScore(next(d))?.score ?? null },
    { key: 'hrv', label: 'Next-morning HRV', unit: 'ms', when: 'morning', dp: 0, fn: (d) => series.hrv.get(next(d)) ?? null },
    { key: 'rhr', label: 'Next-morning resting HR', unit: 'bpm', when: 'morning', dp: 1, fn: (d) => series.rhr.get(next(d)) ?? null },
    { key: 'readiness', label: 'Next-morning readiness', unit: '', when: 'morning', dp: 0, fn: (d) => readiness(next(d)).score },
    { key: 'workoutAvgHR', label: 'Same-day workout average HR', unit: 'bpm', when: 'day', dp: 0, fn: (d) => mean(sessionsOn(d).map((s) => s.avgHR).filter(isNum)) },
    {
      key: 'trimpPerMin', label: 'Same-day TRIMP per minute', unit: '', when: 'day', dp: 2, fn: (d) => {
        const ss = sessionsOn(d)
        const mins = ss.reduce((s, x) => s + x.durationMin, 0)
        return mins > 0 ? ss.reduce((s, x) => s + x.trimp, 0) / mins : null
      },
    },
    ...['energy', 'mood', 'appetite', 'drive'].map((k) => ({
      key: `checkin:${k}`, label: `Check-in: ${k[0].toUpperCase()}${k.slice(1)}`, unit: '/5', when: 'day' as const, dp: 2,
      fn: (d: string) => protocol.checkins[d]?.[k] ?? null,
    })),
  ]

  return {
    today, tz, daily, dailyBy, nightBy, series, events, needH, maxHR, maxHRFromSetting, age, characteristics,
    sessions, load, firstDate,
    readiness,
    sleepScore,
    loadVsUsual: (date) => loadVsUsual(load, date, { firstDate: firstDate || undefined }),
    debtH: (date) => round(sleepDebtH(nightBy, date, needH), 2) as number,
    body,
    bodyBy,
    outcomes,
    hasData: daily.length > 0 || nights.length > 0 || workouts.length > 0,
  }
}

/** Value, baseline and delta for one Recovery row. */
export function rowFor(model: HealthModel, key: 'hrv' | 'rhr' | 'sleep' | 'resp', date: string) {
  const s = model.series[key]
  const value = s.get(date) ?? null
  const transform = key === 'hrv' ? Math.log : (v: number) => v
  const b = baselineFor(s, date, key === 'sleep' ? 'sleep' : key, { events: model.events, transform })
  const baseline = b.ready && b.median != null ? (key === 'hrv' ? Math.exp(b.median) : b.median) : null
  return {
    value,
    baseline: baseline == null ? null : round(baseline, key === 'hrv' ? 0 : 1),
    delta: value != null && baseline != null ? round(value - baseline, key === 'hrv' ? 0 : 1) : null,
    ready: b.ready,
  }
}
