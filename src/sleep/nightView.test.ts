import { describe, it, expect } from 'vitest'
import { momentAt, whatHappened, nightSummary, hrRange } from './nightView'
import type { NightData } from './nightView'

const T = Date.parse('2026-10-26T23:00:00Z')
const m = (min: number) => T + min * 60000
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16)

// Health only: stages, heart rate (a spike at 300 to 302 min), HRV, SpO2 (one dip) and breathing rate
const night: NightData = {
  night: {
    start: m(0), end: m(480),
    segments: [
      { start: m(0), end: m(60), stage: 'core' },
      { start: m(60), end: m(64), stage: 'awake' },
      { start: m(64), end: m(150), stage: 'deep' },
      { start: m(150), end: m(480), stage: 'rem' },
    ],
  },
  overnight: {
    hr: [[0, 55], [30, 53], [61, 62], [90, 51], [200, 54], [300, 70], [301, 72], [302, 70], [400, 52]],
    hrv: [[60, 40], [240, 55]],
    spo2: [[120, 95], [250, 88]],
    resp: [[60, 15], [300, 14]],
  },
  events: [{ t: m(301), surge: 15 }, { t: m(420), surge: 9 }],
}

describe('the crosshair reads every Health lane at one minute', () => {
  it('stage, heart rate, HRV, blood oxygen, breathing and a note at the same moment', () => {
    expect(momentAt(night, m(61))).toMatchObject({ stage: 'awake', hr: 62, hrv: 40, spo2: null, resp: 15, event: null })
    expect(momentAt(night, m(250))).toMatchObject({ stage: 'rem', spo2: 88, hrv: 55 })
    expect(momentAt(night, m(301))).toMatchObject({ hr: 72, event: 'Heart rate spike, 17 above', resp: 14 })
    // nothing near: no reading is made up
    expect(momentAt(night, m(170)).hr).toBeNull()
  })

  it('has no movement or sound', () => {
    const k = Object.keys(momentAt(night, m(61)))
    expect(k).not.toContain('movement')
    expect(k).not.toContain('sound')
    expect(hrRange(night.overnight!.hr)).toEqual({ low: 51, high: 72 })
  })
})

describe('what happened', () => {
  it('wake-ups, heart rate spikes, surges and SpO2 dips in time order', () => {
    const list = whatHappened(night, clock)
    expect(list.map((h) => h.kind)).toEqual(['wake', 'spo2', 'spike', 'surge'])
    expect(list[0].text).toBe('00:00 Woke for 4 min. Heart rate rose to 62.')
    expect(list[1].text).toBe('03:10 Blood oxygen reading 88%.')
    expect(list[2].text).toBe("04:00 Heart rate 72, 17 above the night's usual, for 3 min.")
    // the surge inside the spike is not listed twice
    expect(list[3].text).toBe('06:00 Heart rate rose 9 bpm above your usual for the night.')
  })

  it('a wake at the very start of the night is not listed', () => {
    const edge: NightData = { night: { start: m(0), end: m(60), segments: [{ start: m(0), end: m(5), stage: 'awake' }, { start: m(5), end: m(60), stage: 'core' }] } }
    expect(whatHappened(edge, clock)).toEqual([])
  })
})

describe('the summary line', () => {
  it('wake-ups, awake minutes and heart rate spikes, nothing about snoring or movement', () => {
    expect(nightSummary(night)).toBe('Woke once, 4 min awake. 1 heart rate spike.')
    expect(nightSummary({ night: night.night })).toBe('Woke once, 4 min awake.')
  })
})
