/**
 * Where a shot can go, and what each place is called.
 *
 * The zone list is the spine of the whole feature: site rules, the body map,
 * the side assignment and half the analysis all key off these ids, so they are
 * static and never generated. Coordinates are percentages of a 100x200 body
 * box, which lets the map scale to any width without the zones drifting off
 * the figure.
 *
 * Abdominal zones deliberately start 5 cm out from the navel. That is the
 * standard subcutaneous margin and it is baked into the geometry rather than
 * left as advice nobody reads.
 */

export const VIEWS = ['front', 'back']

/** side: 'L' | 'R' | null (midline). group: what the side assignment moves in bulk. */
export const ZONES = [
  // ---------------------------------------------------------------- abdomen
  { id: 'abd-ul-in', label: 'Upper left abdomen, inner', short: 'Upper L inner', view: 'front', side: 'L', group: 'abdomen', x: 42, y: 74, w: 12, h: 13 },
  { id: 'abd-ul-out', label: 'Upper left abdomen, outer', short: 'Upper L outer', view: 'front', side: 'L', group: 'abdomen', x: 28, y: 74, w: 13, h: 13 },
  { id: 'abd-ur-in', label: 'Upper right abdomen, inner', short: 'Upper R inner', view: 'front', side: 'R', group: 'abdomen', x: 56, y: 74, w: 12, h: 13 },
  { id: 'abd-ur-out', label: 'Upper right abdomen, outer', short: 'Upper R outer', view: 'front', side: 'R', group: 'abdomen', x: 69, y: 74, w: 13, h: 13 },
  { id: 'abd-ll-in', label: 'Lower left abdomen, inner', short: 'Lower L inner', view: 'front', side: 'L', group: 'abdomen', x: 42, y: 89, w: 12, h: 13 },
  { id: 'abd-ll-out', label: 'Lower left abdomen, outer', short: 'Lower L outer', view: 'front', side: 'L', group: 'abdomen', x: 28, y: 89, w: 13, h: 13 },
  { id: 'abd-lr-in', label: 'Lower right abdomen, inner', short: 'Lower R inner', view: 'front', side: 'R', group: 'abdomen', x: 56, y: 89, w: 12, h: 13 },
  { id: 'abd-lr-out', label: 'Lower right abdomen, outer', short: 'Lower R outer', view: 'front', side: 'R', group: 'abdomen', x: 69, y: 89, w: 13, h: 13 },

  // ------------------------------------------------------------ love handles
  { id: 'flank-l', label: 'Left love handle', short: 'Love handle L', view: 'front', side: 'L', group: 'flank', x: 19, y: 80, w: 8, h: 16 },
  { id: 'flank-r', label: 'Right love handle', short: 'Love handle R', view: 'front', side: 'R', group: 'flank', x: 83, y: 80, w: 8, h: 16 },

  // ------------------------------------------------------------------ thighs
  { id: 'thigh-l-up', label: 'Left front thigh, upper', short: 'Thigh L upper', view: 'front', side: 'L', group: 'thigh', x: 33, y: 116, w: 14, h: 16 },
  { id: 'thigh-l-lo', label: 'Left front thigh, lower', short: 'Thigh L lower', view: 'front', side: 'L', group: 'thigh', x: 33, y: 134, w: 14, h: 16 },
  { id: 'thigh-r-up', label: 'Right front thigh, upper', short: 'Thigh R upper', view: 'front', side: 'R', group: 'thigh', x: 63, y: 116, w: 14, h: 16 },
  { id: 'thigh-r-lo', label: 'Right front thigh, lower', short: 'Thigh R lower', view: 'front', side: 'R', group: 'thigh', x: 63, y: 134, w: 14, h: 16 },
  { id: 'thigh-l-out', label: 'Left outer thigh', short: 'Outer thigh L', view: 'front', side: 'L', group: 'thigh', x: 22, y: 118, w: 10, h: 30 },
  { id: 'thigh-r-out', label: 'Right outer thigh', short: 'Outer thigh R', view: 'front', side: 'R', group: 'thigh', x: 78, y: 118, w: 10, h: 30 },

  // ------------------------------------------------------------------- back
  { id: 'glute-l', label: 'Left glute, upper outer', short: 'Glute L', view: 'back', side: 'L', group: 'glute', x: 26, y: 100, w: 18, h: 16 },
  { id: 'glute-r', label: 'Right glute, upper outer', short: 'Glute R', view: 'back', side: 'R', group: 'glute', x: 56, y: 100, w: 18, h: 16 },
  { id: 'arm-l', label: 'Back of left arm', short: 'Back of arm L', view: 'back', side: 'L', group: 'arm', x: 12, y: 66, w: 11, h: 20 },
  { id: 'arm-r', label: 'Back of right arm', short: 'Back of arm R', view: 'back', side: 'R', group: 'arm', x: 77, y: 66, w: 11, h: 20 },
]

