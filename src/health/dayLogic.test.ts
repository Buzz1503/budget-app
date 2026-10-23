import { describe, it, expect } from 'vitest'
import { makeTz, addDays, daysBetween, dateRange } from './tz'
import {
  classifySource, unionMinutes, groupSessions, buildNights, buildDaily, meanInWindow,
  seriesFor, recoveryFor, buildWorkout, workoutLabel,
} from './dayLogic'
import type { RawSleep, RawQuantity } from './types'

// Sydney, so daylight saving is in play: clocks went forward at 02:00 on
// Sunday 4 October 2026 (AEST +10 -> AEDT +11).
const tz = makeTz('Australia/Sydney')
const at = (date: string, h: number, m = 0) => tz.startOfDay(date) + (h * 60 + m) * 60000
const W = { sourceName: "Buzz's Apple Watch", sourceId: 'com.apple.health.ABC' }
const P = { sourceName: "Buzz's iPhone", sourceId: 'com.apple.health.DEF' }
const WI = { sourceName: 'Withings', sourceId: 'com.withings.wiScaleNG' }
const seg = (start: number, mins: number, stage: RawSleep['stage'], src = W): RawSleep => ({ start, end: start + mins * 60000, stage, ...src })

/** A plain night: in bed from `bedH` the evening before `date`, staged sleep, waking at about 06:30. */
function night(date: string, src = W, bedH = 22.5): RawSleep[] {
  const prev = addDays(date, -1)
  const s0 = at(prev, Math.floor(bedH), (bedH % 1) * 60)
  return [
    seg(s0, 10, 'awake', src),
    seg(s0 + 10 * 60000, 120, 'core', src),
    seg(s0 + 130 * 60000, 60, 'deep', src),
    seg(s0 + 190 * 60000, 150, 'core', src),
    seg(s0 + 340 * 60000, 90, 'rem', src),
    seg(s0 + 430 * 60000, 10, 'awake', src),
  ]
}

describe('time zone helpers', () => {
  it('dates and hours are local, across a daylight-saving change', () => {
    expect(tz.dateOf(at('2026-10-04', 1))).toBe('2026-10-04')
    // 02:00 does not exist that morning; 03:30 local is 2.5 hours after midnight
    expect((at('2026-10-04', 3, 30) - tz.startOfDay('2026-10-04')) / 3600000).toBeCloseTo(3.5, 5)
    expect(tz.hourOf(tz.startOfDay('2026-10-04') + 3.5 * 3600000)).toBeCloseTo(4.5, 5)
    // the day itself is 23 hours long
    expect((tz.startOfDay('2026-10-05') - tz.startOfDay('2026-10-04')) / 3600000).toBe(23)
  })

  it('date arithmetic', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30)
    expect(dateRange('2026-10-01', '2026-10-03')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
  })
})

describe('sources', () => {
  it('tells a watch, a phone and Withings apart', () => {
    expect(classifySource(W.sourceName, W.sourceId)).toBe('watch')
    expect(classifySource(P.sourceName, P.sourceId)).toBe('phone')
    expect(classifySource('Health Mate', 'com.withings.wiScaleNG')).toBe('withings')
    expect(classifySource('AutoSleep', 'com.tantsissa.AutoSleep')).toBe('other')
  })
})

describe('sleep sessions', () => {
  it('overlapping intervals are counted once', () => {
    expect(unionMinutes([[0, 60000 * 30], [60000 * 20, 60000 * 40]])).toBe(40)
    expect(unionMinutes([])).toBe(0)
  })

  it('a gap under an hour stays one session; an hour or more splits it', () => {
    const base = at('2026-09-10', 1)
    const short = [seg(base, 60, 'core'), seg(base + 119 * 60000, 30, 'core')] // 59 min gap
    expect(groupSessions(short, 'watch')).toHaveLength(1)
    const long = [seg(base, 60, 'core'), seg(base + 120 * 60000, 30, 'core')] // 60 min gap
    expect(groupSessions(long, 'watch')).toHaveLength(2)
  })

  it('stage minutes, in-bed time and the stages flag', () => {
    const [s] = groupSessions(night('2026-09-10'), 'watch')
    expect(s.asleepMin).toBe(420)
    expect(s.deepMin).toBe(60)
    expect(s.remMin).toBe(90)
    expect(s.coreMin).toBe(270)
    expect(s.awakeMin).toBe(20)
    expect(s.inBedMin).toBe(440)
    expect(s.hasStages).toBe(true)
  })
})

