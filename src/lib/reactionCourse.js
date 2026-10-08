// The course of one injection-site reaction, from the day it is logged until it
// is gone — or until it has been left alone long enough to stop asking.
//
// This sits on top of the existing records, it does not replace them: a
// reaction is still `{ injectionRecordId, ratings, worstSeverity, goneAt,
// photoIds }`, one per injection, and a "check" is one entry of `ratings`. What
// is added is what each check can say (which symptoms are present), when the
// reaction was opened, and when it was given up on.
//
// All of it is arithmetic on dates and a short list of words. Nothing here
// scores a reaction, grades its cause, or says what to do about it; it reports
// what was entered and how it changed.

// reactionTracker imports this file, so the ranks are kept here rather than
// imported back — the four words and their order are not going to change.
const RANKS = { none: 0, mild: 1, moderate: 2, severe: 3 }
const severityRank = (id) => RANKS[id] ?? -1

export const SYMPTOMS = [
  { id: 'redness', label: 'Redness' },
  { id: 'itching', label: 'Itching' },
  { id: 'swelling', label: 'Swelling' },
  { id: 'lump', label: 'Lump or hardness' },
  { id: 'pain', label: 'Pain or soreness' },
  { id: 'heat', label: 'Heat' },
  { id: 'bruising', label: 'Bruising' },
  { id: 'welt', label: 'Welt or hive' },
  { id: 'bleeding', label: 'Bleeding' },
  { id: 'staining', label: 'Skin staining or discolouration' },
]
export const SYMPTOM_BY_ID = Object.fromEntries(SYMPTOMS.map((s) => [s.id, s]))
const SYMPTOM_ORDER = Object.fromEntries(SYMPTOMS.map((s, i) => [s.id, i]))

/** The four words a check can end on. `none` is stored as before; it reads "Gone". */
export const CHECK_SEVERITIES = [
  { id: 'none', label: 'Gone', rank: 0 },
  { id: 'mild', label: 'Mild', rank: 1 },
  { id: 'moderate', label: 'Moderate', rank: 2 },
  { id: 'severe', label: 'Severe', rank: 3 },
]
export const severityWord = (id) => CHECK_SEVERITIES.find((s) => s.id === id)?.label ?? '—'

/** Days with no check after which a reaction is left alone. */
export const ABANDON_AFTER_DAYS = 7
/** A direction needs at least this many checks to be said at all. */
export const MIN_CHECKS_FOR_DIRECTION = 2
/** …and looks at no more than this many of the most recent. */
export const DIRECTION_WINDOW = 3

const day = (v) => String(v).slice(0, 10)

