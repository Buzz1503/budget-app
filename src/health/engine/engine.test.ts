import { describe, it, expect } from 'vitest'
import { median, mad, sd, clamp } from './stats'
import { baselineFor, zScore, adjustingChip } from './baseline'
import type { ProtocolEvent } from './baseline'
import { readinessFor, bandFor } from './readiness'
import type { ReadinessSeries } from './readiness'
import { sleepPerformance, sleepDebtH, consistencySd, nightsEnding, clockFromNoon } from './sleep'
import { zoneMinutes, trimp, dedupeWorkouts, dailyLoad, loadVsUsual, defaultMaxHR, ageOn, sessionsWithLoad, weeklyMeans } from './training'
import { pickDaily, movingAverage, weeklyChange } from './bodyComp'
import { isGlp1, isTestosterone, defaultAffectsBaseline, affectsBaseline, relevantEvents, glp1NoteDue } from './protocol'
import { BASELINE, READINESS } from './config'
import { makeTz, addDays, dateRange } from '../tz'
import type { SleepNight, HealthWorkout } from '../types'

const tz = makeTz('Australia/Sydney')
const D0 = '2026-09-01'
const days = (n: number, from = D0) => dateRange(from, addDays(from, n - 1))
/** A series over `n` days ending the day before `date`, values from a function of the index. */
function seriesBefore(date: string, n: number, f: (i: number) => number): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < n; i++) m.set(addDays(date, -(n - i)), f(i))
  return m
}

describe('stats', () => {
  it('median, MAD, SD, clamp', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1) // median 2; |dev| = 1 1 0 0 2 4 7 -> median 1
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2)
    expect(clamp(5, 0, 3)).toBe(3)
  })
})

describe('baselines', () => {
  const date = '2026-10-01'

  it('needs 14 valid days, uses median and 1.4826 × MAD, excludes today', () => {
    const s = seriesBefore(date, 13, (i) => 50 + (i % 3))
    expect(baselineFor(s, date, 'rhr').ready).toBe(false)
    expect(baselineFor(s, date, 'rhr').n).toBe(13)
    s.set(addDays(date, -14), 51)
    s.set(date, 200) // today, never part of its own baseline
    const b = baselineFor(s, date, 'rhr')
    expect(b.ready).toBe(true)
    expect(b.n).toBe(14)
    expect(b.median).toBe(51)
    expect(b.sigma).toBeCloseTo(Math.max(1.4826 * 1, 1.5), 6) // MAD = 1, floor 1.5 wins
  })

  it('only the trailing 28 days count', () => {
    const s = seriesBefore(date, 40, (i) => (i < 12 ? 100 : 50))
    const b = baselineFor(s, date, 'rhr')
    expect(b.n).toBe(28)
    expect(b.median).toBe(50)
  })

  it('sigma has a floor per metric', () => {
    const flat = seriesBefore(date, 20, () => 60)
    expect(baselineFor(flat, date, 'rhr').sigma).toBe(BASELINE.floors.rhr)
    const hrv = seriesBefore(date, 20, () => 50)
    expect(baselineFor(hrv, date, 'hrv', { transform: Math.log }).sigma).toBe(BASELINE.floors.hrv)
  })

  it('z is clipped to ±3 and null without a baseline or value', () => {
    const s = seriesBefore(date, 20, () => 50)
    const b = baselineFor(s, date, 'rhr')
    expect(zScore(80, b)).toBe(3)
    expect(zScore(20, b)).toBe(-3)
    expect(zScore(51.5, b)).toBeCloseTo(1, 6)
    expect(zScore(null, b)).toBeNull()
    expect(zScore(55, baselineFor(new Map(), date, 'rhr'))).toBeNull()
  })

  it('HRV is analysed in ln units', () => {
    const s = seriesBefore(date, 20, (i) => (i % 2 ? 40 : 60))
    const b = baselineFor(s, date, 'hrv', { transform: Math.log })
    expect(b.median).toBeCloseTo((Math.log(40) + Math.log(60)) / 2, 6)
    expect(zScore(Math.exp(b.median as number), b, Math.log)).toBeCloseTo(0, 6)
  })

  describe('after a protocol event', () => {
    const event: ProtocolEvent = { date: '2026-09-25', peptideId: 'reta', name: 'Retatrutide', kind: 'step-up' }
    // 40 days of 55 before the event, 65 from the event onward
    const s = new Map<string, number>()
    for (const d of dateRange('2026-08-15', '2026-10-30')) s.set(d, d < event.date ? 55 : 65)

    it('uses the prior baseline until 10 days of post-event data exist', () => {
      const b = baselineFor(s, '2026-10-04', 'rhr', { events: [event] }) // 9 post days: 25 Sep..3 Oct
      expect(b.regime).toBe('prior')
      expect(b.postDays).toBe(9)
      expect(b.median).toBe(55)
      expect(adjustingChip(b, '2026-10-04')).toBe('Baseline adjusting: Retatrutide dose change 9 days ago')
    })

    it('then switches to post-event data only', () => {
      const b = baselineFor(s, '2026-10-05', 'rhr', { events: [event] }) // 10 post days
      expect(b.regime).toBe('post')
      expect(b.ready).toBe(true)
      expect(b.median).toBe(65)
      expect(adjustingChip(b, '2026-10-05')).toBeNull()
    })

    it('an event older than the window no longer matters', () => {
      const b = baselineFor(s, '2026-10-30', 'rhr', { events: [event] })
      expect(b.regime).toBe('normal')
      expect(b.median).toBe(65)
    })

    it('events after the date are ignored', () => {
      expect(baselineFor(s, '2026-09-20', 'rhr', { events: [event] }).regime).toBe('normal')
    })
  })
})

