import { describe, it, expect } from 'vitest'
import { planShots, shotsHeadline } from './grouping'
import {
  toMg, fromMg, formatDose, isNasal, nasalStrength, sprayToMcg, MCG_PER_SPRAY,
  NASAL_RECIPE, convertLadderForRoute,
} from './calc'
import { buildRungs, currentRung } from './schedule'
import { seedPeptides } from '../data/seed'

// a|b MIX, a|c CAUTION, a|d DONT_MIX, a|e NEVER, b|c MIX, b|d CAUTION, c|d MIX
const V = {
  'a|b': 'MIX', 'a|c': 'CAUTION', 'a|d': 'DONT_MIX', 'a|e': 'NEVER',
  'b|c': 'MIX', 'b|d': 'CAUTION', 'b|e': 'MIX', 'c|d': 'MIX', 'c|e': 'MIX', 'd|e': 'MIX',
}
const verdictOf = (x, y) => V[[x, y].sort().join('|')] || null
const item = (id, units = 10, extra = {}) => ({
  id, compoundId: id, name: id.toUpperCase(), units, ml: units / 100, ...extra,
})

describe('grouping combines only confirmed-mixable pairs', () => {
  it('groups a MIX pair', () => {
    const plan = planShots([item('a'), item('b')], verdictOf)
    expect(plan.shots).toBe(1)
  })

  it('never groups a CAUTION pair', () => {
    const plan = planShots([item('a'), item('c')], verdictOf)
    expect(plan.shots).toBe(2)
  })

  it('never groups DONT_MIX or NEVER', () => {
    expect(planShots([item('a'), item('d')], verdictOf).shots).toBe(2)
    expect(planShots([item('a'), item('e')], verdictOf).shots).toBe(2)
  })

  it('never groups a pair the matrix has no verdict for', () => {
    expect(planShots([item('a'), item('zz')], verdictOf).shots).toBe(2)
  })

  it('a CAUTION pair blocks the whole group, even with MIX partners around', () => {
    // a-b MIX, b-c MIX, but a-c is CAUTION → all three cannot share one syringe
    const plan = planShots([item('a'), item('b'), item('c')], verdictOf)
    expect(plan.shots).toBe(2)
    for (const g of plan.groups) {
      const ids = g.items.map((i) => i.id)
      expect(ids.includes('a') && ids.includes('c')).toBe(false)
    }
  })

  it('no proposed group ever contains a non-MIX pair', () => {
    const plan = planShots(['a', 'b', 'c', 'd', 'e'].map((id) => item(id)), verdictOf)
    for (const g of plan.groups) {
      for (const pair of g.pairs) expect(pair.verdict, `${pair.a}+${pair.b}`).toBe('MIX')
    }
  })

  it('stops reporting a caution flag at all', () => {
    const plan = planShots([item('a'), item('b')], verdictOf)
    expect(plan.groups[0].caution).toBeUndefined()
  })

  it('still accounts for every item exactly once', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id))
    const plan = planShots(items, verdictOf)
    expect(plan.groups.flatMap((g) => g.items).map((i) => i.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('says so plainly when nothing can be combined', () => {
    const plan = planShots([item('a'), item('c')], verdictOf)
    expect(shotsHeadline(plan, 'PM')).toMatch(/nothing safely combinable/)
  })
})

describe('spray dosing', () => {
  it('one spray is 200 mcg', () => {
    expect(MCG_PER_SPRAY).toBe(200)
    expect(sprayToMcg(1)).toBe(200)
    expect(sprayToMcg(2)).toBe(400)
    expect(sprayToMcg(3)).toBe(600)
  })

  it('converts sprays to mg and back without drift', () => {
    expect(toMg(1, 'spray')).toBeCloseTo(0.2, 9)
    expect(toMg(3, 'spray')).toBeCloseTo(0.6, 9)
    expect(fromMg(0.2, 'spray')).toBeCloseTo(1, 9)
    for (const n of [1, 2, 3, 5, 50]) expect(fromMg(toMg(n, 'spray'), 'spray')).toBeCloseTo(n, 9)
  })

  it('leaves mcg and mg conversions alone', () => {
    expect(toMg(500, 'mcg')).toBe(0.5)
    expect(toMg(2, 'mg')).toBe(2)
    expect(fromMg(0.5, 'mcg')).toBe(500)
  })

  it('shows sprays with the mcg they work out to', () => {
    expect(formatDose(1, 'spray')).toBe('1 spray (200 mcg)')
    expect(formatDose(2, 'spray')).toBe('2 sprays (400 mcg)')
    expect(formatDose(3, 'spray')).toBe('3 sprays (600 mcg)')
    expect(formatDose(500, 'mcg')).toBe('500 mcg')
  })

  it('derives the recipe strength: 10 mg in 5 mL is 200 mcg a spray, ~50 sprays', () => {
    const s = nasalStrength(NASAL_RECIPE)
    expect(s.bottleMl).toBe(5)
    expect(s.mgPerMl).toBe(2)
    expect(s.mcgPerMl).toBe(2000)
    expect(s.mcgPerSpray).toBe(200)
    expect(s.spraysPerBottle).toBe(50)
    expect(s.totalMcg).toBe(10000)
    // and the recipe adds up: 2 mL BAC + 3 mL saline = the 5 mL bottle
    expect(NASAL_RECIPE.bacMl + NASAL_RECIPE.salineMl).toBe(NASAL_RECIPE.bottleMl)
  })

  it('a bottle burns down to exactly 50 sprays through the mg the app stores', () => {
    let remainingMg = NASAL_RECIPE.vialMg
    let sprays = 0
    while (remainingMg > 1e-9) { remainingMg -= toMg(1, 'spray'); sprays++ }
    expect(sprays).toBe(50)
  })

  it('recognises the nasal route', () => {
    expect(isNasal({ route: 'Nasal' })).toBe(true)
    expect(isNasal({ route: 'SubQ' })).toBe(false)
    expect(isNasal({})).toBe(false)
  })
})

describe('switching a peptide between injecting and spraying', () => {
  const semax = { floor: 300, step: 150, intervalWeeks: 1, ceiling: 1000, unit: 'mcg' }
  const selank = { floor: 250, step: 50, intervalWeeks: 1, ceiling: 500, unit: 'mcg' }

  it('converts the ladder into whole sprays', () => {
    const l = convertLadderForRoute(semax, true)
    expect(l.unit).toBe('spray')
    expect(l.floor).toBe(2)   // 300 mcg → 1.5 → 2 sprays
    expect(l.step).toBe(1)    // 150 mcg → 1 spray
    expect(l.ceiling).toBe(5) // 1000 mcg → 5 sprays
    expect(Number.isInteger(l.floor) && Number.isInteger(l.step) && Number.isInteger(l.ceiling)).toBe(true)
  })

  it('never rounds a step or floor down to zero', () => {
    const l = convertLadderForRoute(selank, true)
    expect(l.floor).toBeGreaterThanOrEqual(1)
    expect(l.step).toBe(1) // 50 mcg would round to 0
    expect(l.ceiling).toBeGreaterThanOrEqual(l.floor)
  })

  it('produces a ladder that titrates in whole sprays', () => {
    const l = convertLadderForRoute(semax, true)
    const rungs = buildRungs(l)
    expect(rungs).toEqual([2, 3, 4, 5])
    for (const r of rungs) expect(Number.isInteger(r)).toBe(true)
    expect(formatDose(rungs[0], l.unit)).toBe('2 sprays (400 mcg)')
    expect(currentRung({ ladder: l }, { level: 1 }).dose).toBe(3)
  })

  it('converts back to mcg on the way out', () => {
    const nasal = convertLadderForRoute(semax, true)
    const back = convertLadderForRoute(nasal, false)
    expect(back.unit).toBe('mcg')
    expect(back.floor).toBe(400)
    expect(back.step).toBe(200)
    expect(back.ceiling).toBe(1000)
  })

  it('keeps the ceiling at or above the floor', () => {
    const l = convertLadderForRoute({ floor: 900, step: 100, ceiling: 100, unit: 'mcg' }, true)
    expect(l.ceiling).toBeGreaterThanOrEqual(l.floor)
  })
})

describe('intranasal-capable library entries', () => {
  const seeded = seedPeptides('2026-01-01')

  it('offers the nasal route on Semax and Selank only', () => {
    const capable = seeded.filter((p) => p.intranasalCapable).map((p) => p.id).sort()
    expect(capable).toEqual(['selank', 'semax'])
  })

  it('leaves them injectable until switched', () => {
    for (const id of ['semax', 'selank']) {
      const p = seeded.find((x) => x.id === id)
      expect(p.route).toBe('SubQ')
      expect(isNasal(p)).toBe(false)
      expect(p.ladder.unit).toBe('mcg')
    }
  })

  it('both use the same 10 mg / 2 mL prep the recipe assumes', () => {
    for (const id of ['semax', 'selank']) {
      const p = seeded.find((x) => x.id === id)
      expect(p.recon.vialMg).toBe(NASAL_RECIPE.vialMg)
      expect(p.recon.bacMl).toBe(NASAL_RECIPE.bacMl)
    }
  })
})
