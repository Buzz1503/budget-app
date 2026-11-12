import { describe, it, expect } from 'vitest'
import {
  fiveMinBins, nightHeart, overnightDip, timeToLowWords, heartSummary, trendRun, doseSegments, periodsFor, defaultReference,
  meanCI, statusVs, periodTable, doseChanges, changeWindows, sinceDose, sinceDoseAnswer, contextLine, slopePerWeek,
  adjustedPeriods, switchCandidates, switchWindows, switchCompare, switchAnswer, historyCoverage, HEART_METRICS, NO_EQUIVALENCE, HEART_INFO, HEART,
} from './heart'
import type { CompoundTL, Lookup } from './heart'

const MIN = 60000
const T0 = Date.parse('2026-11-10T13:00:00Z') // 23:00 in Sydney, the night to 11 Nov
const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16)

describe('a night in 5-minute averages', () => {
  const segs = [
    { start: T0, end: T0 + 10 * MIN, stage: 'awake' },
    { start: T0 + 10 * MIN, end: T0 + 200 * MIN, stage: 'core' },
    { start: T0 + 200 * MIN, end: T0 + 215 * MIN, stage: 'awake' },
    { start: T0 + 215 * MIN, end: T0 + 420 * MIN, stage: 'rem' },
  ]
  // a reading a minute: 60 asleep, a dip to 50 at 90 to 99 min, one stray 95 at 120, 85 while awake at 205
  const hr: Array<[number, number]> = Array.from({ length: 420 }, (_, m) => [m, m >= 90 && m < 100 ? 50 : m >= 200 && m < 215 ? 85 : 60] as [number, number])
  hr[120] = [120, 95]

  it('one stray reading is averaged into its 5 minutes, not the night’s highest', () => {
    const bins = fiveMinBins(hr, T0, segs)
    expect(bins.find((b) => b.t === T0 + 122.5 * MIN)!.bpm).toBe(67)
    const h = nightHeart({ start: T0, end: T0 + 420 * MIN, segments: segs }, hr, 75)!
    expect(h.high!.bpm).toBe(67)
    expect(h.low).toEqual({ bpm: 50, t: T0 + 92.5 * MIN })
  })

  it('highest leaves out minutes marked awake; the awake peak is kept on its own', () => {
    const h = nightHeart({ start: T0, end: T0 + 420 * MIN, segments: segs }, hr, 75)!
    expect(h.awakePeak!.bpm).toBe(85)
    expect(h.high!.bpm).toBeLessThan(85)
  })

  it('time to the lowest, from falling asleep, and the overnight dip', () => {
    const h = nightHeart({ start: T0, end: T0 + 420 * MIN, segments: segs }, hr, 75)!
    // asleep at 10 min, lowest bin centred at 92.5 min
    expect(h.timeToLowMin).toBe(83)
    expect(overnightDip(60, 75)).toBe(20)
    expect(overnightDip(60, null)).toBeNull()
    expect(h.dipPct).toBeCloseTo(((75 - h.avg) / 75) * 100, 0)
    expect(timeToLowWords(83)).toBe('Lowest 1 h 23 m after falling asleep. A later low can mean your body took longer to settle.')
    expect(timeToLowWords(40)).toMatch(/^Lowest 40 min after/)
  })

  it('no heart rate while asleep, no answer', () => {
    expect(nightHeart({ start: T0, end: T0 + 60 * MIN, segments: [{ start: T0, end: T0 + 60 * MIN, stage: 'awake' }] }, [[5, 70]], 70)).toBeNull()
  })
})

