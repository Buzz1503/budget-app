// Body composition: one value per day per measure, a 7-day average for weight,
// and fat and lean mass worked out from what is there.
//
// Priority per measure: a scan entered in the app (DEXA, InBody) beats a manual
// entry, which beats a reading from Health (Withings). The others are kept,
// just not charted. The priority is applied measure by measure, so a manual
// weight on a day the scale also logged body fat keeps both.

import { BODY } from './config'
import { mean, round, isNum } from './stats'
import { addDays, daysBetween } from '../tz'

export type BodySource = 'scan' | 'manual' | 'health'
export const SOURCE_RANK: Record<BodySource, number> = { scan: 3, manual: 2, health: 1 }

export interface BodyReading {
  date: string
  source: BodySource
  sourceLabel?: string | null
  weight?: number | null
  bodyFatPct?: number | null
  leanMass?: number | null
}

export interface BodyDay {
  date: string
  weight: number | null
  weightSource: BodySource | null
  weightLabel: string | null
  bodyFatPct: number | null
  bodyFatSource: BodySource | null
  leanMassReported: number | null
  fatMass: number | null
  leanMass: number | null
}

type Measure = 'weight' | 'bodyFatPct' | 'leanMass'

function best(readings: BodyReading[], key: Measure): BodyReading | null {
  return readings
    .filter((r) => isNum(r[key]))
    .sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source])[0] || null
}

/** One row per date, chosen by priority. */
export function pickDaily(readings: BodyReading[]): BodyDay[] {
  const byDate = new Map<string, BodyReading[]>()
  for (const r of readings) {
    if (!byDate.has(r.date)) byDate.set(r.date, [])
    byDate.get(r.date)!.push(r)
  }
  return [...byDate.keys()].sort().map((date) => {
    const rows = byDate.get(date)!
    const w = best(rows, 'weight')
    const f = best(rows, 'bodyFatPct')
    const l = best(rows, 'leanMass')
    const weight = w ? (w.weight as number) : null
    const fatPct = f ? (f.bodyFatPct as number) : null
    const fatMass = weight != null && fatPct != null ? round(weight * fatPct / 100, 2) : null
    const leanReported = l ? (l.leanMass as number) : null
    return {
      date,
      weight,
      weightSource: w?.source ?? null,
      weightLabel: w ? (w.sourceLabel || null) : null,
      bodyFatPct: fatPct,
      bodyFatSource: f?.source ?? null,
      leanMassReported: leanReported,
      fatMass,
      leanMass: leanReported ?? (weight != null && fatMass != null ? round(weight - fatMass, 2) : null),
    }
  })
}

/** Trailing 7-calendar-day mean of whatever readings fall in the window. */
export function movingAverage(series: Array<{ date: string; value: number | null }>, days: number = BODY.maDays): Array<{ date: string; value: number | null }> {
  const valid = series.filter((p) => isNum(p.value)) as Array<{ date: string; value: number }>
  return series.map((p) => {
    const from = addDays(p.date, -(days - 1))
    const vals = valid.filter((v) => v.date >= from && v.date <= p.date).map((v) => v.value)
    return { date: p.date, value: round(mean(vals), 2) }
  })
}

/**
 * Average change per week over the last four weeks, from the 7-day average:
 * (average now − average 28 days ago) / 4. Null without both ends.
 */
export function weeklyChange(ma: Array<{ date: string; value: number | null }>, date: string, weeks: number = BODY.weeklyChangeWeeks): number | null {
  const at = (d: string) => {
    const hit = [...ma].filter((p) => p.date <= d && p.value != null && daysBetween(p.date, d) <= 3).at(-1)
    return hit ? (hit.value as number) : null
  }
  const now = at(date)
  const then = at(addDays(date, -7 * weeks))
  if (now == null || then == null) return null
  return round((now - then) / weeks, 2)
}
