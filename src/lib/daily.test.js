import { describe, it, expect } from 'vitest'
import {
  scheduledWeekdaySet, isScheduledToday, slotOf, isDueSlot, currentSlot, weekdayOf,
} from './daily'

// 2026-01-05 is a Monday.
const MON = '2026-01-05', TUE = '2026-01-06', WED = '2026-01-07', SUN = '2026-01-11'

function pep(o = {}) {
  return {
    id: 'p', name: 'T', frequency: 'daily', timing: 'Flexible', startDate: MON,
    cycleOnDays: 0, cycleOffDays: 0, ladder: { unit: 'mcg' }, ...o,
  }
}

describe('weekday scheduling', () => {
  it('daily hits every weekday', () => {
    const p = pep({ frequency: 'daily' })
    for (const d of [MON, TUE, WED, SUN]) expect(isScheduledToday(p, d)).toBe(true)
  })
  it('weekly defaults to the start weekday', () => {
    const p = pep({ frequency: 'weekly' }) // start Monday
    expect(isScheduledToday(p, MON)).toBe(true)
    expect(isScheduledToday(p, TUE)).toBe(false)
  })
  it('weekly honours an explicit chosen weekday', () => {
    const p = pep({ frequency: 'weekly', scheduleWeekdays: [3] }) // Wed
    expect(isScheduledToday(p, WED)).toBe(true)
    expect(isScheduledToday(p, MON)).toBe(false)
  })
  it('3x/week defaults to Mon/Wed/Fri', () => {
    const p = pep({ frequency: '3xweek' })
    expect(scheduledWeekdaySet(p)).toEqual(new Set([1, 3, 5]))
    expect(isScheduledToday(p, MON)).toBe(true)
    expect(isScheduledToday(p, TUE)).toBe(false)
    expect(isScheduledToday(p, WED)).toBe(true)
  })
  it('5-on-2-off defaults to Mon–Fri', () => {
    const p = pep({ frequency: '5on2off' })
    expect(isScheduledToday(p, MON)).toBe(true)
    expect(isScheduledToday(p, SUN)).toBe(false)
  })
  it('off-cycle suppresses scheduling', () => {
    const p = pep({ frequency: 'daily', cycleOnDays: 7, cycleOffDays: 7, startDate: MON })
    // day 8 (2026-01-12) is off-cycle
    expect(isScheduledToday(p, '2026-01-12')).toBe(false)
  })
})

describe('AM/PM slots', () => {
  it('infers PM from bedtime-ish timing', () => {
    expect(slotOf(pep({ timing: 'Before bed' }))).toBe('PM')
    expect(slotOf(pep({ timing: '30–60 min pre-bed' }))).toBe('PM')
    expect(slotOf(pep({ frequency: 'nightly', timing: '' }))).toBe('PM')
  })
  it('infers AM from morning-ish timing and defaults', () => {
    expect(slotOf(pep({ timing: 'Morning' }))).toBe('AM')
    expect(slotOf(pep({ timing: 'AM, empty stomach' }))).toBe('AM')
    expect(slotOf(pep({ timing: 'Flexible' }))).toBe('AM')
  })
  it('explicit slot override wins', () => {
    expect(slotOf(pep({ timing: 'Before bed', slot: 'AM' }))).toBe('AM')
    expect(slotOf(pep({ timing: 'Morning', slot: 'PM' }))).toBe('PM')
  })
  it('isDueSlot combines schedule + slot', () => {
    const am = pep({ frequency: 'daily', timing: 'Morning' })
    expect(isDueSlot(am, MON, 'AM')).toBe(true)
    expect(isDueSlot(am, MON, 'PM')).toBe(false)
  })
  it('currentSlot splits at 14:00', () => {
    expect(currentSlot(new Date('2026-01-05T09:00'))).toBe('AM')
    expect(currentSlot(new Date('2026-01-05T14:30'))).toBe('PM')
  })
  it('weekdayOf: Monday is 1', () => {
    expect(weekdayOf(MON)).toBe(1)
  })
})
