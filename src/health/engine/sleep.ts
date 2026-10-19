// Sleep performance (0–100), consistency and debt.
//
//   55 % duration     asleep / need, capped at 1
//   20 % consistency  SD of bedtime and wake time over the last 7 nights:
//                     0 min = full marks, 90 min or more = none
//   15 % restorative  deep + REM share of time asleep against 40 %, capped
//   10 % efficiency   asleep / in bed: 90 % or more = full marks, 70 % or less = none
//
// A part that cannot be computed (no stages, too few nights for consistency)
// is left out and the others are re-weighted.

import { SLEEP } from './config'
import { sd, clamp, mean } from './stats'
import type { SleepNight } from '../types'
import type { Tz } from '../tz'
import { addDays } from '../tz'

export interface SleepPerformance {
  score: number
  parts: { duration: number; consistency: number | null; restorative: number | null; efficiency: number }
  consistencySdMin: number | null
}

/** Minutes after noon, so a 23:30 bedtime and a 00:30 bedtime sit an hour apart. */
export function clockFromNoon(ms: number, tz: Tz): number {
  const h = tz.hourOf(ms)
  return ((h + 12) % 24) * 60
}

/** Mean of the bedtime SD and the wake-time SD over the given nights, in minutes. */
export function consistencySd(nights: SleepNight[], tz: Tz): number | null {
  if (nights.length < SLEEP.consistencyMinNights) return null
  const bed = sd(nights.map((n) => clockFromNoon(n.start, tz)))
  const wake = sd(nights.map((n) => tz.hourOf(n.end) * 60))
  return mean([bed as number, wake as number])
}

export function sleepPerformance(
  night: SleepNight,
  { recent = [], needH = SLEEP.defaultNeedH, tz }: { recent?: SleepNight[]; needH?: number; tz: Tz },
): SleepPerformance {
  const duration = clamp(night.asleepMin / (needH * 60), 0, 1)
  const eff = night.inBedMin > 0 ? night.asleepMin / night.inBedMin : 0
  const efficiency = clamp((eff - SLEEP.efficiencyZero) / (SLEEP.efficiencyFull - SLEEP.efficiencyZero), 0, 1)
  const restorative = night.hasStages && night.asleepMin > 0
    ? clamp((night.deepMin + night.remMin) / night.asleepMin / SLEEP.restorativeTarget, 0, 1)
    : null
  const sdMin = consistencySd(recent, tz)
  const consistency = sdMin == null ? null : clamp(1 - sdMin / SLEEP.consistencyZeroSdMin, 0, 1)

  const w = SLEEP.weights
  let total = w.duration * duration + w.efficiency * efficiency
  let weight = w.duration + w.efficiency
  if (restorative != null) { total += w.restorative * restorative; weight += w.restorative }
  if (consistency != null) { total += w.consistency * consistency; weight += w.consistency }
  return {
    score: Math.round((100 * total) / weight),
    parts: { duration, consistency, restorative, efficiency },
    consistencySdMin: sdMin,
  }
}

/** The nights in the 7 that end on `date` (inclusive), oldest first. */
export function nightsEnding(nights: Map<string, SleepNight>, date: string, count: number = SLEEP.consistencyNights): SleepNight[] {
  const out: SleepNight[] = []
  for (let i = count - 1; i >= 0; i--) {
    const n = nights.get(addDays(date, -i))
    if (n) out.push(n)
  }
  return out
}

/**
 * Hours short of need over the last 7 nights. A night with no record adds
 * nothing: missing data is not counted as missed sleep.
 */
export function sleepDebtH(nights: Map<string, SleepNight>, date: string, needH: number = SLEEP.defaultNeedH): number {
  return nightsEnding(nights, date, SLEEP.debtNights)
    .reduce((s, n) => s + Math.max(0, needH - n.asleepMin / 60), 0)
}