describe('the plain summary sentence', () => {
  const heart = { avg: 62, low: { bpm: 54, t: Date.parse('2026-11-10T02:10:00Z') }, high: { bpm: 78, t: 0 }, awakePeak: null, timeToLowMin: 120, dipPct: 14, bins: 80 }
  const text = (p: Array<{ text: string }>) => p.map((x) => x.text).join('')
  it('dip within the typical range, above the reference, rising', () => {
    const p = heartSummary({ heart, clock, refAvg: 56, recentAvgs: [55, 56, 57, 59, 60, 62] })
    expect(text(p)).toBe("Heart rate asleep: average 62, lowest 54 at 02:10, highest 78. It dropped 14% below your daytime average. A 10 to 20% drop while asleep is typical for adults, so yours is in that range. That's 6 above your good sleep period. Rising for 5 nights.")
    expect(p.find((x) => x.text === 'in that range')!.tone).toBe('better')
    expect(p.find((x) => x.text.startsWith('6 above'))!.tone).toBe('worse')
    expect(p.find((x) => x.text.startsWith('Rising'))!.tone).toBe('worse')
  })
  it('a smaller drop than typical, below the reference, no run', () => {
    const p = heartSummary({ heart: { ...heart, dipPct: 6 }, clock, refAvg: 65, recentAvgs: [60, 62, 61, 62] })
    expect(text(p)).toContain('It dropped 6% below your daytime average, a smaller drop than the typical 10 to 20%.')
    expect(p.find((x) => x.text.startsWith('a smaller drop'))!.tone).toBe('worse')
    expect(text(p)).toContain("That's 3 below your good sleep period.")
    expect(text(p)).not.toMatch(/Rising|Falling/)
  })
  it('a larger drop than typical is said plainly, without colour; about the same as the reference', () => {
    const p = heartSummary({ heart: { ...heart, dipPct: 24 }, clock, refAvg: 61.5, recentAvgs: [64, 63, 62] })
    expect(text(p)).toContain('It dropped 24% below your daytime average, more than the typical 10 to 20%.')
    expect(text(p)).toContain('About the same as your good sleep period.')
    expect(text(p)).not.toMatch(/Rising|Falling/) // two nights falling is not yet a run of 3
    expect(trendRun([64, 63, 62, 61])).toBe(-3)
    expect(trendRun([60, 61])).toBe(1)
    expect(trendRun([60, 60])).toBe(0)
    expect(text(p)).not.toMatch(/caused|diagnos|should/i)
  })
})

const compound = (id: string, name: string, points: CompoundTL['points'], frequency = 'weekly'): CompoundTL => ({ id, name, frequency, points })
const reta = compound('reta', 'Retatrutide', [
  { date: '2026-03-01', kind: 'start', to: 2, unit: 'mg' },
  { date: '2026-05-01', kind: 'step-up', to: 4, unit: 'mg' },
  { date: '2026-07-01', kind: 'step-up', to: 6, unit: 'mg' },
  { date: '2026-08-01', kind: 'override', to: 4, unit: 'mg' },
  { date: '2026-10-01', kind: 'stop' },
])
const tirz = compound('tirz', 'Tirzepatide', [{ date: '2026-10-06', kind: 'start', to: 5, unit: 'mg' }])
const bpc = compound('bpc', 'BPC-157', [{ date: '2026-06-10', kind: 'start', to: 250, unit: 'mcg' }], 'daily')

describe('periods by compound and dose level', () => {
  it('dose segments run to the next change, a stop or today', () => {
    expect(doseSegments(reta, '2026-11-12').map((s) => [s.dose, s.from, s.to])).toEqual([
      [2, '2026-03-01', '2026-04-30'], [4, '2026-05-01', '2026-06-30'], [6, '2026-07-01', '2026-07-31'], [4, '2026-08-01', '2026-09-30'],
    ])
  })

  it('before, then each compound at each dose level (a level returned to is one period); not other compounds', () => {
    const p = periodsFor([bpc, tirz, reta], '2026-11-12')
    expect(p.map((x) => x.label)).toEqual(['Before Retatrutide', 'Retatrutide 2 mg', 'Retatrutide 4 mg', 'Retatrutide 6 mg', 'Tirzepatide 5 mg'])
    expect(p[0].ranges).toEqual([[add('2026-03-01', -HEART.beforeDays), '2026-02-28']])
    expect(p[2].ranges).toEqual([['2026-05-01', '2026-06-30'], ['2026-08-01', '2026-09-30']])
    expect(p[4]).toMatchObject({ colour: 1, ranges: [['2026-10-06', '2026-11-12']] })
  })

  it('the good sleep reference: the 8 weeks before the first Retatrutide dose', () => {
    expect(defaultReference([tirz, reta], '2026-11-12')).toEqual({ from: '2026-01-04', to: '2026-02-28' })
    expect(defaultReference([bpc], '2026-11-12')).toBeNull()
  })
})