describe('readiness', () => {
  const date = '2026-10-01'
  function series(over: Partial<Record<keyof ReadinessSeries, Map<string, number>>> = {}): ReadinessSeries {
    return {
      hrv: seriesBefore(date, 28, (i) => 50 + (i % 5) - 2),
      rhr: seriesBefore(date, 28, (i) => 55 + (i % 3) - 1),
      sleep: seriesBefore(date, 28, (i) => 7 + ((i % 3) - 1) * 0.3),
      resp: seriesBefore(date, 28, () => 14.5),
      temp: seriesBefore(date, 28, () => 35.6),
      ...over,
    }
  }
  const withToday = (s: ReadinessSeries, today: Partial<Record<keyof ReadinessSeries, number>>) => {
    for (const [k, v] of Object.entries(today)) s[k as keyof ReadinessSeries].set(date, v as number)
    return s
  }

  it('usual values score 60, the centre', () => {
    const r = readinessFor(date, withToday(series(), { hrv: 50, rhr: 55, sleep: 7, resp: 14.5, temp: 35.6 }))
    expect(r.status).toBe('ok')
    expect(r.score).toBe(60)
    expect(r.band).toBe('moderate')
  })

  it('higher HRV and lower resting HR score above usual', () => {
    const r = readinessFor(date, withToday(series(), { hrv: 70, rhr: 50, sleep: 7.5 }))
    expect(r.score as number).toBeGreaterThan(80)
  })

  it('respiratory rate and wrist temperature only count when above usual', () => {
    const base = { hrv: 50, rhr: 55, sleep: 7 }
    const low = readinessFor(date, withToday(series(), { ...base, resp: 12, temp: 35.0 }))
    const high = readinessFor(date, withToday(series(), { ...base, resp: 17, temp: 36.4 }))
    expect(low.score).toBe(60)
    expect(high.score as number).toBeLessThan(60)
  })

  it('missing components are dropped and the weights re-normalised', () => {
    const r = readinessFor(date, withToday(series({ resp: new Map(), temp: new Map(), rhr: new Map() }), { hrv: 50, sleep: 7 }))
    expect(r.status).toBe('ok')
    const used = r.components.filter((c) => c.weight > 0)
    expect(used.map((c) => c.key).sort()).toEqual(['hrv', 'sleep'])
    expect(used.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 9)
    expect(used.find((c) => c.key === 'hrv')!.weight).toBeCloseTo(0.4 / 0.65, 9)
  })

  it('needs HRV or resting HR plus sleep from last night', () => {
    expect(readinessFor(date, withToday(series(), { hrv: 50, rhr: 55 })).status).toBe('insufficient')
    expect(readinessFor(date, withToday(series(), { sleep: 7 })).status).toBe('insufficient')
    expect(readinessFor(date, withToday(series(), { rhr: 55, sleep: 7 })).status).toBe('ok')
  })

  it('without 14 days of HRV or resting HR it is still building, and says which day', () => {
    const r = readinessFor(date, withToday(series({ hrv: seriesBefore(date, 5, () => 50), rhr: seriesBefore(date, 6, () => 55) }), { hrv: 50, rhr: 55, sleep: 7 }))
    expect(r.status).toBe('building')
    expect(r.buildingDay).toBe(6)
  })

  it('no data at all, and one day of data, are both just building', () => {
    const empty: ReadinessSeries = { hrv: new Map(), rhr: new Map(), sleep: new Map(), resp: new Map(), temp: new Map() }
    expect(readinessFor(date, empty)).toMatchObject({ status: 'building', score: null, buildingDay: 0 })
    const one = withToday({ hrv: new Map(), rhr: new Map(), sleep: new Map(), resp: new Map(), temp: new Map() }, { hrv: 50, rhr: 55, sleep: 7 })
    expect(readinessFor(date, one).status).toBe('building')
  })

  it('the score is clamped to 0–100', () => {
    expect(readinessFor(date, withToday(series(), { hrv: 500, rhr: 30, sleep: 12 })).score).toBe(100)
    expect(readinessFor(date, withToday(series(), { hrv: 5, rhr: 90, sleep: 2, resp: 30, temp: 39 })).score).toBe(0)
  })

  it('band edges', () => {
    expect(bandFor(0).id).toBe('low')
    expect(bandFor(33).id).toBe('low')
    expect(bandFor(34).id).toBe('moderate')
    expect(bandFor(66).id).toBe('moderate')
    expect(bandFor(67).id).toBe('high')
    expect(bandFor(100).label).toBe('High')
    expect(READINESS.center).toBe(60)
  })
})

