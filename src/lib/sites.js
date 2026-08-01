// Injection-site rotation. ~16 sites on a front-view body map. Recency-driven
// suggestion is real harm-reduction (avoids lipohypertrophy / scar tissue).
import { daysBetween } from './schedule'

// The map is drawn as if you're looking DOWN at your own body, so left on the
// picture is your left. x/y are coordinates on the 0..100 × 0..130 body SVG.
//
// `n` is the number printed on the target, `short` is the scannable label and
// `plain` is the sentence a first-time injector needs: where to put the needle,
// described by body landmarks rather than by the picture.

// Navel position and the radius of the "keep clear" ring around it, in SVG
// units. The ring is ~2 inches / 5 cm at this body scale — every belly site
// below sits outside it.
export const NAVEL = { x: 50, y: 55 }
export const KEEP_CLEAR_R = 8

export const SITES = [
  // belly — 6 around the navel, all ≥ 2 in / 5 cm clear of it
  { id: 'abd-ul', n: 1, region: 'abdomen', label: 'Abdomen upper-left', short: 'Belly · upper-left', x: 41, y: 46,
    plain: 'Two finger-widths up and to the left of your belly button.', neighbors: ['abd-ur', 'abd-ml'] },
  { id: 'abd-ur', n: 2, region: 'abdomen', label: 'Abdomen upper-right', short: 'Belly · upper-right', x: 59, y: 46,
    plain: 'Two finger-widths up and to the right of your belly button.', neighbors: ['abd-ul', 'abd-mr'] },
  { id: 'abd-ml', n: 3, region: 'abdomen', label: 'Abdomen mid-left', short: 'Belly · mid-left', x: 38, y: 55,
    plain: 'Two finger-widths to the left of your belly button, level with it.', neighbors: ['abd-ul', 'abd-ll', 'lh-l'] },
  { id: 'abd-mr', n: 4, region: 'abdomen', label: 'Abdomen mid-right', short: 'Belly · mid-right', x: 62, y: 55,
    plain: 'Two finger-widths to the right of your belly button, level with it.', neighbors: ['abd-ur', 'abd-lr', 'lh-r'] },
  { id: 'abd-ll', n: 5, region: 'abdomen', label: 'Abdomen lower-left', short: 'Belly · lower-left', x: 41, y: 64,
    plain: 'Two finger-widths down and to the left of your belly button.', neighbors: ['abd-ml', 'abd-lr'] },
  { id: 'abd-lr', n: 6, region: 'abdomen', label: 'Abdomen lower-right', short: 'Belly · lower-right', x: 59, y: 64,
    plain: 'Two finger-widths down and to the right of your belly button.', neighbors: ['abd-mr', 'abd-ll'] },
  // love handles — 2
  { id: 'lh-l', n: 7, region: 'love-handle-L', label: 'Left love handle', short: 'Love handle · left', x: 33, y: 64,
    plain: 'Left side of your waist, in the soft roll just above your hip bone.', neighbors: ['abd-ml'] },
  { id: 'lh-r', n: 8, region: 'love-handle-R', label: 'Right love handle', short: 'Love handle · right', x: 67, y: 64,
    plain: 'Right side of your waist, in the soft roll just above your hip bone.', neighbors: ['abd-mr'] },
  // left thigh — 4, all between hip and knee
  { id: 'thl-uo', n: 9, region: 'thigh-L', label: 'Left thigh upper-outer', short: 'Left thigh · upper-outer', x: 38, y: 85,
    plain: 'Front of your left thigh, outer side, about a third of the way down from hip to knee.', neighbors: ['thl-ui', 'thl-lo'] },
  { id: 'thl-ui', n: 10, region: 'thigh-L', label: 'Left thigh upper-inner', short: 'Left thigh · upper-inner', x: 45.5, y: 85,
    plain: 'Front of your left thigh, inner side, about a third of the way down from hip to knee.', neighbors: ['thl-uo', 'thl-li'] },
  { id: 'thl-lo', n: 11, region: 'thigh-L', label: 'Left thigh lower-outer', short: 'Left thigh · lower-outer', x: 37.5, y: 99,
    plain: 'Front of your left thigh, outer side, halfway between hip and knee.', neighbors: ['thl-uo', 'thl-li'] },
  { id: 'thl-li', n: 12, region: 'thigh-L', label: 'Left thigh lower-inner', short: 'Left thigh · lower-inner', x: 45, y: 99,
    plain: 'Front of your left thigh, inner side, halfway between hip and knee.', neighbors: ['thl-ui', 'thl-lo'] },
  // right thigh — 4
  { id: 'thr-uo', n: 13, region: 'thigh-R', label: 'Right thigh upper-outer', short: 'Right thigh · upper-outer', x: 62, y: 85,
    plain: 'Front of your right thigh, outer side, about a third of the way down from hip to knee.', neighbors: ['thr-ui', 'thr-lo'] },
  { id: 'thr-ui', n: 14, region: 'thigh-R', label: 'Right thigh upper-inner', short: 'Right thigh · upper-inner', x: 54.5, y: 85,
    plain: 'Front of your right thigh, inner side, about a third of the way down from hip to knee.', neighbors: ['thr-uo', 'thr-li'] },
  { id: 'thr-lo', n: 15, region: 'thigh-R', label: 'Right thigh lower-outer', short: 'Right thigh · lower-outer', x: 62.5, y: 99,
    plain: 'Front of your right thigh, outer side, halfway between hip and knee.', neighbors: ['thr-ui', 'thr-li'] },
  { id: 'thr-li', n: 16, region: 'thigh-R', label: 'Right thigh lower-inner', short: 'Right thigh · lower-inner', x: 55, y: 99,
    plain: 'Front of your right thigh, inner side, halfway between hip and knee.', neighbors: ['thr-ui', 'thr-lo'] },
]

