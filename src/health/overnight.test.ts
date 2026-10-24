import { describe, it, expect } from 'vitest'
import {
  inBedStart, onsetLatency, waso, nightHeartRate, hrvHalves, nightSpo2, nightBreathing, breathingElevated,
  audioInBed, hrDip, morningLight, buildOvernight,
} from './overnight'
import type { SleepSegment, RawSleep, RawQuantity } from './types'

const T0 = Date.parse('2026-10-20T12:00:00Z') // 11 pm Sydney
const m = (min: number) => T0 + min * 60000
const seg = (a: number, b: number, stage: SleepSegment['stage']): SleepSegment => ({ start: m(a), end: m(b), stage })
const q = (min: number, value: number, len = 0): RawQuantity => ({ start: m(min), end: m(min + len), value })

// in bed at 0, awake 0-20, asleep 20-200, awake 200-212, asleep 212-300, awake 300-303, asleep 303-420, awake 420-425
const segments = [seg(0, 20, 'awake'), seg(20, 200, 'core'), seg(200, 212, 'awake'), seg(212, 300, 'deep'), seg(300, 303, 'awake'), seg(303, 420, 'rem'), seg(420, 425, 'awake')]

describe('falling asleep and waking in the night', () => {
  it('latency is from in bed to the first sleep, and in-bed samples from the iPhone count', () => {
    expect(onsetLatency(segments, m(0))).toBe(20)
    const raw: RawSleep[] = [{ start: m(-15), end: m(5), stage: 'inBed', sourceName: 'iPhone' }]
    const bed = inBedStart(raw, { start: m(0), end: m(425) })
    expect(bed).toBe(m(-15))
    expect(onsetLatency(segments, bed)).toBe(35)
    expect(onsetLatency([], m(0))).toBeNull()
    expect(onsetLatency([seg(240, 300, 'core')], m(0))).toBeNull() // 4 h is a gap, not latency
  })

  it('WASO counts awake minutes between first sleep and final wake, and awakenings over 5 min', () => {
    expect(waso(segments)).toEqual({ minutes: 15, awakenings: 1 })
    // two touching awake samples are one awakening
    const touching = [seg(0, 60, 'core'), seg(60, 63, 'awake'), seg(63, 67, 'awake'), seg(67, 120, 'core')]
    expect(waso(touching)).toEqual({ minutes: 7, awakenings: 1 })
    expect(waso([seg(0, 10, 'awake')])).toBeNull()
  })
})

describe('heart rate, HRV, oxygen and breathing', () => {
  it('heart rate a minute, sensor gaps dropped', () => {
    const hr = [q(1, 60), q(1.5, 62), q(5, 55), q(6, 20), q(500, 70)]
    expect(nightHeartRate(hr, m(0), m(425))).toEqual([[1, 61], [5, 55]])
  })

  it('HRV first and second half', () => {
    const hrv = [q(30, 40), q(100, 50), q(250, 70), q(400, 60)]
    expect(hrvHalves(hrv, m(0), m(425))).toEqual({ first: 45, second: 65 })
    expect(hrvHalves([], m(0), m(425))).toEqual({ first: null, second: null })
  })

  it('every SpO2 reading in the night, nonsense dropped', () => {
    expect(nightSpo2([q(10, 96), q(100, 88.44), q(200, 30), q(900, 95)], m(0), m(425))).toEqual([[10, 96], [100, 88.4]])
  })

  it('breathing disturbances and Apple\'s own call when present', () => {
    const b = [{ ...q(430, 3.2), meta: { HKMetadataKeyClassification: 'Not Elevated' } }]
    expect(nightBreathing(b, m(0), m(425))).toBe(3.2)
    expect(breathingElevated(b, m(0), m(425))).toBe(false)
    expect(breathingElevated([{ ...q(430, 12), meta: { c: 'Elevated' } }], m(0), m(425))).toBe(true)
    expect(breathingElevated([q(430, 12)], m(0), m(425))).toBeNull()
    expect(nightBreathing([], m(0), m(425))).toBeNull()
  })

  it('heart rate dip against the day', () => {
    expect(hrDip(54, 72)).toBe(25)
    expect(hrDip(null, 72)).toBeNull()
  })
})

describe('audio in bed and light in the morning', () => {
  it('minutes after getting into bed, minutes after falling asleep, when it stopped, level', () => {
    const phones = [{ start: m(-30), end: m(10), value: 50 }, { start: m(10), end: m(45), value: 60 }]
    const a = audioInBed(phones, m(0), m(20), m(425))!
    expect(a).toMatchObject({ minutesInBed: 45, minutesAfterSleep: 25, stoppedAt: m(45) })
    expect(a.avgDb).toBeCloseTo((50 * 10 + 60 * 35) / 45, 1)
    expect(audioInBed([{ start: m(-90), end: m(-60), value: 50 }], m(0), m(20), m(425))).toBeNull()
  })

  it('daylight before 10 am, pro rata for a sample across 10 am', () => {
    const day = Date.parse('2026-10-20T13:00:00Z') // local midnight, Sydney summer time
    const s = (h: number, len: number, value: number): RawQuantity => ({ start: day + h * 3600000, end: day + h * 3600000 + len * 60000, value })
    expect(morningLight([s(7, 20, 20), s(9.5, 60, 60), s(15, 30, 30)], day)).toBe(50)
    expect(morningLight([], day)).toBeNull()
  })
})

describe('a whole night', () => {
  it('is built from what was recorded, the rest null', () => {
    const o = buildOvernight({
      night: { start: m(0), end: m(425), segments }, raw: [], hr: [q(5, 55)], hrv: [], spo2: [], breathing: [], resp: [q(100, 14)], headphone: [],
    })
    expect(o).toMatchObject({ inBedStart: m(0), latencyMin: 20, wasoMin: 15, awakenings: 1, hr: [[5, 55]], hrvFirst: null, spo2: [], breathing: null, breathingElevated: null, respRate: 14, audio: null })
  })
})
