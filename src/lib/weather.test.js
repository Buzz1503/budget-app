import { describe, it, expect } from 'vitest'
import { overnightFromHourly, weatherRequests, fetchOvernight } from './weather'

const hourly = (dates, valueOf) => {
  const time = []
  const temperature_2m = []
  for (const d of dates) for (let h = 0; h < 24; h++) { time.push(`${d}T${String(h).padStart(2, '0')}:00`); temperature_2m.push(valueOf(d, h)) }
  return { time, temperature_2m }
}

describe('overnight outside temperature', () => {
  it('a night is 9 pm the evening before to 6 am on its date: average and minimum', () => {
    const h = hourly(['2026-11-10', '2026-11-11'], (d, hr) => (hr >= 21 ? 22 : hr <= 6 ? 18 + hr / 6 : 28))
    const out = overnightFromHourly(h.time, h.temperature_2m)
    // 3 hours at 22 C, then 0 to 6 am from 18 to 19 C
    expect(out['2026-11-11']).toEqual({ avgC: 19.6, minC: 18 })
    // the night of the 10th has no evening before in this data, so it is not counted
    expect(out['2026-11-10']).toBeUndefined()
  })
  it('missing hours mean no value for that night', () => {
    const h = hourly(['2026-11-10', '2026-11-11'], (d, hr) => (d === '2026-11-11' && hr === 3 ? null : 20))
    expect(overnightFromHourly(h.time, h.temperature_2m)['2026-11-11']).toBeUndefined()
  })
})

describe('requests and the cache', () => {
  it('archive for older nights in yearly chunks, the forecast for the last few, only what is missing', () => {
    const nights = ['2025-01-10', '2025-06-01', '2026-03-01', '2026-11-09', '2026-11-11', '2026-11-12']
    const reqs = weatherRequests({ lat: -27.6, lon: 153.12, nights, cached: { '2025-06-01': { avgC: 15 } }, today: '2026-11-12' })
    expect(reqs).toHaveLength(3)
    expect(reqs[0]).toContain('archive-api.open-meteo.com/v1/archive?latitude=-27.6&longitude=153.12&hourly=temperature_2m&timezone=auto&start_date=2025-01-09&end_date=2025-01-10')
    expect(reqs[1]).toContain('start_date=2026-02-28&end_date=2026-03-01')
    expect(reqs[2]).toContain('api.open-meteo.com/v1/forecast?')
    expect(reqs[2]).toContain('past_days=7')
    expect(weatherRequests({ lat: 1, lon: 2, nights: ['2026-11-11'], cached: { '2026-11-11': { avgC: 20 } }, today: '2026-11-12' })).toEqual([])
  })
  it('fetches, keeps the nights asked for, and fails quietly offline', async () => {
    const body = { hourly: hourly(['2026-11-10', '2026-11-11'], (d, hr) => (hr >= 21 || hr <= 6 ? 20 : 30)) }
    const calls = []
    const ok = async (url) => { calls.push(url); return { ok: true, json: async () => body } }
    const got = await fetchOvernight({ lat: -27.6, lon: 153.12, nights: ['2026-11-11'], cached: {}, today: '2026-11-12', fetchFn: ok })
    expect(got['2026-11-11'].avgC).toBe(20)
    expect(got['2026-11-11'].minC).toBe(20)
    expect(calls).toHaveLength(1)
    // only a position and dates go out
    expect(calls[0]).not.toMatch(/bpm|hrv|sleep|heart/i)
    const offline = async () => { throw new Error('offline') }
    await expect(fetchOvernight({ lat: -27.6, lon: 153.12, nights: ['2026-11-11'], cached: {}, today: '2026-11-12', fetchFn: offline })).resolves.toEqual({})
    const refused = async () => ({ ok: false })
    await expect(fetchOvernight({ lat: -27.6, lon: 153.12, nights: ['2026-11-11'], cached: {}, today: '2026-11-12', fetchFn: refused })).resolves.toEqual({})
  })
})
