import type { Overnight } from './overnight'

// Shapes shared by the Health layer: what comes out of Apple Health (raw), and
// what is kept in the local cache (derived, one row per day / night / workout).

/** One reading of a quantity, as Health reports it. Times are epoch ms. */
export interface RawQuantity {
  value: number
  start: number
  end: number
  sourceName?: string
  sourceId?: string
  /** a sample's metadata, when the reader passes it on (breathing disturbances) */
  meta?: Record<string, string>
}

export type SleepStage = 'inBed' | 'asleep' | 'core' | 'deep' | 'rem' | 'awake'

export interface RawSleep {
  start: number
  end: number
  stage: SleepStage
  sourceName?: string
  sourceId?: string
}

export interface RawWorkout {
  id: string
  type: string
  title?: string | null
  start: number
  end: number
  durationSec: number
  energyKcal?: number | null
  distanceM?: number | null
  sourceName?: string
  sourceId?: string
}

export interface RawBloodPressure {
  start: number
  sys: number
  dia: number
  sourceName?: string
}

export interface DayValue {
  date: string
  value: number
}

export type SourceClass = 'watch' | 'withings' | 'phone' | 'other'

// ------------------------------------------------------------------ cache

/** One local day. A field nobody recorded is null, never zero. */
export interface HealthDaily {
  date: string
  restingHR: number | null
  hrvOvernight: number | null
  hrvDayMean: number | null
  respRate: number | null
  wristTemp: number | null
  spo2: number | null
  vo2max: number | null
  steps: number | null
  activeEnergy: number | null
  weight: number | null
  weightSource: string | null
  /** Every weigh-in that day with its time, for the sauna's fluid estimate. Null without any. */
  weighIns: Array<{ t: number; kg: number; source: string }> | null
  bodyFatPct: number | null
  leanMass: number | null
  bpSys: number | null
  bpDia: number | null
  dietEnergy: number | null
  dietProtein: number | null
  dietWater: number | null
  hrRecovery: number | null
  daylightMin: number | null
  /** daylight minutes before 10 am, from timestamped samples; null without them */
  daylightMorningMin?: number | null
  /** average heart rate 9 am to 9 pm, for the nocturnal dip */
  hrDaytime?: number | null
}

/** One stretch of a single stage, for the hypnogram. 'asleep' = no stage given. */
export interface SleepSegment {
  start: number
  end: number
  stage: 'awake' | 'rem' | 'core' | 'deep' | 'asleep'
}

/** Heart rate while asleep, from the samples inside the main sleep. */
export interface SleepingHR {
  min: number
  avg: number
  n: number
}

/** A run of sleep samples from one source with no gap of an hour or more. */
export interface SleepSession {
  source: SourceClass
  sourceName: string
  start: number
  end: number
  inBedMin: number
  asleepMin: number
  awakeMin: number
  deepMin: number
  coreMin: number
  remMin: number
  unspecifiedMin: number
  hasStages: boolean
  /** Stage by stage, oldest first, overlaps trimmed. Missing on nights cached before stage 2C. */
  segments?: SleepSegment[]
}

/** The main sleep that ended on `date` (the wake-up date), and any naps. */
export interface SleepNight extends SleepSession {
  date: string
  naps: SleepSession[]
  /** Lowest and average heart rate inside the main sleep; null when none was recorded. */
  sleepingHR?: SleepingHR | null
  /** Latency, WASO, heart rate and SpO2 through the night, breathing, audio (Sleep Lab, schema 4) */
  overnight?: Overnight | null
}

export interface HealthWorkout {
  id: string
  date: string
  type: string
  title: string
  start: number
  end: number
  durationMin: number
  energyKcal: number | null
  distanceM: number | null
  avgHR: number | null
  maxHR: number | null
  sourceName: string
  sourceId: string
  /** Heart rate inside the workout: [seconds from start, bpm]. */
  hrSeries: Array<[number, number]>
  /** One-minute heart rate recovery Health recorded after this workout, bpm. */
  hrRecovery: number | null
}

export interface HealthCharacteristics {
  dateOfBirth?: string | null
  biologicalSex?: 'female' | 'male' | 'other' | null
}

export const EMPTY_DAILY: Omit<HealthDaily, 'date'> = {
  restingHR: null, hrvOvernight: null, hrvDayMean: null, respRate: null, wristTemp: null,
  spo2: null, vo2max: null, steps: null, activeEnergy: null, weight: null, weightSource: null, weighIns: null,
  bodyFatPct: null, leanMass: null, bpSys: null, bpDia: null, dietEnergy: null,
  dietProtein: null, dietWater: null, hrRecovery: null, daylightMin: null,
}
