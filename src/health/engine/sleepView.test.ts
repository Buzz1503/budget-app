import { describe, it, expect } from 'vitest'
import { makeTz, addDays, dateRange } from '../tz'
import { buildSegments, sleepingHeartRate, buildNights } from '../dayLogic'
import type { RawSleep, SleepNight } from '../types'
import {
  hypnogramRows, midpointFromNoon, weekdayWeekend, isWeekendNight, isLateWorkout, lateWorkoutDay,
  sleepFactors, higherLoadDay, vitalVsUsual, stageStats, scoreBand, windDownAt, clockOf, durationWords, debtNights,
} from './sleepView'

const tz = makeTz('Europe/London')
const at = (date: string, h: number, m = 0) => tz.startOfDay(date) + (h * 60 + m) * 60000
const W = { sourceName: 'Apple Watch', sourceId: 'com.apple.health.W' }
const s = (start: number, mins: number, stage: RawSleep['stage']): RawSleep => ({ start, end: start + mins * 60000, stage, ...W })

/** A night waking on `date`, in bed from `bedH` (hours, may be past 24 for after midnight). */
function night(date: string, bedH = 22.5, asleepMin = 450): SleepNight {
  const start = at(addDays(date, -1), bedH)
  const end = start + (asleepMin + 20) * 60000
  return {
    date, source: 'watch', sourceName: 'Apple Watch', start, end,
    inBedMin: asleepMin + 20, asleepMin, awakeMin: 20, deepMin: 60, coreMin: asleepMin - 160, remMin: 100,
    unspecifiedMin: 0, hasStages: true, naps: [],
  }
}

describe('hypnogram segments', () => {
  it('drops in-bed, trims overlaps, merges touching stretches of one stage, oldest first', () => {
    const t0 = at('2026-10-18', 23)
    const segs = buildSegments([
      s(t0 - 10 * 60000, 500, 'inBed'),
      s(t0 + 30 * 60000, 40, 'deep'),
      s(t0, 30, 'core'),
      s(t0 + 70 * 60000, 20, 'deep'),   // touches the deep before it: one stretch
      s(t0 + 80 * 60000, 30, 'rem'),    // overlaps the deep by 10 min: starts where it ends
      s(t0 + 95 * 60000, 5, 'awake'),   // wholly inside the REM: dropped
    ])
    expect(segs.map((x) => [x.stage, (x.start - t0) / 60000, (x.end - t0) / 60000])).toEqual([
      ['core', 0, 30], ['deep', 30, 90], ['rem', 90, 110],
    ])
  })

  it('nights carry their segments, and rows run Awake, REM, Core, Deep top to bottom', () => {
    const t0 = at('2026-10-18', 23)
    const n = buildNights([s(t0, 60, 'core'), s(t0 + 60 * 60000, 30, 'deep'), s(t0 + 90 * 60000, 400, 'rem')], { tz })['2026-10-19']
    expect(n.segments).toHaveLength(3)
    const h = hypnogramRows(n)
    expect(h.rows).toEqual(['awake', 'rem', 'core', 'deep'])
    expect(h.steps.map((x) => x.row)).toEqual(['core', 'deep', 'rem'])
    // no stages: two rows, Awake and Asleep
    expect(hypnogramRows({ hasStages: false, segments: [{ start: 0, end: 1, stage: 'asleep' }] }).rows).toEqual(['awake', 'asleep'])
    // a night cached before segments existed has no steps, not an error
    expect(hypnogramRows({ hasStages: true }).steps).toEqual([])
  })
})

describe('sleeping heart rate', () => {
  it('lowest and average of samples inside the main sleep, sensor gaps ignored', () => {
    const a = at('2026-10-18', 23)
    const b = a + 7 * 3600000
    const hr = [
      { value: 70, start: a - 60000, end: a - 60000 },          // before bed: out
      { value: 58, start: a + 600000, end: a + 600000 },
      { value: 49, start: a + 3 * 3600000, end: a + 3 * 3600000 },
      { value: 0, start: a + 4 * 3600000, end: a + 4 * 3600000 }, // a gap, not a heartbeat
      { value: 55, start: b, end: b },
      { value: 90, start: b + 60000, end: b + 60000 },          // after waking: out
    ]
    expect(sleepingHeartRate(hr, a, b)).toEqual({ min: 49, avg: 54, n: 3 })
    expect(sleepingHeartRate([], a, b)).toBeNull()
  })
})

