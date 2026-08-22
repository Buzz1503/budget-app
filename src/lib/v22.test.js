import { describe, it, expect } from 'vitest'
import {
  cycleDutyFraction, weeklyUsageMg, coverageFor, openVialRemainingMg,
  durationWords, runwayFor, lowStockAlerts,
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
  qtyOnHand: 2, qtyPurchased: 2, costAud: 180, lot: '', sealedExpiry: '', coaKey: null, ...over,
})
const dose = (offset, units = 20, peptideId = 'reta') => ({
  id: `d${offset}`, peptideId, date: day(offset),
  loggedAt: `${day(offset)}T09:00:00.000Z`, insulinUnits: units,
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

describe('sealed-shelf coverage is now cycle-aware', () => {
  const vials = [batch({ qtyOnHand: 2, vialMg: 10 })] // 20 mg sealed

  it('matches the old ongoing-compound number when there is no cycle', () => {
    expect(coverageFor(pep(), tState, vials, T).weeks).toBe(20)
  })

  it('lasts twice as long at half the duty cycle', () => {
    const cycled = pep({ cycleOnDays: 14, cycleOffDays: 14 })
    expect(coverageFor(cycled, tState, vials, T).weeks).toBe(40)
  })
})

// ===================================================== 2 · combined runway

describe('what is left in the open vial, in mg', () => {
  it('matches the same fraction the doses-left readout uses', () => {
    // 3 doses of 20 units = 0.6 mL drawn from a 2 mL vial → 1.4 mL left → 7 mg of 10
    const open = { vialMg: 10, activatedAt: day(-30) }
    const logs = [dose(-20), dose(-13), dose(-6)]
    expect(openVialRemainingMg(pep(), open, logs)).toBeCloseTo(7, 6)
  })

  it('is zero with no active vial', () => {
    expect(openVialRemainingMg(pep(), null, [])).toBe(0)
  })

  it('is zero for a nasal spray, which is not drawn from a vial', () => {
    expect(openVialRemainingMg(pep({ route: 'Nasal' }), { vialMg: 10 }, [])).toBe(0)
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
  const open = { vialMg: 10, activatedAt: day(-30) }
  const logs = [dose(-20), dose(-13), dose(-6)] // 7 mg left open, from the fixture above
  const vials = [batch({ qtyOnHand: 2, vialMg: 10 })] // 20 mg sealed

  it('sums both into one total, then divides by the real weekly burn', () => {
    const r = runwayFor(pep(), tState, open, vials, logs, T, 30)
    expect(r.totalMg).toBe(27) // 7 open + 20 sealed
    expect(r.perWeekMg).toBe(1)
    expect(r.days).toBe(189) // 27 mg ÷ 1 mg/week × 7
  })

  it('sets the restock-by date to the run-out date minus the lead time', () => {
    const r = runwayFor(pep(), tState, open, vials, logs, T, 30)
    expect(r.runOutDate).toBe(addDaysStr(T, 189))
    expect(r.restockByDate).toBe(addDaysStr(r.runOutDate, -30))
  })

  it('flags low stock once the restock-by date is inside the lead window', () => {
    const thin = runwayFor(pep(), tState, null, [batch({ qtyOnHand: 0 })], [], T, 30)
    expect(thin.low).toBe(true)
    expect(thin.out).toBe(true)
  })

  it('recomputes when the dose changes, with no other change', () => {
    const bigger = pep({ ladder: { unit: 'mg', floor: 2, step: 0, ceiling: 2, intervalWeeks: 4 } })
    const r = runwayFor(bigger, tState, open, vials, logs, T, 30)
    expect(r.days).toBe(94) // same 27 mg, twice the weekly burn
  })

  it('recomputes when the cycle changes, with no other change', () => {
    const cycled = pep({ cycleOnDays: 14, cycleOffDays: 14 })
    const r = runwayFor(cycled, tState, open, vials, logs, T, 30)
    expect(r.days).toBeGreaterThan(runwayFor(pep(), tState, open, vials, logs, T, 30).days)
  })

  it('is honest about having nothing left', () => {
    // fully drawn open vial (2 mL capacity, 2 mL logged since activation), nothing sealed
    const r = runwayFor(pep(), tState, { vialMg: 10, activatedAt: day(-1) }, [], [dose(-1, 200)], T, 30)
    expect(r.out).toBe(true)
  })

  it('returns null for a nasal spray', () => {
    expect(runwayFor(pep({ route: 'Nasal' }), tState, null, [], [], T, 30)).toBe(null)
  })
})

describe('low-stock alerts speak in run-out + restock-by, not doses-left', () => {
  it('no longer mentions doses left anywhere', () => {
    const out = lowStockAlerts({
      peptides: [pep({ frequency: 'daily' })],
      titration: { reta: tState },
      vials: [batch({ qtyOnHand: 1, vialMg: 10 })],
      openVials: {},
      doseLogs: [],
      todayStr: T,
      leadDays: 30,
    })
    expect(out[0].message).not.toMatch(/doses? left/i)
    expect(out[0].message).toMatch(/restock by/)
  })
})
