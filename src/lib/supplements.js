// Oral supplements — tablets, capsules, powders, sprays, liquids.
//
// Tracked like the peptide stack minus everything that belongs to a needle:
// no injection site, no co-draw, no insulin units. A supplement has a name, a
// form, a dose written as free text (because "2 sprays" and "3 g" are both
// real answers), and an AM/PM slot.
//
// Doses in the library are evidence-based optimal ranges rather than label
// RDIs. They are starting points to check, not instructions — every one is
// editable, and some (vitamin D especially) really want a blood test behind
// them rather than a number from an app.

import LIB from '../data/supplement_library.json'

export const SUPPLEMENT_NOTE = LIB.note
export const FORMS = LIB.forms
export const LIBRARY = LIB.supplements

export const SLOTS = ['AM', 'PM']

/** Icon per form, so a powder never looks like a tablet at a glance. */
export const FORM_ICON = {
  tablet: 'Pill', capsule: 'Pill', powder: 'Scoop', spray: 'SprayCan', liquid: 'Droplet',
}

/** Plain wording for the form, used wherever the dose is shown. */
export const FORM_LABEL = {
  tablet: 'Tablet', capsule: 'Capsule', powder: 'Powder', spray: 'Spray', liquid: 'Liquid',
}

/**
 * Where a supplement lands by default.
 *
 * The rule is category-driven — `daily` in the morning, `sleep` at night — but
 * an explicit slot in the library wins, because a few entries are deliberately
 * placed against the rule (ashwagandha is a `daily` supplement the data puts in
 * the evening, on purpose). Either way the user can move it.
 */
export function defaultSlotFor(entry = {}) {
  if (entry.slot === 'AM' || entry.slot === 'PM') return entry.slot
  return entry.category === 'sleep' ? 'PM' : 'AM'
}

/** What the category rule says on its own, ignoring any explicit slot. */
export function slotForCategory(category) {
  return category === 'sleep' ? 'PM' : 'AM'
}

/** The library split into what the user already owns and what they could add. */
export function libraryShelf() {
  return {
    owned: LIBRARY.filter((s) => s.owned),
    available: LIBRARY.filter((s) => !s.owned),
  }
}

