/**
 * Tapping a pin on the site map.
 *
 * The bugs here were all a touch measured in one space and compared against pins
 * drawn in another, so the tests are on the conversions themselves rather than
 * on a screen: round trips through the crop and the zoom, and "does a tap on
 * this pin resolve to this pin" for every pin, in both views, at every zoom.
 */
import { describe, it, expect } from 'vitest'
import {
  toLocal, pctToLocal, localToPct, resolveTap, classifyRelease, isCompatMouse,
  TAP_SLOP_PX, DOUBLE_TAP_MS, DOUBLE_TAP_SLOP_PX, COMPAT_MOUSE_WINDOW_MS,
} from './mapGeometry'
import {
  PINS, PIN_BY_ID, WINDOWS, VIEWS, COMPOSITE_ASPECT, SCREEN_WIDTH, MIN_SPACING_PX,
  pinsFor, spacingPx,
} from './sitePins'

const ASPECT = COMPOSITE_ASPECT

/** The box a crop window fills at a given width, the way the component sizes it. */
function boxFor(view, width) {
  const w = WINDOWS[view]
  return { w: width, h: (width * (w.y1 - w.y0) * ASPECT) / (w.x1 - w.x0) }
}

/** The furthest the map can be panned at a zoom before it shows blank edge. */
const maxPan = (box, zoom) => ({ x: (box.w * zoom - box.w) / 2, y: (box.h * zoom - box.h) / 2 })
const clampPan = (p, box, zoom) => {
  const m = maxPan(box, zoom)
  return { x: Math.max(-m.x, Math.min(m.x, p.x)), y: Math.max(-m.y, Math.min(m.y, p.y)) }
}

/** The pan that brings a pin as near the middle of the box as the clamp allows. */
function panToCentre(view, pin, box, zoom) {
  const at = pctToLocal(view, pin, { box, zoom, pan: { x: 0, y: 0 } })
  return clampPan({ x: box.w / 2 - at.x, y: box.h / 2 - at.y }, box, zoom)
}

const ZOOMS = [1, 1.5, 2, 3, 4]
const WIDTHS = [390, 375, 359, 320, 768]

// ------------------------------------------------------------ round trips

describe('percent to local to percent', () => {
  const corner = (view) => {
    const w = WINDOWS[view]
    return [
      { x: w.x0, y: w.y0 }, { x: w.x1, y: w.y0 },
      { x: w.x0, y: w.y1 }, { x: w.x1, y: w.y1 },
      { x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 },
    ]
  }

  for (const view of VIEWS) {
    it(`round-trips the centre and all four corners of the ${view} crop at every zoom and pan`, () => {
      for (const width of WIDTHS) {
        const box = boxFor(view, width)
        for (const zoom of ZOOMS) {
          const m = maxPan(box, zoom)
          for (const pan of [{ x: 0, y: 0 }, { x: m.x, y: -m.y }, { x: -m.x * 0.4, y: m.y * 0.7 }]) {
            for (const pct of corner(view)) {
              const local = pctToLocal(view, pct, { box, zoom, pan })
              const back = localToPct(view, local, { box, zoom, pan })
              expect(back.x).toBeCloseTo(pct.x, 9)
              expect(back.y).toBeCloseTo(pct.y, 9)
            }
          }
        }
      }
    })

    it(`puts the ${view} crop's corners on the box's corners at 1x`, () => {
      const box = boxFor(view, 390)
      const w = WINDOWS[view]
      const tl = pctToLocal(view, { x: w.x0, y: w.y0 }, { box })
      const br = pctToLocal(view, { x: w.x1, y: w.y1 }, { box })
      expect(tl.x).toBeCloseTo(0, 9)
      expect(tl.y).toBeCloseTo(0, 9)
      expect(br.x).toBeCloseTo(box.w, 9)
      expect(br.y).toBeCloseTo(box.h, 9)
    })

    it(`zooms ${view} about the centre of the box`, () => {
      const box = boxFor(view, 390)
      const w = WINDOWS[view]
      const mid = { x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 }
      for (const zoom of ZOOMS) {
        const at = pctToLocal(view, mid, { box, zoom })
        expect(at.x).toBeCloseTo(box.w / 2, 9)
        expect(at.y).toBeCloseTo(box.h / 2, 9)
      }
    })
  }

  it('measures a touch against the box rectangle, not its wrapper', () => {
    const rect = { left: 40, top: 100 }
    expect(toLocal({ x: 140, y: 250 }, rect)).toEqual({ x: 100, y: 150 })
  })
})

// ------------------------------------------------------------ nearest pin

