import { describe, it, expect } from 'vitest'
import { beforeVsSince, compoundCaveat, withinSauna, splitAtMedian, hrAtMinute10, heatAdaptation10, gridWeeks, weekHeader, nonSaunaLocked, INSIGHTS } from './insights'
import type { AdaptSession, Lookups } from './insights'
import type { SaunaSession } from './sauna'
import { addDays } from '../health/tz'

const session = (date: string, over: Partial<SaunaSession> = {}): SaunaSession => ({
  id: `s-${date}-${over.start || '19:00'}`, date, start: '19:00', lengthMin: 20, tempC: 70, type: 'Traditional', rounds: 1, coldMin: null,
  weightBeforeKg: null, weightAfterKg: null, notes: '', source: 'manual', workoutId: null, ...over,
} as SaunaSession)

const FIRST = '2026-10-01'
const TODAY = '2026-10-07'
// resting heart rate 57 before the first session and 54 since; HRV 50 before, 55 since
const lookups: Lookups = {
  morning: (d) => ({ rhr: d < FIRST ? 57 : 54, hrv: d < FIRST ? 50 : 55, readiness: null }),
  night: (wake) => ({ start: 0, score: wake <= FIRST ? 78 : 82, deepMin: 60, sleepingHR: wake <= FIRST ? 56 : 53, asleepMin: 420, restless: null }),
}

describe('since you started sauna against the 4 weeks before', () => {
  it('a line each, n days on each side, marked early under 14 days', () => {
    const r = beforeVsSince({ ...lookups, sessions: [session(FIRST), session('2026-10-03')], today: TODAY })
    expect(r.status).toBe('ok')
    expect(r.early).toBe('Early: 6 days')
    const rhr = r.rows.find((x) => x.key === 'rhr')!
    expect(rhr.text).toBe('Resting heart rate 54 bpm since you started sauna, 57 bpm in the 4 weeks before.')
    expect(rhr.nBefore).toBe(28)
    expect(rhr.nSince).toBe(6)
    const sleepHR = r.rows.find((x) => x.key === 'sleepingHR')!
    // nights belong to their wake date: the night after the first session is "since"
    expect(sleepHR.since).toBe(53)
    expect(sleepHR.before).toBe(56)
    expect(r.rows.find((x) => x.key === 'restlessness')).toBeUndefined() // no data on either side: no line
  })

  it('no longer early from 14 days', () => {
    expect(beforeVsSince({ ...lookups, sessions: [session(FIRST)], today: addDays(FIRST, 14) }).early).toBeNull()
  })

  it('no data before: one locked line', () => {
    const none: Lookups = { morning: () => ({ rhr: null, hrv: null, readiness: null }), night: () => null }
    const r = beforeVsSince({ ...none, sessions: [session(FIRST)], today: TODAY })
    expect(r.status).toBe('locked')
    expect(r.text).toMatch(/^Needs Health data from the 4 weeks before/)
  })

  it('the compound caveat appears when a dose changed near the first session, and only then', () => {
    const s = [session(FIRST)]
    expect(compoundCaveat(s, [{ date: '2026-09-28', text: 'Reta dose changed' }])).toBe('Reta dose changed 3 days before you started sauna, so this mixes both.')
    expect(compoundCaveat(s, [{ date: '2026-10-05', text: 'BPC-157 started.' }])).toBe('BPC-157 started 4 days after you started sauna, so this mixes both.')
    expect(compoundCaveat(s, [{ date: FIRST, text: 'Reta stopped' }])).toBe('Reta stopped the same day you started sauna, so this mixes both.')
    expect(compoundCaveat(s, [{ date: '2026-06-01', text: 'Reta started' }, { date: '2026-12-01', text: 'Reta stopped' }])).toBeNull()
    expect(compoundCaveat([], [{ date: FIRST, text: 'x' }])).toBeNull()
  })
})

