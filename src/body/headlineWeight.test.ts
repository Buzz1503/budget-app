import { describe, it, expect } from 'vitest'
import { headlineWeight, getLatestMeasurement, scaleWeeklyRate, latestFromOtherSource } from './bodySeries'
import { compareSinceStart, effectiveStart } from './startPoint'
import { repairStartPoint, startFromEntry } from './scanHistory'
import { EVOLT_START_SCAN, EVOLT_START_ID } from './scanFields'

const evolt = (date: string, weight: number, extra = {}) => ({ id: `e-${date}`, date, source: 'scan', device: 'Evolt 360', weight, ...extra })
const dexa = (date: string, weight: number) => ({ id: `d-${date}`, date, source: 'scan', device: 'DEXA', weight })
const withings = (date: string, weight: number) => ({ date, weight, weightSource: 'Withings' })
const T = '2026-10-27'

describe('the headline weight', () => {
  it('is the Evolt scan when it is newer than the Withings reading', () => {
    const input = { measurements: [evolt('2026-10-26', 92.5)], health: [withings('2026-10-16', 91.7)] }
    const h = getLatestMeasurement('weight', input, T)!
    expect(h).toMatchObject({ value: 92.5, date: '2026-10-26', sourceLabel: 'Evolt 360', family: 'evolt', ageDays: 1 })
  })

  it('is the Scale reading when it is newer than the scan', () => {
    const input = { measurements: [evolt('2026-10-12', 92.5)], health: [withings('2026-10-16', 91.7)] }
    expect(getLatestMeasurement('weight', input, T)).toMatchObject({ value: 91.7, sourceLabel: 'Withings', family: 'scale' })
  })

  it('on the same day Scale wins, Withings first, then typed in, then other apps', () => {
    expect(headlineWeight({ measurements: [evolt('2026-10-26', 92.5)], health: [withings('2026-10-26', 91.9)] })).toMatchObject({ value: 91.9, family: 'scale' })
    const typed = { id: 'm', date: '2026-10-26', weight: 91.0 }
    expect(headlineWeight({ measurements: [evolt('2026-10-26', 92.5), typed], health: [] })).toMatchObject({ value: 91.0, family: 'scale' })
    expect(headlineWeight({ measurements: [typed], health: [{ date: '2026-10-26', weight: 91.6, weightSource: 'Withings' }, { date: '2026-10-26', weight: 91.2, weightSource: 'MyFitnessPal' }] })).toMatchObject({ value: 91.6 })
    expect(headlineWeight({ measurements: [], health: [{ date: '2026-10-26', weight: 91.2, weightSource: 'MyFitnessPal' }] })).toMatchObject({ value: 91.2 })
  })

  it('never takes a DEXA scan, or the estimated starting entry', () => {
    const input = { measurements: [dexa('2026-10-26', 99.9), EVOLT_START_SCAN as never, evolt('2026-10-01', 92.0)], health: [] }
    expect(headlineWeight(input)).toMatchObject({ value: 92.0, date: '2026-10-01' })
    expect(headlineWeight({ measurements: [dexa('2026-10-26', 99.9)], health: [] })).toBeNull()
  })

  it('the change since the start is the headline against the start value', () => {
    const input = { measurements: [EVOLT_START_SCAN as never, evolt('2026-10-26', 92.5)], health: [withings('2026-10-16', 91.7)] }
    const start = startFromEntry(EVOLT_START_SCAN as never)
    const c = compareSinceStart('weight', start, input, T)
    expect(c.start?.value).toBe(105.6)
    expect(c.latest?.value).toBe(92.5)
    expect(c.delta).toBe(-13.1)
  })
})

describe('the chart caption', () => {
  it('appears only when the headline is from a source other than the one the chart shows', () => {
    const h = { family: 'evolt', date: '2026-10-26' }
    expect(latestFromOtherSource(h, 'scale', ['scale', 'evolt'])).toEqual({ family: 'evolt', date: '2026-10-26' })
    expect(latestFromOtherSource(h, 'evolt', ['scale', 'evolt'])).toBeNull()
    expect(latestFromOtherSource(h, 'scale', ['scale'])).toBeNull()
    expect(latestFromOtherSource(null, 'scale', ['scale'])).toBeNull()
  })
})

describe('the weekly rate', () => {
  const health = (days: Array<[string, number]>) => days.map(([date, weight]) => withings(date, weight))
  it('uses Scale readings only, never a scan', () => {
    const input = { measurements: [evolt('2026-10-26', 80)], health: health([['2026-10-06', 93], ['2026-10-13', 92.5], ['2026-10-20', 92]]) }
    expect(scaleWeeklyRate(input, T)).toBe(-0.5)
  })

  it('is hidden with under 2 Scale readings in the last 4 weeks, or two readings under a week apart', () => {
    expect(scaleWeeklyRate({ measurements: [evolt('2026-10-26', 92.5)], health: health([['2026-10-16', 91.7]]) }, T)).toBeNull()
    expect(scaleWeeklyRate({ measurements: [], health: health([['2026-08-01', 95], ['2026-10-16', 91.7]]) }, T)).toBeNull() // the first is outside 4 weeks
    expect(scaleWeeklyRate({ measurements: [], health: health([['2026-10-15', 92], ['2026-10-16', 91.7]]) }, T)).toBeNull()
  })
})

describe('the starting point', () => {
  const real13 = { id: 'scan-2025-01-13', date: '2025-01-13', source: 'scan', device: 'Evolt 360', weight: 102.6 }
  it('a start still on the 13 Jan 2025 scan goes back to 1 Jan 2025 at 105.6, and the 13 Jan scan stays', () => {
    const r = repairStartPoint([real13 as never], { date: '2025-01-13', entryId: 'scan-2025-01-13', values: { weight: 102.6 }, device: 'Evolt 360' })
    expect(r.repaired).toBe(true)
    expect(r.bodyStart).toMatchObject({ date: '2025-01-01', label: 'Start (estimated)', entryId: EVOLT_START_ID })
    expect(r.bodyStart?.values).toMatchObject({ weight: 105.6, bodyFat: 38.3, fatMass: 40.4, leanMass: 65.2 })
    expect(r.measurements.some((m) => m.id === 'scan-2025-01-13')).toBe(true)
    expect(r.measurements.filter((m) => m.id === EVOLT_START_ID)).toHaveLength(1)
    const input = { measurements: r.measurements, health: [] }
    expect(compareSinceStart('weight', r.bodyStart, input, T).start).toMatchObject({ value: 105.6, date: '2025-01-01' })
  })

  it('a start already on 1 Jan 2025, or chosen by hand elsewhere, is left alone', () => {
    const on1 = startFromEntry(EVOLT_START_SCAN as never)
    expect(repairStartPoint([EVOLT_START_SCAN as never], on1).repaired).toBe(false)
    const hand = { date: '2025-06-01', entryId: null, values: { weight: 99 } }
    expect(repairStartPoint([real13 as never], hand).bodyStart).toEqual(hand)
    expect(effectiveStart(on1, [], { measurements: [], health: [] })?.date).toBe('2025-01-01')
  })
})
