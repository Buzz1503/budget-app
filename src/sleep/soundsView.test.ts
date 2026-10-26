import { describe, it, expect } from 'vitest'
import { soundsNight, sessionNight, capturedMin, loudEventsOf, loudestWindow, SOUNDS } from './sounds'
import type { SoundsSession } from './sounds'
import { soundsLine, sessionRows, stopReasonText, snoreDensity, burstAt, trendPoints, shortRuns, minutesWords, gapReasonText } from './soundsView'
import { buildRows } from './analysis/dataset'

const T = Date.parse('2026-10-23T22:00:00Z')
const m = (min: number) => T + min * 60000
const session = (over: Partial<SoundsSession> = {}): SoundsSession => ({
  id: 's', start: m(0), end: m(7 * 60), events: [], levels: [], loudMinutes: 0, movingMinutes: 0, lowConfidence: false, room: [], startedBy: 'shortcut', ...over,
})
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16)

describe('zero is not missing', () => {
  it('a night that ran and heard nothing is 0 minutes, a night that did not run is nothing', () => {
    const ran = soundsNight([session()], null)!
    expect(ran.recorded).toBe(true)
    expect(ran.snoringMin).toBe(0)
    expect(soundsNight([], null)).toBeNull()
  })

  it('the trend has a point for a 0 night and none for a night that did not run, never a filled zero', () => {
    const quiet = soundsNight([session()], null)
    const loud = soundsNight([session({ events: [{ s: m(60), e: m(70), label: 'snoring', c: 0.9 }] })], null)
    const pts = trendPoints([
      { date: '2026-10-22', sounds: loud },
      { date: '2026-10-23', sounds: null },
      { date: '2026-10-24', sounds: quiet },
    ])
    expect(pts).toEqual([{ date: '2026-10-22', value: 10 }, { date: '2026-10-24', value: 0 }])
  })

  it('the analysis row has no snoring for a night that did not run, and a real 0 for one that ran 4 hours', () => {
    const row = (sounds: ReturnType<typeof soundsNight>) => buildRows(
      [{ date: '2026-10-24', evening: '2026-10-23', binary: {}, continuous: {}, line: [] }],
      new Map([['2026-10-24', {
        date: '2026-10-24', asleepMin: 400, deepMin: 50, remMin: 90, awakeMin: 20, awakenings: 2, hrLow: 50, hrAvg: 55, hrv: 50, score: 80, rhrNext: 54,
        readinessNext: 70, breathing: null, spo2Dips: null, restless: null, morning: null, sounds, lateUseMin: null, audio: null, latencyMin: null, hrDipPct: null, daylightMorningMin: null, waterL: null,
      }]]),
    )[0].outcomes.snoring
    expect(row(null)).toBeNull()
    expect(row(soundsNight([session()], null))).toBe(0)
  })
})

describe('the 4 hour rule', () => {
  it('counts only nights with at least 4 hours of audio', () => {
    expect(soundsNight([session({ end: m(239) })], null)!.eligible).toBe(false)
    expect(soundsNight([session({ end: m(240) })], null)!.eligible).toBe(true)
    expect(SOUNDS.minAnalysisMin).toBe(240)
  })

  it('gaps are not audio: 4 hours 30 with a 40 minute gap is under 4 hours', () => {
    const s = session({ end: m(270), gaps: [{ s: m(100), e: m(140), reason: 'interrupted' }] })
    expect(capturedMin(s)).toBe(230)
    expect(soundsNight([s], null)!.eligible).toBe(false)
  })

  it('a short night does not reach the analysis, the apnea inputs or the trend', () => {
    const short = soundsNight([session({ end: m(120), events: [{ s: m(10), e: m(60), label: 'snoring', c: 0.9 }] })], null)
    const row = buildRows(
      [{ date: '2026-10-24', evening: '2026-10-23', binary: {}, continuous: {}, line: [] }],
      new Map([['2026-10-24', {
        date: '2026-10-24', asleepMin: 400, deepMin: 50, remMin: 90, awakeMin: 20, awakenings: 2, hrLow: 50, hrAvg: 55, hrv: 50, score: 80, rhrNext: 54,
        readinessNext: 70, breathing: null, spo2Dips: null, restless: null, morning: null, sounds: short, lateUseMin: null, audio: null, latencyMin: null, hrDipPct: null, daylightMorningMin: null, waterL: null,
      }]]),
    )[0]
    expect(row.outcomes.snoring).toBeNull()
    expect(trendPoints([{ date: '2026-10-24', sounds: short }])).toEqual([])
    expect(shortRuns([{ sounds: short }])).toBe(1)
  })
})

