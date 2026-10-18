// Tonight's suggested bedtime.
//
//   wake target   the setting, or the median wake time of the last 14 nights
//   sleep target  need + clamp(7-night debt / 4, 0, 60 min)
//                 + 15 min if yesterday's training load was Higher
//   in bed        sleep target / typical efficiency (median of the last 14
//                 nights, kept between 85 % and 95 %)
//   bedtime       wake target − time in bed
//
// The UI says "Aim to be in bed by 21:40" and shows these inputs on tap.

import { PLANNER, SLEEP } from './config'
import { median, clamp } from './stats'
import type { SleepNight } from '../types'
import type { Tz } from '../tz'

export interface PlannerInputs {
  needMin: number
  debtMin: number
  debtAddMin: number
  loadBumpMin: number
  sleepTargetMin: number
  efficiency: number
  inBedMin: number
  wakeMin: number
  wakeFrom: 'setting' | 'history' | 'default'
}

export interface Plan {
  bedtime: string
  wake: string
  inputs: PlannerInputs
}

export const hhmm = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const parseHhmm = (s: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '')
  if (!m) return null
  const v = Number(m[1]) * 60 + Number(m[2])
  return v >= 0 && v < 1440 ? v : null
}

export function planBedtime({
  recent, debtH, needH = SLEEP.defaultNeedH, yesterdayLoad = null, wakeTarget = null, tz,
}: {
  recent: SleepNight[]        // last 14 nights, any order
  debtH: number
  needH?: number
  yesterdayLoad?: 'Lower' | 'Usual' | 'Higher' | null
  wakeTarget?: string | null
  tz: Tz
}): Plan {
  const nights = recent.slice(-PLANNER.lookbackNights)
  const fromSetting = parseHhmm(wakeTarget)
  const historical = median(nights.map((n) => tz.hourOf(n.end) * 60))
  const wakeMin = fromSetting ?? (historical != null ? Math.round(historical) : 7 * 60)
  const wakeFrom: PlannerInputs['wakeFrom'] = fromSetting != null ? 'setting' : historical != null ? 'history' : 'default'

  const needMin = needH * 60
  const debtMin = Math.round(debtH * 60)
  const debtAddMin = Math.round(clamp(debtMin / PLANNER.debtDivisor, 0, PLANNER.debtCapMin))
  const loadBumpMin = yesterdayLoad === 'Higher' ? PLANNER.highLoadBumpMin : 0
  const sleepTargetMin = needMin + debtAddMin + loadBumpMin
  const effs = nights.filter((n) => n.inBedMin > 0).map((n) => n.asleepMin / n.inBedMin)
  const efficiency = clamp(median(effs) ?? PLANNER.efficiencyDefault, PLANNER.efficiencyMin, PLANNER.efficiencyMax)
  const inBedMin = Math.round(sleepTargetMin / efficiency)
  return {
    bedtime: hhmm(wakeMin - inBedMin),
    wake: hhmm(wakeMin),
    inputs: { needMin, debtMin, debtAddMin, loadBumpMin, sleepTargetMin, efficiency: Math.round(efficiency * 1000) / 1000, inBedMin, wakeMin, wakeFrom },
  }
}
