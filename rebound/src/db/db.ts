import Dexie, { type EntityTable } from 'dexie'
import type {
  DeclineSquatTest,
  MachineSettings,
  MilestoneState,
  MorningCheck,
  QuestionnaireResult,
  SetLog,
  Settings,
  StageState,
  Workout,
} from '../data/records'
import type { Exercise, SessionTemplate } from '../data/types'

export interface SettingsRow extends Settings {
  id: 'settings'
}

/**
 * Local-only storage. Each schema change gets a new `version(n)` block with
 * an `upgrade()` so existing data migrates in place; never edit old versions.
 */
export class ReboundDB extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>
  sessions!: EntityTable<SessionTemplate, 'id'>
  workouts!: EntityTable<Workout, 'id'>
  sets!: EntityTable<SetLog, 'id'>
  morningChecks!: EntityTable<MorningCheck, 'date'>
  questionnaires!: EntityTable<QuestionnaireResult, 'id'>
  stages!: EntityTable<StageState, 'id'>
  machineSettings!: EntityTable<MachineSettings, 'exerciseId'>
  milestones!: EntityTable<MilestoneState, 'id'>
  declineSquatTests!: EntityTable<DeclineSquatTest, 'date'>
  settings!: EntityTable<SettingsRow, 'id'>

  constructor(name = 'rebound') {
    super(name)
    this.version(1).stores({
      exercises: 'id, category',
      sessions: 'id',
      workouts: 'id, date, status, sessionId',
      sets: 'id, workoutId, exerciseId, slotKey, loggedAt',
      morningChecks: 'date',
      questionnaires: 'id, type, date',
      stages: 'id',
      machineSettings: 'exerciseId',
      milestones: 'id',
      declineSquatTests: 'date',
      settings: 'id',
    })
  }
}

export const db = new ReboundDB()