describe('events into minutes and runs', () => {
  it('snoring minutes, longest run and when it began', () => {
    const s = session({
      events: [
        { s: m(10), e: m(12), label: 'snoring', c: 0.8 },
        { s: m(12.5), e: m(15), label: 'snoring', c: 0.9 }, // half a minute later: one run of 5
        { s: m(100), e: m(101), label: 'snoring', c: 0.7 },
        { s: m(50), e: m(50.1), label: 'cough', c: 0.9 },
        { s: m(60), e: m(60.1), label: 'cough', c: 0.9 },
        { s: m(200), e: m(200.2), label: 'speech', c: 0.6 },
      ],
    })
    const n = soundsNight([s], null)!
    expect(n.snoringMin).toBe(5.5)
    expect(n.longestSnoreMin).toBe(5)
    expect(n.longestSnoreAt).toBe(m(10))
    expect(n.coughs).toBe(2)
    expect(n.talking).toBe(1)
  })

  it('snoring per 10 minutes and the burst a tap lands on', () => {
    const ev = [{ s: m(5), e: m(15), label: 'snoring', c: 0.8 }, { s: m(32), e: m(33), label: 'snoring', c: 0.6 }, { s: m(40), e: m(41), label: 'cough', c: 0.9 }]
    expect(snoreDensity(ev, m(0), m(40)).map((b) => b.min)).toEqual([5, 5, 0, 1])
    expect(burstAt(ev, m(12), 60000)).toBe(ev[0])
    expect(burstAt(ev, m(32.5), 60000)).toBe(ev[1])
    expect(burstAt(ev, m(25), 60000)).toBeNull()
    expect(burstAt(ev, m(40.5), 60000)).toBeNull() // a cough is not a snoring burst
  })

  it('loud moments are minutes 15 dB over the median, neighbours joined; the loudest period and the average level', () => {
    const levels = Array.from({ length: 60 }, (_, i) => [m(i), i >= 30 && i < 33 ? -30 : -60])
    const ev = loudEventsOf(levels)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ s: m(30), db: -30 })
    expect(loudestWindow(levels)!.s).toBeLessThanOrEqual(m(30))
    const n = soundsNight([session({ levels })], null)!
    expect(n.loudEvents).toHaveLength(1)
    expect(n.avgDb).toBe(-58)
    expect(n.loudestWindow!.db).toBeGreaterThan(-60)
  })
})

describe('interruptions leave gaps in the log, not holes in the night', () => {
  it('captured minutes take the gaps out and the log names each one', () => {
    const s = session({ end: m(420), gaps: [{ s: m(100), e: m(115), reason: 'interrupted' }, { s: m(200), e: m(205), reason: 'route' }], stopReason: 'focusOff', checkpoints: 84 })
    expect(capturedMin(s)).toBe(400)
    const [row] = sessionRows({ '2026-10-24': [s] })
    expect(row).toMatchObject({ capturedMin: 400, gaps: 2, gapMin: 20, reason: 'Sleep Focus ended', checkpoints: 84 })
    expect(gapReasonText('route')).toMatch(/changed/)
    expect(gapReasonText('interrupted')).toMatch(/call/)
  })

  it('every way a session can end has plain words', () => {
    const r = (stopReason: string | null, extra = {}) => stopReasonText({ stopReason, ...extra } as never)
    expect(r('focusOff')).toBe('Sleep Focus ended')
    expect(r('unplugged')).toBe('Unplugged')
    expect(r('tooLong')).toBe('11 hour limit')
    expect(r('interrupted')).toBe('Interrupted')
    expect(r('appClosed')).toBe('App closed')
    expect(r('app')).toBe('Stopped in the app')
    expect(r(null, { recovered: true })).toBe('App closed')
    expect(r(null, { open: true })).toBe('Still listening')
  })
})