describe('95% intervals and status', () => {
  it('mean plus or minus 1.96 standard errors', () => {
    const s = meanCI([60, 62, 64, 66])!
    expect(s.mean).toBe(63)
    expect(s.hi - s.mean).toBeCloseTo(1.96 * (Math.sqrt(20 / 3) / 2), 6)
    expect(meanCI([60])).toBeNull()
  })
  it('Early under 7 nights, Clear when the interval misses the reference, Possible past half its spread, else Normal', () => {
    const ref = meanCI([58, 59, 60, 61, 62, 60, 60, 59, 61, 60])!
    expect(statusVs(meanCI([66, 67, 68]), ref)).toBe('Early')
    expect(statusVs(meanCI([66, 67, 68, 66, 67, 68, 67]), ref)).toBe('Clear')
    expect(statusVs(meanCI([56, 66, 58, 65, 57, 64, 60]), ref)).toBe('Possible')
    expect(statusVs(meanCI([59, 61, 60, 60, 59, 61, 60]), ref)).toBe('Normal')
  })
  it('a row per period with n and status against the reference', () => {
    const rhr: Lookup = new Map()
    for (let i = 0; i < 56; i++) rhr.set(add('2026-01-04', i), 58 + (i % 3))
    for (let i = 0; i < 61; i++) rhr.set(add('2026-03-01', i), 63 + (i % 3))
    const t = periodTable(periodsFor([reta], '2026-11-12'), { rhr }, { from: '2026-01-04', to: '2026-02-28' }, () => true, [HEART_METRICS[0]])
    const two = t.rows.find((r) => r.period.label === 'Retatrutide 2 mg')!
    expect(two.cells.rhr.stat!.n).toBe(61)
    expect(two.cells.rhr.status).toBe('Clear')
    expect(Math.round(two.cells.rhr.diff!)).toBe(5)
    expect(t.rows.find((r) => r.period.label === 'Retatrutide 6 mg')!.cells.rhr.status).toBe('Early')
  })
})

describe('around each dose change', () => {
  it('increases and decreases, not starts and stops', () => {
    expect(doseChanges([reta, bpc], '2026-11-12').map((c) => [c.date, c.from, c.to, c.up])).toEqual([
      ['2026-05-01', '2 mg', '4 mg', true], ['2026-07-01', '4 mg', '6 mg', true], ['2026-08-01', '6 mg', '4 mg', false],
    ])
  })
  it('14 nights before, 14 after, then weeks 3 to 6', () => {
    const wake: Lookup = new Map()
    for (let i = -20; i < 50; i++) wake.set(add('2026-05-01', i), i < 0 ? 1 : i < 14 ? 3 : 2)
    const w = changeWindows('2026-05-01', wake)
    expect([w.before!.n, w.after!.n, w.settle!.n]).toEqual([14, 14, 28])
    expect([w.before!.mean, w.after!.mean, w.settle!.mean]).toEqual([1, 3, 2])
  })
})

