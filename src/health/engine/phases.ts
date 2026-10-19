// Phases: the stretches between protocol changes, and what each metric did in
// them compared with the stretch before.
//
// A boundary is a start, stop or dose change of a tracked compound; changes
// within 7 days of each other are one boundary. The first phase, "Before
// tracking", runs from the first data to the first boundary; the last runs to
// today. Body metrics are read as a rate per week (least-squares slope of the
// merged daily series), daily metrics as a phase average. A change is judged
// against the metric's normal wobble: how far daily values usually sit from
// their own 7-day average. The words are descriptive only: rising, falling,
// steady, higher, lower, about the same. Never caused, improved or worked.

import { PHASES, TRACK_DEFAULT } from './config'
import { addDays, daysBetween } from '../tz'
import { isNum, mean, sampleSd } from './stats'
import type { TimelinePoint, CompoundLike } from './protocol'
import { affectsBaseline, RELEVANT_KINDS } from './protocol'
import { slopePerDay } from '../../body/bodySeries'
import { groupEvents } from '../../body/chartPoints'

// ------------------------------------------------------------- tracking

export interface TrackedCompound extends CompoundLike {
  trackEffects?: boolean
  points: TimelinePoint[]
}

/** On by default for baseline-affecting compounds and the catalogue list in config. */
export const defaultTrackEffects = (c: CompoundLike) =>
  affectsBaseline(c) || TRACK_DEFAULT.test(`${c.id} ${c.name} ${c.libraryId || ''}`)

export const tracksEffects = (c: TrackedCompound) => c.trackEffects ?? defaultTrackEffects(c)

// --------------------------------------------------------------- events

export interface ChangeEvent {
  date: string
  compoundId: string
  name: string
  kind: 'start' | 'change' | 'stop'
  dose: string | null
}

const fmtDose = (to: number | null | undefined, unit: string | null | undefined) =>
  to == null ? null : `${Number.isInteger(to) ? to : Math.round(to * 100) / 100}${unit ? ` ${unit}` : ''}`

