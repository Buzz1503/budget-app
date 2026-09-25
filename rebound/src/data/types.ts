// Types for the seed data parsed from rehab-strength-master-plan.md.
// `null` always means "the master plan does not give a value" — never a guess.

export type Joint = 'knee' | 'wrist' | 'shoulder'

export type SectionId =
  | 'warmup'
  | 'kneePrimer'
  | 'wristBlock'
  | 'kneeStrength'
  | 'gluteHam'
  | 'upper'
  | 'core'
  | 'shoulderCare'

export type MuscleGroup =
  | 'quads'
  | 'kneeTendon'
  | 'glutes'
  | 'gluteMedius'
  | 'hamstrings'
  | 'adductors'
  | 'calves'
  | 'chest'
  | 'triceps'
  | 'upperBack'
  | 'lats'
  | 'biceps'
  | 'abs'
  | 'deepCore'
  | 'obliques'
  | 'forearm'
  | 'rotatorCuff'
  | 'cardio'

export type Category =
  | 'warmup'
  | 'knee'
  | 'gluteHam'
  | 'calves'
  | 'upper'
  | 'core'
  | 'wristRehab'
  | 'shoulderCare'
  | 'home'

/** How load moves between sessions (Section 9 of the plan). */
export type ProgressionKind =
  | 'kneeHsr' // knee Stage 2 heavy slow resistance rules
  | 'double' // double progression: reps within range, then weight
  | 'reps' // bodyweight: add reps
  | 'hold' // add seconds to a hold
  | 'none' // rehab drills, warm-up, walk: no auto progression

export type IncrementUnit = 'kg' | 'reps' | 'sec'

export interface Increment {
  amount: number
  unit: IncrementUnit
}

export interface PerformanceMark {
  weightKg: number
  reps: number
}

export interface Exercise {
  id: string
  name: string
  machine: string
  /** Muscles exactly as the plan words them. */
  musclesText: string
  muscles: MuscleGroup[]
  category: Category
  /** kg. `null` = "set on day 1" or not given. 0 = bodyweight. */
  startWeightKg: number | null
  startWeightNote: string | null
  increment: Increment | null
  preInjuryBest: PerformanceMark | null
  /** Setup and execution, one step per item, from the plan's "how to do it". */
  steps: string[]
  /** Plan flags, e.g. "knee rehab primary", "wrist gate". */
  flags: string[]
  /** Which joint(s) get a pain score after each set. */
  painJoints: Joint[]
  /** Log left and right separately. */
  unilateral: boolean
  /** Reps are timed holds (seconds) rather than counted reps. */
  timed: boolean
  /** Leg press weights are loaded plates only (not the sled). */
  plateLoaded: boolean
  progression: ProgressionKind
  /** Not available until a stage unlocks it. */
  lockedUntil: { knee: KneeStageId } | null
}

export interface RepRange {
  min: number
  max: number
}

/**
 * `kneeStage` = sets and reps come from the current knee Stage 2 week.
 * `fixed` = sets x reps (or seconds) as written in the session.
 */
export type Prescription =
  | { kind: 'kneeStage' }
  | { kind: 'fixed'; sets: number; reps: RepRange }
  | { kind: 'timed'; sets: number; holdSec: RepRange }
  | { kind: 'duration'; minutes: RepRange }
  | { kind: 'holdReps'; sets: number; reps: RepRange; holdSec: RepRange }

export interface SessionItem {
  exerciseId: string
  section: SectionId
  prescription: Prescription
  /** Seconds. `null` = the plan gives no rest for this line. */
  restSec: number | null
  /** Text label only, e.g. "3-0-3" or "3 sec lowering". */
  tempo: string | null
  /** Extra per-session instruction from the plan, verbatim where possible. */
  note: string | null
  perSide: boolean
  /** e.g. "skip if shoulder above 2/10". */
  skipIf: { joint: Joint; above: number } | null
}

/** A block whose content depends on current stage, resolved at runtime. */
export interface StageBlockRef {
  block: 'wristBlock' | 'shoulderCare'
  section: SectionId
  optional: boolean
}

export type SessionEntry = SessionItem | StageBlockRef

export type SessionId = 'A' | 'B' | 'C'

export interface SessionTemplate {
  id: SessionId
  name: string
  entries: SessionEntry[]
}

export type KneeStageId = 'K1' | 'K2' | 'K3' | 'K4'
export type WristStageId = 'W1' | 'W2' | 'W3'

export interface KneeRepBlock {
  weeks: RepRange
  sets: number
  reps: number
}

export interface KneeStage {
  id: KneeStageId
  number: 1 | 2 | 3 | 4
  name: string
  summary: string
  status: 'complete' | 'current' | 'locked'
  unlockRule: string[]
  notes: string[]
}

export interface WristStage {
  id: WristStageId
  name: string
  summary: string
  status: 'current' | 'locked'
  unlockRule: string[]
  exercises: SessionItem[]
  notes: string[]
}

export interface Milestone {
  id: string
  order: number
  exerciseId: string
  target: PerformanceMark
  label: string
  note: string | null
}

export type SwapAction =
  | { kind: 'modify'; label: string }
  | { kind: 'loadChange'; pct: number; label: string }
  | { kind: 'drop'; scope: 'week'; label: string }
  | { kind: 'hold'; label: string }

export interface SwapRule {
  exerciseIds: string[]
  trigger: { joint: Joint; above: number }
  /** In order: first try, then "still sore". */
  steps: SwapAction[]
}

export type DayKind = 'gym' | 'home' | 'rest'

export interface WeekPlanDay {
  label: string
  kind: DayKind
  session: SessionId | null
  plan: string
}
