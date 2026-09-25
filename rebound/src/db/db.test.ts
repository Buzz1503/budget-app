import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReboundDB } from './db'
import { activeWorkout, clearAll, deleteSet, getSettings, logSet, restoreSet, saveMorningCheck, slotHistory, updateSettings } from './repo'
import { seedIfEmpty } from './seedDb'

let db: ReboundDB
let n = 0

beforeEach(async () => {
  db = new ReboundDB(`test-${n++}`)
  await seedIfEmpty(db)
})
afterEach(async () => {
  await db.delete()
})

const workout = (id: string, status: 'active' | 'done', startedAt: number) => ({
  id,
  date: '2026-09-28',
  kind: 'gym' as const,
  sessionId: 'A' as const,
  status,
  startedAt,
  finishedAt: null,
  exercises: [],
  cursor: 0,
  source: 'app' as const,
})

const baseSet = { workoutId: 'w1', exerciseId: 'leg-press', slotKey: 'leg-press:knee', side: null, weightKg: 60, reps: 15, holdSec: null, rir: 2, pain: { knee: 1 } }

describe('database', () => {
  it('seeds once from the master plan', async () => {
    expect(await db.exercises.count()).toBeGreaterThan(20)
    expect(await db.sessions.count()).toBe(3)
    expect((await db.stages.get('knee'))?.current).toBe('K2')
    expect((await db.stages.get('wrist'))?.current).toBe('W1')
    expect((await getSettings(db)).gymDays).toEqual([1, 3, 5])
    expect(await seedIfEmpty(db)).toBe(false)
  })

  it('seeded exercises are editable', async () => {
    await db.exercises.update('leg-press', { startWeightKg: 70 })
    expect((await db.exercises.get('leg-press'))?.startWeightKg).toBe(70)
  })

  it('first morning check sets the baseline; later ones do not', async () => {
    const b = await saveMorningCheck(db, { date: '2026-09-25', kneeLeft: 2, kneeRight: 1, wristPain: 3, wristSwelling: false, createdAt: 0 })
    expect(b).toMatchObject({ kneeLeft: 2, kneeRight: 1, wristPain: 3, setAt: '2026-09-25' })
    const b2 = await saveMorningCheck(db, { date: '2026-09-26', kneeLeft: 0, kneeRight: 0, wristPain: 0, wristSwelling: false, createdAt: 0 })
    expect(b2.kneeLeft).toBe(2)
    await updateSettings(db, { baseline: { ...b2, kneeLeft: 1 } })
    expect((await getSettings(db)).baseline?.kneeLeft).toBe(1)
  })

  it('autosaves sets and supports undo', async () => {
    const s = await logSet(db, { ...baseSet, setIndex: 0 })
    expect(await db.sets.count()).toBe(1)
    const removed = await deleteSet(db, s.id)
    expect(await db.sets.count()).toBe(0)
    await restoreSet(db, removed!)
    expect((await db.sets.get(s.id))?.reps).toBe(15)
  })

  it('finds the active workout to resume', async () => {
    await db.workouts.put(workout('w0', 'done', 1))
    expect(await activeWorkout(db)).toBeUndefined()
    await db.workouts.put(workout('w1', 'active', 2))
    expect((await activeWorkout(db))?.id).toBe('w1')
  })

  it('slot history groups by finished workout, newest first', async () => {
    await db.workouts.bulkPut([workout('w1', 'done', 1), workout('w2', 'done', 2), workout('w3', 'active', 3)])
    await logSet(db, { ...baseSet, workoutId: 'w1', setIndex: 0 })
    await logSet(db, { ...baseSet, workoutId: 'w2', setIndex: 1, reps: 14 })
    await logSet(db, { ...baseSet, workoutId: 'w2', setIndex: 0, reps: 15 })
    await logSet(db, { ...baseSet, workoutId: 'w3', setIndex: 0 })
    const h = await slotHistory(db, 'leg-press:knee')
    expect(h.map((x) => x.workout.id)).toEqual(['w2', 'w1'])
    expect(h[0]?.sets.map((s) => s.reps)).toEqual([15, 14])
  })

  it('clears everything', async () => {
    await clearAll(db)
    expect(await db.exercises.count()).toBe(0)
    expect(await db.settings.count()).toBe(0)
  })
})
