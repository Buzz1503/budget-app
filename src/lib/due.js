// Is a compound owed on a date? One answer, here.
//
// Everything that needs to know whether a compound is due (the Home log, the
// calendar, the snapshot for widgets, the Live Activity and the Watch, every
// reminder and nudge, adherence, the stock forecast) asks isDue. The rule has
// layers, applied in this order:
//
//   1. the protocol is set up                       (daily.needsProtocolSetup)
//   2. the compound is on cycle that day            (schedule.cycleInfo)
//   3. the weekday pattern lands on that day        (daily.scheduledWeekdaySet)
//   4. pushes: a dose pushed off a day is not owed there, and one pushed onto
//      a day is, provided that day is on cycle. A push never lands in a rest:
//      it goes to the next on-cycle day.
//   5. pauses, when the caller passes them. Home leaves them out on purpose,
//      because it keeps showing a paused day's doses under the Paused banner.
//
// A compound resting between cycles is still on the stack: it is not stopped,
// it is not missed, and it comes back on a known date. cycleStatus says so.
import { parseISO, format } from 'date-fns'
import { addDaysStr, cycleInfo, cyclePhase } from './schedule'
import { isScheduledToday, needsProtocolSetup } from './daily'
import { pushedAway, pushedOnto, canPush } from './pushes'
import { isPausedOn } from './pauses'

export { restartMode, rungOn, levelStateOn, onDaysBetween, offCycleDaysBetween } from './schedule'

/** Does this compound run on a cycle (an on stretch and a rest) at all? */
export function isCycled(compound) {
  return (compound?.cycleOnDays || 0) > 0 && (compound?.cycleOffDays || 0) > 0
}

/** On cycle on that date. Ongoing compounds always are; before the start, none is. */
export function isOnCycle(compound, dateStr) {
  return !!compound && cycleInfo(compound, dateStr).isOn
}

/** The first on-cycle day on or after `dateStr` (the same day for a compound with no cycle). */
export function nextOnDay(compound, dateStr, limit = 400) {
  let d = dateStr
  for (let i = 0; i < limit; i++) {
    if (isOnCycle(compound, d)) return d
    d = addDaysStr(d, 1)
  }
  return null
}

/**
 * Where a dose pushed off `fromStr` lands: tomorrow, or the next on-cycle day
 * if tomorrow is a rest. Null when the compound has no on-cycle day to go to.
 */
export function pushDestination(compound, fromStr) {
  return nextOnDay(compound, addDaysStr(fromStr, 1))
}

/** A push record's day, moved off a rest if it was written onto one. */
function landed(compound, record) {
  const to = nextOnDay(compound, record.to)
  return to && to !== record.to ? { ...record, to } : record
}

/**
 * Is this compound owed on this date?
 *
 * @param compound the peptide
 * @param dateStr  'yyyy-MM-dd'
 * @param ctx.pushes  the push records (moves one occurrence by a day)
 * @param ctx.pauses  the pauses; leave out to ignore them, as Home does
 */
export function isDue(compound, dateStr, { pushes = [], pauses = null } = {}) {
  if (!compound) return false
  if (needsProtocolSetup(compound)) return false
  if (pauses && pauses.length && isPausedOn(pauses, compound.id, dateStr)) return false
  // Leaving is checked before arriving, and the order matters: a dose pushed
  // onto Tuesday and then pushed again off Tuesday did both on the same day,
  // and it is Wednesday's now.
  const mine = pushes.length ? pushes.filter((x) => x.peptideId === compound.id).map((x) => landed(compound, x)) : []
  if (mine.length) {
    if (pushedAway(mine, compound.id, dateStr)) return false
    if (pushedOnto(mine, compound.id, dateStr)) return isOnCycle(compound, dateStr) || !isCycled(compound)
  }
  return isScheduledToday(compound, dateStr)
}

/**
 * Whether a push is allowed right now.
 *
 * Not after the dose is settled: once it is logged or skipped there is no
 * occurrence left to move. Only forward from a day it is actually owed on, and
 * only where there is an on-cycle day for it to land on.
 */
export function canPushOn(compound, { pushes = [], loggedIds = new Set(), skippedIds = new Set(), dateStr }) {
  if (!canPush(compound)) return false
  if (loggedIds.has(compound.id) || skippedIds.has(compound.id)) return false
  if (!pushDestination(compound, dateStr)) return false
  return isDue(compound, dateStr, { pushes })
}

// ------------------------------------------------------------ what to say

const shortDate = (d) => (d ? format(parseISO(d), 'd MMM') : '')

