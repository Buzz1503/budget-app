// Touch on the night chart, as pure logic the card feeds pointer events into.
//
//   - The first 9 px of a one-finger move decide who owns it: mostly vertical
//     goes to the page (it scrolls), mostly horizontal goes to the chart.
//   - Not zoomed: a sideways drag shows the crosshair straight away.
//   - Zoomed: a sideways drag pans; press and hold 200 ms first for the crosshair.
//   - Two fingers pinch the time axis, centred between them, 30 minutes to the
//     whole night. A double tap goes back to the whole night.
//   - A tap does nothing else: full screen opens only from its own button.
//
// The card turns each Effect into state (crosshair time, window, haptics).

const MIN = 60000

export const GESTURE = {
  /** movement that decides page or chart */
  lockPx: 9,
  /** press and hold before the crosshair when zoomed */
  holdMs: 200,
  /** a finger still within this is still holding, or a tap */
  slopPx: 6,
  /** two taps this close in time and place reset the zoom */
  doubleTapMs: 320,
  doubleTapPx: 30,
}

/** The narrowest window: 30 minutes. */
export const NIGHT_MIN_SPAN = 30 * MIN

export interface Win { from: number; to: number }
export interface Span { start: number; end: number }

export type Owner = 'page' | 'chart' | null

/** Who owns a one-finger move: null until it has gone `lockPx`, then the page if mostly vertical. */
export function lockDirection(dx: number, dy: number, lockPx = GESTURE.lockPx): Owner {
  if (Math.hypot(dx, dy) < lockPx) return null
  return Math.abs(dy) > Math.abs(dx) ? 'page' : 'chart'
}

export const fullWin = (night: Span): Win => ({ from: night.start, to: night.end })

export function isZoomed(win: Win | null | undefined, night: Span): boolean {
  return !!win && win.to - win.from < night.end - night.start - 1000
}

export type Limit = 'min' | 'max' | null

/** A window of `span` starting at `from`, made to fit: 30 minutes to the whole night, inside the night. */
export function fitWin(from: number, span: number, night: Span): { win: Win; limit: Limit } {
  const whole = night.end - night.start
  const minSpan = Math.min(NIGHT_MIN_SPAN, whole)
  let limit: Limit = null
  let s = span
  if (s <= minSpan) { s = minSpan; limit = 'min' }
  if (s >= whole) { s = whole; limit = 'max' }
  const f = Math.min(night.end - s, Math.max(night.start, from))
  return { win: { from: f, to: f + s }, limit }
}

/**
 * Pinch: the minute under the fingers when the pinch began stays under the
 * point between them. `startFrac` and `frac` are where that point is across
 * the plot (0 left, 1 right); the window shrinks as the fingers spread.
 */
export function pinchZoom(start: Win, startDist: number, dist: number, startFrac: number, frac: number, night: Span): { win: Win; limit: Limit } {
  const span0 = start.to - start.from
  const anchor = start.from + startFrac * span0
  const span = span0 * (Math.max(1, startDist) / Math.max(1, dist))
  const fitted = fitWin(anchor - frac * span, span, night)
  return fitted
}

/** Pan by a drag of `dxFrac` of the plot width: the night moves with the finger. */
export function panWin(start: Win, dxFrac: number, night: Span): { win: Win; limit: Limit } {
  const span = start.to - start.from
  const from = start.from - dxFrac * span
  const r = fitWin(from, span, night)
  const edge = r.win.from === night.start && from < night.start ? 'min' : r.win.to === night.end && from + span > night.end ? 'max' : null
  return { win: r.win, limit: edge }
}

/** The time at a point across the plot. */
export const timeAt = (win: Win, frac: number) => win.from + Math.min(1, Math.max(0, frac)) * (win.to - win.from)

// ------------------------------------------------------------ the gesture

export type Effect =
  | { kind: 'capture' }
  | { kind: 'cross'; t: number }
  | { kind: 'endCross' }
  | { kind: 'win'; win: Win; limit: Limit }
  | { kind: 'reset' }
  | { kind: 'holding' }

