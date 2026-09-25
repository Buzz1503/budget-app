import type { Milestone, MuscleGroup, PerformanceMark } from '../data/types'
import { estimatedOneRepMax } from './load'

/** Progress towards a milestone: best set's estimated strength vs the target's, capped at 1. */
export function milestoneProgress(m: Milestone, sets: PerformanceMark[]): { achieved: boolean; progress: number } {
  const achieved = sets.some((s) => s.weightKg >= m.target.weightKg && s.reps >= m.target.reps)
  if (achieved) return { achieved, progress: 1 }
  const target = estimatedOneRepMax(m.target.weightKg, m.target.reps)
  const best = Math.max(0, ...sets.map((s) => estimatedOneRepMax(s.weightKg, s.reps)))
  return { achieved, progress: target > 0 ? Math.min(0.99, best / target) : 0 }
}

/** Best set by estimated one-rep max. */
export function bestSet(sets: PerformanceMark[]): PerformanceMark | null {
  let best: PerformanceMark | null = null
  for (const s of sets) {
    if (!best || estimatedOneRepMax(s.weightKg, s.reps) > estimatedOneRepMax(best.weightKg, best.reps)) best = s
  }
  return best
}

/** Hard sets per muscle group: each completed set counts once for each muscle the exercise trains. */
export function setsPerMuscle(entries: { muscles: MuscleGroup[]; sets: number }[]): Partial<Record<MuscleGroup, number>> {
  const out: Partial<Record<MuscleGroup, number>> = {}
  for (const e of entries) for (const m of e.muscles) out[m] = (out[m] ?? 0) + e.sets
  return out
}
