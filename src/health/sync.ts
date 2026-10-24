// Reading Apple Health into the local cache.
//
// First run: the full history, 30 days at a time, so the phone stays
// responsive and progress can be shown. The earliest date is found with one
// cheap probe of the body readings, so a Withings scale from 2014 fills the
// Scale weight line back that far. After that: from three days before the last
// sync, because Withings often delivers readings late. Each window is replaced as a
// whole — rows deleted, then rewritten — so running a sync twice changes
// nothing, and a sample deleted in Health disappears here on the next pass.

import type { HealthBridge } from './bridge'
import type { HealthDB } from './cache'
import { readMeta, writeMeta } from './cache'
import type { Tz } from './tz'
import { addDays, dateRange } from './tz'
import type { SourceClass, HealthWorkout } from './types'
import { buildOvernight, morningLight } from './overnight'
import { buildNights, buildDaily, buildWorkout, sleepingHeartRate } from './dayLogic'

export const BACKFILL_DAYS = 365
/** The earliest date the history probe looks at. */
export const HISTORY_FLOOR = '2009-01-01'
/** Quantities probed for the oldest reading: the body ones, so the Scale line reaches back as far as it can. */
const HISTORY_PROBE = ['weight', 'bodyFat', 'leanMass', 'restingHR'] as const
/**
 * What the cached nights and days hold. 2: stage segments and sleeping heart
 * rate. 3: timed weigh-ins on each day. 4: the Sleep Lab's overnight detail
 * (latency, WASO, heart rate and SpO2 through the night, breathing
 * disturbances, headphone audio) and morning light. A cache written by an
 * older version is read again in full on the next sync.
 */
export const NIGHTS_SCHEMA = 4
export const CHUNK_DAYS = 30
export const LATE_DATA_DAYS = 3

export interface SyncProgress {
  done: number
  total: number
  /** 'history' while windows older than the usual year are being read */
  phase?: 'recent' | 'history'
}

export interface SyncResult {
  from: string
  to: string
  days: number
  nights: number
  workouts: number
}

/** The date windows a sync will read, oldest first. */
export function syncWindows({ today, lastSyncDate, backfillDone, full, historyFrom }: {
  today: string
  lastSyncDate: string | null
  backfillDone: boolean
  full?: boolean
  /** read from this date when it is earlier than the usual start: the full history */
  historyFrom?: string | null
}): Array<[string, string]> {
  const usual = full || !backfillDone || !lastSyncDate
    ? addDays(today, -(BACKFILL_DAYS - 1))
    : addDays(lastSyncDate < today ? lastSyncDate : today, -LATE_DATA_DAYS)
  const from = historyFrom && historyFrom < usual ? historyFrom : usual
  const dates = dateRange(from, today)
  const out: Array<[string, string]> = []
  for (let i = 0; i < dates.length; i += CHUNK_DAYS) {
    out.push([dates[i], dates[Math.min(i + CHUNK_DAYS, dates.length) - 1]])
  }
  return out
}

const DAY_MS = 86400000

/**
 * The oldest date any body reading goes back to, or null when there is none.
 * One query per type over the whole span; weights and resting heart rates are
 * a few thousand small rows, not the heavy sleep or workout data.
 */
