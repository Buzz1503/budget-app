import { describe, it, expect } from 'vitest'
import {
  quantile, normalRange, rangeTone, asleepVsNeed, vsNormal, verdict, verdictWord, bedtimeVsUsual, needBars, windowStats, isWeekendNight,
  debtView, labLine, shapedChips, trendAnswer, trendDiff, trendTone, NOT_ENOUGH, hm,
} from './tabView'

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

describe('your normal: the middle 80% of the 28 nights before', () => {
  it('10th to 90th percentile, from 7 nights', () => {
    const v = Array.from({ length: 11 }, (_, i) => 50 + i) // 50..60
    expect(normalRange(v)).toEqual({ lo: 51, hi: 59, median: 55, n: 11 })
    expect(normalRange([1, 2, 3, 4, 5, 6])).toBeNull()
    expect(quantile([0, 10], 0.25)).toBe(2.5)
  })

  it('only the 28 nights before the night, only nights that count', () => {
    const series = new Map<string, number>()
    for (let i = 1; i <= 40; i++) series.set(addDays('2026-11-07', -i), i <= 28 ? 60 + (i % 10) : 999)
    series.set('2026-11-07', 75)
    const [row] = vsNormal([{ key: 'hrv', label: 'HRV', unit: 'ms', dp: 0, dir: 'up', series }], '2026-11-07')
    expect(row.n).toBe(28)
    expect(row.hi).toBeLessThan(70) // the 999s from before day 28 are not in it
    expect(row.tone).toBe('better')
    expect(row.delta).toBe(Math.round(75 - row.median!))
    // an Other source night is not part of anyone's normal
    const [few] = vsNormal([{ key: 'hrv', label: 'HRV', unit: 'ms', dp: 0, dir: 'up', series }], '2026-11-07', (d) => d > addDays('2026-11-07', -5))
    expect(few).toMatchObject({ lo: null, tone: 'same', n: 4 })
  })
})

describe('better or worse, per metric', () => {
  const band = { lo: 50, hi: 60 }
  it('grey inside the band; outside it by the metric’s better side', () => {
    expect(rangeTone(55, band, 'up')).toBe('same')
    expect(rangeTone(65, band, 'up')).toBe('better')
    expect(rangeTone(45, band, 'up')).toBe('worse')
    // sleeping heart rate and awake time: lower is better
    expect(rangeTone(45, band, 'down')).toBe('better')
    expect(rangeTone(65, band, 'down')).toBe('worse')
    // breathing rate and wrist temperature have no better side
    expect(rangeTone(70, band, null)).toBe('same')
    expect(rangeTone(70, null, 'up')).toBe('same')
  })
})

describe('time asleep against need', () => {
  it('green at or over need, amber over 30 min under, grey between', () => {
    expect(asleepVsNeed(490, 8)).toEqual({ tone: 'better', needDelta: 10, chipText: '+10\u00a0min' })
    expect(asleepVsNeed(397, 8)).toEqual({ tone: 'worse', needDelta: -83, chipText: '−1h\u00a023' })
    expect(asleepVsNeed(460, 8).tone).toBe('same')
  })
})

describe('the verdict', () => {
  it('one sentence: the night, how long against need, bedtime against usual', () => {
    expect(verdict({ asleepMin: 472, needH: 8, score: 78, bedDiffMin: 12 })).toBe('Good night. 7 h 52 m, 98% of what you need, bedtime on time.')
    expect(verdict({ asleepMin: 330, needH: 8, score: 50, bedDiffMin: 100 })).toBe('A rough night. 5 h 30 m, 69% of what you need, bedtime 1 h 40 m later than usual.')
    expect(verdict({ asleepMin: 480, needH: 8, score: 90, bedDiffMin: -45 })).toBe('Great night. 8 h 00 m, 100% of what you need, bedtime 45 min earlier than usual.')
    expect(verdict({ asleepMin: 420, needH: 8, score: null, bedDiffMin: null })).toBe('Last night. 7 h 00 m, 88% of what you need.')
    expect(verdictWord(60)).toBe('Fair night')
    expect(hm(59.6)).toBe('1 h 00 m')
  })

  it('bedtime against the median of the nights before', () => {
    expect(bedtimeVsUsual(700, [660, 670, 680])).toEqual({ usual: 670, diff: 30 })
    expect(bedtimeVsUsual(700, [660])).toEqual({ usual: null, diff: null })
  })
})

