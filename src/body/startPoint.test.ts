import { describe, it, expect } from 'vitest'
import { getStartValue, defaultStartDate, effectiveStart, sinceStart, differentDevices, entryValues } from './startPoint'
import type { BodyStart } from './startPoint'
import { dailySeries, getLatestMeasurement } from './bodySeries'
import { EVOLT_START_SCAN } from './scanFields'

const EVOLT_ORIGINAL_SCAN = { id: 'orig', date: '2025-01-13', source: 'scan', device: 'Evolt 360', weight: 102.6, bodyFat: 37.0, fatMass: 38.0, leanMass: 64.6 }

const evoltStart: BodyStart = {
  date: '2025-01-01', label: 'Start (estimated)', entryId: EVOLT_START_SCAN.id, device: 'Evolt 360',
  values: entryValues(EVOLT_START_SCAN as unknown as Record<string, unknown>),
}
const withingsYear = Array.from({ length: 12 }, (_, i) => ({
  date: `2024-${String(i + 1).padStart(2, '0')}-10`, weight: 91.6 + i * 0.01, weightSource: 'Withings', bodyFatPct: 30,
}))

describe('getStartValue', () => {
  it('uses the value set on the starting point', () => {
    const s = getStartValue('weight', evoltStart, { health: withingsYear })
    expect(s).toEqual({ value: 105.6, date: '2025-01-01', device: 'Evolt 360', fromSetting: true, family: null })
    // the old Health weigh-ins from before the start are not the start
    const latest = getLatestMeasurement('weight', { health: [...withingsYear, { date: '2026-10-16', weight: 91.7, weightSource: 'Withings' }] }, '2026-10-19')
    expect(sinceStart(latest?.value, s)).toBe(-13.9)
  })

  it('a field the starting point has no value for falls back to its own first value on or after the date', () => {
    const start: BodyStart = { date: '2025-02-01', values: { weight: 104 } }
    const s = getStartValue('waist', start, { measurements: [
      { date: '2025-01-20', waist: 120 }, { date: '2025-02-03', waist: 116 }, { date: '2025-03-01', waist: 112 },
    ] })
    expect(s).toEqual({ value: 116, date: '2025-02-03', device: null, fromSetting: false, family: null })
  })

  it('never compares across fields: skeletal muscle mass is not muscle mass', () => {
    const s = getStartValue('muscleMass', evoltStart, { measurements: [EVOLT_START_SCAN] })
    expect(s).toBeNull()
    expect(getStartValue('skeletalMuscleMass', evoltStart, {})?.value).toBe(35.6)
    expect(getStartValue('visceralFat', evoltStart, { measurements: [{ ...EVOLT_START_SCAN, hiddenFromCharts: false }] })).toBeNull()
    expect(getStartValue('visceralFatLevel', evoltStart, {})?.value).toBe(16)
  })

  it('on the fallback day, an Evolt scan beats Withings beats typed in beats other apps', () => {
    const start: BodyStart = { date: '2025-01-13' }
    const day = '2025-01-14'
    const input = {
      measurements: [{ date: day, weight: 103 }, { date: day, weight: 102.9, source: 'scan', device: 'Evolt 360' }],
      health: [{ date: day, weight: 103.4, weightSource: 'Withings' }, { date: day, weight: 103.6, weightSource: 'Renpho' }],
    }
    expect(getStartValue('weight', start, input)).toMatchObject({ value: 102.9, device: 'Evolt 360' })
    // inside Scale: Withings first, then typed in
    expect(getStartValue('weight', start, { measurements: [input.measurements[0]], health: input.health })).toMatchObject({ value: 103.4, device: 'Withings' })
    expect(getStartValue('weight', start, { measurements: [input.measurements[0]], health: [input.health[1]] })).toMatchObject({ value: 103, device: null })
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
    expect(effectiveStart(evoltStart, ['2025-01-20'], {})?.date).toBe('2025-01-01')
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

  it('the estimated start is the first Evolt point, on 1 Jan 2025; an entry kept off the charts is in no series', () => {
    const s = dailySeries('weight', { measurements: [EVOLT_START_SCAN, EVOLT_ORIGINAL_SCAN] })
    expect(s).toEqual([
      { date: '2025-01-01', value: 105.6, source: 'scan', sourceLabel: 'Evolt 360', family: 'evolt', estimated: true },
      { date: '2025-01-13', value: 102.6, source: 'scan', sourceLabel: 'Evolt 360', family: 'evolt' },
    ])
    expect(dailySeries('weight', { measurements: [{ ...EVOLT_START_SCAN, hiddenFromCharts: true }] })).toEqual([])
  })

  it('scan fat mass is used as stored; height is not a measurement', () => {
    const shown = { ...EVOLT_START_SCAN, hiddenFromCharts: false }
    expect(dailySeries('fatMass', { measurements: [shown] })[0].value).toBe(40.4)
    expect(dailySeries('leanMass', { measurements: [shown] })[0].value).toBe(65.2)
    expect(dailySeries('bmr', { measurements: [shown] })[0].value).toBe(1779)
    expect(dailySeries('heightCm', { measurements: [shown] })).toEqual([])
  })
})

describe('since start with device families', () => {
  it('body fat compares Evolt with Evolt: the adjusted start against the latest Evolt scan', async () => {
    const { compareSinceStart } = await import('./startPoint')
    const { parseScanImport } = await import('./scanImport')
    const { readFileSync } = await import('fs')
    const scans = parseScanImport(JSON.parse(readFileSync(new URL('../data/evolt_scans.json', import.meta.url), 'utf8'))).entries
    const input = { measurements: [...scans, EVOLT_START_SCAN], health: [{ date: '2026-10-16', weight: 91.7, weightSource: 'Withings', bodyFatPct: 28.7 }] }
    const bf = compareSinceStart('bodyFat', evoltStart, input, '2026-10-19')
    expect(bf.family).toBe('evolt')
    expect(bf.latest).toMatchObject({ date: '2026-10-12', value: 31.6 })
    expect(bf.delta).toBe(-6.7)
    // weight is merged: the newest reading from any scale
    const w = compareSinceStart('weight', evoltStart, input, '2026-10-19')
    expect(w.latest).toMatchObject({ date: '2026-10-16', value: 91.7 })
    expect(w.delta).toBe(-13.9)
    expect(w.family).toBeNull()
  })

  it('weight since start is 105.6 in both the Scale and the Evolt view', async () => {
    const { compareSinceStart } = await import('./startPoint')
    const input = {
      measurements: [EVOLT_START_SCAN, { id: 'e', date: '2026-10-12', source: 'scan', device: 'Evolt 360', weight: 93.3, bodyFat: 31.6 }],
      health: [{ date: '2025-01-20', weight: 104.9, weightSource: 'Withings', bodyFatPct: 36 }, { date: '2026-10-16', weight: 91.7, weightSource: 'Withings', bodyFatPct: 28.7 }],
    }
    const scale = compareSinceStart('weight', evoltStart, input, '2026-10-19', { family: 'scale' })
    expect(scale).toMatchObject({ family: 'scale', delta: -13.9 })
    expect(scale.start).toMatchObject({ value: 105.6, fromSetting: true })
    const evolt = compareSinceStart('weight', evoltStart, input, '2026-10-19', { family: 'evolt' })
    expect(evolt).toMatchObject({ family: 'evolt', delta: -12.3 })
    expect(evolt.latest).toMatchObject({ date: '2026-10-12', value: 93.3 })
  })

  it('body fat since start: Evolt uses the start entry, Scale uses its first reading on or after 1 Jan 2025', async () => {
    const { compareSinceStart } = await import('./startPoint')
    const input = {
      measurements: [EVOLT_START_SCAN, { id: 'e', date: '2026-10-12', source: 'scan', device: 'Evolt 360', weight: 93.3, bodyFat: 31.6 }],
      health: [
        { date: '2024-12-20', weight: 106, weightSource: 'Withings', bodyFatPct: 40 }, // before the start: not the start
        { date: '2025-01-20', weight: 104.9, weightSource: 'Withings', bodyFatPct: 36 },
        { date: '2026-10-16', weight: 91.7, weightSource: 'Withings', bodyFatPct: 28.7 },
      ],
    }
    const evolt = compareSinceStart('bodyFat', evoltStart, input, '2026-10-19', { family: 'evolt' })
    expect(evolt.start).toMatchObject({ value: 38.3, fromSetting: true })
    expect(evolt.delta).toBe(-6.7)
    const scale = compareSinceStart('bodyFat', evoltStart, input, '2026-10-19', { family: 'scale' })
    expect(scale.start).toMatchObject({ value: 36, date: '2025-01-20', fromSetting: false })
    expect(scale.delta).toBe(-7.3)
    // fat mass and lean mass follow the same rule
    expect(compareSinceStart('fatMass', evoltStart, input, '2026-10-19', { family: 'evolt' }).start?.value).toBe(40.4)
    expect(compareSinceStart('leanMass', evoltStart, input, '2026-10-19', { family: 'scale' }).start).toMatchObject({ fromSetting: false, date: '2025-01-20' })
  })

  it('with no start value set, the fallback reads the default family only', async () => {
    const { compareSinceStart } = await import('./startPoint')
    const input = {
      measurements: [{ id: 'a', date: '2025-02-01', source: 'scan', device: 'Evolt 360', weight: 100, bodyFat: 35 }, { id: 'b', date: '2025-06-01', source: 'scan', device: 'Evolt 360', weight: 95, bodyFat: 33 }],
      health: [{ date: '2025-01-20', weight: 101, weightSource: 'Withings', bodyFatPct: 30 }],
    }
    const r = compareSinceStart('bodyFat', { date: '2025-01-15' }, input, '2025-07-01')
    expect(r).toMatchObject({ family: 'evolt', delta: -2 })
    expect(r.start).toMatchObject({ value: 35, date: '2025-02-01' })
  })
})
