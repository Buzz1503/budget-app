import { describe, it, expect } from 'vitest'
import { drawdown, profilesFor, ownerProfile, drawsPerWeek, emptiesInWords } from './drawdown'

const peptide = {
  id: 'reta', name: 'Retatrutide', frequency: 'weekly',
  ladder: { floor: 2, step: 0.5, intervalWeeks: 4, ceiling: 4, unit: 'mg' },
  recon: { vialMg: 20, bacMl: 2 },
}
const tState = { level: 0 } // 2 mg

describe('a vial nobody shares behaves exactly as it always did', () => {
  it('has one profile, taken from the stack itself', () => {
    const d = drawdown({ drawProfiles: [] }, peptide, tState, 20)
    expect(d.profiles).toHaveLength(1)
    expect(d.shared).toBe(false)
    expect(d.profiles[0].label).toBe('Me')
    expect(d.profiles[0].doseMg).toBe(2)
  })

  it('counts doses-left the single-dose way', () => {
    expect(drawdown({}, peptide, tState, 20).profiles[0].dosesLeft).toBe(10)
    expect(drawdown({}, peptide, tState, 19).profiles[0].dosesLeft).toBe(9)
  })

  it('empties at the rate one person draws', () => {
    // 2 mg once a week = 0.2857 mg/day; 20 mg lasts 70 days
    const d = drawdown({}, peptide, tState, 20)
    expect(d.combinedMgPerDay).toBeCloseTo(2 / 7, 6)
    expect(d.days).toBe(70)
  })
})

describe('two people on different doses', () => {
  const vial = {
    drawProfiles: [{ id: 'p2', label: 'Partner', doseMg: 1, frequency: 'weekly' }],
  }

  it('answers doses-left separately, because the question is separate', () => {
    const d = drawdown(vial, peptide, tState, 20)
    const me = d.profiles.find((p) => p.label === 'Me')
    const partner = d.profiles.find((p) => p.label === 'Partner')
    expect(me.dosesLeft).toBe(10)     // 20 / 2
    expect(partner.dosesLeft).toBe(20) // 20 / 1
    expect(d.shared).toBe(true)
  })

  it('never pretends the two counts add up to the vial', () => {
    // 10 + 20 = 30 "doses" out of a vial that holds 20 mg. Each figure is only
    // true on its own, which is exactly why they are not summed anywhere.
    const d = drawdown(vial, peptide, tState, 20)
    const total = d.profiles.reduce((s, p) => s + p.dosesLeft, 0)
    expect(total).toBe(30)
    expect(d.days).not.toBe(30)
  })

  it('gives one combined empties-in figure from the sum of the draws', () => {
    // (2 + 1) mg a week = 3/7 mg a day; 20 mg lasts 46 days
    const d = drawdown(vial, peptide, tState, 20)
    expect(d.combinedMgPerWeek).toBeCloseTo(3, 6)
    expect(d.days).toBe(Math.floor(20 / (3 / 7)))
    expect(d.days).toBe(46)
  })

  it('a second person shortens the vial rather than leaving it unchanged', () => {
    const alone = drawdown({}, peptide, tState, 20).days
    const shared = drawdown(vial, peptide, tState, 20).days
    expect(shared).toBeLessThan(alone)
  })

  it('a daily partner drains it far faster than a weekly one', () => {
    const weekly = drawdown(vial, peptide, tState, 20).days
    const daily = drawdown(
      { drawProfiles: [{ id: 'p2', label: 'Partner', doseMg: 1, frequency: 'daily' }] },
      peptide, tState, 20,
    ).days
    expect(daily).toBeLessThan(weekly)
    // 2 mg/wk + 7 mg/wk = 9/7 mg a day
    expect(daily).toBe(Math.floor(20 / (9 / 7)))
  })
})

describe('frequencies', () => {
  it('reads the named ones', () => {
    expect(drawsPerWeek({ frequency: 'daily' })).toBe(7)
    expect(drawsPerWeek({ frequency: '3xweek' })).toBe(3)
    expect(drawsPerWeek({ frequency: 'weekly' })).toBe(1)
  })

  it('takes a custom per-week number', () => {
    expect(drawsPerWeek({ frequency: 'custom', perWeek: 2.5 })).toBe(2.5)
    expect(drawsPerWeek({ frequency: 'custom', perWeek: 0 })).toBe(0)
  })
})

describe('the awkward cases', () => {
  it('a profile with no dose is not counted as drawing nothing forever', () => {
    const d = drawdown({ drawProfiles: [{ id: 'x', label: 'Ghost', doseMg: 0 }] }, peptide, tState, 20)
    expect(d.profiles).toHaveLength(1) // the ghost is dropped, not summed as zero
  })

  it('an empty vial says so rather than dividing by it', () => {
    const d = drawdown({}, peptide, tState, 0)
    expect(d.profiles[0].dosesLeft).toBe(0)
    expect(emptiesInWords(d)).toBe('empty')
  })

  it('a stack with no ladder yet produces no owner profile to divide by', () => {
    expect(ownerProfile({ id: 'x' }, null)).toBe(null)
    expect(profilesFor({ drawProfiles: [] }, { id: 'x' }, null)).toEqual([])
  })

  it('puts the combined figure into words', () => {
    expect(emptiesInWords({ remainingMg: 20, days: 9 })).toBe('~9 days')
    expect(emptiesInWords({ remainingMg: 20, days: 21 })).toBe('~3 weeks')
    expect(emptiesInWords({ remainingMg: 20, days: 90 })).toBe('~3 months')
    expect(emptiesInWords({ remainingMg: 20, days: Infinity })).toBe('no draw set')
  })
})
