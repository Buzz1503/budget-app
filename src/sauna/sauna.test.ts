import { describe, it, expect } from 'vitest'
import {
  newSession, weekOf, weekSummary, heatMinutes, heatmap, totals, fluidLost, saunaCandidates, saunaLaneDots,
  timerState, clockWords, roundMarkers, sessionFromTimer, defaultStart, usualFor, lastSessionLine, saunaLastNight,
} from './sauna'
import type { SaunaSession, WorkoutLike } from './sauna'
import {
  outcomeFor, dayFlags, saunaVsNone, saunaSplits, lengthBucket, recoveryLine, correlation,
} from './saunaEffects'
import type { SaunaEffectInput, NightLike } from './saunaEffects'
import { addDays, dateRange } from '../health/tz'

const T = '2026-10-21' // a Wednesday
const s = (date: string, lengthMin = 20, extra: Partial<SaunaSession> = {}) =>
  newSession({ date, start: '18:00', lengthMin, tempC: 60, ...extra }, `${date}-${lengthMin}-${extra.start || ''}`)

describe('timer', () => {
  it('elapsed time comes from the stored start, so it is right after the app was closed', () => {
    const timer = { startedAt: Date.parse('2026-10-21T08:00:00Z'), targetMin: 20, tempC: 60, rounds: 2 }
    // the app is killed and reopened 12.5 minutes later: nothing ran in between
    const later = timerState(timer, Date.parse('2026-10-21T08:12:30Z'))
    expect(later).toMatchObject({ elapsedMs: 750000, done: false })
    expect(later.fraction).toBeCloseTo(0.625, 6)
    expect(clockWords(later.elapsedMs)).toBe('12:30')
    expect(timerState(timer, Date.parse('2026-10-21T08:25:00Z')).done).toBe(true)
    expect(timerState(timer, Date.parse('2026-10-21T07:59:00Z')).elapsedMs).toBe(0) // a clock set back never goes negative
    expect(clockWords(3725000)).toBe('1:02:05')
    expect(roundMarkers(2)).toEqual([0.5])
    expect(roundMarkers(1)).toEqual([])
  })

  it('stopping prefills the log from the timer', () => {
    const timer = { startedAt: Date.parse('2026-10-21T08:00:00Z'), targetMin: 20, tempC: 75, rounds: 1 }
    const p = sessionFromTimer(timer, Date.parse('2026-10-21T08:24:40Z'), () => ({ date: '2026-10-21', minutes: 18 * 60 + 5 }))
    expect(p).toEqual({ date: '2026-10-21', start: '18:05', lengthMin: 25, tempC: 75, rounds: 1, source: 'timer' })
  })
})

describe('the week and the hero', () => {
  it('weeks run Monday to Sunday', () => {
    expect(weekOf('2026-10-21')).toEqual({ from: '2026-10-19', to: '2026-10-25' })
    expect(weekOf('2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-25' })
    expect(weekOf('2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' })
    expect(weekOf('2026-10-26').from).toBe('2026-10-26')
  })

  it('counts this week only, sums heat minutes, fills the ring to the target', () => {
    const list = [s('2026-10-18', 30), s('2026-10-19', 20), s('2026-10-21', 25), s('2026-10-21', 10, { start: '07:00' })]
    expect(weekSummary(list, T, 4)).toMatchObject({ count: 3, heatMin: 55, fill: 0.75 })
    expect(weekSummary([...list, s('2026-10-20'), s('2026-10-22')], T, 4).fill).toBe(1)
    expect(heatMinutes(list)).toBe(85)
  })

  it('last session line, the usual, and a start of now minus the length', () => {
    expect(lastSessionLine([s('2026-10-20', 25)], T)).toBe('Yesterday, 25 min at 60 C')
    expect(lastSessionLine([], T)).toBeNull()
    expect(usualFor([], {})).toEqual({ lengthMin: 20, tempC: 60 })
    expect(usualFor([s('2026-10-01', 30), s('2026-10-02', 30), s('2026-10-03', 15)], {}).lengthMin).toBe(30)
    expect(usualFor([s('2026-10-01', 30)], { usualLengthMin: 18, usualTempC: 70 })).toEqual({ lengthMin: 18, tempC: 70 })
    expect(defaultStart({ date: T, minutes: 19 * 60 }, 25)).toEqual({ date: T, start: '18:35' })
    expect(defaultStart({ date: T, minutes: 10 }, 25)).toEqual({ date: '2026-10-20', start: '23:45' })
    expect(saunaLastNight([s('2026-10-20')], T)).toBe(true)
    expect(saunaLastNight([s('2026-10-21')], T)).toBe(false)
  })
})

