import { PIN_BY_ID, PINS, GROUPS, SIDE_WORD } from './sitePins'

/**
 * Which peptide irritates the skin, how badly, and for how long.
 *
 * That is the whole question. There is no score, no model and no confidence
 * arithmetic here — just counting, because counting is all this data can
 * honestly support and because a number nobody can check is a number nobody
 * should act on.
 *
 * The one rule that keeps the counting meaningful is that a site carries one
 * peptide. Two in the same spot at the same time produce a reaction that
 * belongs to neither of them, so those injections are marked and left out of
 * every rate rather than quietly splitting the blame.
 */

export const SEVERITIES = [
  { id: 'none', rank: 0, label: 'None', words: 'nothing visible' },
  { id: 'mild', rank: 1, label: 'Mild', words: 'faint redness, little or no itch' },
  { id: 'moderate', rank: 2, label: 'Moderate', words: 'clear redness or itch that bothers you' },
  { id: 'severe', rank: 3, label: 'Severe', words: 'raised welt, strong itch, or bigger than a 20c coin' },
]
export const SEVERITY_BY_ID = Object.fromEntries(SEVERITIES.map((s) => [s.id, s]))
export const RATED_SEVERITIES = SEVERITIES.filter((s) => s.id !== 'none')

/** Anything at Mild or above counts as a reaction. */
export const REACTED_FROM = 1

export const DEFAULT_CHECK_TIME = '20:00'
export const REUSE_WINDOW_DAYS = 3

export function severityRank(id) {
  return SEVERITY_BY_ID[id]?.rank ?? -1
}

// ------------------------------------------------------------- one record

/** The worst rating ever given to one injection. */
export function worstOf(reaction) {
  const ratings = reaction?.ratings || []
  if (!ratings.length) return null
  return ratings.reduce((worst, r) => (severityRank(r.severity) > severityRank(worst) ? r.severity : worst), 'none')
}

export function reacted(reaction) {
  return severityRank(worstOf(reaction)) >= REACTED_FROM
}

/** Has this injection been looked at yet? */
export function rated(reaction) {
  return !!(reaction?.ratings || []).length
}

/**
 * How long it lasted, in days from the injection to the "Gone" tap.
 *
 * Counted on actual dates, never on the evenings the app happened to ask,
 * because a check-in done two days late still describes the day it was done.
 * Same day is reported as under a day rather than as zero, which reads as
 * "no duration" and means something else.
 */
export function durationDays(record, reaction) {
  if (!record || !reaction?.goneAt) return null
  const from = new Date(String(record.timestamp).slice(0, 10))
  const to = new Date(String(reaction.goneAt).slice(0, 10))
  const days = Math.round((to - from) / 86400000)
  return Math.max(0, days)
}

export function durationWords(days) {
  if (days == null) return null
  if (days === 0) return 'Under 1 day'
  return `${days} day${days === 1 ? '' : 's'}`
}

/** Still open: rated at Mild or above and not yet marked gone. */
export function stillReacting(record, reaction) {
  if (!reaction || reaction.goneAt) return false
  return reacted(reaction)
}

// -------------------------------------------------------------- the rules

/**
 * Two peptides in one spot at one time.
 *
 * Not blocked, because people do it and a tracker that refuses to record what
 * happened is a tracker that stops being used. Marked instead, and excluded —
 * the honest consequence of a shared site is that neither peptide can be blamed
 * for what follows.
 */
export function mixedWarning() {
  return "Two peptides on one site. The app can't tell which one causes a reaction."
}

/** Injections at the same pin within a minute of each other. */
export function findMixedGroup(records = [], { pinId, timestamp, peptideId }) {
  const t = new Date(timestamp).getTime()
  return records.filter((r) => r.pinId === pinId
    && r.peptideId !== peptideId
    && Math.abs(new Date(r.timestamp).getTime() - t) < 60000)
}

