import { describe, it, expect } from 'vitest'
import { restlessForNight, overlapShare, moveLane, motionWords } from './restlessMatch'

const H = 3600000
const at = (date: string, h: number) => Date.parse(`${date}T00:00:00Z`) + h * H

describe('matching movement to its night', () => {
  const night = { date: '2026-10-28', start: at('2026-10-27', 23), end: at('2026-10-28', 7) }

  it('takes the summary filed under the night when it covers it', () => {
    const r = { start: night.start + 10 * 60000, end: night.end, series: [0] }
    expect(restlessForNight({ '2026-10-28': { restless: r } }, night)).toBe(r)
  })

  it('finds a summary filed under the day before when it is the same sleep', () => {
    // the Watch put a night that ended at 00:30 its time under the 27th
    const r = { start: at('2026-10-27', 23.2), end: at('2026-10-28', 6.8), series: [0] }
    expect(restlessForNight({ '2026-10-27': { restless: r } }, night)).toBe(r)
  })

  it('a nap filed under the night\'s date does not stand in for it', () => {
    const nap = { start: at('2026-10-28', 14), end: at('2026-10-28', 15), series: [0] }
    const real = { start: at('2026-10-27', 23), end: at('2026-10-28', 7), series: [0] }
    expect(restlessForNight({ '2026-10-28': { restless: nap } }, night)).toBeNull()
    expect(restlessForNight({ '2026-10-28': { restless: nap }, '2026-10-29': { restless: real } }, night)).toBe(real)
  })

  it('an older summary with no window is trusted where it was filed', () => {
    const old = { series: [0.1] } as never
    expect(restlessForNight({ '2026-10-28': { restless: old } }, night)).toBe(old)
  })

  it('overlap is a share of the shorter span', () => {
    expect(overlapShare({ start: 0, end: 10 }, { start: 5, end: 100 })).toBe(0.5)
    expect(overlapShare({ start: 0, end: 10 }, { start: 20, end: 30 })).toBe(0)
  })
})

describe('the Move lane', () => {
  const base = { enabled: true, hasRecording: false, date: '2026-10-28', firstRecorded: '2026-10-20', nightEnd: at('2026-10-28', 7), latest: true }

  it('waits for the Watch on the latest night instead of saying Not recorded', () => {
    expect(moveLane({ ...base, now: at('2026-10-28', 9) })).toBe('waiting')
    expect(moveLane({ ...base, now: at('2026-10-28', 20) })).toBe('missing')
    expect(moveLane({ ...base, latest: false, now: at('2026-10-28', 9) })).toBe('missing')
  })

  it('recorded, off, or before the first recording', () => {
    expect(moveLane({ ...base, hasRecording: true, now: 0 })).toBe('recorded')
    expect(moveLane({ ...base, enabled: false, now: at('2026-10-29', 9) })).toBe('none')
    expect(moveLane({ ...base, firstRecorded: null, latest: false, now: at('2026-10-29', 9) })).toBe('none')
  })
})

describe('the Watch report line', () => {
  it('says when the recording was asked for, by what, and the last read', () => {
    const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16)
    const at = Date.parse('2026-10-28T21:02:00Z')
    expect(motionWords({ at, by: 'soundsStarted', result: 'noData' }, clock, at + 3600000))
      .toBe('Movement recording asked for at 21:02 by Sleep sounds starting. Last read: the night had no movement recorded.')
    expect(motionWords({ at, by: 'appRun' }, clock, at + 30 * 3600000)).toBe('Movement recording asked for over 20 hours ago by the Pepito Watch app.')
    expect(motionWords(null, clock, 0)).toBeNull()
  })
})