/** Substring search over name and brand, owned entries ranked first. */
export function searchLibrary(query = '') {
  const q = query.trim().toLowerCase()
  const hit = (s) => !q
    || s.name.toLowerCase().includes(q)
    || (s.brand || '').toLowerCase().includes(q)
  return LIBRARY.filter(hit).sort((a, b) => {
    if (!!b.owned !== !!a.owned) return b.owned ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

/** A stack entry built from a library row — every field editable afterwards. */
export function fromLibrary(entry) {
  return {
    libraryId: entry.id,
    name: entry.name,
    brand: entry.brand || '',
    form: entry.form || 'capsule',
    dose: entry.optimal_dose || '',
    doseNote: entry.dose_note || '',
    caution: entry.caution || '',
    category: entry.category || 'daily',
    slot: defaultSlotFor(entry),
  }
}

/** A blank entry for the manual path — nothing invented. */
export function blankSupplement() {
  return {
    libraryId: null, name: '', brand: '', form: 'capsule',
    dose: '', doseNote: '', caution: '', category: 'daily', slot: 'AM',
  }
}

/** The user's shelf, split by slot, in the order they'd take them. */
export function bySlot(supplements = []) {
  const out = { AM: [], PM: [] }
  for (const s of supplements) (out[s.slot === 'PM' ? 'PM' : 'AM']).push(s)
  for (const k of SLOTS) out[k].sort((a, b) => a.name.localeCompare(b.name))
  return out
}

/** Supplements due in a slot on a date. Every one is a daily habit. */
export function dueInSlot(supplements = [], slot = 'AM') {
  return supplements.filter((s) => (s.slot === 'PM' ? 'PM' : 'AM') === slot)
}

/** Did this supplement get taken on this date? */
export function wasTaken(supplementLogs = [], supplementId, dateStr) {
  return supplementLogs.some((l) => l.supplementId === supplementId && l.date === dateStr)
}

/** The ids taken on a date, for counting without a scan per supplement. */
export function takenOn(supplementLogs = [], dateStr) {
  return new Set(supplementLogs.filter((l) => l.date === dateStr).map((l) => l.supplementId))
}

/** Supplements sharing an ingredient the total of which matters. */
const STACKED_INGREDIENTS = [
  {
    id: 'magnesium',
    match: /magnesium|magzorb/i,
    text: 'More than one magnesium product on your shelf — keep combined supplemental elemental magnesium around 300–400 mg/day, or expect loose stools.',
  },
]

/**
 * Cautions worth surfacing, given what is actually on the shelf.
 *
 * Two kinds. The library flags some entries itself (berberine stacking with the
 * glucose-lowering peptides). The other kind only exists as a combination — two
 * separate magnesium products are each fine alone and a double dose together —
 * so it is computed from what the user has added rather than stored on a row.
 */
export function activeCautions(supplements = []) {
  const out = []
  for (const s of supplements) {
    if (s.caution) out.push({ id: `own-${s.id}`, name: s.name, text: s.caution })
  }
  return out
}

/** Combination warnings that only exist because of what's on the shelf together. */
export function stackedCautions(supplements = []) {
  const out = []
  for (const rule of STACKED_INGREDIENTS) {
    const hits = supplements.filter((s) => rule.match.test(`${s.name} ${s.brand || ''}`))
    if (hits.length > 1) {
      out.push({ id: `stack-${rule.id}`, name: hits.map((h) => h.name).join(' + '), text: rule.text })
    }
  }
  return out
}

/**
 * Everything worth warning about, once.
 *
 * Two magnesium products each carry their own "watch the total" note, and the
 * combination rule says it a third time. Three versions of one warning is how a
 * warning gets ignored, so when a combination rule fires it absorbs the
 * per-product notes that are about the same ingredient.
 */
export function allCautions(supplements = []) {
  const stacked = stackedCautions(supplements)
  const covered = STACKED_INGREDIENTS.filter((r) => stacked.some((c) => c.id === `stack-${r.id}`))
  const own = activeCautions(supplements).filter(
    (c) => !covered.some((r) => r.match.test(c.name))
  )
  const seen = new Set()
  return [...stacked, ...own].filter((c) => (seen.has(c.text) ? false : seen.add(c.text)))
}

/**
 * Adherence over a window. Every supplement is a daily habit, so scheduled is
 * simply one per day per supplement from the day it was added.
 */
export function supplementAdherence(supplements = [], logs = [], fromStr, toStr) {
  const rows = supplements.map((s) => {
    const start = s.addedOn && s.addedOn > fromStr ? s.addedOn : fromStr
    const days = dayCount(start, toStr)
    const taken = new Set(
      logs.filter((l) => l.supplementId === s.id && l.date >= start && l.date <= toStr)
        .map((l) => l.date)
    ).size
    return {
      supplementId: s.id, name: s.name, scheduled: days, taken,
      missed: Math.max(0, days - taken),
      pct: days === 0 ? null : Math.round((taken / days) * 100),
    }
  })
  const scheduled = rows.reduce((n, r) => n + r.scheduled, 0)
  const taken = rows.reduce((n, r) => n + r.taken, 0)
  return {
    rows: rows.filter((r) => r.scheduled > 0).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)),
    overall: {
      scheduled, taken, missed: Math.max(0, scheduled - taken),
      pct: scheduled === 0 ? null : Math.round((taken / scheduled) * 100),
    },
  }
}

function dayCount(fromStr, toStr) {
  if (!fromStr || !toStr || fromStr > toStr) return 0
  const a = new Date(`${fromStr}T00:00:00`)
  const b = new Date(`${toStr}T00:00:00`)
  return Math.round((b - a) / 86400000) + 1
}
