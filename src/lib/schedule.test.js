import { describe, it, expect } from 'vitest'
import {
  buildRungs, cycleInfo, isDueOn, frequencyHits, currentRung, stepUpDue,
  nextStepUpDate, projectSchedule, addDaysStr,
} from './schedule'

const ladderSemax = { floor: 300, step: 150, intervalWeeks: 1, ceiling: 1000, unit: 'mcg' }

function pep(over = {}) {
  return {
    id: 'p', name: 'Test', frequency: 'daily', startDate: '2026-01-01',
    cycleOnDays: 56, cycleOffDays: 56,
    ladder: { floor: 250, step: 50, intervalWeeks: 1, ceiling: 500, unit: 'mcg' },
    ...over,
  }
}

describe('buildRungs', () => {
  it('steps evenly to an exact ceiling', () => {
    expect(buildRungs({ floor: 250, step: 50, ceiling: 500 })).toEqual([250, 300, 350, 400, 450, 500])
  })
  it('clamps the final rung to the ceiling (never exceeds)', () => {
    expect(buildRungs(ladderSemax)).toEqual([300, 450, 600, 750, 900, 1000])
    expect(buildRungs({ floor: 20, step: 25, ceiling: 100 })).toEqual([20, 45, 70, 95, 100])
    expect(buildRungs({ floor: 1, step: 0.2, ceiling: 1.4 })).toEqual([1, 1.2, 1.4])
  })
  it('handles two-rung and degenerate ladders', () => {
    expect(buildRungs({ floor: 250, step: 250, ceiling: 500 })).toEqual([250, 500])
    expect(buildRungs({ floor: 2, step: 1, ceiling: 2 })).toEqual([2])
  })
})

describe('cycleInfo', () => {
  const selank = pep() // 8 wk on / 8 wk off from 2026-01-01
  it('day 1 is on-cycle', () => {
    const c = cycleInfo(selank, '2026-01-01')
    expect(c.isOn).toBe(true)
    expect(c.cycleDay).toBe(1)
  })
  it('day 56 is the last on day; day 57 is off', () => {
    expect(cycleInfo(selank, addDaysStr('2026-01-01', 55)).isOn).toBe(true)
    expect(cycleInfo(selank, addDaysStr('2026-01-01', 56)).isOn).toBe(false)
  })
  it('cycle 2 starts after on+off days', () => {
    const c = cycleInfo(selank, addDaysStr('2026-01-01', 112))
    expect(c.isOn).toBe(true)
    expect(c.cycleNumber).toBe(2)
    expect(c.completedCycles).toBe(1)
  })
  it('ongoing peptides are always on', () => {
    const reta = pep({ cycleOnDays: 0, cycleOffDays: 0 })
    expect(cycleInfo(reta, '2027-06-01').isOn).toBe(true)
  })
  it('before startDate is not on', () => {
    expect(cycleInfo(selank, '2025-12-31').isOn).toBe(false)
  })
})

describe('frequency patterns', () => {
  it('weekly hits every 7th day only', () => {
    const p = pep({ frequency: 'weekly', cycleOnDays: 0, cycleOffDays: 0 })
    expect(isDueOn(p, '2026-01-01')).toBe(true)
    expect(isDueOn(p, '2026-01-02')).toBe(false)
    expect(isDueOn(p, '2026-01-08')).toBe(true)
  })
  it('3x/week hits days 0, 2, 4 of each week', () => {
    const p = pep({ frequency: '3xweek', cycleOnDays: 0, cycleOffDays: 0 })
    const hits = [0, 1, 2, 3, 4, 5, 6].map((d) => frequencyHits(p, addDaysStr('2026-01-01', d)))
    expect(hits).toEqual([true, false, true, false, true, false, false])
  })
  it('5-on-2-off hits first 5 days of each week', () => {
    const p = pep({ frequency: '5on2off', cycleOnDays: 0, cycleOffDays: 0 })
    const hits = [0, 4, 5, 6, 7].map((d) => frequencyHits(p, addDaysStr('2026-01-01', d)))
    expect(hits).toEqual([true, true, false, false, true])
  })
  it('off-cycle suppresses due even when frequency hits', () => {
    const p = pep({ cycleOnDays: 7, cycleOffDays: 7 })
    expect(isDueOn(p, addDaysStr('2026-01-01', 8))).toBe(false)
  })
})