// ------------------------------------------------------------------ sleep

function mkNight(date: string, { bedH = 22.5, asleepMin = 420, inBedMin = 460, deep = 60, rem = 90, stages = true }: Partial<{ bedH: number; asleepMin: number; inBedMin: number; deep: number; rem: number; stages: boolean }> = {}): SleepNight {
  const start = tz.startOfDay(addDays(date, -1)) + bedH * 3600000
  return {
    date, source: 'watch', sourceName: 'Watch', start, end: start + inBedMin * 60000,
    inBedMin, asleepMin, awakeMin: inBedMin - asleepMin, deepMin: stages ? deep : 0, remMin: stages ? rem : 0,
    coreMin: stages ? asleepMin - deep - rem : 0, unspecifiedMin: stages ? 0 : asleepMin, hasStages: stages, naps: [],
  }
}

describe('sleep performance', () => {
  // a week clear of the daylight-saving change, which genuinely moves the clock
  // time you wake up and would show as inconsistency
  const date = '2026-09-20'
  const week = (f: (i: number) => Partial<Parameters<typeof mkNight>[1]> = () => ({})) => days(7, addDays(date, -6)).map((d, i) => mkNight(d, f(i)))

  it('a full, efficient, regular night with 40 % deep + REM scores 100', () => {
    const recent = week(() => ({ asleepMin: 480, inBedMin: 520, deep: 96, rem: 96 }))
    const p = sleepPerformance(recent.at(-1)!, { recent, needH: 8, tz })
    expect(p.parts.duration).toBe(1)
    expect(p.parts.consistency).toBe(1)
    expect(p.parts.restorative).toBe(1)
    expect(p.parts.efficiency).toBe(1)
    expect(p.score).toBe(100)
  })

  it('duration is asleep / need, capped', () => {
    const n = mkNight(date, { asleepMin: 360, inBedMin: 380 })
    expect(sleepPerformance(n, { needH: 8, tz }).parts.duration).toBe(0.75)
  })

  it('efficiency: 90 % or more is full marks, 70 % or less is none', () => {
    expect(sleepPerformance(mkNight(date, { asleepMin: 400, inBedMin: 500 }), { tz }).parts.efficiency).toBeCloseTo(0.5, 6)
    expect(sleepPerformance(mkNight(date, { asleepMin: 350, inBedMin: 500 }), { tz }).parts.efficiency).toBe(0)
  })

  it('consistency: bedtime SD of 45 min scores about half', () => {
    const recent = week((i) => ({ bedH: i % 2 ? 22.5 - 0.75 : 22.5 + 0.75 }))
    const sdMin = consistencySd(recent, tz) as number
    expect(sdMin).toBeGreaterThan(40)
    const p = sleepPerformance(recent.at(-1)!, { recent, tz })
    expect(p.parts.consistency as number).toBeCloseTo(1 - sdMin / 90, 6)
  })

  it('bedtimes either side of midnight are an hour apart, not 23', () => {
    const before = tz.startOfDay('2026-10-09') + 23.5 * 3600000
    const after = tz.startOfDay('2026-10-10') + 0.5 * 3600000
    expect(clockFromNoon(after, tz) - clockFromNoon(before, tz)).toBe(60)
  })

  it('without stages, restorative is left out and the rest re-weighted', () => {
    const n = mkNight(date, { stages: false, asleepMin: 480, inBedMin: 520 })
    const p = sleepPerformance(n, { needH: 8, tz })
    expect(p.parts.restorative).toBeNull()
    expect(p.parts.consistency).toBeNull() // no recent nights either
    expect(p.score).toBe(100)
  })

  it('debt is the 7-night sum of hours short of need; missing nights add nothing', () => {
    const nights = new Map(week((i) => ({ asleepMin: i === 3 ? 300 : 420 })).map((n) => [n.date, n]))
    // six nights 1 h short, one 3 h short = 9 h
    expect(sleepDebtH(nights, date, 8)).toBeCloseTo(9, 6)
    nights.delete(addDays(date, -1))
    expect(sleepDebtH(nights, date, 8)).toBeCloseTo(8, 6)
    expect(nightsEnding(nights, date)).toHaveLength(6)
    expect(sleepDebtH(new Map(), date, 8)).toBe(0)
  })
})

