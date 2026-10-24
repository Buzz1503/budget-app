// One row per night for the analysis: every factor (from logging, Health, the
// Watch, Sleep sounds and Screen Time) and every outcome. A value nobody
// recorded is null and is left out of whatever needs it.

import type { NightFeatures } from '../features'
import type { MorningCheck } from '../logging'
import type { SoundsNight } from '../sounds'

export type OutcomeKey =
  | 'sleepScore' | 'totalSleep' | 'deep' | 'rem' | 'awake' | 'awakenings'
  | 'hrLow' | 'hrAvg' | 'hrv' | 'rhrNext' | 'readinessNext'
  | 'restlessness' | 'snoring' | 'breathing' | 'rested'
  | 'spo2Dips' | 'nightmare'

export interface OutcomeDef {
  key: OutcomeKey
  label: string
  unit: string
  /** which way is better, for "helps" and "hurts" */
  better: 'up' | 'down'
  dp: number
  /** words for a difference: [more, less] */
  words: [string, string]
}

export const OUTCOMES: OutcomeDef[] = [
  { key: 'sleepScore', label: 'Sleep score', unit: '', better: 'up', dp: 0, words: ['higher', 'lower'] },
  { key: 'totalSleep', label: 'Total sleep', unit: 'min', better: 'up', dp: 0, words: ['more', 'less'] },
  { key: 'deep', label: 'Deep sleep', unit: 'min', better: 'up', dp: 0, words: ['more', 'less'] },
  { key: 'rem', label: 'REM sleep', unit: 'min', better: 'up', dp: 0, words: ['more', 'less'] },
  { key: 'awake', label: 'Time awake', unit: 'min', better: 'down', dp: 0, words: ['more', 'less'] },
  { key: 'awakenings', label: 'Awakenings', unit: '', better: 'down', dp: 1, words: ['more', 'fewer'] },
  { key: 'hrLow', label: 'Lowest sleeping heart rate', unit: 'bpm', better: 'down', dp: 1, words: ['higher', 'lower'] },
  { key: 'hrAvg', label: 'Average sleeping heart rate', unit: 'bpm', better: 'down', dp: 1, words: ['higher', 'lower'] },
  { key: 'hrv', label: 'Overnight HRV', unit: 'ms', better: 'up', dp: 0, words: ['higher', 'lower'] },
  { key: 'rhrNext', label: 'Next-morning resting heart rate', unit: 'bpm', better: 'down', dp: 1, words: ['higher', 'lower'] },
  { key: 'readinessNext', label: 'Next-morning readiness', unit: '', better: 'up', dp: 0, words: ['higher', 'lower'] },
  { key: 'restlessness', label: 'Restlessness', unit: 'per hour', better: 'down', dp: 1, words: ['higher', 'lower'] },
  { key: 'snoring', label: 'Snoring', unit: 'min', better: 'down', dp: 0, words: ['more', 'less'] },
  { key: 'breathing', label: 'Breathing disturbances', unit: '', better: 'down', dp: 1, words: ['more', 'fewer'] },
  { key: 'rested', label: 'How rested', unit: 'of 5', better: 'up', dp: 1, words: ['higher', 'lower'] },
  { key: 'spo2Dips', label: 'Blood oxygen dips', unit: '', better: 'down', dp: 1, words: ['more', 'fewer'] },
  { key: 'nightmare', label: 'Share of nightmare nights', unit: '', better: 'down', dp: 2, words: ['higher', 'lower'] },
]
export const OUTCOME_BY_KEY = Object.fromEntries(OUTCOMES.map((o) => [o.key, o])) as Record<OutcomeKey, OutcomeDef>

export interface NightRow {
  date: string
  binary: Record<string, boolean | null>
  continuous: Record<string, number | null>
  outcomes: Partial<Record<OutcomeKey, number | null>>
  /** for "the night after" and the weekday split */
  weekend: boolean
}

/** What the analysis reads per night, gathered by the caller from Health and the store. */
export interface NightInputs {
  date: string
  asleepMin: number | null
  deepMin: number | null
  remMin: number | null
  awakeMin: number | null
  awakenings: number | null
  hrLow: number | null
  hrAvg: number | null
  hrv: number | null
  score: number | null
  rhrNext: number | null
  readinessNext: number | null
  breathing: number | null
  spo2Dips: number | null
  restless: { indexPerHour: number } | null
  sounds: SoundsNight | null
  morning: MorningCheck | null
  /** the nightmare estimate for the night: 1 likely or confirmed, 0 not, null unknown */
  nightmare?: number | null
  /** Screen Time minutes after bedtime that evening, null when not set up */
  lateUseMin: number | null
  audio: { minutesInBed: number; minutesAfterSleep: number; avgDb: number } | null
  latencyMin: number | null
  hrDipPct: number | null
  daylightMorningMin: number | null
  waterL: number | null
}

