// The one place that talks to Apple Health.
//
// Two native plugins sit behind this interface: @capgo/capacitor-health for
// the core reads (sleep, heart, body, workouts, daily sums) and the app's own
// PepitoHealth for the rest (one authorization sheet, characteristics, lean
// mass, heart rate recovery, daylight, protein). Everything above this file
// sees only plain arrays of epoch-ms samples, so the rest of the Health layer
// can be tested and demoed without a phone.
//
// Every read is read-only. A failure of any kind is "no data": HealthKit does
// not say whether access was declined, so an empty answer is all there is.

import type {
  RawQuantity, RawSleep, RawWorkout, RawBloodPressure, DayValue, HealthCharacteristics, SleepStage,
} from './types'
import type { Tz } from './tz'

export type QuantityKey =
  | 'restingHR' | 'heartRate' | 'hrv' | 'respRate' | 'wristTemp' | 'spo2' | 'vo2max'
  | 'weight' | 'bodyFat' | 'leanMass' | 'hrRecovery'
  // Sleep Lab: breathing disturbances, headphone audio exposure, timestamped daylight
  | 'breathing' | 'headphone' | 'daylight'
export type SumKey = 'steps' | 'activeEnergy' | 'dietEnergy' | 'dietProtein' | 'dietWater' | 'daylight'

export interface HealthBridge {
  isAvailable(): Promise<boolean>
  requestAuthorization(): Promise<boolean>
  characteristics(): Promise<HealthCharacteristics>
  quantity(type: QuantityKey, start: number, end: number): Promise<RawQuantity[]>
  dailySum(type: SumKey, start: number, end: number): Promise<DayValue[]>
  sleep(start: number, end: number): Promise<RawSleep[]>
  workouts(start: number, end: number): Promise<RawWorkout[]>
  bloodPressure(start: number, end: number): Promise<RawBloodPressure[]>
  /** Average heart rate 9 am to 9 pm, per local day (for the nocturnal dip). */
  daytimeHeartRate(start: number, end: number): Promise<DayValue[]>
  /** The one write: water logged with a sauna session, as dietary water. */
  writeWater(ml: number, at: number, id: string): Promise<boolean>
}

// ------------------------------------------------------------ native bridge

/* The capgo plugin's own names for the types it reads. */
const CAPGO_TYPE: Partial<Record<QuantityKey, string>> = {
  restingHR: 'restingHeartRate',
  heartRate: 'heartRate',
  hrv: 'heartRateVariability',
  respRate: 'respiratoryRate',
  wristTemp: 'appleSleepingWristTemperature',
  spo2: 'oxygenSaturation',
  vo2max: 'vo2Max',
  weight: 'weight',
  bodyFat: 'bodyFat',
}
const CAPGO_SUM: Partial<Record<SumKey, string>> = {
  steps: 'steps',
  activeEnergy: 'calories', // capgo's "calories" is activeEnergyBurned
  dietEnergy: 'dietaryEnergyConsumed',
  dietWater: 'dietaryWater',
}
/* Read by PepitoHealth instead. */
const OWN_TYPE: Partial<Record<QuantityKey, string>> = {
  leanMass: 'leanBodyMass',
  hrRecovery: 'heartRateRecoveryOneMinute',
  breathing: 'appleSleepingBreathingDisturbances',
  headphone: 'headphoneAudioExposure',
  daylight: 'timeInDaylight',
}
const OWN_SUM: Partial<Record<SumKey, string>> = {
  dietProtein: 'dietaryProtein',
  daylight: 'timeInDaylight',
}

const SLEEP_STAGE: Record<string, SleepStage> = {
  inBed: 'inBed', asleep: 'asleep', light: 'core', core: 'core', deep: 'deep', rem: 'rem', awake: 'awake',
}

const iso = (ms: number) => new Date(ms).toISOString()
const ms = (s: string) => Date.parse(s)
// HealthKit's percent unit is a fraction (0.18 = 18 %)
const asPercent = (v: number) => (v <= 1.5 ? v * 100 : v)

interface CapgoSample {
  value: number
  startDate: string
  endDate: string
  sourceName?: string
  sourceId?: string
  sleepState?: string
  systolic?: number
  diastolic?: number
  metadata?: Record<string, string>
}
interface CapgoWorkout {
  workoutType: string
  duration: number
  totalEnergyBurned?: number
  totalDistance?: number
  startDate: string
  endDate: string
  sourceName?: string
  sourceId?: string
  platformId?: string
  metadata?: Record<string, string>
}
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyPlugin = Record<string, (opts?: any) => Promise<any>>
/* eslint-enable @typescript-eslint/no-explicit-any */

const BIG_LIMIT = 100000

/**
 * The real thing. Plugins are passed in rather than imported so this file
 * stays importable (and testable) on the web.
 */
