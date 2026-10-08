/**
 * Which site to use next, and what is wrong with the one you picked.
 *
 * Every rule here exists to keep one reaction attributable to one peptide. Two
 * peptides in the same spot, or in adjacent spots a day apart, produce a mark
 * nobody can assign to either — which is the entire question the tracker is
 * meant to answer. So the warnings are about *legibility*, not safety, and none
 * of them blocks anything: the user is told what the shot will cost them in
 * clarity and then allowed to take it.
 *
 * Pure functions only. Everything is derived from injectionRecords, reactions
 * and the clock, so the same inputs always give the same advice.
 */
import {
  PINS, PIN_BY_ID, NAVEL_CLEARANCE_PCT, COMPOSITE_ASPECT,
} from './sitePins'
import { worstOf, stillReacting, SEVERITY_BY_ID } from './reactionTracker'
import { localDay } from './reactionCourse'

export const DEFAULT_WINDOW_DAYS = 3
export const WINDOW_CHOICES = [1, 2, 3, 5, 7]

/** 48 hours is the span over which a neighbouring mark is still spreading. */
export const NEIGHBOUR_HOURS = 48

/**
 * "Within 3 cm", in the same units the pin QA uses.
 *
 * NAVEL_CLEARANCE_PCT is 3.6% of the composite width and stands for 5 cm, so
 * one centimetre is 0.72% and three are 2.16%. Deriving it rather than writing
 * 2.16 keeps the two rules on one scale: change what 5 cm means and this
 * follows.
 */
export const NEIGHBOUR_CM = 3
export const NEIGHBOUR_PCT = (NAVEL_CLEARANCE_PCT / 5) * NEIGHBOUR_CM

const DAY = 86400000

// ------------------------------------------------------------ the window