export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]))

export const ZONE_GROUPS = [
  { id: 'abdomen', label: 'Abdomen' },
  { id: 'flank', label: 'Love handles' },
  { id: 'thigh', label: 'Thighs' },
  { id: 'glute', label: 'Glutes' },
  { id: 'arm', label: 'Back of arms' },
]

export function zonesOn(view) {
  return ZONES.filter((z) => z.view === view)
}

export function zonesForSide(side) {
  return ZONES.filter((z) => z.side === side)
}

export function zonesInGroup(group) {
  return ZONES.filter((z) => z.group === group)
}

/** The label a one-line instruction uses: "left lower abdomen". */
export function zoneWords(zoneId) {
  const z = ZONE_BY_ID[zoneId]
  return z ? z.label.toLowerCase() : 'a site'
}

// -------------------------------------------------------- side assignment

/**
 * Which zones a compound is allowed to use.
 *
 * The point of splitting the suspects onto opposite sides is that a reaction
 * then names one of them without any further reasoning: it happened on the
 * left, only one thing goes on the left. It is the cheapest experiment in the
 * whole investigation and it costs nothing to run, which is why it is the
 * default rather than an option.
 */
export const SIDE_SETS = {
  'left-abdomen': { label: 'Left abdomen and flank', zones: ZONES.filter((z) => z.side === 'L' && (z.group === 'abdomen' || z.group === 'flank')).map((z) => z.id) },
  'right-abdomen': { label: 'Right abdomen and flank', zones: ZONES.filter((z) => z.side === 'R' && (z.group === 'abdomen' || z.group === 'flank')).map((z) => z.id) },
  thighs: { label: 'Thighs', zones: ZONES.filter((z) => z.group === 'thigh').map((z) => z.id) },
  glutes: { label: 'Glutes', zones: ZONES.filter((z) => z.group === 'glute').map((z) => z.id) },
  arms: { label: 'Back of arms', zones: ZONES.filter((z) => z.group === 'arm').map((z) => z.id) },
  any: { label: 'Anywhere', zones: ZONES.map((z) => z.id) },
}

export const SIDE_SET_IDS = Object.keys(SIDE_SETS)

/** Zones a compound may use under the current assignment. Unassigned = thighs. */
export function allowedZones(compoundId, sideAssignment = {}) {
  const setId = sideAssignment[compoundId]
  if (!setId) return SIDE_SETS.thighs.zones
  return SIDE_SETS[setId]?.zones || SIDE_SETS.any.zones
}

/** Is this zone allowed for this compound? A compound with no rule is free. */
export function zoneAllowedFor(compoundId, zoneId, sideAssignment = {}) {
  if (!sideAssignment[compoundId]) return true
  return allowedZones(compoundId, sideAssignment).includes(zoneId)
}

/**
 * The starting assignment: the two prime suspects onto opposite sides, and
 * anything that carries one of them onto the same side as the thing it carries.
 */
export function defaultSideAssignment(suspects = [], componentsOf = () => []) {
  const out = {}
  for (const id of suspects) {
    const parts = [id, ...componentsOf(id)].map((x) => String(x).toLowerCase())
    const hasMots = parts.some((x) => x.includes('mots'))
    const hasGhk = parts.some((x) => x.includes('ghk'))
    if (hasMots && !hasGhk) out[id] = 'left-abdomen'
    else if (hasGhk) out[id] = 'right-abdomen'
    else out[id] = 'thighs'
  }
  return out
}

// ------------------------------------------------------------ calibration

/** Coins people actually have in their pocket, by outside diameter. */
export const COINS = [
  { id: 'aud-20c', label: 'AUD 20c', mm: 28.52 },
  { id: 'aud-1', label: 'AUD $1', mm: 25.00 },
  { id: 'aud-10c', label: 'AUD 10c', mm: 23.60 },
  { id: 'aud-5c', label: 'AUD 5c', mm: 19.41 },
]
export const COIN_BY_ID = Object.fromEntries(COINS.map((c) => [c.id, c]))
export const DEFAULT_COIN = 'aud-20c'
