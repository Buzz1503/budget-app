import { describe, it, expect } from 'vitest'
import { NIGHT_LAYOUT, nightLegend, stageTotals, smoothPath, hrLow, crosshairCells, STAGE_COLOR } from './nightView'

const MIN = 60000

describe('night chart sizes', () => {
  it('card: stages 160, each lane 36 to 44; full screen larger', () => {
    expect(NIGHT_LAYOUT.cardStagesH).toBe(160)
    for (const h of Object.values(NIGHT_LAYOUT.cardLaneH)) { expect(h).toBeGreaterThanOrEqual(36); expect(h).toBeLessThanOrEqual(44) }
    expect(NIGHT_LAYOUT.fullStagesMin).toBeGreaterThanOrEqual(200)
    expect(NIGHT_LAYOUT.fullLaneH).toBeGreaterThanOrEqual(48)
  })

  it('a legend item per kind of mark drawn', () => {
    expect(nightLegend({}).length).toBe(0)
    expect(nightLegend({ restless: true, snoring: true, spo2Low: true }).map((x) => x.label)).toEqual(['Restless', 'Snoring', 'SpO2 under 90%'])
  })
})

describe('stage rows', () => {
  it('one colour per stage', () => {
    expect(STAGE_COLOR).toMatchObject({ awake: 'var(--stage-awake)', rem: 'var(--stage-rem)', core: 'var(--stage-core)', deep: 'var(--stage-deep)' })
  })

  it('totals each row over the night, for the labels', () => {
    const steps = [
      { start: 0, end: 30 * MIN, row: 'core' as const },
      { start: 30 * MIN, end: 48 * MIN, row: 'deep' as const },
      { start: 48 * MIN, end: 60 * MIN, row: 'core' as const },
    ]
    expect(stageTotals(steps)).toEqual({ core: 42, deep: 18 })
  })
})

describe('heart rate lane', () => {
  it('a smooth line through every point, and the night\'s low', () => {
    const d = smoothPath([[0, 10], [10, 20], [20, 10], [30, 15]])
    expect(d.startsWith('M0.0,10.0')).toBe(true)
    expect((d.match(/C/g) || []).length).toBe(3)
    expect(d.endsWith('30.0,15.0')).toBe(true)
    expect(hrLow([[0, 60], [30, 51], [60, 55]], 1000)).toEqual({ t: 1000 + 30 * MIN, bpm: 51 })
    expect(hrLow([], 0)).toBeNull()
  })
})

describe('crosshair panel', () => {
  it('values as cells, not a sentence', () => {
    const cells = crosshairCells({ t: 0, stage: 'deep', movement: 'Still', hr: 52.4, spo2: 96, sound: 'Snoring', event: null })
    expect(cells.map((c) => [c.label, c.value, c.unit ?? ''])).toEqual([['Heart rate', '52', 'bpm'], ['Movement', 'Still', ''], ['SpO2', '96', '%'], ['Sound', 'Snoring', '']])
    expect(crosshairCells({ t: 0, stage: null, movement: null, hr: null, spo2: null, sound: null, event: null })).toEqual([])
  })
})