describe('timing', () => {
  it('midpoint in minutes after noon, across midnight', () => {
    // 22:30 to 06:20 asleep 450 + 20 awake = 470 min: midpoint 02:25
    expect(clockOf(midpointFromNoon(night('2026-10-19'), tz))).toBe('02:25')
  })

  it('weekend nights are Friday and Saturday, and the gap is said plainly', () => {
    expect(isWeekendNight('2026-10-17')).toBe(true)  // Saturday morning: Friday night
    expect(isWeekendNight('2026-10-18')).toBe(true)  // Sunday morning
    expect(isWeekendNight('2026-10-19')).toBe(false) // Monday morning: Sunday night
    const nights = dateRange('2026-10-05', '2026-10-18').map((d) => night(d, isWeekendNight(d) ? 23 + 70 / 60 - 0.5 + 0.5 : 23))
    // weekday bed 23:00, weekend 00:10: both 470 min long, so midpoints are 70 min apart
    const r = weekdayWeekend(nights, tz)
    expect(r.diffMin).toBe(70)
    expect(r.text).toBe('Weekend sleep runs 1 h 10 m later.')
    const same = weekdayWeekend(dateRange('2026-10-05', '2026-10-18').map((d) => night(d, 23)), tz)
    expect(same.text).toBe('Weekend and weekday sleep run at about the same time.')
    expect(weekdayWeekend([night('2026-10-17')], tz).text).toBeNull()
  })

  it('wind down is 30 minutes before the suggested bedtime, across midnight too', () => {
    expect(windDownAt('21:40')).toBe('21:10')
    expect(windDownAt('00:10')).toBe('23:40')
    expect(durationWords(70)).toBe('1 h 10 m')
  })

  it('debt bars: a missing night is missing, not short', () => {
    const by = new Map([['2026-10-19', night('2026-10-19', 22.5, 420)]])
    const d = debtNights(by, '2026-10-19', 8)
    expect(d).toHaveLength(7)
    expect(d[6]).toEqual({ date: '2026-10-19', asleepH: 7, shortH: 1 })
    expect(d[0]).toEqual({ date: '2026-10-13', asleepH: null, shortH: 0 })
  })
})

describe('late workouts', () => {
  it('a workout ending within 3 hours before bedtime is late; earlier is not', () => {
    const bed = at('2026-10-18', 22.5)
    expect(isLateWorkout({ start: bed - 4 * 3600000, end: bed - 3 * 3600000 }, bed)).toBe(true)
    expect(isLateWorkout({ start: bed - 4 * 3600000, end: bed - 3 * 3600000 - 60000 }, bed)).toBe(false)
    expect(isLateWorkout({ start: bed - 3600000, end: bed + 600000 }, bed)).toBe(true)
    expect(isLateWorkout({ start: bed + 3600000, end: bed + 7200000 }, bed)).toBe(false)
  })

  it('flags the day before the night, and leaves out days with no night after them', () => {
    const by = new Map([['2026-10-19', night('2026-10-19', 22.5)]])
    const late = lateWorkoutDay([{ date: '2026-10-18', start: at('2026-10-18', 19), end: at('2026-10-18', 20) }], by)
    expect(late('2026-10-18')).toBe(true)
    const early = lateWorkoutDay([{ date: '2026-10-18', start: at('2026-10-18', 12), end: at('2026-10-18', 13) }], by)
    expect(early('2026-10-18')).toBe(false)
    expect(late('2026-10-17')).toBeNull()
  })
})

describe('higher-load days', () => {
  it('over 1.3 x the average training day of the 28 before; rest days are no; too little history is left out', () => {
    const load = new Map(['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07'].map((d) => [d, 100]))
    expect(higherLoadDay(load, '2026-10-06')).toBeNull() // only 3 training days before it
    load.set('2026-10-09', 131)
    expect(higherLoadDay(load, '2026-10-09')).toBe(true)
    load.set('2026-10-09', 130)
    expect(higherLoadDay(load, '2026-10-09')).toBe(false)
    expect(higherLoadDay(load, '2026-10-10')).toBe(false)
  })
})

