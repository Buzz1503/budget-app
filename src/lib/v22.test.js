import { describe, it, expect } from 'vitest'
import {
  cycleDutyFraction, weeklyUsageMg, openVialRemainingMg,
  durationWords, runwayFor,
} from './stock'
import { addDaysStr } from './schedule'

const T = '2026-06-18'
const day = (o) => addDaysStr(T, o)

// 10 mg in 2 mL = 5 mg/mL; a 1 mg weekly dose is 0.2 mL = 20 units
const pep = (over = {}) => ({
  id: 'reta', name: 'Retatrutide', startDate: day(-90), frequency: 'weekly',
  ladder: { unit: 'mg', floor: 1, step: 0, ceiling: 1, intervalWeeks: 4 },
  cycleOnDays: 0, cycleOffDays: 0, route: 'SubQ',
  recon: { vialMg: 10, bacMl: 2, expiryDays: 28 },
  ...over,
})
const tState = { level: 0, levelStartDate: day(-90) }

const batch = (over = {}) => ({
  id: 'b1', peptideId: 'reta', name: 'Retatrutide', vialMg: 10, vendor: 'Vendor A',
  qtyOnHand: 2, qtyPurchased: 2, usdPerVial: 180, lot: '', sealedExpiry: '', coaKey: null, ...over,
})
// a dose of 1 mg (20 units at 5 mg/mL); `mg` overrides it
const dose = (offset, units = 20, peptideId = 'reta', mg = units / 20) => ({
  id: `d${offset}`, peptideId, date: day(offset),
  loggedAt: `${day(offset)}T09:00:00.000Z`, insulinUnits: units, doseValue: mg, unit: 'mg',
})

// ================================================== 1 · cycle-aware burn rate

describe('cycle duty fraction', () => {
  it('is 1 for an ongoing compound (no cycle set)', () => {
    expect(cycleDutyFraction(pep())).toBe(1)
  })

  it('halves for an even on/off split', () => {
    expect(cycleDutyFraction(pep({ cycleOnDays: 14, cycleOffDays: 14 }))).toBe(0.5)
  })

  it('is 1 when only one side of the cycle is set (guards ongoing edge case)', () => {
    expect(cycleDutyFraction(pep({ cycleOnDays: 14, cycleOffDays: 0 }))).toBe(1)
  })
})

describe('weekly usage respects the cycle', () => {
  it('discounts the raw weekly mg by the on/off duty fraction', () => {
    const ongoing = weeklyUsageMg(pep(), tState)
    const cycled = weeklyUsageMg(pep({ cycleOnDays: 7, cycleOffDays: 7 }), tState)
    expect(cycled).toBeCloseTo(ongoing / 2, 6)
  })
})

// ===================================================== 2 · combined runway

describe('what is left in the open vial, in mg', () => {
  it('is the total less every dose logged since it was opened', () => {
    // 3 doses of 1 mg out of a 10 mg vial → 7 mg
    const open = { peptideId: 'reta', vialMg: 10, activatedAt: `${day(-30)}T00:00:00.000Z`, adjustments: [] }
    const logs = [dose(-20), dose(-13), dose(-6)]
    expect(openVialRemainingMg(pep(), open, logs)).toBeCloseTo(7, 6)
  })

  it('is zero with no active vial', () => {
    expect(openVialRemainingMg(pep(), null, [])).toBe(0)
  })

  it('never goes below zero here, and counts a hand adjustment', () => {
    const open = { peptideId: 'reta', vialMg: 10, activatedAt: `${day(-30)}T00:00:00.000Z`, adjustments: [{ mg: -2 }] }
    expect(openVialRemainingMg(pep(), open, [dose(-6)])).toBeCloseTo(7, 6)
    expect(openVialRemainingMg(pep(), open, Array.from({ length: 12 }, (_, i) => dose(-i - 1)))).toBe(0)
  })
})

