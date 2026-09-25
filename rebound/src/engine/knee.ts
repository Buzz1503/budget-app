import type { ISODate } from '../data/records'
import { KNEE_STAGE2_BLOCKS, PROGRESSION, RULES } from '../data/seed'
import type { KneeRepBlock } from '../data/types'
import { daysBetween } from './dates'
import { adjustByPct, formatKg, roundToIncrement } from './load'
import { changeLight, type Comparison, type SlotSession, type Suggestion } from './types'

/** Stage 2 week number (1-based) for a date. Week 1 starts on stage2Start. */
export function stage2Week(stage2Start: ISODate, today: ISODate): number {
  return Math.max(1, Math.floor(daysBetween(stage2Start, today) / 7) + 1)
}

/** Sets x reps for a Stage 2 week. After week 12 it stays at the last block. */
export function repBlockForWeek(week: number): KneeRepBlock {
  const found = KNEE_STAGE2_BLOCKS.find((b) => week >= b.weeks.min && week <= b.weeks.max)
  const last = KNEE_STAGE2_BLOCKS[KNEE_STAGE2_BLOCKS.length - 1]
  if (!last) throw new Error('No knee Stage 2 blocks')
  return found ?? (week < 1 ? (KNEE_STAGE2_BLOCKS[0] ?? last) : last)
}

/** e.g. "Heavy slow resistance, week 3 of 12: 3 x 12". */
export function stage2Label(week: number): string {
  const b = repBlockForWeek(week)
  return `Heavy slow resistance, week ${Math.min(week, 12)} of 12: ${b.sets} x ${b.reps}`
}

export type KneeFlare =
  | { phase: 'isometric'; daysLeft: number }
  | { phase: 'restart'; preFlareWeightKg: number | null }
  | null

export interface KneeLiftInput {
  name: string
  startWeightKg: number
  incrementKg: number
  /** Stage 2 week of the upcoming session. */
  week: number
  /** Stage 2 week the last session was done in. */
  lastWeek: number | null
  last: SlotSession | null
  /** Latest morning check vs baseline (knee). null = no check yet. */
  morning: Comparison | null
  flare: KneeFlare
}

interface KneeCheck {
  allReps: boolean
  lastSetRir: boolean
  pain: boolean
  morning: boolean
  maxPain: number
}

export function kneeCriteria(last: SlotSession, morning: Comparison | null): KneeCheck {
  const sets = last.sets
  const lastSet = sets[sets.length - 1]
  const maxPain = Math.max(0, ...sets.map((s) => s.pain.knee ?? 0))
  return {
    allReps: sets.length > 0 && sets.every((s) => (s.reps ?? 0) >= last.target),
    lastSetRir: (lastSet?.rir ?? -1) >= PROGRESSION.knee.minLastSetRir,
    pain: maxPain <= PROGRESSION.knee.maxPain,
    morning: morning === 'same' || morning === 'better',
    maxPain,
  }
}

function failedReasons(c: KneeCheck, morning: Comparison | null, target: number): string[] {
  const out: string[] = []
  if (!c.allReps) out.push(`not every set hit ${target}`)
  if (!c.lastSetRir) out.push('last set under 2 in reserve')
  if (!c.pain) out.push(`knee pain ${c.maxPain}/10`)
  if (!c.morning) out.push(morning === null ? 'no morning check yet' : 'knee check not clear')
  return out
}

/** Next-session prescription for leg extension and leg press (Section 9). */
export function nextKneeLift(input: KneeLiftInput): Suggestion {
  const { flare, week, last, morning, incrementKg } = input
  const block = repBlockForWeek(week)
  const reps = { min: block.reps, max: block.reps }
  const make = (weightKg: number | null, change: Suggestion['change'], reason: string, sets = block.sets): Suggestion => ({
    status: 'ready',
    weightKg,
    sets,
    reps,
    holdSec: null,
    change,
    light: changeLight[change],
    reason,
    painFlag: false,
  })

  if (flare?.phase === 'isometric') {
    const d = flare.daysLeft
    return {
      ...make(null, 'down', `Flare mode: isometrics only, knee lifts back in ${d} day${d === 1 ? '' : 's'}.`),
      status: 'paused',
    }
  }

  if (flare?.phase === 'restart') {
    const base = flare.preFlareWeightKg ?? last?.weightKg ?? input.startWeightKg
    const w = adjustByPct(base, PROGRESSION.knee.flare.restartLoadPct, incrementKg)
    return make(w, 'down', `Flare restart: 20% under pre-flare ${formatKg(base)}.`)
  }

  if (!last || last.weightKg === null) {
    return make(input.startWeightKg, 'start', `Starting weight from your plan: ${formatKg(input.startWeightKg)}.`)
  }

  const prev = last.weightKg

  if (morning === 'worse') {
    const w = adjustByPct(prev, PROGRESSION.knee.badMorning.loadPct, incrementKg)
    return make(w, 'down', `Down 20% and 3 sets: morning knee check worse than baseline.`, PROGRESSION.knee.badMorning.sets)
  }

  const c = kneeCriteria(last, morning)
  const met = c.allReps && c.lastSetRir && c.pain && c.morning
  const lastBlock = input.lastWeek === null ? null : repBlockForWeek(input.lastWeek)
  const newBlock = lastBlock !== null && lastBlock.reps !== block.reps

  if (!met) {
    const why = failedReasons(c, morning, last.target).join(', ')
    const blockNote = newBlock ? ` New block ${block.sets} x ${block.reps}.` : ''
    return make(prev, 'hold', `Hold ${formatKg(prev)}: ${why}.${blockNote}`)
  }

  const painText = `pain ${c.maxPain}/10`
  if (newBlock) {
    const raised = adjustByPct(prev, PROGRESSION.knee.blockChangeLoadPct, incrementKg)
    const w = Math.max(raised, roundToIncrement(prev + incrementKg, incrementKg))
    return make(w, 'up', `Up ${formatKg(w - prev)} (about 8%): new block ${block.sets} x ${block.reps}, all reps hit, ${painText}, knee check clear.`)
  }
  const w = roundToIncrement(prev + incrementKg, incrementKg)
  return make(w, 'up', `Up ${formatKg(incrementKg)}: all reps hit, ${painText}, knee check clear.`)
}

export const KNEE_PAIN_LIMIT = RULES.painLimit.knee
