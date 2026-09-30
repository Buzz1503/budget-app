/**
 * Where a shot can go, on a photograph of the actual body.
 *
 * Coordinates are percentages of the FULL composite image — front view on the
 * left half, back view on the right — because that is the one frame of
 * reference that survives the image being replaced, re-cropped or shown at any
 * width. Everything else here converts out of it.
 *
 * Two conventions matter and are easy to get wrong:
 *
 *  - `side` is the *person's* left and right, never the viewer's. On the front
 *    view the person's right hand is on the viewer's left; on the back it is
 *    the other way round. Storing the viewer's side would silently mirror every
 *    finding about which side reacts.
 *
 *  - Vertical distances depend on the image's aspect ratio, because y is a
 *    percentage of height while x is a percentage of width. Two pins 4% apart
 *    vertically are further apart on a tall image than a wide one, so the
 *    aspect ratio is a stated constant rather than an assumption buried in the
 *    arithmetic.
 */

/** Person fills the frame; two such figures side by side. Height ÷ width. */
export const COMPOSITE_ASPECT = 1.2

export const VIEWS = ['front', 'back']

/** The part of the composite each view shows, as % of the whole image. */
export const WINDOWS = {
  front: { x0: 8, x1: 46, y0: 29, y1: 71 },
  back: { x0: 54, x1: 94, y0: 34, y1: 60 },
}

/** Midlines, for deciding which side of the body a point is on. */
export const MIDLINE = { front: 26.8, back: 75 }

/** Navel centre, as % of the composite. Nothing goes within 5 cm of it. */
export const NAVEL = { x: 26.8, y: 43.2 }

/** 5 cm, expressed as a share of the composite's width. */
export const NAVEL_CLEARANCE_PCT = 3.6

/** Screen rules, in CSS pixels at a 390px-wide viewport. */
export const SCREEN_WIDTH = 390
export const MIN_SPACING_PX = 44
export const EDGE_MARGIN_PX = 22
export const PIN_DIAMETER_PX = 18

export const GROUPS = [
  { id: 'abdomen', label: 'Abdomen' },
  { id: 'thigh', label: 'Thigh' },
  { id: 'flank', label: 'Flank' },
  { id: 'glute', label: 'Glute' },
]
export const GROUP_IDS = GROUPS.map((g) => g.id)

/**
 * The thirty sites.
 *
 * `x`/`y` are % of the composite. `side` is anatomical. `view` says which
 * window the pin belongs to, which is derived from x but written down so a
 * mis-typed coordinate cannot silently move a pin to the other half.
 */
