import { describe, it, expect } from 'vitest'
import {
  bucketPoints, bucketFor, weekStart, yAxis, labelPlacement, pickLabels, xTicks, groupEvents, rangeChangeWords, MIN_SPAN,
  rangeBounds, rangeChange, lineSegments, mergeScans, nearestPoint, GAP_DAYS, MERGE_DAYS, RANGES, LABEL_SPACING,
} from './chartPoints'
import type { SeriesPoint, LabelBox, PlotPoint } from './chartPoints'

describe('bucketing', () => {
  it('30 days daily, 90 days and 6 months weekly, a year, two years and all time monthly', () => {
    expect(bucketFor('30D')).toBe('day')
    expect(bucketFor('90D')).toBe('week')
    expect(bucketFor('6M')).toBe('week')
    expect(bucketFor('1Y')).toBe('month')
    expect(bucketFor('2Y')).toBe('month')
    expect(bucketFor('All')).toBe('month')
  })

  it('a week runs Monday to Sunday, across a month end, drawn mid-week', () => {
    expect(weekStart('2026-10-04')).toBe('2026-09-28')
    const s: SeriesPoint[] = [
      { date: '2026-09-28', value: 92 }, { date: '2026-09-30', value: 91, sourceLabel: 'Withings' },
      { date: '2026-10-04', value: 90 }, { date: '2026-10-05', value: 89 },
    ]
    const p = bucketPoints(s, 'week', '2026-09-01', '2026-10-19')
    expect(p).toHaveLength(2)
    expect(p[0]).toMatchObject({ x: '2026-10-01', from: '2026-09-28', to: '2026-10-04', value: 91, n: 3 })
    expect(p[0].sources).toEqual(['Manual', 'Withings'])
  })

  it('months average their days and sit on the 15th, or mid-way through the part in range', () => {
    const s: SeriesPoint[] = [{ date: '2026-09-02', value: 90 }, { date: '2026-09-29', value: 92 }, { date: '2026-10-01', value: 88 }]
    const p = bucketPoints(s, 'month', '2026-01-01', '2026-10-19')
    expect(p.map((x) => [x.x, x.from, x.to, x.value])).toEqual([
      ['2026-09-15', '2026-09-01', '2026-09-30', 91], ['2026-10-10', '2026-10-01', '2026-10-31', 88],
    ])
  })

  it('a scan is its own point and stays out of the average', () => {
    const s: SeriesPoint[] = [{ date: '2026-10-06', value: 90 }, { date: '2026-10-07', value: 80, source: 'scan', sourceLabel: 'Scan' }]
    const p = bucketPoints(s, 'week', '2026-09-01', '2026-10-19')
    expect(p.map((x) => [x.x, x.value, x.scan])).toEqual([['2026-10-07', 80, true], ['2026-10-08', 90, false]])
  })
})

describe('y axis', () => {
  it('keeps the minimum span, centred on the data, with 4 or 5 gridlines', () => {
    const a = yAxis([90, 91], MIN_SPAN.weight)
    expect(a.lo).toBeLessThanOrEqual(87.5)
    expect(a.hi).toBeGreaterThanOrEqual(93.5)
    expect(Math.abs((a.lo + a.hi) / 2 - 90.5)).toBeLessThanOrEqual(1)
    expect(a.ticks.length).toBeGreaterThanOrEqual(4)
    expect(a.ticks.length).toBeLessThanOrEqual(5)
  })

  it('a wide range is left as wide as it is', () => {
    const a = yAxis([40, 75], MIN_SPAN.hrv)
    expect(a.lo).toBeLessThanOrEqual(40)
    expect(a.hi).toBeGreaterThanOrEqual(75)
    expect(a.ticks.length).toBeLessThanOrEqual(5)
  })

  it('can start at zero', () => {
    expect(yAxis([20, 92], 1, { zero: true }).lo).toBe(0)
  })
})