describe('nearest pin', () => {
  it('has all 30 pins to test', () => {
    expect(PINS).toHaveLength(30)
  })

  for (const view of VIEWS) {
    it(`a tap exactly on each ${view} pin selects that pin, at every width`, () => {
      for (const width of WIDTHS) {
        const box = boxFor(view, width)
        for (const pin of pinsFor(view)) {
          const local = pctToLocal(view, pin, { box })
          const hit = resolveTap(view, local, { box, aspect: ASPECT })
          expect(hit.pin.id).toBe(pin.id)
          expect(hit.distancePx).toBeCloseTo(0, 6)
        }
      }
    })

    it(`a tap slightly off each ${view} pin, in eight directions, still selects it`, () => {
      // 15 reference px is well inside the 22 px half-spacing of the closest pair
      const REF = 15
      for (const width of WIDTHS) {
        const box = boxFor(view, width)
        const off = (REF * width) / SCREEN_WIDTH
        for (const pin of pinsFor(view)) {
          const c = pctToLocal(view, pin, { box })
          for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4
            const hit = resolveTap(view, { x: c.x + Math.cos(a) * off, y: c.y + Math.sin(a) * off }, { box, aspect: ASPECT })
            expect(hit.pin.id).toBe(pin.id)
          }
        }
      }
    })
  }

  it('resolves identically at every rendered width', () => {
    // which pin a thumb meant must not depend on how big the map happens to be
    for (const view of VIEWS) {
      const w = WINDOWS[view]
      for (let i = 1; i < 12; i++) {
        for (let j = 1; j < 12; j++) {
          const pct = { x: w.x0 + ((w.x1 - w.x0) * i) / 12, y: w.y0 + ((w.y1 - w.y0) * j) / 12 }
          const ids = WIDTHS.map((width) => {
            const box = boxFor(view, width)
            return resolveTap(view, pctToLocal(view, pct, { box }), { box, aspect: ASPECT }).pin.id
          })
          expect(new Set(ids).size).toBe(1)
        }
      }
    }
  })

  it('always resolves to exactly one pin, even in empty space', () => {
    for (const view of VIEWS) {
      const box = boxFor(view, 390)
      for (let x = 0; x <= box.w; x += 17) {
        for (let y = 0; y <= box.h; y += 17) {
          const hit = resolveTap(view, { x, y }, { box, aspect: ASPECT })
          expect(hit).toBeTruthy()
          expect(hit.pin.view).toBe(view)
        }
      }
    }
  })

  it('only ever offers pins in the view being tapped', () => {
    const box = boxFor('back', 390)
    for (let x = 0; x <= box.w; x += 40) {
      for (let y = 0; y <= box.h; y += 40) {
        expect(resolveTap('back', { x, y }, { box, aspect: ASPECT }).pin.view).toBe('back')
      }
    }
  })

  it('honours a pin that has been moved with Adjust pins', () => {
    // far enough that the old spot is nearer a neighbour than the moved pin
    const overrides = { 'abd-r-mid-inner': { x: 27.5, y: 38.9 } }
    const box = boxFor('front', 390)
    const moved = pinsFor('front', overrides).find((p) => p.id === 'abd-r-mid-inner')
    const local = pctToLocal('front', moved, { box })
    expect(resolveTap('front', local, { box, aspect: ASPECT, overrides }).pin.id).toBe('abd-r-mid-inner')
    // and the old spot no longer belongs to it
    const old = pctToLocal('front', PIN_BY_ID['abd-r-mid-inner'], { box })
    expect(resolveTap('front', old, { box, aspect: ASPECT, overrides }).pin.id).not.toBe('abd-r-mid-inner')
  })

  it('can be limited to a group, for the filter chips', () => {
    const box = boxFor('front', 390)
    const thigh = PIN_BY_ID['thigh-l-front-mid']
    const local = pctToLocal('front', thigh, { box })
    const hit = resolveTap('front', local, { box, aspect: ASPECT, groups: ['abdomen'] })
    expect(hit.pin.group).toBe('abdomen')
  })
})

// ------------------------------------------------------- nothing unreachable

