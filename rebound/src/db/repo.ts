import type { Baseline, ISODate, MorningCheck, SetLog, Workout } from '../data/records'
import type { ReboundDB, SettingsRow } from './db'
import { defaultSettings } from './seedDb'

export const newId = (): string => crypto.randomUUID()

export async function getSettings(db: ReboundDB): Promise<SettingsRow> {
  return (await db.settings.get('settings')) ?? defaultSettings()
}

export async function updateSettings(db: ReboundDB, patch: Partial<Omit<SettingsRow, 'id'>>): Promise<void> {
  const cur = await getSettings(db)
  await db.settings.put({ ...cur, ...patch, id: 'settings' })
}

/** Autosave: every set is written the moment it is logged. */
export async function logSet(db: ReboundDB, set: Omit<SetLog, 'id' | 'loggedAt'>): Promise<SetLog> {
  const row: SetLog = { ...set, id: newId(), loggedAt: Date.now() }
  await db.sets.put(row)
  return row
}

/** Undo for a logged set. Returns the removed row so it can be restored. */
export async function deleteSet(db: ReboundDB, id: string): Promise<SetLog | undefined> {
  const row = await db.sets.get(id)
  await db.sets.delete(id)
  return row
}

export async function restoreSet(db: ReboundDB, row: SetLog): Promise<void> {
  await db.sets.put(row)
}

/** The unfinished workout to resume, if the app closed mid-session. */
export async function activeWorkout(db: ReboundDB): Promise<Workout | undefined> {
  return db.workouts.where('status').equals('active').last()
}

/**
 * Save a morning check. The first check ever sets the baseline.
 * Returns the baseline in force after saving.
 */
export async function saveMorningCheck(db: ReboundDB, check: MorningCheck): Promise<Baseline> {
  return db.transaction('rw', [db.morningChecks, db.settings], async () => {
    await db.morningChecks.put(check)
    const s = await getSettings(db)
    if (s.baseline) return s.baseline
    const baseline: Baseline = { kneeLeft: check.kneeLeft, kneeRight: check.kneeRight, wristPain: check.wristPain, setAt: check.date }
    await db.settings.put({ ...s, baseline })
    return baseline
  })
}

export async function morningChecksBetween(db: ReboundDB, from: ISODate, to: ISODate): Promise<MorningCheck[]> {
  return db.morningChecks.where('date').between(from, to, true, true).toArray()
}

/** Sets for one slot, grouped by workout, most recent workout first. */
export async function slotHistory(db: ReboundDB, slotKey: string, limit = 5): Promise<{ workout: Workout; sets: SetLog[] }[]> {
  const sets = await db.sets.where('slotKey').equals(slotKey).toArray()
  const byWorkout = new Map<string, SetLog[]>()
  for (const s of sets) byWorkout.set(s.workoutId, [...(byWorkout.get(s.workoutId) ?? []), s])
  const workouts = (await db.workouts.bulkGet([...byWorkout.keys()])).filter((w): w is Workout => !!w && w.status === 'done')
  return workouts
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit)
    .map((workout) => ({ workout, sets: (byWorkout.get(workout.id) ?? []).sort((a, b) => a.setIndex - b.setIndex) }))
}

/** Wipe everything. Caller is responsible for the double confirmation. */
export async function clearAll(db: ReboundDB): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })
}