// Intramuscular sites — a different map entirely. Oil injectables go into muscle,
// not the SubQ belly/thigh fat the insulin-syringe peptides use, so they get their
// own rotation pool instead of being forced onto the wrong plane.
export const IM_SITES = [
  { id: 'im-delt-l', n: 1, region: 'delt-L', route: 'IM', label: 'Left deltoid', short: 'Left shoulder', x: 28, y: 31,
    plain: 'Meaty part of your left shoulder muscle, about three finger-widths below the bony tip of the shoulder.', neighbors: [] },
  { id: 'im-delt-r', n: 2, region: 'delt-R', route: 'IM', label: 'Right deltoid', short: 'Right shoulder', x: 72, y: 31,
    plain: 'Meaty part of your right shoulder muscle, about three finger-widths below the bony tip of the shoulder.', neighbors: [] },
  { id: 'im-glute-l', n: 3, region: 'glute-L', route: 'IM', label: 'Left glute (ventrogluteal)', short: 'Left glute', x: 32, y: 72,
    plain: 'Left upper-outer buttock — palm on your hip bone, inject in the V between your fingers.', neighbors: [] },
  { id: 'im-glute-r', n: 4, region: 'glute-R', route: 'IM', label: 'Right glute (ventrogluteal)', short: 'Right glute', x: 68, y: 72,
    plain: 'Right upper-outer buttock — palm on your hip bone, inject in the V between your fingers.', neighbors: [] },
  { id: 'im-quad-l', n: 5, region: 'quad-L', route: 'IM', label: 'Left quad (vastus lateralis)', short: 'Left quad', x: 39, y: 90,
    plain: 'Outer front of your left thigh, halfway between hip and knee — the thick muscle you can grip.', neighbors: [] },
  { id: 'im-quad-r', n: 6, region: 'quad-R', route: 'IM', label: 'Right quad (vastus lateralis)', short: 'Right quad', x: 61, y: 90,
    plain: 'Outer front of your right thigh, halfway between hip and knee — the thick muscle you can grip.', neighbors: [] },
]

export const ALL_SITES = [...SITES, ...IM_SITES]

export const SITE_BY_ID = Object.fromEntries(ALL_SITES.map((s) => [s.id, s]))

// Which rotation map a peptide draws from. Anything not explicitly IM uses the
// SubQ map, so every existing peptide keeps the map it has always had.
export function sitesForRoute(route) {
  return route === 'IM' ? IM_SITES : SITES
}

// Region groupings drive the zoom view: tap a region, get just that patch of
// the body enlarged with its spots numbered and described.
export const SUBQ_REGIONS = [
  { id: 'belly', label: 'Belly', hint: 'Around your belly button', view: '30 38 40 32', regions: ['abdomen'] },
  { id: 'love', label: 'Love handles', hint: 'Sides of your waist', view: '24 54 52 20', regions: ['love-handle-L', 'love-handle-R'] },
  { id: 'thigh-l', label: 'Left thigh', hint: 'Hip to knee', view: '30 76 24 32', regions: ['thigh-L'] },
  { id: 'thigh-r', label: 'Right thigh', hint: 'Hip to knee', view: '46 76 24 32', regions: ['thigh-R'] },
]

export const IM_REGIONS = [
  { id: 'shoulders', label: 'Shoulders', hint: 'Deltoid muscle', view: '18 20 64 24', regions: ['delt-L', 'delt-R'] },
  { id: 'glutes', label: 'Glutes', hint: 'Upper-outer buttock', view: '24 62 52 22', regions: ['glute-L', 'glute-R'] },
  { id: 'quads', label: 'Quads', hint: 'Outer front of thigh', view: '30 80 40 22', regions: ['quad-L', 'quad-R'] },
]

export function regionsForRoute(route) {
  return route === 'IM' ? IM_REGIONS : SUBQ_REGIONS
}

export function sitesInRegionGroup(group, route) {
  return sitesForRoute(route).filter((s) => group.regions.includes(s.region))
}