describe('the last 14 nights', () => {
  const night = (date: string, h: number, bed: number) => ({ date, asleepMin: h * 60, bedFromNoon: bed, wakeFromNoon: bed + h * 60 + 20 })
  it('time asleep against need', () => {
    const r = needBars([night('2026-11-01', 7, 660), night('2026-11-02', 8.2, 650), night('2026-11-03', 6.5, 700)], 8)
    expect(r.bars.map((b) => b.under)).toEqual([true, false, true])
    expect(r.answer).toBe('Under your need on 2 of 3 nights.')
    expect(needBars([night('2026-11-01', 9, 600)], 8).answer).toBe('At or over your need on all 1 nights.')
  })

  it('bedtime spread and how much later weekends are', () => {
    // 2026-11-07 is a Saturday: the Friday night is a weekend night
    expect(isWeekendNight('2026-11-07')).toBe(true)
    expect(isWeekendNight('2026-11-09')).toBe(false)
    const ns = [
      night('2026-11-03', 7, 640), night('2026-11-04', 7, 650), night('2026-11-05', 7, 660), night('2026-11-06', 7, 650),
      night('2026-11-07', 7, 700), night('2026-11-08', 7, 740),
    ]
    const w = windowStats(ns)
    expect(w.spreadMin).toBe(100)
    expect(w.weekendLaterMin).toBe(70) // 720 against 650
    expect(w.answer).toBe('Bedtime varied by 1 h 40 m. Weekends later by 1 h 10 m.')
    expect(windowStats(ns.slice(0, 2)).answer).toBe('Needs 3 nights to say.')
  })
})

describe('sleep debt', () => {
  it('one number, its trend, one line', () => {
    expect(debtView(3.5, 2.9, 8)).toEqual({ value: 3.5, trend: 'up', text: '3.5 h short of your 8 h need over the last 7 nights, about 30 min a night.' })
    expect(debtView(0.2, 0.9, 8)).toMatchObject({ trend: 'down', text: 'About square with your 8 h need over the last 7 nights.' })
    expect(debtView(2, 2.05, 8).trend).toBe('flat')
  })
})

describe('what shaped last night', () => {
  const names: Record<string, string> = { sauna: 'Sauna', 'habit:alcohol': 'Alcohol', 'asNeeded:tem': 'Temazepam', 'dose:reta': 'Retatrutide dose' }
  const feature = {
    binary: { sauna: true, lateSauna: true, 'habit:alcohol': true, 'asNeeded:tem': true, 'dose:reta': false, weekend: true, nap: null },
    line: ['2 drinks, last 9:40 pm', 'Temazepam 10 mg 9:15 pm'],
  }
  it('chips for what was present that evening, with the night’s own words', () => {
    const chips = shapedChips(feature, (k) => names[k] || k, [{ key: 'bedtime', label: 'Bedtime', detail: '40 min later than usual' }])
    expect(chips.map((c) => c.key)).toEqual(['sauna', 'habit:alcohol', 'asNeeded:tem', 'bedtime'])
    expect(chips.find((c) => c.key === 'habit:alcohol')!.detail).toBe('2 drinks, last 9:40 pm')
    expect(chips.find((c) => c.key === 'asNeeded:tem')!.detail).toBe('Temazepam 10 mg 9:15 pm')
    expect(shapedChips(null, (k) => k)).toEqual([])
  })

  const outcomes = {
    deep: { key: 'deep', label: 'Deep sleep', unit: 'min', dp: 0, words: ['higher', 'lower'] as [string, string] },
    sleepScore: { key: 'sleepScore', label: 'Sleep score', unit: '', dp: 0, words: ['higher', 'lower'] as [string, string] },
  }
  it('the Sleep Lab line only from 7 nights with and 7 without, Clear first', () => {
    const cmp = [
      { factor: 'sauna', outcome: 'sleepScore', nWith: 14, nWithout: 40, diff: 2, label: 'Unclear' },
      { factor: 'sauna', outcome: 'deep', nWith: 14, nWithout: 40, diff: 6.2, label: 'Clear' },
      { factor: 'habit:alcohol', outcome: 'deep', nWith: 5, nWithout: 40, diff: -9, label: 'Clear' },
      { factor: 'asNeeded:tem', outcome: 'sleepScore', nWith: 9, nWithout: 30, diff: 1, label: 'Unclear' },
    ]
    expect(labLine('sauna', 'Sauna', cmp, outcomes).text).toBe('Nights with sauna: deep sleep 6 min higher on average, 14 nights')
    expect(labLine('habit:alcohol', 'Alcohol', cmp, outcomes)).toEqual({ text: NOT_ENOUGH, enough: false, clear: false })
    expect(labLine('asNeeded:tem', 'Temazepam', cmp, outcomes).text).toBe('Nights with temazepam: no clear difference yet, 9 nights')
    for (const c of ['sauna', 'asNeeded:tem']) expect(labLine(c, 'X', cmp, outcomes).text).not.toMatch(/caused|because|improved/i)
  })
})

