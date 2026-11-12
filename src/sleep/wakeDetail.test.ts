import { describe, it, expect } from 'vitest'
import { wakeDetails, wakeLine, byHour, stageShare, hrCurve, backToSleep, shouldAskWhy, reasonCounts, clock12, median, type WakeDetail } from './wakeDetail'
import { wakeUps } from './restless'

const MIN = 60000
const T0 = Date.parse('2026-11-11T12:00:00Z') // 10 pm in Brisbane
const at = (m: number) => T0 + m * MIN
const seg = (a: number, b: number, stage: string) => ({ start: at(a), end: at(b), stage })
const TZ = 'Australia/Brisbane'

// 10 pm awake 5, asleep core, REM, awake 6 min at 4:14 (wake-up), core, a 1 min blip (not a wake-up), deep, final awake
const night = [
  seg(0, 5, 'awake'), seg(5, 120, 'core'), seg(120, 254, 'rem'), seg(254, 260, 'awake'), seg(260, 300, 'core'),
  seg(300, 301, 'awake'), seg(301, 400, 'deep'), seg(400, 420, 'core'), seg(420, 430, 'awake'),
]
const hr: Array<[number, number]> = []
for (let m = 0; m <= 430; m += 2) hr.push([at(m), m >= 244 && m < 254 ? 58 : m >= 254 && m <= 264 ? 71 : 55])

describe('wake-ups in detail', () => {
  it('one definition: 2 minutes or more after falling asleep and before the final wake', () => {
    const d = wakeDetails(night, hr)
    expect(d).toHaveLength(1)
    expect(wakeUps(night)!.count).toBe(d.length)
  })
  it('the stage before, heart rate 10 minutes either side, and minutes back to sleep', () => {
    const [w] = wakeDetails(night, hr)
    expect(w.durationMin).toBe(6)
    expect(w.stageBefore).toBe('rem')
    expect(w.hrBefore).toBe(58)
    expect(w.hrAfter).toBe(71)
    expect(w.hrChange).toBe(13)
    expect(w.backToSleepMin).toBe(6)
    expect(wakeLine(w, (ms) => clock12(ms, TZ))).toBe('2:14 am · 6 min · after REM · HR 58 → 71')
  })
  it('no stage word for nights recorded as plain asleep; no heart rate, no numbers', () => {
    const plain = [seg(0, 100, 'asleep'), seg(100, 110, 'awake'), seg(110, 200, 'asleep')]
    const [w] = wakeDetails(plain, [])
    expect(w.stageBefore).toBeNull()
    expect(w.hrBefore).toBeNull()
    expect(wakeLine(w, (ms) => clock12(ms, TZ))).toBe('11:40 pm · 10 min')
  })
})

