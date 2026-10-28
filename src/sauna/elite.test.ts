import { describe, it, expect } from 'vitest'
import { beforeVsSince, beforeSinceDots, beforeSinceAnswer, compactGrid, recoveryAround, minute10Row } from './insights'
import type { Lookups, AdaptSession } from './insights'
import { aroundAnswer } from './saunaEffects'
import type { SaunaSession } from './sauna'
import { addDays } from '../health/tz'

const session = (date: string, over: Partial<SaunaSession> = {}): SaunaSession => ({
  id: `s-${date}`, date, start: '19:00', lengthMin: 20, tempC: 70, type: 'Traditional', rounds: 1, coldMin: null,
  weightBeforeKg: null, weightAfterKg: null, notes: '', source: 'manual', workoutId: null, ...over,
} as SaunaSession)

const FIRST = '2026-09-01'
const TODAY = '2026-10-07'
const lookups: Lookups = {
  morning: (d) => ({ rhr: d < FIRST ? 57 : 56, hrv: d < FIRST ? 40 : 66, readiness: null }),
  night: () => null,
}

describe('before and after dot plot data', () => {
  const r = beforeVsSince({ ...lookups, sessions: [session(FIRST)], today: TODAY })
  const dots = beforeSinceDots(r.rows)
  it('a grey before, a coloured since, toned by the better direction', () => {
    const hrv = dots.find((d) => d.key === 'hrv')!
    expect(hrv.before).toBe(40)
    expect(hrv.since).toBe(66)
    expect(hrv.tone).toBe('better')
    expect(hrv.status).toBe('Clear')
    const rhr = dots.find((d) => d.key === 'rhr')!
    expect(rhr.tone).toBe('better') // down is better for resting heart rate
    expect(rhr.status).toBe('Normal')
  })
  it('answers with the clearest change first', () => {
    expect(beforeSinceAnswer(dots)).toBe('HRV is up 26 ms since you started. Others are within your normal range.')
  })
  it('everything Early under 14 days', () => {
    const early = beforeSinceDots(r.rows, true)
    expect(early.every((d) => d.status === 'Early')).toBe(true)
    expect(beforeSinceAnswer(early)).toMatch(/^Too early/)
  })
})

describe('compact consistency grid', () => {
  it('12 columns from the first sauna week, weeks to come empty', () => {
    const g = compactGrid([session('2026-10-01'), session('2026-10-06')], '2026-10-07')
    expect(g.weeks).toHaveLength(12)
    expect(g.weeks[0][0].date).toBe('2026-09-28') // the Monday of the first session's week
    expect(g.weeks[0][3].level).toBeGreaterThan(0)
    expect(g.weeks[0][0].before).toBe(true)
    expect(g.weeks[11].every((d) => d.future)).toBe(true)
    expect(g.pages).toBe(1)
  })
  it('after 12 weeks the latest 12, with earlier pages', () => {
    const sessions = [session('2026-01-05'), session('2026-10-06')]
    const g = compactGrid(sessions, '2026-10-07')
    expect(g.weeks).toHaveLength(12)
    expect(g.weeks[11][0].date).toBe('2026-10-05') // this week last
    expect(g.pages).toBeGreaterThan(1)
    const back = compactGrid(sessions, '2026-10-07', 1)
    expect(back.weeks[11][0].date).toBe(addDays('2026-10-05', -84))
    // never before the first week
    const oldest = compactGrid(sessions, '2026-10-07', 99)
    expect(oldest.weeks[0][0].date).toBe('2026-01-05')
  })
})

describe('recovery around sauna days', () => {
  it('8 weeks of mornings, sauna days marked, the start line inside the window', () => {
    const r = recoveryAround([session(FIRST), session('2026-09-03')], lookups.morning, TODAY, 'hrv')
    expect(r.points).toHaveLength(56)
    expect(r.points.filter((p) => p.sauna).map((p) => p.date)).toEqual([FIRST, '2026-09-03'])
    expect(r.started).toBe(FIRST)
  })
  it('answers from the existing comparison', () => {
    expect(aroundAnswer({ diff: 3.2, withN: 28, withoutN: 7 }, 'hrv')).toBe('HRV averages 3 ms higher on mornings after sauna.')
    expect(aroundAnswer({ diff: -1.4, withN: 28, withoutN: 7 }, 'rhr')).toBe('Resting heart rate averages 1 bpm lower on mornings after sauna.')
    expect(aroundAnswer(null, 'hrv')).toMatch(/^Needs 7 mornings/)
  })
})

describe('minute 10 as a session row', () => {
  const list: AdaptSession[] = [
    { id: 'a', date: '2026-10-01', start: '19:00', tempC: 70, lengthMin: 20, hr10: 104 },
    { id: 'b', date: '2026-10-02', start: '19:00', tempC: 72, lengthMin: 20, hr10: 105 },
    { id: 'c', date: '2026-10-03', start: '19:00', tempC: 68, lengthMin: 20, hr10: 106 },
    { id: 'd', date: '2026-10-04', start: '19:00', tempC: 70, lengthMin: 20, hr10: 108 },
  ]
  it('against your usual at the same temperature', () => {
    expect(minute10Row(list, 'd')).toEqual({ hr10: 108, usual: 105, centre: 70 })
  })
  it('no usual under 3 others', () => {
    expect(minute10Row(list.slice(2), 'd')?.usual).toBeNull()
  })
})
