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
