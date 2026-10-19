import { describe, it, expect } from 'vitest'
import {
  trackedEvents, groupEvents, buildPhases, describeChanges, wobble, bodyRate, dailyMean,
  changeLabel, metricRow, fullSentence, rowSentence, phaseViews, defaultTrackEffects, tracksEffects,
} from './phases'
import type { TrackedCompound, Point, Phase } from './phases'
import { PHASES } from './config'
import { addDays, dateRange } from '../tz'

const T = '2026-10-19'
const reta = (points: TrackedCompound['points'], extra: Partial<TrackedCompound> = {}): TrackedCompound =>
  ({ id: 'retatrutide', name: 'Reta', points, ...extra })

describe('which compounds are tracked', () => {
  it('on by default for baseline compounds and the catalogue list, never for others unless switched on', () => {
    expect(defaultTrackEffects({ id: 'retatrutide', name: 'Retatrutide' })).toBe(true)
    expect(defaultTrackEffects({ id: 'tesamorelin', name: 'Tesamorelin' })).toBe(true)
    expect(defaultTrackEffects({ id: 'motsc', name: 'MOTS-c' })).toBe(true)
    expect(defaultTrackEffects({ id: 'x', name: 'CJC-1295 no DAC' })).toBe(true)
    expect(defaultTrackEffects({ id: 'bpc157', name: 'BPC-157' })).toBe(false)
    expect(tracksEffects({ id: 'bpc157', name: 'BPC-157', points: [], trackEffects: true })).toBe(true)
    expect(tracksEffects({ id: 'motsc', name: 'MOTS-c', points: [], trackEffects: false })).toBe(false)
  })
})

describe('phase boundaries', () => {
  it('changes within 7 days of each other merge into one boundary', () => {
    const g = groupEvents([{ date: '2026-09-01' }, { date: '2026-09-08' }, { date: '2026-09-16' }])
    expect(g.map((x) => [x.date, x.events.length])).toEqual([['2026-09-01', 2], ['2026-09-16', 1]])
  })

  it('reads starts, dose changes and stops from the timeline', () => {
    const ev = trackedEvents([reta([
      { date: '2026-08-01', kind: 'start', to: 1.5, unit: 'mg' },
      { date: '2026-09-01', kind: 'step-up', to: 2, unit: 'mg' },
      { date: '2026-09-02', kind: 'skip' },
      { date: '2026-10-01', kind: 'stop' },
    ])])
    expect(ev.map((e) => [e.kind, e.dose])).toEqual([['start', '1.5 mg'], ['change', '2 mg'], ['stop', null]])
    expect(describeChanges(ev)).toBe('Started Reta 1.5 mg; Reta to 2 mg; Stopped Reta')
  })

  it('a first phase "Before tracking" runs from the first data to the first boundary, the last to today', () => {
    const ev = trackedEvents([reta([{ date: '2026-09-01', kind: 'start', to: 1.5, unit: 'mg' }])])
    const ph = buildPhases(ev, '2026-07-01', T)
    expect(ph.map((p) => [p.title, p.from, p.to])).toEqual([
      ['Before tracking', '2026-07-01', '2026-08-31'],
      ['Started Reta 1.5 mg', '2026-09-01', T],
    ])
  })

  it('a phase can be a single day long, and is then too early', () => {
    const ev = trackedEvents([reta([{ date: T, kind: 'start', to: 1, unit: 'mg' }])])
    const ph = buildPhases(ev, '2026-07-01', T)
    expect(ph.at(-1)).toMatchObject({ from: T, to: T, days: 1 })
    const weight = dateRange('2026-07-01', T).map((d, i) => ({ date: d, value: 95 - i * 0.02 }))
    const row = metricRow('weight', weight, ph.at(-1) as Phase, ph[0], 0.6)
    expect(row.label).toBe('Too early')
  })

  it('carries the combined-change note when a boundary merged two or more changes', () => {
    const ev = trackedEvents([
      reta([{ date: '2026-09-01', kind: 'start', to: 1.5, unit: 'mg' }]),
      { id: 'teste', name: 'Test E', points: [{ date: '2026-09-05', kind: 'start', to: 60, unit: 'mg' }] },
    ])
    const ph = buildPhases(ev, '2026-07-01', T)
    expect(ph).toHaveLength(2)
    expect(ph[1].title).toBe('Started Reta 1.5 mg, Test E 60 mg')
    expect(ph[1].combined).toBe(true)
    expect(ph[1].combinedNote).toBe('These changes started together. This shows their combined effect and cannot be split by compound.')
    expect(ph[0].combined).toBe(false)
  })
})

