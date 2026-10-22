import { useMemo } from 'react'
import useStore, { todayStr } from '../store/useStore'
import { doseTimeline, runsFor } from './tenure'
import { displayName } from './naming'
import { cycleEvents } from './due'

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
    trackEffects: p.trackEffects,
    // A cycle going off is a stop and coming back on is a restart, so the
    // effects engine compares the on stretches with the rests either side.
    points: [...doseTimeline(p, { doseEvents, runs, todayStr: t }).points, ...cycleEvents(p, t)]
      .sort((a, b) => a.date.localeCompare(b.date)),
    runs: runsFor(p, runs),
  })), [peptides, doseEvents, runs, t])
}
