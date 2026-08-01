import { describe, it, expect } from 'vitest'
import { planShots, shotsHeadline, MAX_GROUP_ML } from './grouping'
import {
  concentrationOf, isPremixed, premixedVialMg, unitsFor, doseToUnits, formatUnitsLong,
} from './calc'
import { buildRungs, currentRung, stepUpDue, frequencyHits, dosesPerWeek } from './schedule'
import { isDueToday, scheduledWeekdaySet, weekdayPickCount, needsProtocolSetup, slotOf } from './daily'
import { expiryInfo } from './inventory'
import { suggestSite, sitesForRoute, SITES, IM_SITES, SITE_BY_ID } from './sites'
import { testosteroneEnanthate, TEST_E_ID, seedPeptides, SEED_NEEDLE_NOTES } from '../data/seed'

const TE = testosteroneEnanthate('2026-01-01')

describe('Testosterone Enanthate — oil-based injectable', () => {
  it('is seeded into the library', () => {
    const ids = seedPeptides('2026-01-01').map((p) => p.id)
    expect(ids).toContain(TEST_E_ID)
  })

  it('is a fixed dose, not a titration ladder', () => {
    expect(TE.ladder.floor).toBe(50)
    expect(TE.ladder.ceiling).toBe(50)
    const rungs = buildRungs(TE.ladder)
    expect(rungs).toEqual([50])
    const { dose, level, maxLevel } = currentRung(TE, { level: 0, levelStartDate: '2026-01-01' })
    expect(dose).toBe(50)
    expect(level).toBe(0)
    expect(maxLevel).toBe(0)
    // never prompts a step-up, however long it sits there
    expect(stepUpDue(TE, { level: 0, levelStartDate: '2026-01-01' }, '2027-01-01')).toBe(false)
  })

  it('is ongoing, not cycled', () => {
    expect(TE.cycleOnDays).toBe(0)
    expect(TE.cycleOffDays).toBe(0)
  })

  it('is twice weekly on Mon/Thu, in the AM', () => {
    expect(TE.frequency).toBe('2xweek')
    expect(dosesPerWeek('2xweek')).toBe(2)
    expect(weekdayPickCount('2xweek')).toBe(2)
    expect([...scheduledWeekdaySet(TE)]).toEqual([1, 4])
    expect(slotOf(TE)).toBe('AM')
    // 2026-01-05 is a Monday
    expect(isDueToday(TE, '2026-01-05')).toBe(true) // Mon
    expect(isDueToday(TE, '2026-01-06')).toBe(false) // Tue
    expect(isDueToday(TE, '2026-01-07')).toBe(false) // Wed
    expect(isDueToday(TE, '2026-01-08')).toBe(true) // Thu
    expect(isDueToday(TE, '2026-01-11')).toBe(false) // Sun
  })

  it('defaults 2xweek to Mon/Thu when no days are picked', () => {
    expect([...scheduledWeekdaySet({ frequency: '2xweek', startDate: '2026-01-01' })]).toEqual([1, 4])
  })

  it('projects on the picked weekdays, so Plan agrees with Home', () => {
    expect(frequencyHits(TE, '2026-01-05')).toBe(true) // Mon
    expect(frequencyHits(TE, '2026-01-06')).toBe(false) // Tue
    expect(frequencyHits(TE, '2026-01-08')).toBe(true) // Thu
  })

  it('is pre-mixed at 250 mg/mL — 50 mg is 0.2 mL / 20 units', () => {
    expect(isPremixed(TE)).toBe(true)
    expect(concentrationOf(TE)).toBe(250)
    const units = unitsFor(TE, 50)
    expect(units).toBeCloseTo(20, 6)
    expect(units / 100).toBeCloseTo(0.2, 6)
    expect(formatUnitsLong(units)).toBe('20 units')
  })

  it('restates the vial total from a label concentration', () => {
    expect(premixedVialMg(250, 10)).toBe(2500)
    expect(premixedVialMg(200, 10)).toBe(2000)
    // and that new total still reads back as the concentration set
    expect(concentrationOf({ recon: { vialMg: premixedVialMg(200, 10), bacMl: 10 } })).toBe(200)
  })

  it('is ready to inject without a reconstitution step', () => {
    expect(needsProtocolSetup(TE)).toBe(false)
  })

  it('runs no post-reconstitution expiry clock', () => {
    expect(expiryInfo(TE, { reconstitutedAt: '2026-01-01' }, '2026-06-01')).toBeNull()
    // an aqueous peptide still does
    const aq = { recon: { vialMg: 10, bacMl: 2, expiryDays: 28 } }
    expect(expiryInfo(aq, { reconstitutedAt: '2026-01-01' }, '2026-01-10')?.daysLeft).toBe(19)
  })

  it('is flagged as never co-drawn, with a reason', () => {
    expect(TE.alwaysSeparate).toBe(true)
    expect(TE.separateReason).toMatch(/matrix|own/i)
  })

  it('is intramuscular oil by default', () => {
    expect(TE.route).toBe('IM')
    expect(TE.vehicle).toBe('oil')
  })

  it('ships an oil-specific needle note distinct from the SubQ guide', () => {
    const oil = SEED_NEEDLE_NOTES.find((n) => n.id === 'oil')
    expect(oil).toBeTruthy()
    expect(oil.body).toMatch(/23–25 g/)
    expect(oil.body).toMatch(/27–29 g/)
    expect(oil.body).toMatch(/viscous/i)
    const subq = SEED_NEEDLE_NOTES.find((n) => n.id === 'syringe')
    expect(subq.body).not.toMatch(/23–25 g/)
  })
})