describe('no pin is unreachable', () => {
  for (const view of VIEWS) {
    it(`every ${view} pin can be brought on screen and tapped at every zoom, resolving to itself and nothing else`, () => {
      for (const width of [390, 375, 320]) {
        const box = boxFor(view, width)
        for (const zoom of ZOOMS) {
          for (const pin of pinsFor(view)) {
            const pan = panToCentre(view, pin, box, zoom)
            const local = pctToLocal(view, pin, { box, zoom, pan })
            // on screen, so a finger can actually reach it
            expect(local.x).toBeGreaterThanOrEqual(0)
            expect(local.x).toBeLessThanOrEqual(box.w)
            expect(local.y).toBeGreaterThanOrEqual(0)
            expect(local.y).toBeLessThanOrEqual(box.h)

            const hit = resolveTap(view, local, { box, zoom, pan, aspect: ASPECT })
            expect(hit.pin.id).toBe(pin.id)

            // and no other pin is as close: exactly one pin owns this point
            const others = pinsFor(view).filter((p) => p.id !== pin.id)
            for (const o of others) {
              const ol = pctToLocal(view, o, { box, zoom, pan })
              expect(Math.hypot(ol.x - local.x, ol.y - local.y)).toBeGreaterThan(1)
            }
          }
        }
      }
    })
  }

  it('gives every pin a touch cell at least 44 px across at 1x, in the 390 px reference', () => {
    // a pin's cell is the set of points nearer to it than to any other pin. The
    // largest circle inside it has a radius of half the distance to the nearest
    // neighbour, so a 44 px minimum spacing is exactly a 44 px-wide target.
    for (const view of VIEWS) {
      const pins = pinsFor(view)
      for (const pin of pins) {
        const nearest = Math.min(...pins.filter((p) => p.id !== pin.id).map((p) => spacingPx(pin, p, { aspect: ASPECT })))
        expect(nearest * 2 / 2).toBeGreaterThanOrEqual(MIN_SPACING_PX)
      }
    }
  })

  it('still leaves a cell of at least 40 px on the narrowest full-screen map', () => {
    // the full-screen screens fit the crop to the space left over and can be
    // narrower than 390 px; the cell shrinks in proportion
    const narrowest = 359 / SCREEN_WIDTH
    for (const view of VIEWS) {
      const pins = pinsFor(view)
      for (const pin of pins) {
        const nearest = Math.min(...pins.filter((p) => p.id !== pin.id).map((p) => spacingPx(pin, p, { aspect: ASPECT })))
        expect(nearest * narrowest).toBeGreaterThanOrEqual(40)
      }
    }
  })

  it('cells grow with zoom, so a pin is easier to hit zoomed in than out', () => {
    const box = boxFor('front', 390)
    const a = PIN_BY_ID['abd-r-upper-inner']
    const b = PIN_BY_ID['abd-r-mid-inner']
    let last = 0
    for (const zoom of ZOOMS) {
      const la = pctToLocal('front', a, { box, zoom })
      const lb = pctToLocal('front', b, { box, zoom })
      const d = Math.hypot(la.x - lb.x, la.y - lb.y)
      expect(d).toBeGreaterThan(last)
      last = d
    }
  })
})

// ------------------------------------------------------ the bug, reproduced

describe('measuring a touch against the wrong element', () => {
  /*
   * The measured case: Log on body at 375x667 fits the crop to the height left
   * over, so the box is 301 px wide inside a 359 px wrapper and sits 29 px in
   * from the wrapper's left edge. Touches were measured against the wrapper.
   * 19 of 30 pins resolved correctly; the other 11 resolved to a neighbour.
   */
  const view = 'front'
  const box = { w: 301, h: 399 }
  const wrapperOffset = (359 - 301) / 2

  const misses = (offsetX) => pinsFor(view).filter((pin) => {
    const c = pctToLocal(view, pin, { box })
    const hit = resolveTap(view, { x: c.x + offsetX, y: c.y }, { box, aspect: ASPECT })
    return hit.pin.id !== pin.id
  })

  it('is 29 px out when measured against the wrapper', () => {
    expect(wrapperOffset).toBe(29)
  })

  it('misresolves a large share of pins with that offset', () => {
    expect(misses(wrapperOffset).length).toBeGreaterThan(8)
  })

  it('misresolves none when measured against the box itself', () => {
    expect(misses(0)).toEqual([])
  })

  it('the wrapper offset is exactly what toLocal removes', () => {
    // a touch on the pin, as the browser reports it, relative to each element
    const pin = PIN_BY_ID['abd-l-upper-outer']
    const inBox = pctToLocal(view, pin, { box })
    const boxRect = { left: 8 + wrapperOffset, top: 60 }
    const wrapperRect = { left: 8, top: 60 }
    const client = { x: boxRect.left + inBox.x, y: boxRect.top + inBox.y }
    expect(toLocal(client, boxRect).x).toBeCloseTo(inBox.x, 9)
    expect(toLocal(client, wrapperRect).x).toBeCloseTo(inBox.x + wrapperOffset, 9)
  })
})