describe('when, from which stage, heart rate around waking, back to sleep', () => {
  const mk = (iso: string, stage: WakeDetail['stageBefore'] = 'core', back = 4): WakeDetail => ({ at: Date.parse(iso), durationMin: 3, stageBefore: stage, hrBefore: 55, hrAfter: 62, hrChange: 7, backToSleepMin: back })
  it('a histogram by clock hour, 9 pm to 7 am, with the two busiest hours', () => {
    const list = ['2026-11-10T15:10:00Z', '2026-11-10T15:40:00Z', '2026-11-10T16:20:00Z', '2026-11-11T16:05:00Z', '2026-11-11T19:30:00Z', '2026-11-11T11:30:00Z'].map((x) => mk(x))
    const r = byHour(list, TZ)
    expect(r.bins.map((b) => b.label)).toEqual(['9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'])
    expect(r.bins.find((b) => b.hour === 1)!.count).toBe(2)
    expect(r.bins.find((b) => b.hour === 2)!.count).toBe(2)
    expect(r.bins.find((b) => b.hour === 5)!.count).toBe(1)
    expect(r.bins.find((b) => b.hour === 21)!.count).toBe(1)
    expect(r.answer).toBe('Most wake-ups happen between 1 and 3 am.')
    expect(byHour(list.slice(0, 2), TZ).answer).toBe('Not enough wake-ups yet to see when they happen.')
  })
  it('the stage you wake from against your usual share of each stage', () => {
    const list = [...Array(6).fill('rem'), ...Array(3).fill('core'), 'deep'].map((s) => mk('2026-11-10T16:00:00Z', s))
    const r = stageShare(list, { rem: 90, core: 240, deep: 70 })
    expect(r.wake.rem).toBeCloseTo(0.6)
    expect(r.usual.core).toBeCloseTo(0.6)
    expect(r.answer).toBe('You wake from REM more often than the time you spend in it: 60% of wake-ups against 23% of sleep.')
    // the most over-represented stage is named, not the most common one
    const deepy = [...Array(5).fill('core'), ...Array(4).fill('deep'), 'rem'].map((s) => mk('2026-11-10T16:00:00Z', s))
    expect(stageShare(deepy, { rem: 60, core: 260, deep: 100 }).answer).toBe('You wake from Deep more often than the time you spend in it: 40% of wake-ups against 24% of sleep.')
  })
  it('the heart rate curve says how long before waking it starts to rise', () => {
    const nights = Array.from({ length: 5 }, (_, i) => {
      const w = Date.parse('2026-11-10T16:00:00Z') + i * 86400000
      const readings: Array<[number, number]> = []
      for (let m = -12; m <= 12; m++) readings.push([w + m * MIN, m < -3 ? 55 : m <= 0 ? 55 + (m + 3) * 3 : 66])
      return { details: [{ ...mk('2026-11-10T16:00:00Z'), at: w }], hr: readings }
    })
    const r = hrCurve(nights)
    expect(r.points).toHaveLength(21)
    expect(r.points[10]).toEqual({ min: 0, bpm: 64, n: 5 })
    expect(r.answer).toBe('Heart rate starts rising about 3 minutes before you wake.')
    expect(hrCurve(nights.slice(0, 3)).answer).toBe('Not enough wake-ups with heart rate yet.')
  })
  it('median minutes back to sleep against the good sleep period', () => {
    expect(median([5, 1, 9, 3])).toBe(4)
    const now = [3, 5, 7, 9, 11].map((b) => mk('2026-11-10T16:00:00Z', 'core', b))
    const ref = [2, 3, 4].map((b) => mk('2026-06-10T16:00:00Z', 'core', b))
    expect(backToSleep(now, ref).answer).toBe('Back to sleep in 7 minutes, 4 longer than your good sleep period.')
    expect(backToSleep(now, []).answer).toBe('Back to sleep in 7 minutes, the middle of your wake-ups.')
  })
})

describe('why I woke', () => {
  it('asked only after 2 or more wake-ups, never twice for the same night', () => {
    expect(shouldAskWhy('2026-11-12', 1, {})).toBe(false)
    expect(shouldAskWhy('2026-11-12', 2, {})).toBe(true)
    expect(shouldAskWhy('2026-11-12', 3, { '2026-11-12': { tags: [], at: 1, skipped: true } })).toBe(false)
    expect(shouldAskWhy('2026-11-12', 3, { '2026-11-12': { tags: ['Dog'], at: 1 } })).toBe(false)
  })
  it('counts each reason over the tagged nights of a period', () => {
    const saved = {
      '2026-09-01': { tags: ['Reflux or nausea', 'Bathroom'], at: 1 },
      '2026-09-02': { tags: ['Reflux or nausea'], at: 1 },
      '2026-09-03': { tags: [], at: 1, skipped: true },
      '2026-06-01': { tags: ['Dog'], at: 1 },
    }
    expect(reasonCounts(saved, [['2026-09-01', '2026-09-30']])).toEqual({ tagged: 2, counts: [{ tag: 'Reflux or nausea', count: 2 }, { tag: 'Bathroom', count: 1 }] })
    expect(reasonCounts(saved, null).tagged).toBe(3)
  })
})