describe('IM rotation map', () => {
  it('offers glute / delt / quad for IM and the belly/thigh map for SubQ', () => {
    const im = sitesForRoute('IM')
    expect(im).toBe(IM_SITES)
    expect(im.map((s) => s.region).sort()).toEqual(
      ['delt-L', 'delt-R', 'glute-L', 'glute-R', 'quad-L', 'quad-R']
    )
    expect(sitesForRoute('SubQ')).toBe(SITES)
    expect(sitesForRoute(undefined)).toBe(SITES)
  })

  it('suggests within the requested route only', () => {
    const logs = []
    expect(SITE_BY_ID[suggestSite(logs, '2026-02-01', 'IM')].route).toBe('IM')
    expect(SITE_BY_ID[suggestSite(logs, '2026-02-01')].route).toBeUndefined()
  })

  it('does not let an IM injection steer the SubQ suggestion', () => {
    const logs = [{ peptideId: TEST_E_ID, siteId: 'im-glute-l', date: '2026-02-01', loggedAt: '2026-02-01T08:00:00Z' }]
    const s = suggestSite(logs, '2026-02-01', 'SubQ')
    expect(SITES.some((x) => x.id === s)).toBe(true)
  })

  it('rotates away from the last IM site used', () => {
    const logs = [{ peptideId: TEST_E_ID, siteId: 'im-glute-l', date: '2026-02-01', loggedAt: '2026-02-01T08:00:00Z' }]
    expect(suggestSite(logs, '2026-02-02', 'IM')).not.toBe('im-glute-l')
  })
})

// ---- shot grouping ----
const V = {
  'a|b': 'MIX', 'a|c': 'MIX', 'b|c': 'MIX',
  'a|d': 'DONT_MIX', 'b|d': 'MIX', 'c|d': 'MIX',
  'a|e': 'CAUTION', 'b|e': 'CAUTION', 'c|e': 'NEVER', 'd|e': 'MIX',
}
const verdictOf = (x, y) => V[[x, y].sort().join('|')] || null
const item = (id, units = 10, extra = {}) => ({
  id, compoundId: id, name: id.toUpperCase(), units, ml: units / 100, ...extra,
})

