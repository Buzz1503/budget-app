import { describe, it, expect } from 'vitest'
import { wakeUps, awakePeriods, fragmentation, hrSpikes, restlessNight, restlessLine, nightMedianHR } from './restless'

const MIN = 60000
const t0 = Date.parse('2026-11-04T23:00:00Z')
const seg = (fromMin: number, toMin: number, stage: string) => ({ start: t0 + fromMin * MIN, end: t0 + toMin * MIN, stage })

// in bed awake 10 min, then a night with three wake-ups (two touching) and one at the end
const night = [
  seg(0, 10, 'awake'),
  seg(10, 60, 'core'), seg(60, 90, 'deep'), seg(90, 95, 'awake'), seg(95, 96, 'awake'),
  seg(96, 150, 'core'), seg(150, 180, 'rem'), seg(180, 192, 'awake'), seg(192, 300, 'core'),
  seg(300, 303, 'awake'), seg(303, 420, 'rem'), seg(420, 430, 'awake'),
]

describe('wake-ups from Health stages', () => {
  it('counts awake periods after falling asleep, touching ones as one, not before sleep or after the last', () => {
    expect(awakePeriods(night).map((r) => [(r.s - t0) / MIN, (r.e - t0) / MIN])).toEqual([[90, 96], [180, 192], [300, 303]])
    expect(wakeUps(night)).toEqual({ count: 3, awakeMin: 21 })
  })

  it('no sleep, no answer', () => {
    expect(wakeUps([seg(0, 30, 'awake')])).toBeNull()
    expect(wakeUps([])).toBeNull()
  })
})

describe('fragmentation', () => {
  it('stage changes per hour from falling asleep to the final wake', () => {
    // from 10 to 420 min: 410 min; changes between consecutive segments of different stage
    // core>deep>awake(>awake same)>core>rem>awake>core>awake>rem = 8 changes
    expect(fragmentation(night)).toBe(Math.round((8 / (410 / 60)) * 10) / 10)
  })

  it('null for a night without stages', () => {
    expect(fragmentation([seg(0, 400, 'asleep')])).toBeNull()
  })
})

describe('heart rate spikes', () => {
  const flat = Array.from({ length: 60 }, (_, i) => [i, 52] as [number, number])

  it('more than 10 bpm over the night median for 2 minutes or more', () => {
    const hr = flat.map(([m, b]) => [m, m >= 20 && m <= 22 ? 70 : m === 40 ? 75 : b] as [number, number])
    const s = hrSpikes(hr, t0)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ t: t0 + 20 * MIN, peak: 70, above: 18, durationMin: 3 })
    expect(nightMedianHR(hr)).toBe(52)
  })

  it('exactly 10 above is not a spike, and a single minute is too short', () => {
    expect(hrSpikes(flat.map(([m, b]) => [m, m < 5 ? 62 : b] as [number, number]), t0)).toEqual([])
    expect(hrSpikes(flat.map(([m, b]) => [m, m === 7 ? 80 : b] as [number, number]), t0)).toEqual([])
  })

  it('readings a minute or two apart still make one spike', () => {
    const sparse: Array<[number, number]> = [[0, 50], [2, 50], [4, 50], [6, 66], [8, 67], [10, 50], [12, 50]]
    expect(hrSpikes(sparse, t0).map((x) => x.durationMin)).toEqual([3])
  })
})

describe('the summary line', () => {
  it('reads like the app shows it', () => {
    expect(restlessLine({ wakeUps: 4, awakeMin: 21, fragmentation: 6, hrSpikes: 2 })).toBe('Woke 4 times, 21 min awake. 2 heart rate spikes.')
    expect(restlessLine({ wakeUps: 1, awakeMin: 3, fragmentation: 6, hrSpikes: 1 })).toBe('Woke once, 3 min awake. 1 heart rate spike.')
    expect(restlessLine({ wakeUps: 0, awakeMin: 0, fragmentation: null, hrSpikes: 0 })).toBe('No wake-ups. No heart rate spikes.')
    expect(restlessLine({ wakeUps: null, awakeMin: null, fragmentation: null, hrSpikes: null })).toBe('')
  })

  it('all four for a night', () => {
    const hr = Array.from({ length: 400 }, (_, i) => [i, i >= 100 && i <= 103 ? 72 : 54] as [number, number])
    expect(restlessNight({ start: t0, segments: night, overnight: { hr } })).toEqual({ wakeUps: 3, awakeMin: 21, fragmentation: fragmentation(night), hrSpikes: 1 })
  })
})
