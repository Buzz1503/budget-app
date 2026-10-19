import { useEffect, useMemo } from 'react'
import useStore, { todayStr } from '../../store/useStore'
import { useHealth } from '../../health/state'
import { buildModel } from '../../health/engine/model'
import { makeTz } from '../../health/tz'
import { useCompounds } from '../../lib/useCompounds'

const tz = makeTz()

export { useCompounds }

/** The Health model for today, rebuilt when the cache or the protocol changes. */
export default function useHealthModel() {
  const data = useHealth((s) => s.data)
  const loaded = useHealth((s) => s.loaded)
  const load = useHealth((s) => s.load)
  const settings = useStore((s) => s.healthSettings)
  const doseLogs = useStore((s) => s.doseLogs)
  const measurements = useStore((s) => s.measurements)
  const checkins = useStore((s) => s.checkins)
  const habitLogs = useStore((s) => s.habitLogs)
  const habits = useStore((s) => s.habits)
  const compounds = useCompounds()
  const t = todayStr()

  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  return useMemo(() => buildModel({
    daily: data.daily,
    nights: data.nights,
    workouts: data.workouts,
    characteristics: data.meta.characteristics,
    settings,
    protocol: { compounds, doseLogs, measurements, checkins, habitLogs, habits },
    today: t,
    tz,
  }), [data, settings, compounds, doseLogs, measurements, checkins, habitLogs, habits, t])
}

export { tz }
