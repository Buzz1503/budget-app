import type { Baseline, MorningCheck } from '../data/records'
import { RULES } from '../data/seed'
import type { Comparison, Light } from './types'

export interface MorningComparison {
  knee: Comparison
  wrist: Comparison
}

/**
 * Compare a morning check to baseline. Strict: either knee scoring higher than
 * its own baseline counts as worse (approved: no 1-point leeway). Any wrist
 * swelling counts as worse (24-hour rule: no worse pain or swelling).
 */
export function compareToBaseline(check: MorningCheck, baseline: Baseline): MorningComparison {
  const kneeWorse = check.kneeLeft > baseline.kneeLeft || check.kneeRight > baseline.kneeRight
  const kneeBetter = !kneeWorse && (check.kneeLeft < baseline.kneeLeft || check.kneeRight < baseline.kneeRight)
  const wristWorse = check.wristSwelling || check.wristPain > baseline.wristPain
  const wristBetter = !wristWorse && check.wristPain < baseline.wristPain
  return {
    knee: kneeWorse ? 'worse' : kneeBetter ? 'better' : 'same',
    wrist: wristWorse ? 'worse' : wristBetter ? 'better' : 'same',
  }
}

export interface JointStatus {
  light: Light
  /** One-line plain-English meaning for today. */
  message: string
}

export interface KneeStatusInput {
  check: MorningCheck | null
  baseline: Baseline | null
  /** Highest knee pain logged in the last session, if any. */
  lastSessionPain: number | null
  flareActive: boolean
}

export function kneeStatus({ check, baseline, lastSessionPain, flareActive }: KneeStatusInput): JointStatus {
  if (flareActive) return { light: 'red', message: 'Flare mode: knee isometrics only.' }
  if (check && baseline && compareToBaseline(check, baseline).knee === 'worse') {
    return { light: 'red', message: 'Knee worse than baseline: knee lifts drop 20% and 3 sets today.' }
  }
  const max = check ? Math.max(check.kneeLeft, check.kneeRight) : null
  if (max !== null && max > RULES.painLimit.knee) {
    return { light: 'amber', message: `Knee ${max}/10 this morning: hold knee weights today.` }
  }
  if (lastSessionPain !== null && lastSessionPain > RULES.painLimit.knee) {
    return { light: 'amber', message: `Knee hit ${lastSessionPain}/10 last session: hold knee weights.` }
  }
  if (!check) return { light: 'amber', message: 'Do the morning check to clear knee lifts to progress.' }
  return { light: 'green', message: 'Knee clear: lifts can go up if every rep is clean.' }
}

export interface WristStatusInput {
  check: MorningCheck | null
  baseline: Baseline | null
  lastSessionPain: number | null
}

export function wristStatus({ check, baseline, lastSessionPain }: WristStatusInput): JointStatus {
  if (check && (check.wristSwelling || check.wristPain > RULES.painLimit.wrist)) {
    const why = check.wristSwelling ? 'Swelling today' : `Wrist ${check.wristPain}/10`
    return { light: 'red', message: `${why}: back off gripping work; wrist stage may drop back one.` }
  }
  if (lastSessionPain !== null && lastSessionPain > RULES.painLimit.wrist) {
    return { light: 'amber', message: `Wrist hit ${lastSessionPain}/10 last session: hold gripping loads.` }
  }
  if (check && baseline && compareToBaseline(check, baseline).wrist === 'worse') {
    return { light: 'amber', message: 'Wrist worse than baseline: hold gripping loads today.' }
  }
  if (check && check.wristPain > 2) {
    return { light: 'amber', message: `Wrist ${check.wristPain}/10: fine to train, but it won't count towards the unlock.` }
  }
  if (!check) return { light: 'amber', message: 'Do the morning check to see where the wrist is at.' }
  return { light: 'green', message: 'Wrist clear: counts towards the 14-day unlock.' }
}

const rank: Record<Light, number> = { green: 0, amber: 1, red: 2 }

export function worstLight(...lights: Light[]): Light {
  return lights.reduce<Light>((a, b) => (rank[b] > rank[a] ? b : a), 'green')
}