/** Phone use after bedtime long enough to count as "Phone in bed". */
export const LATE_USE_MIN = 10

/** Rows from the night features and what was measured. */
export function buildRows(features: NightFeatures[], inputs: Map<string, NightInputs>): NightRow[] {
  return features.map((f) => {
    const n = inputs.get(f.date)
    const binary = { ...f.binary }
    const continuous = { ...f.continuous }
    if (n) {
      // automatic answers win over the manual ones when they exist
      if (n.lateUseMin != null) {
        continuous.lateUseMin = n.lateUseMin
        binary['habit:screen-bed'] = n.lateUseMin >= LATE_USE_MIN
      }
      if (n.sounds?.roomMeanC != null) {
        continuous.roomTempC = n.sounds.roomMeanC
        binary['habit:room-hot'] = n.sounds.roomMeanC >= 24
      }
      binary.sleepAudio = n.audio ? n.audio.minutesInBed >= 5 : (n.audio === null ? false : null)
      binary.audioAfterSleep = n.audio ? n.audio.minutesAfterSleep >= 5 : (n.audio === null ? false : null)
      binary.audioLoud = n.audio ? n.audio.avgDb > 60 : (n.audio === null ? false : null)
      continuous.audioAfterSleepMin = n.audio ? n.audio.minutesAfterSleep : null
      continuous.daylightMorningMin = n.daylightMorningMin
      continuous.waterL = n.waterL
    }
    const snoring = n?.sounds && !n.sounds.lowConfidence ? n.sounds.snoringMin : null
    const outcomes: NightRow['outcomes'] = n ? {
      sleepScore: n.score,
      totalSleep: n.asleepMin,
      deep: n.deepMin,
      rem: n.remMin,
      awake: n.awakeMin,
      awakenings: n.awakenings,
      hrLow: n.hrLow,
      hrAvg: n.hrAvg,
      hrv: n.hrv,
      rhrNext: n.rhrNext,
      readinessNext: n.readinessNext,
      restlessness: n.restless?.indexPerHour ?? null,
      snoring,
      breathing: n.breathing,
      rested: n.morning?.rested ?? null,
      spo2Dips: n.spo2Dips,
      nightmare: n.nightmare ?? null,
    } : {}
    return { date: f.date, binary, continuous, outcomes, weekend: !!f.binary.weekend }
  })
}

// ------------------------------------------------------------- factor names

export interface Names {
  habits: Record<string, string>
  asNeeded: Record<string, string>
  supplements: Record<string, string>
  compounds: Record<string, string>
}

const FIXED: Record<string, string> = {
  workout: 'A workout', lateWorkout: 'A workout ending within 3 h of bed', sauna: 'Sauna', lateSauna: 'Sauna ending within 3 h of bed',
  saunaElectrolytes: 'Electrolytes after sauna', nap: 'A nap', weekend: 'Weekend nights', earlyStart: 'An early start',
  lateMeal: 'A meal within 3 h of bed', sleepAudio: 'Sleep audio', audioAfterSleep: 'Audio played after you fell asleep',
  audioLoud: 'Audio over 60 dB',
  drinks: 'Drinks', lateUseMin: 'Minutes of phone use after bedtime', roomTempC: 'Bedroom temperature', daylightMorningMin: 'Daylight before 10 am',
  steps: 'Steps', napMin: 'Nap minutes', workoutKcal: 'Workout energy', workoutLoad: 'Training load', saunaMin: 'Sauna minutes', saunaTemp: 'Sauna temperature',
  saunaWaterMl: 'Water after sauna', audioAfterSleepMin: 'Minutes of audio after falling asleep', waterL: 'Water', daylightMin: 'Daylight',
  'toBed:lastDrink': 'Hours from last drink to bed', 'toBed:lastMeal': 'Hours from last meal to bed', 'toBed:workout': 'Hours from workout to bed',
  'toBed:sauna': 'Hours from sauna to bed',
}

/** The words for a factor key. */
export function factorName(key: string, names: Names): string {
  if (FIXED[key]) return FIXED[key]
  const [kind, id, more] = key.split(':')
  if (kind === 'habit') return names.habits[id] || id
  if (kind === 'asNeeded') return names.asNeeded[id] || id
  if (kind === 'amount') return `${names.asNeeded[id] || id} amount`
  if (kind === 'supp') return names.supplements[id] || id
  if (kind === 'grams') return `${names.supplements[id] || id} grams`
  if (kind === 'dose') return `${names.compounds[id] || id} dose`
  if (kind === 'toBed' && id === 'dose') return `Hours from ${names.compounds[more] || more} to bed`
  if (kind === 'toBed') return `Hours from ${names.asNeeded[id] || id} to bed`
  if (kind === 'lag') return `The night after ${factorName(key.slice(4), names).toLowerCase()}`
  return key
}
