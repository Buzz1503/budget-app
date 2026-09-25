import type { SessionItem } from '../data/types'

/**
 * Load-tracking key. Knee lifts share one track across sessions; other lifts
 * track per rep range (approved: heavy and volume days progress apart).
 */
export function slotKey(item: Pick<SessionItem, 'exerciseId' | 'prescription'>): string {
  const p = item.prescription
  switch (p.kind) {
    case 'kneeStage':
      return `${item.exerciseId}:knee`
    case 'fixed':
    case 'holdReps':
      return `${item.exerciseId}:${p.reps.min}-${p.reps.max}`
    case 'timed':
      return `${item.exerciseId}:${p.holdSec.min}-${p.holdSec.max}s`
    case 'duration':
      return `${item.exerciseId}:${p.minutes.min}-${p.minutes.max}min`
  }
}