describe('tolerance-gated titration', () => {
  const p = pep({ cycleOnDays: 0, cycleOffDays: 0 })
  it('starts at the floor', () => {
    const t = { level: 0, levelStartDate: '2026-01-01' }
    expect(currentRung(p, t).dose).toBe(250)
  })
  it('prompts exactly after intervalWeeks, not before', () => {
    const t = { level: 0, levelStartDate: '2026-01-01' }
    expect(stepUpDue(p, t, '2026-01-07')).toBe(false)
    expect(stepUpDue(p, t, '2026-01-08')).toBe(true)
    expect(nextStepUpDate(p, t)).toBe('2026-01-08')
  })
  it('declining holds the dose and re-asks one interval later', () => {
    // decline on 2026-01-08 → levelStartDate reset to that day, level unchanged
    const held = { level: 0, levelStartDate: '2026-01-08' }
    expect(currentRung(p, held).dose).toBe(250)
    expect(stepUpDue(p, held, '2026-01-09')).toBe(false)
    expect(stepUpDue(p, held, '2026-01-15')).toBe(true)
  })
  it('never prompts past the ceiling', () => {
    const t = { level: 5, levelStartDate: '2026-01-01' } // 500 = ceiling (last rung)
    expect(currentRung(p, t).dose).toBe(500)
    expect(stepUpDue(p, t, '2027-01-01')).toBe(false)
  })
  it('does not prompt during off-cycle', () => {
    const cycled = pep({ cycleOnDays: 7, cycleOffDays: 7 })
    const t = { level: 0, levelStartDate: '2026-01-01' }
    expect(stepUpDue(cycled, t, addDaysStr('2026-01-01', 8))).toBe(false)
  })
})

describe('projectSchedule', () => {
  const today = '2026-01-01'
  it('never exceeds the ceiling over a long horizon', () => {
    const p = pep({ cycleOnDays: 0, cycleOffDays: 0 })
    const t = { level: 0, levelStartDate: today }
    const days = projectSchedule(p, t, today, 365, today)
    expect(Math.max(...days.map((d) => d.dose))).toBeLessThanOrEqual(500)
    expect(days[364].dose).toBe(500)
  })
  it('advances one rung per interval in the future projection', () => {
    const p = pep({ cycleOnDays: 0, cycleOffDays: 0 })
    const t = { level: 0, levelStartDate: today }
    const days = projectSchedule(p, t, today, 30, today)
    expect(days[0].dose).toBe(250)
    expect(days[6].dose).toBe(250)
    expect(days[7].dose).toBe(300) // first step-up on day 8 (future)
    expect(days[7].stepUp).toBe(true)
    expect(days[14].dose).toBe(350)
  })
  it('does not auto-advance on or before today (gated on confirmation)', () => {
    const p = pep({ cycleOnDays: 0, cycleOffDays: 0 })
    // step was due 2026-01-08 but never confirmed; today is 2026-01-10
    const t = { level: 0, levelStartDate: '2026-01-01' }
    const days = projectSchedule(p, t, '2026-01-01', 10, '2026-01-10')
    expect(days.every((d) => d.dose === 250)).toBe(true)
  })
  it('marks off-cycle days as not due', () => {
    const p = pep({ cycleOnDays: 7, cycleOffDays: 7 })
    const t = { level: 0, levelStartDate: today }
    const days = projectSchedule(p, t, today, 21, today)
    expect(days[6].due).toBe(true)
    expect(days[7].due).toBe(false)
    expect(days[13].due).toBe(false)
    expect(days[14].due).toBe(true)
  })
})
