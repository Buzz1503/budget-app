import { addDaysStr, daysBetween } from './schedule'
import { format, parseISO } from 'date-fns'

/**
 * Stopping the whole thing for a while.
 *
 * A break is the fourth thing that can happen to a scheduled dose, and like the
 * other three it is a decision rather than an absence. A log says you took it. A
 * skip says you decided against this one. A push says not today but still. A
 * pause says none of this applies for a while — and the difference matters
 * because two weeks away from home was previously fourteen days of red on the
 * calendar and a hole in the adherence figure, which is a record of a holiday
 * described as a failure.
 *
 * What a pause does *not* do is as important as what it does. It draws nothing
 * out of a vial, so stock is untouched and the run-out date moves further into
 * the calendar rather than arriving on schedule. It does not end a run, because
 * you have not stopped taking the compound, you have stopped for a fortnight.
 * It does not accrue time at the current dose, because you were not on that
 * dose those days. And it does not stop you logging a dose you did take — if
 * you brought one vial on holiday and used it, that is a fact, and recording it
 * should not require ending the break.
 */

export const PAUSE_REASONS = [
  { id: 'holiday', label: 'Holiday' },
  { id: 'sick', label: 'Sick' },
  { id: 'injury', label: 'Injury' },
  { id: 'out-of-stock', label: 'Out of stock' },
  { id: 'cycling-off', label: 'Cycling off' },
  { id: 'break', label: 'Taking a break' },
  { id: 'other', label: 'Other' },
]

const REASON_LABEL = Object.fromEntries(PAUSE_REASONS.map((r) => [r.id, r.label]))

/** The words for a pause's reason — the free text when there is one. */
export function reasonWords(pause) {
  if (!pause) return ''
  if (pause.reason === 'other') return (pause.reasonText || '').trim() || 'Other'
  return REASON_LABEL[pause.reason] || 'Paused'
}

/**
 * The last day a pause covers, or null for one still running with no end set.
 *
 * Two different dates can end a pause and they mean different things. `endsOn`
 * is a plan made when it started — back on the 14th — and it ends the pause on
 * its own when the day arrives. `endedOn` is the day Resume was actually
 * pressed. Whichever comes first is the one that counts, because resuming early
 * ends it early and a plan that was never cancelled still ends it.
 */
export function pauseEnd(pause) {
  if (!pause) return null
  const ends = [pause.endedOn, pause.endsOn].filter(Boolean).sort()
  return ends.length ? ends[0] : null
}

/** Has this pause finished — by plan or by hand — as of `todayStr`? */
export function isOver(pause, todayStr) {
  const end = pauseEnd(pause)
  return !!end && !!todayStr && end < todayStr
}

/** Everything a pause applies to. `peptideIds: null` means the whole protocol. */
export function coversPeptide(pause, peptideId) {
  if (!pause) return false
  if (!pause.peptideIds) return true
  return pause.peptideIds.includes(peptideId)
}

/** Is this date inside the pause's span, whatever it covers? */
export function coversDate(pause, dateStr) {
  if (!pause?.startedOn || !dateStr) return false
  if (dateStr < pause.startedOn) return false
  const end = pauseEnd(pause)
  return !end || dateStr <= end
}

/** Is this compound paused on this date? */
export function isPausedOn(pauses = [], peptideId, dateStr) {
  return pauses.some((p) => coversPeptide(p, peptideId) && coversDate(p, dateStr))
}

/** The pause record responsible, for showing the reason beside the day. */
export function pauseOn(pauses = [], peptideId, dateStr) {
  return pauses.find((p) => coversPeptide(p, peptideId) && coversDate(p, dateStr)) || null
}

/** Every pause covering a date, whatever it covers — the calendar reads this. */
export function pausesOn(pauses = [], dateStr) {
  return pauses.filter((p) => coversDate(p, dateStr))
}

/** Is *anything* paused on this date? */
export function anyPausedOn(pauses = [], dateStr) {
  return pausesOn(pauses, dateStr).length > 0
}

/**
 * The pause in force today, if there is one.
 *
 * Whole-protocol pauses win over partial ones when both are running, because the
 * banner has room for one and the broader fact is the one worth stating.
 */
export function activePause(pauses = [], todayStr) {
  const live = pausesOn(pauses, todayStr)
  if (!live.length) return null
  return live.find((p) => !p.peptideIds) || live[0]
}

export function activePauseFor(pauses = [], peptideId, todayStr) {
  return pauseOn(pauses, peptideId, todayStr)
}

/** Pauses still running on `todayStr`, whatever their scope. */
export function livePauses(pauses = [], todayStr) {
  return pausesOn(pauses, todayStr)
}

/** How many days a pause has run, counting today. */
export function pausedDays(pause, todayStr) {
  if (!pause?.startedOn) return 0
  const end = pauseEnd(pause) || todayStr
  const upto = end < todayStr ? end : todayStr
  return Math.max(0, daysBetween(pause.startedOn, upto)) + 1
}

/** Its full length once it is over, or null while it is still running. */
export function pauseLength(pause) {
  const end = pauseEnd(pause)
  if (!end || !pause?.startedOn) return null
  return Math.max(0, daysBetween(pause.startedOn, end)) + 1
}

