// What the Sleep tab shows, worked out from cached nights. Pure: nights,
// workouts, settings and the time zone are passed in.
//
// Wording follows the rest of the app: "higher / lower on days with", "lower
// than usual", never a cause. Stage shares are against a typical adult range,
// which is context and not a target.

import { SLEEP, SLEEP_VIEW, PHASES } from './config'
import { mean, median, round, isNum } from './stats'
import { clockFromNoon } from './sleep'
import type { SleepPerformance } from './sleep'
import { groupSplit } from './compare'
import type { Lookup } from './compare'
import { changeLabel } from './phases'
import { hhmm, parseHhmm } from './planner'
import type { SleepNight, SleepSegment } from '../types'
import type { Tz } from '../tz'
import { addDays } from '../tz'

const MIN = 60000

/** "1 h 10 m", "45 m". */
export function durationWords(min: number): string {
  const m = Math.round(Math.abs(min))
  const h = Math.floor(m / 60)
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} m` : `${m} m`
}

// ------------------------------------------------------------- score band

export type ScoreBand = 'low' | 'moderate' | 'high'

export function scoreBand(score: number | null | undefined): ScoreBand | null {
  if (!isNum(score)) return null
  return (SLEEP_VIEW.bands.find((b) => score <= b.max)?.id ?? 'high') as ScoreBand
}

// -------------------------------------------------------------- hypnogram

export type HypnoRow = 'awake' | 'rem' | 'core' | 'deep' | 'asleep'

/** Rows top to bottom: Awake, REM, Core, Deep; or Awake, Asleep when the source gives no stages. */
export function hypnogramRows(night: Pick<SleepNight, 'hasStages' | 'segments'>): { rows: HypnoRow[]; steps: Array<SleepSegment & { row: HypnoRow }> } {
  const rows: HypnoRow[] = night.hasStages ? ['awake', 'rem', 'core', 'deep'] : ['awake', 'asleep']
  // an unstaged stretch inside a staged night is drawn as core, the most common stage
  const rowOf = (s: SleepSegment['stage']): HypnoRow => (s === 'asleep' ? (night.hasStages ? 'core' : 'asleep') : night.hasStages ? s : s === 'awake' ? 'awake' : 'asleep')
  return { rows, steps: (night.segments || []).map((s) => ({ ...s, row: rowOf(s.stage) })) }
}

// ------------------------------------------------------- score breakdown

export interface BreakdownPart {
  key: 'duration' | 'consistency' | 'restorative' | 'efficiency'
  label: string
  value: number | null
  text: string
}

/** The four parts of the score, each out of 100, with one plain line. */
export function scoreBreakdown(night: SleepNight, perf: SleepPerformance, needH: number): BreakdownPart[] {
  const pct = (v: number | null) => (v == null ? null : Math.round(v * 100))
  const share = night.asleepMin > 0 ? Math.round(((night.deepMin + night.remMin) / night.asleepMin) * 100) : 0
  const eff = night.inBedMin > 0 ? Math.round((night.asleepMin / night.inBedMin) * 100) : 0
  return [
    { key: 'duration', label: 'Duration', value: pct(perf.parts.duration), text: `${durationWords(night.asleepMin)} of your ${needH} h.` },
    {
      key: 'consistency', label: 'Consistency', value: pct(perf.parts.consistency),
      text: perf.consistencySdMin == null
        ? `Needs ${SLEEP.consistencyMinNights} nights in the last ${SLEEP.consistencyNights}.`
        : `Bed and wake times varied by about ${durationWords(perf.consistencySdMin)} over the last ${SLEEP.consistencyNights} nights.`,
    },
    {
      key: 'restorative', label: 'Restorative', value: pct(perf.parts.restorative),
      text: night.hasStages ? `Deep and REM were ${share}% of sleep, against an aim of ${Math.round(SLEEP.restorativeTarget * 100)}%.` : 'No stages from this source, so this part is left out.',
    },
    { key: 'efficiency', label: 'Efficiency', value: pct(perf.parts.efficiency), text: `Asleep for ${eff}% of your time in bed.` },
  ]
}

// ------------------------------------------------------------------ stages

export interface StageStat {
  key: 'deep' | 'core' | 'rem' | 'awake'
  label: string
  min: number
  /** Share of time asleep (awake: share of time in bed). */
  pct: number
  /** The same share over the last 30 nights with stages. */
  avgPct: number | null
  typical: [number, number] | null
}

const stageMin = (n: SleepNight, k: StageStat['key']) => (k === 'deep' ? n.deepMin : k === 'core' ? n.coreMin : k === 'rem' ? n.remMin : n.awakeMin)
const stageShare = (n: SleepNight, k: StageStat['key']) => {
  const base = k === 'awake' ? n.inBedMin : n.asleepMin
  return base > 0 ? (stageMin(n, k) / base) * 100 : 0
}

export function stageStats(night: SleepNight, recent: SleepNight[]): StageStat[] {
  const staged = recent.filter((n) => n.hasStages && n.asleepMin > 0).slice(-SLEEP_VIEW.averageNights)
  const labels = { deep: 'Deep', core: 'Core', rem: 'REM', awake: 'Awake' } as const
  return (['deep', 'core', 'rem', 'awake'] as const).map((key) => ({
    key,
    label: labels[key],
    min: Math.round(stageMin(night, key)),
    pct: Math.round(stageShare(night, key)),
    avgPct: staged.length ? Math.round(mean(staged.map((n) => stageShare(n, key))) as number) : null,
    typical: SLEEP_VIEW.typical[key] || null,
  }))
}

// -------------------------------------------------------- overnight vitals

export interface VitalSpec {
  key: string
  label: string
  unit: string
  dp: number
}

export interface VitalRow extends VitalSpec {
  value: number | null
  usual: number | null
  delta: number | null
  direction: 'up' | 'down' | 'same' | null
  words: string
}

/**
 * Tonight's value against the median of the 28 nights before it. Fewer than
 * 7 of those nights and there is no usual yet.
 */
export function vitalVsUsual(spec: VitalSpec, values: Map<string, number>, date: string): VitalRow {
  const value = values.get(date) ?? null
  const prior: number[] = []
  for (let i = 1; i <= SLEEP_VIEW.usualNights; i++) {
    const v = values.get(addDays(date, -i))
    if (isNum(v)) prior.push(v)
  }
  const usual = prior.length >= SLEEP_VIEW.usualMinNights ? median(prior) : null
  const base = { ...spec, value: value == null ? null : round(value, spec.dp), usual: usual == null ? null : round(usual, spec.dp) }
  if (value == null) return { ...base, delta: null, direction: null, words: 'Not recorded this night.' }
  if (usual == null) return { ...base, delta: null, direction: null, words: `Needs ${SLEEP_VIEW.usualMinNights - prior.length} more nights for a usual.` }
  const delta = round(value - usual, spec.dp) as number
  // judged before rounding, so half a beat is never shown as "1 bpm higher"
  const same = Math.abs(value - usual) < (SLEEP_VIEW.sameWithin[spec.key] ?? 0) || delta === 0
  if (same) return { ...base, delta, direction: 'same', words: 'About the same as usual.' }
  const amount = `${Math.abs(delta).toFixed(spec.dp)}${spec.unit ? ` ${spec.unit}` : ''}`
  return { ...base, delta, direction: delta > 0 ? 'up' : 'down', words: `${amount} ${delta > 0 ? 'higher' : 'lower'} than usual.` }
}

// ------------------------------------------------------------------ timing

/** Midpoint of the night, in minutes after noon (so 03:00 is 900). */
export function midpointFromNoon(night: Pick<SleepNight, 'start' | 'end'>, tz: Tz): number {
  return (clockFromNoon(night.start, tz) + (night.end - night.start) / MIN / 2) % 1440
}

/** Weekend nights are Friday and Saturday: the ones you wake from on Saturday or Sunday. */
export const isWeekendNight = (wakeDate: string) => (SLEEP_VIEW.weekendWakeDays as readonly number[]).includes(new Date(`${wakeDate}T00:00:00Z`).getUTCDay())

export interface MidpointSplit {
  weekday: number | null
  weekend: number | null
  diffMin: number | null
  text: string | null
}

/** Average midpoint on weekday nights against weekend nights, in plain words. */
export function weekdayWeekend(nights: SleepNight[], tz: Tz): MidpointSplit {
  const wk = nights.filter((n) => !isWeekendNight(n.date)).map((n) => midpointFromNoon(n, tz))
  const we = nights.filter((n) => isWeekendNight(n.date)).map((n) => midpointFromNoon(n, tz))
  const weekday = wk.length >= SLEEP_VIEW.weekendMinNights ? mean(wk) : null
  const weekend = we.length >= SLEEP_VIEW.weekendMinNights ? mean(we) : null
  if (weekday == null || weekend == null) {
    return { weekday, weekend, diffMin: null, text: null }
  }
  const diffMin = Math.round(weekend - weekday)
  const text = Math.abs(diffMin) < SLEEP_VIEW.midpointSameMin
    ? 'Weekend and weekday sleep run at about the same time.'
    : `Weekend sleep runs ${durationWords(diffMin)} ${diffMin > 0 ? 'later' : 'earlier'}.`
  return { weekday: Math.round(weekday), weekend: Math.round(weekend), diffMin, text }
}

/** Minutes after noon back to a clock time. */
export const clockOf = (fromNoon: number) => hhmm(fromNoon + 720)

export interface ChronoRow {
  date: string
  bed: number
  wake: number
  asleepMin: number
}

/** Bed and wake for each of the last `count` nights (minutes after noon), oldest first. */
export function chronogram(nightBy: Map<string, SleepNight>, today: string, count: number, tz: Tz): ChronoRow[] {
  const out: ChronoRow[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = addDays(today, -i)
    const n = nightBy.get(d)
    if (!n) continue
    const bed = clockFromNoon(n.start, tz)
    out.push({ date: d, bed, wake: bed + (n.end - n.start) / MIN, asleepMin: n.asleepMin })
  }
  return out
}

/** "Start winding down at": 30 minutes before the suggested bedtime. */
export const windDownAt = (bedtime: string) => hhmm((parseHhmm(bedtime) ?? 0) - SLEEP_VIEW.windDownMin)

/** The last 7 nights against need, oldest first; a night with no record is shown as missing, not as debt. */
export function debtNights(nightBy: Map<string, SleepNight>, today: string, needH: number) {
  const out: Array<{ date: string; asleepH: number | null; shortH: number }> = []
  for (let i = SLEEP.debtNights - 1; i >= 0; i--) {
    const d = addDays(today, -i)
    const n = nightBy.get(d)
    const h = n ? n.asleepMin / 60 : null
    out.push({ date: d, asleepH: h == null ? null : round(h, 2), shortH: h == null ? 0 : round(Math.max(0, needH - h), 2) as number })
  }
  return out
}

// --------------------------------------------------- what affects your sleep

/** A workout ending within 3 hours before bedtime (or running into it) is late. */
export function isLateWorkout(workout: { start: number; end: number }, bedStart: number): boolean {
  return workout.end >= bedStart - SLEEP_VIEW.lateWorkoutH * 60 * MIN && workout.start < bedStart
}

/**
 * Days whose following night came after a late workout. A day with no
 * night recorded after it is left out (null), so it counts in neither group.
 */
export function lateWorkoutDay(
  workouts: Array<{ date: string; start: number; end: number }>,
  nightBy: Map<string, SleepNight>,
): (date: string) => boolean | null {
  return (d) => {
    const n = nightBy.get(addDays(d, 1))
    if (!n) return null
    return workouts.some((w) => (w.date === d || w.date === addDays(d, 1)) && isLateWorkout(w, n.start))
  }
}

/**
 * A higher-load training day: that day's load over 1.3 x the average of the
 * training days in the 28 days before. Rest days are "no"; without 4 earlier
 * training days to compare with, the day is left out.
 */
export function higherLoadDay(load: Map<string, number>, date: string): boolean | null {
  const prior: number[] = []
  for (let i = 1; i <= SLEEP_VIEW.higherLoadDays; i++) {
    const v = load.get(addDays(date, -i))
    if (v && v > 0) prior.push(v)
  }
  if (prior.length < SLEEP_VIEW.higherLoadMinSessions) return null
  const today = load.get(date) || 0
  return today > SLEEP_VIEW.higherLoadX * (mean(prior) as number)
}

export interface Factor {
  key: string
  label: string
  /** How a sentence names the group: "days with a late workout". */
  phrase: string
  inGroup: (date: string) => boolean | null
}

export interface FactorOutcome {
  key: string
  label: string
  unit: string
  dp: number
  fn: Lookup
  /** Normal night-to-night wobble of this outcome, for the label. */
  wobble: number
}

export type DiffLabel = 'Clear difference' | 'Possible difference' | 'Within normal fluctuation'

export interface FactorResult {
  key: string
  label: string
  nWith: number
  nWithout: number
  diff: number | null
  verdict: DiffLabel | null
  text: string | null
}

export interface FactorRow {
  key: string
  label: string
  enough: boolean
  needsMore: number
  results: FactorResult[]
  rank: number | null
  /** "Needs 3 more nights", when not enough yet. */
  gate: string | null
}

const toDiffLabel = (l: string): DiffLabel => (l === 'Clear change' ? 'Clear difference' : l === 'Possible change' ? 'Possible difference' : 'Within normal fluctuation')

/**
 * Each factor's days against the rest, on each outcome. A factor needs 7
 * nights in each group on at least one outcome; until then it says how many
 * more it needs. Ranked by the largest difference measured in wobbles;
 * factors without enough nights come last, closest first.
 */
export function sleepFactors({ days, factors, outcomes, min = SLEEP_VIEW.minPerGroup }: {
  days: string[]
  factors: Factor[]
  outcomes: FactorOutcome[]
  min?: number
}): FactorRow[] {
  const rows = factors.map((f): FactorRow => {
    const results = outcomes.map((o): FactorResult & { score: number | null; needsMore: number } => {
      const s = groupSplit(days, f.inGroup, o.fn, min)
      const verdict = s.diff == null ? null : toDiffLabel(changeLabel(s.diff, o.wobble))
      let text: string | null = null
      if (s.diff != null) {
        text = verdict === 'Within normal fluctuation'
          ? `${o.label}: about the same on ${f.phrase}`
          : `${o.label}: ${Math.abs(s.diff).toFixed(o.dp)}${o.unit ? ` ${o.unit}` : ''} ${s.diff > 0 ? 'higher' : 'lower'} on ${f.phrase}`
      }
      return {
        key: o.key, label: o.label, nWith: s.with.n, nWithout: s.without.n, diff: s.diff, verdict, text,
        score: s.diff != null && o.wobble > 0 ? Math.abs(s.diff) / o.wobble : null,
        needsMore: s.needsMore,
      }
    })
    const scores = results.map((r) => r.score).filter(isNum)
    const enough = results.some((r) => r.diff != null)
    const needsMore = enough ? 0 : Math.min(...results.map((r) => r.needsMore))
    return {
      key: f.key,
      label: f.label,
      enough,
      needsMore,
      results: results.map(({ score: _s, needsMore: _n, ...r }) => r),
      rank: scores.length ? round(Math.max(...scores), 3) : null,
      gate: enough ? null : `Needs ${needsMore} more night${needsMore === 1 ? '' : 's'}`,
    }
  })
  return rows.sort((a, b) => {
    if (a.enough !== b.enough) return a.enough ? -1 : 1
    if (a.enough) return (b.rank ?? 0) - (a.rank ?? 0)
    return a.needsMore - b.needsMore
  })
}

/** The fallback wobble for an outcome without enough history. */
export const outcomeWobbleFallback = (key: 'sleepScore' | 'deepSleep' | 'hrv') => PHASES.wobbleFallback[key]
