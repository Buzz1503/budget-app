import { describe, it, expect } from 'vitest'
import { laneFor, MAX_LANES, doseAt, laneValuesAt } from './lanes'

describe('compound lanes', () => {
  const points = [
    { date: '2026-01-01', kind: 'start', to: 1.5, unit: 'mg' },
    { date: '2026-02-01', kind: 'step-up', to: 3, unit: 'mg' },
    { date: '2026-02-10', kind: 'skip' },
    { date: '2026-03-15', kind: 'stop' },
    { date: '2026-04-01', kind: 'restart', to: 3, unit: 'mg' },
  ]
  const runs = [{ startedOn: '2026-01-01', endedOn: '2026-03-15' }, { startedOn: '2026-04-01', endedOn: null }]

  it('a dose step line, labels only where the dose changes, and the time on it', () => {
    const lane = laneFor(points, runs, '2025-12-01', '2026-04-30')
    expect(lane.segments).toEqual([
      { from: '2026-01-01', to: '2026-01-31', dose: 1.5, unit: 'mg' },
      { from: '2026-02-01', to: '2026-03-14', dose: 3, unit: 'mg' },
      { from: '2026-04-01', to: '2026-04-30', dose: 3, unit: 'mg' },
    ])
    expect(lane.changes.map((c) => c.label)).toEqual(['1.5 mg', '3 mg', 'stopped', '3 mg'])
    expect(lane.spans).toEqual([{ from: '2026-01-01', to: '2026-03-15' }, { from: '2026-04-01', to: '2026-04-30' }])
    expect(lane.maxDose).toBe(3)
  })

  it('is clipped to the chart range', () => {
    const lane = laneFor(points, runs, '2026-01-20', '2026-02-20')
    expect(lane.segments).toEqual([
      { from: '2026-01-20', to: '2026-01-31', dose: 1.5, unit: 'mg' },
      { from: '2026-02-01', to: '2026-02-20', dose: 3, unit: 'mg' },
    ])
    expect(lane.changes.map((c) => c.date)).toEqual(['2026-02-01'])
  })

  it('a chart shows at most four lanes', () => {
    expect(MAX_LANES).toBe(4)
  })
})

describe('scrub readout for the lanes', () => {
  const segs = [{ from: '2026-01-01', to: '2026-01-31', dose: 1.5, unit: 'mg' }, { from: '2026-02-01', to: '2026-03-14', dose: 3, unit: 'mg' }]
  it('the dose a compound was at on a date, or nothing when it was not on it', () => {
    expect(doseAt({ segments: segs as never }, '2026-02-20')).toBe('3 mg')
    expect(doseAt({ segments: segs as never }, '2026-01-15')).toBe('1.5 mg')
    expect(doseAt({ segments: segs as never }, '2026-03-20')).toBeNull()
  })
  it('lists each lane that has a value at the date, sauna as minutes', () => {
    const lanes = [
      { name: 'Reta', segments: segs as never },
      { name: 'BPC', segments: [{ from: '2026-04-01', to: '2026-04-30', dose: 250, unit: 'mcg' }] as never },
      { name: 'Sauna', kind: 'dots', segments: [], dots: [{ date: '2026-02-20', minutes: 25 }] },
    ]
    expect(laneValuesAt(lanes, '2026-02-20')).toEqual(['Reta 3 mg', 'Sauna 25 min'])
    expect(laneValuesAt(lanes, '2026-04-02')).toEqual(['BPC 250 mcg'])
    expect(laneValuesAt(lanes, '2025-01-01')).toEqual([])
  })
})