/** Was this pin used by something else in the last few days? */
export function recentOtherUse(records = [], { pinId, peptideId, nowIso, days = REUSE_WINDOW_DAYS }) {
  const cut = new Date(nowIso).getTime() - days * 86400000
  return records
    .filter((r) => r.pinId === pinId && r.peptideId !== peptideId && new Date(r.timestamp).getTime() >= cut)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0] || null
}

export function reuseWarning(prev, nameOf = (x) => x) {
  if (!prev) return null
  const days = Math.max(0, Math.round((Date.now() - new Date(prev.timestamp).getTime()) / 86400000))
  return `${nameOf(prev.peptideId)} was here ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`} — a different site reads more clearly.`
}

// ------------------------------------------------------------- the status

/** What one pin looks like right now. */
export function pinStatus(pinId, { records = [], reactions = [], nowIso } = {}) {
  const mine = records.filter((r) => r.pinId === pinId)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
  if (!mine.length) return { status: 'unused', lastUsed: null, daysAgo: null }

  const last = mine[0]
  const daysAgo = Math.max(0, Math.round((new Date(nowIso || Date.now()) - new Date(last.timestamp)) / 86400000))

  const open = mine
    .map((r) => reactions.find((x) => x.injectionRecordId === r.id))
    .filter((rx) => rx && stillReacting(mine.find((r) => r.id === rx.injectionRecordId), rx))
  if (open.length) {
    const worst = open.reduce((w, rx) => (severityRank(worstOf(rx)) > severityRank(w) ? worstOf(rx) : w), 'none')
    return { status: 'reacting', severity: worst, lastUsed: last.timestamp, daysAgo }
  }
  if (daysAgo <= REUSE_WINDOW_DAYS) return { status: 'recent', lastUsed: last.timestamp, daysAgo }
  return { status: 'clear', lastUsed: last.timestamp, daysAgo }
}

export function allPinStatus(ctx) {
  const out = {}
  for (const p of PINS) out[p.id] = pinStatus(p.id, ctx)
  return out
}

/** "Last used 4 days ago. No reaction." — the line under a tapped pin. */
export function pinStatusWords(pinId, ctx) {
  const st = pinStatus(pinId, ctx)
  if (st.status === 'unused') return 'Never used.'
  const when = st.daysAgo === 0 ? 'today' : st.daysAgo === 1 ? 'yesterday' : `${st.daysAgo} days ago`
  if (st.status === 'reacting') {
    return `Last used ${when}. Still reacting — ${SEVERITY_BY_ID[st.severity]?.label.toLowerCase()}.`
  }
  return `Last used ${when}. No reaction.`
}

/**
 * Where to go next: the least recently used site that is not reacting.
 *
 * Deliberately not "the one with the fewest reactions" — that would steer every
 * shot towards the sites that have never had a problem, which is exactly the
 * bias that stops the comparison being worth anything.
 */
export function suggestedPin({ records = [], reactions = [], nowIso, group = null } = {}) {
  const status = allPinStatus({ records, reactions, nowIso })
  let pool = PINS.filter((p) => status[p.id].status !== 'reacting')
  if (group) pool = pool.filter((p) => p.group === group)
  if (!pool.length) return null
  const unused = pool.filter((p) => status[p.id].status === 'unused')
  if (unused.length) return unused[0].id
  return pool.slice().sort((a, b) => {
    const la = status[a.id].lastUsed || ''
    const lb = status[b.id].lastUsed || ''
    return String(la).localeCompare(String(lb)) || a.id.localeCompare(b.id)
  })[0].id
}

// -------------------------------------------------------------- the check

/** Injections logged since the last evening check, needing a first rating. */
export function newSites({ records = [], reactions = [] } = {}) {
  return records
    .filter((r) => !rated(reactions.find((x) => x.injectionRecordId === r.id)))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
}

/** Sites rated Mild or above and not yet marked gone. */
export function openSites({ records = [], reactions = [] } = {}) {
  return records
    .map((r) => ({ record: r, reaction: reactions.find((x) => x.injectionRecordId === r.id) }))
    .filter(({ record, reaction }) => stillReacting(record, reaction))
    .sort((a, b) => String(b.record.timestamp).localeCompare(String(a.record.timestamp)))
}

/** Is anything waiting to be looked at? */
export function checkDue(ctx) {
  return newSites(ctx).length + openSites(ctx).length > 0
}

/**
 * Three evenings of Severe with the mark still there.
 *
 * Not a diagnosis and not a block — a prompt to open the other-symptoms list,
 * because at that point the questions on it are the ones worth asking.
 */
export function severeStreak(record, reaction, times = 3) {
  const ratings = (reaction?.ratings || [])
    .filter((r) => r.severity === 'severe')
    .map((r) => String(r.date).slice(0, 10))
  return new Set(ratings).size >= times && !reaction?.goneAt
}

export function needsSymptomReview({ records = [], reactions = [] } = {}) {
  return records.some((r) => {
    const rx = reactions.find((x) => x.injectionRecordId === r.id)
    return severeStreak(r, rx)
  })
}

// ------------------------------------------------------------ scorecards

/** Rated, non-mixed injections — the only ones any rate is computed over. */
export function countable({ records = [], reactions = [] } = {}) {
  return records
    .filter((r) => !r.mixed)
    .map((r) => ({ record: r, reaction: reactions.find((x) => x.injectionRecordId === r.id) }))
    .filter(({ reaction }) => rated(reaction))
}

export const MIN_FOR_NUMBERS = 4

function summarise(rows) {
  const n = rows.length
  const hits = rows.filter(({ reaction }) => reacted(reaction))
  const durations = rows
    .map(({ record, reaction }) => durationDays(record, reaction))
    .filter((d) => d != null)
  const counts = {}
  for (const { reaction } of hits) {
    const w = worstOf(reaction)
    counts[w] = (counts[w] || 0) + 1
  }
  const common = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return {
    n,
    reacted: hits.length,
    rate: n ? hits.length / n : null,
    commonSeverity: common ? common[0] : null,
    avgDurationDays: durations.length
      ? Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10
      : null,
    enough: n >= MIN_FOR_NUMBERS,
  }
}

/** One card per peptide, worst first. */
export function peptideScorecards(ctx) {
  const rows = countable(ctx)
  const byPeptide = new Map()
  for (const row of rows) {
    const id = row.record.peptideId
    if (!byPeptide.has(id)) byPeptide.set(id, [])
    byPeptide.get(id).push(row)
  }
  // a peptide with only mixed or unrated shots still deserves a card saying so
  for (const r of ctx.records || []) {
    if (!byPeptide.has(r.peptideId)) byPeptide.set(r.peptideId, [])
  }
  return [...byPeptide.entries()]
    .map(([peptideId, list]) => ({ peptideId, ...summarise(list) }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.n - a.n)
}

/** The same three numbers, split by where the shot went. */
export function byGroup(rows) {
  return GROUPS.map((g) => ({
    group: g.id,
    label: g.label,
    ...summarise(rows.filter(({ record }) => record.siteGroup === g.id)),
  })).filter((r) => r.n > 0)
}

export function peptideDetail(peptideId, ctx) {
  const rows = countable(ctx).filter(({ record }) => record.peptideId === peptideId)
  const all = (ctx.records || [])
    .filter((r) => r.peptideId === peptideId)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .map((record) => {
      const reaction = (ctx.reactions || []).find((x) => x.injectionRecordId === record.id)
      return {
        record,
        reaction,
        pin: PIN_BY_ID[record.pinId] || null,
        severity: worstOf(reaction),
        rated: rated(reaction),
        durationDays: durationDays(record, reaction),
      }
    })
  return { overall: summarise(rows), groups: byGroup(rows), injections: all }
}

/** Reaction rate per site group, across everything. */
export function groupScorecards(ctx) {
  return byGroup(countable(ctx))
}

/** Every injection at one pin. */
export function pinHistory(pinId, ctx) {
  return (ctx.records || [])
    .filter((r) => r.pinId === pinId)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .map((record) => {
      const reaction = (ctx.reactions || []).find((x) => x.injectionRecordId === record.id)
      return { record, reaction, severity: worstOf(reaction), durationDays: durationDays(record, reaction) }
    })
}

/**
 * The line at the top.
 *
 * Says the two things worth saying and stops: which peptide reacts most often,
 * and whether one part of the body reacts more than the others. Neither is
 * stated until there is enough to state it.
 */
export function topLine(ctx, nameOf = (x) => x) {
  const cards = peptideScorecards(ctx).filter((c) => c.enough && c.rate != null)
  const groups = groupScorecards(ctx).filter((g) => g.enough && g.rate != null)
  const parts = []

  if (cards.length) {
    const top = cards[0]
    if (top.rate > 0) parts.push(`${nameOf(top.peptideId)} reacts most often.`)
    else parts.push('Nothing has reacted yet.')
  }
  if (groups.length >= 2) {
    const sorted = [...groups].sort((a, b) => b.rate - a.rate)
    if (sorted[0].rate > sorted[sorted.length - 1].rate) {
      const rest = sorted.slice(1).map((g) => g.label.toLowerCase())
      parts.push(`${sorted[0].label} reacts more than ${rest.join(' or ')}.`)
    }
  }
  if (!parts.length) return 'Log a few injections and rate them in the evening check — the numbers appear once there are four of each.'
  return parts.join(' ')
}

// ---------------------------------------------------------------- safety

export const SAFETY_FLAGS = [
  { id: 'spreading', label: 'Spreading redness', level: 'doctor' },
  { id: 'warmSpreading', label: 'Warm to touch and spreading', level: 'doctor' },
  { id: 'redStreaks', label: 'Red streaks', level: 'doctor' },
  { id: 'pus', label: 'Pus', level: 'doctor' },
  { id: 'fever', label: 'Fever', level: 'doctor' },
  { id: 'hives', label: 'Hives away from the site', level: 'doctor' },
  { id: 'faceSwelling', label: 'Lip, face or throat swelling', level: 'emergency' },
  { id: 'breathing', label: 'Trouble breathing', level: 'emergency' },
]
export const SAFETY_BY_ID = Object.fromEntries(SAFETY_FLAGS.map((f) => [f.id, f]))

/**
 * The worst thing currently standing.
 *
 * Emergency outranks everything. A flag stays up until it is explicitly
 * cleared — not until the reaction resolves, and not on a timer — because the
 * person who ticked "trouble breathing" is not the person to decide when the
 * banner has been up long enough.
 */
export function activeSafety(flags = []) {
  const live = flags.filter((f) => !f.clearedAt)
  if (!live.length) return null
  const emergency = live.filter((f) => SAFETY_BY_ID[f.type]?.level === 'emergency')
  const pool = emergency.length ? emergency : live
  return {
    level: emergency.length ? 'emergency' : 'doctor',
    title: emergency.length ? 'Call 000 now' : 'See a doctor today',
    reasons: [...new Set(pool.map((f) => SAFETY_BY_ID[f.type]?.label).filter(Boolean))],
    flagIds: pool.map((f) => f.id),
  }
}

// ------------------------------------------------------------- migration

/**
 * Bringing the old Reaction Lab across.
 *
 * Its sites were zones on a drawn figure; these are pins on a photograph, so
 * every old record has to find a new home. The mapping is by name — a zone
 * called "Lower left abdomen, inner" is the pin with the same group, side and
 * rough position — and anything that cannot be placed is kept and flagged for
 * the user to pin by hand rather than dropped or guessed at.
 */
const ZONE_TO_PIN = {
  'abd-ul-in': 'abd-l-upper-inner',
  'abd-ul-out': 'abd-l-upper-outer',
  'abd-ur-in': 'abd-r-upper-inner',
  'abd-ur-out': 'abd-r-upper-outer',
  'abd-ll-in': 'abd-l-navel-inner',
  'abd-ll-out': 'abd-l-navel-outer',
  'abd-lr-in': 'abd-r-navel-inner',
  'abd-lr-out': 'abd-r-navel-outer',
  'flank-l': 'flank-l',
  'flank-r': 'flank-r',
  'thigh-l-up': 'thigh-l-front-upper',
  'thigh-l-lo': 'thigh-l-front-lower',
  'thigh-r-up': 'thigh-r-front-upper',
  'thigh-r-lo': 'thigh-r-front-lower',
  'thigh-l-out': 'thigh-l-outer-upper',
  'thigh-r-out': 'thigh-r-outer-upper',
  'glute-l': 'glute-l-upper-outer',
  'glute-r': 'glute-r-upper-outer',
  'arm-l': null,
  'arm-r': null,
}

/** The old zone ids were viewer-agnostic; the new pins are anatomical. */
export function pinForZone(zoneId) {
  return ZONE_TO_PIN[zoneId] ?? null
}

/** An old check-in's numbers, read as one of the four words. */
export function severityFromCheckin(c) {
  if (!c) return null
  if (!c.present) return 'none'
  if (c.lump || c.welt || (c.diameterMm || 0) > 28.5 || (c.itch || 0) >= 7) return 'severe'
  if ((c.diameterMm || 0) > 10 || (c.itch || 0) >= 4) return 'moderate'
  return 'mild'
}

/**
 * Old records in, new records out, with everything that could not be placed
 * listed rather than lost.
 */
export function migrateReactionLab({ injectionRecords = [], reactions = [], reactionCheckins = [], reactionPhotos = [] } = {}) {
  const outRecords = []
  const outReactions = []
  const unmapped = []

  for (const old of injectionRecords) {
    const pinId = pinForZone(old.zoneId)
    const pin = pinId ? PIN_BY_ID[pinId] : null
    const record = {
      id: old.id,
      doseLogId: old.doseLogId || null,
      peptideId: (old.compoundIds || [])[0] || null,
      pinId: pin ? pin.id : null,
      siteGroup: pin ? pin.group : null,
      side: pin ? pin.side : null,
      timestamp: old.injectedAt,
      mixed: (old.compoundIds || []).length > 1,
      needsPinning: !pin,
      migratedFrom: old.zoneId || null,
    }
    outRecords.push(record)
    if (!pin) unmapped.push({ id: old.id, zoneId: old.zoneId || null, reason: old.zoneId ? 'no matching site on the photo map' : 'no site recorded' })

    const oldRx = reactions.find((r) => r.injectionRecordId === old.id)
    if (!oldRx) continue
    const mine = reactionCheckins
      .filter((c) => c.reactionId === oldRx.id && c.completedAt)
      .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)))
    const ratings = mine
      .map((c) => ({ date: c.completedAt, severity: severityFromCheckin(c) }))
      .filter((r) => r.severity)
    const photoIds = reactionPhotos.filter((p) => p.reactionId === oldRx.id).map((p) => p.blobKey).filter(Boolean)
    outReactions.push({
      injectionRecordId: old.id,
      ratings,
      worstSeverity: ratings.length
        ? ratings.reduce((w, r) => (severityRank(r.severity) > severityRank(w) ? r.severity : w), 'none')
        : null,
      goneAt: oldRx.resolvedAt || null,
      photoIds,
    })
  }

  return { records: outRecords, reactions: outReactions, unmapped }
}

/** Pretty names for the side and group of a pin, for a one-line label. */
export function pinWords(pinId) {
  const p = PIN_BY_ID[pinId]
  return p ? p.label : 'Unpinned site'
}

export { PIN_BY_ID, PINS, GROUPS, SIDE_WORD }
