import { describe, it, expect } from 'vitest'
import {
  DEFAULT_AS_NEEDED, asNeededInSlot, asNeededLine, lastAmount, makeAsNeededLog, dueAsNeeded, migrateVariableSupplements,
  variableFor, migrateHabits, nothingUnusual, eveningAnswered, defaultMealTime, mergeMorningCheck, morningAnswered,
} from './logging'
import { addDays } from '../health/tz'

describe('as-needed items', () => {
  it('Dex in the morning; Temazepam, Valium and Restavit at night', () => {
    expect(asNeededInSlot(DEFAULT_AS_NEEDED, 'AM').map((i) => i.short)).toEqual(['Dex'])
    expect(asNeededInSlot(DEFAULT_AS_NEEDED, 'PM').map((i) => i.short)).toEqual(['Temazepam', 'Valium', 'Restavit'])
    expect(asNeededLine(DEFAULT_AS_NEEDED, 'PM')).toBe('As needed: Temazepam, Valium, Restavit')
    expect(asNeededLine(DEFAULT_AS_NEEDED, 'PM', 2)).toBe('As needed: Temazepam, Valium, …')
    expect(DEFAULT_AS_NEEDED.find((i) => i.id === 'an-restavit')!.units).toEqual(['tablets', 'mg'])
  })

  it('a log records amount, unit and time, and refuses a missing amount', () => {
    const tem = DEFAULT_AS_NEEDED[1]
    const l = makeAsNeededLog(tem, { amount: 10, at: '2026-10-20T11:15:00.000Z' }, 'x')!
    expect(l).toMatchObject({ itemId: 'an-temazepam', amount: 10, unit: 'mg', at: '2026-10-20T11:15:00.000Z', source: 'phone' })
    expect(makeAsNeededLog(tem, { amount: 0, at: '2026-10-20T11:15:00Z' }, 'x')).toBeNull()
    expect(makeAsNeededLog(tem, { amount: 5, at: 'never' }, 'x')).toBeNull()
    // a unit the item does not use falls back to its first
    expect(makeAsNeededLog(tem, { amount: 5, unit: 'tablets', at: '2026-10-20T11:15:00Z' }, 'x')!.unit).toBe('mg')
    expect(makeAsNeededLog(DEFAULT_AS_NEEDED[3], { amount: 1, unit: 'tablets', at: '2026-10-20T11:15:00Z' }, 'x')!.unit).toBe('tablets')
  })

  it('prefills the last amount used; nothing when never logged', () => {
    const logs = [
      { itemId: 'an-temazepam', amount: 10, unit: 'mg', at: '2026-10-18T11:00:00Z' },
      { itemId: 'an-temazepam', amount: 7.5, unit: 'mg', at: '2026-10-20T11:00:00Z' },
      { itemId: 'an-diazepam', amount: 5, unit: 'mg', at: '2026-10-21T11:00:00Z' },
    ]
    expect(lastAmount(logs, 'an-temazepam')).toEqual({ amount: 7.5, unit: 'mg' })
    expect(lastAmount(logs, 'an-dex')).toBeNull()
  })

  it('is never due and never missed', () => {
    expect(dueAsNeeded(DEFAULT_AS_NEEDED, '2026-10-20')).toEqual([])
  })
})

describe('variable grams', () => {
  it('converts existing supplements and keeps their ids, so history stays', () => {
    const sups = [{ id: 's1', name: 'Magnesium Glycinate 500mg', slot: 'PM' }, { id: 's2', name: 'Vitamin D', slot: 'AM' }]
    const r = migrateVariableSupplements(sups, (i) => `new-${i}`, '2026-10-24')
    expect(r.converted).toEqual(['s1'])
    expect(r.added).toEqual(['new-1'])
    expect(r.supplements.find((s) => s.id === 's1')).toMatchObject({ amountUnit: 'g', amountStep: 0.1 })
    expect(r.supplements.find((s) => s.id === 's2')!.amountUnit).toBeUndefined()
    expect(r.supplements.find((s) => s.id === 'new-1')).toMatchObject({ name: 'Phosphatidylserine', slot: 'PM', amountUnit: 'g' })
    // running it again changes nothing
    const again = migrateVariableSupplements(r.supplements, (i) => `again-${i}`, '2026-10-24')
    expect(again.converted).toEqual([])
    expect(again.added).toEqual([])
    expect(variableFor('PhosphatidylSerine 500mg')?.unit).toBe('g')
    expect(variableFor('Fish oil')).toBeNull()
  })

  it('prefills the last grams', () => {
    expect(lastAmount([{ supplementId: 's1', amount: 0.4, unit: 'g', takenAt: '2026-10-20T10:00:00Z' }], 's1')).toEqual({ amount: 0.4, unit: 'g' })
  })
})

