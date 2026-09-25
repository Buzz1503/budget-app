import { SWAPS } from '../data/seed'
import type { Joint, SwapAction } from '../data/types'

const HOLD: SwapAction = { kind: 'hold', label: 'Hold load next session' }
const SKIP: SwapAction = { kind: 'skip', label: 'Skip for the rest of today' }

/**
 * Swap options for an exercise when a joint crosses its limit. Uses the plan's
 * swap rules; anything without one gets hold or skip (approved default).
 */
export function swapOptions(exerciseId: string, joint: Joint): SwapAction[] {
  const rule = SWAPS.find((r) => r.exerciseIds.includes(exerciseId) && r.trigger.joint === joint)
  return rule ? [...rule.steps, SKIP] : [HOLD, SKIP]
}
