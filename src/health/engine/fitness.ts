// VO2 max percentile for age and sex, and "fitness age", from the FRIEND norms.
// Both are estimates and are always labelled as such.

import { VO2_NORMS, PERCENTILES, DECADES } from './vo2Norms'
import type { Sex } from './vo2Norms'
import { mean, round, isNum } from './stats'

export const FITNESS_AGE_MIN = 20
export const FITNESS_AGE_MAX = 80

function decadeIndex(age: number): number {
  const i = DECADES.findIndex((d) => age >= d.from && age <= d.to)
  if (i >= 0) return i
  return age < DECADES[0].from ? 0 : DECADES.length - 1
}

export interface Percentile {
  /** Interpolated percentile, 10 to 90. */
  value: number
  /** Beyond the table's range: below the 10th or above the 90th. */
  bound: 'below' | 'above' | null
}

/** Percentile of a VO2 max for an age and sex, by linear interpolation in the table. */
export function vo2Percentile(vo2: number, age: number, sex: Sex | null | undefined): Percentile | null {
  if (!sex || !isNum(vo2) || !isNum(age)) return null
  const row = VO2_NORMS[sex][decadeIndex(age)]
  if (vo2 < row[0]) return { value: PERCENTILES[0], bound: 'below' }
  if (vo2 > row[row.length - 1]) return { value: PERCENTILES[PERCENTILES.length - 1], bound: 'above' }
  for (let i = 0; i < row.length - 1; i++) {
    if (vo2 >= row[i] && vo2 <= row[i + 1]) {
      const f = (vo2 - row[i]) / (row[i + 1] - row[i] || 1)
      return { value: Math.round(PERCENTILES[i] + f * (PERCENTILES[i + 1] - PERCENTILES[i])), bound: null }
    }
  }
  return null
}

/**
 * The age at which the 50th percentile equals this VO2 max. Interpolated
 * between decade midpoints (25, 35 … 75), extended along the nearest segment
 * beyond them, and clamped to 20–80.
 */
export function fitnessAge(vo2: number, sex: Sex | null | undefined): number | null {
  if (!sex || !isNum(vo2)) return null
  const pts = DECADES.map((d, i) => ({ age: d.mid, v: VO2_NORMS[sex][i][2] })) // 50th, falling with age
  let age: number
  if (vo2 >= pts[0].v) {
    const [a, b] = [pts[0], pts[1]]
    age = a.age + (vo2 - a.v) * (b.age - a.age) / (b.v - a.v)
  } else if (vo2 <= pts[pts.length - 1].v) {
    const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]]
    age = a.age + (vo2 - a.v) * (b.age - a.age) / (b.v - a.v)
  } else {
    const i = pts.findIndex((p, k) => k < pts.length - 1 && vo2 <= p.v && vo2 >= pts[k + 1].v)
    const [a, b] = [pts[i], pts[i + 1]]
    age = a.age + (vo2 - a.v) * (b.age - a.age) / (b.v - a.v)
  }
  return Math.round(Math.min(FITNESS_AGE_MAX, Math.max(FITNESS_AGE_MIN, age)))
}

/** VO2 max readings smoothed as the mean of each reading and the two before it. */
export function smoothVo2(readings: Array<{ date: string; value: number }>): Array<{ date: string; value: number }> {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date))
  return sorted.map((r, i) => ({
    date: r.date,
    value: round(mean(sorted.slice(Math.max(0, i - 2), i + 1).map((x) => x.value)), 1) as number,
  }))
}
