// What the Sauna tab says about sessions: the detail of one session against
// your own baselines, heat adaptation, cool-down recovery, consistency, the
// patterns card and the longer term. Pure: every lookup into Health is passed
// in, and "today" always is.
//
// One rule runs through all of it: nothing from before the first session is
// used. A week, a day or a night before you started using a sauna is not a
// "day without sauna"; it is a day before the question existed.

import { addDays, daysBetween, dateRange } from '../health/tz'
import { groupSplit } from '../health/engine/compare'
import { changeLabel } from '../health/engine/phases'
import type { ChangeLabel } from '../health/engine/phases'
import { zoneMinutes } from '../health/engine/training'
import { SAUNA, weekOf, usualFor, minutesOf } from './sauna'
import type { SaunaSession } from './sauna'

export const ANALYTICS = {
  baselineDays: 28, // that night against the 28 nights before; the next morning against the 28 days before
  climbWindowMin: 10, // heart rate climb: bpm per minute over the first 10 minutes
  climbMinSamples: 3,
  bandWidthC: 10,
  adaptationMin: 5, // heat adaptation unlocks at 5 Watch sessions in one band
  coolDownMin: 5, // cool-down recovery trend after 5 sessions with cool-down data
  coolDownMarks: [120, 300], // HR drop at 2 and 5 minutes after leaving
  coolDownTolSec: 20,
  weighInWindowH: 2, // Withings weigh-ins within 2 h before the start and 2 h after the end
  patternsMin: SAUNA.minPerGroup, // 7 days per group
  longerTermWeeks: 8,
  longerTermGroupWeeks: 4, // a sentence needs 4 weeks with sessions and 4 without
  weekDaysMin: 4, // a week's average needs 4 mornings
  consistencyWeeks: 8,
  axisMin: 3,
  // heart rate when the Watch recorded none during the session
  fallbackBeforeMin: 10, // the median of the 10 minutes before the start
  fallbackAfterMin: 10, // the median of the first 10 minutes after the end
  fallbackAtMin: 30, // the reading nearest 30 minutes after the end
  fallbackAtTolMin: 5,
  ratingMin: 5, // rating rows unlock at 5 rated sessions
}

// ------------------------------------------------------------------ helpers

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const r1 = (v: number) => Math.round(v * 10) / 10
const sorted = (sessions: SaunaSession[]) => [...sessions].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))

/** The day of the first session, or null before there is one. */
export function firstSessionDate(sessions: SaunaSession[]): string | null {
  return sessions.length ? sessions.reduce((m, s) => (s.date < m ? s.date : m), sessions[0].date) : null
}

/** Days from the first session onward, so nothing before it is ever compared. */
export function sinceFirstSession(days: string[], sessions: SaunaSession[]): string[] {
  const first = firstSessionDate(sessions)
  return first ? days.filter((d) => d >= first) : []
}

/** "Typical: 30 min at 70 C", the median of the last 10 sessions. Null without any. */
export function typicalLine(sessions: SaunaSession[]): string | null {
  if (!sessions.length) return null
  const u = usualFor(sessions)
  return `Typical: ${u.lengthMin} min at ${u.tempC} C`
}

/** Least-squares slope and intercept of y on x, or null with fewer than 2 points or no spread in x. */
export function fit(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  if (xs.length < 2 || xs.length !== ys.length) return null
  const mx = mean(xs)!
  const my = mean(ys)!
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2 }
  if (sxx === 0) return null
  const slope = sxy / sxx
  return { slope, intercept: my - slope * mx }
}

// ------------------------------------------------------------ heart rate

/** [seconds from the start, bpm] */
export type HRSeries = Array<[number, number]>

/**
 * A session's own heart rate, as seconds from its start: the 5-second series
 * the Watch sent with it. Null when it has none.
 */