/** Starts, stops and dose changes of the tracked compounds, oldest first. */
export function trackedEvents(compounds: TrackedCompound[]): ChangeEvent[] {
  const out: ChangeEvent[] = []
  for (const c of compounds) {
    if (!tracksEffects(c)) continue
    let on = false
    const pts = c.points.filter((p) => RELEVANT_KINDS.has(p.kind)).sort((a, b) => a.date.localeCompare(b.date))
    for (const p of pts) {
      if (p.kind === 'stop') { out.push({ date: p.date, compoundId: c.id, name: c.name, kind: 'stop', dose: null }); on = false; continue }
      out.push({ date: p.date, compoundId: c.id, name: c.name, kind: on ? 'change' : 'start', dose: fmtDose(p.to, p.unit) })
      on = true
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

export { groupEvents } from '../../body/chartPoints'

/** "Started Reta 1.5 mg, Test E 60 mg; Reta to 2 mg; Stopped BPC-157" */
export function describeChanges(events: ChangeEvent[]): string {
  const starts = events.filter((e) => e.kind === 'start').map((e) => `${e.name}${e.dose ? ` ${e.dose}` : ''}`)
  const changes = events.filter((e) => e.kind === 'change').map((e) => `${e.name} to ${e.dose ?? 'a new dose'}`)
  const stops = events.filter((e) => e.kind === 'stop').map((e) => e.name)
  return [
    starts.length ? `Started ${starts.join(', ')}` : null,
    changes.length ? changes.join(', ') : null,
    stops.length ? `Stopped ${stops.join(', ')}` : null,
  ].filter(Boolean).join('; ')
}

// --------------------------------------------------------------- phases

export interface Phase {
  index: number
  from: string
  to: string
  days: number
  events: ChangeEvent[]
  title: string
  combined: boolean
  combinedNote: string | null
}

export function buildPhases(events: ChangeEvent[], firstDataDate: string | null, today: string): Phase[] {
  if (!firstDataDate) return []
  const groups = groupEvents(events).filter((g) => g.date <= today)
  const starts: Array<{ date: string; events: ChangeEvent[] }> = []
  const before = groups.filter((g) => g.date <= firstDataDate)
  // changes on or before the first data open the first phase themselves
  if (before.length) starts.push({ date: firstDataDate, events: before.flatMap((g) => g.events) })
  else starts.push({ date: firstDataDate, events: [] })
  for (const g of groups) if (g.date > firstDataDate) starts.push({ date: g.date, events: g.events })

  return starts.map((s, i) => {
    const to = i < starts.length - 1 ? addDays(starts[i + 1].date, -1) : today
    const combined = s.events.length >= 2
    return {
      index: i,
      from: s.date,
      to,
      days: daysBetween(s.date, to) + 1,
      events: s.events,
      title: s.events.length ? describeChanges(s.events) : 'Before tracking',
      combined,
      combinedNote: combined ? PHASES.combinedNote : null,
    }
  })
}

// --------------------------------------------------------------- wobble

export type MetricKey = 'weight' | 'fatMass' | 'leanMass' | 'bodyFat' | 'waist' | 'rhr' | 'hrv' | 'sleep' | 'readiness'
export interface Point { date: string; value: number }

/**
 * Normal wobble: SD of daily values around their trailing 7-day average over
 * the last 90 days. Fewer than 10 points: the metric's fallback.
 */
export function wobble(series: Point[], metric: MetricKey, today: string): { value: number; fallback: boolean } {
  const from = addDays(today, -(PHASES.wobbleDays - 1))
  const pts = series.filter((p) => p.date >= from && p.date <= today && isNum(p.value))
  if (pts.length >= PHASES.wobbleMinPoints) {
    const resid = pts.map((p) => {
      const win = pts.filter((q) => q.date <= p.date && daysBetween(q.date, p.date) < PHASES.wobbleMaDays)
      return p.value - (mean(win.map((q) => q.value)) as number)
    })
    const sd = sampleSd(resid)
    if (sd != null && sd > 0) return { value: sd, fallback: false }
  }
  return { value: PHASES.wobbleFallback[metric], fallback: true }
}

// ------------------------------------------------------------- per phase

export type ChangeLabel = 'Clear change' | 'Possible change' | 'Within normal fluctuation' | 'Too early'
export const BODY_METRICS: MetricKey[] = ['weight', 'fatMass', 'leanMass', 'bodyFat', 'waist']
export const DAILY_METRICS: MetricKey[] = ['rhr', 'hrv', 'sleep', 'readiness']

export const METRIC_INFO: Record<MetricKey, { label: string; unit: string; rateUnit: string; dp: number }> = {
  weight: { label: 'Weight', unit: 'kg', rateUnit: 'kg', dp: 1 },
  fatMass: { label: 'Fat mass', unit: 'kg', rateUnit: 'kg', dp: 1 },
  leanMass: { label: 'Lean mass', unit: 'kg', rateUnit: 'kg', dp: 1 },
  bodyFat: { label: 'Body fat', unit: '%', rateUnit: 'points', dp: 1 },
  waist: { label: 'Waist', unit: 'cm', rateUnit: 'cm', dp: 1 },
  rhr: { label: 'Resting heart rate', unit: 'bpm', rateUnit: 'bpm', dp: 0 },
  hrv: { label: 'HRV', unit: 'ms', rateUnit: 'ms', dp: 0 },
  sleep: { label: 'Sleep', unit: 'h', rateUnit: 'h', dp: 1 },
  readiness: { label: 'Readiness', unit: '', rateUnit: '', dp: 0 },
}

export interface PhaseStat {
  ok: boolean
  /** body: per week; daily: phase mean */
  value: number | null
  n: number
}

const inPhase = (series: Point[], p: { from: string; to: string }) => series.filter((x) => x.date >= p.from && x.date <= p.to && isNum(x.value))

export function bodyRate(series: Point[], phase: { from: string; to: string; days: number }): PhaseStat {
  const pts = inPhase(series, phase)
  if (phase.days < PHASES.bodyMinDays || pts.length < PHASES.bodyMinReadings) return { ok: false, value: null, n: pts.length }
  const s = slopePerDay(pts)
  return s == null ? { ok: false, value: null, n: pts.length } : { ok: true, value: s * 7, n: pts.length }
}

export function dailyMean(series: Point[], phase: { from: string; to: string }): PhaseStat {
  const pts = inPhase(series, phase)
  const days = new Set(pts.map((p) => p.date)).size
  if (days < PHASES.dailyMinDays) return { ok: false, value: null, n: days }
  return { ok: true, value: mean(pts.map((p) => p.value)), n: days }
}

/** Clear / Possible / Within normal fluctuation, from a magnitude and the wobble. */
export function changeLabel(magnitude: number, wob: number): ChangeLabel {
  const m = Math.abs(magnitude)
  if (m >= PHASES.clearX * wob) return 'Clear change'
  if (m >= PHASES.possibleX * wob) return 'Possible change'
  return 'Within normal fluctuation'
}

export interface MetricRow {
  metric: MetricKey
  kind: 'body' | 'daily'
  now: PhaseStat
  before: PhaseStat | null
  /** body: (slope now − slope before) × weeks in this phase; daily: mean now − mean before */
  magnitude: number | null
  wobble: number
  label: ChangeLabel
  text: string
}

const trim = (v: number, dp: number) => String(Number(v.toFixed(dp)))
const rate = (v: number, unit: string) => {
  if (Math.abs(v) < PHASES.steadyPerWeek) return 'steady'
  return `${v > 0 ? 'rising' : 'falling'} ${trim(Math.abs(v), 2)} ${unit} a week`
}

/** The plain sentence for a row, without the label. */
export function rowSentence(row: Pick<MetricRow, 'metric' | 'kind' | 'now' | 'before'>): string {
  const info = METRIC_INFO[row.metric]
  if (!row.now.ok || row.now.value == null) {
    const need = row.kind === 'body' ? `${PHASES.bodyMinDays} days and ${PHASES.bodyMinReadings} readings` : `${PHASES.dailyMinDays} days with data`
    return `${info.label}: too early to say (needs ${need} in this phase)`
  }
  if (row.kind === 'body') {
    const now = rate(row.now.value, info.rateUnit)
    const before = row.before?.ok && row.before.value != null ? ` (before: ${rate(row.before.value, info.rateUnit)})` : ' (no earlier trend to compare)'
    return `${info.label}: ${now}${before}`
  }
  const unit = info.unit ? ` ${info.unit}` : ''
  const nowV = trim(row.now.value, info.dp)
  if (!row.before?.ok || row.before.value == null) return `${info.label}: averaging ${nowV}${unit} (no earlier average to compare)`
  const beforeV = trim(row.before.value, info.dp)
  const diff = Number(row.now.value.toFixed(info.dp)) - Number(row.before.value.toFixed(info.dp))
  const word = diff === 0 ? 'about the same as before' : `${diff > 0 ? 'higher' : 'lower'} than before`
  return `${info.label}: ${word}, ${nowV}${unit} against ${beforeV}${unit}`
}

/** "Fat mass: falling 0.25 kg a week (before: rising 0.1 kg a week). Clear change." */
export const fullSentence = (row: MetricRow) => `${row.text}. ${row.label}.`

export function metricRow(metric: MetricKey, series: Point[], phase: Phase, prev: Phase | null, wob: number): MetricRow {
  const kind = BODY_METRICS.includes(metric) ? 'body' : 'daily'
  const now = kind === 'body' ? bodyRate(series, phase) : dailyMean(series, phase)
  const before = prev ? (kind === 'body' ? bodyRate(series, prev) : dailyMean(series, prev)) : null
  let magnitude: number | null = null
  if (now.ok && before?.ok && now.value != null && before.value != null) {
    magnitude = kind === 'body' ? (now.value - before.value) * (phase.days / 7) : now.value - before.value
  }
  const label: ChangeLabel = magnitude == null ? 'Too early' : changeLabel(magnitude, wob)
  const row = { metric, kind, now, before, magnitude, wobble: wob, label } as Omit<MetricRow, 'text'>
  return { ...row, text: rowSentence(row) }
}

const LABEL_ORDER: Record<ChangeLabel, number> = { 'Clear change': 0, 'Possible change': 1, 'Within normal fluctuation': 2, 'Too early': 3 }

export interface PhaseView extends Phase {
  rows: MetricRow[]
}

/**
 * Every phase with a row for each metric that has any reading in it, clear
 * changes first. Newest phase first.
 */
export function phaseViews({ compounds, series, today }: {
  compounds: TrackedCompound[]
  series: Partial<Record<MetricKey, Point[]>>
  today: string
}): PhaseView[] {
  const all = Object.values(series).flatMap((s) => s || [])
  const first = all.length ? all.reduce((m, p) => (p.date < m ? p.date : m), all[0].date) : null
  const phases = buildPhases(trackedEvents(compounds), first, today)
  const wob = Object.fromEntries((Object.keys(series) as MetricKey[]).map((k) => [k, wobble(series[k] || [], k, today).value])) as Record<MetricKey, number>
  return phases.map((p, i) => {
    const prev = i > 0 ? phases[i - 1] : null
    const rows = (Object.keys(series) as MetricKey[])
      .filter((k) => inPhase(series[k] || [], p).length > 0)
      .map((k) => metricRow(k, series[k] || [], p, prev, wob[k]))
      .sort((a, b) => LABEL_ORDER[a.label] - LABEL_ORDER[b.label])
    return { ...p, rows }
  }).reverse()
}