describe('what affects your sleep', () => {
  const days = dateRange('2026-08-01', '2026-10-18')
  const score = (d: string) => (Number(d.slice(8)) % 3 === 0 ? 70 : 80) + (Number(d.slice(8)) % 2)
  const outcomes = [{ key: 'sleepScore', label: 'Sleep score', unit: '', dp: 0, fn: score, wobble: 3 }]

  it('ranks factors with 7 nights in each group by the size of the difference, and says how many more the rest need', () => {
    const rows = sleepFactors({
      days,
      outcomes,
      factors: [
        { key: 'none', label: 'Unrelated', phrase: 'days with X', inGroup: (d) => Number(d.slice(8)) % 2 === 0 },
        { key: 'third', label: 'Every third day', phrase: 'days with a late workout', inGroup: (d) => Number(d.slice(8)) % 3 === 0 },
        { key: 'rare', label: 'Rare', phrase: 'days with Y', inGroup: (d) => ['2026-10-01', '2026-10-02', '2026-10-03'].includes(d) },
      ],
    })
    expect(rows.map((r) => r.key)).toEqual(['third', 'none', 'rare'])
    expect(rows[0].results[0].text).toMatch(/^Sleep score: \d+ lower on days with a late workout$/)
    expect(rows[0].results[0].verdict).toBe('Clear difference')
    expect(rows[2]).toMatchObject({ enough: false, needsMore: 4, gate: 'Needs 4 more nights' })
    expect(rows.flatMap((r) => r.results.map((x) => x.text)).join(' ')).not.toMatch(/caused|improved|worked/)
  })

  it('exactly 7 nights in the smaller group is enough; 6 is not', () => {
    const seven = days.slice(0, 7)
    const six = days.slice(0, 6)
    const run = (yes: string[]) => sleepFactors({ days, outcomes, factors: [{ key: 'k', label: 'K', phrase: 'days with K', inGroup: (d) => yes.includes(d) }] })[0]
    expect(run(seven).enough).toBe(true)
    expect(run(six)).toMatchObject({ enough: false, gate: 'Needs 1 more night' })
  })
})

describe('vitals, stages and the score band', () => {
  it('reads a night against the median of the 28 before it, in plain words', () => {
    const vals = new Map(dateRange('2026-09-21', '2026-10-18').map((d) => [d, 56]))
    vals.set('2026-10-19', 52)
    const r = vitalVsUsual({ key: 'hrMin', label: 'Lowest heart rate', unit: 'bpm', dp: 0 }, vals, '2026-10-19')
    expect(r).toMatchObject({ value: 52, usual: 56, delta: -4, direction: 'down', words: '4 bpm lower than usual.' })
    vals.set('2026-10-19', 56.5)
    expect(vitalVsUsual({ key: 'hrMin', label: 'x', unit: 'bpm', dp: 0 }, vals, '2026-10-19').words).toBe('About the same as usual.')
    const few = new Map([['2026-10-18', 50], ['2026-10-19', 52]])
    expect(vitalVsUsual({ key: 'hrMin', label: 'x', unit: 'bpm', dp: 0 }, few, '2026-10-19').words).toBe('Needs 6 more nights for a usual.')
  })

  it('stage shares of time asleep, the 30-night average, and the typical adult range for deep and REM', () => {
    const n = night('2026-10-19', 22.5, 400)
    const st = stageStats(n, [n])
    expect(st.find((x) => x.key === 'deep')).toMatchObject({ min: 60, pct: 15, avgPct: 15, typical: [13, 23] })
    expect(st.find((x) => x.key === 'rem')).toMatchObject({ pct: 25, typical: [20, 25] })
    expect(st.find((x) => x.key === 'core')?.typical).toBeNull()
  })

  it('score bands', () => {
    expect([scoreBand(45), scoreBand(59), scoreBand(60), scoreBand(80), scoreBand(null)]).toEqual(['low', 'low', 'moderate', 'high', null])
  })
})
