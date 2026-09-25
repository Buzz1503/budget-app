import type { Baseline, DeclineSquatTest, ISODate, MorningCheck } from '../data/records'
import { PROGRESSION } from '../data/seed'
import { addDays, daysBetween } from './dates'
import { compareToBaseline } from './morning'

export interface WristDay {
  date: ISODate
  maxPain: number
  swelling: boolean
}

/** Merge morning checks and session wrist pain into one worst-of record per day. */
export function wristDays(checks: MorningCheck[], sessionPain: { date: ISODate; pain: number }[]): WristDay[] {
  const byDate = new Map<ISODate, WristDay>()
  const get = (date: ISODate) => byDate.get(date) ?? { date, maxPain: 0, swelling: false }
  for (const c of checks) {
    const d = get(c.date)
    byDate.set(c.date, { date: c.date, maxPain: Math.max(d.maxPain, c.wristPain), swelling: d.swelling || c.wristSwelling })
  }
  for (const p of sessionPain) {
    const d = get(p.date)
    byDate.set(p.date, { ...d, maxPain: Math.max(d.maxPain, p.pain) })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export interface WristGate {
  /** Consecutive qualifying days up to today. */
  streak: number
  target: number
  eligible: boolean
  regress: boolean
  regressReason: string | null
}

/**
 * Wrist gate (Section 3): advance after 14 days in a row at pain 2/10 or less
 * with no swelling; drop back one if pain goes above 3/10 or swelling appears.
 * Today counts if it has a record; a day with no record breaks the streak.
 */
export function wristGate(days: WristDay[], today: ISODate): WristGate {
  const g = PROGRESSION.gates.wrist
  const byDate = new Map(days.map((d) => [d.date, d]))
  let cursor = byDate.has(today) ? today : addDays(today, -1)
  let streak = 0
  for (;;) {
    const d = byDate.get(cursor)
    if (!d || d.swelling || d.maxPain > g.maxPain) break
    streak++
    cursor = addDays(cursor, -1)
  }
  const latest = byDate.get(today) ?? byDate.get(addDays(today, -1)) ?? null
  let regressReason: string | null = null
  if (latest?.swelling) regressReason = 'Swelling reported'
  else if (latest && latest.maxPain > g.regressAbovePain) regressReason = `Wrist pain ${latest.maxPain}/10`
  return { streak, target: g.consecutiveDays, eligible: streak >= g.consecutiveDays, regress: regressReason !== null, regressReason }
}

export interface Criterion {
  label: string
  met: boolean
  /** 0..1 */
  progress: number
  detail: string
}

export interface KneeStage3Input {
  today: ISODate
  stage2Start: ISODate | null
  declineSquat: DeclineSquatTest | null
  /** Dates of completed leg press sessions at 4 x 6 with every rep hit. */
  legPress4x6Dates: ISODate[]
  checks: MorningCheck[]
  baseline: Baseline | null
}

/** Knee Stage 3 gate (Section 3). */
export function kneeStage3Gate(input: KneeStage3Input): { criteria: Criterion[]; allMet: boolean } {
  const g = PROGRESSION.gates.kneeStage3
  const days = input.stage2Start ? Math.max(0, daysBetween(input.stage2Start, input.today)) : 0
  const weeks = Math.floor(days / 7)
  const c1: Criterion = {
    label: `${g.minStage2Weeks}+ weeks of Stage 2`,
    met: weeks >= g.minStage2Weeks,
    progress: Math.min(1, days / (g.minStage2Weeks * 7)),
    detail: `${weeks} of ${g.minStage2Weeks} weeks`,
  }

  const ds = input.declineSquat
  const c2: Criterion = {
    label: `Single-leg decline squat pain ${g.maxDeclineSquatPain}/10 or less`,
    met: ds !== null && ds.pain <= g.maxDeclineSquatPain,
    progress: ds === null ? 0 : ds.pain <= g.maxDeclineSquatPain ? 1 : 0,
    detail: ds === null ? 'Not tested yet' : `Last test ${ds.pain}/10 on ${ds.date}`,
  }

  const first4x6 = [...input.legPress4x6Dates].sort()[0] ?? null
  let clearDays = 0
  if (first4x6 && input.baseline) {
    const baseline = input.baseline
    const lastWorse = input.checks
      .filter((c) => c.date >= first4x6 && c.date <= input.today && compareToBaseline(c, baseline).knee === 'worse')
      .map((c) => c.date)
      .sort()
      .pop()
    const from = lastWorse ? addDays(lastWorse, 1) : first4x6
    clearDays = Math.max(0, daysBetween(from, input.today) + 1)
  }
  const c3: Criterion = {
    label: `Leg press ${g.legPressBlock.sets} x ${g.legPressBlock.reps} with no morning flare for 2 weeks`,
    met: clearDays >= g.noMorningFlareDays,
    progress: Math.min(1, clearDays / g.noMorningFlareDays),
    detail: first4x6 ? `${Math.min(clearDays, g.noMorningFlareDays)} of ${g.noMorningFlareDays} days` : 'No 4 x 6 leg press yet',
  }

  const criteria = [c1, c2, c3]
  return { criteria, allMet: criteria.every((c) => c.met) }
}
