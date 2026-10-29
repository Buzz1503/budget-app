import { describe, it, expect } from 'vitest'
import {
  lockDirection, pinchZoom, panWin, fitWin, isZoomed, NightGesture, GESTURE, overviewBox, overviewDrag,
  tickStepMin, nightTicks, tickPlace, NIGHT_MIN_SPAN, type Ctx,
} from './nightGestures'

const MIN = 60000
const H = 60 * MIN
const night = { start: 0, end: 8 * H }
const whole = { from: 0, to: 8 * H }
const ctx = (win = whole): Ctx => ({ win, night, left: 0, width: 400 })

describe('direction', () => {
  it('waits for the first few pixels, then vertical goes to the page and horizontal to the chart', () => {
    expect(lockDirection(3, 4)).toBeNull()
    expect(lockDirection(2, 12)).toBe('page')
    expect(lockDirection(-6, 9)).toBe('page')
    expect(lockDirection(12, 3)).toBe('chart')
    expect(lockDirection(-10, -9)).toBe('chart')
  })

  it('a vertical swipe on the chart never draws, pans or opens anything', () => {
    const g = new NightGesture()
    g.down(1, 100, 100, 0, ctx())
    const fx = [...g.move(1, 101, 110, 16, ctx()), ...g.move(1, 102, 160, 32, ctx()), ...g.up(1, 102, 160, 48)]
    expect(fx).toEqual([])
    expect(g.mode).toBe('idle')
  })

  it('not zoomed, a sideways drag shows the crosshair straight away', () => {
    const g = new NightGesture()
    g.down(1, 100, 100, 0, ctx())
    const fx = g.move(1, 112, 101, 16, ctx())
    expect(fx).toEqual([{ kind: 'capture' }, { kind: 'cross', t: (112 / 400) * 8 * H }])
    expect(g.move(1, 200, 101, 32, ctx())).toEqual([{ kind: 'cross', t: 4 * H }])
    expect(g.up(1, 200, 101, 48)).toEqual([{ kind: 'endCross' }])
  })

  it('a tap does nothing (full screen has its own button)', () => {
    const g = new NightGesture()
    g.down(1, 100, 100, 0, ctx())
    expect(g.up(1, 101, 100, 80)).toEqual([])
  })
})

describe('pinch zoom', () => {
  it('zooms around the point between the fingers', () => {
    // fingers centred at 25% of the plot, spreading to twice the distance
    const r = pinchZoom(whole, 100, 200, 0.25, 0.25, night)
    expect(r.win.to - r.win.from).toBe(4 * H)
    // the minute under the fingers (2:00 into the night) stays at 25%
    expect(r.win.from + 0.25 * (r.win.to - r.win.from)).toBe(2 * H)
  })

  it('stops at 30 minutes and at the whole night, and says so', () => {
    const tight = pinchZoom(whole, 10, 10000, 0.5, 0.5, night)
    expect(tight.win.to - tight.win.from).toBe(NIGHT_MIN_SPAN)
    expect(tight.limit).toBe('min')
    const wide = pinchZoom({ from: H, to: 3 * H }, 200, 20, 0.5, 0.5, night)
    expect(wide.win).toEqual(whole)
    expect(wide.limit).toBe('max')
  })

  it('stays inside the night', () => {
    const r = pinchZoom(whole, 100, 400, 0.98, 0.98, night)
    expect(r.win.to).toBeLessThanOrEqual(night.end)
    expect(r.win.from).toBeGreaterThanOrEqual(night.start)
  })

  it('two fingers through the gesture class give windows', () => {
    const g = new NightGesture()
    g.down(1, 150, 100, 0, ctx())
    expect(g.down(2, 250, 100, 10, ctx())[0]).toEqual({ kind: 'capture' })
    const fx = g.move(2, 350, 100, 20, ctx())
    expect(fx[0].kind).toBe('win')
    expect(g.owns).toBe(true)
  })
})

