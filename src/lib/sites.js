// Injection-site rotation. ~16 sites on a front-view body map. Recency-driven
// suggestion is real harm-reduction (avoids lipohypertrophy / scar tissue).
import { daysBetween } from './schedule'

// x/y are percentages on a 0..100 viewBox of the body SVG.
export const SITES = [
  // abdomen — 6 around the navel (navel ~ 50,46)
  { id: 'abd-ul', region: 'abdomen', label: 'Abdomen upper-left', x: 42, y: 40, neighbors: ['abd-ur', 'abd-ml'] },
  { id: 'abd-ur', region: 'abdomen', label: 'Abdomen upper-right', x: 58, y: 40, neighbors: ['abd-ul', 'abd-mr'] },
  { id: 'abd-ml', region: 'abdomen', label: 'Abdomen mid-left', x: 40, y: 48, neighbors: ['abd-ul', 'abd-ll', 'lh-l'] },
  { id: 'abd-mr', region: 'abdomen', label: 'Abdomen mid-right', x: 60, y: 48, neighbors: ['abd-ur', 'abd-lr', 'lh-r'] },
  { id: 'abd-ll', region: 'abdomen', label: 'Abdomen lower-left', x: 43, y: 55, neighbors: ['abd-ml', 'abd-lr'] },
  { id: 'abd-lr', region: 'abdomen', label: 'Abdomen lower-right', x: 57, y: 55, neighbors: ['abd-mr', 'abd-ll'] },
  // love handles — 2
  { id: 'lh-l', region: 'love-handle-L', label: 'Left love handle', x: 30, y: 50, neighbors: ['abd-ml'] },
  { id: 'lh-r', region: 'love-handle-R', label: 'Right love handle', x: 70, y: 50, neighbors: ['abd-mr'] },
  // left thigh — 4
  { id: 'thl-uo', region: 'thigh-L', label: 'Left thigh upper-outer', x: 38, y: 68, neighbors: ['thl-ui', 'thl-lo'] },
  { id: 'thl-ui', region: 'thigh-L', label: 'Left thigh upper-inner', x: 46, y: 68, neighbors: ['thl-uo', 'thl-li'] },
  { id: 'thl-lo', region: 'thigh-L', label: 'Left thigh lower-outer', x: 37, y: 80, neighbors: ['thl-uo', 'thl-li'] },
  { id: 'thl-li', region: 'thigh-L', label: 'Left thigh lower-inner', x: 45, y: 80, neighbors: ['thl-ui', 'thl-lo'] },
  // right thigh — 4
  { id: 'thr-uo', region: 'thigh-R', label: 'Right thigh upper-outer', x: 62, y: 68, neighbors: ['thr-ui', 'thr-lo'] },
  { id: 'thr-ui', region: 'thigh-R', label: 'Right thigh upper-inner', x: 54, y: 68, neighbors: ['thr-uo', 'thr-li'] },
  { id: 'thr-lo', region: 'thigh-R', label: 'Right thigh lower-outer', x: 63, y: 80, neighbors: ['thr-ui', 'thr-li'] },
  { id: 'thr-li', region: 'thigh-R', label: 'Right thigh lower-inner', x: 55, y: 80, neighbors: ['thr-ui', 'thr-lo'] },
]

// Intramuscular sites — a different map entirely. Oil injectables go into muscle,
// not the SubQ belly/thigh fat the insulin-syringe peptides use, so they get their
// own rotation pool instead of being forced onto the wrong plane.
export const IM_SITES = [
  { id: 'im-delt-l', region: 'delt-L', route: 'IM', label: 'Left deltoid', x: 32, y: 24, neighbors: [] },
  { id: 'im-delt-r', region: 'delt-R', route: 'IM', label: 'Right deltoid', x: 68, y: 24, neighbors: [] },
  { id: 'im-glute-l', region: 'glute-L', route: 'IM', label: 'Left glute (ventrogluteal)', x: 34, y: 57, neighbors: [] },
  { id: 'im-glute-r', region: 'glute-R', route: 'IM', label: 'Right glute (ventrogluteal)', x: 66, y: 57, neighbors: [] },
  { id: 'im-quad-l', region: 'quad-L', route: 'IM', label: 'Left quad (vastus lateralis)', x: 37, y: 74, neighbors: [] },
  { id: 'im-quad-r', region: 'quad-R', route: 'IM', label: 'Right quad (vastus lateralis)', x: 63, y: 74, neighbors: [] },
]

export const ALL_SITES = [...SITES, ...IM_SITES]

export const SITE_BY_ID = Object.fromEntries(ALL_SITES.map((s) => [s.id, s]))

// Which rotation map a peptide draws from. Anything not explicitly IM uses the
// SubQ map, so every existing peptide keeps the map it has always had.
export function sitesForRoute(route) {
  return route === 'IM' ? IM_SITES : SITES
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
