// Effects, one compound at a time.
//
// For a tracked compound: the period before it was started against the period
// on it ("since starting"), which other tracked compounds started, stopped or
// changed dose close enough to share those changes (the overlap warning), and
// its own dose changes that nothing else came near ("clean windows", 14 days
// before against 14 days after). Rates, averages, wobble, labels and wording
// all come from the phase engine, so the rules are the same everywhere.
// Body fat, fat mass and lean mass read one device family per comparison.

import { PHASES } from './config'
import { addDays, daysBetween } from '../tz'
import type { ChangeEvent, MetricKey, MetricRow, Point, TrackedCompound, Window } from './phases'
import { metricRow, wobble, bodyRate, tracksEffects, trackedEvents, LABEL_RANK, BODY_METRICS } from './phases'

export type FamilySeries = Record<string, Point[]>

export interface EffectInput {
  /** merged or single-source series, by metric */
  series: Partial<Record<MetricKey, Point[]>>
  /** body fat, fat mass and lean mass, one series per device family */
  families?: Partial<Record<'bodyFat' | 'fatMass' | 'leanMass', FamilySeries>>
}

export const SINCE_METRICS: MetricKey[] = [
  'weight', 'fatMass', 'leanMass', 'bodyFat', 'waist', 'visceralFatLevel',
  'rhr', 'hrv', 'sleep', 'deepSleep', 'sleepScore', 'readiness',
]
const FAMILY_KEYS = new Set(['bodyFat', 'fatMass', 'leanMass'])
export const FAMILY_NAME: Record<string, string> = { evolt: 'Evolt', scale: 'Scale', dexa: 'DEXA' }

const win = (from: string, to: string): Window => ({ from, to, days: daysBetween(from, to) + 1 })

/**
 * The device family a two-sided comparison reads: Evolt when it has a usable
 * trend on both sides, else Scale, else any family that does, else the
 * family with the most readings (which will read as too early).
 */
export function familyForComparison(families: FamilySeries, a: Window, b: Window): string | null {
  const keys = Object.keys(families)
  if (!keys.length) return null
  const ok = (k: string) => bodyRate(families[k], a).ok && bodyRate(families[k], b).ok
  for (const k of ['evolt', 'scale', ...keys]) if (families[k] && ok(k)) return k
  const count = (k: string) => families[k].filter((p) => (p.date >= a.from && p.date <= a.to) || (p.date >= b.from && p.date <= b.to)).length
  return [...keys].sort((x, y) => count(y) - count(x))[0]
}

export interface EffectRow extends MetricRow {
  /** which device family a body fat, fat mass or lean mass row reads */
  family: string | null
}

/** One metric compared across two windows, with the family chosen for the body-comp three. */
export function compareWindows(metric: MetricKey, input: EffectInput, after: Window, before: Window, today: string): EffectRow | null {
  let series: Point[] | undefined
  let family: string | null = null
  if (FAMILY_KEYS.has(metric)) {
    const fams = input.families?.[metric as 'bodyFat' | 'fatMass' | 'leanMass'] || {}
    family = familyForComparison(fams, after, before)
    series = family ? fams[family] : undefined
  } else {
    series = input.series[metric]
  }
  if (!series || !series.length) return null
  const inside = (w: Window) => series!.some((p) => p.date >= w.from && p.date <= w.to)
  if (!inside(after) && !inside(before)) return null
  const row = metricRow(metric, series, after, before, wobble(series, metric, today).value)
  return { ...row, family }
}

// ------------------------------------------------------------ the compound

export interface CompoundRun { start: string; end: string; ongoing: boolean }

/** The most recent run: its start (the latest start event) and its stop, or today. */
export function latestRun(events: ChangeEvent[], compoundId: string, today: string): CompoundRun | null {
  const mine = events.filter((e) => e.compoundId === compoundId).sort((a, b) => a.date.localeCompare(b.date))
  const starts = mine.filter((e) => e.kind === 'start')
  const s = starts[starts.length - 1]
  if (!s || s.date > today) return null
  const stop = mine.find((e) => e.kind === 'stop' && e.date >= s.date)
  return { start: s.date, end: stop ? stop.date : today, ongoing: !stop }
}

export interface Overlap { compoundId: string; name: string; kind: ChangeEvent['kind']; date: string; offsetDays: number }

/** Other tracked compounds that started, stopped or changed dose within 14 days of this one's start. */
export function overlapsWith(events: ChangeEvent[], compoundId: string, startDate: string, days: number = PHASES.overlapDays): Overlap[] {
  return events
    .filter((e) => e.compoundId !== compoundId && Math.abs(daysBetween(startDate, e.date)) <= days)
    .map((e) => ({ compoundId: e.compoundId, name: e.name, kind: e.kind, date: e.date, offsetDays: daysBetween(startDate, e.date) }))
    .sort((a, b) => Math.abs(a.offsetDays) - Math.abs(b.offsetDays))
}

