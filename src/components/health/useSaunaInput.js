import { useMemo } from 'react'
import useStore, { todayStr } from '../../store/useStore'
import { addDays, dateRange } from '../../health/tz'
import { wobble } from '../../health/engine/phases'
import { minutesOf } from '../../sauna/sauna'
import useHealthModel, { tz } from './useHealthModel'

/**
 * The sauna effects input, from the Health model: the night a session belongs
 * to, the next morning, local times as instants, and each outcome's normal
 * wobble. Every day of the last year up to yesterday is compared.
 */
export default function useSaunaInput() {
  const model = useHealthModel()
  const sessions = useStore((s) => s.saunaSessions)
  const t = todayStr()
  return useMemo(() => {
    const night = (wake) => {
      const n = model.nightBy.get(wake)
      if (!n) return null
      return { start: n.start, score: model.sleepScore(wake)?.score ?? null, deepMin: n.hasStages ? n.deepMin : null, sleepingHR: n.sleepingHR?.avg ?? null }
    }
    const morning = (d) => ({ hrv: model.series.hrv.get(d) ?? null, rhr: model.series.rhr.get(d) ?? null, readiness: model.readiness(d).score })
    const pts = (fn) => [...model.nightBy.keys()].map((d) => ({ date: d, value: fn(d) })).filter((p) => p.value != null)
    const series = (m) => [...m.entries()].map(([date, value]) => ({ date, value }))
    return {
      model,
      input: {
        sessions,
        days: dateRange(addDays(t, -365), addDays(t, -1)),
        night,
        morning,
        toMs: (date, hhmm) => tz.startOfDay(date) + minutesOf(hhmm) * 60000,
        wobble: {
          sleepScore: wobble(pts((d) => model.sleepScore(d)?.score), 'sleepScore', t).value,
          deepSleep: wobble(pts((d) => { const n = model.nightBy.get(d); return n?.hasStages ? n.deepMin : null }), 'deepSleep', t).value,
          hrv: wobble(series(model.series.hrv), 'hrv', t).value,
          rhr: wobble(series(model.series.rhr), 'rhr', t).value,
        },
      },
    }
  }, [model, sessions, t])
}
