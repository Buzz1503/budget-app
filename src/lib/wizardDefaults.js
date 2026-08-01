// Grounded starting points for the "build my schedule" wizard.
//
// Two sources, in this order:
//   1. the app's own seed data, for the compounds it already ships a full
//      protocol for — those ladders and reconstitutions are used verbatim;
//   2. the evidence reference, for everything else.
//
// The reference's `dose` field is prose, so the parser here is deliberately
// narrow. It accepts ONLY an explicit low–high range with a unit, in the first
// sentence, and rejects anything describing a different route. A single number
// is never used: in this data those are nearly always a starting dose ("0.25 mg
// weekly x4wk"), a maximum ("up to 6.0 mg"), or another route ("1 mg daily
// oral") — turning any of them into a floor would invent a dose. When nothing
// parses, the ladder is left blank and the wizard says so rather than guessing.
import { referenceFor, isExcludedTier, referenceAttachment, protocolTextFrom } from './reference'
import { seedPeptides } from '../data/seed'
import { NASAL_RECIPE, MCG_PER_SPRAY } from './calc'

const SEED_BY_ID = new Map(seedPeptides('2026-01-01').map((p) => [p.id, p]))

export function seedProtocolFor(id) {
  return SEED_BY_ID.get(id) || null
}

const RANGE = /(\d+(?:\.\d+)?)\s*(?:-|–|—|\s+to\s+)\s*(\d+(?:\.\d+)?)\s*(mcg|mg)\b/i
// a range quoted for a route this app doesn't inject is not a starting point
const OTHER_ROUTE = /\b(oral|orally|iv\b|intravenous|infusion|topical|cosmetic|per compounding|ml per day)\b/i

// First sentence only — later ones drift into alternatives and other routes.
function firstSentence(text) {
  return String(text || '').trim().split(/(?<=[.)])\s+(?=[A-Z])/)[0] || ''
}

/** @returns {{lo:number, hi:number, unit:'mcg'|'mg'} | null} */
export function parseDoseRange(doseText) {
  const first = firstSentence(doseText)
  if (!first || OTHER_ROUTE.test(first)) return null
  const m = RANGE.exec(first)
  if (!m) return null
  const lo = parseFloat(m[1])
  const hi = parseFloat(m[2])
  const unit = m[3].toLowerCase()
  if (!(hi > lo) || !(lo > 0)) return null
  return { lo, hi, unit }
}

// A step that lands 3–4 rungs across the range, rounded to something you'd
// actually dial on a syringe.
export function niceStep(span, unit) {
  if (!(span > 0)) return 0
  const raw = span / 3
  const snap = (to, min) => Math.max(min, Math.round(Math.round(raw / to) * to * 1000) / 1000)
  if (unit === 'mcg') return snap(50, 50)
  if (raw < 0.5) return snap(0.05, 0.05)
  if (raw < 2) return snap(0.25, 0.25)
  if (raw < 10) return snap(0.5, 0.5)
  return Math.max(1, Math.round(raw))
}

export function ladderFromRange(range, intervalWeeks = 2) {
  if (!range) return null
  const step = niceStep(range.hi - range.lo, range.unit)
  return {
    floor: range.lo,
    ceiling: range.hi,
    step: Math.round(Math.min(step, range.hi - range.lo) * 1000) / 1000 || range.hi - range.lo,
    intervalWeeks,
    unit: range.unit,
  }
}

// Frequency + cycle guessed from the reference's own words. Only patterns that
// are unambiguous; anything else falls back to the app's daily default and the
// reference text is shown alongside so the user can see what it actually said.
const FREQ_RULES = [
  [/\bonce weekly|per week\b|weekly\b/i, 'weekly'],
  [/\btwice weekly|2x\s*weekly|two to three times weekly\b/i, '2xweek'],
  [/\bthree times (?:a )?week|3x\s*weekly\b/i, '3xweek'],
  [/\bevery other day|alternate days\b/i, '3xweek'],
  [/\bnightly|before bed|pre-?bed|at night\b/i, 'nightly'],
  [/\bdaily|per day|each day\b/i, 'daily'],
]

export function frequencyFrom(reference) {
  const text = `${reference?.frequency || ''} ${reference?.dose || ''}`
  // twice/three-times must win over the bare "weekly" they contain
  for (const [re, freq] of [...FREQ_RULES].sort((a, b) => (a[1] === 'weekly' ? 1 : -1))) {
    if (re.test(text)) return freq
  }
  return 'daily'
}

const NIGHT = /\bnightly|before bed|pre-?bed|at night|bedtime|sleep\b/i
export function slotFrom(reference) {
  const text = `${reference?.frequency || ''} ${reference?.dose || ''} ${reference?.mechanism || ''}`
  if (NIGHT.test(text)) return 'PM'
  return 'AM'
}

// "8wk on / 4wk off" style cycles, when the reference states one.
const CYCLE = /(\d+)\s*(?:wk|week)s?\s*(?:on)?\s*(?:,|\/|then|followed by|-)\s*(\d+)\s*(?:wk|week)s?\s*off/i
export function cycleFrom(reference) {
  const m = CYCLE.exec(reference?.cycle || '')
  if (m) return { cycleOnDays: parseInt(m[1], 10) * 7, cycleOffDays: parseInt(m[2], 10) * 7 }
  if (/not cycled|continuous/i.test(reference?.cycle || '')) return { cycleOnDays: 0, cycleOffDays: 0 }
  return { cycleOnDays: 0, cycleOffDays: 0 }
}

