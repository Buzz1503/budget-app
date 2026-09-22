import { describe, it, expect } from 'vitest'
import { cyclePhase, addDaysStr } from './schedule'
import { isDueToday } from './daily'

// 6 weeks on, 2 weeks off, starting on a Monday
const cycled = {
  id: 'semax', name: 'Semax', startDate: '2026-01-05', frequency: 'daily',
  cycleOnDays: 42, cycleOffDays: 14,
  ladder: { floor: 300, step: 150, intervalWeeks: 1, ceiling: 1000, unit: 'mcg' },
  recon: { vialMg: 10, bacMl: 2, expiryDays: 28 },
}
const ongoing = { ...cycled, cycleOnDays: 0, cycleOffDays: 0 }

describe('where a cycled compound is in its cycle', () => {
  it('reports the day and what is left of the on-stretch', () => {
    const p = cyclePhase(cycled, '2026-01-05') // day 1
    expect(p.phase).toBe('on')
    expect(p.dayOfPhase).toBe(1)
    expect(p.phaseLength).toBe(42)
    expect(p.daysLeft).toBe(42)
  })

  it('counts the last day of the on-stretch as still having that day left', () => {
    const p = cyclePhase(cycled, addDaysStr('2026-01-05', 41)) // day 42
    expect(p.phase).toBe('on')
    expect(p.dayOfPhase).toBe(42)
    expect(p.daysLeft).toBe(1)
    expect(p.restsOn).toBe(addDaysStr('2026-01-05', 42))
  })

  it('flips to resting the day after the on-stretch ends', () => {
    const p = cyclePhase(cycled, addDaysStr('2026-01-05', 42)) // day 43
    expect(p.phase).toBe('rest')
    expect(p.dayOfPhase).toBe(1)
    expect(p.phaseLength).toBe(14)
    expect(p.daysLeft).toBe(14)
  })

  it('counts down to the day it comes back', () => {
    const lastRestDay = addDaysStr('2026-01-05', 55) // day 56, last off day
    const p = cyclePhase(cycled, lastRestDay)
    expect(p.phase).toBe('rest')
    expect(p.daysLeft).toBe(1)
    expect(p.backOn).toBe(addDaysStr('2026-01-05', 56))
  })

  it('and on that day it is on again', () => {
    const p = cyclePhase(cycled, addDaysStr('2026-01-05', 56))
    expect(p.phase).toBe('on')
    expect(p.dayOfPhase).toBe(1)
    expect(p.cycleNumber).toBe(2)
  })

  it('an uncycled compound is simply ongoing, never resting', () => {
    expect(cyclePhase(ongoing, '2026-06-01').phase).toBe('ongoing')
    expect(cyclePhase(ongoing, '2026-06-01').daysLeft).toBe(null)
  })

  it('says nothing about a day before the compound started', () => {
    expect(cyclePhase(cycled, '2025-12-01').phase).toBe('before')
  })
})

describe('resting and the due list', () => {
  const restDay = addDaysStr('2026-01-05', 42)
  const backDay = addDaysStr('2026-01-05', 56)

  it('a resting compound is not due — it must not ask to be injected', () => {
    expect(isDueToday(cycled, restDay)).toBe(false)
  })

  it('and returns to the due list on its own, with no action taken', () => {
    expect(isDueToday(cycled, backDay)).toBe(true)
  })

  it('the phase and the due list never disagree', () => {
    // every day of two full cycles: resting implies not due
    for (let i = 0; i < 112; i++) {
      const date = addDaysStr('2026-01-05', i)
      const phase = cyclePhase(cycled, date)
      if (phase.phase === 'rest') expect(isDueToday(cycled, date)).toBe(false)
    }
  })

  it('the rest gap is exactly as long as the cycle says', () => {
    let restDays = 0
    for (let i = 0; i < 56; i++) {
      if (cyclePhase(cycled, addDaysStr('2026-01-05', i)).phase === 'rest') restDays += 1
    }
    expect(restDays).toBe(14)
  })
})
