// The local Health cache: IndexedDB through Dexie, in its own database.
//
// Kept apart from the app's store on purpose. It is derived entirely from Apple
// Health, so it can always be rebuilt with a re-sync, and so it is not part of
// the app backup: a backup file that people email to themselves should not
// carry a year of heart and sleep data that was never the app's to begin with.

import Dexie, { type Table } from 'dexie'
import type { HealthDaily, SleepNight, HealthWorkout, HealthCharacteristics } from './types'

export interface MetaRow {
  key: string
  value: unknown
}

export const HEALTH_DB_NAME = 'pepito-health'

export class HealthDB extends Dexie {
  healthDaily!: Table<HealthDaily, string>
  sleepNights!: Table<SleepNight, string>
  healthWorkouts!: Table<HealthWorkout, string>
  meta!: Table<MetaRow, string>

  constructor(name: string = HEALTH_DB_NAME) {
    super(name)
    // Version 1 of a new database: there is no earlier Health schema to
    // migrate. Bump the number and add an upgrade step for any later change.
    this.version(1).stores({
      healthDaily: 'date',
      sleepNights: 'date',
      healthWorkouts: 'id, date, start',
      meta: 'key',
    })
  }
}

export interface SyncMeta {
  lastSyncAt: string | null
  backfillDone: boolean
  characteristics: HealthCharacteristics
  /** See NIGHTS_SCHEMA in sync.ts. Missing on a cache from before stage 2C. */
  nightsSchema?: number
  /** the full history has been read once (stage 3A); false on a cache from before */
  historyDone?: boolean
}

export async function readMeta(db: HealthDB): Promise<SyncMeta> {
  const rows = await db.meta.toArray()
  const get = (k: string) => rows.find((r) => r.key === k)?.value
  return {
    lastSyncAt: (get('lastSyncAt') as string) || null,
    backfillDone: !!get('backfillDone'),
    characteristics: (get('characteristics') as HealthCharacteristics) || {},
    nightsSchema: (get('nightsSchema') as number) || 1,
    historyDone: !!get('historyDone'),
  }
}

export async function writeMeta(db: HealthDB, patch: Partial<SyncMeta>): Promise<void> {
  await db.meta.bulkPut(Object.entries(patch).map(([key, value]) => ({ key, value })))
}

export interface HealthSnapshot {
  daily: HealthDaily[]
  nights: SleepNight[]
  workouts: HealthWorkout[]
  meta: SyncMeta
}

/** Everything in the cache, sorted by date — small enough to hold in memory (a year is ~1–2 MB). */
export async function loadAll(db: HealthDB): Promise<HealthSnapshot> {
  const [daily, nights, workouts, meta] = await Promise.all([
    db.healthDaily.orderBy('date').toArray(),
    db.sleepNights.orderBy('date').toArray(),
    db.healthWorkouts.orderBy('start').toArray(),
    readMeta(db),
  ])
  return { daily, nights, workouts, meta }
}

export async function clearAll(db: HealthDB): Promise<void> {
  await db.transaction('rw', db.healthDaily, db.sleepNights, db.healthWorkouts, db.meta, async () => {
    await Promise.all([db.healthDaily.clear(), db.sleepNights.clear(), db.healthWorkouts.clear(), db.meta.clear()])
  })
}