export function ownSeries(session: SaunaSession & { hr?: { samples?: number[][] } | null; startedAt?: number }, toMs: (date: string, hhmm: string) => number): HRSeries | null {
  const raw = session.hr?.samples
  if (!raw?.length) return null
  const startSec = (session.startedAt ?? toMs(session.date, session.start)) / 1000
  const out: HRSeries = raw.filter((p) => p.length >= 2 && Number.isFinite(p[1]))
    .map((p) => [Math.round(p[0] - startSec), p[1]] as [number, number])
    .filter(([t]) => t >= -60 && t <= session.lengthMin * 60 + 60)
  return out.length >= 2 ? out : null
}

/** Heart rate climb: bpm per minute over the first 10 minutes, from a least-squares line. */
export function hrClimb(series: HRSeries | null, windowMin = ANALYTICS.climbWindowMin): number | null {
  if (!series) return null
  const pts = series.filter(([t]) => t >= 0 && t <= windowMin * 60)
  if (pts.length < ANALYTICS.climbMinSamples) return null
  // at least three minutes of the window covered, so two close samples are not a slope
  if (pts[pts.length - 1][0] - pts[0][0] < 180) return null
  const f = fit(pts.map(([t]) => t / 60), pts.map(([, b]) => b))
  return f ? r1(f.slope) : null
}

/** Average, peak, minutes in each of the five zones and the climb. */
export function hrSummary(series: HRSeries | null, maxHR: number) {
  if (!series || series.length < 2) return null
  const bpms = series.map(([, b]) => b)
  return {
    avg: Math.round(mean(bpms)!),
    peak: Math.round(Math.max(...bpms)),
    zones: zoneMinutes(series, maxHR),
    climb: hrClimb(series),
  }
}

// -------------------------------------------------------- one session's detail

export interface NightRow {
  start: number
  score: number | null
  deepMin: number | null
  sleepingHR: number | null
  /** the night's wrist temperature (Health, filed on the wake date) */
  wristTemp?: number | null
  /** the Watch's restlessness index, movements per hour */
  restless?: number | null
}
export interface MorningRow {
  hrv: number | null
  rhr: number | null
  readiness: number | null
  /** blood pressure read that day (Withings), if any */
  bpSys?: number | null
  bpDia?: number | null
}
export interface WeighIn { t: number; kg: number; source: string }

/** Lookups into Health for the sauna. Any of them can find nothing. */
export interface SaunaHealth {
  today: string
  /** the night that ends on a wake-up date */
  night: (wake: string) => NightRow | null
  /** the morning of a date */
  morning: (date: string) => MorningRow
  /** weigh-ins between two instants, any source */
  weighIns: (fromMs: number, toMs: number) => WeighIn[]
}

export interface Compared {
  key: string
  label: string
  unit: string
  value: number | null
  base: number | null
  baseN: number
  diff: number | null
  /** "52 min, 8 more than usual" */
  text: string
}

const NIGHT_METRICS = [
  { key: 'sleepScore', label: 'Sleep score', unit: '', more: ['higher', 'lower'], get: (n: NightRow) => n.score },
  { key: 'deepSleep', label: 'Deep sleep', unit: 'min', more: ['more', 'less'], get: (n: NightRow) => n.deepMin },
  { key: 'sleepingHR', label: 'Sleeping heart rate', unit: 'bpm', more: ['higher', 'lower'], get: (n: NightRow) => n.sleepingHR },
  // shown only when recorded: the wrist temperature against usual, and the Watch's restlessness
  { key: 'wristTemp', label: 'Wrist temperature', unit: 'C', dp: 1, optional: true, more: ['higher', 'lower'], get: (n: NightRow) => n.wristTemp ?? null },
  { key: 'restlessness', label: 'Restlessness', unit: 'per hour', dp: 1, optional: true, more: ['higher', 'lower'], get: (n: NightRow) => n.restless ?? null },
] as const
const MORNING_METRICS = [
  { key: 'hrv', label: 'HRV', unit: 'ms', more: ['higher', 'lower'], get: (m: MorningRow) => m.hrv },
  { key: 'rhr', label: 'Resting heart rate', unit: 'bpm', more: ['higher', 'lower'], get: (m: MorningRow) => m.rhr },
  { key: 'readiness', label: 'Readiness', unit: '', more: ['higher', 'lower'], get: (m: MorningRow) => m.readiness },
] as const

