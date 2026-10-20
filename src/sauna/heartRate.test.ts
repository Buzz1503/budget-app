import { describe, it, expect } from 'vitest'
import { sessionHeartRate, sessionWindow } from './heartRate'

describe('heart rate for a phone-only sauna session', () => {
  const start = Date.UTC(2026, 9, 20, 18, 0)
  const end = start + 20 * 60000

  it('keeps the samples inside the session, with average and peak', () => {
    const raw = [
      { start: start - 60000, value: 70 },
      ...Array.from({ length: 25 }, (_, i) => ({ start: start + i * 45000, value: 100 + i })),
      { start: end + 60000, value: 80 },
    ]
    const hr = sessionHeartRate(raw, start, end)
    expect(hr.samples).toHaveLength(25)
    expect(hr.samples[0]).toEqual([start / 1000, 100])
    expect(hr.peak).toBe(124)
    expect(hr.sparse).toBe(false)
    expect(hr.from).toBe('health')
  })

  it('is sparse with less than one sample a minute, and empty when there is none', () => {
    const few = Array.from({ length: 6 }, (_, i) => ({ start: start + i * 180000, value: 110 }))
    expect(sessionHeartRate(few, start, end).sparse).toBe(true)
    expect(sessionHeartRate([], start, end)).toMatchObject({ samples: [], avg: null, peak: null, sparse: true })
  })

  it('takes the stored start and end when it has them', () => {
    expect(sessionWindow({ date: '2026-10-20', start: '18:00', lengthMin: 20, startedAt: 1000, endedAt: 2000 })).toEqual([1000, 2000])
    const [a, b] = sessionWindow({ date: '2026-10-20', start: '18:00', lengthMin: 20 })
    expect(b - a).toBe(20 * 60000)
  })
})
