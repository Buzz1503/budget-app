import { describe, it, expect } from 'vitest'
import { compoundEffects, overlapsWith, overlapSentence, cleanWindows, familyForComparison, latestRun, compareWindows } from './compoundEffects'
import { trackedEvents } from './phases'
import type { TrackedCompound } from './phases'
import { addDays, dateRange } from '../tz'

const T = '2026-10-19'
const reta: TrackedCompound = { id: 'reta', name: 'Retatrutide', points: [
  { date: '2026-03-01', kind: 'start', to: 1, unit: 'mg' },
  { date: '2026-05-01', kind: 'step-up', to: 2, unit: 'mg' },
  { date: '2026-08-01', kind: 'step-up', to: 4, unit: 'mg' },
] }
const teste: TrackedCompound = { id: 'teste', name: 'Testosterone E', points: [{ date: '2026-03-05', kind: 'start', to: 60, unit: 'mg' }] }
const motsc: TrackedCompound = { id: 'motsc', name: 'MOTS-c', points: [
  { date: '2026-03-07', kind: 'start', to: 5, unit: 'mg' },
  { date: '2026-05-10', kind: 'step-up', to: 10, unit: 'mg' },
] }
const all = [reta, teste, motsc]

describe('overlap', () => {
  it('finds other tracked compounds that changed within 14 days of the start, and says so plainly', () => {
    const ev = trackedEvents(all)
    const o = overlapsWith(ev, 'reta', '2026-03-01')
    expect(o.map((x) => [x.name, x.offsetDays])).toEqual([['Testosterone E', 4], ['MOTS-c', 6]])
    expect(overlapSentence(o)).toBe('Testosterone E started 4 days after this and MOTS-c 6 days after. Changes in this section are shared with them and cannot be split.')
    expect(overlapsWith(ev, 'reta', '2026-08-01')).toEqual([])
    const same = [{ compoundId: 'a', name: 'MOTS-c', kind: 'start', date: 'x', offsetDays: 0 }, { compoundId: 'b', name: 'Tesamorelin', kind: 'start', date: 'x', offsetDays: 0 }] as const
    expect(overlapSentence([...same])).toBe('MOTS-c and Tesamorelin started on the same day. Changes in this section are shared with them and cannot be split.')
    expect(overlapSentence([])).toBeNull()
  })

  it('15 days apart is not an overlap; 14 is', () => {
    const ev = trackedEvents([reta, { id: 'x', name: 'X', trackEffects: true, points: [{ date: '2026-03-15', kind: 'start', to: 1, unit: 'mg' }] }])
    expect(overlapsWith(ev, 'reta', '2026-03-01')).toHaveLength(1)
    const ev2 = trackedEvents([reta, { id: 'x', name: 'X', trackEffects: true, points: [{ date: '2026-03-16', kind: 'start', to: 1, unit: 'mg' }] }])
    expect(overlapsWith(ev2, 'reta', '2026-03-01')).toHaveLength(0)
  })
})

describe('clean windows', () => {
  it('a dose change with nothing else within 14 days is clean; one near another change is not', () => {
    const ev = trackedEvents(all)
    // 1 May: MOTS-c changed on 10 May (9 days) so not clean; 1 Aug: clean
    const cw = cleanWindows(ev, 'reta', { series: {} }, T)
    expect(cw.map((w) => w.date)).toEqual(['2026-08-01'])
    expect(cw[0].before).toEqual({ from: '2026-07-18', to: '2026-07-31', days: 14 })
    expect(cw[0].after).toEqual({ from: '2026-08-02', to: '2026-08-15', days: 14 })
  })

  it('reads each metric 14 days before against 14 after, with the usual labels', () => {
    const rhr = dateRange('2026-07-01', '2026-08-31').map((d) => ({ date: d, value: d < '2026-08-01' ? 60 + (Number(d.slice(8)) % 2) : 64 + (Number(d.slice(8)) % 2) }))
    const cw = cleanWindows(trackedEvents(all), 'reta', { series: { rhr } }, T)
    expect(cw[0].rows[0]).toMatchObject({ metric: 'rhr', label: 'Clear change' })
    expect(cw[0].rows[0].text).toMatch(/^Resting heart rate: higher than before, 65 bpm against 61 bpm$/)
  })
})

describe('since starting', () => {
  const days = dateRange('2025-10-01', T)
  const weight = days.map((d, i) => ({ date: d, value: d < '2026-03-01' ? 100 : 100 - (i - days.indexOf('2026-03-01')) * 0.05 }))

  it('compares the period before the start with the period on it, labelled and worded as before', () => {
    const fx = compoundEffects(reta, all, { series: { weight } }, T)!
    expect(fx.run).toEqual({ start: '2026-03-01', end: T, ongoing: true })
    expect(fx.before).toEqual({ from: addDays('2026-03-01', -90), to: '2026-02-28', days: 90 })
    const w = fx.rows.find((r) => r.metric === 'weight')!
    expect(w.label).toBe('Clear change')
    expect(w.text).toBe('Weight: falling 0.35 kg a week (before: steady)')
    expect(fx.headline?.metric).toBe('weight')
    expect(fx.overlapText).toMatch(/^Testosterone E started 4 days after this/)
  })

  it('body fat reads one device family on both sides, and says which', () => {
    const evolt = ['2025-12-01', '2026-01-01', '2026-02-01', '2026-02-20', '2026-04-01', '2026-06-01', '2026-08-01', '2026-10-12']
      .map((d, i) => ({ date: d, value: 38 - (d >= '2026-03-01' ? i : 0) * 0.5 }))
    const withings = dateRange('2026-09-01', T).map((d) => ({ date: d, value: 28 }))
    const fam = { bodyFat: { evolt, withings } }
    const on = { from: '2026-03-01', to: T, days: 233 }
    const before = { from: '2025-11-30', to: '2026-02-28', days: 91 }
    expect(familyForComparison(fam.bodyFat, on, before)).toBe('evolt')
    const row = compareWindows('bodyFat', { series: {}, families: fam }, on, before, T)!
    expect(row.family).toBe('evolt')
    // Withings has nothing before the start: never compared against Evolt
    expect(familyForComparison({ withings }, on, before)).toBe('withings')
    expect(compareWindows('bodyFat', { series: {}, families: { bodyFat: { withings } } }, on, before, T)!.label).toBe('Too early')
  })

  it('a compound never started, or started in the future, has no effects page', () => {
    expect(compoundEffects({ id: 'n', name: 'N', points: [] }, all, { series: {} }, T)).toBeNull()
    expect(latestRun(trackedEvents([{ id: 'f', name: 'F', points: [{ date: '2027-01-01', kind: 'start', to: 1, unit: 'mg' }], trackEffects: true }]), 'f', T)).toBeNull()
  })

  it('too little data on either side reads as too early', () => {
    const fx = compoundEffects(reta, all, { series: { rhr: [{ date: '2026-03-10', value: 60 }] } }, T)!
    expect(fx.rows.find((r) => r.metric === 'rhr')?.label).toBe('Too early')
    expect(fx.headline).toBeNull()
  })
})