/** Today's date on this device's calendar — not the UTC date, which is tomorrow for hours. */
export function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function diffDays(fromStr, toStr) {
  const [fy, fm, fd] = day(fromStr).split('-').map(Number)
  const [ty, tm, td] = day(toStr).split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

export function addDays(dateStr, n) {
  const [y, m, d] = day(dateStr).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const orderSymptoms = (ids) => [...new Set(ids)]
  .filter((id) => id in SYMPTOM_ORDER)
  .sort((a, b) => SYMPTOM_ORDER[a] - SYMPTOM_ORDER[b])

// ---------------------------------------------------------------- the checks

/** Every check, oldest first, one per day, each with its symptom set. */
export function checksOf(reaction) {
  const byDate = new Map()
  for (const r of reaction?.ratings || []) {
    byDate.set(day(r.date), { date: day(r.date), severity: r.severity, symptoms: orderSymptoms(r.symptoms || []) })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export const lastCheck = (reaction) => checksOf(reaction).at(-1) || null

/** The day the reaction was logged: its first check at Mild or worse. */
export function openedOn(reaction) {
  if (reaction?.openedOn) return day(reaction.openedOn)
  const first = checksOf(reaction).find((c) => severityRank(c.severity) >= 1)
  return first ? first.date : null
}

/** Was this ever a reaction (as opposed to a site looked at and found clear)? */
export const isReaction = (reaction) => !!openedOn(reaction)

/**
 * open, resolved or abandoned — or null for a site that never reacted.
 *
 * Gone settles it for good. Otherwise a reaction stays open for as long as it
 * keeps being checked, and is abandoned once ABANDON_AFTER_DAYS have passed
 * since the last check. A missed day in between changes nothing about its
 * state; it is only a gap (see `gapsOf`).
 */
export function statusOf(reaction, today) {
  if (!isReaction(reaction)) return null
  if (reaction.goneAt) return 'resolved'
  if (reaction.abandonedAt) return 'abandoned'
  const last = lastCheck(reaction)?.date || openedOn(reaction)
  return diffDays(last, today) >= ABANDON_AFTER_DAYS ? 'abandoned' : 'open'
}

/** The date a reaction is deemed abandoned on, if it is. */
export function abandonDate(reaction, today) {
  if (statusOf(reaction, today) !== 'abandoned') return null
  if (reaction.abandonedAt) return day(reaction.abandonedAt)
  return addDays(lastCheck(reaction)?.date || openedOn(reaction), ABANDON_AFTER_DAYS)
}

/** Days with no check between opening and now (or the end), not counting today. */
export function gapsOf(reaction, today) {
  const start = openedOn(reaction)
  if (!start) return []
  const st = statusOf(reaction, today)
  const lastDay = st === 'resolved' ? day(reaction.goneAt)
    : st === 'abandoned' ? abandonDate(reaction, today) : addDays(today, -1)
  const checked = new Set(checksOf(reaction).map((c) => c.date))
  const out = []
  for (let d = addDays(start, 1); d <= lastDay; d = addDays(d, 1)) {
    if (!checked.has(d) && d < today) out.push(d)
  }
  return out
}

/** Open, and not yet checked today. */
export function dueForCheck(reaction, today) {
  if (statusOf(reaction, today) !== 'open') return false
  return !checksOf(reaction).some((c) => c.date === today)
}

/**
 * Record one day's check. One per day: a second answer on the same date
 * replaces the first. A check of Gone resolves the reaction on that date, and
 * carries no symptoms because there are none. Pure — returns a new reaction.
 */
export function applyCheck(reaction, { date, severity, symptoms = [] }) {
  const base = reaction || { ratings: [], worstSeverity: null, goneAt: null, photoIds: [] }
  const d = day(date)
  // Gone on the very day it was logged resolves it at once, and leaves that
  // day's own check standing: replacing it would erase the reaction that was
  // just reported, and the record of it opening is the point of the record.
  if (severity === 'none' && base.openedOn && day(base.openedOn) === d && !base.goneAt) {
    return { ...base, goneAt: d }
  }
  const entry = {
    date: d, severity,
    symptoms: severity === 'none' ? [] : orderSymptoms(symptoms),
  }
  const ratings = [...(base.ratings || []).filter((r) => day(r.date) !== d), entry]
    .sort((a, b) => day(a.date).localeCompare(day(b.date)))
  const worstSeverity = ratings.reduce(
    (w, r) => (severityRank(r.severity) > severityRank(w) ? r.severity : w), 'none',
  )
  const next = { ...base, ratings, worstSeverity }
  if (!next.openedOn && severityRank(severity) >= 1) next.openedOn = d
  if (severity === 'none') {
    // the first Gone is the one that counts, and only once it has opened
    if (!next.goneAt && next.openedOn && d > next.openedOn) next.goneAt = d
  } else if (next.goneAt && day(next.goneAt) === d) {
    next.goneAt = null // today's answer corrected from Gone
  }
  if (next.abandonedAt && severityRank(severity) >= 1) next.abandonedAt = null
  return next
}

// -------------------------------------------------------------- computed

/** Days from being logged to now (open) or to the day it went (resolved). 0 = same day. */
export function daysOpen(reaction, today) {
  const start = openedOn(reaction)
  if (!start) return null
  const st = statusOf(reaction, today)
  const end = st === 'resolved' ? reaction.goneAt : st === 'abandoned' ? abandonDate(reaction, today) : today
  return Math.max(0, diffDays(start, end))
}

/** From the day it was logged to the first Gone check. Null until there is one. */
export function timeToResolve(reaction) {
  const start = openedOn(reaction)
  if (!start || !reaction?.goneAt) return null
  return Math.max(0, diffDays(start, reaction.goneAt))
}

/** The worst it got, as a severity id, or null if it never got past Gone. */
export function peakSeverity(reaction) {
  let peak = null
  for (const c of checksOf(reaction)) {
    if (severityRank(c.severity) >= 1 && severityRank(c.severity) > severityRank(peak)) peak = c.severity
  }
  return peak
}

export const currentSeverity = (reaction) => lastCheck(reaction)?.severity ?? null

/**
 * Which way it is going, from the last three checks.
 *
 * Severity only — the symptom list says what is present, not how much. Compare
 * the oldest of the window to the newest: lower is improving, higher is
 * worsening, the same is stable (a wobble in the middle that ends where it
 * began is still stable). Fewer than two checks is not a trend and says nothing.
 */
export function direction(reaction) {
  const window = checksOf(reaction).slice(-DIRECTION_WINDOW)
  if (window.length < MIN_CHECKS_FOR_DIRECTION) return null
  const first = severityRank(window[0].severity)
  const last = severityRank(window[window.length - 1].severity)
  if (last < first) return 'improving'
  if (last > first) return 'worsening'
  return 'stable'
}

/** Which symptoms on which days, oldest first. Each day keeps its own set. */
export function symptomTimeline(reaction) {
  return checksOf(reaction).map((c) => ({ date: c.date, severity: c.severity, symptoms: c.symptoms }))
}

/** The same thing turned around: for each symptom ever present, the days it was. */
export function symptomDays(reaction) {
  const out = {}
  for (const c of checksOf(reaction)) for (const s of c.symptoms) (out[s] ||= []).push(c.date)
  return Object.entries(out)
    .sort((a, b) => SYMPTOM_ORDER[a[0]] - SYMPTOM_ORDER[b[0]])
    .map(([id, dates]) => ({ id, label: SYMPTOM_BY_ID[id].label, dates }))
}

/** What yesterday's check said was still there — the starting point for today's. */
export function prefillSymptoms(reaction) {
  return [...(lastCheck(reaction)?.symptoms || [])]
}

/** Photos in the order they were taken. Undated (older) ones come first. */
export function photoStrip(reaction) {
  const dates = reaction?.photoDates || {}
  return (reaction?.photoIds || [])
    .map((key, i) => ({ key, date: dates[key] ? day(dates[key]) : null, i }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.i - b.i)
    .map(({ key, date }) => ({ key, date }))
}

/** All of the above for one reaction, as the screens want it. */
export function describeReaction(record, reaction, today) {
  const status = statusOf(reaction, today)
  return {
    status,
    openedOn: openedOn(reaction),
    daysOpen: daysOpen(reaction, today),
    timeToResolve: timeToResolve(reaction),
    peak: peakSeverity(reaction),
    current: currentSeverity(reaction),
    direction: direction(reaction),
    checks: checksOf(reaction).length,
    gaps: gapsOf(reaction, today),
    dueToday: dueForCheck(reaction, today),
    timeline: symptomTimeline(reaction),
    photos: photoStrip(reaction),
  }
}

/** Every reaction that is currently open, oldest first, with its record. */
export function openReactions({ records = [], reactions = [] }, today) {
  return reactions
    .map((reaction) => ({ record: records.find((r) => r.id === reaction.injectionRecordId), reaction }))
    .filter(({ record, reaction }) => record && statusOf(reaction, today) === 'open')
    .sort((a, b) => openedOn(a.reaction).localeCompare(openedOn(b.reaction)))
}

/** Reactions that have just crossed the line into abandoned and need it written down. */
export function toAbandon({ reactions = [] }, today) {
  return reactions
    .filter((r) => !r.abandonedAt && !r.goneAt && statusOf(r, today) === 'abandoned')
    .map((r) => ({ injectionRecordId: r.injectionRecordId, abandonedAt: abandonDate(r, today) }))
}
