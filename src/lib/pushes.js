import { addDaysStr, daysBetween } from './schedule'
import { scheduledWeekdaySet, isDueToday } from './daily'
import { format, parseISO } from 'date-fns'

/**
 * Doses moved to the next day.
 *
 * A push is the third thing that can happen to a scheduled dose, and it is
 * neither of the other two. A log says you took it. A skip says you decided not
 * to. A push says "not today, but I still intend to" — which people do
 * constantly with a Monday/Thursday compound and which the app previously had
 * no way to hear. Recording it as a skip would be a lie about a decision;
 * leaving it silent would count the day as missed.
 *
 * The schedule itself never moves. A push relocates one occurrence by one day
 * and leaves every following dose exactly where the schedule put it, so a
 * Thursday pushed to Friday does not drag next Monday to Tuesday. Pushing
 * again the next day is allowed, and the next, with no limit — the dose follows
 * you until you either take it or decide against it.
 *
 * Nothing here touches stock. Nothing was drawn, so nothing was used.
 */

/**
 * Can this compound's doses be pushed?
 *
 * Only compounds taken several days a week. A daily dose has nowhere to be
 * pushed to — tomorrow already has one — and a once-weekly dose that slips a
 * day is better handled by moving its day. Between those, "not today, tomorrow"
 * is exactly the thing that happens.
 */
export function canPush(peptide) {
  if (!peptide) return false
  const freq = peptide.frequency
  if (freq === 'daily' || freq === 'nightly') return false
  const days = scheduledWeekdaySet(peptide).size
  return days > 1 && days < 7
}

/** The push record that moved this peptide off `dateStr`, if there is one. */
export function pushedAway(pushes = [], peptideId, dateStr) {
  return pushes.find((p) => p.peptideId === peptideId && p.from === dateStr) || null
}

/** The push record that landed this peptide on `dateStr`, if there is one. */
export function pushedOnto(pushes = [], peptideId, dateStr) {
  return pushes.find((p) => p.peptideId === peptideId && p.to === dateStr) || null
}

/**
 * The day this occurrence was originally due.
 *
 * Walks the chain back through every push, so a dose pushed Thursday → Friday →
 * Saturday still says it came from Thursday. Saying "pushed from Friday" would
 * be true of the last hop and useless about the dose.
 */
export function originDate(pushes = [], peptideId, dateStr) {
  let at = dateStr
  // a chain can only be as long as the days it crossed; the bound is a guard
  // against a cycle in corrupted data, not an expected limit
  for (let i = 0; i < 400; i++) {
    const hop = pushedOnto(pushes, peptideId, at)
    if (!hop) break
    at = hop.from
  }
  return at === dateStr ? null : at
}

/** "pushed from Thu" — the marker a pushed dose carries on its new day. */
export function pushedLabel(pushes = [], peptideId, dateStr) {
  const from = originDate(pushes, peptideId, dateStr)
  if (!from) return null
  const days = daysBetween(from, dateStr)
  return days > 1
    ? `pushed from ${format(parseISO(from), 'EEE')} · ${days} days`
    : `pushed from ${format(parseISO(from), 'EEE')}`
}

/**
 * Is this dose owed on this date, once pushes are taken into account?
 *
 * The schedule says when a dose is due; this says where the occurrence actually
 * sits now. Both are needed — the first is the protocol, the second is the day.
 */
export function dueWithPushes(peptide, pushes = [], dateStr) {
  if (!peptide) return false
  // Leaving is checked before arriving, and the order matters: a dose pushed
  // onto Tuesday and then pushed again off Tuesday did both on the same day,
  // and it is Wednesday's now. Asking "did it arrive?" first would have shown
  // it on every day of the chain it passed through.
  if (pushedAway(pushes, peptide.id, dateStr)) return false
  if (pushedOnto(pushes, peptide.id, dateStr)) return true
  return isDueToday(peptide, dateStr)
}

/**
 * Peptides that have landed on this date from an earlier one.
 *
 * Returned separately from the scheduled list so a caller can render the marker
 * without re-deriving which of its rows arrived by being postponed.
 */
export function arrivalsOn(peptides = [], pushes = [], dateStr) {
  return peptides.filter((p) => !!pushedOnto(pushes, p.id, dateStr))
}

/**
 * Whether a push is allowed right now.
 *
 * Not after the dose is settled: once it is logged or skipped there is no
 * occurrence left to move. And only forward from a day it is actually owed on.
 */
export function canPushOn(peptide, { pushes = [], loggedIds = new Set(), skippedIds = new Set(), dateStr }) {
  if (!canPush(peptide)) return false
  if (loggedIds.has(peptide.id) || skippedIds.has(peptide.id)) return false
  return dueWithPushes(peptide, pushes, dateStr)
}

/** Every push for one compound, oldest first — the timeline reads from this. */
export function pushesFor(pushes = [], peptideId) {
  return pushes
    .filter((p) => p.peptideId === peptideId)
    .sort((a, b) => a.from.localeCompare(b.from))
}

/** Pushes inside a window, for the history list. */
export function pushesInRange(pushes = [], fromStr, toStr) {
  return pushes
    .filter((p) => p.from >= fromStr && p.from <= toStr)
    .sort((a, b) => b.from.localeCompare(a.from))
}

/** The date one push moves an occurrence to. */
export function nextDay(dateStr) {
  return addDaysStr(dateStr, 1)
}
