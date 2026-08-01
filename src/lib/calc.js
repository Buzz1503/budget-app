// Reconstitution + dose math. U-100 insulin syringe: 1 unit = 0.01 mL.

export function concentration(vialMg, bacMl) {
  if (!vialMg || !bacMl || bacMl <= 0) return 0
  return vialMg / bacMl
}

export function doseToMl(doseMg, concMgMl) {
  if (!concMgMl || concMgMl <= 0) return 0
  return doseMg / concMgMl
}

export function mlToUnits(ml) {
  return ml * 100
}

export function unitsToMl(units) {
  return units / 100
}

export function doseToUnits(doseMg, concMgMl) {
  return mlToUnits(doseToMl(doseMg, concMgMl))
}

export function unitsToDoseMg(units, concMgMl) {
  return unitsToMl(units) * concMgMl
}

// ---- preparation ----
// Aqueous peptides are powder + BAC water. Oil-based injectables (e.g. test E)
// arrive as a finished solution at a stated mg/mL, so there is no reconstitution
// step. Both are stored in `recon` as {vialMg, bacMl}: for a pre-mixed vial that
// reads "total mg in the vial" / "mL of solution in the vial", which makes
// vialMg / bacMl the label concentration and leaves every downstream calculation
// (units, inventory burn-down, run-out) working unchanged.
export function isPremixed(peptide) {
  return peptide?.preparation === 'premixed'
}

// mg/mL of the vial as the user will actually draw from it.
export function concentrationOf(peptide) {
  return concentration(peptide?.recon?.vialMg, peptide?.recon?.bacMl)
}

// Total mg in a pre-mixed vial from its label: 250 mg/mL × 10 mL = 2500 mg.
export function premixedVialMg(concMgMl, vialMl) {
  return round((concMgMl || 0) * (vialMl || 0), 6)
}

// U-100 units to draw for a dose expressed in the peptide's own ladder unit.
export function unitsFor(peptide, doseValue) {
  return doseToUnits(toMg(doseValue, peptide?.ladder?.unit), concentrationOf(peptide))
}

export function toMg(value, unit) {
  return unit === 'mcg' ? value / 1000 : value
}

export function fromMg(mg, unit) {
  return unit === 'mcg' ? mg * 1000 : mg
}

export function round(n, places = 2) {
  const f = 10 ** places
  return Math.round((n + Number.EPSILON) * f) / f
}

// "500 mcg" / "2 mg" — trims trailing zeros
export function formatDose(value, unit) {
  if (value == null || Number.isNaN(value)) return '—'
  const v = round(value, unit === 'mcg' ? 0 : 3)
  return `${v} ${unit}`
}

export function formatUnits(units) {
  return `${round(units, 1)} u`
}

// Spelled-out form for the places where "u" is too cryptic to scan at a glance.
export function formatUnitsLong(units) {
  if (units == null || !isFinite(units)) return '—'
  return `${round(units, 1)} units`
}