// --------------------------------------------------------------- training

function mkWorkout(id: string, startMs: number, mins: number, extra: Partial<HealthWorkout> = {}): HealthWorkout {
  return {
    id, date: tz.dateOf(startMs), type: 'traditionalStrengthTraining', title: 'Strength training', start: startMs, end: startMs + mins * 60000,
    durationMin: mins, energyKcal: 300, distanceM: null, avgHR: null, maxHR: null, sourceName: 'Watch', sourceId: 'com.apple.health.x',
    hrSeries: [], hrRecovery: null, ...extra,
  }
}

describe('training load', () => {
  it('max HR: 208 − 0.7 × age, 190 without an age', () => {
    expect(defaultMaxHR(36)).toBe(183)
    expect(defaultMaxHR(null)).toBe(190)
    expect(ageOn('1990-06-15', '2026-06-14')).toBe(35)
    expect(ageOn('1990-06-15', '2026-06-15')).toBe(36)
    expect(ageOn(null, '2026-06-15')).toBeNull()
  })

  it('zone minutes and Edwards TRIMP', () => {
    // max 200: 50% = 100 bpm. 10 minutes at 110 (zone 1), 10 at 150 (zone 3), 10 at 185 (zone 5)
    const series: Array<[number, number]> = []
    for (let t = 0; t < 1800; t += 60) series.push([t, t < 600 ? 110 : t < 1200 ? 150 : 185])
    series.push([1800, 185])
    const zones = zoneMinutes(series, 200)
    expect(zones).toEqual([10, 0, 10, 0, 10])
    expect(trimp(zones)).toBe(10 * 1 + 10 * 3 + 10 * 5)
  })

  it('below 50 % of max is no zone, and long gaps are not counted', () => {
    expect(zoneMinutes([[0, 80], [60, 80]], 200)).toEqual([0, 0, 0, 0, 0])
    expect(zoneMinutes([[0, 150], [3600, 150]], 200)).toEqual([0, 0, 2, 0, 0])
  })

  it('Hevy and the Watch writing the same session become one: Hevy title, Watch heart rate', () => {
    const t = tz.startOfDay('2026-10-05') + 17.5 * 3600000
    const hevy = mkWorkout('hevy', t, 60, { title: 'Push', sourceName: 'Hevy', sourceId: 'com.hevy.app', energyKcal: 280 })
    const watch = mkWorkout('watch', t + 120000, 57, { hrSeries: [[0, 120], [60, 130]], avgHR: 125, energyKcal: 330 })
    const walk = mkWorkout('walk', t + 3 * 3600000, 30, { type: 'walking', title: 'Walk' })
    const out = dedupeWorkouts([hevy, watch, walk])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ title: 'Push', avgHR: 125, energyKcal: 330, mergedIds: ['hevy', 'watch'] })
    expect(out[1].mergedIds).toEqual(['walk'])
  })

  it('a small overlap is two sessions', () => {
    const t = tz.startOfDay('2026-10-05') + 17 * 3600000
    expect(dedupeWorkouts([mkWorkout('a', t, 60), mkWorkout('b', t + 45 * 60000, 60)])).toHaveLength(2)
  })

  it('load vs usual: 7-day mean over 28-day mean, days off counted as zero', () => {
    const date = '2026-10-28'
    const load = new Map<string, number>()
    for (let i = 0; i < 28; i++) load.set(addDays(date, -i), 50)
    expect(loadVsUsual(load, date)).toMatchObject({ ratio: 1, label: 'Usual' })
    for (let i = 0; i < 7; i++) load.set(addDays(date, -i), 100)
    expect(loadVsUsual(load, date).label).toBe('Higher')
    for (let i = 0; i < 7; i++) load.set(addDays(date, -i), 10)
    expect(loadVsUsual(load, date).label).toBe('Lower')
    expect(loadVsUsual(new Map(), date)).toMatchObject({ ratio: null, label: null })
    expect(loadVsUsual(load, date, { firstDate: addDays(date, -10) }).label).toBeNull()
  })

  it('sessions carry zones and TRIMP; daily load sums them', () => {
    const t = tz.startOfDay('2026-10-05') + 17 * 3600000
    const ss = sessionsWithLoad([mkWorkout('a', t, 10, { hrSeries: [[0, 150], [60, 150], [120, 150]] }), mkWorkout('b', t + 3 * 3600000, 10, { hrSeries: [[0, 110], [60, 110]] })], 200)
    expect(ss.map((s) => s.trimp)).toEqual([6, 1])
    expect(dailyLoad(ss).get('2026-10-05')).toBe(7)
  })

  it('weekly means for heart rate recovery, oldest first, with n', () => {
    const rows = [{ date: '2026-10-05', v: 20 }, { date: '2026-10-07', v: 30 }, { date: '2026-09-28', v: 24 }]
    const w = weeklyMeans(rows, '2026-10-08', (r) => ({ date: r.date, value: r.v }), 3)
    expect(w.map((x) => x.weekStart)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05'])
    expect(w.map((x) => x.mean)).toEqual([null, 24, 25])
    expect(w.map((x) => x.n)).toEqual([0, 1, 2])
  })
})

