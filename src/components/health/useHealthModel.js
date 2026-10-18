import { useEffect, useMemo } from 'react'
import useStore, { todayStr } from '../../store/useStore'
import { useHealth } from '../../health/state'
import { buildModel } from '../../health/engine/model'
import { makeTz } from '../../health/tz'
import { doseTimeline, runsFor } from '../../lib/tenure'
import { displayName } from '../../lib/naming'

const tz = makeTz()

/** Compounds with their dose timeline points and runs, the shape the engines take. */
export function useCompounds() {
  const peptides = useStore((s) => s.peptides)
  const doseEvents = useStore((s) => s.doseEvents)
  const runs = useStore((s) => s.runs)
  const t = todayStr()
  return useMemo(() => peptides.filter((p) => !p.archived).map((p) => ({
    id: p.id,
    name: displayName(p),
    libraryId: p.libraryId || null,
    affectsRecoveryBaseline: p.affectsRecoveryBaseline,
    points: doseTimeline(p, { doseEvents, runs, todayStr: t }).points,
    runs: runsFor(p, runs),
  })), [peptides, doseEvents, runs, t])
}

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