describe('days since the injection', () => {
  const dayMs = 86400000
  const doses = Array.from({ length: 10 }, (_, i) => Date.parse('2026-08-03T08:00:00Z') + i * 7 * dayMs)
  const bedtimes = new Map<string, number>()
  const wake: Lookup = new Map()
  for (let i = 0; i < 70; i++) {
    const d = add('2026-08-04', i)
    bedtimes.set(d, Date.parse(`${add(d, -1)}T13:00:00Z`))
    const k = Math.floor((Date.parse(`${add(d, -1)}T13:00:00Z`) - Date.parse('2026-08-03T08:00:00Z')) / dayMs) % 7
    wake.set(d, k === 1 ? 3 : 1.5)
  }
  it('bins day 0 to 6 and says which day is highest, only with 6 nights in every bin', () => {
    const r = sinceDose({ weekly: true, doses, bedtimes, lookup: wake })
    expect(r.bins.map((b) => b.stat?.n)).toEqual([10, 10, 10, 10, 10, 10, 10])
    expect(r.ok).toBe(true)
    expect(sinceDoseAnswer('Wake-ups are', r, true)).toBe('Wake-ups are highest 1 day after your injection (3.0, against 1.5 the rest of the week).')
    const few = sinceDose({ weekly: true, doses, bedtimes: new Map([...bedtimes].slice(0, 20)), lookup: wake })
    expect(few.ok).toBe(false)
    expect(sinceDoseAnswer('Wake-ups are', few, true)).toBe('Needs 6 nights in every day since a dose.')
  })
  it('dosed more often: 12-hour bins', () => {
    const r = sinceDose({ weekly: false, doses: [Date.parse('2026-08-03T08:00:00Z')], bedtimes: new Map([['2026-08-04', Date.parse('2026-08-03T13:00:00Z')]]), lookup: new Map([['2026-08-04', 2]]) })
    expect(r.bins.map((b) => b.label)).toEqual(['0 to 12 h', '12 to 24 h', '24 to 36 h', '36 to 48 h'])
    expect(r.bins[0].stat).toBeNull() // one night is not a mean
  })
})

describe('other things that changed', () => {
  it('one line per period: other compounds, sauna, alcohol, sedatives, weight', () => {
    const p = periodsFor([reta], '2026-11-12').find((x) => x.label === 'Retatrutide 4 mg')!
    const line = contextLine(p, {
      events: [{ date: '2026-06-10', compoundId: 'bpc', name: 'BPC-157', kind: 'start', dose: '250 mcg' }, { date: '2026-05-01', compoundId: 'reta', name: 'Retatrutide', kind: 'change', dose: '4 mg' }],
      sauna: ['2026-05-03', '2026-05-10', '2026-08-02'],
      alcohol: ['2026-05-04', '2026-05-04', '2026-06-01'],
      sedatives: [{ date: '2026-05-05', name: 'Temazepam' }, { date: '2026-05-06', name: 'Temazepam' }],
      weights: [{ date: '2026-05-01', value: 100 }, { date: '2026-05-15', value: 99 }, { date: '2026-05-29', value: 98 }],
    }, { sauna: 1 })
    expect(line).toBe('Also in this period: BPC-157 started at 250 mcg 10 Jun; sauna 0.2 a week (reference 1); alcohol on 2 of 122 days; Temazepam on 2 nights; weight down 0.5 kg a week.')
    expect(slopePerWeek([{ date: '2026-05-01', value: 100 }, { date: '2026-05-03', value: 99 }, { date: '2026-05-05', value: 98 }])).toBeNull()
  })
})

describe('adjusted comparison', () => {
  const fit = (X: number[][], y: number[]) => ({ coef: X[0].map(() => 1), intercept: y.length ? 50 : 0, ci: X[0].map(() => ({ lo: 0, hi: 2 })) })
  it('locked under 60 nights; from 60, each period at the average of everything else', () => {
    const rows = Array.from({ length: 59 }, (_, i) => ({ date: add('2026-01-01', i), period: i < 30 ? 'before' : 'p1', y: 60, conf: [i % 2] }))
    expect(adjustedPeriods(rows, ['before', 'p1'], fit)).toEqual({ locked: true, have: 59 })
    const more = [...rows, { date: '2026-03-01', period: 'p1', y: 61, conf: [1] }]
    const r = adjustedPeriods(more, ['before', 'p1'], fit)
    expect(r.locked).toBe(false)
    if (!r.locked) {
      expect(r.n).toBe(60)
      expect(r.values.before.adj).toBeCloseTo(50.5, 6) // intercept + conf mean
      expect(r.values.p1.adj).toBeCloseTo(51.5, 6)
    }
  })
})