/**
 * Days inside a window that this compound spent paused.
 *
 * Counted by date rather than by summing each record, so two overlapping pauses
 * — a whole-protocol holiday inside a longer out-of-stock on one compound —
 * count the day once. Double-counting here would silently subtract the same day
 * twice from tenure.
 */
export function pausedDaysBetween(pauses = [], peptideId, fromStr, toStr) {
  if (!fromStr || !toStr) return 0
  const mine = pauses.filter((p) => coversPeptide(p, peptideId))
  if (!mine.length) return 0
  const n = daysBetween(fromStr, toStr)
  if (n < 0) return 0
  let count = 0
  for (let i = 0; i <= n; i++) {
    const d = addDaysStr(fromStr, i)
    if (mine.some((p) => coversDate(p, d))) count += 1
  }
  return count
}

/**
 * Walk forward `consumingDays` days of actual dosing, stepping over pauses.
 *
 * Stock is drawn down by doses, not by dates, so a fortnight paused pushes the
 * run-out date a fortnight further out rather than arriving on time with the
 * vial still full. An open-ended pause has no far edge to walk to, which the
 * caller has to handle rather than this looping to the heat death of the
 * universe: `open` says so and the walk stops.
 */
export function advanceOverPauses(fromStr, consumingDays, peptideId, pauses = [], maxDays = 4000) {
  if (!(consumingDays > 0)) return { date: fromStr, pausedDays: 0, open: false }
  const mine = pauses.filter((p) => coversPeptide(p, peptideId))
  let used = 0
  let paused = 0
  let date = fromStr
  for (let i = 0; i < maxDays; i++) {
    const covering = mine.find((p) => coversDate(p, date))
    if (covering) {
      // a pause with no end never lets the count finish, and saying "runs out in
      // 4000 days" would be a worse answer than saying it does not, for now
      if (!pauseEnd(covering)) return { date: null, pausedDays: paused, open: true }
      paused += 1
    } else {
      used += 1
      // The run-out date is the day *after* the last one the supply covered,
      // which is the convention runOutInfo has always used — returning the last
      // covered day instead would read a day early on every screen.
      if (used >= consumingDays) return { date: addDaysStr(date, 1), pausedDays: paused, open: false }
    }
    date = addDaysStr(date, 1)
  }
  return { date, pausedDays: paused, open: false, capped: true }
}

/** Every pause touching one compound, newest first. */
export function pausesFor(pauses = [], peptideId) {
  return pauses
    .filter((p) => coversPeptide(p, peptideId))
    .sort((a, b) => b.startedOn.localeCompare(a.startedOn))
}

/** Every pause, newest first — the overall history list. */
export function pauseHistory(pauses = []) {
  return [...pauses].sort((a, b) => b.startedOn.localeCompare(a.startedOn))
}

/** Pauses overlapping a window, for the timeline's shaded bands. */
export function pauseBands(pauses = [], peptideId, fromStr, toStr) {
  return pausesFor(pauses, peptideId)
    .map((p) => {
      const end = pauseEnd(p) || toStr
      const from = p.startedOn > fromStr ? p.startedOn : fromStr
      const to = end < toStr ? end : toStr
      if (from > to) return null
      return { pause: p, from, to, reason: reasonWords(p), open: !pauseEnd(p) }
    })
    .filter(Boolean)
}

/** "everything" / "3 compounds" / "Retatrutide" — what a pause was applied to. */
export function scopeWords(pause, peptides = []) {
  if (!pause?.peptideIds) return 'everything'
  const ids = pause.peptideIds
  if (ids.length === 1) {
    const p = peptides.find((x) => x.id === ids[0])
    return p ? p.name : '1 compound'
  }
  return `${ids.length} compounds`
}

/** "Holiday · 12 days · everything" — one line for a history row. */
export function pauseWords(pause, peptides = [], todayStr) {
  const len = pauseLength(pause) ?? pausedDays(pause, todayStr)
  const running = !pauseEnd(pause)
  return `${reasonWords(pause)} · ${len} day${len === 1 ? '' : 's'}${running ? ' so far' : ''} · ${scopeWords(pause, peptides)}`
}

/** "14 Oct – 28 Oct", or "since 14 Oct" while it is still running. */
export function pauseDates(pause) {
  if (!pause?.startedOn) return ''
  const end = pauseEnd(pause)
  const d = (s) => format(parseISO(s), 'd MMM')
  return end ? `${d(pause.startedOn)} – ${d(end)}` : `since ${d(pause.startedOn)}`
}

/**
 * A step-up that came due while the protocol was paused.
 *
 * Held rather than applied: the interval between rungs is meant to be time at a
 * dose, and a fortnight not taking it is not time at it. So the rung stays put
 * and the question gets asked on the way back in, which is also the moment
 * somebody can actually answer it.
 */
export function stepUpHeldBy(pauses = [], peptideId, levelStartDate, todayStr) {
  if (!levelStartDate || !todayStr) return 0
  return pausedDaysBetween(pauses, peptideId, levelStartDate, todayStr)
}