describe('value labels', () => {
  it('above when higher than its neighbours on average, else below', () => {
    expect(labelPlacement([1, 3, 2, 0])).toEqual(['below', 'above', 'above', 'below'])
  })

  it('collisions keep first, last, highest and lowest; then scans; otherwise the later label', () => {
    const box = (value: number, x: number, scan = false): LabelBox => ({ x, y: 10, w: 20, h: 10, value, scan })
    // all stacked on one spot: only first, last, highest and lowest survive
    const stacked = [box(5, 0), box(6, 0), box(9, 0), box(2, 0), box(7, 0, true), box(6.5, 0), box(5.5, 0)]
    expect([...pickLabels(stacked)].sort()).toEqual([0, 2, 3, 6])
    // a scan clear of the others is labelled; two scans on top of each other keep the later
    const scans = [box(5, 0), box(6, 100, true), box(6.2, 104, true), box(1, 200), box(9, 300), box(5, 400)]
    const k = pickLabels(scans)
    expect(k.has(2)).toBe(true)
    expect(k.has(1)).toBe(false)
    // two free labels colliding only with each other: the later one stays
    const pair = [box(5, 0), box(6, 100), box(6.1, 110), box(1, 300), box(9, 400), box(5, 500)]
    const kept = pickLabels(pair)
    expect(kept.has(2)).toBe(true)
    expect(kept.has(1)).toBe(false)
  })
})

describe('x axis and pins', () => {
  it('month names for long ranges, short dates otherwise, 4 to 6 of them', () => {
    const long = xTicks('2025-10-20', '2026-10-19')
    expect(long.length).toBeGreaterThanOrEqual(4)
    expect(long.length).toBeLessThanOrEqual(6)
    expect(long[0].label).toMatch(/^[A-Z][a-z]{2}( \d\d)?$/)
    const short = xTicks('2026-09-20', '2026-10-19')
    expect(short).toHaveLength(5)
    expect(short[0].label).toBe('20 Sep')
    expect(short.at(-1)?.label).toBe('19 Oct')
  })

  it('events within 7 days share one pin', () => {
    const g = groupEvents([{ date: '2026-09-10' }, { date: '2026-09-01' }, { date: '2026-09-07' }, { date: '2026-10-01' }])
    expect(g.map((x) => x.events.length)).toEqual([3, 1])
    expect(g[0].date).toBe('2026-09-01')
  })

  it('header change over the range in words', () => {
    const pts = [{ x: 'a', from: 'a', to: 'a', value: 93, n: 1, sources: [], scan: false }, { x: 'b', from: 'b', to: 'b', value: 91, n: 1, sources: [], scan: false }]
    expect(rangeChangeWords(pts, 'kg', 1, '2026-07-22', '2026-10-19')).toBe('down 2.0 kg over 90 days')
    expect(rangeChangeWords(pts, 'kg', 1, '2026-07-22', '2026-10-19', false)).toBe('down 2.0 kg')
  })
})

const pt = (x: string, value: number, scan = false): PlotPoint => ({ x, from: x, to: x, value, n: 1, sources: [], scan })

describe('Since start range and the header change', () => {
  it('Since start runs from the starting date to today and is offered with the other ranges', () => {
    expect(RANGES.map((r) => r.key)).toEqual(['Start', '30D', '90D', '6M', '1Y', '2Y', 'All'])
    expect(rangeBounds('Start', '2026-10-19', [{ date: '2025-06-01', value: 1 }], '2025-01-01')).toEqual({ from: '2025-01-01', to: '2026-10-19' })
    // without a starting point it falls back to the first reading
    expect(rangeBounds('Start', '2026-10-19', [{ date: '2025-06-01', value: 1 }])).toEqual({ from: '2025-06-01', to: '2026-10-19' })
    expect(bucketFor('Start', '2025-01-01', '2026-10-19')).toBe('month')
    expect(bucketFor('Start', '2026-09-01', '2026-10-19')).toBe('week')
  })

  it('Since start compares the latest value with the starting value: down 13.9 kg since 1 Jan 2025', () => {
    const series = [{ date: '2025-03-01', value: 100 }, { date: '2026-10-18', value: 91.7 }]
    const r = rangeChange({ series, from: '2025-01-01', to: '2026-10-19', range: 'Start', startValue: 105.6, startDate: '2025-01-01', unit: 'kg' })
    expect(r.delta).toBeCloseTo(-13.9, 5)
    expect(r.words).toBe('down 13.9 kg since 1 Jan 2025')
  })

  it('any other range compares the first and last reading of the same series, counting the days between them (not 789)', () => {
    const series = [{ date: '2024-08-01', value: 99 }, { date: '2026-08-28', value: 93 }, { date: '2026-10-10', value: 92.4 }]
    const r = rangeChange({ series, from: '2024-01-01', to: '2026-10-19', range: 'All', unit: 'kg' })
    expect(r.words).toBe('down 6.6 kg over 800 days')
    // the window is 30 days wide, so 'over 30 days' must not come from the window width
    const w = rangeChange({ series, from: '2026-09-20', to: '2026-10-19', range: '30D', unit: 'kg' })
    expect(w).toEqual({ delta: null, words: null })
    const two = rangeChange({ series: [...series, { date: '2026-09-25', value: 92.8 }], from: '2026-09-20', to: '2026-10-19', range: '30D', unit: 'kg' })
    expect(two.words).toBe('down 0.4 kg over 15 days')
    expect(rangeChange({ series: [{ date: '2026-10-10', value: 92 }, { date: '2026-10-11', value: 92 }], from: '2026-09-20', to: '2026-10-19', range: '30D' }).words)
      .toBe('about the same over 1 day')
  })
})

