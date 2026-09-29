// Burn rate, run-out, cost and expiry math.
import { dosesPerWeek, currentRung, addDaysStr, daysBetween } from './schedule'
import { toMg } from './calc'
import { referenceUsdPerVial } from './cost'
import { advanceOverPauses } from './pauses'

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
 * Stock is drawn down by doses, not by dates, so a pause moves the run-out date
 * further into the calendar rather than letting it arrive on time with the vial
 * still full. `daysLeft` stays what it has always been — calendar days until
 * there is none left — so everything reading it for restock timing accounts for
 * the break without being told. An open-ended pause has no end to count to, and
 * says so rather than inventing one.
 */
export function runOutInfo(peptide, tState, vials, openVial, todayStr, pauses = []) {
  const rate = burnRatePerDay(peptide, tState)
  const mg = totalMgOnHand(peptide, vials, openVial)
  if (rate <= 0) return { daysLeft: Infinity, runOutDate: null, mg }
  const consumingDays = Math.floor(mg / rate)
  if (!pauses.length) {
    return { daysLeft: consumingDays, runOutDate: addDaysStr(todayStr, consumingDays), mg, rate, consumingDays, pausedDays: 0 }
  }
  const walk = advanceOverPauses(todayStr, consumingDays, peptide.id, pauses)
  if (walk.open) {
    return {
      daysLeft: Infinity, runOutDate: null, mg, rate, consumingDays,
      pausedDays: walk.pausedDays, pausedIndefinitely: true,
    }
  }
  return {
    daysLeft: consumingDays + walk.pausedDays,
    runOutDate: walk.date, mg, rate, consumingDays, pausedDays: walk.pausedDays,
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
  const days = peptide.recon?.expiryDays ?? 28
  if (!(days > 0)) return null
  const expiresAt = addDaysStr(openVial.reconstitutedAt, days)
  return { expiresAt, daysLeft: daysBetween(todayStr, expiresAt) }
}
