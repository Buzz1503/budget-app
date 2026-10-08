import { describe, it, expect } from 'vitest'
import {
  dayNum, dateOfDay, yearsWithResults, rangeWindow, inWindow, rangeSeries, canPlotTrend,
  fitX, fitY, inView, initialView, viewBounds, zoomView, panView, xFor, yFor, axisFor,
  placeEvents, refGeometry, visibleLabels, labelGap, DEFAULT_RANGE,
} from './chartRange'

const S = [
  { date: '2014-03-25', value: 5 },
  { date: '2022-05-01', value: 4 },
  { date: '2023-06-01', value: 6 },
  { date: '2024-04-01', value: 7 },
  { date: '2025-02-01', value: 8 },
  { date: '2026-08-10', value: 12 },
]
const TODAY = '2026-10-08'
const PLOT = { left: 34, right: 310, top: 16, bottom: 140 }

describe('chart range selection', () => {
  it('defaults to 2Y', () => {
    expect(DEFAULT_RANGE).toEqual({ kind: 'preset', key: '2Y' })
  })

  it('day numbers round-trip', () => {
    expect(dateOfDay(dayNum('2026-08-13'))).toBe('2026-08-13')
    expect(dayNum('2026-08-14') - dayNum('2026-08-13')).toBe(1)
  })

  it('returns only results inside each preset window', () => {
    expect(rangeSeries(S, { kind: 'preset', key: '1Y' }, TODAY).map((s) => s.date)).toEqual(['2026-08-10'])
    expect(rangeSeries(S, { kind: 'preset', key: '2Y' }, TODAY).map((s) => s.date)).toEqual(['2025-02-01', '2026-08-10'])
    expect(rangeSeries(S, { kind: 'preset', key: '5Y' }, TODAY).map((s) => s.date))
      .toEqual(['2022-05-01', '2023-06-01', '2024-04-01', '2025-02-01', '2026-08-10'])
    expect(rangeSeries(S, { kind: 'preset', key: 'All' }, TODAY)).toHaveLength(6)
  })

  it('window edges are inclusive and count from today', () => {
    expect(rangeWindow({ kind: 'preset', key: '1Y' }, TODAY)).toEqual({ from: '2025-10-08', to: TODAY })
    const edge = [{ date: '2025-10-08', value: 1 }, { date: '2025-10-07', value: 2 }]
    expect(inWindow(edge, rangeWindow({ kind: 'preset', key: '1Y' }, TODAY))).toHaveLength(1)
  })

  it('29 February counts back to a real date', () => {
    expect(rangeWindow({ kind: 'preset', key: '1Y' }, '2028-02-29').from).toBe('2027-02-28')
  })

  it('lists the years with results, and a year selects only that year', () => {
    expect(yearsWithResults(S)).toEqual([2014, 2022, 2023, 2024, 2025, 2026])
    expect(rangeSeries(S, { kind: 'year', year: 2023 }, TODAY).map((s) => s.value)).toEqual([6])
    expect(rangeSeries(S, { kind: 'year', year: 2014 }, TODAY)).toHaveLength(1)
    expect(rangeSeries(S, { kind: 'year', year: 2020 }, TODAY)).toHaveLength(0)
  })

  it('needs two results to plot a trend', () => {
    expect(canPlotTrend([])).toBe(false)
    expect(canPlotTrend([S[0]])).toBe(false)
    expect(canPlotTrend(S.slice(0, 2))).toBe(true)
  })
})

describe('axes scale to what is visible', () => {
  it('y fits only the visible points', () => {
    const win = rangeSeries(S, { kind: 'preset', key: '2Y' }, TODAY) // 8 and 12
    const ax = fitY(win)
    expect(ax.lo).toBeLessThan(8)
    expect(ax.hi).toBeGreaterThan(12)
    expect(ax.lo).toBeGreaterThan(5) // the 2014 value of 5 does not stretch it
    expect(ax.hi - ax.lo).toBeLessThan(6)
  })

  it('a flat series still gets a usable axis', () => {
    const ax = fitY([{ date: '2025-01-01', value: 5 }, { date: '2025-02-01', value: 5 }])
    expect(ax.hi).toBeGreaterThan(ax.lo)
  })

  it('x fits the visible points; the min and max land at the plot edges plus air', () => {
    const win = rangeSeries(S, { kind: 'preset', key: '2Y' }, TODAY)
    const view = fitX(win)
    expect(view.x0).toBeLessThan(dayNum('2025-02-01'))
    expect(view.x1).toBeGreaterThan(dayNum('2026-08-10'))
    expect(view.x1 - view.x0).toBeLessThan(dayNum('2026-08-10') - dayNum('2025-02-01') + 60)
    expect(initialView(S, { kind: 'preset', key: '2Y' }, TODAY)).toEqual(view)
  })

  it('the axis follows the view as it moves', () => {
    const early = { x0: dayNum('2022-01-01'), x1: dayNum('2024-12-31') }
    const a = axisFor(S, early, DEFAULT_RANGE, TODAY)
    expect(a.hi).toBeLessThan(10)
    const late = initialView(S, DEFAULT_RANGE, TODAY)
    expect(axisFor(S, late, DEFAULT_RANGE, TODAY).hi).toBeGreaterThan(12)
    expect(inView(S, early)).toHaveLength(3)
  })

  it('y maps the visible min and max inside the plot, using the height', () => {
    const win = rangeSeries(S, DEFAULT_RANGE, TODAY)
    const ax = fitY(win)
    const spanPx = Math.abs(yFor(win[0].value, ax, PLOT) - yFor(win[1].value, ax, PLOT))
    expect(spanPx / (PLOT.bottom - PLOT.top)).toBeGreaterThan(0.6)
  })
})

