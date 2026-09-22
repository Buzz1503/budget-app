import { describe, it, expect } from 'vitest'
import {
  referencePrice, referenceUsdPerVial, audPerVial, audPerDose, sizesFor,
  effectiveUsdPerVial, stackCost, fxRate, money, DEFAULT_FX_USD_TO_AUD,
} from './cost'
import { seedPeptides } from '../data/seed'

const S = { fx_usd_to_aud: 1.43 }
const cat = seedPeptides('2026-09-22')
const byId = Object.fromEntries(cat.map((p) => [p.id, p]))

// --------------------------------------------------------------- the rate

describe('the exchange rate', () => {
  it('defaults to 1.43', () => {
    expect(DEFAULT_FX_USD_TO_AUD).toBe(1.43)
    expect(fxRate(undefined)).toBe(1.43)
  })

  it('falls back rather than producing NaN dollars', () => {
    expect(fxRate({ fx_usd_to_aud: 0 })).toBe(1.43)
    expect(fxRate({ fx_usd_to_aud: -2 })).toBe(1.43)
    expect(fxRate({ fx_usd_to_aud: 'abc' })).toBe(1.43)
  })

  it('is used, not ignored, when the user sets one', () => {
    expect(fxRate({ fx_usd_to_aud: 1.6 })).toBe(1.6)
  })
})

// --------------------------------------------------------------- matching

describe('matching the reference table to the catalogue', () => {
  it('matches on name and vial size together', () => {
    expect(referencePrice('Retatrutide', 20).key).toBe('reta_20')
    expect(referencePrice('Retatrutide', 5).key).toBe('reta_5')
  })

  it('shrugs off the punctuation vendors write differently', () => {
    expect(referencePrice('MOTS-c', 40).key).toBe('mots_40')
    expect(referencePrice('mots c', 40).key).toBe('mots_40')
    expect(referencePrice('NAD+', 500).key).toBe('nad_500')
    expect(referencePrice('SS-31', 50).key).toBe('ss31_50')
    expect(referencePrice('GHK-Cu', 50).key).toBe('ghkcu_50')
  })

  it('never guesses a size it does not have a price for', () => {
    // BPC-157 is priced at 10 mg and the catalogue runs it at 5 mg. A fifth of
    // the 10 mg price is not the 5 mg price — nothing in the table says it is.
    expect(referencePrice('BPC-157', 5)).toBe(null)
    expect(sizesFor('BPC-157').map((r) => r.mg_per_vial)).toEqual([10])
  })

  it('returns null for a compound the table has never heard of', () => {
    expect(referencePrice('Testosterone Enanthate', 2500)).toBe(null)
    expect(referenceUsdPerVial(byId['testosterone-e'])).toBe(null)
    expect(sizesFor('Testosterone Enanthate')).toEqual([])
  })

  it('prices the seeded stack where the table covers it', () => {
    expect(referenceUsdPerVial(byId.retatrutide)).toBe(15)
    expect(referenceUsdPerVial(byId.motsc)).toBe(21)
    expect(referenceUsdPerVial(byId.ss31)).toBe(30)
    expect(referenceUsdPerVial(byId.nad)).toBe(8)
    expect(referenceUsdPerVial(byId.tesamorelin)).toBe(15.5)
  })
})

// --------------------------------------------------------------- the money

