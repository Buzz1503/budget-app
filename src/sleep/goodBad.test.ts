import { describe, it, expect } from 'vitest'
import { goodVsBad, goodBadAnswer, benjaminiHochberg, labelFor, normCdf, GOOD_BAD, type GBRow } from './goodBad'
import { outlierReasons, excludedNote, withoutExcluded } from './outliers'
import { autoContext, contextName } from './autoContext'

// a deterministic stream
let seed = 3
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }

const day = (i: number) => new Date(Date.parse('2026-06-01T00:00:00Z') + i * 86400000).toISOString().slice(0, 10)

describe('good and bad nights', () => {
  it('good is 0 or 1 wake-ups, bad 2 or more; nights without stages are left out', () => {
    const rows: GBRow[] = [0, 1, 2, 3, null].map((w, i) => ({ date: day(i), wakeUps: w, binary: { x: i % 2 === 0 }, continuous: {} }))
    const r = goodVsBad(rows)
    expect(r.nGood).toBe(2)
    expect(r.nBad).toBe(2)
    expect(GOOD_BAD.badFrom).toBe(2)
  })

  it('Benjamini-Hochberg at 10%: the step-up rule', () => {
    // m = 5: thresholds 0.02, 0.04, 0.06, 0.08, 0.10
    expect(benjaminiHochberg([0.01, 0.035, 0.07, 0.5, 0.9])).toEqual([true, true, false, false, false])
    // a later p under its threshold carries the earlier ones with it
    expect(benjaminiHochberg([0.03, 0.05, 0.059, 0.5, 0.9])).toEqual([true, true, true, false, false])
    expect(benjaminiHochberg([0.2, 0.3])).toEqual([false, false])
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3)
  })

  it('labels: Early under 10 a side, Clear when it survives, Possible when only the raw interval misses zero', () => {
    expect(labelFor({ nGood: 9, nBad: 40, lo: 0.2, hi: 0.5 }, true)).toBe('Early')
    expect(labelFor({ nGood: 10, nBad: 10, lo: 0.2, hi: 0.5 }, true)).toBe('Clear')
    expect(labelFor({ nGood: 30, nBad: 30, lo: 0.01, hi: 0.4 }, false)).toBe('Possible')
    expect(labelFor({ nGood: 30, nBad: 30, lo: -0.1, hi: 0.4 }, false)).toBeNull()
  })

  it('a strong factor is Clear, noise is not, ranked by size; the answer names what bad nights follow', () => {
    seed = 3
    const rows: GBRow[] = Array.from({ length: 120 }, (_, i) => {
      const inj = i % 7 < 2
      const late = rnd() < 0.3
      const bad = rnd() < (inj ? 0.8 : 0.2) + (late ? 0.15 : 0)
      const noise: Record<string, boolean> = {}
      for (let k = 0; k < 20; k++) noise[`noise${k}`] = rnd() < 0.5
      return { date: day(i), wakeUps: bad ? 3 : 0, binary: { 'injDay12:reta': inj, workoutAfter5: late, ...noise }, continuous: { outsideAvgC: 18 + rnd() * 6 } }
    })
    const r = goodVsBad(rows)
    const top = r.factors[0]
    expect(top.key).toBe('injDay12:reta')
    expect(top.label).toBe('Clear')
    expect(top.bad).toBeGreaterThan(top.good)
    expect(top.lo).toBeGreaterThan(0)
    // the correction keeps chance findings among 20 noise factors from being Clear
    expect(r.factors.filter((f) => f.key.startsWith('noise') && f.label === 'Clear')).toHaveLength(0)
    for (let i = 1; i < r.factors.length; i++) expect(r.factors[i - 1].size).toBeGreaterThanOrEqual(r.factors[i].size)
    const phrase = (k: string) => ({ 'injDay12:reta': 'Reta injection days 1 to 2', workoutAfter5: 'late workouts' }[k] || k)
    expect(goodBadAnswer(r, phrase)).toMatch(/^Bad nights more often follow Reta injection days 1 to 2/)
    expect(goodBadAnswer({ nGood: 4, nBad: 30, factors: [] }, phrase)).toBe('Early: needs 10 good and 10 bad nights.')
  })
})