// ------------------------------------------------------------- body comp

describe('body composition', () => {
  it('scan beats manual beats Health, measure by measure', () => {
    const out = pickDaily([
      { date: '2026-10-01', source: 'health', sourceLabel: 'Withings', weight: 90, bodyFatPct: 20, leanMass: 72 },
      { date: '2026-10-01', source: 'manual', weight: 89.5 },
      { date: '2026-10-02', source: 'health', weight: 89.9, bodyFatPct: 21 },
      { date: '2026-10-02', source: 'scan', weight: 89.0, bodyFatPct: 18.5 },
    ])
    expect(out[0]).toMatchObject({ weight: 89.5, weightSource: 'manual', bodyFatPct: 20, bodyFatSource: 'health', leanMass: 72 })
    expect(out[1]).toMatchObject({ weight: 89, weightSource: 'scan', bodyFatPct: 18.5 })
    expect(out[1].fatMass).toBeCloseTo(16.47, 1)
    expect(out[1].leanMass).toBeCloseTo(72.54, 1)
  })

  it('fat mass = weight × fat %; lean = reported lean mass, else weight − fat mass', () => {
    const [d] = pickDaily([{ date: '2026-10-01', source: 'health', weight: 100, bodyFatPct: 25 }])
    expect(d.fatMass).toBe(25)
    expect(d.leanMass).toBe(75)
  })

  it('7-day moving average uses whatever readings fall in the window', () => {
    const s = [
      { date: '2026-10-01', value: 90 }, { date: '2026-10-03', value: 92 },
      { date: '2026-10-08', value: 88 }, { date: '2026-10-09', value: null },
    ]
    const ma = movingAverage(s)
    // 9 Oct has no reading of its own but still has an average: 3 Oct and 8 Oct
    expect(ma.map((p) => p.value)).toEqual([90, 91, 90, 90])
  })

  it('weekly change over 4 weeks from the 7-day average', () => {
    const ma = days(29, '2026-09-01').map((d, i) => ({ date: d, value: 92 - i * 0.1 }))
    expect(weeklyChange(ma, '2026-09-29')).toBeCloseTo(-0.7, 6)
    expect(weeklyChange(ma.slice(-5), '2026-09-29')).toBeNull()
  })
})

