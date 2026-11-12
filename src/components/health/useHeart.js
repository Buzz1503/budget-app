import { useMemo } from 'react'
import useStore, { todayStr } from '../../store/useStore'
import useHealthModel, { useCompounds, tz } from './useHealthModel'
import { addDays } from '../../health/tz'
import { wakeUps } from '../../sleep/restless'
import { nightHeart, periodsFor, defaultReference, periodTable, doseChanges, rangeMean, HEART_METRICS } from '../../health/heart'

/**
 * Everything the Heart section reads, by date: resting HR (Apple's daily
 * value), the night's heart rate in 5-minute averages, wake-ups, awake
 * minutes and deep sleep (nights with stages only), HRV; the periods by
 * compound and dose; the good sleep reference.
 */
export default function useHeart() {
  const model = useHealthModel()
  const compounds = useCompounds()
  const settings = useStore((s) => s.heartSettings)
  const t = todayStr()
  return useMemo(() => {
    const day = new Map(model.daily.map((r) => [r.date, r]))
    const rhr = new Map()
    const hrv = new Map()
    for (const r of model.daily) {
      if (r.restingHR != null) rhr.set(r.date, r.restingHR)
      if (r.hrvOvernight != null) hrv.set(r.date, r.hrvOvernight)
    }
    const sleepHR = new Map()
    const timeToLow = new Map()
    const wake = new Map()
    const awake = new Map()
    const deep = new Map()
    const hearts = new Map()
    const bedtimes = new Map()
    for (const n of model.nightBy.values()) {
      if (n.fallback) continue
      bedtimes.set(n.date, n.start)
      const h = nightHeart(n, n.overnight?.hr, day.get(addDays(n.date, -1))?.hrDaytime ?? null)
      if (h) {
        hearts.set(n.date, h)
        sleepHR.set(n.date, h.avg)
        if (h.timeToLowMin != null) timeToLow.set(n.date, h.timeToLowMin)
      } else if (n.sleepingHR?.avg) sleepHR.set(n.date, n.sleepingHR.avg)
      // stage comparisons: nights with stages only
      if (n.hasStages) {
        deep.set(n.date, Math.round(n.deepMin))
        const w = wakeUps(n.segments)
        if (w) { wake.set(n.date, w.count); awake.set(n.date, w.awakeMin) }
      }
    }
    const lookups = { rhr, sleepHR, wakeUps: wake, awakeMin: awake, hrv, deep, timeToLow }
    const periods = periodsFor(compounds, t)
    const reference = settings?.reference?.from && settings?.reference?.to ? settings.reference : defaultReference(compounds, t)
    const table = periodTable(periods, lookups, reference)
    return {
      model, compounds, lookups, hearts, bedtimes, periods, reference, referenceIsDefault: !settings?.reference,
      table, changes: doseChanges(compounds, t), today: t, tz, metrics: HEART_METRICS,
    }
  }, [model, compounds, settings, t])
}

/**
 * The cheap part of the reference for Home and the Sleep tab: the good sleep
 * period and its average resting HR, without building the whole Heart model.
 */
export function useHeartReference() {
  const model = useHealthModel()
  const compounds = useCompounds()
  const settings = useStore((s) => s.heartSettings)
  const t = todayStr()
  return useMemo(() => {
    const reference = settings?.reference?.from && settings?.reference?.to ? settings.reference : defaultReference(compounds, t)
    const rhr = new Map()
    for (const r of model.daily) if (r.restingHR != null) rhr.set(r.date, r.restingHR)
    // the latest resting HR from the last two days, for the Today card before today's arrives
    const latestRhr = rhr.get(t) ?? rhr.get(addDays(t, -1)) ?? null
    return { reference, rhrMean: rangeMean(rhr, reference), latestRhr }
  }, [model, compounds, settings, t])
}