describe('history', () => {
  it('heatmap: 12 weeks of Monday-first rows, shaded by heat minutes', () => {
    const map = heatmap([s('2026-10-20', 10), s('2026-10-21', 20), s('2026-10-21', 15, { start: '07:00' }), s('2026-07-01', 40)], T)
    expect(map).toHaveLength(12)
    expect(map[0][0].date).toBe('2026-08-03') // Monday, 12 weeks back from this Sunday
    expect(map[11][6].date).toBe('2026-10-25')
    const day = (d: string) => map.flat().find((x) => x.date === d)!
    expect(day('2026-10-20')).toMatchObject({ minutes: 10, level: 1 })
    expect(day('2026-10-21')).toMatchObject({ minutes: 35, level: 3 })
    expect(day('2026-10-22')).toMatchObject({ minutes: 0, level: 0, future: true })
    expect(map.flat().some((x) => x.date === '2026-07-01')).toBe(false) // older than 12 weeks
  })

  it('monthly and yearly totals in sessions and hours', () => {
    const t = totals([s('2026-10-01', 30), s('2026-10-15', 30), s('2026-09-01', 45), s('2025-12-31', 60)], 'month')
    expect(t[0]).toEqual({ key: '2026-10', sessions: 2, minutes: 60, hours: 1 })
    expect(totals([s('2026-10-01', 30), s('2026-09-01', 45), s('2025-12-31', 60)], 'year')).toEqual([
      { key: '2026', sessions: 2, minutes: 75, hours: 1.3 },
      { key: '2025', sessions: 1, minutes: 60, hours: 1 },
    ])
  })

  it('fluid lost from before and after weights', () => {
    expect(fluidLost(92.4, 91.8)).toEqual({ litres: 0.6, text: 'about 0.6 L' })
    expect(fluidLost(92.4, null)).toBeNull()
    expect(fluidLost(92.4, 92.6)).toBeNull()
  })
})

describe('Apple Watch matching', () => {
  const w = (id: string, type: string, title: string): WorkoutLike => ({ id, type, title, start: Date.parse('2026-10-20T18:12:00Z'), end: Date.parse('2026-10-20T18:36:00Z'), date: '2026-10-20', durationMin: 24 })
  it('type Other or named Sauna, unlinked and not dismissed only', () => {
    const workouts = [w('a', 'other', 'Other'), w('b', 'traditionalStrengthTraining', 'Push'), w('c', 'mixedCardio', 'Evening sauna'), w('d', 'other', 'Other'), w('e', 'other', 'Other')]
    const sessions = [newSession({ date: '2026-10-20', start: '18:12', lengthMin: 24, tempC: 60, workoutId: 'd' }, 'x')]
    expect(saunaCandidates(workouts, sessions, ['e']).map((x) => x.id)).toEqual(['a', 'c'])
  })
})

describe('overlay lane', () => {
  it('one dot per session day in range, sized by minutes', () => {
    const dots = saunaLaneDots([s('2026-10-01', 10), s('2026-10-01', 30, { start: '07:00' }), s('2026-10-10', 10), s('2026-11-01', 60)], '2026-10-01', '2026-10-31')
    expect(dots.map((d) => [d.date, d.minutes])).toEqual([['2026-10-01', 40], ['2026-10-10', 10]])
    expect(dots[0].r).toBeCloseTo(6, 6)
    expect(dots[1].r).toBeCloseTo(4, 6)
  })
})

// ------------------------------------------------------------------ effects

