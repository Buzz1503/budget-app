import { describe, it, expect } from 'vitest'
import { momentAt, restlessBands, whatHappened, nightSummary, soundLane, SOUND_LANE_WORDS, movementWord, hrRange, zoomNight, NIGHT_ZOOM_MIN } from './nightView'
import type { NightData } from './nightView'
import type { SoundsSession } from './sounds'

const T = Date.parse('2026-10-26T23:00:00Z')
const m = (min: number) => T + min * 60000
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16)
const session = (over: Partial<SoundsSession> = {}): SoundsSession => ({ id: 's', start: m(-10), end: m(480), events: [], levels: [], loudMinutes: 0, movingMinutes: 0, lowConfidence: false, room: [], startedBy: 'shortcut', ...over })

// moving share per minute: still, then a restless burst at 55 to 64 min, another at 200 to 204
const series = Array.from({ length: 480 }, (_, i) => ((i >= 55 && i < 65) || (i >= 200 && i < 205) ? 0.4 : i === 100 ? 0.1 : 0))
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
    hr: [[0, 55], [30, 53], [61, 62], [90, 51], [200, 54], [300, 66], [400, 52]],
    spo2: [[120, 95], [250, 88]],
  },
  restless: { start: m(0), series },
  sounds: [session({ events: [{ s: m(300), e: m(303), label: 'snoring', c: 0.8 }, { s: m(303.5), e: m(305), label: 'snoring', c: 0.9 }] })],
  events: [{ t: m(300), surge: 14 }],
}

describe('the crosshair reads every lane at one minute', () => {
  it('stage, movement, heart rate, blood oxygen, sound and event at the same moment', () => {
    expect(momentAt(night, m(61))).toMatchObject({ stage: 'awake', movement: 'Restless', hr: 62, spo2: null, sound: null })
    expect(momentAt(night, m(250))).toMatchObject({ stage: 'rem', movement: 'Still', spo2: 88 })
    expect(momentAt(night, m(301))).toMatchObject({ sound: 'Snoring', event: 'Heart rate up 14 bpm', hr: 66 })
    expect(momentAt(night, m(100)).movement).toBe('Light')
    // nothing near: no heart rate is made up
    expect(momentAt(night, m(170)).hr).toBeNull()
  })

  it('movement words and the heart rate range', () => {
    expect([movementWord(0), movementWord(0.1), movementWord(0.5), movementWord(null)]).toEqual(['Still', 'Light', 'Restless', null])
    expect(hrRange(night.overnight!.hr)).toEqual({ low: 51, high: 66 })
  })
})

describe('restless bands', () => {
  it('5-minute blocks with 30 seconds of movement, neighbours joined', () => {
    expect(restlessBands(night.restless)).toEqual([{ s: m(55), e: m(65) }, { s: m(200), e: m(205) }])
    // 20 seconds in a block is not restless
    expect(restlessBands({ start: m(0), series: [0.1, 0.1, 0.1, 0.03, 0] })).toEqual([])
    expect(restlessBands(null)).toEqual([])
  })
})

describe('what happened', () => {
  it('the night in time order, one line each, the lanes read together', () => {
    const list = whatHappened(night, clock)
    expect(list.map((h) => h.kind)).toEqual(['restless', 'wake', 'restless', 'spo2', 'surge', 'snoring'])
    expect(list[1].text).toBe('00:00 Woke for 4 min. Heart rate rose to 62, you moved a lot just before.')
    expect(list[0].text).toBe('23:55 Restless for 10 min, to 00:05.')
    expect(list[3].text).toBe('03:10 Blood oxygen reading 88%.')
    expect(list[5].text).toBe('04:00 Snoring for 5 min.')
    const times = list.map((h) => h.t)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('a wake at the very start or end of the night is not listed', () => {
    const edge: NightData = { night: { start: m(0), end: m(60), segments: [{ start: m(0), end: m(5), stage: 'awake' }, { start: m(5), end: m(60), stage: 'core' }] } }
    expect(whatHappened(edge, clock)).toEqual([])
  })
})

describe('the summary line and the Sound lane', () => {
  it('restless count and longest, heart rate low, snoring', () => {
    expect(nightSummary(night)).toBe('Restless 2 times, longest 10 min. Heart rate low 51. Snoring 5 min.')
    expect(nightSummary({ ...night, sounds: [session()] })).toBe('Restless 2 times, longest 10 min. Heart rate low 51. No snoring heard.')
    expect(nightSummary({ ...night, sounds: [] })).toBe('Restless 2 times, longest 10 min. Heart rate low 51.')
  })

  it('ran and heard nothing, did not run, heard something', () => {
    expect(soundLane([session()])).toBe('quiet')
    expect(soundLane([])).toBe('off')
    expect(soundLane(null)).toBe('off')
    expect(soundLane(night.sounds)).toBe('heard')
    expect(SOUND_LANE_WORDS).toEqual({ quiet: 'Listening, nothing heard', off: 'Not recording' })
  })
})

describe('zooming the night', () => {
  it('never narrower than 30 minutes and never outside the night', () => {
    const n = { start: m(0), end: m(480) }
    const z = zoomNight({ from: m(0), to: m(480) }, 0.001, 0.5, n)
    expect((z.to - z.from) / 60000).toBe(NIGHT_ZOOM_MIN)
    const out = zoomNight({ from: m(100), to: m(200) }, 100, 0.5, n)
    expect(out).toEqual({ from: m(0), to: m(480) })
    const edge = zoomNight({ from: m(400), to: m(480) }, 0.5, 1, n)
    expect(edge.to).toBe(m(480))
  })
})