/** "52 min, 8 more than usual", "61 ms, about usual", "58 bpm". */
export function comparedWords(value: number | null, base: number | null, unit: string, more: readonly [string, string], dp = 0): string {
  if (value == null) return 'No reading'
  const k = 10 ** dp
  const round = (x: number) => Math.round(x * k) / k
  const v = `${round(value)}${unit ? ` ${unit}` : ''}`
  if (base == null) return v
  const d = round(value - base)
  if (d === 0) return `${v}, about usual`
  return `${v}, ${Math.abs(d)} ${d > 0 ? more[0] : more[1]} than usual`
}

/** The mean of up to `n` values from the days before `date` (not including it). */
export function baselineBefore(date: string, get: (d: string) => number | null, n = ANALYTICS.baselineDays): { mean: number | null; n: number } {
  const vals: number[] = []
  for (let i = 1; i <= n; i++) {
    const v = get(addDays(date, -i))
    if (v != null && Number.isFinite(v)) vals.push(v)
  }
  return { mean: vals.length ? mean(vals) : null, n: vals.length }
}

function compare<T>(m: { key: string; label: string; unit: string; dp?: number; more: readonly [string, string]; get: (x: T) => number | null }, value: number | null, base: { mean: number | null; n: number }): Compared {
  return {
    key: m.key, label: m.label, unit: m.unit, value, base: base.mean, baseN: base.n,
    diff: value != null && base.mean != null ? r1(value - base.mean) : null,
    text: comparedWords(value, base.mean, m.unit, m.more, m.dp ?? 0),
  }
}

/**
 * That night against the 28 nights before it: sleep score, deep sleep,
 * sleeping heart rate, and when recorded the wrist temperature and the
 * Watch's restlessness. "pending" ("Available tomorrow") until the night's
 * data has arrived.
 */
export function thatNight(session: SaunaSession, h: SaunaHealth): { status: 'ok' | 'pending' | 'none'; rows: Compared[] } {
  const wake = addDays(session.date, 1)
  const night = h.night(wake)
  if (!night) return { status: wake >= h.today ? 'pending' : 'none', rows: [] }
  const rows = NIGHT_METRICS.map((m) => compare(m, m.get(night), baselineBefore(wake, (d) => { const n = h.night(d); return n ? m.get(n) : null })))
    .filter((r, i) => !('optional' in NIGHT_METRICS[i]) || r.value != null)
  return { status: 'ok', rows }
}

/** The next morning against the 28 days before it: HRV, resting heart rate and readiness. */
export function nextMorning(session: SaunaSession, h: SaunaHealth): { status: 'ok' | 'pending' | 'none'; rows: Compared[] } {
  const date = addDays(session.date, 1)
  if (date > h.today) return { status: 'pending', rows: [] }
  const m0 = h.morning(date)
  const any = MORNING_METRICS.some((m) => m.get(m0) != null)
  if (!any) return { status: date >= h.today ? 'pending' : 'none', rows: [] }
  const rows = MORNING_METRICS.map((m) => compare(m, m.get(m0), baselineBefore(date, (d) => m.get(h.morning(d)))))
  return { status: 'ok', rows }
}

/**
 * One muted line at the top of the tab, information only: today's readiness
 * and HRV against the 28 days before. Null when Health has neither.
 */
export function todayLine(h: SaunaHealth | null): string | null {
  if (!h) return null
  const m = h.morning(h.today)
  const parts: string[] = []
  if (m.readiness != null) parts.push(`readiness ${Math.round(m.readiness)}`)
  if (m.hrv != null) {
    const base = baselineBefore(h.today, (d) => h.morning(d).hrv)
    const d = base.mean != null ? Math.round(m.hrv - base.mean) : null
    parts.push(`HRV ${Math.round(m.hrv)} ms${d == null ? '' : d === 0 ? ', about usual' : `, ${Math.abs(d)} ${d > 0 ? 'above' : 'below'} usual`}`)
  }
  return parts.length ? `Today: ${parts.join(', ')}` : null
}

export const NO_HR_LINE = 'No heart rate recorded during session'

