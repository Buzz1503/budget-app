import { useMemo } from 'react'
import useStore from '../../store/useStore'
import { ownSeries } from '../../sauna/analytics'
import { addDays } from '../../health/tz'
import { SaunaHealthContext } from '../sauna/saunaHealthContext'
import useSaunaInput from './useSaunaInput'
import { tz } from './useHealthModel'

/**
 * Gives the Sauna tab its Health lookups: that night and the next morning,
 * timed weigh-ins for the fluid estimate, and heart rate for a session (the
 * Watch's own samples, else a Health workout covering it). Native only.
 */
export default function SaunaHealthProvider({ children }) {
  const connected = useStore((s) => s.healthSettings.connected)
  const { model, input } = useSaunaInput()
  const value = useMemo(() => {
    if (!connected) return null
    const weighIns = (fromMs, toMs) => {
      const out = []
      for (let d = tz.dateOf(fromMs); d <= tz.dateOf(toMs); d = addDays(d, 1)) {
        for (const w of model.dailyBy.get(d)?.weighIns || []) if (w.t >= fromMs && w.t <= toMs) out.push(w)
      }
      return out
    }
    const seriesFor = (session) => {
      const own = ownSeries(session, input.toMs)
      if (own) return own
      const a = session.startedAt ?? input.toMs(session.date, session.start)
      const b = a + session.lengthMin * 60000
      const w = (session.workoutId && model.sessions.find((x) => x.id === session.workoutId || x.mergedIds?.includes(session.workoutId)))
        || model.sessions.find((x) => x.hrSeries.length && x.start < b && x.end > a)
      if (!w?.hrSeries.length) return null
      const series = w.hrSeries.map(([sec, bpm]) => [w.start + sec * 1000, bpm]).filter(([t]) => t >= a - 60000 && t <= b + 60000)
        .map(([t, bpm]) => [Math.round((t - a) / 1000), bpm])
      return series.length >= 2 ? series : null
    }
    return {
      h: { today: model.today, night: input.night, morning: input.morning, weighIns },
      toMs: input.toMs,
      maxHR: model.maxHR,
      seriesFor,
      patternInput: input,
    }
  }, [connected, model, input])
  return <SaunaHealthContext.Provider value={value}>{children}</SaunaHealthContext.Provider>
}
