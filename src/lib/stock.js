// The stock room: every vial you physically own, apart from your active stack.
//
// Library → Stock → Stack. The library says what a compound is and how it's
// dosed; stock is the boxes on the shelf; the stack is what's actually running.
// Activating pulls one vial out of a batch and carries the library's dosing,
// ladder and reconstitution across, so nothing is retyped.
//
// A vial's life is Sealed → Active → Finished.
//
// A *batch* is a group of identical sealed vials: same peptide, same size, same
// vendor, bought together. Two batches of the same peptide are normal and are
// kept apart on purpose — a 10 mg from one vendor and a 20 mg from another are
// different things to draw from, and lumping them into one number would lose
// both the size and the provenance.

import { unitsFor, concentration, isPremixed, isNasal } from './calc'
import { currentRung, dosesPerWeek, addDaysStr, prettyDate } from './schedule'
import { toMg } from './calc'

export const VIAL_STATES = ['sealed', 'active', 'finished']

/** Every batch of one peptide. */
export function batchesFor(vials = [], peptideId) {
  return vials.filter((v) => v.peptideId === peptideId)
}

/** Sealed vials of one peptide, across every batch. */
export function sealedCount(vials = [], peptideId) {
  return batchesFor(vials, peptideId).reduce((n, v) => n + Math.max(0, v.qtyOnHand || 0), 0)
}

/** Total sealed mg of one peptide, across batches of differing sizes. */
export function sealedMg(vials = [], peptideId) {
  return batchesFor(vials, peptideId).reduce((n, v) => n + Math.max(0, v.qtyOnHand || 0) * (v.vialMg || 0), 0)
}

/**
 * "2× 10 mg (Vendor A), 1× 20 mg (Vendor B)" — the breakdown that makes a
 * single total honest. Empty batches are left out; a batch with no vendor just
 * omits the bracket rather than printing an empty one.
 */
export function breakdownText(batches = []) {
  return batches
    .filter((b) => (b.qtyOnHand || 0) > 0)
    .map((b) => `${b.qtyOnHand}× ${b.vialMg} mg${b.vendor ? ` (${b.vendor})` : ''}`)
    .join(', ')
}

/** One line per peptide: the total, and what it's made of. */
export function summaryLine(name, batches = []) {
  const n = batches.reduce((s, b) => s + Math.max(0, b.qtyOnHand || 0), 0)
  if (n === 0) return `${name} — none in stock`
  const breakdown = breakdownText(batches)
  return `${name} — ${n} vial${n === 1 ? '' : 's'}${breakdown ? `: ${breakdown}` : ''}`
}

/**
 * Stock grouped by peptide, for the screen. Peptides with nothing on the shelf
 * are still listed when they're in the stack — "you have none of this" is the
 * most important row on the page, and hiding it is how you run out.
 */
