import { describe, it, expect } from 'vitest'
import { getStartValue, defaultStartDate, effectiveStart, sinceStart, differentDevices, entryValues } from './startPoint'
import type { BodyStart } from './startPoint'
import { dailySeries, getLatestMeasurement } from './bodySeries'
import { EVOLT_START_SCAN, EVOLT_ORIGINAL_SCAN } from './scanFields'

const evoltStart: BodyStart = {
  date: '2025-01-13', label: 'Start (adjusted to 105.6 kg)', entryId: EVOLT_START_SCAN.id, device: 'Evolt 360',
  values: entryValues(EVOLT_START_SCAN as unknown as Record<string, unknown>),
}
const withingsYear = Array.from({ length: 12 }, (_, i) => ({
  date: `2024-${String(i + 1).padStart(2, '0')}-10`, weight: 91.6 + i * 0.01, weightSource: 'Withings', bodyFatPct: 30,
}))

describe('getStartValue', () => {
  it('uses the value set on the starting point', () => {
    const s = getStartValue('weight', evoltStart, { health: withingsYear })
    expect(s).toEqual({ value: 105.6, date: '2025-01-13', device: 'Evolt 360', fromSetting: true })
    // the old Health weigh-ins from before the start are not the start
    const latest = getLatestMeasurement('weight', { health: [...withingsYear, { date: '2026-10-16', weight: 91.7, weightSource: 'Withings' }] }, '2026-10-19')
    expect(sinceStart(latest?.value, s)).toBe(-13.9)
  })

  it('a field the starting point has no value for falls back to its own first value on or after the date', () => {
    const start: BodyStart = { date: '2025-02-01', values: { weight: 104 } }
    const s = getStartValue('waist', start, { measurements: [
      { date: '2025-01-20', waist: 120 }, { date: '2025-02-03', waist: 116 }, { date: '2025-03-01', waist: 112 },
    ] })
    expect(s).toEqual({ value: 116, date: '2025-02-03', device: null, fromSetting: false })
  })

  it('never compares across fields: skeletal muscle mass is not muscle mass', () => {
    const s = getStartValue('muscleMass', evoltStart, { measurements: [EVOLT_START_SCAN] })
    expect(s).toBeNull()
    expect(getStartValue('skeletalMuscleMass', evoltStart, {})?.value).toBe(35.6)
    expect(getStartValue('visceralFat', evoltStart, { measurements: [EVOLT_START_SCAN] })).toBeNull()
    expect(getStartValue('visceralFatLevel', evoltStart, {})?.value).toBe(16)
  })

  it('on the fallback day, scan beats manual beats Withings beats other apps', () => {
    const start: BodyStart = { date: '2025-01-13' }
    const day = '2025-01-14'
    const input = {
      measurements: [{ date: day, weight: 103 }, { date: day, weight: 102.9, source: 'scan', device: 'InBody' }],
      health: [{ date: day, weight: 103.4, weightSource: 'Withings' }, { date: day, weight: 103.6, weightSource: 'Renpho' }],
    }
    expect(getStartValue('weight', start, input)).toMatchObject({ value: 102.9, device: 'InBody' })
    expect(getStartValue('weight', start, { measurements: [input.measurements[0]], health: input.health })).toMatchObject({ value: 103, device: null })
    expect(getStartValue('weight', start, { health: input.health })).toMatchObject({ value: 103.4, device: 'Withings' })
    expect(getStartValue('weight', start, { health: [input.health[1]] })).toMatchObject({ value: 103.6, device: 'Renpho' })
  })

  it('nothing to start from hides the delta', () => {
    expect(getStartValue('weight', { date: '2025-01-13' }, {})).toBeNull()
    expect(getStartValue('weight', null, { measurements: [{ date: '2025-01-20', weight: 100 }] })).toBeNull()
    expect(sinceStart(91.7, null)).toBeNull()
    expect(sinceStart(null, { value: 100, date: '2025-01-13', device: null, fromSetting: true })).toBeNull()
  })
})

describe('the default starting point', () => {
  it('is the start date of the first tracked compound, not the oldest record', () => {
    const input = { health: withingsYear }
    expect(defaultStartDate(['2025-03-02', '2025-01-20'], input)).toBe('2025-01-20')
    expect(effectiveStart(null, ['2025-03-02', '2025-01-20'], input)?.date).toBe('2025-01-20')
    // nothing tracked: the first reading on record
    expect(defaultStartDate([], input)).toBe('2024-01-10')
    expect(defaultStartDate([], {})).toBeNull()
  })

  it('a starting point that is set wins; resetting (null) returns to the default', () => {
    expect(effectiveStart(evoltStart, ['2025-01-20'], {})?.date).toBe('2025-01-13')
    expect(effectiveStart(null, ['2025-01-20'], {})).toMatchObject({ date: '2025-01-20', values: {} })
  })
})

describe('devices and hidden scans', () => {
  it('flags body fat compared across two known devices, not typed-in values', () => {
    const start = getStartValue('bodyFat', evoltStart, {})
    expect(differentDevices(start, 'Withings')).toBe(true)
    expect(differentDevices(start, 'Evolt 360')).toBe(false)
    expect(differentDevices({ value: 30, date: '2025-01-13', device: null, fromSetting: true }, 'Withings')).toBe(false)
    expect(differentDevices(start, null)).toBe(false)
  })

  it('the original scan kept off the charts is in no series, so the day has one weight', () => {
    const s = dailySeries('weight', { measurements: [EVOLT_START_SCAN, EVOLT_ORIGINAL_SCAN] })
    expect(s).toEqual([{ date: '2025-01-13', value: 105.6, source: 'scan', sourceLabel: 'Evolt 360' }])
    expect(dailySeries('weight', { measurements: [EVOLT_ORIGINAL_SCAN] })).toEqual([])
  })

  it('scan fat mass is used as stored; extras are not measurements', () => {
    expect(dailySeries('fatMass', { measurements: [EVOLT_START_SCAN] })[0].value).toBe(40.4)
    expect(dailySeries('leanMass', { measurements: [EVOLT_START_SCAN] })[0].value).toBe(65.2)
    expect(dailySeries('bmr', { measurements: [EVOLT_START_SCAN] })).toEqual([])
    expect(dailySeries('heightCm', { measurements: [EVOLT_START_SCAN] })).toEqual([])
  })
})