describe('a killed app still leaves the night', () => {
  // the iPhone closes a session it finds open at its last checkpoint; this is what reaches the web layer
  const recovered = session({ end: m(190), recovered: true, stopReason: 'appClosed', lastCheckpoint: m(190), checkpoints: 38, events: [{ s: m(30), e: m(60), label: 'snoring', c: 0.9 }] })

  it('keeps what was heard up to the checkpoint and says the app was closed', () => {
    const n = soundsNight([recovered], null)!
    expect(n.snoringMin).toBe(30)
    expect(n.capturedMin).toBe(190)
    expect(n.eligible).toBe(false)
    expect(stopReasonText(recovered)).toBe('App closed')
  })
})

describe('linking a session to its night by wake date', () => {
  const local = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const hour = (ms: number) => new Date(ms).getUTCHours()
  it('files it under the day it ended', () => {
    expect(sessionNight(session({ start: m(0), end: m(420) }), local, hour)).toBe('2026-10-24')
  })
  it('a session that stopped before midnight belongs to the morning after', () => {
    expect(sessionNight(session({ start: m(0), end: m(90) }), local, hour)).toBe('2026-10-24')
  })
  it('a session that began after midnight is that morning', () => {
    const late = session({ start: Date.parse('2026-10-24T00:30:00Z'), end: Date.parse('2026-10-24T07:00:00Z') })
    expect(sessionNight(late, local, hour)).toBe('2026-10-24')
  })
  it('without an hour it is simply the end date', () => {
    expect(sessionNight(session({ start: m(0), end: m(90) }), local)).toBe('2026-10-23')
  })
})

describe('the share of sleep follows the Watch', () => {
  it('minutes only until the night arrives, then the share', () => {
    const s = session({ events: [{ s: m(60), e: m(98), label: 'snoring', c: 0.9 }] })
    expect(soundsNight([s], null)!.snoringPct).toBeNull()
    const later = soundsNight([s], { start: m(0), end: m(420), asleepMin: 400 })!
    expect(later.snoringMin).toBe(38)
    expect(later.snoringPct).toBe(9.5)
  })
})

describe('the status line', () => {
  const base = { enabled: true, running: false, startedAt: null, label: 'Last night', isLast: true, live: true, clock }
  const snoring = soundsNight([session({ events: [{ s: m(60), e: m(98), label: 'snoring', c: 0.9 }] })], { start: m(0), end: m(420), asleepMin: 600 })
  it('listening now', () => {
    expect(soundsLine({ ...base, running: true, startedAt: Date.parse('2026-10-23T22:42:00Z'), sounds: null })).toBe('Listening now since 22:42')
  })
  it('snoring with its share of sleep, or minutes only', () => {
    expect(soundsLine({ ...base, sounds: snoring })).toBe('Last night: 38 min snoring, 6% of sleep')
    expect(soundsLine({ ...base, sounds: soundsNight([session({ events: [{ s: m(60), e: m(98), label: 'snoring', c: 0.9 }] })], null) })).toBe('Last night: 38 min snoring')
  })
  it('ran and heard nothing', () => {
    expect(soundsLine({ ...base, sounds: soundsNight([session({ end: m(432) })], null) })).toBe('Last night: ran 7 h 12 min, heard no snoring')
  })
  it('did not run, or is off', () => {
    expect(soundsLine({ ...base, sounds: null })).toBe("Didn't run last night")
    expect(soundsLine({ ...base, label: 'Night to Sat 24 Oct', isLast: false, sounds: null })).toBe("Didn't run, night to sat 24 oct")
    expect(soundsLine({ ...base, enabled: false, sounds: null })).toBe('Sleep sounds is off')
  })
  it('wording for minutes', () => {
    expect(minutesWords(432)).toBe('7 h 12 min')
    expect(minutesWords(240)).toBe('4 h')
    expect(minutesWords(38)).toBe('38 min')
  })
})
