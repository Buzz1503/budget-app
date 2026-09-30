import { addDaysStr, daysBetween } from './schedule'
import { ZONES, ZONE_BY_ID, zoneAllowedFor, allowedZones } from './reactionZones'

/**
 * Which sites are available tonight, and which are out.
 *
 * Two different reasons a site can be unavailable, and they are not the same
 * thing. A zone that is *reacting* is out because injecting into inflamed skin
 * confounds the reading and hurts. A zone that is *resting* is out because it
 * had a shot recently and tissue needs time — that is ordinary rotation, not a
 * problem. The map colours them differently and this says which is which.
 */

export const DEFAULT_REST_DAYS = 3
export const POST_REACTION_REST_DAYS = 2

export const SITE_STATUS = {
  clear: { id: 'clear', label: 'Clear', words: 'available now' },
  reacting: { id: 'reacting', label: 'Reacting', words: 'an open reaction here' },
  resting: { id: 'resting', label: 'Resting', words: 'used recently, giving it time' },
  unused: { id: 'unused', label: 'Never used', words: 'nothing recorded here yet' },
}

/** The most recent injection into each zone. */
export function lastUseByZone(records = []) {
  const out = {}
  for (const r of records) {
    if (!r.zoneId || !r.injectedAt) continue
    const prev = out[r.zoneId]
    if (!prev || String(r.injectedAt) > String(prev.injectedAt)) out[r.zoneId] = r
  }
  return out
}

/** Open reactions keyed by the zone they are in. */
export function openReactionsByZone(reactions = [], records = []) {
  const byRecord = Object.fromEntries(records.map((r) => [r.id, r]))
  const out = {}
  for (const rx of reactions) {
    if (rx.status === 'resolved') continue
    const rec = byRecord[rx.injectionRecordId]
    if (!rec?.zoneId) continue
    ;(out[rec.zoneId] ||= []).push(rx)
  }
  return out
}

/**
 * The state of one zone today.
 *
 * `until` is the date it frees up, which is what the map needs to say "back in
 * two days" rather than just greying the zone out and leaving the user to
 * guess whether it is ever coming back.
 */
export function zoneStatus(zoneId, { records = [], reactions = [], todayStr, restDays = DEFAULT_REST_DAYS } = {}) {
  const open = openReactionsByZone(reactions, records)[zoneId] || []
  if (open.length) {
    return { status: 'reacting', until: null, reactionIds: open.map((r) => r.id), blocked: true }
  }

  const last = lastUseByZone(records)[zoneId]
  if (!last) return { status: 'unused', until: null, blocked: false, lastUsed: null }

  const lastDate = String(last.injectedAt).slice(0, 10)
  // A zone whose reaction has closed rests a little longer than an ordinary
  // one: the skin was inflamed, and "resolved" is not the same as "recovered".
  const closedHere = reactions.filter((rx) => rx.status === 'resolved' && rx.resolvedAt
    && records.find((r) => r.id === rx.injectionRecordId)?.zoneId === zoneId)
  const lastClosed = closedHere.map((rx) => String(rx.resolvedAt).slice(0, 10)).sort().at(-1)

  const restUntil = addDaysStr(lastDate, restDays)
  const reactUntil = lastClosed ? addDaysStr(lastClosed, POST_REACTION_REST_DAYS) : null
  const until = [restUntil, reactUntil].filter(Boolean).sort().at(-1)

  if (todayStr && until && daysBetween(todayStr, until) > 0) {
    return { status: 'resting', until, blocked: true, lastUsed: lastDate }
  }
  return { status: 'clear', until: null, blocked: false, lastUsed: lastDate }
}

/** Every zone's state in one pass, for the map. */
export function allZoneStatus(ctx) {
  const out = {}
  for (const z of ZONES) out[z.id] = zoneStatus(z.id, ctx)
  return out
}

/**
 * Where tonight's shot should go.
 *
 * Least recently used among what is actually available, which spreads the load
 * without anyone having to remember a rotation. A never-used zone wins outright
 * — it has the cleanest history and is the most useful place to put a shot you
 * intend to learn something from.
 */