describe('the figures the spec calls for', () => {
  it('Retatrutide 20 mg: $21.45 a vial, $2.15 for a 2 mg dose', () => {
    const usd = referencePrice('Retatrutide', 20).usd_per_vial
    expect(audPerVial(usd, S).toFixed(2)).toBe('21.45')
    expect(audPerDose(usd, 20, 2, S).toFixed(2)).toBe('2.15')
  })

  it('CP10 blend: $16.45 a vial, $0.33 for 100 mcg of each component', () => {
    const r = referencePrice('CJC no-DAC 5 + IPA 5 blend', 10)
    expect(audPerVial(r.usd_per_vial, S).toFixed(2)).toBe('16.45')
    // 100 mcg of each of two components is 0.2 mg drawn out of a 10 mg vial —
    // the blend is priced whole, so the whole draw is what it costs
    expect(audPerDose(r.usd_per_vial, 10, 0.2, S).toFixed(2)).toBe('0.33')
  })

  it('MOTS-c 40 mg: $30.03 a vial, $1.05 for a 1.4 mg dose', () => {
    const usd = referencePrice('MOTS-c', 40).usd_per_vial
    expect(audPerVial(usd, S).toFixed(2)).toBe('30.03')
    // 21.00 × 1.43 × (1.4 / 40) = 1.05105. The spec's "~$1.07" is two cents out;
    // this is what its own formula gives.
    expect(audPerDose(usd, 40, 1.4, S).toFixed(2)).toBe('1.05')
  })

  it('a blend component priced on its own would understate the draw', () => {
    const r = referencePrice('CJC no-DAC 5 + IPA 5 blend', 10)
    const whole = audPerDose(r.usd_per_vial, 10, 0.2, S)
    const oneComponent = audPerDose(r.usd_per_vial, 10, 0.1, S)
    expect(whole).toBeCloseTo(oneComponent * 2, 10)
  })
})

describe('AUD is derived, never stored', () => {
  it('every AUD figure moves when the rate moves', () => {
    const usd = referencePrice('Retatrutide', 20).usd_per_vial
    expect(audPerVial(usd, { fx_usd_to_aud: 1.43 }).toFixed(2)).toBe('21.45')
    expect(audPerVial(usd, { fx_usd_to_aud: 1.60 }).toFixed(2)).toBe('24.00')
    expect(audPerDose(usd, 20, 2, { fx_usd_to_aud: 1.60 }).toFixed(2)).toBe('2.40')
  })

  it('an unpriced vial produces no dollars at all rather than zero', () => {
    expect(audPerVial(null, S)).toBe(null)
    expect(audPerDose(null, 20, 2, S)).toBe(null)
    expect(money(null)).toBe(null)
  })
})

// --------------------------------------------------------------- the layers

describe('what the user actually paid beats the table', () => {
  const p = byId.retatrutide

  it('falls back to the reference when nothing has been bought', () => {
    expect(effectiveUsdPerVial(p, [])).toBe(15)
    expect(stackCost(p, { level: 3 }, [], S).fromReference).toBe(true)
  })

  it('uses the purchase price once a vial carries one', () => {
    const vials = [{ peptideId: 'retatrutide', vialMg: 20, usdPerVial: 18, qtyPurchased: 1 }]
    expect(effectiveUsdPerVial(p, vials)).toBe(18)
    expect(stackCost(p, { level: 3 }, vials, S).fromReference).toBe(false)
  })

  it('averages several purchases by vial, not by mg', () => {
    const vials = [
      { peptideId: 'retatrutide', vialMg: 20, usdPerVial: 15, qtyPurchased: 1 },
      { peptideId: 'retatrutide', vialMg: 20, usdPerVial: 21, qtyPurchased: 3 },
    ]
    expect(effectiveUsdPerVial(p, vials)).toBe((15 + 21 * 3) / 4)
  })

  it('ignores other compounds\' vials', () => {
    const vials = [{ peptideId: 'motsc', vialMg: 40, usdPerVial: 99, qtyPurchased: 1 }]
    expect(effectiveUsdPerVial(p, vials)).toBe(15)
  })

  it('a stack item with no price says so instead of showing $0.00', () => {
    const c = stackCost(byId['testosterone-e'], { level: 0 }, [], S)
    expect(c.priced).toBe(false)
    expect(c.audPerDose).toBe(null)
  })

  it('prices the stack item at the rung it is actually on', () => {
    // Retatrutide's ladder is 0.5 → 2 mg in 0.5 steps; level 0 is 0.5 mg
    const low = stackCost(p, { level: 0 }, [], S)
    const high = stackCost(p, { level: 3 }, [], S)
    expect(low.doseMg).toBe(0.5)
    expect(high.doseMg).toBe(2)
    expect(high.audPerDose).toBeCloseTo(low.audPerDose * 4, 10)
  })
})
