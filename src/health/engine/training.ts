// Training load from heart rate, and the sessions it is counted over.
//
// Max HR: a setting; default 208 − 0.7 × age (Tanaka), 190 when age is unknown.
// Edwards TRIMP: minutes in each zone (50–60 / 60–70 / 70–80 / 80–90 / 90+ %
// of max HR) weighted 1 to 5. Daily load is the sum over that day's sessions.
// Load vs usual: 7-day mean daily load / 28-day mean daily load. A description
// of volume, never a risk score.

import { TRAINING } from './config'
import { mean } from './stats'
import type { HealthWorkout } from '../types'
import { addDays, daysBetween } from '../tz'

export function ageOn(dateOfBirth: string | null | undefined, date: string): number | null {
  if (!dateOfBirth) return null
  const [by, bm, bd] = dateOfBirth.split('-').map(Number)
  const [y, m, d] = date.split('-').map(Number)
  let age = y - by
  if (m < bm || (m === bm && d < bd)) age--
  return age >= 0 && age < 120 ? age : null
}

export function defaultMaxHR(age: number | null): number {
  return age == null ? TRAINING.maxHRFallback : Math.round(208 - 0.7 * age)
}

/** Minutes in zones 1–5. Each sample counts until the next one (at most two minutes). */
export function zoneMinutes(series: Array<[number, number]>, maxHR: number): number[] {
  const zones = [0, 0, 0, 0, 0]
  for (let i = 0; i < series.length; i++) {
    const [t, bpm] = series[i]
    const next = series[i + 1]?.[0]
    const dt = next == null ? 0 : Math.min(next - t, TRAINING.maxSampleGapSec)
    if (dt <= 0) continue
    const frac = bpm / maxHR
    let z = -1
    for (let k = TRAINING.zoneFloors.length - 1; k >= 0; k--) {
      if (frac >= TRAINING.zoneFloors[k]) { z = k; break }
    }
    if (z >= 0) zones[z] += dt / 60
  }
  return zones.map((m) => Math.round(m * 10) / 10)
}

export function trimp(zones: number[]): number {
  return Math.round(zones.reduce((s, m, i) => s + m * TRAINING.zoneWeights[i], 0) * 10) / 10
}

const isHevy = (w: HealthWorkout) => /hevy/i.test(w.sourceName) || /hevy/i.test(w.sourceId)

/**
 * One session per real session. Records overlapping by more than half of the
 * shorter one are the same session written by two apps (Hevy and the Watch):
 * the title comes from Hevy, the heart rate and energy from whichever record
 * has heart rate.
 */
export function dedupeWorkouts(workouts: HealthWorkout[]): Array<HealthWorkout & { mergedIds: string[] }> {
  const sorted = [...workouts].sort((a, b) => a.start - b.start)
  const groups: HealthWorkout[][] = []
  for (const w of sorted) {
    const g = groups.find((grp) => grp.some((x) => {
      const overlap = Math.min(x.end, w.end) - Math.max(x.start, w.start)
      const shorter = Math.min(x.end - x.start, w.end - w.start)
      return shorter > 0 && overlap > TRAINING.dedupeOverlap * shorter
    }))
    if (g) g.push(w)
    else groups.push([w])
  }
  return groups.map((g) => {
    if (g.length === 1) return { ...g[0], mergedIds: [g[0].id] }
    const withHr = g.find((w) => w.hrSeries.length) || g.find((w) => w.avgHR != null) || g[0]
    const hevy = g.find(isHevy)
    return {
      ...withHr,
      title: hevy?.title || withHr.title,
      type: hevy?.type || withHr.type,
      energyKcal: withHr.energyKcal ?? g.find((w) => w.energyKcal != null)?.energyKcal ?? null,
      hrRecovery: g.find((w) => w.hrRecovery != null)?.hrRecovery ?? null,
      mergedIds: g.map((w) => w.id),
    }
  })
}

export interface Session extends HealthWorkout {
  mergedIds: string[]
  zones: number[]
  trimp: number
}

export function sessionsWithLoad(workouts: HealthWorkout[], maxHR: number): Session[] {
  return dedupeWorkouts(workouts).map((w) => {
    const zones = zoneMinutes(w.hrSeries, maxHR)
    return { ...w, zones, trimp: trimp(zones) }
  })
}

/** TRIMP per date. */
export function dailyLoad(sessions: Session[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of sessions) out.set(s.date, Math.round(((out.get(s.date) || 0) + s.trimp) * 10) / 10)
  return out
}

export interface LoadVsUsual {
  ratio: number | null
  label: 'Lower' | 'Usual' | 'Higher' | null
  acute: number
  chronic: number
}

/** 7-day mean daily load over 28-day mean daily load, days without training counted as 0. */
export function loadVsUsual(load: Map<string, number>, date: string, { firstDate }: { firstDate?: string } = {}): LoadVsUsual {
  const meanOver = (days: number) => {
    let sum = 0
    for (let i = 0; i < days; i++) sum += load.get(addDays(date, -i)) || 0
    return sum / days
  }
  const acute = meanOver(TRAINING.acuteDays)
  const chronic = meanOver(TRAINING.chronicDays)
  // without four weeks of history the "usual" is not known yet
  if (firstDate && daysBetween(firstDate, date) < TRAINING.chronicDays - 1) return { ratio: null, label: null, acute, chronic }
  if (chronic <= 0) return { ratio: null, label: null, acute, chronic }
  const ratio = Math.round((acute / chronic) * 100) / 100
  const label = ratio < TRAINING.lowerBelow ? 'Lower' : ratio > TRAINING.higherAbove ? 'Higher' : 'Usual'
  return { ratio, label, acute, chronic }
}

export interface WeekMean {
  weekStart: string
  mean: number | null
  n: number
}

/** Weekly mean of one value over the last `weeks` weeks, oldest first. Weeks start Monday. */
export function weeklyMeans<T>(rows: T[], date: string, pick: (r: T) => { date: string; value: number | null }, weeks: number = TRAINING.hrrWeeks): WeekMean[] {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  const thisMonday = addDays(date, -dow)
  const out: WeekMean[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(thisMonday, -7 * w)
    const end = addDays(start, 6)
    const vals = rows.map(pick).filter((r) => r.date >= start && r.date <= end && r.value != null).map((r) => r.value as number)
    const m = mean(vals)
    out.push({ weekStart: start, mean: m == null ? null : Math.round(m * 10) / 10, n: vals.length })
  }
  return out
}
