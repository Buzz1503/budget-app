// Nightmare detection. An estimate: Apple Watch samples heart rate every few
// minutes in sleep, so short events can be missed entirely.
//
// An event is a heart rate surge of 15 bpm or more above the night's rolling
// sleeping baseline, rising within 2 minutes and lasting at least 1 minute.
// It scores higher when it happens during or right after REM, is followed by
// an awake stretch within 5 minutes, comes with a burst of wrist movement, or
// the night's breathing rate was above its usual. The strongest event rates
// the night: Unlikely, Possible or Likely. Your morning answers (Nightmare,
// Vivid) are the ground truth: agreement is shown, and from 10 confirmed
// nights the thresholds are fitted to you.

import type { SleepSegment } from '../health/types'

export const NIGHTMARE_LABEL = 'Estimate'
export const HR_NOTE = 'Apple Watch samples overnight heart rate every few minutes, so short events can be missed.'

export const NIGHTMARES = {
  surgeBpm: 15,
  riseWithinMin: 2,
  nearBaseline: 5, // the reading before a sharp rise sits within 5 bpm of the baseline
  lastMin: 1,
  baselineMin: 30, // the rolling baseline: median of the 30 minutes before
  remWindowMin: 5,
  awakeWithinMin: 5,
  movementShare: 0.3, // a movement burst: 30% or more of a minute moving
  possible: 2,
  likely: 3,
  calibrateFrom: 10,
}

export interface NightmareEvent {
  /** epoch ms of the surge */
  t: number
  /** bpm above the baseline at its peak */
  surge: number
  durationMin: number
  rem: boolean
  awakeAfter: boolean
  movement: boolean
  breathing: boolean
  score: number
}

