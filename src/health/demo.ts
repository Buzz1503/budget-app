// 120 days of believable, made-up Health data, for checking the screens in a
// browser. Deterministic: the same `now` always produces the same data.
//
// Only reachable in a dev build started with VITE_DEMO_HEALTH=1 (see
// src/health/runtime.ts). Production builds never import this file.

import type { HealthBridge, QuantityKey, SumKey } from './bridge'
import type { RawQuantity, RawSleep, RawWorkout, RawBloodPressure, DayValue } from './types'
import type { Tz } from './tz'
import { addDays, dateRange } from './tz'

export const DEMO_DAYS = 120

/** Small seeded PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MIN = 60000
const WATCH = { sourceName: "Buzz's Apple Watch", sourceId: 'com.apple.health.demo-watch' }
const PHONE = { sourceName: "Buzz's iPhone", sourceId: 'com.apple.health.demo-phone' }
const WITHINGS = { sourceName: 'Withings', sourceId: 'com.withings.wiScaleNG' }
const HEVY = { sourceName: 'Hevy', sourceId: 'com.hevy.app' }

interface DemoData {
  quantities: Record<QuantityKey, RawQuantity[]>
  sums: Record<SumKey, DayValue[]>
  sleep: RawSleep[]
  workouts: RawWorkout[]
  bp: RawBloodPressure[]
}

export function generateDemo({ now, tz, days = DEMO_DAYS, seed = 42 }: { now: number; tz: Tz; days?: number; seed?: number }): DemoData {
  const rnd = prng(seed)
  const gauss = () => {
    let u = 0
    let v = 0
    while (u === 0) u = rnd()
    while (v === 0) v = rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const today = tz.dateOf(now)
  const dates = dateRange(addDays(today, -(days - 1)), today)
  const q: DemoData['quantities'] = {
    restingHR: [], heartRate: [], hrv: [], respRate: [], wristTemp: [], spo2: [], vo2max: [],
    weight: [], bodyFat: [], leanMass: [], hrRecovery: [],
  }
  const s: DemoData['sums'] = { steps: [], activeEnergy: [], dietEnergy: [], dietProtein: [], dietWater: [], daylight: [] }
  const sleep: RawSleep[] = []
  const workouts: RawWorkout[] = []
  const bp: RawBloodPressure[] = []
  let weight = 92.4
  let vo2 = 41.5

  dates.forEach((date, i) => {
    const midnight = tz.startOfDay(date)
    const at = (h: number) => midnight + h * 60 * MIN
    const isToday = date === today

    // ---- the night that ends this morning
    const bed = at(-1.6 + gauss() * 0.4) // around 22:25 the evening before
    const asleepH = 7.1 + gauss() * 0.6
    let t = bed + (8 + rnd() * 10) * MIN
    sleep.push({ start: bed, end: t, stage: 'awake', ...WATCH })
    const stages: Array<'core' | 'deep' | 'rem'> = ['core', 'deep', 'core', 'rem']
    let slept = 0
    let k = 0
    while (slept < asleepH * 60) {
      const stage = stages[k % stages.length]
      const len = stage === 'deep' ? 25 + rnd() * 25 : stage === 'rem' ? 18 + rnd() * 22 : 35 + rnd() * 30
      sleep.push({ start: t, end: t + len * MIN, stage, ...WATCH })
      t += len * MIN
      slept += len
      k++
      if (rnd() < 0.18) {
        const wake = (3 + rnd() * 8) * MIN
        sleep.push({ start: t, end: t + wake, stage: 'awake', ...WATCH })
        t += wake
      }
    }
    const wakeAt = t
    sleep.push({ start: bed - 5 * MIN, end: wakeAt + 4 * MIN, stage: 'inBed', ...PHONE })
    // an occasional afternoon nap
    if (rnd() < 0.08) sleep.push({ start: at(14.5), end: at(14.5) + 25 * MIN, stage: 'core', ...WATCH })

    // overnight HRV, resp rate and wrist temperature from the watch
    const hrvBase = 48 + 6 * Math.sin(i / 9) + gauss() * 6
    for (let h = 0; h < 4; h++) {
      const at2 = bed + (60 + h * 90) * MIN
      q.hrv.push({ value: Math.max(15, hrvBase + gauss() * 5), start: at2, end: at2 + MIN, ...WATCH })
    }
    q.hrv.push({ value: Math.max(15, hrvBase - 8 + gauss() * 6), start: at(15), end: at(15) + MIN, ...WATCH })
    q.respRate.push({ value: 14.6 + gauss() * 0.5, start: bed + 120 * MIN, end: bed + 121 * MIN, ...WATCH })
    q.wristTemp.push({ value: 35.6 + gauss() * 0.15, start: bed, end: wakeAt, ...WATCH })
    q.spo2.push({ value: 96 + gauss() * 1.2, start: bed + 200 * MIN, end: bed + 201 * MIN, ...WATCH })
    // heart rate every 10 minutes while asleep, lowest in the middle of the night
    const hrFloor = 50 + 2 * Math.cos(i / 11) + gauss()
    for (let x = bed; x < wakeAt; x += 10 * MIN) {
      const ph = (x - bed) / (wakeAt - bed)
      q.heartRate.push({ value: Math.round(hrFloor + 8 * Math.abs(ph - 0.45) + rnd() * 3), start: x, end: x, ...WATCH })
    }
    if (!isToday || now > at(9)) {
      q.restingHR.push({ value: 56 + 3 * Math.cos(i / 11) + gauss() * 1.6, start: at(8), end: at(8) + MIN, ...WATCH })
    }

    // ---- the day
    const stepCount = Math.round(7500 + gauss() * 2500)
    s.steps.push({ date, value: Math.max(1200, isToday ? stepCount * 0.4 : stepCount) })
    s.activeEnergy.push({ date, value: Math.max(150, 520 + gauss() * 140) })
    s.daylight.push({ date, value: Math.max(5, 55 + gauss() * 25) })
    if (rnd() < 0.6) s.dietProtein.push({ date, value: Math.round(150 + gauss() * 30) })

    // Withings weigh-ins most mornings, drifting down slowly
    weight += -0.04 + gauss() * 0.05
    if (rnd() < 0.75) {
      const w = weight + gauss() * 0.35
      q.weight.push({ value: Math.round(w * 100) / 100, start: at(6.9), end: at(6.9), ...WITHINGS })
      const fat = 21.5 - i * 0.012 + gauss() * 0.6
      q.bodyFat.push({ value: Math.round(fat * 10) / 10, start: at(6.9), end: at(6.9), ...WITHINGS })
      q.leanMass.push({ value: Math.round(w * (1 - fat / 100) * 100) / 100, start: at(6.9), end: at(6.9), ...WITHINGS })
    }
    if (rnd() < 0.2) bp.push({ start: at(7), sys: Math.round(121 + gauss() * 6), dia: Math.round(78 + gauss() * 4), ...WITHINGS })

    // ---- training: Hevy strength Mon/Wed/Fri, watch walks most days
    const dow = new Date(midnight).getUTCDay()
    if ([1, 3, 5].includes(dow) && !(isToday && now < at(18.5))) {
      const start = at(17.5 + rnd() * 0.5)
      const dur = (55 + rnd() * 20) * MIN
      const id = `demo-hevy-${date}`
      workouts.push({ id, type: 'traditionalStrengthTraining', title: ['Push', 'Pull', 'Legs'][[1, 3, 5].indexOf(dow)], start, end: start + dur, durationSec: dur / 1000, energyKcal: 310 + rnd() * 80, ...HEVY })
      // the watch records the same session alongside, with the heart rate
      workouts.push({ id: `demo-watch-${date}`, type: 'traditionalStrengthTraining', title: null, start: start + 2 * MIN, end: start + dur - MIN, durationSec: (dur - 3 * MIN) / 1000, energyKcal: 340 + rnd() * 80, ...WATCH })
      for (let x = 0; x < dur; x += 10000) {
        const ph = x / dur
        const bpm = 105 + 35 * Math.sin(ph * 30) * 0.5 + 20 * ph + gauss() * 6
        q.heartRate.push({ value: Math.round(bpm), start: start + x, end: start + x, ...WATCH })
      }
    }
    if (rnd() < 0.55 && !(isToday && now < at(13))) {
      const start = at(12 + rnd() * 1.5)
      const dur = (30 + rnd() * 25) * MIN
      workouts.push({ id: `demo-walk-${date}`, type: 'walking', title: null, start, end: start + dur, durationSec: dur / 1000, energyKcal: 140 + rnd() * 60, distanceM: 2500 + rnd() * 2000, ...WATCH })
      for (let x = 0; x < dur; x += 10000) {
        q.heartRate.push({ value: Math.round(98 + 12 * (x / dur) + gauss() * 5), start: start + x, end: start + x, ...WATCH })
      }
      q.hrRecovery.push({ value: Math.round(24 + gauss() * 4), start: start + dur + MIN, end: start + dur + 2 * MIN, ...WATCH })
      if (i % 7 === 0) {
        vo2 += 0.05 + gauss() * 0.3
        q.vo2max.push({ value: Math.round(vo2 * 10) / 10, start: start + dur, end: start + dur, ...WATCH })
      }
    }
  })
  return { quantities: q, sums: s, sleep, workouts, bp }
}

/** A HealthBridge that answers from generated data, like the phone would. */
export function demoBridge({ now, tz, days = DEMO_DAYS }: { now: number; tz: Tz; days?: number }): HealthBridge {
  const data = generateDemo({ now, tz, days })
  const inRange = <T extends { start: number }>(rows: T[], a: number, b: number) => rows.filter((r) => r.start >= a && r.start < b)
  return {
    isAvailable: async () => true,
    requestAuthorization: async () => true,
    characteristics: async () => ({ dateOfBirth: '1990-06-15', biologicalSex: 'male' }),
    quantity: async (type, a, b) => inRange(data.quantities[type], a, b),
    dailySum: async (type, a, b) => {
      const from = tz.dateOf(a)
      const to = tz.dateOf(b - 1)
      return data.sums[type].filter((r) => r.date >= from && r.date <= to)
    },
    sleep: async (a, b) => data.sleep.filter((r) => r.end > a && r.start < b),
    workouts: async (a, b) => inRange(data.workouts, a, b),
    bloodPressure: async (a, b) => inRange(data.bp, a, b),
  }
}
