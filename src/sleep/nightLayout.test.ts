import { describe, it, expect } from 'vitest'
import { NIGHT_LAYOUT, nightLegend } from './nightView'

describe('night chart sizes', () => {
  it('full screen: stages at least 200 tall, every other lane at least 48', () => {
    expect(NIGHT_LAYOUT.fullStagesMin).toBeGreaterThanOrEqual(200)
    expect(NIGHT_LAYOUT.fullLaneH).toBeGreaterThanOrEqual(48)
  })
  it('a legend item per kind of mark drawn', () => {
    expect(nightLegend({}).length).toBe(0)
    expect(nightLegend({ restless: true, snoring: true, spo2Low: true }).map((x) => x.label)).toEqual(['Restless', 'Snoring', 'SpO2 under 90%'])
  })
})
