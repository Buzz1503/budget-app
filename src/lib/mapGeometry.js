/**
 * Turning a touch on the site map into a pin.
 *
 * Three spaces are involved and every bug in this area has been a touch
 * measured in one of them and compared against pins drawn in another:
 *
 *   client   what the browser reports for a touch, relative to the viewport
 *   local    pixels inside the map box, before zoom and pan are applied
 *   percent  position on the whole composite photograph, which is what pins
 *            are stored in
 *
 * The map box is a child of a wrapper that is sometimes wider than it (the
 * full-screen screens fit the crop to the space left over and centre it), so a
 * touch has to be measured against the *box*. Measured against the wrapper it is
 * off by half the difference — 29 px on a 375 px phone, with pins 44 px apart.
 *
 * Everything here is pure so it can be tested without a browser.
 */
import {
  WINDOWS, SCREEN_WIDTH, COMPOSITE_ASPECT, toScreen, nearestPin,
} from './sitePins'

/** Finger drift that still counts as a tap, in CSS pixels. iOS and Chromium both sit near 10-15. */
export const TAP_SLOP_PX = 12
/** Two taps this close in time can be a double tap. */
export const DOUBLE_TAP_MS = 320
/** ...and only if they are this close together. */
export const DOUBLE_TAP_SLOP_PX = 32
/** Held this long on a pin in Adjust pins, it is picked up instead of selected. */
export const LONG_PRESS_MS = 300

/** A client-space touch, as local pixels inside the map box. */
export function toLocal(client, rect) {
  return { x: client.x - rect.left, y: client.y - rect.top }
}

/**
 * Percent of the whole composite to local pixels, through the crop window and
 * the zoom/pan transform. The transform is about the centre of the box.
 */
export function pctToLocal(view, pct, { box, zoom = 1, pan = { x: 0, y: 0 } }) {
  const w = WINDOWS[view]
  const fx = (pct.x - w.x0) / (w.x1 - w.x0)
  const fy = (pct.y - w.y0) / (w.y1 - w.y0)
  return {
    x: (fx * box.w - box.w / 2) * zoom + box.w / 2 + pan.x,
    y: (fy * box.h - box.h / 2) * zoom + box.h / 2 + pan.y,
  }
}

/** The inverse of pctToLocal. */
export function localToPct(view, pt, { box, zoom = 1, pan = { x: 0, y: 0 } }) {
  const w = WINDOWS[view]
  const fx = ((pt.x - box.w / 2 - pan.x) / zoom + box.w / 2) / box.w
  const fy = ((pt.y - box.h / 2 - pan.y) / zoom + box.h / 2) / box.h
  return {
    x: w.x0 + fx * (w.x1 - w.x0),
    y: w.y0 + fy * (w.y1 - w.y0),
  }
}

/**
 * Which pin a touch belongs to: always exactly one, the nearest.
 *
 * Nearest is measured in the 390 px reference space the pin table is specified
 * in, so the question "which pin did this thumb mean" has the same answer at
 * every rendered size and zoom. The cells that result never overlap and never
 * leave a gap, which is what makes a pin impossible to miss — a tap in empty
 * skin still resolves to the closest site rather than to nothing.
 */
export function resolveTap(view, local, {
  box, zoom = 1, pan = { x: 0, y: 0 }, overrides = {}, aspect = COMPOSITE_ASPECT, groups = null,
}) {
  const pct = localToPct(view, local, { box, zoom, pan })
  const at = toScreen({ ...pct, view }, { screenWidth: SCREEN_WIDTH, aspect })
  return nearestPin(view, at, { overrides, screenWidth: SCREEN_WIDTH, aspect, groups })
}

/**
 * What a finger lifting off means.
 *
 * Decided on where the finger *ended*, not on whether it ever strayed: a thumb
 * that wobbles and settles is a tap. Only a double tap that is close in time,
 * close in space and on a zoomed map resets the zoom — on an unzoomed map there
 * is nothing to reset, so the second tap is just another tap, and tapping two
 * neighbouring pins quickly selects both in turn instead of swallowing the
 * second.
 */
export function classifyRelease({
  start, end, now, lastTap = null, zoom = 1, panned = false, slop = TAP_SLOP_PX,
}) {
  const drift = Math.hypot(end.x - start.x, end.y - start.y)
  if (drift > slop) return 'none'
  const zoomedOrPanned = zoom > 1.001 || panned
  if (
    lastTap
    && zoomedOrPanned
    && now - lastTap.at < DOUBLE_TAP_MS
    && Math.hypot(end.x - lastTap.x, end.y - lastTap.y) <= DOUBLE_TAP_SLOP_PX
  ) return 'reset'
  return 'select'
}

/**
 * Mouse events the browser makes up after a touch.
 *
 * Every touch tap is followed by mousedown, mouseup and click at the same spot.
 * Fed to the same handlers they are a second tap 4 ms after the first, which on
 * a zoomed map was read as a double tap and threw the zoom away the instant a
 * pin was selected.
 */
export const COMPAT_MOUSE_WINDOW_MS = 800
export function isCompatMouse(now, lastTouchAt) {
  return lastTouchAt != null && now - lastTouchAt < COMPAT_MOUSE_WINDOW_MS
}
