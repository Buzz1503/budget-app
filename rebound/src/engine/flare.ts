import type { Baseline, FlareState, ISODate, MorningCheck } from '../data/records'
import { PROGRESSION } from '../data/seed'
import { daysBetween } from './dates'
import { compareToBaseline } from './morning'

/** Two knee-worse mornings in a row (consecutive days) suggests flare mode. */
export function shouldSuggestFlare(checks: MorningCheck[], baseline: Baseline | null): boolean {
  if (!baseline) return false
  const sorted = [...checks].sort((a, b) => a.date.localeCompare(b.date))
  const n = PROGRESSION.knee.flare.badMorningsInARow
  const tail = sorted.slice(-n)
  if (tail.length < n) return false
  for (let i = 1; i < tail.length; i++) {
    const prev = tail[i - 1]
    const cur = tail[i]
    if (!prev || !cur || daysBetween(prev.date, cur.date) !== 1) return false
  }
  return tail.every((c) => compareToBaseline(c, baseline).knee === 'worse')
}

export type FlarePhase =
  | { phase: 'isometric'; day: number; daysLeft: number }
  | { phase: 'restart' }
  | null

/**
 * Flare mode: knee work drops to isometrics only for 3 days, then knee lifts
 * restart at -20% load. Restart stays until the first knee session ends it.
 */
export function flarePhase(flare: FlareState | null, today: ISODate): FlarePhase {
  if (!flare || flare.endedAt) return null
  const days = PROGRESSION.knee.flare.isometricOnlyDays
  const d = daysBetween(flare.startedAt, today)
  if (d < days) return { phase: 'isometric', day: d + 1, daysLeft: days - d }
  return { phase: 'restart' }
}