export const PINS = [
  // ------------------------------------------------ front · abdomen (12)
  { id: 'abd-r-upper-outer', x: 17.2, y: 35.2, view: 'front', group: 'abdomen', side: 'r', label: 'Right abdomen, upper outer' },
  { id: 'abd-r-upper-inner', x: 21.9, y: 35.2, view: 'front', group: 'abdomen', side: 'r', label: 'Right abdomen, upper inner' },
  { id: 'abd-l-upper-inner', x: 30.8, y: 35.2, view: 'front', group: 'abdomen', side: 'l', label: 'Left abdomen, upper inner' },
  { id: 'abd-l-upper-outer', x: 35.6, y: 35.2, view: 'front', group: 'abdomen', side: 'l', label: 'Left abdomen, upper outer' },
  { id: 'abd-r-mid-outer', x: 16.6, y: 38.9, view: 'front', group: 'abdomen', side: 'r', label: 'Right abdomen, mid outer' },
  { id: 'abd-r-mid-inner', x: 21.6, y: 38.9, view: 'front', group: 'abdomen', side: 'r', label: 'Right abdomen, mid inner' },
  { id: 'abd-l-mid-inner', x: 31.1, y: 38.9, view: 'front', group: 'abdomen', side: 'l', label: 'Left abdomen, mid inner' },
  { id: 'abd-l-mid-outer', x: 36.2, y: 38.9, view: 'front', group: 'abdomen', side: 'l', label: 'Left abdomen, mid outer' },
  { id: 'abd-r-navel-outer', x: 16.6, y: 42.7, view: 'front', group: 'abdomen', side: 'r', label: 'Right abdomen, beside navel outer' },
  { id: 'abd-r-navel-inner', x: 21.4, y: 42.7, view: 'front', group: 'abdomen', side: 'r', label: 'Right abdomen, beside navel inner' },
  { id: 'abd-l-navel-inner', x: 31.3, y: 42.7, view: 'front', group: 'abdomen', side: 'l', label: 'Left abdomen, beside navel inner' },
  { id: 'abd-l-navel-outer', x: 36.3, y: 42.7, view: 'front', group: 'abdomen', side: 'l', label: 'Left abdomen, beside navel outer' },

  // -------------------------------------------------- front · thighs (10)
  { id: 'thigh-r-front-upper', x: 18.7, y: 56.8, view: 'front', group: 'thigh', side: 'r', label: 'Right thigh, front upper' },
  { id: 'thigh-r-front-mid', x: 19.0, y: 62.1, view: 'front', group: 'thigh', side: 'r', label: 'Right thigh, front mid' },
  { id: 'thigh-r-front-lower', x: 19.3, y: 66.1, view: 'front', group: 'thigh', side: 'r', label: 'Right thigh, front lower' },
  { id: 'thigh-r-outer-upper', x: 13.6, y: 58.1, view: 'front', group: 'thigh', side: 'r', label: 'Right thigh, outer upper' },
  { id: 'thigh-r-outer-mid', x: 14.2, y: 63.4, view: 'front', group: 'thigh', side: 'r', label: 'Right thigh, outer mid' },
  { id: 'thigh-l-front-upper', x: 34.2, y: 56.8, view: 'front', group: 'thigh', side: 'l', label: 'Left thigh, front upper' },
  { id: 'thigh-l-front-mid', x: 34.0, y: 62.1, view: 'front', group: 'thigh', side: 'l', label: 'Left thigh, front mid' },
  { id: 'thigh-l-front-lower', x: 33.7, y: 66.1, view: 'front', group: 'thigh', side: 'l', label: 'Left thigh, front lower' },
  { id: 'thigh-l-outer-upper', x: 39.4, y: 58.1, view: 'front', group: 'thigh', side: 'l', label: 'Left thigh, outer upper' },
  { id: 'thigh-l-outer-mid', x: 38.9, y: 63.4, view: 'front', group: 'thigh', side: 'l', label: 'Left thigh, outer mid' },

  // --------------------------------------------------- back · flanks (2)
  { id: 'flank-l', x: 63.2, y: 41.2, view: 'back', group: 'flank', side: 'l', label: 'Left flank' },
  { id: 'flank-r', x: 86.8, y: 41.2, view: 'back', group: 'flank', side: 'r', label: 'Right flank' },

  // --------------------------------------------------- back · glutes (6)
  { id: 'glute-l-upper-outer', x: 65.6, y: 47.6, view: 'back', group: 'glute', side: 'l', label: 'Left glute, upper outer' },
  { id: 'glute-l-upper-inner', x: 70.6, y: 46.5, view: 'back', group: 'glute', side: 'l', label: 'Left glute, upper inner' },
  { id: 'glute-l-outer-mid', x: 65.0, y: 51.8, view: 'back', group: 'glute', side: 'l', label: 'Left glute, outer mid' },
  { id: 'glute-r-upper-outer', x: 84.5, y: 47.6, view: 'back', group: 'glute', side: 'r', label: 'Right glute, upper outer' },
  { id: 'glute-r-upper-inner', x: 79.5, y: 46.5, view: 'back', group: 'glute', side: 'r', label: 'Right glute, upper inner' },
  { id: 'glute-r-outer-mid', x: 85.1, y: 51.8, view: 'back', group: 'glute', side: 'r', label: 'Right glute, outer mid' },
]

export const PIN_BY_ID = Object.fromEntries(PINS.map((p) => [p.id, p]))

export const SIDE_WORD = { l: 'Left', r: 'Right' }

// ------------------------------------------------------------- geometry

/**
 * How many screen pixels one percent of the composite's *width* is worth.
 *
 * The window is scaled so its width fills the viewport, and the scaling is
 * uniform, so this one number converts both axes once the aspect ratio has been
 * applied to y.
 */
export function pxPerXPct(view, screenWidth = SCREEN_WIDTH) {
  const w = WINDOWS[view]
  if (!w) return 0
  return screenWidth / (w.x1 - w.x0)
}

/** One percent of *height*, in the same screen pixels. */
export function pxPerYPct(view, screenWidth = SCREEN_WIDTH, aspect = COMPOSITE_ASPECT) {
  return pxPerXPct(view, screenWidth) * aspect
}