/** Nights end at 06:30 on the wake date and start at 22:30 the evening before. */
const ms = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00Z`)
function fixture(opts: { sessions: SaunaSession[]; score: (wakeDate: string) => number; hrv: (date: string) => number; days?: string[] }): SaunaEffectInput {
  const days = opts.days || dateRange('2026-06-01', '2026-09-30')
  return {
    sessions: opts.sessions,
    days,
    night: (wake): NightLike => ({ start: ms(addDays(wake, -1), '22:30'), score: opts.score(wake), deepMin: 60, sleepingHR: 52 }),
    morning: (d) => ({ hrv: opts.hrv(d), rhr: 55, readiness: 70 }),
    toMs: ms,
    wobble: { sleepScore: 3, hrv: 4 },
  }
}

describe('sauna effects', () => {
  it('a session on day D reads night D (wake date D + 1) and morning D + 1', () => {
    const input = fixture({ sessions: [], score: (w) => (w === '2026-06-11' ? 90 : 70), hrv: (d) => (d === '2026-06-11' ? 40 : 50) })
    expect(outcomeFor('sleepScore', input)('2026-06-10')).toBe(90)
    expect(outcomeFor('hrv', input)('2026-06-10')).toBe(40)
    expect(outcomeFor('sleepScore', input)('2026-06-11')).toBe(70)
  })

  it('sauna days against days without, with group sizes and labels; 6 days is too early, 7 is enough', () => {
    const saunaDays = dateRange('2026-06-01', '2026-09-30').filter((_, i) => i % 3 === 0)
    const set = new Set(saunaDays)
    const input = fixture({
      sessions: saunaDays.map((d) => s(d)),
      score: (w) => (set.has(addDays(w, -1)) ? 80 : 74) + (Number(w.slice(8)) % 2),
      hrv: (d) => (set.has(addDays(d, -1)) ? 44 : 50) + (Number(d.slice(8)) % 2),
    })
    const rows = saunaVsNone(input)
    const score = rows.find((r) => r.key === 'sleepScore')!
    expect(score.split.with.n).toBe(saunaDays.length)
    expect(score.verdict).toBe('Clear change')
    expect(score.text).toMatch(/^Sleep score that night: 6 higher on sauna days than on days without$/)
    const hrv = rows.find((r) => r.key === 'hrv')!
    expect(hrv.text).toMatch(/^Next-morning HRV: 6 ms lower on sauna days/)
    expect(rows.map((r) => r.text).join(' ')).not.toMatch(/caused|improved|worked/)
    expect(recoveryLine(input)).toMatch(/^On mornings after sauna your HRV averages 6 ms lower \(n = \d+ vs \d+\)\.$/)

    const six = fixture({ sessions: dateRange('2026-06-01', '2026-06-06').map((d) => s(d)), score: () => 75, hrv: () => 50 })
    expect(saunaVsNone(six)[0]).toMatchObject({ verdict: 'Too early', diff: null })
    expect(saunaVsNone(six)[0].text).toMatch(/needs 1 more day in the smaller group/)
    expect(recoveryLine(six)).toBeNull()
    const seven = fixture({ sessions: dateRange('2026-06-01', '2026-06-07').map((d) => s(d)), score: () => 75, hrv: () => 50 })
    expect(saunaVsNone(seven)[0].verdict).toBe('Within normal fluctuation')
  })

  it('length buckets and late against earlier sessions', () => {
    expect([lengthBucket(19), lengthBucket(20), lengthBucket(30), lengthBucket(31)]).toEqual(['short', 'mid', 'mid', 'long'])
    const days = dateRange('2026-06-01', '2026-09-30')
    // alternate long late sessions (21:00, 40 min, ends 21:40: within 3 h of 22:30) and short early ones
    const sessions = days.filter((_, i) => i % 2 === 0).map((d, i) => (i % 2
      ? s(d, 40, { start: '21:00' })
      : s(d, 15, { start: '12:00' })))
    const late = new Set(sessions.filter((x) => x.start === '21:00').map((x) => x.date))
    const input = fixture({ sessions, days, score: (w) => (late.has(addDays(w, -1)) ? 68 : 76), hrv: () => 50 })
    const f = dayFlags(sessions, input.night, input.toMs)
    expect(f.late(sessions.find((x) => x.start === '21:00')!.date)).toBe(true)
    expect(f.late(sessions.find((x) => x.start === '12:00')!.date)).toBe(false)
    const { length, timing } = saunaSplits(input)
    expect(length.map((b) => b.bucket)).toEqual(['short', 'mid', 'long'])
    expect(length[1].rows[0].verdict).toBe('Too early') // nobody did 20 to 30 min
    expect(length[2].rows[0].text).toMatch(/^Sleep score that night: 8 lower after sessions over 30 min than on days without$/)
    expect(timing[0].text).toMatch(/^Sleep score that night: 8 lower after a session ending within 3 h of bedtime than after an earlier session$/)
  })

  it('correlation is null under three points or with no spread', () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6)
    expect(correlation([1, 2], [2, 4])).toBeNull()
    expect(correlation([1, 1, 1], [2, 4, 6])).toBeNull()
  })
})