export function groupStock(vials = [], peptides = []) {
  const byId = new Map()
  for (const p of peptides) {
    byId.set(p.id, { peptideId: p.id, name: p.name, inStack: true, batches: [] })
  }
  for (const v of vials) {
    if (!byId.has(v.peptideId)) {
      byId.set(v.peptideId, {
        peptideId: v.peptideId,
        name: v.name || v.peptideId,
        inStack: false,
        batches: [],
      })
    }
    byId.get(v.peptideId).batches.push(v)
  }
  return [...byId.values()]
    .map((g) => {
      const vialCount = g.batches.reduce((s, b) => s + Math.max(0, b.qtyOnHand || 0), 0)
      const mg = g.batches.reduce((s, b) => s + Math.max(0, b.qtyOnHand || 0) * (b.vialMg || 0), 0)
      return {
        ...g,
        vialCount,
        mg: Math.round(mg * 100) / 100,
        breakdown: breakdownText(g.batches),
        summary: summaryLine(g.name, g.batches),
        batchCount: g.batches.length,
      }
    })
    .sort((a, b) => {
      // what you're running comes first, then alphabetically
      if (a.inStack !== b.inStack) return a.inStack ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

/** A blank batch for the add form — the vial size is the only thing pre-filled. */
export function blankBatch(peptide) {
  return {
    peptideId: peptide?.id || '',
    name: peptide?.name || '',
    vialMg: peptide?.recon?.vialMg || 0,
    vendor: '',
    qtyOnHand: 1,
    costAud: 0,
    lot: '',
    sealedExpiry: '',
    coaKey: null,
  }
}

// ------------------------------------------------------- the active vial

/**
 * How much has been drawn out of the vial currently in use.
 *
 * Read from the dose log rather than kept as a running total, so it never
 * drifts out of step with what was actually recorded — and so changing dose,
 * titration, frequency or cycle simply changes the drain rate with no
 * recalibration anywhere. Deleting a mis-logged dose puts the volume back.
 */
export function mlDrawnSince(doseLogs = [], peptideId, sinceIso) {
  let units = 0
  for (const l of doseLogs) {
    if (l.peptideId !== peptideId) continue
    const stamp = String(l.loggedAt || l.date || '')
    if (sinceIso && stamp < sinceIso) continue
    units += Number(l.insulinUnits) || 0
  }
  return Math.round(units) / 100 // 1 unit = 0.01 mL on a U-100 syringe
}

/** The volume the active vial holds once made up (or as supplied, pre-mixed). */
export function vialVolumeMl(peptide, openVial) {
  const mg = openVial?.vialMg ?? peptide?.recon?.vialMg ?? 0
  if (isPremixed(peptide)) return peptide?.recon?.bacMl || 0
  // a reconstituted vial holds whatever water went in, whatever its mg
  return peptide?.recon?.bacMl || 0
}

/**
 * "~X doses left in this vial", from what's actually been logged.
 *
 * Returns null where the question doesn't apply — a nasal spray isn't drawn,
 * and a vial that was never activated has nothing to count down.
 */
export function activeVialStatus(peptide, tState, openVial, doseLogs = []) {
  if (!peptide || isNasal(peptide)) return null
  const capacityMl = vialVolumeMl(peptide, openVial)
  if (!(capacityMl > 0)) return null

  const drawnMl = mlDrawnSince(doseLogs, peptide.id, openVial?.activatedAt)
  const leftMl = Math.max(0, Math.round((capacityMl - drawnMl) * 1000) / 1000)

  const { dose } = currentRung(peptide, tState)
  const perDoseUnits = unitsFor(peptide, dose)
  const perDoseMl = (perDoseUnits || 0) / 100
  // Rounded a hair before flooring: 1.4 / 0.2 is 6.999… in binary floating
  // point, and a vial with exactly seven doses left must not read as six.
  const dosesLeft = perDoseMl > 0
    ? Math.floor(Math.round((leftMl / perDoseMl) * 1e6) / 1e6)
    : null

  return {
    capacityMl,
    drawnMl: Math.round(drawnMl * 1000) / 1000,
    leftMl,
    perDoseMl: Math.round(perDoseMl * 1000) / 1000,
    perDoseUnits,
    dosesLeft,
    pctLeft: capacityMl > 0 ? Math.max(0, Math.min(1, leftMl / capacityMl)) : 0,
    empty: dosesLeft != null && dosesLeft <= 0,
    activatedAt: openVial?.activatedAt || null,
    vialMg: openVial?.vialMg ?? peptide?.recon?.vialMg ?? 0,
  }
}

/** How much drug (mg) is left in the vial currently in use — the open half of the total. */
export function openVialRemainingMg(peptide, openVial, doseLogs = []) {
  if (!peptide || isNasal(peptide)) return 0
  const capacityMl = vialVolumeMl(peptide, openVial)
  const vialMg = openVial?.vialMg ?? 0
  if (!(capacityMl > 0) || !(vialMg > 0)) return 0
  const drawnMl = mlDrawnSince(doseLogs, peptide.id, openVial?.activatedAt)
  const leftMl = Math.max(0, capacityMl - drawnMl)
  return Math.max(0, (leftMl / capacityMl) * vialMg)
}

// ------------------------------------------------------------ low stock

/**
 * How long the sealed shelf lasts at the current burn rate.
 *
 * Deliberately counts only sealed vials: the one that's open is already being
 * drained and shows its own "doses left". Mixing the two produces a number that
 * looks fine right up until the moment it isn't.
 */
/**
 * The fraction of time a cycled compound is actually being taken. A 2-weeks-on/
 * 2-weeks-off peptide burns through its shelf at half the rate its per-dose
 * weekly figure suggests — an "ongoing" compound (either cycle field unset)
 * is on 100% of the time.
 */
export function cycleDutyFraction(peptide) {
  const on = peptide?.cycleOnDays || 0
  const off = peptide?.cycleOffDays || 0
  if (!on || !off) return 1
  return on / (on + off)
}

/** Real mg/week burn rate at the current rung, discounted for cycle off-time. */
export function weeklyUsageMg(peptide, tState) {
  const { dose } = currentRung(peptide, tState)
  const raw = dosesPerWeek(peptide.frequency) * toMg(dose, peptide.ladder?.unit)
  return raw * cycleDutyFraction(peptide)
}

export function coverageFor(peptide, tState, vials = [], todayStr) {
  const mgOnShelf = sealedMg(vials, peptide.id)
  const perWeekMg = weeklyUsageMg(peptide, tState)
  if (!(perWeekMg > 0)) return { weeks: Infinity, days: Infinity, mgOnShelf, vials: sealedCount(vials, peptide.id) }
  const weeks = mgOnShelf / perWeekMg
  const days = Math.floor(weeks * 7)
  return {
    weeks: Math.round(weeks * 10) / 10,
    days,
    runOutDate: todayStr ? addDaysStr(todayStr, days) : null,
    mgOnShelf,
    vials: sealedCount(vials, peptide.id),
    perWeekMg,
  }
}

/** Plain wording for how much runway is left. */
export function coverageWords(weeks) {
  if (!isFinite(weeks)) return 'plenty'
  if (weeks < 1) return 'under a week'
  if (weeks < 2) return '~1 week'
  if (weeks < 8) return `~${Math.round(weeks)} weeks`
  return `~${Math.round(weeks / 4)} months`
}

/**
 * How long a stretch of days reads naturally — under two weeks as days, under
 * ten weeks as weeks, under two years as months, otherwise years. A single
 * scale (weeks only) makes "412 days" and "3 days" both say "~59 weeks" and
 * "0 weeks", neither of which anyone actually thinks in.
 */
export function durationWords(days) {
  if (days == null || !isFinite(days)) return null
  if (days <= 0) return 'out now'
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 70) {
    const weeks = Math.round(days / 7)
    return `~${weeks} week${weeks === 1 ? '' : 's'}`
  }
  if (days < 730) {
    const months = Math.round(days / 30.44)
    return `~${months} month${months === 1 ? '' : 's'}`
  }
  const years = Math.round((days / 365.25) * 10) / 10
  return `~${years} year${years === 1 ? '' : 's'}`
}

/**
 * Everything you have of one peptide — the vial already open plus every sealed
 * batch on the shelf — set against your real burn rate, cycle off-time
 * included. This is the number that answers "when do I actually run out",
 * which neither the open vial's countdown nor the sealed shelf's coverage
 * answers alone.
 */
export function runwayFor(peptide, tState, openVial, vials = [], doseLogs = [], todayStr, leadDays = 30) {
  if (!peptide || isNasal(peptide)) return null
  const perWeekMg = weeklyUsageMg(peptide, tState)
  const openMg = openVialRemainingMg(peptide, openVial, doseLogs)
  const shelfMg = sealedMg(vials, peptide.id)
  const totalMg = openMg + shelfMg

  if (!(perWeekMg > 0)) {
    return {
      totalMg, perWeekMg: 0, days: Infinity, runOutDate: null, restockByDate: null,
      low: false, out: totalMg <= 1e-9, vials: sealedCount(vials, peptide.id),
    }
  }

  const days = Math.floor((totalMg / perWeekMg) * 7)
  const runOutDate = todayStr ? addDaysStr(todayStr, days) : null
  const restockByDate = runOutDate ? addDaysStr(runOutDate, -leadDays) : null

  return {
    totalMg: Math.round(totalMg * 100) / 100,
    perWeekMg,
    days,
    runOutDate,
    restockByDate,
    low: days <= leadDays,
    out: totalMg <= 1e-9,
    vials: sealedCount(vials, peptide.id),
  }
}

/**
 * Low-stock alerts across the stack, ordered by urgency.
 *
 * Tied to the restock lead time rather than a fixed threshold: the point at
 * which to reorder is the point at which a new order would not arrive in time,
 * and that depends on how long delivery takes. Counts the open vial as well as
 * the sealed shelf, so a peptide with nothing sealed but a nearly-full vial in
 * use doesn't read as urgent when it isn't.
 */
export function lowStockAlerts({ peptides = [], titration = {}, vials = [], openVials = {}, doseLogs = [], todayStr, leadDays = 30 }) {
  const out = []
  for (const p of peptides) {
    if (isNasal(p)) continue
    const r = runwayFor(p, titration[p.id], openVials[p.id], vials, doseLogs, todayStr, leadDays)
    if (!r || !isFinite(r.days) || !r.low) continue
    out.push({
      peptideId: p.id,
      name: p.name,
      days: r.days,
      runOutDate: r.runOutDate,
      restockByDate: r.restockByDate,
      vials: r.vials,
      level: r.out ? 'out' : r.days <= Math.round(leadDays / 2) ? 'urgent' : 'soon',
      message: r.out
        ? `No ${p.name} left — reorder`
        : `${durationWords(r.days)} of ${p.name} left — restock by ${prettyDate(r.restockByDate)}`,
    })
  }
  return out.sort((a, b) => a.days - b.days)
}

// --------------------------------------------------------- the replace flow

/**
 * What can replace a finished vial: any sealed batch of the same peptide,
 * whatever size or vendor. Size differences are fine — the concentration and
 * the units are recomputed from whatever actually gets activated.
 */
export function replacementsFor(vials = [], peptideId) {
  return batchesFor(vials, peptideId)
    .filter((b) => (b.qtyOnHand || 0) > 0)
    .sort((a, b) => {
      // oldest sealed-expiry first, so the one closest to turning is used up
      if (a.sealedExpiry && b.sealedExpiry) return a.sealedExpiry.localeCompare(b.sealedExpiry)
      if (a.sealedExpiry) return -1
      if (b.sealedExpiry) return 1
      return (a.vialMg || 0) - (b.vialMg || 0)
    })
}

/**
 * What activating a given batch would change, so the screen can say it before
 * the user commits. A different vial size means a different concentration and
 * therefore a different number of units for the very same dose — which is
 * exactly the sort of change that deserves to be stated out loud.
 */
export function activationPreview(peptide, tState, batch) {
  if (!peptide || !batch) return null
  const oldMg = peptide.recon?.vialMg || 0
  const newMg = batch.vialMg || 0
  const bacMl = peptide.recon?.bacMl || 0
  const { dose } = currentRung(peptide, tState)

  const oldConc = concentration(oldMg, bacMl)
  const newConc = concentration(newMg, bacMl)
  const oldUnits = unitsFor(peptide, dose)
  const newUnits = unitsFor({ ...peptide, recon: { ...peptide.recon, vialMg: newMg } }, dose)

  return {
    sameSize: oldMg === newMg,
    oldMg, newMg, bacMl,
    oldConc: Math.round(oldConc * 1000) / 1000,
    newConc: Math.round(newConc * 1000) / 1000,
    oldUnits: Math.round((oldUnits || 0) * 10) / 10,
    newUnits: Math.round((newUnits || 0) * 10) / 10,
    dose,
    unit: peptide.ladder?.unit,
  }
}
