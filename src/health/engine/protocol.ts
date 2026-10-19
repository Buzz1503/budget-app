// Protocol context for Health: which compounds can move recovery numbers, and
// which of their events reset the baselines.

import { PROTOCOL } from './config'
import type { ProtocolEvent } from './baseline'
import { daysBetween } from '../tz'

export interface CompoundLike {
  id: string
  name: string
  affectsRecoveryBaseline?: boolean
  libraryId?: string | null
}

export interface TimelinePoint {
  date: string
  kind: string
  to?: number | null
  unit?: string | null
}

const GLP1 = /(semaglutide|tirzepatide|retatrutide|survodutide|mazdutide|ozempic|wegovy|mounjaro|zepbound)/i
const TESTOSTERONE = /(testosterone|test[ -]?(e|c|cyp|enan)\b|cypionate|enanthate|propionate|undecanoate)/i

export const isGlp1 = (c: CompoundLike) => GLP1.test(`${c.id} ${c.name} ${c.libraryId || ''}`)
export const isTestosterone = (c: CompoundLike) => TESTOSTERONE.test(`${c.id} ${c.name} ${c.libraryId || ''}`)

/** Default: GLP-1 class compounds and testosterone esters. */
export const defaultAffectsBaseline = (c: CompoundLike) => isGlp1(c) || isTestosterone(c)

/** The user's choice when they have made one, otherwise the default. */
export const affectsBaseline = (c: CompoundLike) => c.affectsRecoveryBaseline ?? defaultAffectsBaseline(c)

/** Dose timeline kinds that count as a start, stop or dose change. */
export const RELEVANT_KINDS = new Set(['start', 'restart', 'prior', 'step-up', 'override', 'stop'])

/** Start, stop and dose-change events for the compounds flagged as affecting baselines. */
export function relevantEvents(compounds: Array<CompoundLike & { points: TimelinePoint[] }>): ProtocolEvent[] {
  const out: ProtocolEvent[] = []
  for (const c of compounds) {
    if (!affectsBaseline(c)) continue
    for (const p of c.points) {
      if (RELEVANT_KINDS.has(p.kind)) out.push({ date: p.date, peptideId: c.id, name: c.name, kind: p.kind })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** True while a GLP-1 class compound started, stopped or changed dose in the last 14 days. */
export function glp1NoteDue(date: string, events: ProtocolEvent[], compounds: CompoundLike[]): boolean {
  return events.some((e) => {
    const c = compounds.find((x) => x.id === e.peptideId)
    if (!c || !isGlp1(c)) return false
    const ago = daysBetween(e.date, date)
    return ago >= 0 && ago <= PROTOCOL.glp1NoteDays
  })
}

export const GLP1_RHR_NOTE = 'Resting heart rate is commonly reported to rise with GLP-1 class compounds.'
