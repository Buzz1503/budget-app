// Sauna treated like a compound: sauna days against days without, through the
// same compare engine (groupSplit) and the same labels (changeLabel) the
// compound effects use. Descriptive only: "higher / lower on days with".
//
// A session on day D is read against the night of D (filed under the wake-up
// date D + 1) and the morning of D + 1.

import { groupSplit } from '../health/engine/compare'
import type { Split } from '../health/engine/compare'
import { changeLabel } from '../health/engine/phases'
import type { ChangeLabel } from '../health/engine/phases'
import { addDays } from '../health/tz'
import { SAUNA, weekOf } from './sauna'
import type { SaunaSession } from './sauna'

export interface NightLike { start: number; score: number | null; deepMin: number | null; sleepingHR: number | null }
export interface MorningLike { hrv: number | null; rhr: number | null; readiness: number | null }

export interface SaunaEffectInput {
  sessions: SaunaSession[]
  /** Days D to compare, oldest first (usually the last year up to yesterday). */
  days: string[]
  /** The night that ends on a wake-up date. */
  night: (wakeDate: string) => NightLike | null
  /** The morning of a date. */
  morning: (date: string) => MorningLike
  /** Local date and 'HH:MM' to an instant. */
  toMs: (date: string, hhmm: string) => number
  /** Normal night-to-night wobble of each outcome, for the labels. */
  wobble: Partial<Record<OutcomeKey, number>>
}

export type OutcomeKey = 'sleepScore' | 'deepSleep' | 'sleepingHR' | 'hrv' | 'rhr' | 'readiness'

export const OUTCOMES: Array<{ key: OutcomeKey; label: string; unit: string; dp: number; when: 'night' | 'morning'; fallbackWobble: number }> = [
  { key: 'sleepScore', label: 'Sleep score that night', unit: '', dp: 0, when: 'night', fallbackWobble: 8 },
  { key: 'deepSleep', label: 'Deep sleep that night', unit: 'min', dp: 0, when: 'night', fallbackWobble: 15 },
  { key: 'sleepingHR', label: 'Sleeping heart rate that night', unit: 'bpm', dp: 0, when: 'night', fallbackWobble: 2 },
  { key: 'hrv', label: 'Next-morning HRV', unit: 'ms', dp: 0, when: 'morning', fallbackWobble: 6 },
  { key: 'rhr', label: 'Next-morning resting heart rate', unit: 'bpm', dp: 0, when: 'morning', fallbackWobble: 2 },
  { key: 'readiness', label: 'Next-morning readiness', unit: '', dp: 0, when: 'morning', fallbackWobble: 8 },
]

export const SAUNA_CAVEAT = 'Other things you did on these days are not separated out.'

/** The value of an outcome for a session on day D: night D (wake date D + 1) or morning D + 1. */
export function outcomeFor(key: OutcomeKey, input: Pick<SaunaEffectInput, 'night' | 'morning'>): (d: string) => number | null {
  return (d) => {
    const next = addDays(d, 1)
    if (key === 'hrv' || key === 'rhr' || key === 'readiness') return input.morning(next)[key]
    const n = input.night(next)
    if (!n) return null
    return key === 'sleepScore' ? n.score : key === 'deepSleep' ? n.deepMin : n.sleepingHR
  }
}

/** Per day: was there a sauna, its total minutes, and did one end within 3 h of that night's bedtime. */
export function dayFlags(sessions: SaunaSession[], night: SaunaEffectInput['night'], toMs: SaunaEffectInput['toMs']) {
  const byDay = new Map<string, SaunaSession[]>()
  for (const s of sessions) byDay.set(s.date, [...(byDay.get(s.date) || []), s])
  const minutes = (d: string) => (byDay.get(d) || []).reduce((t, s) => t + s.lengthMin, 0)
  const late = (d: string): boolean | null => {
    const list = byDay.get(d)
    if (!list?.length) return false
    const n = night(addDays(d, 1))
    if (!n) return null // no bedtime that night: cannot tell
    const lastEnd = Math.max(...list.map((s) => toMs(s.date, s.start) + s.lengthMin * 60000))
    return lastEnd >= n.start - SAUNA.lateWithinH * 3600000
  }
  return { has: (d: string) => byDay.has(d), minutes, late }
}

export type EffectLabel = ChangeLabel

export interface SaunaRow {
  key: OutcomeKey
  label: string
  unit: string
  split: Split
  diff: number | null
  verdict: EffectLabel
  text: string
}

const words = (o: (typeof OUTCOMES)[number], diff: number, verdict: EffectLabel, groupWords: string, otherWords: string) => (verdict === 'Within normal fluctuation'
  ? `${o.label}: about the same ${groupWords} as ${otherWords}`
  : `${o.label}: ${Math.abs(diff).toFixed(o.dp)}${o.unit ? ` ${o.unit}` : ''} ${diff > 0 ? 'higher' : 'lower'} ${groupWords} than ${otherWords}`)

function row(o: (typeof OUTCOMES)[number], s: Split, wob: number, groupWords: string, otherWords: string): SaunaRow {
  if (s.diff == null) {
    return { key: o.key, label: o.label, unit: o.unit, split: s, diff: null, verdict: 'Too early', text: `${o.label}: too early, needs ${s.needsMore} more day${s.needsMore === 1 ? '' : 's'} in the smaller group` }
  }
  const verdict = changeLabel(s.diff, wob)
  return { key: o.key, label: o.label, unit: o.unit, split: s, diff: s.diff, verdict, text: words(o, s.diff, verdict, groupWords, otherWords) }
}

