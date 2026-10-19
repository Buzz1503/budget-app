import { describe, it, expect } from 'vitest'
import { getLatestMeasurement, dailySeries, weeklyChange, sevenDayAverage } from './bodySeries'

const T = '2026-10-19'

describe('getLatestMeasurement', () => {
  it('a newer Health reading beats an older manual entry', () => {
    const r = getLatestMeasurement('weight', {
      measurements: [{ date: '2026-09-27', weight: 93.7, bodyFat: 29.4 }],
      health: [{ date: '2026-10-16', weight: 91.7, weightSource: 'Withings', bodyFatPct: 28.7 }],
    }, T)
    expect(r).toMatchObject({ value: 91.7, date: '2026-10-16', source: 'withings', sourceLabel: 'Withings', stale: false })
  })

  it('a newer manual entry beats an older Health reading', () => {
    const r = getLatestMeasurement('weight', {
      measurements: [{ date: '2026-10-18', weight: 90.9 }],
      health: [{ date: '2026-10-16', weight: 91.7, weightSource: 'Withings' }],
    }, T)
    expect(r).toMatchObject({ value: 90.9, source: 'manual', sourceLabel: 'Manual' })
  })

  it('on the same day: scan, then manual, then Withings, then other apps', () => {
    const day = '2026-10-10'
    const all = {
      measurements: [
        { date: day, weight: 92.0 },
        { date: day, weight: 91.0, source: 'scan' },
      ],
      health: [
        { date: day, weight: 93.0, weightSource: 'Withings' },
        { date: day, weight: 94.0, weightSource: 'Renpho' },
      ],
    }
    expect(getLatestMeasurement('weight', all, T)?.source).toBe('scan')
    expect(getLatestMeasurement('weight', { ...all, measurements: [all.measurements[0]] }, T)?.source).toBe('manual')
    expect(getLatestMeasurement('weight', { health: all.health }, T)).toMatchObject({ source: 'withings', value: 93.0 })
    expect(getLatestMeasurement('weight', { health: [all.health[1]] }, T)).toMatchObject({ source: 'other', sourceLabel: 'Renpho', value: 94.0 })
  })

  it('resolves each field on its own', () => {
    const input = {
      measurements: [{ date: '2026-10-18', bodyFat: 27.9 }],
      health: [{ date: '2026-10-16', weight: 91.7, weightSource: 'Withings', bodyFatPct: 28.7 }],
    }
    expect(getLatestMeasurement('weight', input, T)).toMatchObject({ date: '2026-10-16', value: 91.7 })
    expect(getLatestMeasurement('bodyFat', input, T)).toMatchObject({ date: '2026-10-18', value: 27.9, source: 'manual' })
    // fat mass needs weight and body fat on the same day
    expect(getLatestMeasurement('fatMass', input, T)).toMatchObject({ date: '2026-10-16', value: 26.32 })
    expect(getLatestMeasurement('leanMass', input, T)).toMatchObject({ date: '2026-10-16', value: 65.38 })
  })

  it('flags a value older than 14 days as stale', () => {
    expect(getLatestMeasurement('weight', { measurements: [{ date: '2026-10-05', weight: 90 }] }, T)?.stale).toBe(false)
    expect(getLatestMeasurement('weight', { measurements: [{ date: '2026-10-04', weight: 90 }] }, T)).toMatchObject({ stale: true, ageDays: 15 })
  })

  it('since start compares the latest with the first entry on record', () => {
    const r = getLatestMeasurement('weight', {
      measurements: [{ date: '2026-06-01', weight: 98 }],
      health: [{ date: '2026-10-16', weight: 91.7, weightSource: 'Withings' }],
    }, T)
    expect(r?.sinceStart).toBe(-6.3)
    expect(r?.first.date).toBe('2026-06-01')
  })

  it('returns null with no data, and no since-start for a single reading', () => {
    expect(getLatestMeasurement('weight', {}, T)).toBeNull()
    expect(getLatestMeasurement('bp', { measurements: [{ date: '2026-10-01', weight: 90 }] }, T)).toBeNull()
    expect(getLatestMeasurement('weight', { measurements: [{ date: '2026-10-01', weight: 90 }] }, T)?.sinceStart).toBeNull()
  })

  it('blood pressure keeps systolic and diastolic together', () => {
    const r = getLatestMeasurement('bp', { health: [{ date: '2026-10-12', bpSys: 121, bpDia: 78 }] }, T)
    expect(r).toMatchObject({ value: 121, extra: 78 })
  })
})

describe('merged weekly change and 7-day average', () => {
  it('works from Health readings alone', () => {
    const health = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 21 + i * 2))
      return { date: d.toISOString().slice(0, 10), weight: 94 - i * 0.1, weightSource: 'Withings' }
    })
    const s = dailySeries('weight', { health })
    expect(weeklyChange(s)).toBeCloseTo(-0.35, 2)
    expect(sevenDayAverage(s)).toBeCloseTo((92.9 + 93.0 + 93.1 + 93.2) / 4, 2)
  })

  it('needs 4 readings across 14 days', () => {
    const s = dailySeries('weight', { measurements: [
      { date: '2026-10-01', weight: 92 }, { date: '2026-10-05', weight: 91.8 }, { date: '2026-10-10', weight: 91.5 },
    ] })
    expect(weeklyChange(s)).toBeNull()
    expect(weeklyChange([])).toBeNull()
  })
})