describe('evening factors', () => {
  it('habits become the factor list; caffeine, cold plunge and late meal are hidden, their records kept', () => {
    const old = [
      { id: 'alcohol', name: 'Alcohol' }, { id: 'caffeine-late', name: 'Caffeine after 2pm' }, { id: 'late-meal', name: 'Late meal' },
      { id: 'cold-plunge', name: 'Cold plunge' }, { id: 'screen-bed', name: 'Screen in bed' }, { id: 'stress', name: 'Stressful day' },
      { id: 'h-mine', name: 'Reading' },
    ]
    const next = migrateHabits(old)
    expect(next.filter((h) => !h.hidden).map((h) => h.id)).toEqual(['alcohol', 'screen-bed', 'stress', 'unwell', 'pain', 'room-hot', 'away', 'woken', 'h-mine'])
    expect(next.filter((h) => h.hidden).map((h) => h.id).sort()).toEqual(['caffeine-late', 'cold-plunge', 'late-meal'])
    expect(migrateHabits(next)).toEqual(next)
  })

  it('"Nothing unusual" answers every factor as no and no drinks, and leaves the meal time', () => {
    const habits = migrateHabits([{ id: 'h-mine', name: 'Reading' }, { id: 'cold-plunge', name: 'Cold plunge' }])
    const r = nothingUnusual(habits, { stress: true }, { lastMealAt: '19:30', drinks: 2 })
    expect(Object.values(r.log).every((v) => v === false)).toBe(true)
    expect(r.log['h-mine']).toBe(false)
    expect(r.log['cold-plunge']).toBeUndefined()
    expect(r.detail).toMatchObject({ drinks: 0, lastMealAt: '19:30', wokenBy: [] })
    expect(eveningAnswered(r.log, r.detail)).toBe(true)
    expect(eveningAnswered(undefined, undefined)).toBe(false)
  })

  it('the meal time defaults from yesterday, else the usual', () => {
    expect(defaultMealTime({ '2026-10-19': { lastMealAt: '19:10' } }, '2026-10-20', addDays)).toBe('19:10')
    const d = { '2026-10-16': { lastMealAt: '18:30' }, '2026-10-17': { lastMealAt: '20:00' }, '2026-10-15': { lastMealAt: '19:00' } }
    expect(defaultMealTime(d, '2026-10-20', addDays)).toBe('19:00')
    expect(defaultMealTime({}, '2026-10-20', addDays)).toBeNull()
  })
})

describe('morning check', () => {
  it('stores valid answers and merges later ones', () => {
    const a = mergeMorningCheck(undefined, { rested: 4, dreams: 'vivid' }, '2026-10-24T07:30:00Z')
    expect(a).toMatchObject({ rested: 4, dreams: 'vivid' })
    expect(morningAnswered(a)).toBe(true)
    const b = mergeMorningCheck(a, { pee: 5 as never, headache: true, partner: 'stopped' }, '2026-10-24T07:31:00Z')
    expect(b).toMatchObject({ rested: 4, dreams: 'vivid', pee: 3, headache: true, partner: 'stopped', at: '2026-10-24T07:31:00Z' })
    expect(mergeMorningCheck(b, { rested: 9 as never, dreams: 'odd' as never }, 'x')).toMatchObject({ rested: null, dreams: null })
    expect(morningAnswered(undefined)).toBe(false)
    expect(morningAnswered({ at: 'x' })).toBe(false)
  })
})