/**
 * When nothing was recorded during the session, the heart rate around it from
 * Health: the median of the 10 minutes before the start, the median of the
 * first 10 minutes after the end, and the reading nearest 30 minutes after.
 * `samples` are [epoch ms, bpm]. Null when there is nothing either side.
 */
export function hrFallback(samples: Array<[number, number]>, startMs: number, endMs: number) {
  const M = 60000
  const med = (xs: number[]) => {
    if (!xs.length) return null
    const s2 = [...xs].sort((a, b) => a - b)
    const k = Math.floor(s2.length / 2)
    return Math.round(s2.length % 2 ? s2[k] : (s2[k - 1] + s2[k]) / 2)
  }
  const before = med(samples.filter(([t]) => t >= startMs - ANALYTICS.fallbackBeforeMin * M && t < startMs).map(([, b]) => b))
  const after = med(samples.filter(([t]) => t > endMs && t <= endMs + ANALYTICS.fallbackAfterMin * M).map(([, b]) => b))
  const target = endMs + ANALYTICS.fallbackAtMin * M
  const near = samples.filter(([t]) => Math.abs(t - target) <= ANALYTICS.fallbackAtTolMin * M).sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target))[0]
  const at30 = near ? Math.round(near[1]) : null
  if (before == null && after == null && at30 == null) return null
  return { before, after, at30, label: NO_HR_LINE }
}

/** When a session ended, as an instant. */
export function sessionEnd(session: SaunaSession & { endedAt?: number; startedAt?: number }, toMs: (date: string, hhmm: string) => number): number {
  return session.endedAt ?? (session.startedAt ?? toMs(session.date, session.start)) + session.lengthMin * 60000
}

/** Hours between the end of the session and bedtime that night, one decimal. Null without a night. */
export function hoursToBed(session: SaunaSession, night: NightRow | null, toMs: (date: string, hhmm: string) => number): number | null {
  if (!night) return null
  return r1((night.start - sessionEnd(session, toMs)) / 3600000)
}

/**
 * Fluid lost, always an estimate: the before and after weights typed into the
 * session, or else the last weigh-in in the 2 hours before the start and the
 * first in the 2 hours after the end (Withings or any scale in Health).
 */
export function fluidEstimate(session: SaunaSession & { startedAt?: number; endedAt?: number }, weighIns: SaunaHealth['weighIns'] | null, toMs: (date: string, hhmm: string) => number): { litres: number; from: 'manual' | 'scale'; beforeKg: number; afterKg: number } | null {
  const b = Number(session.weightBeforeKg)
  const a = Number(session.weightAfterKg)
  if (b > 0 && a > 0) {
    const litres = r1(b - a)
    return litres > 0 ? { litres, from: 'manual', beforeKg: b, afterKg: a } : null
  }
  if (!weighIns) return null
  const start = session.startedAt ?? toMs(session.date, session.start)
  const end = sessionEnd(session, toMs)
  const w = ANALYTICS.weighInWindowH * 3600000
  const before = weighIns(start - w, start).sort((x, y) => y.t - x.t)[0]
  const after = weighIns(end, end + w).sort((x, y) => x.t - y.t)[0]
  if (!before || !after) return null
  const litres = r1(before.kg - after.kg)
  return litres > 0 ? { litres, from: 'scale', beforeKg: before.kg, afterKg: after.kg } : null
}

// --------------------------------------------------------- heat adaptation

/** The 10 C band a temperature sits in, centred on a multiple of 10: 70 C is 65 to 75 C. */
export function tempBand(tempC: number) {
  const centre = Math.round(tempC / ANALYTICS.bandWidthC) * ANALYTICS.bandWidthC
  const lo = centre - ANALYTICS.bandWidthC / 2
  const hi = centre + ANALYTICS.bandWidthC / 2
  return { centre, lo, hi, label: `${lo} to ${hi} C` }
}

export interface HRSession { id: string; date: string; tempC: number; avgHR: number }

/**
 * Heat adaptation, from Watch-recorded sessions only, in the band used most:
 * average heart rate per session with a trend line, and one sentence. Locked
 * until 5 sessions in that band.
 */
