// Burn rate, run-out, cost and expiry math.
import { dosesPerWeek, currentRung, addDaysStr, daysBetween } from './schedule'
import { toMg } from './calc'
import { referenceUsdPerVial } from './cost'
import { forecastRunOut, sharedMgPerDay, fridgeLifeDays } from './vials'
import { isPausedOn } from './pauses'

export function vialsFor(vials, peptideId) {
  return vials.filter((v) => v.peptideId === peptideId)
}

export function totalMgOnHand(peptide, vials, openVial) {
  const sealed = vialsFor(vials, peptide.id).reduce((s, v) => s + v.qtyOnHand * v.vialMg, 0)
  return sealed + Math.max(0, openVial?.remainingMg || 0)
}

// mg consumed per day at the current confirmed dose + frequency
export function burnRatePerDay(peptide, tState) {
  const { dose } = currentRung(peptide, tState)
  const doseMg = toMg(dose, peptide.ladder.unit)
  return (dosesPerWeek(peptide.frequency) * doseMg) / 7
}

/**
 * When the stock on hand runs out.
 *
 * Walked through the real future schedule (titration steps, cycles, pauses,
 * frequency), the same walk the Stock screen and the order notice use, so a rest
 * or a pause moves the date later by exactly that many days and a step up moves
 * it earlier. `daysLeft` is calendar days until there is none left. An open-ended
 * pause has no end to count to, and says so rather than inventing one.
 *
 * `openVial` is the open-vial record with `remainingMg` filled in (see
 * `withRemaining` in lib/vials): what is left is worked out from the log.
 */
export function runOutInfo(peptide, tState, vials, openVial, todayStr, pauses = [], { pushes = [] } = {}) {
  const rate = burnRatePerDay(peptide, tState)
  const mg = totalMgOnHand(peptide, vials, openVial)
  if (rate <= 0) return { daysLeft: Infinity, runOutDate: null, mg }
  const fc = forecastRunOut({
    peptide, tState, totalMg: mg, todayStr, pushes, pauses, sharedPerDay: sharedMgPerDay(vials, peptide.id),
  })
  if (fc.none) return { daysLeft: Infinity, runOutDate: null, mg, rate }
  if (!fc.runOutDate) {
    const stopped = !!pauses.length && isPausedOn(pauses, peptide.id, addDaysStr(todayStr, 539))
    return { daysLeft: Infinity, runOutDate: null, mg, rate, pausedIndefinitely: stopped }
  }
  return {
    daysLeft: daysBetween(todayStr, fc.runOutDate), runOutDate: fc.runOutDate, mg, rate,
    consumingDays: fc.consumingDays, pausedDays: fc.pausedDays, offCycleDays: fc.offCycleDays,
  }
}

// Everything below is in USD, because USD is the only currency this app stores.
// The one exchange rate in Settings turns it into money at the moment it is
// drawn — see lib/cost.js.
export function totalSpendUsd(vials) {
  return vials.reduce((s, v) => s + (v.usdPerVial || 0) * (v.qtyPurchased ?? v.qtyOnHand), 0)
}

// Weighted average cost per mg from purchased vials → cost of the current dose.
// Falls back to the reference table when nothing has been bought yet, so a
// stack priced only by the catalogue still shows a figure.
export function costPerDoseUsd(peptide, tState, vials) {
  const mine = vialsFor(vials, peptide.id).filter((v) => v.usdPerVial != null)
  const { dose } = currentRung(peptide, tState)
  const doseMg = toMg(dose, peptide.ladder.unit)
  const totMg = mine.reduce((s, v) => s + v.vialMg * (v.qtyPurchased ?? v.qtyOnHand), 0)
  if (totMg > 0) {
    const totCost = mine.reduce((s, v) => s + v.usdPerVial * (v.qtyPurchased ?? v.qtyOnHand), 0)
    return doseMg * (totCost / totMg)
  }
  const ref = referenceUsdPerVial(peptide)
  const vialMg = peptide.recon?.vialMg
  if (ref == null || !(vialMg > 0)) return null
  return ref * (doseMg / vialMg)
}

export function expiryInfo(peptide, openVial, todayStr) {
  if (!openVial?.reconstitutedAt) return null
  // expiryDays 0 = no post-reconstitution clock to run (a pre-mixed oil vial
  // isn't reconstituted, so there's nothing to count down from).
  const days = fridgeLifeDays(peptide)
  if (!(days > 0)) return null
  const expiresAt = addDaysStr(openVial.reconstitutedAt, days)
  return { expiresAt, daysLeft: daysBetween(todayStr, expiresAt) }
}
