import type { KneeStageState, StageState, WristStageState } from '../data/records'
import { DEFAULT_GYM_DAYS, EXERCISES, MILESTONES, SESSIONS } from '../data/seed'
import type { ReboundDB, SettingsRow } from './db'

export function defaultSettings(): SettingsRow {
  return { id: 'settings', gymDays: [...DEFAULT_GYM_DAYS], theme: 'dark', baseline: null, flare: null, workingWeights: {} }
}

/** First run: copy the master-plan seed into editable tables. No-op after that. */
export async function seedIfEmpty(db: ReboundDB): Promise<boolean> {
  return db.transaction('rw', [db.exercises, db.sessions, db.stages, db.milestones, db.settings], async () => {
    if ((await db.settings.count()) > 0) return false
    await db.exercises.bulkPut(structuredClone(EXERCISES))
    await db.sessions.bulkPut(structuredClone(SESSIONS))
    const knee: KneeStageState = { id: 'knee', current: 'K2', stage2Start: null, history: [] }
    const wrist: WristStageState = { id: 'wrist', current: 'W1', history: [] }
    await db.stages.bulkPut([knee, wrist] as StageState[])
    await db.milestones.bulkPut(MILESTONES.map((m) => ({ id: m.id, achievedAt: null })))
    await db.settings.put(defaultSettings())
    return true
  })
}
