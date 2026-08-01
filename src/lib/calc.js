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

// ---- intranasal ----
// A nasal spray bottle delivers a fixed volume per actuation, so the dose is
// counted in sprays rather than drawn. The whole app still stores mg
// underneath, which keeps inventory burn-down and run-out working unchanged:
// one spray is 0.2 mg, so a 10 mg vial is exactly 50 sprays.
export const MCG_PER_SPRAY = 200

export function isNasal(peptide) {
  return peptide?.route === 'Nasal'
}

// The prep this app assumes for a nasal bottle. Editable per peptide; these are
// the defaults, and every number below is derived from them.
export const NASAL_RECIPE = {
  vialMg: 10,      // powder in the vial
  bacMl: 2,        // bacteriostatic water to reconstitute
  salineMl: 3,     // sterile saline added in the bottle
  bottleMl: 5,     // final volume
  sprayMl: 0.1,    // delivered per actuation
}

// mcg per spray and sprays per bottle, derived rather than hardcoded, so an
// edited recipe stays self-consistent.
export function nasalStrength(recipe = NASAL_RECIPE) {
  const bottleMl = recipe.bottleMl || (recipe.bacMl + recipe.salineMl)
  const mgPerMl = bottleMl > 0 ? recipe.vialMg / bottleMl : 0
  return {
    bottleMl,
    mgPerMl,
    mcgPerMl: mgPerMl * 1000,
    mcgPerSpray: Math.round(mgPerMl * 1000 * (recipe.sprayMl || 0.1)),
    spraysPerBottle: recipe.sprayMl > 0 ? Math.round(bottleMl / recipe.sprayMl) : 0,
    totalMcg: recipe.vialMg * 1000,
  }
}

export function sprayToMcg(sprays, mcgPerSpray = MCG_PER_SPRAY) {
  return (sprays || 0) * mcgPerSpray
}

// Switching a peptide between injecting and spraying changes the unit its dose
// is counted in. Converted rather than left reading mcg for a spray bottle:
// rounded to whole sprays, never below one, ceiling never under the floor.
export function convertLadderForRoute(ladder, toNasal) {
  const l = ladder || {}
  if (toNasal) {
    const s = (v) => Math.max(1, Math.round(fromMg(toMg(v || 0, l.unit), 'spray')))
    const out = { ...l, unit: 'spray', floor: s(l.floor), step: s(l.step), ceiling: s(l.ceiling) }
    out.ceiling = Math.max(out.ceiling, out.floor)
    return out
  }
  const m = (v) => Math.round(fromMg(toMg(v || 0, 'spray'), 'mcg'))
  const out = { ...l, unit: 'mcg', floor: m(l.floor), step: m(l.step), ceiling: m(l.ceiling) }
  out.ceiling = Math.max(out.ceiling, out.floor)
  return out
}

export function toMg(value, unit) {
  if (unit === 'mcg') return value / 1000
  if (unit === 'spray') return (value * MCG_PER_SPRAY) / 1000
  return value
}

export function fromMg(mg, unit) {
  if (unit === 'mcg') return mg * 1000
  if (unit === 'spray') return (mg * 1000) / MCG_PER_SPRAY
  return mg
}

export function round(n, places = 2) {
  const f = 10 ** places
  return Math.round((n + Number.EPSILON) * f) / f
}

// "500 mcg" / "2 mg" — trims trailing zeros. A nasal dose reads in sprays with
// the mcg it works out to, because the number of sprays is what you do and the
// mcg is what you're actually taking.
export function formatDose(value, unit) {
  if (value == null || Number.isNaN(value)) return '—'
  if (unit === 'spray') {
    const n = round(value, 0)
    return `${n} spray${n === 1 ? '' : 's'} (${sprayToMcg(n)} mcg)`
  }
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