// ------------------------------------------------------ what a lift-off means

describe('a finger lifting off', () => {
  const start = { x: 100, y: 100 }
  const NOW = 10_000

  it('is a tap when it has not moved', () => {
    expect(classifyRelease({ start, end: start, now: NOW })).toBe('select')
  })

  it('is still a tap after a wobble inside the slop, in any direction', () => {
    for (const a of [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4)) {
      const end = { x: start.x + Math.cos(a) * (TAP_SLOP_PX - 1), y: start.y + Math.sin(a) * (TAP_SLOP_PX - 1) }
      expect(classifyRelease({ start, end, now: NOW })).toBe('select')
    }
  })

  it('tolerates a drift of 10 px, which a real thumb makes without meaning to', () => {
    expect(TAP_SLOP_PX).toBeGreaterThanOrEqual(10)
    expect(classifyRelease({ start, end: { x: 110, y: 100 }, now: NOW })).toBe('select')
  })

  it('is not a tap once the finger has clearly travelled', () => {
    expect(classifyRelease({ start, end: { x: start.x + TAP_SLOP_PX + 6, y: start.y }, now: NOW })).toBe('none')
  })

  it('is judged on where the finger ended, not on whether it ever strayed', () => {
    // out and back: the classifier only sees the endpoints, which is the point
    expect(classifyRelease({ start, end: { x: 102, y: 101 }, now: NOW })).toBe('select')
  })

  it('a second tap close in time and place resets a zoomed map', () => {
    const lastTap = { at: NOW - 150, x: 104, y: 98 }
    expect(classifyRelease({ start, end: start, now: NOW, lastTap, zoom: 2 })).toBe('reset')
  })

  it('also resets a panned map that happens to be at 1x', () => {
    const lastTap = { at: NOW - 150, x: 100, y: 100 }
    expect(classifyRelease({ start, end: start, now: NOW, lastTap, zoom: 1, panned: true })).toBe('reset')
  })

  it('never resets an unzoomed map: a second tap there is just a tap', () => {
    const lastTap = { at: NOW - 100, x: 100, y: 100 }
    expect(classifyRelease({ start, end: start, now: NOW, lastTap, zoom: 1 })).toBe('select')
  })

  it('does not swallow a quick tap on a different pin while zoomed', () => {
    // 80 ms later but 120 px away: a different pin, not a double tap
    const lastTap = { at: NOW - 80, x: start.x - 120, y: start.y }
    expect(classifyRelease({ start, end: start, now: NOW, lastTap, zoom: 3 })).toBe('select')
  })

  it('does not treat a slow second tap as a double tap', () => {
    const lastTap = { at: NOW - (DOUBLE_TAP_MS + 50), x: 100, y: 100 }
    expect(classifyRelease({ start, end: start, now: NOW, lastTap, zoom: 2 })).toBe('select')
  })

  it('treats a tap just inside the double-tap radius as a double tap, and just outside as not', () => {
    const inside = { at: NOW - 100, x: start.x + DOUBLE_TAP_SLOP_PX - 1, y: start.y }
    const outside = { at: NOW - 100, x: start.x + DOUBLE_TAP_SLOP_PX + 1, y: start.y }
    expect(classifyRelease({ start, end: start, now: NOW, lastTap: inside, zoom: 2 })).toBe('reset')
    expect(classifyRelease({ start, end: start, now: NOW, lastTap: outside, zoom: 2 })).toBe('select')
  })
})

describe('mouse events the browser makes up after a touch', () => {
  it('are recognised for a short while after a touch', () => {
    expect(isCompatMouse(1000 + 4, 1000)).toBe(true)
    expect(isCompatMouse(1000 + COMPAT_MOUSE_WINDOW_MS - 1, 1000)).toBe(true)
  })

  it('are not recognised later, so a real mouse still works on a hybrid device', () => {
    expect(isCompatMouse(1000 + COMPAT_MOUSE_WINDOW_MS + 1, 1000)).toBe(false)
  })

  it('are never recognised when there has been no touch', () => {
    expect(isCompatMouse(5000, null)).toBe(false)
  })

  it('arrive inside the double-tap window, which is why they must be ignored', () => {
    // the synthesized sequence lands ~4 ms after the touch; the double-tap
    // window is 320 ms, so unfiltered it reads as a second tap
    expect(4).toBeLessThan(DOUBLE_TAP_MS)
    expect(COMPAT_MOUSE_WINDOW_MS).toBeGreaterThan(DOUBLE_TAP_MS)
  })
})