describe('trend answers', () => {
  it('the second half of the window against the first', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ date: addDays('2026-11-07', -29 + i), value: i < 15 ? 60 : 68 }))
    expect(trendAnswer('Deep sleep', pts, 'min', 0, 30, '2026-11-07')).toBe('Deep sleep up 8 min on average over 30 nights.')
    expect(trendAnswer('Deep sleep', pts.slice(-2), 'min', 0, 30, '2026-11-07')).toBe('Needs more nights in the last 30.')
    // the colour follows the answer: up is green for deep sleep, amber for sleeping heart rate
    expect(trendTone(trendDiff(pts, 30, '2026-11-07', 0), 'up')).toBe('better')
    expect(trendTone(trendDiff(pts, 30, '2026-11-07', 0), 'down')).toBe('worse')
    expect(trendTone(0, 'up')).toBe('same')
  })
})

describe('the chips use that day and evening', () => {
  it('a sauna the evening before is on the night; one the morning after is not', async () => {
    const { makeTz, addDays: add } = await import('../health/tz')
    const { nightFeatures } = await import('./features')
    const { DEFAULT_AS_NEEDED, migrateHabits } = await import('./logging')
    const tz = makeTz('Australia/Sydney')
    const at = (date: string, hhmm: string) => tz.startOfDay(date) + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60000
    const night = (wake: string) => ({ date: wake, start: at(add(wake, -1), '23:00'), end: at(wake, '06:30') })
    const fs = nightFeatures({
      tz, nights: [night('2026-10-24'), night('2026-10-25')], asNeededItems: DEFAULT_AS_NEEDED, asNeededLogs: [], supplements: [], supplementLogs: [],
      doseLogs: [], compounds: [], habitLogs: { '2026-10-23': { alcohol: true } }, habits: migrateHabits([]),
      eveningDetails: { '2026-10-23': { drinks: 2, lastDrinkAt: '21:40' } }, workouts: [],
      sauna: [{ date: '2026-10-23', start: '19:10', lengthMin: 20, tempC: 80 }], daylight: new Map(), steps: new Map(),
    })
    const name = (k: string) => ({ sauna: 'Sauna', 'habit:alcohol': 'Alcohol' } as Record<string, string>)[k] || k
    const d24 = shapedChips(fs.find((f) => f.date === '2026-10-24'), name)
    expect(d24.map((c) => c.key)).toEqual(expect.arrayContaining(['sauna', 'habit:alcohol']))
    expect(d24.find((c) => c.key === 'habit:alcohol')!.detail).toMatch(/^2 drinks/)
    // the night after: nothing from the 23rd
    const d25 = shapedChips(fs.find((f) => f.date === '2026-10-25'), name)
    expect(d25.map((c) => c.key)).not.toContain('sauna')
    expect(d25.map((c) => c.key)).not.toContain('habit:alcohol')
  })
})