describe('pan', () => {
  const zoomed = { from: 2 * H, to: 4 * H }

  it('moves with the finger and stops at the edges of the night', () => {
    expect(panWin(zoomed, 0.5, night).win).toEqual({ from: H, to: 3 * H })
    expect(panWin(zoomed, -0.5, night).win).toEqual({ from: 3 * H, to: 5 * H })
    const left = panWin(zoomed, 5, night)
    expect(left.win).toEqual({ from: 0, to: 2 * H })
    expect(left.limit).toBe('min')
    const right = panWin(zoomed, -5, night)
    expect(right.win).toEqual({ from: 6 * H, to: 8 * H })
    expect(right.limit).toBe('max')
  })

  it('when zoomed, a quick sideways drag pans', () => {
    const g = new NightGesture()
    g.down(1, 200, 100, 0, ctx(zoomed))
    expect(g.move(1, 212, 100, 40, ctx(zoomed))).toEqual([{ kind: 'capture' }])
    const [fx] = g.move(1, 300, 100, 60, ctx(zoomed))
    expect(fx).toEqual({ kind: 'win', win: { from: 1.5 * H, to: 3.5 * H }, limit: null })
  })

  it('when zoomed, press and hold then drag shows the crosshair', () => {
    const g = new NightGesture()
    g.down(1, 200, 100, 0, ctx(zoomed))
    expect(g.hold(GESTURE.holdMs - 1, ctx(zoomed))).toEqual([])
    const held = g.hold(GESTURE.holdMs, ctx(zoomed))
    expect(held.map((e) => e.kind)).toEqual(['capture', 'holding', 'cross'])
    expect(held[2]).toEqual({ kind: 'cross', t: 3 * H })
    expect(g.move(1, 300, 102, 260, ctx(zoomed))).toEqual([{ kind: 'cross', t: 3.5 * H }])
  })

  it('holding does nothing when not zoomed', () => {
    const g = new NightGesture()
    g.down(1, 200, 100, 0, ctx())
    expect(g.hold(400, ctx())).toEqual([])
  })
})

describe('double tap', () => {
  it('resets to the whole night', () => {
    const g = new NightGesture()
    const c = ctx({ from: 2 * H, to: 3 * H })
    g.down(1, 200, 100, 0, c)
    expect(g.up(1, 200, 100, 60)).toEqual([])
    g.down(1, 205, 102, 200, c)
    expect(g.up(1, 205, 102, 260)).toEqual([{ kind: 'reset' }])
  })

  it('two taps far apart in time are not a double tap', () => {
    const g = new NightGesture()
    g.down(1, 200, 100, 0, ctx())
    g.up(1, 200, 100, 60)
    g.down(1, 200, 100, 900, ctx())
    expect(g.up(1, 200, 100, 960)).toEqual([])
  })

  it('isZoomed and fitWin', () => {
    expect(isZoomed(whole, night)).toBe(false)
    expect(isZoomed({ from: 0, to: 4 * H }, night)).toBe(true)
    expect(fitWin(-H, 2 * H, night).win).toEqual({ from: 0, to: 2 * H })
  })
})

describe('overview strip', () => {
  it('places the window where the zoom is', () => {
    expect(overviewBox({ from: 2 * H, to: 4 * H }, night, 400)).toEqual({ x: 100, w: 100 })
  })

  it('dragging the window moves the zoom, inside the night', () => {
    expect(overviewDrag({ from: 2 * H, to: 4 * H }, 50, 400, night)).toEqual({ from: 3 * H, to: 5 * H })
    expect(overviewDrag({ from: 2 * H, to: 4 * H }, 1000, 400, night)).toEqual({ from: 6 * H, to: 8 * H })
  })
})

describe('time axis', () => {
  const clock = (ms: number) => 23 * 60 + ms / MIN // the night starts at 23:00

  it('tick density follows the zoom', () => {
    expect(tickStepMin(8 * H)).toBe(120)
    expect(tickStepMin(5 * H)).toBe(60)
    expect(tickStepMin(2 * H)).toBe(30)
    expect(tickStepMin(60 * MIN)).toBe(15)
    expect(tickStepMin(30 * MIN)).toBe(5)
  })

  it('ticks fall on whole local times', () => {
    expect(nightTicks({ from: 0, to: 8 * H }, clock).map((t) => t.label)).toEqual(['00:00', '02:00', '04:00', '06:00'])
    expect(nightTicks({ from: 7 * MIN, to: 37 * MIN }, clock).map((t) => t.label)).toEqual(['23:10', '23:15', '23:20', '23:25', '23:30', '23:35'])
  })

  it('the last label is never clipped at the right edge', () => {
    const right = 332
    const last = tickPlace(330, 36, 82, right)
    expect(last.anchor).toBe('end')
    expect(last.x).toBeLessThanOrEqual(right)
    expect(tickPlace(84, 36, 82, right).anchor).toBe('start')
    expect(tickPlace(200, 36, 82, right)).toEqual({ x: 200, anchor: 'middle' })
  })
})