export function nextBestSite(compoundId, ctx = {}) {
  const { sideAssignment = {}, records = [], todayStr } = ctx
  const status = allZoneStatus(ctx)
  const last = lastUseByZone(records)

  // allowedZones, not zoneAllowedFor: the latter is permissive by design so it
  // does not warn about a compound nobody has assigned, but a *suggestion* has
  // to land somewhere specific, and the brief's default for anything without a
  // rule of its own is the thighs.
  const allowed = allowedZones(compoundId, sideAssignment)
  const taken = new Set(ctx.excludeZones || [])
  const permitted = ZONES.filter((z) => allowed.includes(z.id) && !taken.has(z.id))
  const free = permitted.filter((z) => !status[z.id].blocked)
  if (!free.length) {
    // nothing legal is free: say so rather than quietly suggesting a blocked one
    return {
      zoneId: null,
      reason: permitted.length
        ? 'every allowed site is resting or reacting'
        : taken.size
          ? 'the other shots tonight have taken every allowed site'
          : 'no sites are assigned to this compound',
    }
  }

  const unused = free.filter((z) => status[z.id].status === 'unused')
  const pool = unused.length ? unused : free
  const pick = pool.slice().sort((a, b) => {
    const la = last[a.id]?.injectedAt || ''
    const lb = last[b.id]?.injectedAt || ''
    return String(la).localeCompare(String(lb)) || a.id.localeCompare(b.id)
  })[0]

  return {
    zoneId: pick.id,
    reason: status[pick.id].status === 'unused'
      ? 'never used'
      : `least recently used${last[pick.id] ? ` · last ${String(last[pick.id].injectedAt).slice(0, 10)}` : ''}`,
    todayStr,
  }
}

/** Why a zone cannot be picked, in one line — shown on the override warning. */
export function blockReason(zoneId, ctx) {
  const st = zoneStatus(zoneId, ctx)
  if (st.status === 'reacting') return 'There is an open reaction here. Injecting into inflamed skin muddles the result and will hurt.'
  if (st.status === 'resting') return `This site is resting until ${st.until}. Tissue needs time between shots.`
  return null
}

/** Is this compound allowed here under the side assignment? */
export function sideWarning(compoundId, zoneId, sideAssignment = {}) {
  if (zoneAllowedFor(compoundId, zoneId, sideAssignment)) return null
  const allowed = allowedZones(compoundId, sideAssignment)
    .map((id) => ZONE_BY_ID[id]?.short).filter(Boolean)
  return `The investigation has this compound on ${allowed.slice(0, 2).join(' / ')}. Injecting elsewhere breaks the side split and this shot will not count towards the result.`
}

// -------------------------------------------------------------- site detail

/** Every injection into one zone, newest first, with its reaction if any. */
export function zoneHistory(zoneId, { records = [], reactions = [] } = {}) {
  return records
    .filter((r) => r.zoneId === zoneId)
    .sort((a, b) => String(b.injectedAt).localeCompare(String(a.injectedAt)))
    .map((r) => ({ record: r, reaction: reactions.find((rx) => rx.injectionRecordId === r.id) || null }))
}

/** How this zone compares with the rest, which is the only reason to average. */
export function zoneVsOverall(zoneId, { records = [], reactions = [], scoreOf }) {
  const scored = (list) => list
    .map((r) => reactions.find((rx) => rx.injectionRecordId === r.id))
    .filter(Boolean)
    .map((rx) => scoreOf(rx))
  const here = scored(records.filter((r) => r.zoneId === zoneId))
  const all = scored(records)
  const mean = (xs) => (xs.length ? Math.round((xs.reduce((n, x) => n + x, 0) / xs.length) * 10) / 10 : null)
  return { zone: mean(here), overall: mean(all), n: here.length, nAll: all.length }
}

/** Reaction rate per zone, for the heatmap. */
export function reactionRateByZone({ records = [], reactions = [], positiveOf }) {
  const out = {}
  for (const z of ZONES) {
    const mine = records.filter((r) => r.zoneId === z.id)
    if (!mine.length) { out[z.id] = { n: 0, rate: null }; continue }
    const pos = mine.filter((r) => {
      const rx = reactions.find((x) => x.injectionRecordId === r.id)
      return rx && positiveOf(rx)
    }).length
    out[z.id] = { n: mine.length, positive: pos, rate: pos / mine.length }
  }
  return out
}