describe('run-out duration in words a person would use', () => {
  it('reads short stretches as days', () => {
    expect(durationWords(1)).toBe('1 day')
    expect(durationWords(5)).toBe('5 days')
  })

  it('reads medium stretches as weeks', () => {
    expect(durationWords(21)).toBe('~3 weeks')
  })

  it('reads long stretches as months', () => {
    expect(durationWords(150)).toBe('~5 months')
  })

  it('reads very long stretches as years', () => {
    expect(durationWords(800)).toBe('~2.2 years')
  })

  it('calls out empty stock plainly', () => {
    expect(durationWords(0)).toBe('out now')
    expect(durationWords(-4)).toBe('out now')
  })

  it('handles a non-finite runway', () => {
    expect(durationWords(Infinity)).toBe(null)
  })
})

describe('runwayFor combines the open vial and the sealed shelf', () => {
  const open = { peptideId: 'reta', vialMg: 10, activatedAt: `${day(-30)}T00:00:00.000Z`, adjustments: [] }
  const logs = [dose(-20), dose(-13), dose(-6)] // 7 mg left open, from the fixture above
  const vials = [batch({ qtyOnHand: 2, vialMg: 10 })] // 20 mg sealed

  it('sums both into one total, then divides by the real weekly burn', () => {
    const r = runwayFor(pep(), tState, open, vials, logs, T, 30)
    expect(r.totalMg).toBe(27) // 7 open + 20 sealed
    expect(r.perWeekMg).toBe(1)
    // 27 mg at 1 mg a week is 27 doses. The weekday falls tomorrow, so the 28th is owed on day 190
    expect(r.days).toBe(190)
  })

  it('sets the restock-by date to the run-out date minus the compound\'s own delivery time (14 days unless set)', () => {
    const r = runwayFor(pep(), tState, open, vials, logs, T, 30)
    expect(r.runOutDate).toBe(addDaysStr(T, 190))
    expect(r.restockByDate).toBe(addDaysStr(r.runOutDate, -14))
    expect(runwayFor(pep({ orderLeadDays: 30 }), tState, open, vials, logs, T, 30).restockByDate).toBe(addDaysStr(r.runOutDate, -30))
  })

  it('flags low stock once the restock-by date is inside the lead window', () => {
    const thin = runwayFor(pep(), tState, null, [batch({ qtyOnHand: 0 })], [], T, 30)
    expect(thin.low).toBe(true)
    expect(thin.out).toBe(true)
  })

  it('recomputes when the dose changes, with no other change', () => {
    const bigger = pep({ ladder: { unit: 'mg', floor: 2, step: 0, ceiling: 2, intervalWeeks: 4 } })
    const r = runwayFor(bigger, tState, open, vials, logs, T, 30)
    // the same 27 mg at 2 mg a week covers 13 doses, so the 14th (day 92) cannot be
    expect(r.days).toBe(92)
  })

  it('recomputes when the cycle changes, with no other change', () => {
    const cycled = pep({ cycleOnDays: 14, cycleOffDays: 14 })
    const r = runwayFor(cycled, tState, open, vials, logs, T, 30)
    expect(r.days).toBeGreaterThan(runwayFor(pep(), tState, open, vials, logs, T, 30).days)
  })

  it('is honest about having nothing left', () => {
    // fully drawn open vial (2 mL capacity, 2 mL logged since activation), nothing sealed
    const r = runwayFor(pep(), tState, { peptideId: 'reta', vialMg: 10, activatedAt: `${day(-1)}T00:00:00.000Z`, adjustments: [] }, [], [dose(-1, 200)], T, 30)
    expect(r.out).toBe(true)
  })

  // A nasal bottle used to be the one thing with no answer, which is backwards:
  // sprays are harder to eyeball than vials, not easier. Milligrams convert.
  it('answers for a nasal spray too, in the same milligrams', () => {
    const r = runwayFor(pep({ route: 'Nasal' }), tState, null, [batch({ qtyOnHand: 1, vialMg: 10 })], [], T, 30)
    expect(r).not.toBe(null)
    expect(r.perWeekMg).toBeGreaterThan(0)
    expect(Number.isFinite(r.days)).toBe(true)
    expect(r.runOutDate).toBeTruthy()
  })

  it('still returns null when there is no compound at all', () => {
    expect(runwayFor(null, tState, null, [], [], T, 30)).toBe(null)
  })
})