export interface Ctx {
  win: Win
  night: Span
  /** the plot's left edge and width, in the same units as the pointer x */
  left: number
  width: number
}

type Mode = 'idle' | 'pending' | 'page' | 'cross' | 'pan' | 'pinch' | 'done'

interface Pt { x: number; y: number }

export class NightGesture {
  mode: Mode = 'idle'
  private pts = new Map<number, Pt>()
  private start: (Pt & { t: number }) | null = null
  private moved = 0
  private win0: Win | null = null
  private pinch0: { dist: number; frac: number } | null = null
  private lastTap: (Pt & { t: number }) | null = null

  private frac(x: number, ctx: Ctx) { return (x - ctx.left) / (ctx.width || 1) }

  down(id: number, x: number, y: number, t: number, ctx: Ctx): Effect[] {
    this.pts.set(id, { x, y })
    if (this.pts.size === 2) {
      const [a, b] = [...this.pts.values()]
      const wasCross = this.mode === 'cross'
      this.mode = 'pinch'
      this.win0 = ctx.win
      this.pinch0 = { dist: Math.abs(a.x - b.x) || 1, frac: this.frac((a.x + b.x) / 2, ctx) }
      return [{ kind: 'capture' }, ...(wasCross ? [{ kind: 'endCross' } as Effect] : [])]
    }
    if (this.pts.size > 2) return []
    this.mode = 'pending'
    this.start = { x, y, t }
    this.moved = 0
    return []
  }

  /** Called `holdMs` after a press: when zoomed and still, the crosshair. */
  hold(t: number, ctx: Ctx): Effect[] {
    if (this.mode !== 'pending' || !this.start || !isZoomed(ctx.win, ctx.night)) return []
    if (t - this.start.t < GESTURE.holdMs || this.moved > GESTURE.slopPx) return []
    this.mode = 'cross'
    return [{ kind: 'capture' }, { kind: 'holding' }, { kind: 'cross', t: timeAt(ctx.win, this.frac(this.start.x, ctx)) }]
  }

  move(id: number, x: number, y: number, t: number, ctx: Ctx): Effect[] {
    if (!this.pts.has(id)) return []
    this.pts.set(id, { x, y })
    if (this.mode === 'pinch') {
      if (this.pts.size < 2 || !this.pinch0 || !this.win0) return []
      const [a, b] = [...this.pts.values()]
      const r = pinchZoom(this.win0, this.pinch0.dist, Math.abs(a.x - b.x) || 1, this.pinch0.frac, this.frac((a.x + b.x) / 2, ctx), ctx.night)
      return [{ kind: 'win', win: r.win, limit: r.limit }]
    }
    if (!this.start) return []
    const dx = x - this.start.x
    const dy = y - this.start.y
    this.moved = Math.max(this.moved, Math.hypot(dx, dy))
    if (this.mode === 'pending') {
      const owner = lockDirection(dx, dy)
      if (!owner) return []
      if (owner === 'page') { this.mode = 'page'; return [] }
      if (isZoomed(ctx.win, ctx.night) && t - this.start.t < GESTURE.holdMs) {
        this.mode = 'pan'
        this.win0 = ctx.win
      } else {
        this.mode = 'cross'
        return [{ kind: 'capture' }, { kind: 'cross', t: timeAt(ctx.win, this.frac(x, ctx)) }]
      }
      return [{ kind: 'capture' }]
    }
    if (this.mode === 'cross') return [{ kind: 'cross', t: timeAt(ctx.win, this.frac(x, ctx)) }]
    if (this.mode === 'pan' && this.win0) {
      const r = panWin(this.win0, dx / (ctx.width || 1), ctx.night)
      return [{ kind: 'win', win: r.win, limit: r.limit }]
    }
    return []
  }

