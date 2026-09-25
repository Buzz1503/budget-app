import type { Joint, RepRange } from '../data/types'

/** Green = progress, amber = hold, red = back off. */
export type Light = 'green' | 'amber' | 'red'

export type Change = 'up' | 'hold' | 'down' | 'start'

export type Comparison = 'better' | 'same' | 'worse'

export interface LoggedSet {
  weightKg: number | null
  reps: number | null
  holdSec: number | null
  rir: number | null
  pain: Partial<Record<Joint, number>>
}

/** One past session of one exercise slot. */
export interface SlotSession {
  date: string
  weightKg: number | null
  /** Target reps (or seconds) that session aimed for. */
  target: number
  sets: LoggedSet[]
}

export interface Suggestion {
  status: 'ready' | 'needsWeight' | 'paused'
  weightKg: number | null
  sets: number
  /** Reps to aim for this session (a single number for knee lifts). */
  reps: RepRange
  holdSec: number | null
  change: Change
  light: Light
  /** Plain-English reason shown on the exercise card. */
  reason: string
  /** Last session crossed a pain limit: hold load and surface the swap. */
  painFlag: boolean
}

export const changeLight: Record<Change, Light> = { up: 'green', start: 'green', hold: 'amber', down: 'red' }
