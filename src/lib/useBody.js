// The app's one way to read current body values and their history.
//
// Merges what is typed or scanned into the app with the body readings Apple
// Health published (native app only; empty on the web), and hands both to
// src/body/bodySeries, which decides which reading counts on each day.
import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { useHealthLink } from './healthLink'
import { getLatestMeasurement, dailySeries } from '../body/bodySeries'
import { getStartValue, effectiveStart, sinceStart, compareSinceStart } from '../body/startPoint'
import { trackedEvents } from '../health/engine/phases'
import { useCompounds } from './useCompounds'

/** Fields with a current value worth showing in a chart header (not the tape measurements). */
export const BODY_FIELDS = new Set([
  'weight', 'bodyFat', 'leanMass', 'fatMass', 'bp', 'muscleMass', 'visceralFat', 'waist',
  'skeletalMuscleMass', 'visceralFatLevel', 'visceralFatMass', 'visceralFatArea', 'subcutaneousFatMass',
])

export function useBodyInput() {
  const measurements = useStore((s) => s.measurements)
  const health = useHealthLink((s) => s.bodyDaily)
  return useMemo(() => ({ measurements, health }), [measurements, health])
}

/** The current value of a body field: newest day with a value, any source. */
export function useLatestMeasurement(field) {
  const input = useBodyInput()
  const t = todayStr()
  return useMemo(() => getLatestMeasurement(field, input, t), [field, input, t])
}

/** Dated values for a metric, one per day, merged across sources (entries kept off the charts left out). */
export function seriesFor(key, input) {
  return dailySeries(key, input)
}

export function useBodySeries(field) {
  const input = useBodyInput()
  return useMemo(() => seriesFor(field, input), [field, input])
}

/**
 * The starting point in force: the one set in Measurements, or by default the
 * start date of the first tracked compound.
 */
export function useBodyStart() {
  const bodyStart = useStore((s) => s.bodyStart)
  const compounds = useCompounds()
  const input = useBodyInput()
  return useMemo(() => {
    const starts = trackedEvents(compounds).filter((e) => e.kind === 'start').map((e) => e.date)
    return effectiveStart(bodyStart, starts, input)
  }, [bodyStart, compounds, input])
}

/** Where a field's "since" delta starts, or null to hide it. */
export function useStartValue(field) {
  const start = useBodyStart()
  const input = useBodyInput()
  return useMemo(() => getStartValue(field, start, input), [field, start, input])
}

/**
 * A field's change since the starting point: start value, latest value and
 * the change, with body fat, fat mass and lean mass kept to one device family.
 */
export function useSinceStart(field) {
  const start = useBodyStart()
  const input = useBodyInput()
  const t = todayStr()
  return useMemo(() => compareSinceStart(field, start, input, t), [field, start, input, t])
}

/** The latest reading's device, or null for a typed-in value. */
export const latestDevice = (l) => (!l || l.source === 'manual' ? null : l.sourceLabel)

/** "since 1 Jan 2025" */
export const sinceWords = (start) => (start ? `since ${format(parseISO(start.date), 'd MMM yyyy')}` : '')

export { sinceStart }

/** "16 Oct, Withings" */
export const latestCaption = (l) => (l ? `${format(parseISO(l.date), 'd MMM')}, ${l.sourceLabel}` : '')
