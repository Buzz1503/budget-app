// Burn rate, run-out, cost and expiry math.
import { dosesPerWeek, currentRung, addDaysStr, daysBetween } from './schedule'
import { toMg } from './calc'

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

export function runOutInfo(peptide, tState, vials, openVial, todayStr) {
  const rate = burnRatePerDay(peptide, tState)
  const mg = totalMgOnHand(peptide, vials, openVial)
  if (rate <= 0) return { daysLeft: Infinity, runOutDate: null, mg }
  const daysLeft = Math.floor(mg / rate)
  return { daysLeft, runOutDate: addDaysStr(todayStr, daysLeft), mg, rate }
}

export function totalSpend(vials) {
  return vials.reduce((s, v) => s + (v.costAud || 0) * (v.qtyPurchased ?? v.qtyOnHand), 0)
}

// Weighted average cost per mg from purchased vials → cost of the current dose
export function costPerDose(peptide, tState, vials) {
  const mine = vialsFor(vials, peptide.id)
  const totMg = mine.reduce((s, v) => s + v.vialMg * (v.qtyPurchased ?? v.qtyOnHand), 0)
  const totCost = mine.reduce((s, v) => s + (v.costAud || 0) * (v.qtyPurchased ?? v.qtyOnHand), 0)
  if (totMg <= 0) return null
  const { dose } = currentRung(peptide, tState)
  return toMg(dose, peptide.ladder.unit) * (totCost / totMg)
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