describe('a switch from one compound to another', () => {
  it('offered when one stops and another starts within 14 days; not once recorded or dismissed', () => {
    const c = switchCandidates([reta, tirz, bpc], '2026-11-12')
    expect(c.map((x) => [x.from, x.to, x.date])).toEqual([['reta', 'tirz', '2026-10-06']])
    expect(switchCandidates([reta, tirz], '2026-11-12', [{ from: 'reta', to: 'tirz' }])).toEqual([])
    expect(switchCandidates([reta, tirz], '2026-11-12', [], ['reta>tirz'])).toEqual([])
    const late = compound('tirz', 'Tirzepatide', [{ date: '2026-11-01', kind: 'start', to: 5, unit: 'mg' }])
    expect(switchCandidates([reta, late], '2026-11-12')).toEqual([])
  })

  it('the old side is the last 4 weeks at the final dose; the transition is left out', () => {
    const w = switchWindows({ id: 's', from: 'reta', to: 'tirz', date: '2026-10-06' }, [reta, tirz], '2026-11-12', 14)
    expect(w.old).toEqual(['2026-09-03', '2026-09-30'])
    expect(w.oldDose).toBe('4 mg')
    expect(w.transition).toEqual(['2026-10-06', '2026-10-19'])
    expect(w.new).toEqual(['2026-10-20', '2026-11-12'])
    expect(switchWindows({ id: 's', from: 'reta', to: 'tirz', date: '2026-10-06' }, [reta, tirz], '2026-11-12', 0).new[0]).toBe('2026-10-06')
  })

  it('counts each side, Early until both have 21 nights, and words the answer without dose equivalence', () => {
    const rhr: Lookup = new Map()
    const wake: Lookup = new Map()
    for (const d of ['2026-09-03', '2026-09-10', '2026-09-20', '2026-09-30']) { rhr.set(d, 66); wake.set(d, 3) }
    for (let i = 0; i < 24; i++) { rhr.set(add('2026-10-20', i), 62); wake.set(add('2026-10-20', i), 1.5) }
    const w = { old: ['2026-09-03', '2026-09-30'] as [string, string], new: ['2026-10-20', '2026-11-12'] as [string, string] }
    const r = switchCompare(w, { rhr, wakeUps: wake }, HEART_METRICS.slice(0, 3))
    expect([r.nBefore, r.nAfter, r.early]).toEqual([4, 24, true])
    expect(r.rows.find((x) => x.key === 'rhr')).toMatchObject({ diff: -4, tone: 'better' })
    const a = switchAnswer('tirzepatide', r.rows, { before: -0.8, after: -0.5 })
    expect(a).toBe('On tirzepatide so far: resting HR 4 lower, 1.5 fewer wake-ups a night, weight loss 0.3 kg a week slower.')
    for (const s of [a, NO_EQUIVALENCE, HEART_INFO]) expect(s).not.toMatch(/\bequivalent to\b|same as \d|caused|you should/i)
    expect(NO_EQUIVALENCE).toMatch(/not equivalent/)
  })
})

describe('what came through from Health', () => {
  it('the earliest date per kind of data and the nights with stages', () => {
    const c = historyCoverage(
      [{ date: '2024-11-01', restingHR: 60 }, { date: '2025-01-01', restingHR: 61, hrvOvernight: 50, respRate: 14 }, { date: '2025-02-01', spo2: 96 }],
      [{ date: '2024-11-02' }, { date: '2025-01-02', hasStages: true, overnight: { hr: [[0, 60]] } }],
    )
    expect(Object.fromEntries(c.rows.map((r) => [r.key, r.first]))).toEqual({ sleep: '2024-11-02', stages: '2025-01-02', sleepHR: '2025-01-02', restingHR: '2024-11-01', hrv: '2025-01-01', resp: '2025-01-01', spo2: '2025-02-01' })
    expect([c.stageNights, c.nights]).toEqual([1, 2])
  })
})