export function heatAdaptation(list: HRSession[], min = ANALYTICS.adaptationMin) {
  const byBand = new Map<number, HRSession[]>()
  for (const s of list) {
    const c = tempBand(s.tempC).centre
    byBand.set(c, [...(byBand.get(c) || []), s])
  }
  // the band used most; a tie goes to the warmer band
  const [centre, inBand] = [...byBand.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0])[0] || [null, []]
  const have = inBand.length
  if (centre == null || have < min) {
    return { locked: true as const, have, text: `Unlocks after ${min} Watch sessions at a similar temperature (you have ${have})` }
  }
  const band = tempBand(centre)
  const pts = [...inBand].sort((a, b) => a.date.localeCompare(b.date))
  const f = fit(pts.map((_, i) => i), pts.map((p) => p.avgHR))
  const change = f ? Math.round(f.slope * (pts.length - 1)) : 0
  const text = change === 0
    ? `At ${band.label} your average heart rate is about the same over ${pts.length} sessions.`
    : `At ${band.label} your average heart rate is ${change < 0 ? 'down' : 'up'} ${Math.abs(change)} bpm over ${pts.length} sessions.`
  return {
    locked: false as const,
    band,
    points: pts.map((p) => ({ date: p.date, value: p.avgHR })),
    trend: f ? { first: r1(f.intercept), last: r1(f.intercept + f.slope * (pts.length - 1)) } : null,
    change,
    text,
  }
}

// ------------------------------------------------------- cool-down recovery

export interface CoolDown { exitAt: number; samples: number[][] }

