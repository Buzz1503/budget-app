import { describe, it, expect } from 'vitest'
import { stopBang, likelihood, signals, APNEA_LABEL } from './apnea'
import type { StopBangInput } from './apnea'
import { spo2Night } from './oxygen'
import { detectEvents, rateNight, agreement, truthOf, calibrate, logisticFit, NIGHTMARES } from './nightmares'
import type { SleepSegment } from '../health/types'

const base = (over: Partial<StopBangInput> = {}): StopBangInput => ({
  soundNights: [], morning: [], bp: [], weightKg: null, heightCm: null, age: null, neckCm: null, sex: null, overrides: {}, ...over,
})

describe('STOP-BANG', () => {
  it('is labelled a screen, not a diagnosis', () => {
    expect(APNEA_LABEL).toMatch(/^Screen, not a diagnosis\./)
  })

  it('maps each item from the data, with its source', () => {
    const r = stopBang(base({
      soundNights: Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${10 + i}`, snoringMin: i < 4 ? 25 : 2, lowConfidence: false })),
      morning: Array.from({ length: 14 }, (_, i) => ({ date: `d${i}`, rested: (i < 8 ? 2 : 4) as 2 | 4, partner: i === 3 ? 'stopped' as const : 'nothing' as const })),
      bp: [{ sys: 142, dia: 86 }, { sys: 140, dia: 88 }],
      weightKg: 110, heightCm: 175, age: 36, neckCm: 42, sex: 'male',
    }))
    const by = Object.fromEntries(r.items.map((i) => [i.key, i]))
    expect(by.snoring).toMatchObject({ answer: true, source: 'Sleep sounds: snoring on 4 of 10 recorded nights (40%)' })
    expect(by.tired).toMatchObject({ answer: true, source: 'Morning check: rested 2 or less on 8 of the last 14 answered mornings' })
    expect(by.observed.answer).toBe(true)
    expect(by.pressure).toMatchObject({ answer: true, source: 'Blood pressure 30-day average 141/87 (2 readings)' })
    expect(by.bmi.answer).toBe(true) // 35.9
    expect(by.age.answer).toBe(false)
    expect(by.neck.answer).toBe(true)
    expect(by.male.answer).toBe(true)
    expect(r.score).toBe(7)
    expect(r.band).toBe('high')
  })

  it('phone-in-bed nights are left out of snoring; unknowns stay unknown', () => {
    const r = stopBang(base({ soundNights: [{ date: 'a', snoringMin: 60, lowConfidence: true }] }))
    const s = r.items.find((i) => i.key === 'snoring')!
    expect(s.answer).toBeNull()
    expect(r.known).toBe(0)
    expect(r.band).toBe('low')
  })

  it('a hand-set answer wins and says so', () => {
    const r = stopBang(base({ age: 36, overrides: { age: true, pressure: false } }))
    const age = r.items.find((i) => i.key === 'age')!
    expect(age).toMatchObject({ answer: true, overridden: true })
    expect(age.source).toBe('Set by you (age 36, from Health)')
    expect(r.items.find((i) => i.key === 'pressure')!.answer).toBe(false)
  })

  it('bands: 0 to 2 low, 3 to 4 intermediate, 5 to 8 high', () => {
    const with_ = (n: number) => stopBang(base({ overrides: Object.fromEntries(['snoring', 'tired', 'observed', 'pressure', 'bmi', 'age', 'neck', 'male'].slice(0, n).map((k) => [k, true])) })).band
    expect([0, 2, 3, 4, 5, 8].map(with_)).toEqual(['low', 'low', 'intermediate', 'intermediate', 'high', 'high'])
  })
})

describe('likelihood', () => {
  it('follows the band, raised one level by elevated breathing or SpO2 dips on over 25% of nights', () => {
    const none = { elevatedNights: 0, breathingNights: 20, dipNights: 0, spo2Nights: 20 }
    expect(likelihood('low', none).level).toBe('Low')
    expect(likelihood('intermediate', none).level).toBe('Moderate')
    const breathing = likelihood('low', { ...none, elevatedNights: 6 })
    expect(breathing).toMatchObject({ level: 'Moderate', raised: true })
    expect(breathing.reasons[1]).toBe("Apple's breathing disturbances were elevated on 6 of 20 nights")
    expect(likelihood('low', { ...none, elevatedNights: 5 }).level).toBe('Low') // exactly 25% is not more than
    expect(likelihood('intermediate', { ...none, dipNights: 7 }).level).toBe('High')
    expect(likelihood('high', { ...none, dipNights: 20, elevatedNights: 20 }).level).toBe('High')
  })
})

describe('blood oxygen', () => {
  it('lowest, share below 90%, and dips of 3 points below the night\'s median', () => {
    const r = spo2Night([[0, 96], [40, 95], [80, 96], [120, 92], [160, 89], [200, 96]])
    expect(r).toMatchObject({ readings: 6, lowest: 89, pctBelow90: 16.7, dips: 2, median: 95.5 })
    expect(spo2Night([])).toMatchObject({ readings: 0, lowest: null, dips: 0 })
  })

  it('the signals panel pools the nights', () => {
    const s = signals([
      { date: 'a', breathing: 3, elevated: false, spo2: { readings: 10, lowest: 91, pctBelow90: 0, dips: 0 }, snoringMin: 20, lowConfidence: false, awakenings: 2, morning: { headache: true, pee: 1 } },
      { date: 'b', breathing: 9, elevated: true, spo2: { readings: 10, lowest: 87, pctBelow90: 20, dips: 2 }, snoringMin: 80, lowConfidence: true, awakenings: 4, morning: { dryMouth: true, pee: 2 } },
    ])
    expect(s).toMatchObject({ breathingNights: 2, elevatedNights: 1, spo2Nights: 2, spo2Lowest: 87, spo2PctBelow90: 10, dipNights: 1, snoringMinAvg: 20, awakeningsAvg: 3, headacheMornings: 1, dryMouthMornings: 1, peeAvg: 1.5 })
  })
})

describe('nightmare detection', () => {
  const start = Date.parse('2026-10-23T12:00:00Z')
  const steady = (from: number, to: number, bpm = 55): Array<[number, number]> => Array.from({ length: to - from }, (_, i) => [from + i, bpm])
  const seg = (a: number, b: number, stage: SleepSegment['stage']): SleepSegment => ({ start: start + a * 60000, end: start + b * 60000, stage })

  it('a surge of 15 over the baseline, rising within 2 min and lasting a minute, is an event', () => {
    const hr: Array<[number, number]> = [...steady(0, 120), [120, 60], [121, 74], [122, 78], [123, 76], ...steady(124, 200)]
    const ev = detectEvents({ start, hr })
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ t: start + 121 * 60000, surge: 23, durationMin: 2, rem: false, awakeAfter: false })
    expect(rateNight(ev)).toBe('Unlikely')
  })

  it('REM, waking after and a movement burst score it up to Likely', () => {
    const hr: Array<[number, number]> = [...steady(0, 120), [120, 60], [121, 74], [122, 78], [123, 76], ...steady(124, 200)]
    const movement = new Array(200).fill(0)
    movement[122] = 0.6
    const ev = detectEvents({ start, hr, segments: [seg(100, 121, 'rem'), seg(121, 124, 'core'), seg(124, 128, 'awake')], movement, movementStart: start })
    expect(ev[0]).toMatchObject({ rem: true, awakeAfter: true, movement: true })
    expect(ev[0].score).toBeGreaterThanOrEqual(NIGHTMARES.likely)
    expect(rateNight(ev)).toBe('Likely')
  })

  it('a slow climb, a one-reading blip and a small rise are not events', () => {
    const slow: Array<[number, number]> = [...steady(0, 60), ...Array.from({ length: 30 }, (_, i) => [60 + i, 55 + i] as [number, number])]
    expect(detectEvents({ start, hr: slow })).toHaveLength(0)
    const blip: Array<[number, number]> = [...steady(0, 60), [60, 80], ...steady(61, 100)]
    expect(detectEvents({ start, hr: blip })).toHaveLength(0)
    const small: Array<[number, number]> = [...steady(0, 60), [60, 66], [61, 68], ...steady(62, 100)]
    expect(detectEvents({ start, hr: small })).toHaveLength(0)
  })

  it('agreement with your answers, Nightmare and Vivid as yes', () => {
    expect(truthOf('nightmare')).toBe(true)
    expect(truthOf('vivid')).toBe(true)
    expect(truthOf('normal')).toBe(false)
    expect(truthOf(null)).toBeNull()
    const a = agreement([
      { rating: 'Likely', truth: true }, { rating: 'Unlikely', truth: false }, { rating: 'Possible', truth: false }, { rating: 'Unlikely', truth: null },
    ])
    expect(a).toEqual({ matched: 2, of: 3, text: 'Matched your answer on 2 of 3 nights' })
  })

  it('fits personal thresholds from 10 confirmed nights', () => {
    const ev = (score: number, rem: boolean) => [{ t: 0, surge: 20, durationMin: 2, rem, awakeAfter: rem, movement: false, breathing: false, score }]
    const few = calibrate([{ events: ev(3, true), truth: true }])
    expect(few.personal).toBe(false)
    const nights = [
      ...Array.from({ length: 12 }, () => ({ events: ev(2, true), truth: true })),
      ...Array.from({ length: 12 }, () => ({ events: ev(2, false), truth: false })),
    ]
    const c = calibrate(nights)
    expect(c.personal).toBe(true)
    expect(c.rate(ev(2, true))).toBe('Likely')
    expect(c.rate(ev(2, false))).toBe('Unlikely')
    const f = logisticFit([[0], [0], [1], [1]], [0, 0, 1, 1])
    expect(f.predict([1])).toBeGreaterThan(0.7)
  })
})
