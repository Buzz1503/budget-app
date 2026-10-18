// Reading Apple Health into the local cache.
//
// First run: the last 365 days, 30 days at a time, so the phone stays responsive
// and progress can be shown. After that: from three days before the last sync,
// because Withings often delivers readings late. Each window is replaced as a
// whole — rows deleted, then rewritten — so running a sync twice changes
// nothing, and a sample deleted in Health disappears here on the next pass.

import type { HealthBridge } from './bridge'
import type { HealthDB } from './cache'
import { readMeta, writeMeta } from './cache'
import type { Tz } from './tz'
import { addDays, dateRange } from './tz'
import type { SourceClass, HealthWorkout } from './types'
import { buildNights, buildDaily, buildWorkout } from './dayLogic'

export const BACKFILL_DAYS = 365
export const CHUNK_DAYS = 30
export const LATE_DATA_DAYS = 3

export interface SyncProgress {
  done: number
  total: number
}

export interface SyncResult {
  from: string
  to: string
  days: number
  nights: number
  workouts: number
}

/** The date windows a sync will read, oldest first. */
export function syncWindows({ today, lastSyncDate, backfillDone, full }: {
  today: string
  lastSyncDate: string | null
  backfillDone: boolean
  full?: boolean
}): Array<[string, string]> {
  const from = full || !backfillDone || !lastSyncDate
    ? addDays(today, -(BACKFILL_DAYS - 1))
    : addDays(lastSyncDate < today ? lastSyncDate : today, -LATE_DATA_DAYS)
  const dates = dateRange(from, today)
  const out: Array<[string, string]> = []
  for (let i = 0; i < dates.length; i += CHUNK_DAYS) {
    out.push([dates[i], dates[Math.min(i + CHUNK_DAYS, dates.length) - 1]])
  }
  return out
}

const DAY_MS = 86400000

export async function syncHealth({
  bridge, db, tz, now = Date.now(), priority, full = false, onProgress,
}: {
  bridge: HealthBridge
  db: HealthDB
  tz: Tz
  now?: number
  priority?: SourceClass[]
  full?: boolean
  onProgress?: (p: SyncProgress) => void
}): Promise<SyncResult> {
  const today = tz.dateOf(now)
  const meta = await readMeta(db)
  const lastSyncDate = meta.lastSyncAt ? tz.dateOf(Date.parse(meta.lastSyncAt)) : null
  const windows = syncWindows({ today, lastSyncDate, backfillDone: meta.backfillDone, full })
  const result: SyncResult = { from: windows[0][0], to: today, days: 0, nights: 0, workouts: 0 }

  for (let i = 0; i < windows.length; i++) {
    const [d0, d1] = windows[i]
    onProgress?.({ done: i, total: windows.length })
    const a = tz.startOfDay(d0)
    const b = Math.min(tz.startOfDay(addDays(d1, 1)), now)
    // a night that ends on d0 began the evening before; so did its wrist
    // temperature and its overnight HRV
    const wide = a - DAY_MS
    const dates = dateRange(d0, d1)

    const [sleep, restingHR, hrv, respRate, wristTemp, spo2, vo2max, weight, bodyFat, leanMass, hrRecovery, bloodPressure,
      steps, activeEnergy, dietEnergy, dietProtein, dietWater, daylight, rawWorkouts] = await Promise.all([
      bridge.sleep(wide, b),
      bridge.quantity('restingHR', a, b),
      bridge.quantity('hrv', wide, b),
      bridge.quantity('respRate', wide, b),
      bridge.quantity('wristTemp', wide, b),
      bridge.quantity('spo2', a, b),
      bridge.quantity('vo2max', a, b),
      bridge.quantity('weight', a, b),
      bridge.quantity('bodyFat', a, b),
      bridge.quantity('leanMass', a, b),
      bridge.quantity('hrRecovery', a, b + 15 * 60000),
      bridge.bloodPressure(a, b),
      bridge.dailySum('steps', a, b),
      bridge.dailySum('activeEnergy', a, b),
      bridge.dailySum('dietEnergy', a, b),
      bridge.dailySum('dietProtein', a, b),
      bridge.dailySum('dietWater', a, b),
      bridge.dailySum('daylight', a, b),
      bridge.workouts(a, b),
    ])

    const nights = buildNights(sleep, { tz, priority, dates })
    const daily = buildDaily({
      restingHR, hrv, respRate, wristTemp, spo2, vo2max, weight, bodyFat, leanMass, hrRecovery, bloodPressure,
      steps, activeEnergy, dietEnergy, dietProtein, dietWater, daylight,
    }, { tz, from: d0, to: d1, nights })

    // heart rate is read per workout, and only for workouts not already cached
    const cached = new Map<string, HealthWorkout>(
      (await db.healthWorkouts.where('date').between(d0, d1, true, true).toArray()).map((w) => [w.id, w]),
    )
    const workouts: HealthWorkout[] = []
    for (const raw of rawWorkouts) {
      const prior = cached.get(raw.id)
      const hr = prior?.hrSeries.length ? null : await bridge.quantity('heartRate', raw.start, raw.end)
      const built = buildWorkout(raw, { tz, hr: hr || [], hrr: hrRecovery })
      if (prior?.hrSeries.length) {
        built.hrSeries = prior.hrSeries
        built.avgHR = prior.avgHR
        built.maxHR = prior.maxHR
      }
      workouts.push(built)
    }

    await db.transaction('rw', db.healthDaily, db.sleepNights, db.healthWorkouts, async () => {
      await db.healthDaily.where('date').between(d0, d1, true, true).delete()
      await db.sleepNights.where('date').between(d0, d1, true, true).delete()
      await db.healthWorkouts.where('date').between(d0, d1, true, true).delete()
      await db.healthDaily.bulkPut(daily)
      await db.sleepNights.bulkPut(Object.values(nights))
      await db.healthWorkouts.bulkPut(workouts)
    })
    result.days += daily.length
    result.nights += Object.keys(nights).length
    result.workouts += workouts.length
  }

  const characteristics = await bridge.characteristics()
  await writeMeta(db, { lastSyncAt: new Date(now).toISOString(), backfillDone: true, characteristics })
  onProgress?.({ done: windows.length, total: windows.length })
  return result
}