/** Heart rate at an instant (epoch seconds): the sample nearest to it, if one is within 20 s. */
function hrAt(samples: number[][], t: number): number | null {
  let best: number[] | null = null
  for (const p of samples) if (Math.abs(p[0] - t) <= ANALYTICS.coolDownTolSec && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p
  return best ? best[1] : null
}

/** How far heart rate fell 2 and 5 minutes after leaving the sauna, in bpm. Null without the readings. */
export function coolDownDrop(cd: CoolDown | null | undefined): { exitHR: number; drop2: number | null; drop5: number | null } | null {
  if (!cd?.samples?.length || !cd.exitAt) return null
  const exit = cd.exitAt / 1000
  const exitHR = hrAt(cd.samples, exit)
  if (exitHR == null) return null
  const at = (sec: number) => { const v = hrAt(cd.samples, exit + sec); return v == null ? null : Math.round(exitHR - v) }
  return { exitHR: Math.round(exitHR), drop2: at(ANALYTICS.coolDownMarks[0]), drop5: at(ANALYTICS.coolDownMarks[1]) }
}

/** The 2-minute drop over sessions with cool-down data; the trend appears after 5. */
export function coolDownTrend(list: Array<{ date: string; drop2: number | null }>, min = ANALYTICS.coolDownMin) {
  const pts = list.filter((x) => x.drop2 != null).sort((a, b) => a.date.localeCompare(b.date)) as Array<{ date: string; drop2: number }>
  if (pts.length < min) return { locked: true as const, have: pts.length, text: `The trend needs ${min} sessions with a cool-down. You have ${pts.length}.` }
  const f = fit(pts.map((_, i) => i), pts.map((p) => p.drop2))
  const change = f ? Math.round(f.slope * (pts.length - 1)) : 0
  return {
    locked: false as const,
    points: pts.map((p) => ({ date: p.date, value: p.drop2 })),
    change,
    text: change === 0
      ? `Your 2 minute drop is about the same over ${pts.length} sessions.`
      : `Your 2 minute drop is ${change > 0 ? 'up' : 'down'} ${Math.abs(change)} bpm over ${pts.length} sessions.`,
  }
}

// ------------------------------------------------------------- consistency

/**
 * Weeks that hit the target among the last 8, counting only weeks from the
 * first session on. The week in progress counts once it has hit the target,
 * and is not held against you before then.
 */
export function targetWeeks(sessions: SaunaSession[], today: string, target: number, weeks = ANALYTICS.consistencyWeeks) {
  const first = firstSessionDate(sessions)
  if (!first) return { hit: 0, of: 0, text: null as string | null }
  const firstWeek = weekOf(first).from
  const thisWeek = weekOf(today).from
  let hit = 0
  let of = 0
  for (let i = weeks - 1; i >= 0; i--) {
    const w = addDays(thisWeek, -7 * i)
    if (w < firstWeek) continue
    const n = sessions.filter((s) => s.date >= w && s.date <= addDays(w, 6)).length
    const done = n >= target
    if (w === thisWeek && !done) continue
    of++
    if (done) hit++
  }
  return { hit, of, text: of ? `Target hit ${hit} of ${of} ${of === 1 ? 'week' : 'weeks'}` : null }
}

// ---------------------------------------------------------------- patterns

export interface PatternInput {
  sessions: SaunaSession[]
  /** days to compare, oldest first; trimmed here to the first session onward */
  days: string[]
  night: (wake: string) => NightRow | null
  morning: (date: string) => MorningRow
  toMs: (date: string, hhmm: string) => number
  wobble: Partial<Record<string, number>>
}

const PATTERN_METRICS = [
  { key: 'sleepScore', label: 'Sleep score', unit: '', dp: 0, when: 'night', fallback: 8 },
  { key: 'deepSleep', label: 'Deep sleep', unit: 'min', dp: 0, when: 'night', fallback: 15 },
  { key: 'sleepingHR', label: 'Sleeping heart rate', unit: 'bpm', dp: 0, when: 'night', fallback: 2 },
  { key: 'hrv', label: 'Next-morning HRV', unit: 'ms', dp: 0, when: 'morning', fallback: 6 },
  { key: 'rhr', label: 'Next-morning resting heart rate', unit: 'bpm', dp: 0, when: 'morning', fallback: 2 },
  { key: 'restlessness', label: 'Restlessness', unit: 'per hour', dp: 1, when: 'night', fallback: 1 },
] as const

const outcome = (key: string, input: PatternInput) => (d: string): number | null => {
  const next = addDays(d, 1)
  if (key === 'hrv' || key === 'rhr') return input.morning(next)[key]
  const n = input.night(next)
  if (!n) return null
  if (key === 'restlessness') return n.restless ?? null
  return key === 'sleepScore' ? n.score : key === 'deepSleep' ? n.deepMin : n.sleepingHR
}

export interface PatternRow { key: string; name: string; unit: string; dp: number; text: string; nWith: number; nWithout: number; label: ChangeLabel; diff: number }

function patternRows(input: PatternInput, days: string[], inGroup: (d: string) => boolean | null, words: [string, string], min: number) {
  const rows: PatternRow[] = []
  let smallest = Infinity
  let nWith = 0
  let nWithout = 0
  for (const m of PATTERN_METRICS) {
    const s = groupSplit(days, inGroup, outcome(m.key, input), min)
    nWith = Math.max(nWith, s.with.n)
    nWithout = Math.max(nWithout, s.without.n)
    smallest = Math.min(smallest, Math.min(s.with.n, s.without.n))
    if (s.diff == null) continue
    const label = changeLabel(s.diff, input.wobble[m.key] ?? m.fallback)
    const k = 10 ** m.dp
    const d = Math.round(s.diff * k) / k
    const text = label === 'Within normal fluctuation' || d === 0
      ? `${m.label} was about the same ${words[0]} as ${words[1]}.`
      : `${m.label} was ${Math.abs(d)}${m.unit ? ` ${m.unit}` : ''} ${d > 0 ? 'higher' : 'lower'} ${words[0]} than ${words[1]}.`
    rows.push({ key: m.key, name: m.label, unit: m.unit, dp: m.dp, text, nWith: s.with.n, nWithout: s.without.n, label, diff: s.diff })
  }
  return { rows, nWith, nWithout }
}

/**
 * The patterns card: sauna nights against nights without, and late sessions
 * (ending within 3 h of bedtime) against earlier ones. A row only shows once
 * both of its groups have 7 days; while nothing has, one progress line.
 */
export function patterns(input: PatternInput, min = ANALYTICS.patternsMin) {
  const days = sinceFirstSession(input.days, input.sessions)
  const byDay = new Map<string, SaunaSession[]>()
  for (const s of input.sessions) byDay.set(s.date, [...(byDay.get(s.date) || []), s])
  const saunaDays = days.filter((d) => byDay.has(d)).length
  const has = (d: string) => byDay.has(d)
  const late = (d: string): boolean | null => {
    const list = byDay.get(d)
    if (!list?.length) return null
    const n = input.night(addDays(d, 1))
    if (!n) return null
    const lastEnd = Math.max(...list.map((s) => sessionEnd(s, input.toMs)))
    return lastEnd >= n.start - SAUNA.lateWithinH * 3600000
  }
  const nights = patternRows(input, days, has, ['on sauna nights', 'on nights without'], min)
  const timing = patternRows(input, days, late, ['after late sessions', 'after earlier ones'], min)
  const unlocked = nights.rows.length + timing.rows.length > 0
  const withoutDays = days.length - saunaDays
  const progress = unlocked ? null
    : saunaDays < min ? `Needs ${min} sauna days to compare. You have ${saunaDays}.`
      : `Needs ${min} days without sauna to compare. You have ${withoutDays}.`
  return { nights: nights.rows, timing: timing.rows, saunaDays, progress }
}

// -------------------------------------------------------------- longer term

/** A week axis maximum from the data, never under 3 and never under the target. */
export const weeklyAxisMax = (counts: number[], target = 0) => Math.max(ANALYTICS.axisMin, target, ...counts)

/**
 * Week by week from the week of the first session, never before: sessions,
 * and the week's average resting heart rate and HRV. Unlocks after 8 weeks; a
 * sentence only once there are 4 weeks with sessions and 4 without.
 */
export function longerTerm(input: Pick<PatternInput, 'sessions' | 'morning'>, today: string, target = 0) {
  const first = firstSessionDate(input.sessions)
  if (!first) return { locked: true as const, weeks: 0, text: `Needs ${ANALYTICS.longerTermWeeks} weeks of sauna. You have 0.` }
  const from = weekOf(first).from
  const to = weekOf(today).from
  const weekStarts: string[] = []
  for (let w = from; w <= to; w = addDays(w, 7)) weekStarts.push(w)
  if (weekStarts.length < ANALYTICS.longerTermWeeks) {
    return { locked: true as const, weeks: weekStarts.length, text: `Needs ${ANALYTICS.longerTermWeeks} weeks of sauna. You have ${weekStarts.length}.` }
  }
  const avg = (xs: number[]) => (xs.length >= ANALYTICS.weekDaysMin ? r1(mean(xs)!) : null)
  const weeks = weekStarts.map((w) => {
    const days = dateRange(w, addDays(w, 6)).filter((d) => d >= first && d <= today)
    const rhr: number[] = []
    const hrv: number[] = []
    const sys: number[] = []
    const dia: number[] = []
    for (const d of days) {
      const m = input.morning(d)
      if (m.rhr != null) rhr.push(m.rhr)
      if (m.hrv != null) hrv.push(m.hrv)
      if (m.bpSys != null && m.bpDia != null) { sys.push(m.bpSys); dia.push(m.bpDia) }
    }
    // blood pressure is read now and then: any reading that week counts
    const bp = (xs: number[]) => (xs.length ? Math.round(mean(xs)!) : null)
    return { week: w, count: input.sessions.filter((s) => s.date >= w && s.date <= addDays(w, 6)).length, rhr: avg(rhr), hrv: avg(hrv), sys: bp(sys), dia: bp(dia) }
  })
  const lines: string[] = []
  for (const [key, name, unit] of [['rhr', 'Resting heart rate', 'bpm'], ['hrv', 'HRV', 'ms']] as const) {
    const withS = weeks.filter((w) => w.count > 0 && w[key] != null).map((w) => w[key] as number)
    const without = weeks.filter((w) => w.count === 0 && w[key] != null).map((w) => w[key] as number)
    if (withS.length < ANALYTICS.longerTermGroupWeeks || without.length < ANALYTICS.longerTermGroupWeeks) continue
    lines.push(`${name} averaged ${Math.round(mean(withS)!)} ${unit} in weeks with sauna and ${Math.round(mean(without)!)} ${unit} in weeks without (${withS.length} and ${without.length} weeks).`)
  }
  const hasBP = weeks.some((w) => w.sys != null)
  return { locked: false as const, weeks, axisMax: weeklyAxisMax(weeks.map((w) => w.count), target), lines, hasBP }
}

/** When a session's own timing sits relative to a day, for tests and the session list. */
export const startMinutes = (s: SaunaSession) => minutesOf(s.start)
export { sorted as sessionsOldestFirst, daysBetween }

// ----------------------------------------------------------- session rating

export interface SaunaRating {
  /** how it felt, 1 to 5 */
  feel: number | null
  lightheaded: boolean
  headache: boolean
  cramps: boolean
}

const LENGTH_BANDS: Array<[number, number, string]> = [[0, 15, 'Under 15 min'], [15, 25, '15 to 24 min'], [25, 35, '25 to 34 min'], [35, Infinity, '35 min or more']]
const FLUID_BANDS: Array<[number, number, string]> = [[0, 0.5, 'Under 0.5 L lost'], [0.5, 1, '0.5 to 0.9 L lost'], [1, Infinity, '1 L or more lost']]

export interface RatingRow { group: 'length' | 'temp' | 'fluid'; band: string; n: number; feel: number | null; lightheaded: number; text: string }

/**
 * How it felt and how often you were lightheaded, by length, temperature and
 * fluid-loss band. Unlocks at 5 rated sessions; until then one progress line.
 */
export function ratingRows(sessions: Array<SaunaSession & { rating?: SaunaRating | null }>, fluidOf: (s: SaunaSession) => number | null, min = ANALYTICS.ratingMin) {
  const rated = sessions.filter((s) => s.rating && (s.rating.feel != null || s.rating.lightheaded || s.rating.headache || s.rating.cramps))
  if (rated.length < min) return { rows: [] as RatingRow[], rated: rated.length, progress: `Needs ${min} rated sessions. You have ${rated.length}.` }
  const rows: RatingRow[] = []
  const add = (group: RatingRow['group'], band: string, list: typeof rated) => {
    if (!list.length) return
    const feels = list.map((s) => s.rating!.feel).filter((x): x is number => x != null)
    const feel = feels.length ? r1(mean(feels)!) : null
    const light = list.filter((s) => s.rating!.lightheaded).length
    const text = `${band}: ${feel != null ? `felt ${feel} of 5 on average, ` : ''}lightheaded ${light} of ${list.length} time${list.length === 1 ? '' : 's'}.`
    rows.push({ group, band, n: list.length, feel, lightheaded: light, text })
  }
  for (const [a, b, label] of LENGTH_BANDS) add('length', label, rated.filter((s) => s.lengthMin >= a && s.lengthMin < b))
  const temps = [...new Set(rated.map((s) => tempBand(s.tempC).centre))].sort((a, b) => a - b)
  for (const t of temps) {
    const list = rated.filter((s) => tempBand(s.tempC).centre === t)
    add('temp', tempBand(list[0].tempC).label, list)
  }
  for (const [a, b, label] of FLUID_BANDS) {
    add('fluid', label, rated.filter((s) => { const f = fluidOf(s); return f != null && f >= a && f < b }))
  }
  return { rows, rated: rated.length, progress: null }
}

/** Sessions whose water still has to be written to Apple Health (once each). */
export function waterToWrite(sessions: Array<SaunaSession & { waterMl?: number | null; waterWritten?: boolean }>) {
  return sessions.filter((s) => (s.waterMl ?? 0) > 0 && !s.waterWritten)
    .map((s) => ({ id: s.id, ml: Math.round(s.waterMl!), at: s.endedAt ?? s.startedAt ?? null, date: s.date, start: s.start, lengthMin: s.lengthMin }))
}