describe('planShots', () => {
  it('puts a fully compatible set into one syringe', () => {
    const plan = planShots([item('a'), item('b'), item('c')], verdictOf)
    expect(plan.shots).toBe(1)
    expect(plan.before).toBe(3)
    expect(plan.saved).toBe(2)
    expect(plan.groups[0].items.map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
    expect(plan.groups[0].units).toBe(30)
  })

  it('never groups a DONT_MIX pair, and still minimises the rest', () => {
    // a-d is DONT_MIX; b and c mix with everything
    const plan = planShots([item('a'), item('b'), item('c'), item('d')], verdictOf)
    expect(plan.shots).toBe(2)
    const withA = plan.groups.find((g) => g.items.some((i) => i.id === 'a'))
    const withD = plan.groups.find((g) => g.items.some((i) => i.id === 'd'))
    expect(withA).not.toBe(withD)
    for (const g of plan.groups) {
      const ids = g.items.map((i) => i.id)
      expect(ids.includes('a') && ids.includes('d')).toBe(false)
    }
  })

  it('never groups a NEVER pair', () => {
    const plan = planShots([item('c'), item('e')], verdictOf)
    expect(plan.shots).toBe(2)
  })

  // v10 tightened this: a CAUTION pair is no longer combinable at all.
  it('never groups a CAUTION pair', () => {
    const plan = planShots([item('a'), item('e')], verdictOf)
    expect(plan.shots).toBe(2)
  })

  it('a CAUTION pair splits the group even when the rest are MIX', () => {
    // a-b is MIX, but a-e and b-e are CAUTION, so e cannot join them
    const plan = planShots([item('a'), item('b'), item('e')], verdictOf)
    expect(plan.shots).toBe(2)
    const withE = plan.groups.find((g) => g.items.some((i) => i.id === 'e'))
    expect(withE.items).toHaveLength(1)
  })

  it('does not group a pair the matrix has no verdict for', () => {
    const plan = planShots([item('a'), item('zz')], verdictOf)
    expect(plan.shots).toBe(2)
  })

  it('keeps each syringe under the volume cap', () => {
    // 3 × 0.6 mL: two fit (1.2), three do not (1.8)
    const plan = planShots([item('a', 60), item('b', 60), item('c', 60)], verdictOf)
    expect(plan.shots).toBe(2)
    for (const g of plan.groups) expect(g.ml).toBeLessThanOrEqual(MAX_GROUP_ML + 1e-9)
  })

  it('gives an item bigger than the cap its own syringe rather than dropping it', () => {
    const plan = planShots([item('a', 200), item('b'), item('c')], verdictOf)
    expect(plan.before).toBe(3)
    expect(plan.groups.flatMap((g) => g.items).map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
    const big = plan.groups.find((g) => g.items.some((i) => i.id === 'a'))
    expect(big.items).toHaveLength(1)
  })

  it('excludes always-separate compounds from grouping entirely', () => {
    const oil = item('test', 20, { compoundId: null, separate: true, separateReason: 'oil-based' })
    const plan = planShots([item('a'), item('b'), oil], verdictOf)
    expect(plan.shots).toBe(2)
    const own = plan.groups.find((g) => g.items.some((i) => i.id === 'test'))
    expect(own.items).toHaveLength(1)
    expect(own.separate).toBe(true)
    expect(own.separateReason).toBe('oil-based')
  })

  it('accounts for every item exactly once', () => {
    const items = [item('a'), item('b'), item('c'), item('d'), item('e')]
    const plan = planShots(items, verdictOf)
    const out = plan.groups.flatMap((g) => g.items).map((i) => i.id).sort()
    expect(out).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(plan.shots).toBe(plan.groups.length)
  })

  it('handles the empty and single cases', () => {
    expect(planShots([], verdictOf).shots).toBe(0)
    expect(planShots([item('a')], verdictOf).shots).toBe(1)
  })

  it('writes a headline that names the saving', () => {
    const plan = planShots([item('a'), item('b'), item('c')], verdictOf)
    expect(shotsHeadline(plan, 'AM')).toBe('1 shot instead of 3 this morning')
    expect(shotsHeadline(plan, 'PM')).toBe('1 shot instead of 3 tonight')
    const none = planShots([item('c'), item('e')], verdictOf)
    expect(shotsHeadline(none, 'AM')).toMatch(/nothing safely combinable/)
  })
})

describe('real stack grouping shape', () => {
  it('the seeded library still produces a usable plan with test E excluded', () => {
    const peptides = seedPeptides('2026-01-01')
    const te = peptides.find((p) => p.id === TEST_E_ID)
    const items = [te, ...peptides.filter((p) => p.id !== TEST_E_ID).slice(0, 2)].map((p) => {
      const units = unitsFor(p, p.ladder.floor)
      return {
        id: p.id,
        compoundId: p.alwaysSeparate ? null : p.id,
        name: p.name,
        units,
        ml: units / 100,
        separate: !!p.alwaysSeparate,
      }
    })
    const plan = planShots(items, () => 'MIX')
    // test E is its own shot; the two peptides merge
    expect(plan.shots).toBe(2)
    const oilShot = plan.groups.find((g) => g.items.some((i) => i.id === TEST_E_ID))
    expect(oilShot.items).toHaveLength(1)
    expect(doseToUnits(50, 250)).toBe(20)
  })
})