describe('nights', () => {
  it('a night spanning midnight belongs to the date you woke up', () => {
    const nights = buildNights(night('2026-09-10'), { tz })
    expect(Object.keys(nights)).toEqual(['2026-09-10'])
    expect(nights['2026-09-10'].asleepMin).toBe(420)
  })

  it('the main sleep is the longest session ending between 03:00 and 14:00; the rest are naps', () => {
    const nap = [seg(at('2026-09-10', 13, 0), 40, 'core')] // ends 13:40, short
    const evening = [seg(at('2026-09-10', 15, 0), 30, 'core')] // ends 15:30, outside the window
    const nights = buildNights([...night('2026-09-10'), ...nap, ...evening], { tz })
    const n = nights['2026-09-10']
    expect(n.asleepMin).toBe(420)
    expect(n.naps).toHaveLength(2)
    expect(n.naps.map((x) => Math.round(x.asleepMin))).toEqual([40, 30])
  })

  it('a day with only a nap has no main sleep', () => {
    const nights = buildNights([seg(at('2026-09-12', 15), 45, 'core')], { tz })
    expect(nights['2026-09-12']).toBeUndefined()
  })

  it('one source per night, by priority, never merged', () => {
    const both = [...night('2026-09-10', W), ...night('2026-09-10', WI, 22)]
    const watchFirst = buildNights(both, { tz, priority: ['watch', 'withings', 'phone', 'other'] })
    expect(watchFirst['2026-09-10'].source).toBe('watch')
    expect(watchFirst['2026-09-10'].asleepMin).toBe(420) // not 840
    const withingsFirst = buildNights(both, { tz, priority: ['withings', 'watch', 'phone', 'other'] })
    expect(withingsFirst['2026-09-10'].source).toBe('withings')
  })

  it('falls back to the next source when the preferred one has nothing that night', () => {
    const nights = buildNights(night('2026-09-11', WI), { tz, priority: ['watch', 'withings'] })
    expect(nights['2026-09-11'].source).toBe('withings')
  })

  it('a night across the daylight-saving change is measured in real minutes', () => {
    const nights = buildNights(night('2026-10-04'), { tz })
    const n = nights['2026-10-04']
    expect(n.asleepMin).toBe(420)
    expect(n.inBedMin).toBe(440)
    // 22:30 + 440 real minutes is 05:50 standard time, shown as 06:50 after the clocks jump
    expect(tz.hourOf(n.end)).toBeCloseTo(6 + 50 / 60, 5)
    expect(n.date).toBe('2026-10-04')
  })

  it('only the requested dates come back', () => {
    const nights = buildNights([...night('2026-09-10'), ...night('2026-09-11')], { tz, dates: ['2026-09-11'] })
    expect(Object.keys(nights)).toEqual(['2026-09-11'])
  })

  it('no data, no nights', () => {
    expect(buildNights([], { tz })).toEqual({})
  })
})

