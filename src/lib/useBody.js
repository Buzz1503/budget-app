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
import { metricSeries } from './metrics'

/** Fields bodySeries resolves across sources; anything else is a manual tape measurement. */
export const BODY_FIELDS = new Set(['weight', 'bodyFat', 'leanMass', 'fatMass', 'bp', 'muscleMass', 'visceralFat', 'waist'])

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

/** Dated values for a metric: merged across sources for body fields, manual otherwise. */
export function seriesFor(key, input) {
  return BODY_FIELDS.has(key) ? dailySeries(key, input) : metricSeries(input.measurements || [], key)
}

export function useBodySeries(field) {
  const input = useBodyInput()
  return useMemo(() => seriesFor(field, input), [field, input])
}

/** "16 Oct, Withings" */
export const latestCaption = (l) => (l ? `${format(parseISO(l.date), 'd MMM')}, ${l.sourceLabel}` : '')
