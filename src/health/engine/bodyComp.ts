// Body composition for the Health screens. Which reading counts on a day (scan,
// manual, Withings, other apps) is decided in one place, src/body/bodySeries;
// this keeps the day shape the screens use and the 7-day moving average.

import { BODY } from './config'
import { mean, round, isNum } from './stats'
import { addDays } from '../tz'

export type { BodySource } from '../../body/bodySeries'
import type { BodySource } from '../../body/bodySeries'

/** One day of body composition, every field resolved by src/body/bodySeries. */
export interface BodyDay {
  date: string
  weight: number | null
  weightSource: BodySource | null
  weightLabel: string | null
  bodyFatPct: number | null
  bodyFatSource: BodySource | null
  fatMass: number | null
  leanMass: number | null
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
