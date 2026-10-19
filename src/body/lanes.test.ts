import { describe, it, expect } from 'vitest'
import { laneFor, MAX_LANES } from './lanes'

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