const wobbleOf = (input: SaunaEffectInput, key: OutcomeKey) => input.wobble[key] ?? OUTCOMES.find((o) => o.key === key)!.fallbackWobble

/** Sauna days against days without, on each outcome. Seven days a group, else "Too early". */
export function saunaVsNone(input: SaunaEffectInput, min = SAUNA.minPerGroup): SaunaRow[] {
  const f = dayFlags(input.sessions, input.night, input.toMs)
  return OUTCOMES.map((o) => row(o, groupSplit(input.days, f.has, outcomeFor(o.key, input), min), wobbleOf(input, o.key), 'on sauna days', 'on days without'))
}

/** Which length bucket a day's sauna minutes fall in. */
export const lengthBucket = (minutes: number): 'short' | 'mid' | 'long' => (minutes < SAUNA.lengthBuckets[0] ? 'short' : minutes <= SAUNA.lengthBuckets[1] ? 'mid' : 'long')
export const BUCKET_WORDS = { short: 'under 20 min', mid: '20 to 30 min', long: 'over 30 min' } as const

/**
 * Dose-response: each length bucket against days without sauna, and late
 * sessions (ending within 3 h of bedtime) against earlier ones, on that
 * night's sleep score and next-morning HRV.
 */
export function saunaSplits(input: SaunaEffectInput, min = SAUNA.minPerGroup) {
  const f = dayFlags(input.sessions, input.night, input.toMs)
  const keys: OutcomeKey[] = ['sleepScore', 'hrv']
  const outs = OUTCOMES.filter((o) => keys.includes(o.key))
  const length = (['short', 'mid', 'long'] as const).map((b) => ({
    bucket: b,
    words: BUCKET_WORDS[b],
    rows: outs.map((o) => row(o, groupSplit(input.days, (d) => (f.has(d) ? (lengthBucket(f.minutes(d)) === b ? true : null) : false), outcomeFor(o.key, input), min),
      wobbleOf(input, o.key), `after sessions ${BUCKET_WORDS[b]}`, 'on days without')),
  }))
  const timing = outs.map((o) => row(o, groupSplit(input.days, (d) => (f.has(d) ? f.late(d) : null), outcomeFor(o.key, input), min),
    wobbleOf(input, o.key), 'after a session ending within 3 h of bedtime', 'after an earlier session'))
  return { length, timing }
}

/** Pearson correlation, or null for fewer than three points or no spread. */
export function correlation(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  let sxy = 0; let sxx = 0; let syy = 0
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null
}

export const WEEKS_MIN = 8 // weeks with data before the weekly line says anything
const WEEK_DAYS_MIN = 4 // a week counts when it has four mornings with the value

/**
 * Longer term: each week's session count against that week's average resting
 * heart rate and HRV. Worded "weeks with more sessions had ..." and nothing
 * stronger; needs 8 weeks.
 */
export function weeklyPattern(input: Pick<SaunaEffectInput, 'sessions' | 'days' | 'morning'>) {
  const weeks = new Map<string, { week: string; count: number; rhr: number[]; hrv: number[] }>()
  for (const d of input.days) {
    const w = weekOf(d).from
    if (!weeks.has(w)) weeks.set(w, { week: w, count: 0, rhr: [], hrv: [] })
    const m = input.morning(d)
    if (m.rhr != null) weeks.get(w)!.rhr.push(m.rhr)
    if (m.hrv != null) weeks.get(w)!.hrv.push(m.hrv)
  }
  for (const s of input.sessions) {
    const w = weeks.get(weekOf(s.date).from)
    if (w) w.count++
  }
  const avg = (xs: number[]) => (xs.length >= WEEK_DAYS_MIN ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const points = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week))
    .map((w) => ({ week: w.week, count: w.count, rhr: avg(w.rhr), hrv: avg(w.hrv) }))
  const line = (key: 'rhr' | 'hrv', name: string) => {
    const pts = points.filter((p) => p[key] != null)
    if (pts.length < WEEKS_MIN) return { n: pts.length, r: null, text: `Needs ${WEEKS_MIN - pts.length} more weeks with data` }
    const r = correlation(pts.map((p) => p.count), pts.map((p) => p[key] as number))
    if (r == null || Math.abs(r) < 0.2) return { n: pts.length, r, text: `Weeks with more sessions had about the same average ${name} (n = ${pts.length} weeks)` }
    return { n: pts.length, r, text: `Weeks with more sessions had a ${r > 0 ? 'higher' : 'lower'} average ${name} (n = ${pts.length} weeks)` }
  }
  return { points, rhr: line('rhr', 'resting heart rate'), hrv: line('hrv', 'HRV') }
}

/** The one line on Recovery: "On mornings after sauna your HRV averages X ms higher (n = A vs B)." Null without 7 mornings a group. */
export function recoveryLine(input: SaunaEffectInput): string | null {
  const f = dayFlags(input.sessions, input.night, input.toMs)
  const s = groupSplit(input.days, f.has, outcomeFor('hrv', input), SAUNA.minPerGroup)
  if (s.diff == null) return null
  const d = Math.round(s.diff)
  return d === 0
    ? `On mornings after sauna your HRV averages about the same (n = ${s.with.n} vs ${s.without.n}).`
    : `On mornings after sauna your HRV averages ${Math.abs(d)} ms ${d > 0 ? 'higher' : 'lower'} (n = ${s.with.n} vs ${s.without.n}).`
}