describe('overlay dates stay aligned at every zoom', () => {
  const opening = initialView(S, { kind: 'preset', key: '5Y' }, TODAY)
  const bounds = viewBounds(S, opening)
  const ev = [{ date: '2024-04-01', name: 'A' }, { date: '2023-06-01', name: 'B' }]

  it('an overlay on a result date shares its x with the result, at several zooms', () => {
    let view = opening
    for (const scale of [1, 0.5, 0.5, 0.4, 2]) {
      view = zoomView(view, scale, 0.5, bounds)
      const placed = placeEvents(ev, view, PLOT)
      for (const e of placed) {
        const pt = S.find((s) => s.date === e.date)
        expect(e.x).toBeCloseTo(xFor(pt.date, view, PLOT), 9)
      }
    }
  })

  it('maps a date to the right fraction of the plot', () => {
    const view = { x0: dayNum('2025-01-01'), x1: dayNum('2025-01-11') }
    expect(xFor('2025-01-01', view, PLOT)).toBe(PLOT.left)
    expect(xFor('2025-01-11', view, PLOT)).toBe(PLOT.right)
    expect(xFor('2025-01-06', view, PLOT)).toBeCloseTo((PLOT.left + PLOT.right) / 2, 9)
  })

  it('marks events outside the view as not visible rather than clamping them', () => {
    const view = { x0: dayNum('2024-01-01'), x1: dayNum('2024-12-31') }
    const [a, b] = placeEvents(ev, view, PLOT)
    expect(a.visible).toBe(true)
    expect(b.visible).toBe(false)
  })

  it('zooming about a focus keeps that date under the fingers', () => {
    const view = { x0: dayNum('2024-01-01'), x1: dayNum('2025-01-01') }
    const focus = 0.25
    const anchor = view.x0 + (view.x1 - view.x0) * focus
    const z = zoomView(view, 0.5, focus, bounds)
    expect(z.x1 - z.x0).toBeCloseTo((view.x1 - view.x0) * 0.5, 6)
    expect(z.x0 + (z.x1 - z.x0) * focus).toBeCloseTo(anchor, 6)
  })

  it('zoom is limited at both ends, and pan stays inside the data', () => {
    const tight = zoomView(opening, 0.0001, 0.5, bounds)
    expect(tight.x1 - tight.x0).toBeGreaterThanOrEqual(14)
    const wide = zoomView(opening, 1000, 0.5, bounds)
    expect(wide.x0).toBeGreaterThanOrEqual(bounds.x0)
    expect(wide.x1).toBeLessThanOrEqual(bounds.x1)
    const panned = panView(opening, 100000, bounds)
    expect(panned.x1).toBeLessThanOrEqual(bounds.x1)
    expect(panned.x1 - panned.x0).toBeCloseTo(opening.x1 - opening.x0, 6)
    expect(panView(opening, -100000, bounds).x0).toBeGreaterThanOrEqual(bounds.x0)
  })
})

describe('reference band', () => {
  const ax = { lo: 6, hi: 14 }
  it('clamps to the axis and drops bounds that are off it', () => {
    const g = refGeometry({ low: 2, high: 10 }, ax, PLOT)
    expect(g.lines).toEqual([10])
    expect(g.bottom).toBe(PLOT.bottom)
  })
  it('is absent when the whole interval is off the axis', () => {
    expect(refGeometry({ low: 1, high: 3 }, ax, PLOT)).toBeNull()
    expect(refGeometry({}, ax, PLOT)).toBeNull()
  })
})

describe('point labels', () => {
  it('hides labels that are too close and keeps the priority ones', () => {
    const pts = [{ x: 10 }, { x: 14 }, { x: 18 }, { x: 100 }]
    const keep = visibleLabels(pts, { minGap: 26, priority: (p, i) => (i === 2 ? 5 : 0) })
    expect(keep.has(2)).toBe(true)
    expect(keep.has(0)).toBe(false)
    expect(keep.has(1)).toBe(false)
    expect(keep.has(3)).toBe(true)
  })
  it('reappears when zoomed in far enough that there is room', () => {
    const view = { x0: 0, x1: 100 }
    const days = [10, 12, 14]
    const at = (v) => days.map((d) => ({ x: xFor(dateOfDay(d), v, PLOT) }))
    expect(visibleLabels(at(view)).size).toBe(1)
    const zoomed = { x0: 9, x1: 15 }
    expect(visibleLabels(at(zoomed)).size).toBe(3)
  })
  it('wider values need more room', () => {
    expect(labelGap('12.5')).toBeGreaterThan(labelGap('5'))
  })
})