describe('inside sauna days', () => {
  it('splits at the median by rank, so both sides are the same size', () => {
    const list = [10, 15, 20, 20, 20, 25, 30, 40].map((m, i) => session(addDays(FIRST, i), { lengthMin: m }))
    const { low, high, median } = splitAtMedian(list, (s) => s.lengthMin)
    expect(low.map((s) => s.lengthMin)).toEqual([10, 15, 20, 20])
    expect(high.map((s) => s.lengthMin)).toEqual([20, 25, 30, 40])
    expect(median).toBe(20)
  })

  it('locked with what each side needs and has; unlocks at 5 on each side', () => {
    const few = Array.from({ length: 4 }, (_, i) => session(addDays(FIRST, i)))
    const [evening, length, temp] = withinSauna(few, lookups)
    expect(evening.locked).toBe('Needs 5 evening sessions (6 pm or later) and 5 earlier ones. You have 4 and 0.')
    expect(length.locked).toBe('Needs 5 longer sessions and 5 shorter ones. You have 2 and 2.')
    expect(temp.locked).toMatch(/^Needs 5 hotter sessions/)

    // 6 evening sessions after which sleep score is 10 lower, 6 earlier ones
    const days = Array.from({ length: 12 }, (_, i) => addDays(FIRST, i))
    const list = days.map((d, i) => session(d, { start: i % 2 ? '20:30' : '08:00', lengthMin: 10 + i * 2, tempC: 60 + i }))
    const l: Lookups = {
      morning: () => ({ rhr: 54, hrv: 55, readiness: null }),
      night: (wake) => {
        const s = list.find((x) => addDays(x.date, 1) === wake)
        return s ? { start: 0, score: s.start === '20:30' ? 76 : 86, deepMin: 60, sleepingHR: 53 } : null
      },
    }
    const r = withinSauna(list, l)
    expect(r[0].locked).toBeNull()
    const score = r[0].rows.find((x) => x.key === 'sleepScore')!
    expect(score.text).toBe('Sleep score that night was 10 lower after evening sessions than after earlier ones.')
    expect([score.nA, score.nB]).toEqual([6, 6])
    expect(r[0].rows.find((x) => x.key === 'hrv')!.text).toBe('HRV the next morning was about the same after evening sessions as after earlier ones.')
  })

  it('the locked sauna against days off line', () => {
    expect(nonSaunaLocked(7, 1)).toBe('Needs 7 days without sauna to compare. You have 1.')
  })
})

describe('heat adaptation at minute 10', () => {
  it('reads minute 10 from the session series, a minute either side, as the median', () => {
    expect(hrAtMinute10([[0, 90], [540, 118], [600, 121], [660, 124], [900, 130]])).toBe(121)
    expect(hrAtMinute10([[0, 90], [300, 110]])).toBeNull()
    expect(hrAtMinute10(null)).toBeNull()
  })

  const adapt = (hr10s: number[], lengths: number[] = hr10s.map(() => 20), tempC = 70): AdaptSession[] =>
    hr10s.map((hr10, i) => ({ id: `a${i}`, date: addDays(FIRST, i), start: '19:00', tempC, lengthMin: lengths[i], hr10 }))

  it('too early under 6 sessions at one temperature band, with what it needs', () => {
    const r = heatAdaptation10(adapt([120, 119, 118, 117]))
    expect(r.status).toBe('early')
    expect(r.verdict).toBe('Too early: needs 6 sessions at 65 to 75 C (you have 4)')
    expect(heatAdaptation10([]).verdict).toBe('Too early: needs 6 sessions with Watch heart rate (you have 0)')
  })

  it('getting used to it at 3 bpm lower or more; no change under 3; higher said plainly', () => {
    const better = heatAdaptation10(adapt([124, 122, 123, 119, 117, 117]))
    expect(better.status).toBe('better')
    expect(better.verdict).toBe('Getting used to it: heart rate at 10 minutes is 5 bpm lower than your first sessions')
    expect(heatAdaptation10(adapt([120, 121, 119, 121, 119, 120])).verdict).toBe('No change yet: heart rate at 10 minutes is about the same as your first sessions')
    expect(heatAdaptation10(adapt([110, 111, 109, 114, 115, 116])).verdict).toBe('Heart rate at 10 minutes is 5 bpm higher than your first sessions')
    expect(INSIGHTS.adaptationBpm).toBe(3)
  })

  it('says when sessions got longer, which is why it compares minute 10', () => {
    const r = heatAdaptation10(adapt([124, 122, 123, 119, 117, 117], [18, 18, 20, 30, 31, 32]))
    expect(r.context).toBe('Your sessions have also got longer (18 to 31 min). Average heart rate rises with session length, which is why this compares minute 10.')
    expect(heatAdaptation10(adapt([124, 122, 123, 119, 117, 117])).context).toBeNull()
  })

  it('only sessions with a minute 10 reading count, and the band used most', () => {
    const list = [...adapt([124, 122, 123, 119, 117, 117]), ...adapt([150, 151], undefined, 90), { id: 'x', date: FIRST, start: '07:00', tempC: 70, lengthMin: 20, hr10: null }]
    const r = heatAdaptation10(list)
    expect(r.band!.label).toBe('65 to 75 C')
    expect(r.points).toHaveLength(6)
  })
})

describe('the consistency grid starts at the first session', () => {
  it('only the weeks that exist under 12, the last 12 after', () => {
    expect(gridWeeks([], '2026-10-28')).toBe(0)
    expect(gridWeeks([session('2026-10-27')], '2026-10-28')).toBe(1)
    expect(gridWeeks([session('2026-10-13')], '2026-10-28')).toBe(3)
    expect(gridWeeks([session('2026-01-05')], '2026-10-28')).toBe(12)
  })

  it('the week header', () => {
    const list = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-20'].map((d) => session(d))
    expect(weekHeader(list, '2026-10-29', 4)).toBe('4 sessions this week · target 4')
    expect(weekHeader([session('2026-10-26')], '2026-10-29', 4)).toBe('1 session this week · target 4')
  })
})