// A generic vial to start from when the reference says nothing about the
// container — the same default `addPeptide` already uses. Labelled as a default
// to check against the actual vial, never presented as a fact.
export const DEFAULT_RECON = { vialMg: 10, bacMl: 2, expiryDays: 28 }

export const INTRANASAL_IDS = new Set(['semax', 'selank'])

/**
 * Everything the wizard needs to open a peptide's step with grounded defaults.
 * `source` says where each protocol number came from, so the UI can be honest:
 *   'seed'      — the app's own full protocol for this compound
 *   'reference' — derived from a stated range in the evidence reference
 *   'none'      — nothing parseable; the user sets it
 */
export function wizardSuggestion(compound) {
  const id = typeof compound === 'string' ? compound : compound?.id
  const name = typeof compound === 'string' ? compound : (compound?.name || id)
  const reference = referenceFor(id)
  const excluded = isExcludedTier(reference?.tier)
  const seed = seedProtocolFor(id)
  const text = protocolTextFrom(reference) || { doseText: '', frequencyText: '', cycleText: '' }

  const base = {
    id,
    name: seed?.name || reference?.name || name,
    reference: reference ? referenceAttachment(reference) : null,
    tier: reference?.tier || null,
    confidence: reference?.confidence || null,
    mechanism: reference?.mechanism || '',
    established: reference?.established || [],
    reported: reference?.reported || [],
    safety: reference?.safety || [],
    doseText: text.doseText,
    frequencyText: text.frequencyText,
    cycleText: text.cycleText,
    excluded,
    intranasalCapable: INTRANASAL_IDS.has(id),
    routes: ['SubQ', 'IM', ...(INTRANASAL_IDS.has(id) ? ['Nasal'] : [])],
  }

  // TX: no dose, ever. The safety reason stands in its place.
  if (excluded) {
    return {
      ...base,
      source: 'excluded',
      ladder: null,
      recon: { ...DEFAULT_RECON },
      route: 'SubQ',
      frequency: 'daily',
      slot: 'AM',
      timing: '',
      cycleOnDays: 0,
      cycleOffDays: 0,
    }
  }

  if (seed) {
    return {
      ...base,
      source: 'seed',
      ladder: { ...seed.ladder },
      recon: { ...seed.recon },
      route: seed.route || 'SubQ',
      frequency: seed.frequency,
      slot: seed.slot || slotFrom(reference),
      timing: seed.timing || '',
      scheduleWeekdays: seed.scheduleWeekdays,
      cycleOnDays: seed.cycleOnDays || 0,
      cycleOffDays: seed.cycleOffDays || 0,
      vehicle: seed.vehicle,
      preparation: seed.preparation,
      alwaysSeparate: seed.alwaysSeparate,
      separateReason: seed.separateReason,
      rangeText: null,
    }
  }

  const range = parseDoseRange(reference?.dose)
  const ladder = ladderFromRange(range)
  return {
    ...base,
    source: ladder ? 'reference' : 'none',
    ladder,
    rangeText: range ? `${range.lo}–${range.hi} ${range.unit}` : null,
    recon: { ...DEFAULT_RECON },
    route: 'SubQ',
    frequency: frequencyFrom(reference),
    slot: slotFrom(reference),
    timing: '',
    ...cycleFrom(reference),
  }
}

// Applied when the user picks the intranasal route in the wizard: the same
// recipe and 200 mcg/spray the rest of the app uses.
export function nasalDefaults() {
  return {
    ladder: { floor: 1, step: 1, intervalWeeks: 1, ceiling: 3, unit: 'spray' },
    recon: { vialMg: NASAL_RECIPE.vialMg, bacMl: NASAL_RECIPE.bacMl, expiryDays: 28 },
    mcgPerSpray: MCG_PER_SPRAY,
  }
}

// A wizard entry → the shape `addPeptide` expects.
export function toPeptide(entry, startDate) {
  const out = {
    id: entry.id,
    name: entry.name,
    startDate,
    route: entry.route || 'SubQ',
    frequency: entry.frequency || 'daily',
    timing: entry.timing || '',
    slot: entry.slot || 'AM',
    cycleOnDays: entry.cycleOnDays || 0,
    cycleOffDays: entry.cycleOffDays || 0,
    recon: { ...(entry.recon || DEFAULT_RECON) },
    doseText: entry.doseText || '',
    frequencyText: entry.frequencyText || '',
    cycleText: entry.cycleText || '',
  }
  if (entry.scheduleWeekdays?.length) out.scheduleWeekdays = [...entry.scheduleWeekdays]
  if (entry.intranasalCapable) out.intranasalCapable = true
  if (entry.vehicle) out.vehicle = entry.vehicle
  if (entry.preparation) out.preparation = entry.preparation
  if (entry.alwaysSeparate) {
    out.alwaysSeparate = true
    out.separateReason = entry.separateReason
  }
  // A blank ladder is deliberate — the peptide lands in the Library flagged
  // "set your protocol" rather than carrying a number nobody stands behind.
  out.ladder = entry.ladder
    ? { ...entry.ladder }
    : { floor: 0, step: 0, intervalWeeks: 1, ceiling: 0, unit: 'mcg' }
  return out
}