export const REGION_LABEL = {
  abdomen: 'Abdomen', 'love-handle-L': 'Left love handle', 'love-handle-R': 'Right love handle',
  'thigh-L': 'Left thigh', 'thigh-R': 'Right thigh',
  'delt-L': 'Left deltoid', 'delt-R': 'Right deltoid',
  'glute-L': 'Left glute', 'glute-R': 'Right glute',
  'quad-L': 'Left quad', 'quad-R': 'Right quad',
}

// Most-recent use time (ms) per site id from the dose log.
export function lastUsedMap(doseLogs) {
  const m = {}
  for (const log of doseLogs) {
    if (!log.siteId) continue
    const ts = log.loggedAt || (log.date ? `${log.date}T12:00:00` : null)
    if (!ts) continue
    const t = new Date(ts).getTime()
    if (!m[log.siteId] || t > m[log.siteId]) m[log.siteId] = t
  }
  return m
}

// Whole-day resolution "days since last used" for a site (null = never used).
export function daysSince(siteId, doseLogs, todayStr) {
  let latest = null
  for (const log of doseLogs) {
    if (log.siteId !== siteId || !log.date) continue
    if (!latest || log.date > latest) latest = log.date
  }
  if (!latest) return null
  return Math.max(0, daysBetween(latest, todayStr))
}

// Recency status for colour-coding.
export function siteStatus(siteId, doseLogs, todayStr) {
  const d = daysSince(siteId, doseLogs, todayStr)
  if (d == null) return { level: 'fresh', days: null }       // never used → best
  if (d <= 1) return { level: 'blocked', days: d }           // today/yesterday
  if (d <= 4) return { level: 'warm', days: d }              // resting
  return { level: 'rested', days: d }                        // well-rested
}

// The most-recently used site overall (to avoid it + neighbours).
export function lastUsedSite(doseLogs) {
  const m = lastUsedMap(doseLogs)
  let best = null, bestT = -1
  for (const [id, t] of Object.entries(m)) {
    if (t > bestT) { bestT = t; best = id }
  }
  return best
}

// Suggest the longest-rested site, avoiding the last-used site and its
// immediate neighbours. Never-used sites count as maximally rested.
// `route` selects which map to rotate within — an IM shot must not be steered
// onto a SubQ site, and vice versa.
export function suggestSite(doseLogs, todayStr, route) {
  const sites = sitesForRoute(route)
  const inPool = new Set(sites.map((s) => s.id))
  // "last used" only counts within this route's own pool
  const last = lastUsedSite(doseLogs.filter((l) => inPool.has(l.siteId)))
  const avoid = new Set()
  if (last) {
    avoid.add(last)
    for (const n of SITE_BY_ID[last]?.neighbors || []) avoid.add(n)
  }
  const score = (id) => {
    const d = daysSince(id, doseLogs, todayStr)
    return d == null ? Infinity : d
  }
  const candidates = sites.filter((s) => !avoid.has(s.id))
  const pool = candidates.length ? candidates : sites
  let best = pool[0]
  for (const s of pool) {
    if (score(s.id) > score(best.id)) best = s
  }
  return best.id
}

// ---- plain-language readouts ----
// Recency in words, so nobody has to decode a colour to answer "have I used
// this recently?".
export function daysWords(days) {
  if (days == null) return 'never used'
  if (days === 0) return 'used today'
  if (days === 1) return 'used yesterday'
  return `used ${days} days ago`
}

export function restedWords(days) {
  if (days == null) return 'never used — fully rested'
  if (days === 0) return 'used today'
  if (days === 1) return 'used yesterday'
  return `${days} days rested`
}

// "Last shot: yesterday — Right thigh · outer" for the banner.
export function lastShot(doseLogs, todayStr, route) {
  const pool = new Set(sitesForRoute(route).map((s) => s.id))
  const mine = doseLogs.filter((l) => l.siteId && pool.has(l.siteId))
  if (!mine.length) return null
  const latest = mine.reduce((a, b) =>
    String(b.loggedAt || b.date).localeCompare(String(a.loggedAt || a.date)) > 0 ? b : a)
  const site = SITE_BY_ID[latest.siteId]
  const days = daysSince(latest.siteId, doseLogs, todayStr)
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
  return { siteId: latest.siteId, site, days, when, label: site?.short || site?.label || latest.siteId }
}

// One line explaining why a spot is the recommendation.
export function suggestionReason(siteId, doseLogs, todayStr) {
  const d = daysSince(siteId, doseLogs, todayStr)
  if (d == null) return "you've never used this one — fully rested"
  return `furthest from your recent shots — ${d} days rested`
}

// "7 days no site repeat" — perfect rotation over the last 7 logged injections.
export function perfectRotation(doseLogs, todayStr) {
  const recent = doseLogs
    .filter((l) => l.siteId && l.date && daysBetween(l.date, todayStr) <= 6)
    .sort((a, b) => (a.loggedAt || a.date).localeCompare(b.loggedAt || b.date))
  if (recent.length < 7) return false
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].siteId === recent[i - 1].siteId) return false
  }
  return true
}