/**
 * Where a cycled compound stands on a date, in the words the Protocol view
 * uses: "On, day 12 of 20", "Off, back 12 Nov". Null for a compound with no
 * cycle, so nothing is said where there is nothing to say.
 */
export function cycleStatus(compound, dateStr) {
  if (!isCycled(compound)) return null
  const ph = cyclePhase(compound, dateStr)
  if (ph.phase === 'before') {
    return { cycled: true, phase: 'before', on: false, words: `Starts ${shortDate(compound.startDate)}`, backOn: compound.startDate }
  }
  if (ph.phase === 'on') {
    return {
      cycled: true, phase: 'on', on: true, dayOfPhase: ph.dayOfPhase, phaseLength: ph.phaseLength,
      daysLeft: ph.daysLeft, restsOn: ph.restsOn, backOn: null,
      words: `On, day ${ph.dayOfPhase} of ${ph.phaseLength}`,
    }
  }
  return {
    cycled: true, phase: 'rest', on: false, dayOfPhase: ph.dayOfPhase, phaseLength: ph.phaseLength,
    daysLeft: ph.daysLeft, backOn: ph.backOn, restsOn: null,
    words: `Off, back ${shortDate(ph.backOn)}`,
  }
}

/** Is this compound resting between cycles on that date? (Not before it starts, not for one without a cycle.) */
export function isResting(compound, dateStr) {
  return isCycled(compound) && !needsProtocolSetup(compound) && cyclePhase(compound, dateStr).phase === 'rest'
}

/** Compounds resting on a date, soonest back first. Only ones that are set up and under way. */
export function offCycleOn(compounds = [], dateStr) {
  return compounds
    .filter((p) => isCycled(p) && !needsProtocolSetup(p))
    .map((p) => ({ peptide: p, status: cycleStatus(p, dateStr) }))
    .filter((x) => x.status?.phase === 'rest')
    .map((x) => ({ id: x.peptide.id, peptide: x.peptide, backOn: x.status.backOn, backOnWords: shortDate(x.status.backOn) }))
    .sort((a, b) => a.backOn.localeCompare(b.backOn) || a.id.localeCompare(b.id))
}

/** "Off cycle: Epithalon, back 12 Nov". Empty when nothing is resting. */
export function offCycleLine(list = [], nameOf = (p) => p.name) {
  if (!list.length) return ''
  return `Off cycle: ${list.map((x) => `${nameOf(x.peptide)}, back ${x.backOnWords}`).join('; ')}`
}

/** "Epithalon", "Epithalon and KPV", "A, B and C". */
export function nameList(names = []) {
  if (names.length <= 1) return names[0] || ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "Epithalon restarts tomorrow", "Epithalon and KPV restart tomorrow". */
export function restartWords(names = []) {
  return `${nameList(names)} ${names.length > 1 ? 'restart' : 'restarts'} tomorrow`
}

/**
 * Compounds that begin a new on-stretch on a date, after a rest. The first
 * stretch (the start date) is a start, not a restart, and is left out. Anything
 * not set up, or paused that day, is left out too.
 */
export function restartsOn(compounds = [], dateStr, pauses = []) {
  return compounds.filter((p) => {
    if (!isCycled(p) || needsProtocolSetup(p)) return false
    const c = cycleInfo(p, dateStr)
    if (!c.isOn || c.ongoing || c.cycleDay !== 1 || c.cycleNumber < 2) return false
    return !isPausedOn(pauses, p.id, dateStr)
  })
}

/**
 * The cycle's own start and stop events for the effects engine: a rest begins
 * as a stop, the next stretch as a restart. The engine already compares the
 * time on a compound with the time before it, so off cycle is compared as off.
 */
export function cycleEvents(compound, toStr) {
  if (!isCycled(compound) || !compound.startDate || !toStr) return []
  const on = compound.cycleOnDays
  const len = on + compound.cycleOffDays
  const out = []
  for (let k = 0; k < 4000; k++) {
    const stretch = addDaysStr(compound.startDate, k * len)
    if (stretch > toStr) break
    if (k > 0) out.push({ id: `cycle-on-${compound.id}-${stretch}`, date: stretch, kind: 'restart', label: 'Cycle on', cycle: true, estimated: false })
    const rest = addDaysStr(stretch, on)
    if (rest <= toStr) out.push({ id: `cycle-off-${compound.id}-${rest}`, date: rest, kind: 'stop', label: 'Cycle off', cycle: true, estimated: false })
  }
  return out
}