  up(id: number, x: number, y: number, t: number): Effect[] {
    if (!this.pts.has(id)) return []
    this.pts.delete(id)
    const out: Effect[] = []
    if (this.mode === 'pinch') {
      // the finger left behind does nothing until it lifts too
      this.mode = this.pts.size ? 'done' : 'idle'
      return out
    }
    if (this.mode === 'cross') out.push({ kind: 'endCross' })
    if (this.mode === 'pending' && this.start && this.moved <= GESTURE.slopPx) {
      const tap = { x, y, t }
      const last = this.lastTap
      if (last && t - last.t <= GESTURE.doubleTapMs && Math.hypot(x - last.x, y - last.y) <= GESTURE.doubleTapPx) {
        out.push({ kind: 'reset' })
        this.lastTap = null
      } else this.lastTap = tap
    }
    if (!this.pts.size) { this.mode = 'idle'; this.start = null }
    return out
  }

  /** The browser took the touch (a page scroll): forget it. */
  cancel(id: number): Effect[] {
    this.pts.delete(id)
    const wasCross = this.mode === 'cross'
    if (!this.pts.size) { this.mode = 'idle'; this.start = null }
    return wasCross ? [{ kind: 'endCross' }] : []
  }

  /** Whether the chart owns the touch now (so the page must not scroll or zoom). */
  get owns(): boolean { return this.mode === 'cross' || this.mode === 'pan' || this.mode === 'pinch' || this.mode === 'done' }
}

// ------------------------------------------------------------ the overview

/** The highlighted window on the overview strip, in px of a strip `width` wide. */
export function overviewBox(win: Win, night: Span, width: number): { x: number; w: number } {
  const whole = night.end - night.start || 1
  return { x: ((win.from - night.start) / whole) * width, w: Math.max(6, ((win.to - win.from) / whole) * width) }
}

/** Dragging the highlighted window by `dxPx` on the strip. */
export function overviewDrag(start: Win, dxPx: number, width: number, night: Span): Win {
  const shift = (dxPx / (width || 1)) * (night.end - night.start)
  return fitWin(start.from + shift, start.to - start.from, night).win
}

// ------------------------------------------------------------ the time axis

/**
 * Minutes between ticks: the finest of 5, 15, 30 minutes, 1, 2 or 3 hours that
 * keeps labels `minGap` apart across a plot `plotW` wide (both in chart units),
 * so a long night shows hours and a 30 minute window shows 5 minute ticks.
 */
export const TICK_STEPS = [5, 15, 30, 60, 120, 180]
export function tickStepMin(spanMs: number, plotW = 246, minGap = 40): number {
  const m = Math.max(1, spanMs / MIN)
  return TICK_STEPS.find((s) => (s / m) * plotW >= minGap) ?? TICK_STEPS[TICK_STEPS.length - 1]
}

const pad = (n: number) => String(n).padStart(2, '0')
export const clockLabel = (minuteOfDay: number) => {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/**
 * Ticks on whole local steps inside the window. `minuteOfDay` is the local
 * clock at an instant, in minutes (fractional).
 */
export function nightTicks(win: Win, minuteOfDay: (ms: number) => number, plotW?: number): Array<{ t: number; label: string }> {
  const step = tickStepMin(win.to - win.from, plotW)
  const m0 = minuteOfDay(win.from)
  const into = ((m0 % step) + step) % step
  const first = win.from + (into === 0 ? 0 : (step - into) * MIN)
  const out: Array<{ t: number; label: string }> = []
  for (let t = first; t <= win.to + 1; t += step * MIN) out.push({ t, label: clockLabel(minuteOfDay(t)) })
  return out
}

/**
 * Where a tick label sits so it is never clipped: centred, or pulled in
 * against the edge it would cross (`labelW` is its width).
 */
export function tickPlace(x: number, labelW: number, left: number, right: number): { x: number; anchor: 'start' | 'middle' | 'end' } {
  if (x + labelW / 2 > right) return { x: right, anchor: 'end' }
  if (x - labelW / 2 < left) return { x: left, anchor: 'start' }
  return { x, anchor: 'middle' }
}
