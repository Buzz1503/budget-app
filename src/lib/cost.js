import REFERENCE from '../data/peptide_cost_reference.json'
import { toMg } from './calc'
import { currentRung } from './schedule'

/**
 * What a dose costs.
 *
 * One rule runs the whole engine: the only money ever written down is the USD
 * a vial was bought for, plus one exchange rate in Settings. Every dollar the
 * app shows is multiplied out at render time. A stored AUD figure is a lie with
 * a timestamp on it — correct the day it was saved and quietly wrong from then
 * on, with no way to tell which of the two it is by looking.
 */

export const DEFAULT_FX_USD_TO_AUD = 1.43

/** The rate to use, with a bad or missing value falling back rather than to NaN. */
export function fxRate(settings) {
  const fx = Number(settings?.fx_usd_to_aud)
  return Number.isFinite(fx) && fx > 0 ? fx : DEFAULT_FX_USD_TO_AUD
}

// "Retatrutide 20mg" → "retatrutide". Letters and digits only, so the hyphens,
// plus signs and spacing that vendors write differently every time stop
// mattering: MOTS-c, MOTS c and motsc are one compound.
function normalise(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Most reference names carry their vial size on the end. Stripping it leaves
// the compound, which is what a catalogue entry can be matched against — and it
// means the table stays self-describing instead of needing an alias map kept in
// step with it by hand.
function compoundPart(displayName) {
  return normalise(String(displayName || '').replace(/\s*\d+(?:\.\d+)?\s*mg\s*$/i, ''))
}

export const COST_REFERENCE = REFERENCE.map((r) => ({
  ...r,
  compoundKey: compoundPart(r.display_name),
}))

const BY_COMPOUND = new Map()
for (const r of COST_REFERENCE) {
  if (!BY_COMPOUND.has(r.compoundKey)) BY_COMPOUND.set(r.compoundKey, [])
  BY_COMPOUND.get(r.compoundKey).push(r)
}

/** Every priced vial size known for a compound name, smallest first. */
export function sizesFor(name) {
  const rows = BY_COMPOUND.get(normalise(name)) || []
  return [...rows].sort((a, b) => a.mg_per_vial - b.mg_per_vial)
}

/**
 * The reference price for one compound at one vial size.
 *
 * Name and size both have to agree. A 5 mg vial is not a tenth of a 50 mg one —
 * the table prices 10 mg of BPC-157 at $7.00 and 20 mg of a BPC/TB blend at
 * $18.00 — so guessing a missing size from a present one would invent money.
 * No match returns null, and the UI asks rather than assumes.
 */
export function referencePrice(name, mgPerVial) {
  if (!name || !(mgPerVial > 0)) return null
  const rows = BY_COMPOUND.get(normalise(name))
  if (!rows) return null
  return rows.find((r) => r.mg_per_vial === mgPerVial) || null
}

/** The catalogue-layer default: USD per vial for a compound as configured. */
export function referenceUsdPerVial(peptide) {
  const ref = referencePrice(peptide?.name, peptide?.recon?.vialMg)
  return ref ? ref.usd_per_vial : null
}

/**
 * What one vial cost, in today's money.
 *
 * `usdPerVial` is whatever the user actually paid when it is set on the vial,
 * because a real purchase price beats a reference table; the table is only the
 * starting suggestion the field is filled in with.
 */
export function audPerVial(usdPerVial, settings) {
  if (usdPerVial == null || !(usdPerVial >= 0)) return null
  return usdPerVial * fxRate(settings)
}

/**
 * What one dose out of that vial costs.
 *
 * A blend is priced by the whole vial, so the dose that matters is the total mg
 * drawn out of it — 100 mcg each of two components in a 10 mg blend is 0.2 mg of
 * vial, not 0.1. Pricing a component separately would halve the real cost.
 */
export function audPerDose(usdPerVial, mgPerVial, doseMg, settings) {
  const vial = audPerVial(usdPerVial, settings)
  if (vial == null || !(mgPerVial > 0) || !(doseMg >= 0)) return null
  return vial * (doseMg / mgPerVial)
}

/** The dose a stack item is currently on, in mg. */
export function currentDoseMg(peptide, tState) {
  if (!peptide?.ladder) return null
  const { dose } = currentRung(peptide, tState)
  const mg = toMg(dose, peptide.ladder.unit)
  return Number.isFinite(mg) ? mg : null
}

/**
 * The USD price in force for a compound right now: what the vials on the shelf
 * were actually bought for, averaged, falling back to the reference table when
 * nothing has been bought yet.
 *
 * Averaging by vial rather than by mg keeps a part-used 5 mg vial from counting
 * as much as a full 50 mg one in the price-per-vial figure.
 */
export function effectiveUsdPerVial(peptide, vials = []) {
  const mine = vials.filter((v) => v.peptideId === peptide?.id && v.usdPerVial != null)
  if (mine.length > 0) {
    const qty = (v) => Math.max(1, v.qtyPurchased ?? v.qtyOnHand ?? 1)
    const total = mine.reduce((s, v) => s + v.usdPerVial * qty(v), 0)
    const count = mine.reduce((s, v) => s + qty(v), 0)
    return count > 0 ? total / count : null
  }
  return referenceUsdPerVial(peptide)
}

/** Everything a stack row needs to show its per-dose cost, or say it cannot. */
export function stackCost(peptide, tState, vials, settings) {
  const usd = effectiveUsdPerVial(peptide, vials)
  const mgPerVial = peptide?.recon?.vialMg
  const doseMg = currentDoseMg(peptide, tState)
  const priced = usd != null && mgPerVial > 0 && doseMg != null
  return {
    usdPerVial: usd,
    audPerVial: audPerVial(usd, settings),
    audPerDose: priced ? audPerDose(usd, mgPerVial, doseMg, settings) : null,
    doseMg,
    fromReference: !vials.some((v) => v.peptideId === peptide?.id && v.usdPerVial != null),
    priced,
  }
}

/** Two decimal places, because money has two. */
export function money(n, currency = 'AUD') {
  if (n == null || !Number.isFinite(n)) return null
  return `${currency === 'AUD' ? '$' : ''}${n.toFixed(2)}`
}