describe('days', () => {
  const q = (date: string, h: number, value: number, extra: Partial<RawQuantity> = {}): RawQuantity => ({ value, start: at(date, h), end: at(date, h) + 60000, ...W, ...extra })

  it('overnight HRV is the mean of samples inside the main sleep; the day mean is kept too', () => {
    const nights = buildNights(night('2026-09-10'), { tz })
    const hrv = [q('2026-09-10', 1, 40), q('2026-09-10', 3, 50), q('2026-09-10', 15, 30)]
    const [row] = buildDaily({ hrv }, { tz, from: '2026-09-10', to: '2026-09-10', nights })
    expect(row.hrvOvernight).toBe(45)
    expect(row.hrvDayMean).toBe(40)
    expect(meanInWindow(hrv, at('2026-09-10', 0), at('2026-09-10', 2))).toBe(40)
  })

  it('no main sleep means no overnight HRV (the engine falls back to the day mean)', () => {
    const [row] = buildDaily({ hrv: [q('2026-09-10', 15, 30)] }, { tz, from: '2026-09-10', to: '2026-09-10' })
    expect(row.hrvOvernight).toBeNull()
    expect(row.hrvDayMean).toBe(30)
  })

  it('weight keeps its source, body fat and lean mass come through, sums by date', () => {
    const rows = buildDaily({
      weight: [q('2026-09-10', 7, 92.31, WI)],
      bodyFat: [q('2026-09-10', 7, 20.4, WI)],
      leanMass: [q('2026-09-10', 7, 73.5, WI)],
      steps: [{ date: '2026-09-10', value: 8123.6 }],
      bloodPressure: [{ start: at('2026-09-10', 7), sys: 120, dia: 80 }, { start: at('2026-09-10', 19), sys: 124, dia: 82 }],
    }, { tz, from: '2026-09-09', to: '2026-09-10' })
    expect(rows).toHaveLength(1) // 9 Sept has nothing, so no row
    expect(rows[0]).toMatchObject({ weight: 92.31, weightSource: 'Withings', bodyFatPct: 20.4, leanMass: 73.5, steps: 8124, bpSys: 122, bpDia: 81 })
  })

  it('every weigh-in keeps its time, for the sauna fluid estimate; the day weight is the last', () => {
    const [row] = buildDaily({ weight: [q('2026-09-10', 19, 91.6, WI), q('2026-09-10', 17, 92.1, WI)] }, { tz, from: '2026-09-10', to: '2026-09-10' })
    expect(row.weight).toBe(91.6)
    expect(row.weighIns).toEqual([
      { t: at('2026-09-10', 17), kg: 92.1, source: 'Withings' },
      { t: at('2026-09-10', 19), kg: 91.6, source: 'Withings' },
    ])
    const [none] = buildDaily({ steps: [{ date: '2026-09-10', value: 10 }] }, { tz, from: '2026-09-10', to: '2026-09-10' })
    expect(none.weighIns).toBeNull()
  })

  it('wrist temperature belongs to the morning the night ends', () => {
    const s = at('2026-09-09', 22)
    const rows = buildDaily({ wristTemp: [{ value: 35.71, start: s, end: s + 8 * 3600000 }] }, { tz, from: '2026-09-09', to: '2026-09-10' })
    expect(rows.map((r) => r.date)).toEqual(['2026-09-10'])
  })
})

describe('workouts', () => {
  const start = at('2026-09-10', 17)
  const w = { id: 'w1', type: 'traditionalStrengthTraining', start, end: start + 3600000, durationSec: 3600, energyKcal: 312.4, sourceName: 'Hevy', sourceId: 'com.hevy.app' }

  it('keeps only heart rate inside the workout, as offsets', () => {
    const hr = [
      { value: 90, start: start - 60000, end: start },
      { value: 110, start: start + 10000, end: start + 10000 },
      { value: 130, start: start + 20000, end: start + 20000 },
    ]
    expect(seriesFor(w, hr)).toEqual([[10, 110], [20, 130]])
  })

  it('finds the recovery reading recorded just after the workout', () => {
    expect(recoveryFor(w, [{ value: 27.4, start: w.end + 90000, end: w.end + 150000 }])).toBe(27)
    expect(recoveryFor(w, [{ value: 30, start: w.end + 30 * 60000, end: w.end + 31 * 60000 }])).toBeNull()
  })

  it('builds a workout with its date, label and heart rate summary', () => {
    const built = buildWorkout(w, { tz, hr: [{ value: 100, start: start + 5000, end: start + 5000 }, { value: 140, start: start + 9000, end: start + 9000 }] })
    expect(built).toMatchObject({ date: '2026-09-10', title: 'Strength training', durationMin: 60, energyKcal: 312, avgHR: 120, maxHR: 140 })
    expect(workoutLabel('highIntensityIntervalTraining')).toBe('HIIT')
    expect(workoutLabel('paddleSports')).toBe('Paddle sports')
  })
})
