import { describe, it, expect } from 'vitest'
import { soundsNight, sessionNight, roomTooHot } from './sounds'
import type { SoundsSession } from './sounds'

const T = Date.parse('2026-10-23T12:00:00Z')
const m = (min: number) => T + min * 60000
const session = (over: Partial<SoundsSession> = {}): SoundsSession => ({
  id: 's', start: m(-30), end: m(480), events: [], levels: [], loudMinutes: 0, movingMinutes: 0, lowConfidence: false, room: [], startedBy: 'automation', ...over,
})

describe('snore aggregation from classifier events', () => {
  it('snoring minutes, share of sleep and the longest run', () => {
    const s = session({
      events: [
        { s: m(10), e: m(12), label: 'snoring', c: 0.8 },
        { s: m(12.5), e: m(15), label: 'snoring', c: 0.9 }, // 30 s gap: the same run
        { s: m(100), e: m(101), label: 'snoring', c: 0.7 },
        { s: m(-20), e: m(-10), label: 'snoring', c: 0.9 }, // before sleep: not counted
        { s: m(50), e: m(50.1), label: 'cough', c: 0.9 },
        { s: m(200), e: m(200.2), label: 'speech', c: 0.6 },
      ],
      loudMinutes: 3,
    })
    const n = soundsNight([s], { start: m(0), end: m(450), asleepMin: 400 })!
    expect(n.snoringMin).toBe(5.5)
    expect(n.snoringPct).toBe(1.4)
    expect(n.longestSnoreMin).toBe(5)
    expect(n.coughs).toBe(1)
    expect(n.talking).toBe(1)
    expect(n.loudMinutes).toBe(3)
    expect(n.lowConfidence).toBe(false)
  })

  it('overlapping events are counted once; without a night the whole session counts', () => {
    const s = session({ events: [{ s: m(-20), e: m(-10), label: 'snoring', c: 0.9 }, { s: m(-15), e: m(-5), label: 'snoring', c: 0.9 }] })
    const n = soundsNight([s], null)!
    expect(n.snoringMin).toBe(15)
    expect(n.snoringPct).toBeNull()
  })

  it('a phone that moved a lot marks the night low confidence; no sessions is no data', () => {
    expect(soundsNight([session({ lowConfidence: true })], null)!.lowConfidence).toBe(true)
    expect(soundsNight([], null)).toBeNull()
  })

  it('the bedroom: mean and max, humidity when known, and "too hot" from 24 C', () => {
    const n = soundsNight([session({ room: [[m(0), 23, 50], [m(5), 25, -1], [m(10), 25.5, 54]] })], { start: m(0), end: m(450), asleepMin: 400 })!
    expect(n).toMatchObject({ roomMeanC: 24.5, roomMaxC: 25.5, humidityMean: 52 })
    expect(roomTooHot(n)).toBe(true)
    expect(roomTooHot(soundsNight([session()], null))).toBeNull()
  })

  it('a session belongs to the morning it ended', () => {
    expect(sessionNight({ end: Date.parse('2026-10-24T20:30:00Z') }, (ms) => new Date(ms).toISOString().slice(0, 10))).toBe('2026-10-24')
  })
})