describe('rates, averages and gating', () => {
  const phase = (from: string, to: string) => ({ from, to, days: dateRange(from, to).length })

  it('slope per week from sparse readings', () => {
    // 4 readings over 21 days, falling exactly 0.1 kg a day
    const pts: Point[] = [0, 6, 13, 20].map((i) => ({ date: addDays('2026-09-01', i), value: 90 - i * 0.1 }))
    const r = bodyRate(pts, phase('2026-09-01', '2026-09-21'))
    expect(r.ok).toBe(true)
    expect(r.value).toBeCloseTo(-0.7, 6)
  })

  it('body metrics need 14 days and 4 readings; daily metrics 10 days with data', () => {
    const pts: Point[] = dateRange('2026-09-01', '2026-09-13').map((d) => ({ date: d, value: 90 }))
    expect(bodyRate(pts, phase('2026-09-01', '2026-09-13')).ok).toBe(false) // 13 days
    const three = [0, 7, 14].map((i) => ({ date: addDays('2026-09-01', i), value: 90 }))
    expect(bodyRate(three, phase('2026-09-01', '2026-09-20')).ok).toBe(false) // 3 readings
    const nine = dateRange('2026-09-01', '2026-09-09').map((d) => ({ date: d, value: 60 }))
    expect(dailyMean(nine, phase('2026-09-01', '2026-09-30')).ok).toBe(false)
    const ten = dateRange('2026-09-01', '2026-09-10').map((d) => ({ date: d, value: 60 }))
    expect(dailyMean(ten, phase('2026-09-01', '2026-09-30'))).toMatchObject({ ok: true, value: 60, n: 10 })
  })

  it('wobble falls back below 10 points, and is measured around the 7-day average otherwise', () => {
    expect(wobble([{ date: T, value: 90 }], 'weight', T)).toEqual({ value: 0.6, fallback: true })
    expect(wobble([], 'hrv', T)).toEqual({ value: 6, fallback: true })
    const zig = dateRange(addDays(T, -29), T).map((d, i) => ({ date: d, value: 90 + (i % 2 ? 0.5 : -0.5) }))
    const w = wobble(zig, 'weight', T)
    expect(w.fallback).toBe(false)
    expect(w.value).toBeGreaterThan(0.3)
    expect(w.value).toBeLessThan(0.7)
  })
})

describe('change labels and sentences', () => {
  it('thresholds: 2 × wobble is clear, 1 × possible, below that within normal fluctuation', () => {
    expect(changeLabel(1.0, 0.5)).toBe('Clear change')
    expect(changeLabel(-1.0, 0.5)).toBe('Clear change')
    expect(changeLabel(0.99, 0.5)).toBe('Possible change')
    expect(changeLabel(0.5, 0.5)).toBe('Possible change')
    expect(changeLabel(0.49, 0.5)).toBe('Within normal fluctuation')
    expect(PHASES.clearX).toBe(2)
  })

  it('body sentence: rate now against rate before, then the label', () => {
    const row = {
      metric: 'fatMass' as const, kind: 'body' as const,
      now: { ok: true, value: -0.25, n: 10 }, before: { ok: true, value: 0.1, n: 8 },
      magnitude: -1.4, wobble: 0.6, label: 'Clear change' as const, text: '',
    }
    row.text = rowSentence(row)
    expect(fullSentence(row)).toBe('Fat mass: falling 0.25 kg a week (before: rising 0.1 kg a week). Clear change.')
    expect(rowSentence({ ...row, now: { ok: true, value: 0.04, n: 6 } })).toBe('Fat mass: steady (before: rising 0.1 kg a week)')
  })

  it('daily sentence: higher, lower or about the same, never a cause', () => {
    const base = { metric: 'rhr' as const, kind: 'daily' as const, before: { ok: true, value: 59.2, n: 20 } }
    expect(rowSentence({ ...base, now: { ok: true, value: 62.4, n: 12 } })).toBe('Resting heart rate: higher than before, 62 bpm against 59 bpm')
    expect(rowSentence({ ...base, now: { ok: true, value: 59.4, n: 12 } })).toBe('Resting heart rate: about the same as before, 59 bpm against 59 bpm')
    expect(rowSentence({ ...base, now: { ok: false, value: null, n: 4 } })).toBe('Resting heart rate: too early to say (needs 10 days with data in this phase)')
    const all = [rowSentence({ ...base, now: { ok: true, value: 55, n: 12 } })].join(' ')
    expect(all).not.toMatch(/caused|improved|worked/)
  })
})

describe('phase views', () => {
  it('newest phase first, with a clear fall in fat mass after a start', () => {
    const days = dateRange('2026-06-01', T)
    const fat = days.filter((_, i) => i % 2 === 0).map((d) => ({
      date: d, value: d < '2026-08-01' ? 30 + (days.indexOf(d) * 0.01) : 30.6 - (days.indexOf(d) - 61) * 0.05,
    }))
    const views = phaseViews({
      compounds: [reta([{ date: '2026-08-01', kind: 'start', to: 1.5, unit: 'mg' }])],
      series: { fatMass: fat },
      today: T,
    })
    expect(views.map((v) => v.title)).toEqual(['Started Reta 1.5 mg', 'Before tracking'])
    expect(views[0].rows[0]).toMatchObject({ metric: 'fatMass', label: 'Clear change' })
    expect(views[0].rows[0].text).toMatch(/^Fat mass: falling 0\.35 kg a week \(before: rising 0\.07 kg a week\)$/)
    expect(views[1].rows[0].label).toBe('Too early')
  })
})