/** A pin's position inside its window, in screen pixels. */
export function toScreen(pin, { screenWidth = SCREEN_WIDTH, aspect = COMPOSITE_ASPECT } = {}) {
  const w = WINDOWS[pin.view]
  if (!w) return null
  return {
    x: (pin.x - w.x0) * pxPerXPct(pin.view, screenWidth),
    y: (pin.y - w.y0) * pxPerYPct(pin.view, screenWidth, aspect),
  }
}

/** The inverse: a point in window pixels back to composite percentages. */
export function fromScreen(view, point, { screenWidth = SCREEN_WIDTH, aspect = COMPOSITE_ASPECT } = {}) {
  const w = WINDOWS[view]
  if (!w) return null
  return {
    x: w.x0 + point.x / pxPerXPct(view, screenWidth),
    y: w.y0 + point.y / pxPerYPct(view, screenWidth, aspect),
  }
}

/** The displayed height of a window at a given width. */
export function windowHeightPx(view, screenWidth = SCREEN_WIDTH, aspect = COMPOSITE_ASPECT) {
  const w = WINDOWS[view]
  if (!w) return 0
  return (w.y1 - w.y0) * pxPerYPct(view, screenWidth, aspect)
}

/** Distance between two pins on screen. */
export function spacingPx(a, b, opts = {}) {
  if (a.view !== b.view) return Infinity
  const pa = toScreen(a, opts)
  const pb = toScreen(b, opts)
  return Math.hypot(pa.x - pb.x, pa.y - pb.y)
}

/** Distance from a point to the navel, as a share of the composite's width. */
export function navelDistancePct(pin, aspect = COMPOSITE_ASPECT) {
  const dx = pin.x - NAVEL.x
  const dy = (pin.y - NAVEL.y) * aspect
  return Math.hypot(dx, dy)
}

/** How far inside its window a pin sits, in screen pixels. */
export function edgeMarginPx(pin, opts = {}) {
  const w = WINDOWS[pin.view]
  if (!w) return 0
  const { screenWidth = SCREEN_WIDTH, aspect = COMPOSITE_ASPECT } = opts
  const kx = pxPerXPct(pin.view, screenWidth)
  const ky = pxPerYPct(pin.view, screenWidth, aspect)
  return Math.min(
    (pin.x - w.x0) * kx, (w.x1 - pin.x) * kx,
    (pin.y - w.y0) * ky, (w.y1 - pin.y) * ky,
  )
}

/** Which side of the body a coordinate falls on, given the view. */
export function sideAt(view, x) {
  const mid = MIDLINE[view]
  // front: the person's right is on the viewer's left. back: reversed.
  if (view === 'front') return x < mid ? 'r' : 'l'
  return x < mid ? 'l' : 'r'
}

// ----------------------------------------------------------- overrides

/**
 * The pins as they actually stand, with any hand-adjusted positions applied.
 *
 * An override moves a pin but never changes what it is: the id, group, label
 * and side come from the table, so nudging a pin two millimetres cannot
 * accidentally relabel it or move it to the other side of the body.
 */
export function pinsWith(overrides = {}) {
  return PINS.map((p) => {
    const o = overrides[p.id]
    if (!o || o.x == null || o.y == null) return p
    return { ...p, x: o.x, y: o.y, moved: true }
  })
}

export function pinsFor(view, overrides = {}) {
  return pinsWith(overrides).filter((p) => p.view === view)
}

/**
 * The pin a tap meant.
 *
 * Nearest centre wins, always. Circular hit areas of any useful size overlap
 * once pins are 44 px apart, and an overlap means a tap between two pins either
 * picks the one drawn last or picks both — neither of which is what the thumb
 * intended. Nearest-centre has no overlaps by construction and no gaps either.
 */
export function nearestPin(view, point, { overrides = {}, screenWidth = SCREEN_WIDTH, aspect = COMPOSITE_ASPECT, groups = null } = {}) {
  let pool = pinsFor(view, overrides)
  if (groups?.length) pool = pool.filter((p) => groups.includes(p.group))
  if (!pool.length) return null
  let best = null
  let bestD = Infinity
  for (const p of pool) {
    const s = toScreen(p, { screenWidth, aspect })
    const d = Math.hypot(s.x - point.x, s.y - point.y)
    if (d < bestD) { bestD = d; best = p }
  }
  return best ? { pin: best, distancePx: bestD } : null
}