export function nativeBridge({ capgo, own, tz }: { capgo: AnyPlugin; own: AnyPlugin; tz: Tz }): HealthBridge {
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch {
      return fallback
    }
  }
  const readCapgo = (dataType: string, start: number, end: number) => safe(async () => {
    const res = await capgo.readSamples({ dataType, startDate: iso(start), endDate: iso(end), limit: BIG_LIMIT, ascending: true })
    return (res?.samples || []) as CapgoSample[]
  }, [] as CapgoSample[])

  return {
    isAvailable: () => safe(async () => !!(await own.isAvailable())?.available, false),
    requestAuthorization: () => safe(async () => !!(await own.requestAuthorization())?.requested, false),
    characteristics: () => safe(async () => (await own.getCharacteristics()) as HealthCharacteristics, {}),

    async quantity(type, start, end) {
      if (OWN_TYPE[type]) {
        return safe(async () => {
          const res = await own.readQuantitySamples({ type: OWN_TYPE[type], startDate: iso(start), endDate: iso(end) })
          return ((res?.samples || []) as CapgoSample[]).map((s) => ({
            value: s.value, start: ms(s.startDate), end: ms(s.endDate), sourceName: s.sourceName, sourceId: s.sourceId,
            ...(s.metadata ? { meta: s.metadata } : {}),
          }))
        }, [] as RawQuantity[])
      }
      const dataType = CAPGO_TYPE[type]
      if (!dataType) return []
      const rows = await readCapgo(dataType, start, end)
      const pct = type === 'bodyFat' || type === 'spo2'
      return rows
        .filter((s) => Number.isFinite(s.value))
        .map((s) => ({
          value: pct ? asPercent(s.value) : s.value,
          start: ms(s.startDate), end: ms(s.endDate), sourceName: s.sourceName, sourceId: s.sourceId,
        }))
    },

    async dailySum(type, start, end) {
      if (OWN_SUM[type]) {
        return safe(async () => {
          const res = await own.dailySum({ type: OWN_SUM[type], startDate: iso(start), endDate: iso(end) })
          return (res?.samples || []) as DayValue[]
        }, [] as DayValue[])
      }
      const dataType = CAPGO_SUM[type]
      if (!dataType) return []
      return safe(async () => {
        const res = await capgo.queryAggregated({ dataType, startDate: iso(start), endDate: iso(end), bucket: 'day', aggregation: 'sum' })
        return ((res?.samples || []) as Array<{ startDate: string; value: number }>)
          .filter((s) => Number.isFinite(s.value))
          // capgo's buckets start at local midnight; the date is the bucket's start
          .map((s) => ({ date: tz.dateOf(ms(s.startDate) + 60000), value: type === 'dietWater' ? s.value * 1000 : s.value }))
      }, [] as DayValue[])
    },

    async sleep(start, end) {
      const rows = await readCapgo('sleep', start, end)
      return rows
        .map((s) => ({
          start: ms(s.startDate), end: ms(s.endDate),
          stage: SLEEP_STAGE[s.sleepState || ''] || 'asleep',
          sourceName: s.sourceName, sourceId: s.sourceId,
        }))
        .filter((s) => s.end > s.start)
    },

    async workouts(start, end) {
      return safe(async () => {
        const res = await capgo.queryWorkouts({ startDate: iso(start), endDate: iso(end), limit: BIG_LIMIT, ascending: true })
        return ((res?.workouts || []) as CapgoWorkout[]).map((w) => ({
          id: w.platformId || `${w.sourceId || 'w'}-${w.startDate}`,
          type: w.workoutType || 'other',
          title: w.metadata?.HKWorkoutBrandName || w.metadata?.title || null,
          start: ms(w.startDate),
          end: ms(w.endDate),
          durationSec: w.duration,
          energyKcal: w.totalEnergyBurned ?? null,
          distanceM: w.totalDistance ?? null,
          sourceName: w.sourceName,
          sourceId: w.sourceId,
        }))
      }, [] as RawWorkout[])
    },

    async daytimeHeartRate(start, end) {
      return safe(async () => {
        const res = await own.daytimeAverage({ type: 'heartRate', startDate: iso(start), endDate: iso(end), fromHour: 9, toHour: 21 })
        return (res?.samples || []) as DayValue[]
      }, [] as DayValue[])
    },

    async writeWater(ml, at, id) {
      return safe(async () => !!(await own.writeWater({ ml, date: iso(at), id }))?.saved, false)
    },

    async bloodPressure(start, end) {
      const rows = await readCapgo('bloodPressure', start, end)
      return rows
        .filter((s) => Number.isFinite(s.systolic) && Number.isFinite(s.diastolic))
        .map((s) => ({ start: ms(s.startDate), sys: s.systolic as number, dia: s.diastolic as number, sourceName: s.sourceName }))
    },
  }
}
