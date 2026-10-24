import { describe, it, expect } from 'vitest'
import { newSession } from './sauna'
import type { SaunaSession } from './sauna'
import {
  ANALYTICS, typicalLine, ownSeries, hrClimb, hrSummary, comparedWords, baselineBefore, thatNight, nextMorning,
  hoursToBed, fluidEstimate, tempBand, heatAdaptation, coolDownDrop, coolDownTrend,
  targetWeeks, patterns, longerTerm, weeklyAxisMax, sinceFirstSession, firstSessionDate,
  todayLine, hrFallback, NO_HR_LINE, ratingRows, waterToWrite,
} from './analytics'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SaunaHealth, NightRow, MorningRow, WeighIn, PatternInput, HRSeries } from './analytics'
import { saunaVsNone, saunaSplits, recoveryLine } from './saunaEffects'
import { addDays, dateRange } from '../health/tz'

const T = '2026-10-23' // a Friday
const toMs = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00Z`)
const s = (date: string, extra: Partial<SaunaSession> & Record<string, unknown> = {}) =>
  newSession({ date, start: '18:00', lengthMin: 20, tempC: 70, ...extra } as SaunaSession, `${date}-${extra.start || '18:00'}`) as SaunaSession

/** Health where every night and morning has the same values, with overrides by date. */
function health(opts: {
  nights?: Record<string, Partial<NightRow>>
  mornings?: Record<string, Partial<MorningRow>>
  base?: { night?: Partial<NightRow>; morning?: Partial<MorningRow> }
  from?: string
  to?: string
  weighIns?: WeighIn[]
} = {}): SaunaHealth {
  const from = opts.from ?? '2026-01-01'
  const to = opts.to ?? addDays(T, -1)
  return {
    today: T,
    night: (wake) => {
      if (wake < from || wake > T) return null
      if (wake === T && !opts.nights?.[wake]) return null
      return { start: toMs(addDays(wake, -1), '23:00'), score: 80, deepMin: 60, sleepingHR: 55, ...opts.base?.night, ...opts.nights?.[wake] }
    },
    morning: (d) => (d < from || d > to ? { hrv: null, rhr: null, readiness: null }
      : { hrv: 50, rhr: 55, readiness: 70, ...opts.base?.morning, ...opts.mornings?.[d] }),
    weighIns: (a, b) => (opts.weighIns || []).filter((w) => w.t >= a && w.t <= b),
  }
}

describe('typical line', () => {
  it('is the median of the last 10 sessions', () => {
    expect(typicalLine([])).toBeNull()
    expect(typicalLine([s('2026-10-01', { lengthMin: 30 }), s('2026-10-02', { lengthMin: 30 }), s('2026-10-03', { lengthMin: 15, tempC: 60 })])).toBe('Typical: 30 min at 70 C')
  })
})

describe('heart rate in the sauna', () => {
  const ramp = (bpm0: number, perMin: number, mins: number): HRSeries => Array.from({ length: mins * 12 + 1 }, (_, i) => [i * 5, bpm0 + perMin * (i * 5) / 60])

  it('climb is bpm per minute over the first 10 minutes', () => {
    // 3 bpm a minute for 10 minutes, then flat: the flat part is not counted
    const series: HRSeries = [...ramp(80, 3, 10), ...Array.from({ length: 60 }, (_, i) => [605 + i * 5, 110] as [number, number])]
    expect(hrClimb(series)).toBe(3)
    expect(hrClimb(ramp(90, 1.5, 4))).toBe(1.5)
  })

  it('needs three readings over at least three minutes', () => {
    expect(hrClimb(null)).toBeNull()
    expect(hrClimb([[0, 80], [60, 90]])).toBeNull()
    expect(hrClimb([[0, 80], [30, 85], [60, 90]])).toBeNull()
    expect(hrClimb([[0, 80], [100, 85], [200, 90]])).toBe(3)
  })

  it('summary carries average, peak, five zones and the climb', () => {
    const sum = hrSummary(ramp(100, 3, 20), 180)!
    expect(sum.avg).toBe(130)
    expect(sum.peak).toBe(160)
    expect(sum.zones).toHaveLength(5)
    expect(sum.climb).toBe(3)
    expect(hrSummary(null, 180)).toBeNull()
  })

  it('the Watch samples become seconds from the start', () => {
    const start = toMs('2026-10-20', '18:00') / 1000
    const sess = s('2026-10-20', { hr: { avg: 100, peak: 120, samples: [[start, 90], [start + 300, 100], [start + 600, 110], [start + 99999, 1]] } })
    expect(ownSeries(sess, toMs)).toEqual([[0, 90], [300, 100], [600, 110]])
    expect(ownSeries(s('2026-10-20'), toMs)).toBeNull()
  })
})

describe('one session against your own baselines', () => {
  it('words read like "52 min, 8 more than usual"', () => {
    expect(comparedWords(52, 44, 'min', ['more', 'less'])).toBe('52 min, 8 more than usual')
    expect(comparedWords(40, 44.4, 'min', ['more', 'less'])).toBe('40 min, 4 less than usual')
    expect(comparedWords(61, 60.6, 'ms', ['higher', 'lower'])).toBe('61 ms, about usual')
    expect(comparedWords(58, null, 'bpm', ['higher', 'lower'])).toBe('58 bpm')
    expect(comparedWords(null, 50, 'bpm', ['higher', 'lower'])).toBe('No reading')
  })

  it('the baseline is the 28 days before, not the day itself', () => {
    const vals: Record<string, number> = {}
    for (let i = 1; i <= 40; i++) vals[addDays('2026-10-20', -i)] = i <= 28 ? 10 : 1000
    vals['2026-10-20'] = 5000
    expect(baselineBefore('2026-10-20', (d) => vals[d] ?? null)).toEqual({ mean: 10, n: 28 })
    expect(baselineBefore('2026-10-20', () => null)).toEqual({ mean: null, n: 0 })
  })

  it('that night against the 28 nights before it', () => {
    const h = health({ nights: { '2026-10-21': { deepMin: 68, score: 80, sleepingHR: 57 } } })
    const r = thatNight(s('2026-10-20'), h)
    expect(r.status).toBe('ok')
    const by = Object.fromEntries(r.rows.map((x) => [x.key, x]))
    expect(by.deepSleep).toMatchObject({ value: 68, base: 60, baseN: 28, diff: 8, text: '68 min, 8 more than usual' })
    expect(by.sleepScore.text).toBe('80, about usual')
    expect(by.sleepingHR.text).toBe('57 bpm, 2 higher than usual')
  })

  it('tonight is "available tomorrow" until it arrives', () => {
    expect(thatNight(s(T), health()).status).toBe('pending')
    expect(thatNight(s(addDays(T, -1)), health()).status).toBe('pending') // last night, not synced yet
    expect(thatNight(s('2025-06-01'), health()).status).toBe('none') // long ago, never recorded
  })

  it('the next morning against the 28 days before it', () => {
    const h = health({ mornings: { '2026-10-21': { hrv: 44, rhr: 57, readiness: 70 } } })
    const r = nextMorning(s('2026-10-20'), h)
    const by = Object.fromEntries(r.rows.map((x) => [x.key, x]))
    expect(by.hrv.text).toBe('44 ms, 6 lower than usual')
    expect(by.rhr.text).toBe('57 bpm, 2 higher than usual')
    expect(by.readiness.text).toBe('70, about usual')
    expect(nextMorning(s(T), h).status).toBe('pending')
  })

  it('hours between the end and bedtime', () => {
    const night: NightRow = { start: toMs('2026-10-20', '23:00'), score: 80, deepMin: 60, sleepingHR: 55 }
    expect(hoursToBed(s('2026-10-20', { start: '19:00', lengthMin: 30 }), night, toMs)).toBe(3.5)
    expect(hoursToBed(s('2026-10-20'), null, toMs)).toBeNull()
  })

  it('fluid loss: typed weights first, else weigh-ins within 2 h before the start and 2 h after the end', () => {
    expect(fluidEstimate(s('2026-10-20', { weightBeforeKg: 80, weightAfterKg: 79.4 }), null, toMs)).toMatchObject({ litres: 0.6, from: 'manual' })
    const at = (hhmm: string, kg: number, date = '2026-10-20'): WeighIn => ({ t: toMs(date, hhmm), kg, source: 'Withings' })
    const sess = s('2026-10-20', { start: '18:00', lengthMin: 20 }) // ends 18:20
    const weighIns = [at('15:30', 81), at('16:30', 80.5), at('17:50', 80.2), at('18:30', 79.7), at('19:00', 79.5), at('21:00', 78)]
    const h = health({ weighIns })
    // the last one before the start (17:50) and the first after the end (18:30); 15:30 and 21:00 are outside the windows
    expect(fluidEstimate(sess, h.weighIns, toMs)).toEqual({ litres: 0.5, from: 'scale', beforeKg: 80.2, afterKg: 79.7 })
    // only outside the windows: no estimate
    expect(fluidEstimate(sess, health({ weighIns: [at('15:30', 81), at('21:00', 78)] }).weighIns, toMs)).toBeNull()
    // only before, nothing after
    expect(fluidEstimate(sess, health({ weighIns: [at('17:00', 81)] }).weighIns, toMs)).toBeNull()
    // works from the very first session, no minimum
    expect(fluidEstimate(sess, health({ weighIns: [at('16:10', 80), at('20:20', 79.8)] }).weighIns, toMs)?.litres).toBe(0.2)
  })

})

describe('heat adaptation', () => {
  it('bands are 10 C wide', () => {
    expect(tempBand(70)).toMatchObject({ centre: 70, label: '65 to 75 C' })
    expect(tempBand(74)).toMatchObject({ centre: 70 })
    expect(tempBand(76)).toMatchObject({ centre: 80, label: '75 to 85 C' })
    expect(tempBand(64).centre).toBe(60)
  })

  it('locked until 5 Watch sessions in one band', () => {
    const one = heatAdaptation([{ id: 'a', date: '2026-10-01', tempC: 70, avgHR: 120 }])
    expect(one).toMatchObject({ locked: true, have: 1, text: 'Unlocks after 5 Watch sessions at a similar temperature (you have 1)' })
    const spread = heatAdaptation([60, 70, 80, 90, 100].map((t, i) => ({ id: `${i}`, date: `2026-10-0${i + 1}`, tempC: t, avgHR: 120 })))
    expect(spread.locked).toBe(true)
  })

  it('uses the band used most, and gives the trend over its sessions', () => {
    const list = [124, 123, 122, 121, 120, 119, 118, 118].map((hr, i) => ({ id: `${i}`, date: addDays('2026-09-01', i * 3), tempC: 68 + (i % 3), avgHR: hr }))
    list.push({ id: 'hot', date: '2026-09-05', tempC: 90, avgHR: 150 }) // another band: left out
    const r = heatAdaptation(list)
    expect(r.locked).toBe(false)
    if (r.locked) return
    expect(r.band.label).toBe('65 to 75 C')
    expect(r.points).toHaveLength(8)
    expect(r.change).toBe(-6)
    expect(r.text).toBe('At 65 to 75 C your average heart rate is down 6 bpm over 8 sessions.')
    expect(r.trend!.first).toBeGreaterThan(r.trend!.last)
  })
})

describe('cool-down recovery', () => {
  const exitAt = Date.parse('2026-10-20T18:20:00Z')
  const samples = Array.from({ length: 61 }, (_, i) => [exitAt / 1000 + i * 5, 130 - Math.min(i * 5, 300) / 10])

  it('drop at 2 and 5 minutes after leaving', () => {
    expect(coolDownDrop({ exitAt, samples })).toEqual({ exitHR: 130, drop2: 12, drop5: 30 })
  })

  it('no drop without readings near the marks', () => {
    expect(coolDownDrop(null)).toBeNull()
    expect(coolDownDrop({ exitAt, samples: [] })).toBeNull()
    const short = samples.slice(0, 20) // under 2 minutes recorded
    expect(coolDownDrop({ exitAt, samples: short })).toMatchObject({ drop2: null, drop5: null })
  })

  it('trend after 5 sessions with a cool-down', () => {
    const four = [10, 12, 14, 16].map((d, i) => ({ date: `2026-10-0${i + 1}`, drop2: d }))
    expect(coolDownTrend(four)).toMatchObject({ locked: true, have: 4, text: 'The trend appears after 5 sessions with a cool-down (you have 4)' })
    const five = coolDownTrend([...four, { date: '2026-10-05', drop2: 18 }, { date: '2026-10-06', drop2: null }])
    expect(five).toMatchObject({ locked: false, change: 8, text: 'Your 2 minute drop is up 8 bpm over 5 sessions.' })
  })
})

describe('consistency', () => {
  it('counts weeks from the first session only, and this week once it is hit', () => {
    // first session two weeks ago: only 3 weeks exist, not 8
    const list = [s('2026-10-06'), s('2026-10-07'), s('2026-10-08'), s('2026-10-13'), s('2026-10-20')]
    expect(targetWeeks(list, T, 3)).toMatchObject({ hit: 1, of: 2, text: 'Target hit in 1 of the last 2 weeks' })
    expect(targetWeeks([...list, s('2026-10-21'), s('2026-10-22')], T, 3)).toMatchObject({ hit: 2, of: 3 })
    expect(targetWeeks([], T, 3).text).toBeNull()
  })

  it('axis maxima come from the data with a minimum of 3', () => {
    expect(weeklyAxisMax([0, 1, 0])).toBe(3)
    expect(weeklyAxisMax([0, 1, 0], 4)).toBe(4)
    expect(weeklyAxisMax([2, 6, 1], 4)).toBe(6)
    expect(weeklyAxisMax([])).toBe(3)
  })
})

describe('patterns', () => {
  const days = dateRange('2026-01-01', addDays(T, -1))
  const input = (sessions: SaunaSession[], h = health()): PatternInput => ({
    sessions, days, night: h.night, morning: h.morning, toMs, wobble: {},
  })

  it('one progress line while locked, no rows', () => {
    const r = patterns(input([s('2026-10-20')]))
    expect(r).toMatchObject({ nights: [], timing: [], saunaDays: 1, progress: 'Patterns unlock after 7 sauna days (you have 1)' })
  })

  it('a row unlocks at 7 days in each group, with n per group and a plain sentence', () => {
    // a session every other day from 1 Sep: 7+ sauna days and 7+ without
    const sauna = dateRange('2026-09-01', '2026-09-28').filter((_, i) => i % 2 === 0)
    const nights: Record<string, Partial<NightRow>> = {}
    for (const d of sauna) nights[addDays(d, 1)] = { deepMin: 80 }
    const r = patterns(input(sauna.map((d) => s(d, { start: '12:00' })), health({ nights })))
    expect(r.progress).toBeNull()
    const deep = r.nights.find((x) => x.key === 'deepSleep')!
    expect(deep.text).toBe('Deep sleep was 20 min higher on sauna nights than on nights without.')
    expect(deep.nWith).toBe(14)
    expect(deep.nWithout).toBeGreaterThanOrEqual(7)
    expect(r.nights.find((x) => x.key === 'sleepScore')!.text).toBe('Sleep score was about the same on sauna nights as on nights without.')
    // all sessions end at 12:20, never within 3 h of bed: no late group, so no timing rows
    expect(r.timing).toEqual([])
  })

  it('late against earlier sessions', () => {
    const sauna = dateRange('2026-09-01', '2026-09-28')
    const sessions = sauna.map((d, i) => s(d, { start: i % 2 ? '21:00' : '12:00' }))
    const nights: Record<string, Partial<NightRow>> = {}
    sauna.forEach((d, i) => { nights[addDays(d, 1)] = { score: i % 2 ? 70 : 82 } })
    const r = patterns(input(sessions, health({ nights })))
    expect(r.timing.find((x) => x.key === 'sleepScore')!.text).toBe('Sleep score was 12 lower after late sessions than after earlier ones.')
  })
})

describe('longer term', () => {
  it('locked under 8 weeks from the first session, and never counts weeks before it', () => {
    const r = longerTerm({ sessions: [s('2026-10-20')], morning: health().morning }, T)
    expect(r).toMatchObject({ locked: true, weeks: 1, text: 'Unlocks after 8 weeks of sauna (you have 1)' })
  })

  it('weeks start at the first session and a sentence needs 4 weeks with and 4 without', () => {
    const first = '2026-08-03' // a Monday, 12 weeks before T's week
    const sessions = [0, 1, 2, 3].map((w) => s(addDays(first, w * 7 + 2)))
    const mornings: Record<string, Partial<MorningRow>> = {}
    for (const d of dateRange(first, addDays(first, 27))) mornings[d] = { rhr: 52 }
    const r = longerTerm({ sessions, morning: health({ mornings }).morning }, T, 3)
    expect(r.locked).toBe(false)
    if (r.locked) return
    expect(r.weeks[0].week).toBe(first)
    expect(r.weeks).toHaveLength(12)
    expect(r.axisMax).toBe(3)
    expect(r.lines).toContain('Resting heart rate averaged 52 bpm in weeks with sauna and 55 bpm in weeks without (4 and 8 weeks).')
    // three weeks with sessions: no sentence
    const r3 = longerTerm({ sessions: sessions.slice(0, 3).concat(s(addDays(first, 3))), morning: health({ mornings }).morning }, T, 3)
    if (!r3.locked) expect(r3.lines).toEqual([])
  })
})

describe('nothing from before the first session is used', () => {
  // a year of Health data, with very different values before the first session
  const first = '2026-09-01'
  // a night is before when it ends on or before the first session day; a morning when it is before that day
  const h = health({ base: {} })
  const odd: SaunaHealth = {
    ...h,
    night: (wake) => { const n = h.night(wake); return n && wake <= first ? { ...n, score: 10, deepMin: 5, sleepingHR: 90 } : n },
    morning: (d) => (d < first ? { hrv: 5, rhr: 90, readiness: 5 } : h.morning(d)),
  }
  const sauna = dateRange(first, '2026-10-20').filter((_, i) => i % 3 === 0)
  const sessions = sauna.map((d) => s(d, { start: '12:00' }))
  const days = dateRange('2025-10-01', addDays(T, -1))
  const input = { sessions, days, night: odd.night, morning: odd.morning, toMs, wobble: {} }

  it('helpers trim to the first session', () => {
    expect(firstSessionDate(sessions)).toBe(first)
    expect(sinceFirstSession(days, sessions)[0]).toBe(first)
    expect(sinceFirstSession(days, [])).toEqual([])
  })

  it('patterns, effects and the Recovery line read only days since the first session', () => {
    const p = patterns(input)
    for (const r of [...p.nights, ...p.timing]) expect(Math.abs(r.diff)).toBeLessThan(1)
    for (const r of saunaVsNone(input)) {
      if (r.diff != null) expect(Math.abs(r.diff)).toBeLessThan(1)
      expect(r.split.with.n + r.split.without.n).toBeLessThanOrEqual(sinceFirstSession(days, sessions).length)
    }
    const splits = saunaSplits(input)
    for (const r of splits.length.flatMap((b) => b.rows)) expect(r.split.without.n).toBeLessThanOrEqual(sinceFirstSession(days, sessions).length)
    expect(recoveryLine(input) ?? '').not.toMatch(/higher|lower/)
  })

  it('longer term and consistency start at the week of the first session', () => {
    const lt = longerTerm({ sessions, morning: odd.morning }, T)
    if (!lt.locked) {
      expect(lt.weeks[0].week >= '2026-08-31').toBe(true)
      for (const w of lt.weeks) if (w.rhr != null) expect(w.rhr).toBeLessThan(60)
    }
    expect(targetWeeks(sessions, T, 1).of).toBeLessThanOrEqual(8)
    expect(targetWeeks([s('2026-10-20')], T, 1).of).toBe(1)
  })

  it('every unlock threshold matches the brief', () => {
    expect(ANALYTICS).toMatchObject({ adaptationMin: 5, coolDownMin: 5, patternsMin: 7, longerTermWeeks: 8, longerTermGroupWeeks: 4, baselineDays: 28, weighInWindowH: 2 })
  })
})

describe('M7: the Sauna tab around health data', () => {
  it("today's readiness and HRV against the 28 days before, information only", () => {
    const h = health({ to: T, mornings: { [T]: { hrv: 56, readiness: 74 } } })
    expect(todayLine(h)).toBe('Today: readiness 74, HRV 56 ms, 6 above usual')
    expect(todayLine(health({ to: addDays(T, -1) }))).toBeNull()
    expect(todayLine(null)).toBeNull()
  })

  it('heart rate fallback: 10 min before, the first 10 min after and at 30 min', () => {
    const start = Date.parse('2026-10-22T18:00:00Z')
    const end = start + 20 * 60000
    const m = (min: number, bpm: number): [number, number] => [start + min * 60000, bpm]
    const samples = [m(-30, 60), m(-8, 70), m(-5, 72), m(-1, 80), m(22, 110), m(25, 100), m(29, 96), m(48, 75), m(51, 72)]
    expect(hrFallback(samples, start, end)).toEqual({ before: 72, after: 100, at30: 72, label: NO_HR_LINE })
    expect(NO_HR_LINE).toBe('No heart rate recorded during session')
    // the reading nearest 30 min after must be within 5 minutes of it
    expect(hrFallback([m(-5, 70), m(60, 70)], start, end)).toEqual({ before: 70, after: null, at30: null, label: NO_HR_LINE })
    expect(hrFallback([m(-60, 70)], start, end)).toBeNull()
  })

  it('that night adds wrist temperature and restlessness only when recorded', () => {
    const sess = s('2026-10-21')
    const h = health({ base: { night: { wristTemp: 35.8, restless: 4 } }, nights: { '2026-10-22': { wristTemp: 36.1, restless: 6.5 } } })
    const rows = thatNight(sess, h).rows
    expect(rows.find((r) => r.key === 'wristTemp')?.text).toBe('36.1 C, 0.3 higher than usual')
    expect(rows.find((r) => r.key === 'restlessness')?.text).toBe('6.5 per hour, 2.5 higher than usual')
    expect(thatNight(sess, health()).rows.map((r) => r.key)).toEqual(['sleepScore', 'deepSleep', 'sleepingHR'])
    // the night of today's session: available tomorrow
    expect(thatNight(s(T), health()).status).toBe('pending')
  })

  it('rating rows unlock at 5 rated sessions and band by length, temperature and fluid', () => {
    const rate = (feel: number, lightheaded = false) => ({ feel, lightheaded, headache: false, cramps: false })
    const list = [
      s('2026-10-01', { lengthMin: 20, tempC: 70, rating: rate(4) }),
      s('2026-10-03', { lengthMin: 20, tempC: 72, rating: rate(3, true) }),
      s('2026-10-05', { lengthMin: 30, tempC: 80, rating: rate(2, true) }),
      s('2026-10-07', { lengthMin: 12, tempC: 68, rating: rate(5) }),
    ]
    const four = ratingRows(list, () => null)
    expect(four.rows).toEqual([])
    expect(four.progress).toBe('Rating rows unlock after 5 rated sessions (you have 4)')
    expect(ratingRows([...list, s('2026-10-09')], () => null).rated).toBe(4) // an unrated session does not count
    const five = ratingRows([...list, s('2026-10-09', { lengthMin: 22, tempC: 70, rating: rate(4) })], (x) => (x.lengthMin >= 20 ? 0.6 : 0.3))
    expect(five.progress).toBeNull()
    expect(five.rows.find((r) => r.group === 'length' && r.band === '15 to 24 min')?.text).toBe('15 to 24 min: felt 3.7 of 5 on average, lightheaded 1 of 3 times.')
    expect(five.rows.find((r) => r.group === 'temp' && r.band === '65 to 75 C')?.n).toBe(4)
    expect(five.rows.find((r) => r.group === 'fluid' && r.band === '0.5 to 0.9 L lost')?.lightheaded).toBe(2)
  })

  it('water is written to Apple Health once per session', () => {
    const list = [s('2026-10-01', { waterMl: 500 }), s('2026-10-02', { waterMl: 400, waterWritten: true }), s('2026-10-03', { waterMl: 0 }), s('2026-10-04')]
    expect(waterToWrite(list).map((w) => [w.date, w.ml])).toEqual([['2026-10-01', 500]])
  })

  it('patterns add restlessness; the longer term adds blood pressure weeks', () => {
    const sessions = Array.from({ length: 70 }, (_, i) => addDays('2026-08-01', i)).filter((_, i) => i % 3 === 0).map((d) => s(d))
    const byDay = new Set(sessions.map((x) => x.date))
    const input: PatternInput = {
      sessions, days: dateRange('2026-07-01', addDays(T, -1)), toMs, wobble: {},
      night: (wake) => ({ start: toMs(addDays(wake, -1), '23:00'), score: 80, deepMin: 60, sleepingHR: 55, restless: byDay.has(addDays(wake, -1)) ? 3 : 5 }),
      morning: (d) => ({ hrv: 50, rhr: 55, readiness: 70, bpSys: d.endsWith('5') ? 128 : null, bpDia: d.endsWith('5') ? 82 : null }),
    }
    const p = patterns(input)
    expect(p.nights.find((r) => r.key === 'restlessness')?.text).toBe('Restlessness was 2 per hour lower on sauna nights than on nights without.')
    const lt = longerTerm(input, T)
    expect(lt.locked).toBe(false)
    if (!lt.locked) {
      expect(lt.hasBP).toBe(true)
      expect(lt.weeks.some((w) => w.sys === 128 && w.dia === 82)).toBe(true)
    }
  })

  it('no heat or temperature warning strings remain in the app or the Watch app', () => {
    const roots = ['src', 'ios/PepitoKit/Sources', 'ios/PepitoWatch', 'ios/App/App/Native', 'ios/Shared']
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(jsx?|tsx?|swift)$/.test(f) && !f.endsWith('.test.ts')) files.push(p)
      }
    }
    roots.forEach(walk)
    const banned = /advises not wearing|above 55|rated to 35|heatWarning|WATCH_HOT|too hot for/i
    const hits = files.filter((f) => banned.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})