export async function earliestReading(bridge: HealthBridge, tz: Tz, now: number): Promise<string | null> {
  const from = tz.startOfDay(HISTORY_FLOOR)
  const firsts = await Promise.all(HISTORY_PROBE.map(async (type) => {
    const rows = await bridge.quantity(type, from, now)
    return rows.length ? tz.dateOf(Math.min(...rows.map((r) => r.start))) : null
  }))
  const found = firsts.filter((d): d is string => !!d).sort()
  return found[0] ?? null
}

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
  const stale = meta.backfillDone && (meta.nightsSchema ?? 1) < NIGHTS_SCHEMA
  // the full history is read once: now for an existing cache, on connect for a new one
  let historyFrom: string | null = null
  if (!meta.historyDone) {
    try { historyFrom = await earliestReading(bridge, tz, now) } catch { historyFrom = null }
  }
  const windows = syncWindows({ today, lastSyncDate, backfillDone: meta.backfillDone, full: full || stale, historyFrom })
  const recentFrom = addDays(today, -(BACKFILL_DAYS - 1))
  const result: SyncResult = { from: windows[0][0], to: today, days: 0, nights: 0, workouts: 0 }

  for (let i = 0; i < windows.length; i++) {
    const [d0, d1] = windows[i]
    const older = d1 < recentFrom
    onProgress?.({ done: i, total: windows.length, phase: older ? 'history' : 'recent' })
    const a = tz.startOfDay(d0)
    const b = Math.min(tz.startOfDay(addDays(d1, 1)), now)
    // a night that ends on d0 began the evening before; so did its wrist
    // temperature and its overnight HRV
    const wide = a - DAY_MS
    const dates = dateRange(d0, d1)

    const [sleep, restingHR, hrv, respRate, wristTemp, spo2, vo2max, weight, bodyFat, leanMass, hrRecovery, bloodPressure,
      steps, activeEnergy, dietEnergy, dietProtein, dietWater, daylight, rawWorkouts,
      breathing, daylightSamples, hrDaytime, headphone] = await Promise.all([
      bridge.sleep(wide, b),
      bridge.quantity('restingHR', a, b),
      bridge.quantity('hrv', wide, b),
      bridge.quantity('respRate', wide, b),
      bridge.quantity('wristTemp', wide, b),
      bridge.quantity('spo2', wide, b),
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
      // the Sleep Lab's reads: nothing older than the usual year needs them
      older ? Promise.resolve([]) : bridge.quantity('breathing', wide, b + 6 * 3600000),
      older ? Promise.resolve([]) : bridge.quantity('daylight', a, b),
      older ? Promise.resolve([]) : bridge.daytimeHeartRate(a, b),
      older ? Promise.resolve([]) : bridge.quantity('headphone', wide - 6 * 3600000, b),
    ])

    const nights = buildNights(sleep, { tz, priority, dates })
    // heart rate while asleep: read per main sleep, so a day of samples is never pulled
    // (older than the usual year there is no sleeping heart rate: nothing reads it)
    for (const n of Object.values(nights)) {
      if (older) { n.sleepingHR = null; n.overnight = null; continue }
      const hr = await bridge.quantity('heartRate', n.start, n.end)
      n.sleepingHR = sleepingHeartRate(hr, n.start, n.end)
      n.overnight = buildOvernight({ night: n, raw: sleep, hr, hrv, spo2, breathing, resp: respRate, headphone })
    }
    const daily = buildDaily({
      restingHR, hrv, respRate, wristTemp, spo2, vo2max, weight, bodyFat, leanMass, hrRecovery, bloodPressure,
      steps, activeEnergy, dietEnergy, dietProtein, dietWater, daylight,
    }, { tz, from: d0, to: d1, nights })
    // morning light and the daytime heart rate, for days that have a row
    const dayHr = new Map(hrDaytime.map((r) => [r.date, r.value]))
    for (const row of daily) {
      const mine = daylightSamples.filter((x) => tz.dateOf(x.start) === row.date)
      row.daylightMorningMin = mine.length ? morningLight(mine, tz.startOfDay(row.date)) : null
      row.hrDaytime = dayHr.has(row.date) ? Math.round(dayHr.get(row.date)!) : null
    }

    // heart rate is read per workout, and only for workouts not already cached
    const cached = new Map<string, HealthWorkout>(
      (await db.healthWorkouts.where('date').between(d0, d1, true, true).toArray()).map((w) => [w.id, w]),
    )
    const workouts: HealthWorkout[] = []
    for (const raw of rawWorkouts) {
      const prior = cached.get(raw.id)
      // workout heart rate is not read for history older than the usual year
      const hr = prior?.hrSeries.length || older ? null : await bridge.quantity('heartRate', raw.start, raw.end)
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
  await writeMeta(db, { lastSyncAt: new Date(now).toISOString(), backfillDone: true, characteristics, nightsSchema: NIGHTS_SCHEMA, historyDone: true })
  onProgress?.({ done: windows.length, total: windows.length })
  return result
}