// --------------------------------------------------------------- protocol

describe('protocol context', () => {
  const reta = { id: 'retatrutide', name: 'Retatrutide' }
  const test = { id: 'testosterone-e', name: 'Testosterone Enanthate' }
  const bpc = { id: 'bpc157', name: 'BPC-157' }

  it('GLP-1 class and testosterone esters affect baselines by default; the user can override', () => {
    expect(isGlp1(reta)).toBe(true)
    expect(isGlp1({ id: 'x', name: 'Tirzepatide' })).toBe(true)
    expect(isTestosterone(test)).toBe(true)
    expect(defaultAffectsBaseline(bpc)).toBe(false)
    expect(affectsBaseline({ ...bpc, affectsRecoveryBaseline: true })).toBe(true)
    expect(affectsBaseline({ ...reta, affectsRecoveryBaseline: false })).toBe(false)
  })

  it('relevant events are starts, stops and dose changes of flagged compounds only', () => {
    const ev = relevantEvents([
      { ...reta, points: [{ date: '2026-09-01', kind: 'start' }, { date: '2026-09-20', kind: 'step-up', to: 4, unit: 'mg' }, { date: '2026-09-21', kind: 'skip' }], runs: [] },
      { ...bpc, points: [{ date: '2026-09-05', kind: 'start' }], runs: [] },
    ] as never)
    expect(ev.map((e) => `${e.date}:${e.kind}`)).toEqual(['2026-09-01:start', '2026-09-20:step-up'])
  })

  it('the GLP-1 resting heart rate note shows for 14 days after an event', () => {
    const ev: ProtocolEvent[] = [{ date: '2026-09-20', peptideId: 'retatrutide', name: 'Retatrutide', kind: 'step-up' }]
    expect(glp1NoteDue('2026-10-04', ev, [reta])).toBe(true)
    expect(glp1NoteDue('2026-10-05', ev, [reta])).toBe(false)
    expect(glp1NoteDue('2026-09-19', ev, [reta])).toBe(false)
    expect(glp1NoteDue('2026-09-25', [{ ...ev[0], peptideId: 'testosterone-e' }], [test])).toBe(false)
  })
})