/**
 * Can this pin be moved here?
 *
 * Returns the reason it cannot, so the drag can say what is wrong in one line
 * rather than simply refusing. All three limits are real: pins closer than
 * 44 px cannot be told apart by a thumb, a pin outside its window cannot be
 * seen, and a pin within 5 cm of the navel is not a subcutaneous site.
 */
export function validatePosition(pinId, pos, { overrides = {}, screenWidth = SCREEN_WIDTH, aspect = COMPOSITE_ASPECT } = {}) {
  const base = PIN_BY_ID[pinId]
  if (!base) return { ok: false, reason: 'Unknown pin.' }
  const moved = { ...base, x: pos.x, y: pos.y }
  const opts = { screenWidth, aspect }

  const w = WINDOWS[base.view]
  if (pos.x < w.x0 || pos.x > w.x1 || pos.y < w.y0 || pos.y > w.y1) {
    return { ok: false, reason: 'That is outside the visible area.' }
  }
  const margin = edgeMarginPx(moved, opts)
  if (margin < EDGE_MARGIN_PX) {
    return { ok: false, reason: 'Too close to the edge of the view.' }
  }
  if (base.group === 'abdomen') {
    const d = navelDistancePct(moved, aspect)
    if (d < NAVEL_CLEARANCE_PCT) return { ok: false, reason: 'Too close to the navel — keep 5 cm clear.' }
  }
  for (const other of pinsWith(overrides)) {
    if (other.id === pinId || other.view !== base.view) continue
    const d = spacingPx(moved, other, opts)
    if (d < MIN_SPACING_PX) {
      return { ok: false, reason: `Too close to ${other.label} — sites need ${MIN_SPACING_PX} px between them.` }
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------- checks

/**
 * Every rule, run over a whole table. The QA script and the unit tests read
 * the same function, so a build cannot pass on arithmetic the tests never saw.
 */
export function checkPins(pins = PINS, { screenWidth = SCREEN_WIDTH, aspect = COMPOSITE_ASPECT } = {}) {
  const opts = { screenWidth, aspect }
  const failures = []
  const seen = new Set()

  for (const p of pins) {
    if (seen.has(p.id)) failures.push({ check: 'unique', pin: p.id, detail: 'duplicate id' })
    seen.add(p.id)
    if (!p.group || !GROUP_IDS.includes(p.group)) failures.push({ check: 'group', pin: p.id, detail: `group "${p.group}"` })
    if (!p.label) failures.push({ check: 'label', pin: p.id, detail: 'no label' })
    if (!VIEWS.includes(p.view)) failures.push({ check: 'view', pin: p.id, detail: `view "${p.view}"` })

    const expected = sideAt(p.view, p.x)
    if (p.side !== expected) {
      failures.push({ check: 'side', pin: p.id, detail: `x ${p.x} on the ${p.view} is the person's ${SIDE_WORD[expected].toLowerCase()}, labelled ${SIDE_WORD[p.side]?.toLowerCase()}` })
    }
    // the label has to agree with the stored side, or the map lies in words
    if (p.label && !p.label.toLowerCase().startsWith(SIDE_WORD[p.side].toLowerCase())) {
      failures.push({ check: 'label-side', pin: p.id, detail: `label "${p.label}" does not start with ${SIDE_WORD[p.side]}` })
    }

    const margin = edgeMarginPx(p, opts)
    if (margin < EDGE_MARGIN_PX) {
      failures.push({ check: 'edge', pin: p.id, detail: `${margin.toFixed(1)} px from the window edge` })
    }
    if (p.group === 'abdomen') {
      const d = navelDistancePct(p, aspect)
      if (d < NAVEL_CLEARANCE_PCT) {
        failures.push({ check: 'navel', pin: p.id, detail: `${d.toFixed(2)}% of width from the navel` })
      }
    }
  }

  let minSpacing = Infinity
  let closest = null
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      if (pins[i].view !== pins[j].view) continue
      const d = spacingPx(pins[i], pins[j], opts)
      if (d < minSpacing) { minSpacing = d; closest = [pins[i].id, pins[j].id] }
      if (d < MIN_SPACING_PX) {
        failures.push({ check: 'spacing', pin: `${pins[i].id} / ${pins[j].id}`, detail: `${d.toFixed(1)} px apart` })
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    minSpacingPx: isFinite(minSpacing) ? Math.round(minSpacing * 10) / 10 : null,
    closestPair: closest,
    count: pins.length,
    aspect,
    screenWidth,
  }
}