/** Injections inside the window, newest first. Unsited records never appear. */
export function recentUses({ records = [], reactions = [], nowIso, windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const now = nowIso ? new Date(nowIso).getTime() : Date.now()
  const cut = now - windowDays * DAY
  return records
    .filter((r) => r.pinId && new Date(r.timestamp).getTime() >= cut)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .map((record) => {
      const reaction = reactions.find((x) => x.injectionRecordId === record.id)
      return {
        record,
        reaction,
        pinId: record.pinId,
        peptideId: record.peptideId,
        severity: worstOf(reaction),
        reacting: stillReacting(record, reaction, localDay(new Date(now))),
        hoursAgo: (now - new Date(record.timestamp).getTime()) / 3600000,
      }
    })
}

/**
 * Pins with a reaction that is open right now, however long ago the shot was.
 * The recent-use window only sees recent shots, but a mark does not care what
 * the window is: a site still reacting a fortnight on is still a site to avoid.
 */
export function openReactionPins({ records = [], reactions = [], nowIso } = {}) {
  const today = localDay(nowIso ? new Date(nowIso) : new Date())
  const out = {}
  for (const record of records) {
    if (!record.pinId) continue
    const reaction = reactions.find((x) => x.injectionRecordId === record.id)
    if (!stillReacting(record, reaction, today)) continue
    out[record.pinId] = { peptideId: record.peptideId, severity: worstOf(reaction) }
  }
  return out
}

/** The window's uses grouped by pin, each list newest first. */
export function usesByPin(uses = []) {
  const out = {}
  for (const u of uses) (out[u.pinId] ||= []).push(u)
  return out
}

/** Distance between two pins as a percentage of the composite's width. */
export function pinDistancePct(a, b, aspect = COMPOSITE_ASPECT) {
  if (!a || !b || a.view !== b.view) return Infinity
  return Math.hypot(a.x - b.x, (a.y - b.y) * aspect)
}

/** Pins within 3 cm of this one, in the same view. */
export function neighboursOf(pinId, { aspect = COMPOSITE_ASPECT, overrides = {} } = {}) {
  const at = positionOf(pinId, overrides)
  if (!at) return []
  return PINS
    .filter((p) => p.id !== pinId)
    .map((p) => ({ pin: p, d: pinDistancePct(at, positionOf(p.id, overrides), aspect) }))
    .filter(({ d }) => d <= NEIGHBOUR_PCT)
    .sort((a, b) => a.d - b.d)
    .map(({ pin }) => pin)
}

function positionOf(pinId, overrides = {}) {
  const base = PIN_BY_ID[pinId]
  if (!base) return null
  const o = overrides[pinId]
  return o && o.x != null && o.y != null ? { ...base, x: o.x, y: o.y } : base
}

// ----------------------------------------------------------- the warnings

const ago = (hours) => {
  if (hours < 1) return 'just now'
  if (hours < 20) return 'today'
  const days = Math.round(hours / 24)
  if (days <= 1) return 'yesterday'
  return `${days} days ago`
}

/**
 * Everything worth saying about putting `peptideId` on `pinId` right now.
 *
 * Returns them worst-first. An empty array means the site is clean, which is
 * itself worth rendering — silence reads as "not checked".
 */
export function warningsFor(pinId, peptideId, ctx = {}) {
  const {
    records = [], reactions = [], nowIso, windowDays = DEFAULT_WINDOW_DAYS,
    nameOf = (x) => x, overrides = {}, aspect = COMPOSITE_ASPECT,
  } = ctx
  const uses = recentUses({ records, reactions, nowIso, windowDays })
  const byPin = usesByPin(uses)
  const out = []

  const here = byPin[pinId] || []

  // still reacting outranks everything: the mark is on the skin now
  const reacting = here.find((u) => u.reacting) || (() => {
    const o = openReactionPins({ records, reactions, nowIso })[pinId]
    return o ? { peptideId: o.peptideId, severity: o.severity } : null
  })()
  if (reacting) {
    const sev = SEVERITY_BY_ID[reacting.severity]?.label
    out.push({
      kind: 'reacting',
      text: `Still reacting from ${nameOf(reacting.peptideId)}${sev ? ` (${sev})` : ''}.`,
    })
  }

  const other = here.find((u) => u.peptideId !== peptideId)
  if (other) {
    out.push({
      kind: 'other-peptide',
      text: `${nameOf(other.peptideId)} went here ${ago(other.hoursAgo)}.`,
      suggest: true,
    })
  }

  const same = here.find((u) => u.peptideId === peptideId)
  if (same) {
    out.push({
      kind: 'same-peptide',
      text: `${nameOf(same.peptideId)} went here ${ago(same.hoursAgo)}.`,
      suggest: true,
    })
  }

  // a different peptide next door within 48 h makes any mark here ambiguous
  const near = neighboursOf(pinId, { aspect, overrides })
  for (const n of near) {
    const u = (byPin[n.id] || []).find((x) => x.peptideId !== peptideId && x.hoursAgo <= NEIGHBOUR_HOURS)
    if (!u) continue
    out.push({
      kind: 'neighbour',
      text: `Next to ${ago(u.hoursAgo) === 'yesterday' ? "yesterday's" : `${ago(u.hoursAgo)},`} ${nameOf(u.peptideId)} site. A reaction here could be hard to tell apart.`,
      suggest: true,
    })
    break
  }

  return out
}

// ---------------------------------------------------------- the suggestion

/**
 * Where to put it instead.
 *
 * Least recently used, not reacting, not used inside the window, and not
 * next door to a different peptide's shot from the last 48 hours. When nothing
 * clears all four the best available is returned along with the rule it breaks,
 * because "no suggestion" is not an answer anybody can act on.
 */
export function suggestSite(peptideId, ctx = {}) {
  const {
    records = [], reactions = [], nowIso, windowDays = DEFAULT_WINDOW_DAYS,
    nameOf = (x) => x, overrides = {}, aspect = COMPOSITE_ASPECT, group = null,
  } = ctx
  const uses = recentUses({ records, reactions, nowIso, windowDays })
  const byPin = usesByPin(uses)
  const now = nowIso ? new Date(nowIso).getTime() : Date.now()

  const openPins = openReactionPins({ records, reactions, nowIso })
  const lastUsed = {}
  for (const r of records) {
    if (!r.pinId) continue
    const t = new Date(r.timestamp).getTime()
    if (!lastUsed[r.pinId] || t > lastUsed[r.pinId]) lastUsed[r.pinId] = t
  }

  let pool = PINS
  if (group) pool = pool.filter((p) => p.group === group)
  if (!pool.length) return null

  const scored = pool.map((pin) => {
    const here = byPin[pin.id] || []
    const reacting = here.some((u) => u.reacting) || !!openPins[pin.id]
    const inWindow = here.length > 0
    const neighbourClash = neighboursOf(pin.id, { aspect, overrides }).some((n) => (
      (byPin[n.id] || []).some((u) => u.peptideId !== peptideId && u.hoursAgo <= NEIGHBOUR_HOURS)
    ))
    return {
      pin,
      reacting,
      inWindow,
      neighbourClash,
      // never used sorts before everything that has been
      last: lastUsed[pin.id] ?? -Infinity,
      breaks: reacting ? 'reacting' : inWindow ? 'in-window' : neighbourClash ? 'neighbour' : null,
    }
  })

  const rank = (c) => (c.reacting ? 3 : 0) + (c.inWindow ? 2 : 0) + (c.neighbourClash ? 1 : 0)
  scored.sort((a, b) => rank(a) - rank(b) || a.last - b.last || a.pin.id.localeCompare(b.pin.id))

  const best = scored[0]
  if (!best) return null

  const days = best.last === -Infinity ? null : Math.round((now - best.last) / DAY)
  const reason = best.breaks === null
    ? (days == null ? 'Never used.' : `Least recently used — ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}.`)
    : best.breaks === 'reacting'
      ? 'Every site is reacting. This is the least recently used.'
      : best.breaks === 'in-window'
        ? 'Every site has been used recently. This is the oldest.'
        : `Closest clear site, but it is next to a recent ${nameOf(
          (byPin[neighboursOf(best.pin.id, { aspect, overrides })
            .find((n) => (byPin[n.id] || []).some((u) => u.peptideId !== peptideId && u.hoursAgo <= NEIGHBOUR_HOURS))?.id] || [])[0]?.peptideId,
        )} site.`

  return { pinId: best.pin.id, pin: best.pin, reason, breaks: best.breaks }
}

// ------------------------------------------------------- the summary line

/** "Yesterday: GHK-Cu, left abdomen. Suggested for MOTS-c: right glute, upper outer." */
export function summaryLine(peptideId, ctx = {}) {
  const { nameOf = (x) => x } = ctx
  const uses = recentUses(ctx)
  const parts = []
  if (uses.length) {
    const last = uses[0]
    const when = ago(last.hoursAgo)
    parts.push(`${when.charAt(0).toUpperCase()}${when.slice(1)}: ${nameOf(last.peptideId)}, ${PIN_BY_ID[last.pinId]?.label || 'unknown site'}.`)
  }
  const s = suggestSite(peptideId, ctx)
  if (s) parts.push(`Suggested for ${nameOf(peptideId)}: ${s.pin.label}.`)
  return parts.join(' ')
}

/** Every use of one pin inside the window, for the selected-pin bar. */
export function pinBarLines(pinId, ctx = {}) {
  const { nameOf = (x) => x, windowDays = DEFAULT_WINDOW_DAYS } = ctx
  const here = (usesByPin(recentUses(ctx))[pinId] || [])
  if (!here.length) return [`Not used in the last ${windowDays} day${windowDays === 1 ? '' : 's'}.`]
  return here.map((u) => {
    const when = ago(u.hoursAgo)
    const sev = SEVERITY_BY_ID[u.severity]?.label
    const tail = !u.reaction || !u.reaction.ratings?.length
      ? 'Not checked.'
      : u.severity === 'none'
        ? 'No reaction.'
        : `${sev}, ${u.reacting ? 'still there' : 'gone'}.`
    return `${nameOf(u.peptideId)}, ${when}. ${tail}`
  })
}

// ------------------------------------------------------- chip collisions

/**
 * Which code chips can be drawn without overlapping something else.
 *
 * At default zoom the pins are 44 px apart and a chip is wider than that, so
 * most of them would collide. A chip that overlaps another chip, or sits on top
 * of a pin, is worse than no chip: it is unreadable *and* it hides the thing it
 * is labelling. The colour fill never depends on this — it is on the pin
 * itself — so dropping a chip loses the code, not the identity.
 *
 * Boxes are whatever the caller measures at the current zoom; this only decides
 * which survive, newest-first so the most recent shot keeps its label.
 */
export function visibleChips(chips = [], pinBoxes = []) {
  const kept = []
  for (const chip of chips) {
    const hitsChip = kept.some((k) => overlaps(chip.box, k.box))
    const hitsPin = pinBoxes.some((p) => p.id !== chip.pinId && overlaps(chip.box, p.box))
    if (!hitsChip && !hitsPin) kept.push(chip)
  }
  return kept.map((c) => c.pinId)
}

export function overlaps(a, b) {
  if (!a || !b) return false
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
}

/**
 * What one pin shows: the most recent peptide, and how many others share it.
 * Mixed injections carry both codes, because that pin genuinely holds two.
 */
export function pinBadge(pinId, uses = [], codeOf = (x) => x) {
  const here = usesByPin(uses)[pinId] || []
  if (!here.length) return null
  const newest = here[0]
  if (newest.record.mixed) {
    const together = here.filter((u) => (
      Math.abs(new Date(u.record.timestamp) - new Date(newest.record.timestamp)) < 60000
    ))
    const codes = [...new Set(together.map((u) => codeOf(u.peptideId)))]
    return { peptideId: newest.peptideId, label: codes.join('/'), extra: 0, mixed: true }
  }
  const others = new Set(here.slice(1).map((u) => u.peptideId))
  others.delete(newest.peptideId)
  return {
    peptideId: newest.peptideId,
    label: codeOf(newest.peptideId),
    extra: others.size,
    mixed: false,
  }
}
