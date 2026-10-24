// Everything the Analysis screen shows, from the nights' rows, in one plain
// object (no functions inside, so it can come back from a Web Worker and be
// cached by a hash of its input).

import { OUTCOME_BY_KEY } from './dataset'
import type { NightRow, Names, OutcomeKey } from './dataset'
import {
  simpleComparisons, adjustedEffects, helpsAndHurts, binSpecs, doseResponse, carryOver, bestWorst, weekdayWeekend,
  presentOutcomes, ANALYSIS, ADJUSTED_NOTE, CHANCE_NOTE,
} from './engine'
import type { Comparison, Adjusted, Ranked, Bin, PresenceRow, WeekSplit } from './engine'

export interface AnalysisInput {
  rows: NightRow[]
  names: Names
  timing: Array<[string, { bedFromNoon: number; wakeFromNoon: number }]>
  needMin: number
}

export interface AnalysisResult {
  nights: number
  nightsWithFactors: number
  outcomes: OutcomeKey[]
  helps: Ranked[]
  hurts: Ranked[]
  rankedBy: 'adjusted' | 'simple'
  factors: { comparisons: Comparison[]; locked: Array<{ factor: string; have: number }>; chanceNote: string | null }
  adjusted: Partial<Record<OutcomeKey, { locked: true; have: number } | { locked: false; effects: Adjusted[]; n: number }>>
  adjustedNote: string
  doseResponse: Array<{ key: string; label: string; outcome: OutcomeKey; bins: Bin[] }>
  carryOver: Comparison[]
  bestWorst: { locked: true; have: number; need: number } | { locked: false; k: number; table: PresenceRow[]; sentences: string[] }
  weekday: { rows: WeekSplit[]; socialJetlagMin: number | null; nWeekday: number; nWeekend: number }
}

/** The outcomes the dose-response charts use. */
const DOSE_OUTCOMES: OutcomeKey[] = ['sleepScore', 'deep', 'hrLow', 'rested']

export function runAnalysis(input: AnalysisInput): AnalysisResult {
  const { rows, names } = input
  const outcomes = presentOutcomes(rows)
  const nightsWithFactors = rows.filter((r) => Object.values(r.binary).some((v) => v != null)).length
  const hh = helpsAndHurts(rows, names, { needMin: input.needMin })
  const adjusted: AnalysisResult['adjusted'] = {}
  for (const o of outcomes) adjusted[o] = adjustedEffects(rows, o, names, { needMin: input.needMin })
  const doses: AnalysisResult['doseResponse'] = []
  for (const spec of binSpecs(rows, names)) {
    for (const o of DOSE_OUTCOMES.filter((k) => outcomes.includes(k))) {
      const d = doseResponse(rows, spec, o)
      if (d.enough) doses.push({ key: spec.key, label: spec.label, outcome: o, bins: d.bins })
    }
  }
  const factors = simpleComparisons(rows, names, outcomes)
  const carry = carryOver(rows, names, outcomes)
  const shown = factors.comparisons.length + carry.length
  return {
    nights: rows.length,
    nightsWithFactors,
    outcomes,
    helps: hh.helps,
    hurts: hh.hurts,
    rankedBy: nightsWithFactors >= ANALYSIS.adjustedFrom ? 'adjusted' : 'simple',
    factors: { ...factors, chanceNote: shown > ANALYSIS.manyComparisons ? CHANCE_NOTE : null },
    adjusted,
    adjustedNote: ADJUSTED_NOTE,
    doseResponse: doses,
    carryOver: carry,
    bestWorst: bestWorst(rows, names),
    weekday: weekdayWeekend(rows, new Map(input.timing)),
  }
}

/** A short, stable hash of the input, for the cache. */
export function inputHash(input: AnalysisInput): string {
  const s = JSON.stringify(input)
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = Math.imul(h2 ^ c, 2246822507)
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${s.length.toString(36)}`
}

export { OUTCOME_BY_KEY }
