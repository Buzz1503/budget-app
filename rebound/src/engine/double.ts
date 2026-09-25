import { PROGRESSION, RULES } from '../data/seed'
import type { Increment, Joint, ProgressionKind, RepRange } from '../data/types'
import { adjustByPct, formatKg, roundToIncrement } from './load'
import { changeLight, type LoggedSet, type SlotSession, type Suggestion } from './types'

export interface DoubleInput {
  progression: Exclude<ProgressionKind, 'kneeHsr' | 'none'>
  /** kg; null = "set on day 1" and none chosen yet. */
  startWeightKg: number | null
  startWeightNote: string | null
  increment: Increment | null
  sets: number
  /** Reps range, or seconds range for holds. */
  range: RepRange
  /** Most recent first. */
  recent: SlotSession[]
}

/** Joints over their limit on any set (knee/wrist > 3, shoulder > 2). */
export function jointsOverLimit(sets: LoggedSet[]): { joint: Joint; pain: number }[] {
  const worst = new Map<Joint, number>()
  for (const s of sets) {
    for (const [j, v] of Object.entries(s.pain) as [Joint, number | undefined][]) {
      if (v !== undefined && v > RULES.painLimit[j]) worst.set(j, Math.max(worst.get(j) ?? 0, v))
    }
  }
  return [...worst].map(([joint, pain]) => ({ joint, pain }))
}

const amount = (s: LoggedSet, timed: boolean) => (timed ? s.holdSec : s.reps) ?? 0

function belowBottom(session: SlotSession, min: number, timed: boolean): boolean {
  return session.sets.length > 0 && session.sets.some((s) => amount(s, timed) < min)
}

/**
 * Double progression (Section 9): add reps within the range, then weight.
 * Bodyweight moves ('reps', 'hold') progress the target by their increment.
 */
export function nextDouble(input: DoubleInput): Suggestion {
  const { recent, range, sets, increment, progression } = input
  const timed = progression === 'hold'
  const last = recent[0]
  const unit = timed ? 'sec' : 'reps'

  const base = {
    status: 'ready' as const,
    sets,
    holdSec: null as number | null,
    painFlag: false,
  }
  const weighted = (weightKg: number | null, target: RepRange, change: Suggestion['change'], reason: string, painFlag = false): Suggestion => ({
    ...base,
    weightKg,
    reps: target,
    change,
    light: changeLight[change],
    reason,
    painFlag,
  })

  if (progression !== 'double') {
    // Bodyweight: the target itself moves (e.g. dead bug +2 reps, side plank +5 sec).
    const step = increment?.amount ?? 0
    const lastTarget = last?.target ?? range.min
    const t = (n: number): RepRange => ({ min: n, max: n })
    const out = (target: number, change: Suggestion['change'], reason: string, painFlag = false): Suggestion => ({
      ...weighted(input.startWeightKg ?? 0, timed ? t(0) : t(target), change, reason, painFlag),
      holdSec: timed ? target : null,
    })
    if (!last) return out(range.min, 'start', `Start at ${range.min} ${unit} per set.`)
    const over = jointsOverLimit(last.sets)
    if (over.length) return out(lastTarget, 'hold', `Hold at ${lastTarget} ${unit}: ${painText(over)} last time.`, true)
    const hit = last.sets.length >= sets && last.sets.every((s) => amount(s, timed) >= lastTarget)
    if (hit && step > 0) return out(lastTarget + step, 'up', `Up ${step} ${unit}: every set hit ${lastTarget}.`)
    return out(lastTarget, 'hold', `Hold at ${lastTarget} ${unit}: aim to hit it on every set.`)
  }

  const inc = increment?.unit === 'kg' ? increment.amount : 0
  const lastWeight = last?.weightKg ?? null

  if (!last || lastWeight === null) {
    if (input.startWeightKg === null) {
      return {
        ...weighted(null, range, 'start', `${input.startWeightNote ?? 'Set on day 1'}: pick a weight that leaves 2 to 3 reps in reserve.`),
        status: 'needsWeight',
      }
    }
    return weighted(input.startWeightKg, range, 'start', `Starting weight: ${formatKg(input.startWeightKg)}.`)
  }

  const over = jointsOverLimit(last.sets)
  if (over.length) {
    return weighted(lastWeight, range, 'hold', `Hold ${formatKg(lastWeight)}: ${painText(over)} last time. Swap available.`, true)
  }

  const topHit =
    last.sets.length >= sets && last.sets.every((s) => (s.reps ?? 0) >= range.max && (s.rir ?? -1) >= PROGRESSION.double.minRir)
  if (topHit && inc > 0) {
    const w = roundToIncrement(lastWeight + inc, inc)
    return weighted(w, { min: range.min, max: range.max }, 'up', `Up ${formatKg(inc)}: all sets hit ${range.max} with 2+ in reserve. Back to ${range.min} reps.`)
  }

  const missRun = recent.slice(0, PROGRESSION.double.missBottomSessionsInARow)
  if (missRun.length === PROGRESSION.double.missBottomSessionsInARow && missRun.every((s) => belowBottom(s, range.min, false))) {
    const w = adjustByPct(lastWeight, PROGRESSION.double.missBottomLoadPct, inc || 0.5)
    return weighted(w, range, 'down', `Down 10%: under ${range.min} reps two sessions running.`)
  }

  const lowest = Math.min(...last.sets.map((s) => s.reps ?? 0))
  const aim = Math.min(range.max, Math.max(range.min, lowest + 1))
  return weighted(lastWeight, { min: aim, max: range.max }, 'hold', `Hold ${formatKg(lastWeight)}: add reps until every set hits ${range.max}. Aim for ${aim}+.`)
}

function painText(over: { joint: Joint; pain: number }[]): string {
  return over.map((o) => `${o.joint} ${o.pain}/10`).join(', ')
}
