/**
 * Turning a finger-drawn outline into millimetres.
 *
 * The coin is the whole trick. A photo has no scale — the same redness is 200
 * pixels across at arm's length and 600 up close — so something of known size
 * has to be in the frame. A coin is the one object everybody already has, and
 * fitting a circle to it converts pixels into millimetres for that photo and
 * that photo only.
 *
 * Everything here is arithmetic on points. It is deliberately independent of
 * the camera, the canvas and React, so the numbers can be tested without any
 * of them.
 */

/** Millimetres per pixel, from a circle dragged over the coin. */
export function mmPerPx(coinRadiusPx, coinMm) {
  if (!(coinRadiusPx > 0) || !(coinMm > 0)) return null
  return coinMm / (coinRadiusPx * 2)
}

/**
 * The area inside a closed path, by the shoelace formula.
 *
 * Absolute value, because a path traced clockwise and one traced anticlockwise
 * describe the same patch of skin and only differ in sign.
 */
export function polygonAreaPx(points = []) {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/** The longest straight line between any two points on the outline. */
export function maxCaliperPx(points = []) {
  let best = 0
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x
      const dy = points[i].y - points[j].y
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > best) best = d
    }
  }
  return best
}

/**
 * Everything a traced outline is worth, in real units.
 *
 * Two different diameters come out of this and they answer different
 * questions. `diameterMm` is the widest point, which is what a clinician means
 * by "how big is it" and what the score bands are written against.
 * `equivalentDiameterMm` is the diameter a circle of the same area would have,
 * which is the fairer number to compare two differently-shaped marks by.
 */
export function traceMeasurements(points = [], { coinRadiusPx, coinMm } = {}) {
  const scale = mmPerPx(coinRadiusPx, coinMm)
  if (!scale || points.length < 3) return null
  const areaPx = polygonAreaPx(points)
  const areaMm2 = areaPx * scale * scale
  const widest = maxCaliperPx(points) * scale
  const equivalent = 2 * Math.sqrt(areaMm2 / Math.PI)
  return {
    areaMm2: Math.round(areaMm2 * 10) / 10,
    diameterMm: Math.round(widest * 10) / 10,
    equivalentDiameterMm: Math.round(equivalent * 10) / 10,
    mmPerPx: scale,
  }
}

/** Thin a finger path so it stores and redraws cheaply, keeping its shape. */
export function simplify(points = [], minDistPx = 3) {
  if (points.length < 3) return points
  const out = [points[0]]
  for (const p of points.slice(1)) {
    const last = out.at(-1)
    const dx = p.x - last.x
    const dy = p.y - last.y
    if (Math.sqrt(dx * dx + dy * dy) >= minDistPx) out.push(p)
  }
  if (out.length < 3) return points
  return out
}

/** An SVG path string for an outline, for overlaying it on the next photo. */
export function toPath(points = []) {
  if (points.length < 2) return ''
  return `M ${points.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')} Z`
}
const round = (n) => Math.round(n * 10) / 10

/**
 * Put an old outline onto a new photo.
 *
 * Traces are stored in the pixel space of the photo they were drawn on, and
 * two photos of the same mark are rarely the same size, so an outline drawn on
 * one has to be rescaled before it means anything on another. Rescaling by the
 * coin rather than by the image keeps it honest: the overlay then shows the
 * old mark at its true size against the new one, which is the entire point of
 * drawing it.
 */
export function rescaleTrace(points = [], fromMmPerPx, toMmPerPx, origin = { x: 0, y: 0 }) {
  if (!points.length || !(fromMmPerPx > 0) || !(toMmPerPx > 0)) return points
  const k = fromMmPerPx / toMmPerPx
  const cx = points.reduce((n, p) => n + p.x, 0) / points.length
  const cy = points.reduce((n, p) => n + p.y, 0) / points.length
  return points.map((p) => ({
    x: origin.x + (p.x - cx) * k,
    y: origin.y + (p.y - cy) * k,
  }))
}

/** A plain-English sanity note on a trace, shown under the number. */
export function traceSanity(m) {
  if (!m) return 'Fit the circle to the coin, then trace the edge of the redness.'
  if (m.diameterMm < 2) return 'That looks very small — check the circle is on the coin.'
  if (m.diameterMm > 200) return 'That looks very large — check the circle is on the coin, not the redness.'
  return null
}