describe('connected lines, label spacing, merged scans, scrubbing', () => {
  it('every neighbouring pair is joined; more than 120 days apart is a faint gap, 120 is not', () => {
    expect(GAP_DAYS).toBe(120)
    const segs = lineSegments([pt('2025-01-01', 1), pt('2025-04-30', 2), pt('2025-08-28', 3), pt('2025-12-26', 4)])
    // 2025-01-01 to 2025-04-30 = 119 days; to 2025-08-28 = 120; to 2025-12-26 = 120
    expect(segs).toHaveLength(3)
    expect(segs.map((x) => x.gap)).toEqual([false, false, false])
    const long = lineSegments([pt('2025-01-01', 1), pt('2025-05-02', 2), pt('2025-05-03', 3)])
    expect(long.map((x) => x.gap)).toEqual([true, false])
  })

  it('labels keep first, last, high and low, and the rest are at least 48 px apart', () => {
    expect(LABEL_SPACING).toBe(48)
    const boxes = Array.from({ length: 30 }, (_, i): LabelBox => ({ x: i * 10, y: 0, w: 20, h: 10, value: 90 + Math.sin(i / 3) * 3 }))
    const kept = [...pickLabels(boxes)].sort((a, b) => a - b)
    const vals = boxes.map((b) => b.value)
    for (const must of [0, 29, vals.indexOf(Math.max(...vals)), vals.indexOf(Math.min(...vals))]) expect(kept).toContain(must)
    const extra = kept.filter((i) => ![0, 29, vals.indexOf(Math.max(...vals)), vals.indexOf(Math.min(...vals))].includes(i))
    for (const i of extra) for (const k of kept) if (k !== i) expect(Math.abs(boxes[i].x - boxes[k].x)).toBeGreaterThanOrEqual(48)
    expect(kept.length).toBeLessThan(12)
  })

  it('scans within 10 days draw as one marker (the latest) and carry the others', () => {
    expect(MERGE_DAYS).toBe(10)
    const merged = mergeScans([pt('2026-05-01', 38, true), pt('2026-05-08', 37.5, true), pt('2026-05-11', 37.2, true), pt('2026-05-12', 37, true), pt('2026-06-30', 36, true), pt('2026-05-05', 90)])
    // 1, 8 and 11 May fall inside 10 days of the first; 12 May starts a new cluster
    expect(merged.map((p) => p.x)).toEqual(['2026-05-05', '2026-05-11', '2026-05-12', '2026-06-30'])
    const cluster = merged.find((p) => p.x === '2026-05-11')!
    expect(cluster.value).toBe(37.2)
    expect(cluster.members!.map((m) => m.x)).toEqual(['2026-05-01', '2026-05-08', '2026-05-11'])
    expect(merged.find((p) => p.x === '2026-06-30')!.members).toBeUndefined()
    // only same-series scans are given: a single scan is untouched
    expect(mergeScans([pt('2026-01-01', 1, true)])).toHaveLength(1)
  })

  it('scrubbing lands on the nearest point', () => {
    expect(nearestPoint([10, 50, 90], 62)).toBe(1)
    expect(nearestPoint([10, 50, 90], 80)).toBe(2)
    expect(nearestPoint([], 5)).toBe(-1)
  })
})