const VERB = { start: 'started', stop: 'stopped', change: 'changed dose' }

const joinNames = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/**
 * "Testosterone E started 4 days after this and MOTS-c 6 days after. Changes
 * in this section are shared with them and cannot be split." Compounds that
 * changed the same way on the same day are named together.
 */
export function overlapSentence(overlaps: Overlap[]): string | null {
  if (!overlaps.length) return null
  const firstPer = new Map<string, Overlap>()
  for (const o of overlaps) if (!firstPer.has(o.compoundId)) firstPer.set(o.compoundId, o)
  const groups: Array<{ kind: Overlap['kind']; offset: number; names: string[] }> = []
  for (const o of firstPer.values()) {
    const g = groups.find((x) => x.kind === o.kind && x.offset === o.offsetDays)
    if (g) g.names.push(o.name)
    else groups.push({ kind: o.kind, offset: o.offsetDays, names: [o.name] })
  }
  const parts = groups.map((g, i) => {
    const n = Math.abs(g.offset)
    const dist = n === 0 ? 'on the same day' : `${n} day${n === 1 ? '' : 's'} ${g.offset > 0 ? 'after' : 'before'}`
    // the verb is said once while it stays the same
    const verb = i > 0 && groups[i - 1].kind === g.kind ? '' : `${VERB[g.kind]} `
    return `${joinNames(g.names)} ${verb}${dist}${i === 0 && n !== 0 ? ' this' : ''}`
  })
  const them = firstPer.size === 1 ? 'it' : 'them'
  return `${joinNames(parts)}. Changes in this section are shared with ${them} and cannot be split.`
}

export interface CleanWindow { date: string; event: ChangeEvent; before: Window; after: Window; rows: EffectRow[] }

/** This compound's dose changes (and stop) with no other tracked change within 14 days either side. */
export function cleanWindows(events: ChangeEvent[], compoundId: string, input: EffectInput, today: string, days: number = PHASES.cleanWindowDays): CleanWindow[] {
  const mine = events.filter((e) => e.compoundId === compoundId && e.kind !== 'start')
  return mine
    .filter((e) => !events.some((o) => o.compoundId !== compoundId && Math.abs(daysBetween(e.date, o.date)) <= days))
    .map((e) => {
      const before = win(addDays(e.date, -days), addDays(e.date, -1))
      const after = win(addDays(e.date, 1), addDays(e.date, days) > today ? today : addDays(e.date, days))
      const rows = SINCE_METRICS.map((m) => compareWindows(m, input, after, before, today)).filter(Boolean) as EffectRow[]
      return { date: e.date, event: e, before, after, rows: rows.sort((a, b) => LABEL_RANK[a.label] - LABEL_RANK[b.label]) }
    })
    .reverse()
}

export interface CompoundEffects {
  compoundId: string
  name: string
  run: CompoundRun
  before: Window
  on: Window
  rows: EffectRow[]
  overlaps: Overlap[]
  overlapText: string | null
  clean: CleanWindow[]
  /** the clearest row, for the list */
  headline: EffectRow | null
}

/** Everything the compound's page shows. Null when it has not been started. */
export function compoundEffects(compound: TrackedCompound, allCompounds: TrackedCompound[], input: EffectInput, today: string): CompoundEffects | null {
  const events = trackedEvents(allCompounds.map((c) => (c.id === compound.id ? { ...c, trackEffects: true } : c)))
  const run = latestRun(events, compound.id, today)
  if (!run) return null
  const on = win(run.start, run.end)
  const len = Math.min(PHASES.beforeMaxDays, Math.max(PHASES.beforeMinDays, on.days))
  const before = win(addDays(run.start, -len), addDays(run.start, -1))
  const rows = (SINCE_METRICS.map((m) => compareWindows(m, input, on, before, today)).filter(Boolean) as EffectRow[])
    .sort((a, b) => LABEL_RANK[a.label] - LABEL_RANK[b.label])
  const overlaps = overlapsWith(events, compound.id, run.start)
  const headline = rows.find((r) => r.label !== 'Too early') || null
  return {
    compoundId: compound.id, name: compound.name, run, before, on, rows,
    overlaps, overlapText: overlapSentence(overlaps),
    clean: cleanWindows(events, compound.id, input, today),
    headline,
  }
}

/** The compounds the Effects list shows: tracked ones, most recently started first. */
export function trackedForEffects(compounds: TrackedCompound[]): TrackedCompound[] {
  return compounds.filter(tracksEffects)
}

export const isBodyMetric = (m: MetricKey) => BODY_METRICS.includes(m)