describe('automatic context', () => {
  const H = 3600000
  const tzHour = (ms: number) => ((ms / H) + 10) % 24 // Brisbane, UTC+10
  // night of 2 Jun: bed 10:30 pm on 1 Jun local (12:30 UTC), wake 6:30 am
  const bed = Date.parse('2026-06-01T12:30:00Z')
  const nights = Array.from({ length: 15 }, (_, i) => ({ date: day(i + 1), start: bed + i * 24 * H + (i === 14 ? 2 * H : 0), end: bed + i * 24 * H + 8 * H, respRate: i === 14 ? 17.5 : 15 }))
  const base = {
    nights, hourOf: tzHour, sauna: [], wristTemp: new Map(Array.from({ length: 15 }, (_, i) => [day(i + 1), i === 14 ? 35.9 : 35.3] as [string, number])),
    weather: { [day(15)]: { avgC: 21.4, minC: 18.2 } },
    compounds: [{ id: 'reta', name: 'Retatrutide' }],
  }
  it('late workout after 5 pm, sauna within 3 h of bed, consistency minutes, breathing and wrist temperature against baseline', () => {
    const last = nights[14]
    const r = autoContext({
      ...base,
      workouts: [{ start: last.start - 4 * H, end: last.start - 3.5 * H, type: 'Strength', title: 'Traditional Strength Training' }, { start: last.start - 10 * H, end: last.start - 9 * H, type: 'Walking' }],
      sauna: [{ date: day(14), end: last.start - 2 * H }],
      doses: [{ compoundId: 'reta', t: last.start - 26 * H }],
    }).get(day(15))!
    expect(r.binary.workoutAfter5).toBe(true)
    expect(r.line[0]).toMatch(/^Traditional Strength Training ended 9:00 pm$/)
    expect(r.binary.saunaNearBed).toBe(true)
    expect(r.continuous.bedOffMin).toBe(120)
    expect(r.continuous.respDev).toBe(2.5)
    expect(r.continuous.wristTempDev).toBe(0.6)
    expect(r.continuous.outsideAvgC).toBe(21.4)
    expect(r.continuous.outsideMinC).toBe(18.2)
    // the injection was 26 h before bed: day 2, not that day's injection
    expect(r.continuous['daysSince:reta']).toBe(2)
    expect(r.binary['injDay12:reta']).toBe(true)
    expect(r.continuous['injHours:reta']).toBeNull()
  })
  it('a workout ending at 4:59 pm is not late; sauna 3 h 10 m before bed is not near bed', () => {
    const last = nights[14]
    const fiveToFive = Date.parse('2026-06-15T06:59:00Z') // 4:59 pm local
    const r = autoContext({ ...base, workouts: [{ start: fiveToFive - H, end: fiveToFive }], sauna: [{ date: day(14), end: last.start - 3.17 * H }], doses: [] }).get(day(15))!
    expect(r.binary.workoutAfter5).toBe(false)
    expect(r.binary.saunaNearBed).toBe(false)
  })
  it('injection time of day and hours to bed', () => {
    const last = nights[14]
    const morning = Date.parse('2026-06-15T22:00:00Z') - 24 * H // 8 am local on the evening's date
    const r = autoContext({ ...base, workouts: [], doses: [{ compoundId: 'reta', t: morning }] }).get(day(15))!
    expect(r.binary['injMorning:reta']).toBe(true)
    expect(r.binary['injEvening:reta']).toBe(false)
    expect(r.continuous['injHours:reta']).toBe(Math.round(((last.start - morning) / H) * 10) / 10)
    expect(contextName('injDay12:reta', { reta: 'Retatrutide' })).toBe('Retatrutide injection days 1 to 2')
    expect(contextName('why:Reflux or nausea', {})).toBe('Woke: reflux or nausea')
  })
  it('why-I-woke chips are factors on tagged nights only', () => {
    const r = autoContext({ ...base, workouts: [], doses: [], wakeReasons: { [day(15)]: { tags: ['Hot'] } } })
    expect(r.get(day(15))!.binary['why:Hot']).toBe(true)
    expect(r.get(day(15))!.binary['why:Dog']).toBe(false)
    expect(r.get(day(14))!.binary['why:Hot']).toBeUndefined()
  })
})

describe('outlier nights', () => {
  const n = { date: '2026-06-01', asleepMin: 420, bedOffMin: 20, wristTempDev: 0.1, respDev: 0.2, missing: false }
  it('each rule', () => {
    expect(outlierReasons(n)).toEqual([])
    expect(outlierReasons({ ...n, wristTempDev: 0.5 })).toEqual(['illness'])
    expect(outlierReasons({ ...n, respDev: 2 })).toEqual(['illness'])
    expect(outlierReasons({ ...n, sick: true })).toEqual(['illness'])
    expect(outlierReasons({ ...n, asleepMin: 239 })).toEqual(['short'])
    expect(outlierReasons({ ...n, bedOffMin: 180 })).toEqual(['bedtime'])
    expect(outlierReasons({ ...n, missing: true })).toEqual(['missing'])
    expect(outlierReasons({ ...n, tzOffsetMin: 600, prevTzOffsetMin: 660 })).toEqual(['travel'])
    expect(outlierReasons({ ...n, away: true })).toEqual(['travel'])
    expect(outlierReasons({ ...n, asleepMin: 200, sick: true })).toEqual(['illness', 'short'])
  })
  it('excluded nights are left out of every list, and the note counts them', () => {
    const rows = [{ date: 'a' }, { date: 'b' }, { date: 'c' }]
    expect(withoutExcluded(rows, { b: { reason: 'short' } }).map((r) => r.date)).toEqual(['a', 'c'])
    expect(excludedNote({ a: 1, b: 1, c: 1 })).toBe('3 nights excluded')
    expect(excludedNote({})).toBeNull()
  })
})