export type NightRating = 'Unlikely' | 'Possible' | 'Likely'

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Events in one night. `hr` is [minutes from the night's start, bpm];
 * `movement` the Watch's share of each minute moving, from `movementStart`.
 */
export function detectEvents(input: {
  start: number
  hr: Array<[number, number]>
  segments?: SleepSegment[]
  movement?: number[] | null
  movementStart?: number | null
  respAboveUsual?: boolean | null
}): NightmareEvent[] {
  const { hr, start } = input
  const segs = input.segments || []
  const at = (m: number) => start + m * 60000
  const stageAt = (t: number) => segs.find((s) => s.start <= t && s.end > t)?.stage
  const events: NightmareEvent[] = []
  let i = 0
  while (i < hr.length) {
    const [m, bpm] = hr[i]
    const before = hr.filter(([x]) => x < m && x >= m - NIGHTMARES.baselineMin).map(([, b]) => b)
    if (before.length < 3) { i++; continue }
    const base = median(before)
    if (bpm < base + NIGHTMARES.surgeBpm) { i++; continue }
    // rising within 2 minutes: a reading near the baseline (under 5 above it) no more than 2 minutes before
    const prior = hr.slice(0, i).filter(([x]) => m - x <= NIGHTMARES.riseWithinMin && x < m)
    if (!prior.some(([, b]) => b < base + NIGHTMARES.nearBaseline)) { i++; continue }
    // lasting: consecutive readings above the threshold
    let j = i
    let peak = bpm
    while (j + 1 < hr.length && hr[j + 1][1] >= base + NIGHTMARES.surgeBpm && hr[j + 1][0] - hr[j][0] <= 2) { j++; peak = Math.max(peak, hr[j][1]) }
    const duration = hr[j][0] - m
    if (duration < NIGHTMARES.lastMin) { i = j + 1; continue }
    const t = at(m)
    const remBefore = segs.some((s) => s.stage === 'rem' && s.start <= t && s.end >= t - NIGHTMARES.remWindowMin * 60000)
    const rem = stageAt(t) === 'rem' || remBefore
    const awakeAfter = segs.some((s) => s.stage === 'awake' && s.start >= t && s.start <= t + NIGHTMARES.awakeWithinMin * 60000)
    let movement = false
    if (input.movement?.length && input.movementStart != null) {
      const k = Math.floor((t - input.movementStart) / 60000)
      for (let d = -2; d <= 2; d++) if ((input.movement[k + d] ?? 0) >= NIGHTMARES.movementShare) movement = true
    }
    const breathing = !!input.respAboveUsual
    const surge = Math.round(peak - base)
    const score = Math.round((1 + (rem ? 1 : 0) + (awakeAfter ? 1 : 0) + (movement ? 1 : 0) + (breathing ? 0.5 : 0)
      + Math.min(1, (surge - NIGHTMARES.surgeBpm) / NIGHTMARES.surgeBpm)) * 10) / 10
    events.push({ t, surge, durationMin: duration, rem, awakeAfter, movement, breathing, score })
    i = j + 1
  }
  return events
}

/** The night's rating from its strongest event (thresholds fitted to you once calibrated). */
export function rateNight(events: NightmareEvent[], thresholds = { possible: NIGHTMARES.possible, likely: NIGHTMARES.likely }): NightRating {
  const top = Math.max(0, ...events.map((e) => e.score))
  return top >= thresholds.likely ? 'Likely' : top >= thresholds.possible ? 'Possible' : 'Unlikely'
}

/** A morning answer as ground truth: Nightmare or Vivid is yes, None or Normal is no. */
export const truthOf = (dreams: string | null | undefined): boolean | null =>
  dreams === 'nightmare' || dreams === 'vivid' ? true : dreams === 'none' || dreams === 'normal' ? false : null

/** How often the estimate matched your answer: Possible or Likely counts as yes. */
export function agreement(nights: Array<{ rating: NightRating; truth: boolean | null }>) {
  const answered = nights.filter((n) => n.truth != null)
  const matched = answered.filter((n) => (n.rating !== 'Unlikely') === n.truth).length
  return { matched, of: answered.length, text: answered.length ? `Matched your answer on ${matched} of ${answered.length} nights` : null }
}

/** Features of a night's strongest event for the personal fit (zeros without an event). */
export function eventFeatures(events: NightmareEvent[]): number[] {
  const e = [...events].sort((a, b) => b.score - a.score)[0]
  return e ? [Math.min(2, e.surge / NIGHTMARES.surgeBpm), e.rem ? 1 : 0, e.awakeAfter ? 1 : 0, e.movement ? 1 : 0, e.breathing ? 1 : 0] : [0, 0, 0, 0, 0]
}

/** Logistic regression by gradient descent with a small L2 penalty; deterministic. */
export function logisticFit(X: number[][], y: number[], { iterations = 2000, rate = 0.3, l2 = 0.01 } = {}) {
  const p = X[0]?.length ?? 0
  const w = new Array(p).fill(0)
  let b = 0
  const n = y.length
  for (let it = 0; it < iterations; it++) {
    const gw = new Array(p).fill(0)
    let gb = 0
    for (let i = 0; i < n; i++) {
      let z = b
      for (let j = 0; j < p; j++) z += w[j] * X[i][j]
      const err = 1 / (1 + Math.exp(-z)) - y[i]
      gb += err
      for (let j = 0; j < p; j++) gw[j] += err * X[i][j]
    }
    b -= (rate * gb) / n
    for (let j = 0; j < p; j++) w[j] -= rate * (gw[j] / n + l2 * w[j])
  }
  const predict = (x: number[]) => 1 / (1 + Math.exp(-(b + x.reduce((s, v, j) => s + v * w[j], 0))))
  return { w, b, predict }
}

/**
 * Personal ratings once 10 or more nights are confirmed by your answers:
 * a logistic fit on the strongest event's features; Likely from 60%,
 * Possible from 30%. Before that, the fixed score thresholds.
 */
export function calibrate(nights: Array<{ events: NightmareEvent[]; truth: boolean | null }>) {
  const known = nights.filter((n) => n.truth != null)
  const confirmed = known.filter((n) => n.truth).length
  if (confirmed < NIGHTMARES.calibrateFrom || known.length - confirmed < NIGHTMARES.calibrateFrom) {
    return { personal: false as const, confirmed, rate: (events: NightmareEvent[]) => rateNight(events) }
  }
  const fit = logisticFit(known.map((n) => eventFeatures(n.events)), known.map((n) => (n.truth ? 1 : 0)))
  return {
    personal: true as const,
    confirmed,
    rate: (events: NightmareEvent[]): NightRating => {
      const p = fit.predict(eventFeatures(events))
      return p >= 0.6 ? 'Likely' : p >= 0.3 ? 'Possible' : 'Unlikely'
    },
  }
}
