import { referenceFor, isExcludedTier } from './reference'
import { seedProtocolFor } from './wizardDefaults'

/**
 * Reading a dose out of the reference prose, for an estimate rather than a protocol.
 *
 * `wizardDefaults.parseDoseRange` is deliberately strict, because what it
 * produces becomes a ladder someone injects from: first sentence only, a
 * written range only, nothing that mentions another route. That strictness is
 * right there and wrong here. "Roughly how long will this vial last me" is a
 * shopping question, and it can be answered from a looser reading of the same
 * text as long as the reading is shown and labelled as an estimate.
 *
 * What it will not do is invent one. A reference that says "no established
 * figure", or quotes a number only to call it baseless, produces nothing here —
 * that sentence is the reference refusing, and passing it through as a silent
 * number would be the app putting words in its mouth.
 */

// Sentences that quote a figure in order to disown it. These have to be caught
// before the number in them is read, not after.
const DISCLAIMED = /no established figure|no basis|no trial basis|without basis|without support|are invented|extrapolation from rodent|not established|individualised|varies entirely/i

// Routes this app does not inject. A sentence about them is about a different
// dose — unless it also names an injectable route, as "IV/IM" does.
const OTHER_ROUTE = /\borals?\b|\borally\b|\biv\b|intravenous|infusion|topical|cosmetic|intranasal|per spray|\bsublingual\b/i
const INJECTABLE = /\bsub-?cutaneous\b|\bsubq\b|\bsc\b|\bim\b|\bintramuscular\b|injectable|injection/i

// The dose someone settles on, rather than the one they start at. A titration
// list is mostly numbers you pass through on the way somewhere.
const MAINTENANCE = /maintenance|commonly|typically|community (?:male )?use often|community range/i

const NUM = String.raw`\d+(?:\.\d+)?`
const RANGE = new RegExp(String.raw`(${NUM})\s*(?:-|–|—|\s+to\s+)\s*(${NUM})\s*(mcg|mg)\b`, 'i')
const SINGLE = new RegExp(String.raw`(?:^|[^\d.])(${NUM})\s*(mcg|mg)\b`, 'i')
// A figure the reference gives in units this app cannot turn into milligrams.
// Knowing that is different from knowing nothing, and the card says which.
const UNCONVERTIBLE = new RegExp(String.raw`${NUM}\s*(IU|ml|mL|units?)\b`)

/** Sentences, and the clauses inside them — "…oral; community injectable 300 mcg". */
function clauses(text) {
  return String(text || '')
    .split(/(?<=[.)])\s+(?=[A-Z])|;\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function readFigure(text, maintenance) {
  const r = RANGE.exec(text)
  if (r) {
    const lo = parseFloat(r[1])
    const hi = parseFloat(r[2])
    if (lo > 0 && hi >= lo) return { lo, hi, unit: r[3].toLowerCase(), maintenance }
  }
  const s = SINGLE.exec(text)
  if (s) {
    const v = parseFloat(s[1])
    if (v > 0) return { lo: v, hi: v, unit: s[2].toLowerCase(), maintenance }
  }
  return null
}

function readClause(c) {
  if (DISCLAIMED.test(c)) return null
  if (OTHER_ROUTE.test(c) && !INJECTABLE.test(c)) return null

  // "2.4 mg maintenance" and "Maintenance commonly 10-15 mg" both say the dose
  // someone ends up on, and it sits on either side of the word. Reading the
  // window around it rather than the whole clause is what stops a titration
  // list handing back the first rung — 0.25 mg is where semaglutide starts,
  // not what a vial of it gets used up at.
  const m = MAINTENANCE.exec(c)
  if (m) {
    const near = c.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)
    const hit = readFigure(near, true)
    if (hit) return hit
  }
  return readFigure(c, !!m)
}

/**
 * The anecdotal dose for one compound.
 *
 * Returns the range as written plus the single figure an estimate should run
 * on: the low end, because that is the rung the wizard would start this
 * compound at, so the number on the shelf agrees with the number the protocol
 * would show the moment it was added.
 *
 * `null` means the reference genuinely offers nothing, and `reason` says which
 * kind of nothing it was — the Stock room prints that instead of a duration.
 */
export function anecdotalDose(idOrPeptide) {
  const ref = referenceFor(idOrPeptide)
  if (!ref) return { dose: null, reason: 'unknown', text: '' }
  if (isExcludedTier(ref.tier)) {
    return { dose: null, reason: 'withheld', text: '', tier: ref.tier, name: ref.name }
  }

  const text = String(ref.dose || '')

  // The app ships a full protocol for eleven of these. That protocol is its own
  // considered reading of the same anecdote, already reviewed, already what the
  // wizard would set — so it wins over re-parsing the prose underneath it.
  const seed = seedProtocolFor(ref.id)
  if (seed?.ladder?.floor > 0) {
    return {
      dose: seed.ladder.floor,
      lo: seed.ladder.floor,
      hi: seed.ladder.ceiling,
      unit: seed.ladder.unit,
      isRange: seed.ladder.ceiling > seed.ladder.floor,
      maintenance: false,
      fromSeed: true,
      frequency: seed.frequency,
      cycleOnDays: seed.cycleOnDays || 0,
      cycleOffDays: seed.cycleOffDays || 0,
      reason: null,
      text, tier: ref.tier, name: ref.name,
    }
  }

  const parts = clauses(text)
  const found = parts.map(readClause).filter(Boolean)

  if (found.length === 0) {
    // Distinguish "the reference has no number" from "it has one this app
    // cannot use" — IU and millilitres need a potency the reference never gives.
    const unconvertible = parts.some((c) => !DISCLAIMED.test(c) && UNCONVERTIBLE.test(c))
    const blend = /dosed as a unit|vendor'?s? (?:fixed )?ratio|follows? the individual/i.test(text)
    return {
      dose: null,
      reason: blend ? 'blend' : unconvertible ? 'unconvertible' : 'unstated',
      text, tier: ref.tier, name: ref.name,
    }
  }

  // A stated maintenance dose beats a titration step on the way to it.
  const pick = found.find((f) => f.maintenance) || found[0]
  return {
    dose: pick.lo,
    lo: pick.lo,
    hi: pick.hi,
    unit: pick.unit,
    isRange: pick.hi > pick.lo,
    maintenance: pick.maintenance,
    reason: null,
    text, tier: ref.tier, name: ref.name,
  }
}

/** "100–300 mcg" / "1.6 mg" — the range as the reference actually wrote it. */
export function doseWords(a) {
  if (!a?.dose) return null
  return a.isRange ? `${a.lo}–${a.hi} ${a.unit}` : `${a.lo} ${a.unit}`
}

// Written as fragments that follow "No dose to measure against — ", so the
// line reads as one sentence and "IU" keeps its capitals.
export const NO_DOSE_REASON = {
  withheld: 'dosing is deliberately withheld for this one',
  blend: 'a blend, dosed at the vendor\'s ratio rather than as one figure',
  unconvertible: 'the reference gives this in IU or mL, not milligrams',
  unstated: 'the reference states none for this one',
  unknown: 'it is not in the reference',
}
