// The heavy work, by name, so the same functions run in the worker and, when
// there is no worker, on the main thread: the Sleep Lab analysis (bootstrap
// intervals, ridge regressions) and the compound effects (phases, windows).
import { runAnalysis } from '../../sleep/analysis/run'
import type { AnalysisInput } from '../../sleep/analysis/run'
import { compoundEffects, trackedForEffects } from '../../health/engine/compoundEffects'
import type { EffectInput } from '../../health/engine/compoundEffects'

export interface EffectsJob {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compounds: any[]
  input: EffectInput
  today: string
}

/** Every tracked compound with its effects, newest start first. */
export function runEffects({ compounds, input, today }: EffectsJob) {
  return trackedForEffects(compounds)
    .map((c) => ({ id: c.id as string, fx: compoundEffects(c, compounds, input, today) }))
    .sort((a, b) => (b.fx?.run.start || '').localeCompare(a.fx?.run.start || ''))
}

export const JOBS = {
  sleepAnalysis: (input: AnalysisInput) => runAnalysis(input),
  compoundEffects: (input: EffectsJob) => runEffects(input),
}
export type JobKind = keyof typeof JOBS
