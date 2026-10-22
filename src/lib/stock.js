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

import { toMg } from './calc'
import { currentRung, dosesPerWeek, addDaysStr, daysBetween } from './schedule'
import { referenceUsdPerVial } from './cost'
import { drawsPerWeek } from './drawdown'
import { isPausedOn } from './pauses'
import { remainingMg, forecastRunOut, sharedMgPerDay, orderLeadDays } from './vials'

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
    usdPerVial: referenceUsdPerVial(peptide),
    lot: '',
    sealedExpiry: '',
    coaKey: null,
  }
}

// ------------------------------------------------------- the active vial

/**
 * How much drug (mg) is left in the vial currently in use: its total less every
 * dose logged since it was opened (lib/vials). Never negative here; an overfilled
 * vial shows its overrun in the Stock screen, not in a total.
 */
export function openVialRemainingMg(peptide, openVial, doseLogs = [], sharedDraws = []) {
  if (!peptide || !openVial) return 0
  return Math.max(0, remainingMg(openVial, doseLogs, sharedDraws))
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

/** Real mg/week burn rate at the current rung, averaged over the cycle (a rest uses nothing). */
export function weeklyUsageMg(peptide, tState) {
  const { dose } = currentRung(peptide, tState)
  const raw = dosesPerWeek(peptide.frequency) * toMg(dose, peptide.ladder?.unit)
  return raw * cycleDutyFraction(peptide)
}

/**
 * The same figure, plus whatever anyone else draws off the same vials.
 *
 * A vial two people share empties roughly twice as fast, so a run-out date that
 * only counts the owner's doses is a date that arrives with an empty fridge.
 * The extra profiles are not on a cycle — they are somebody else's protocol —
 * so their draw is counted flat.
 */
export function sharedWeeklyUsageMg(peptide, tState, vials = []) {
  const mine = weeklyUsageMg(peptide, tState)
  const others = vials
    .filter((v) => v.peptideId === peptide?.id)
    .flatMap((v) => v.drawProfiles || [])
    .reduce((sum, d) => sum + (d.doseMg > 0 ? d.doseMg * drawsPerWeek(d) : 0), 0)
  return mine + others
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
export function runwayFor(peptide, tState, openVial, vials = [], doseLogs = [], todayStr, _leadDays = 30, pauses = [], extra = {}) {
  // Milligrams are milligrams: toMg converts a spray like any other unit, so a
  // nasal bottle has a run-out date like anyone else.
  if (!peptide) return null
  const { pushes = [], sharedDraws = [] } = extra
  // shared, so the restock date agrees with the vial's own figure
  const perWeekMg = sharedWeeklyUsageMg(peptide, tState, vials)
  const openMg = openVialRemainingMg(peptide, openVial, doseLogs, sharedDraws)
  const shelfMg = sealedMg(vials, peptide.id)
  const totalMg = openMg + shelfMg
  const lead = orderLeadDays(peptide)
  const nSealed = sealedCount(vials, peptide.id)

  if (!(perWeekMg > 0)) {
    return {
      totalMg, perWeekMg: 0, days: Infinity, runOutDate: null, restockByDate: null,
      low: false, out: totalMg <= 1e-9, vials: nSealed,
    }
  }
  if (!todayStr) {
    const days = Math.floor((totalMg / perWeekMg) * 7)
    return { totalMg: Math.round(totalMg * 100) / 100, perWeekMg, days, runOutDate: null, restockByDate: null, low: days <= lead, out: totalMg <= 1e-9, vials: nSealed }
  }

  // Walked through the real future schedule (titration steps, cycles, pauses,
  // frequency), the same walk the Stock screen and the order notice use.
  const fc = forecastRunOut({
    peptide, tState, totalMg, todayStr, pushes, pauses, sharedPerDay: sharedMgPerDay(vials, peptide.id),
  })
  if (fc.none) {
    return { totalMg, perWeekMg, days: Infinity, runOutDate: null, restockByDate: null, low: false, out: totalMg <= 1e-9, vials: nSealed }
  }
  if (!fc.runOutDate) {
    // nothing is owed for the whole horizon: paused with no end, or a long rest
    const stopped = !!pauses.length && isPausedOn(pauses, peptide.id, addDaysStr(todayStr, 539))
    return {
      totalMg: Math.round(totalMg * 100) / 100, perWeekMg, days: Infinity, runOutDate: null, restockByDate: null,
      pausedIndefinitely: stopped, low: false, out: totalMg <= 1e-9, vials: nSealed,
    }
  }
  const days = daysBetween(todayStr, fc.runOutDate)
  return {
    totalMg: Math.round(totalMg * 100) / 100,
    perWeekMg,
    days,
    consumingDays: fc.consumingDays,
    pausedDays: fc.pausedDays,
    offCycleDays: fc.offCycleDays,
    runOutDate: fc.runOutDate,
    restockByDate: addDaysStr(fc.runOutDate, -lead),
    low: days <= lead,
    out: totalMg <= 1e-9,
    vials: nSealed,
  }
}
