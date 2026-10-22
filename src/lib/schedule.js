// Titration ladder + cycle engine. All dates are 'yyyy-MM-dd' strings.
import { parseISO, differenceInCalendarDays, addDays, format } from 'date-fns'

export const DAY_FMT = 'yyyy-MM-dd'

export function fmt(date) {
  return format(date, DAY_FMT)
}

export function daysBetween(fromStr, toStr) {
  return differenceInCalendarDays(parseISO(toStr), parseISO(fromStr))
}

export function addDaysStr(dateStr, days) {
  return fmt(addDays(parseISO(dateStr), days))
}

// "12 Jan 2027" — the human-readable form of a stored yyyy-MM-dd string.
export function prettyDate(dateStr) {
  if (!dateStr) return ''
  return format(parseISO(dateStr), 'd MMM yyyy')
}

// Rungs from floor to ceiling, stepping by `step`, final rung clamped to ceiling.
export function buildRungs(ladder) {
  if (!ladder || !(ladder.floor > 0)) return [0]
  const rungs = [ladder.floor]
  if (!(ladder.step > 0) || !(ladder.ceiling > ladder.floor)) return rungs
  let d = ladder.floor
  while (d + ladder.step < ladder.ceiling - 1e-9) {
    d = Math.round((d + ladder.step) * 1e6) / 1e6
    rungs.push(d)
  }
  rungs.push(ladder.ceiling)
  return rungs
}

// Cycle position for a given date. cycleOnDays === 0 (or off === 0) means ongoing.
export function cycleInfo(peptide, dateStr) {
  const onDays = peptide.cycleOnDays || 0
  const offDays = peptide.cycleOffDays || 0
  const since = daysBetween(peptide.startDate, dateStr)
  if (since < 0) return { ongoing: false, isOn: false, beforeStart: true, cycleDay: 0, onDays, cycleNumber: 0, completedCycles: 0 }
  if (!onDays || !offDays) {
    // ongoing — always on
    return { ongoing: true, isOn: true, cycleDay: since + 1, onDays: 0, cycleNumber: 1, completedCycles: 0 }
  }
  const len = onDays + offDays
  const idx = since % len
  const cycleNumber = Math.floor(since / len) + 1
  return {
    ongoing: false,
    isOn: idx < onDays,
    cycleDay: idx + 1, // 1-based day within the full cycle
    onDay: idx < onDays ? idx + 1 : null,
    onDays,
    offDays,
    cycleNumber,
    completedCycles: Math.floor(since / len),
  }
}

/**
 * Where a cycled compound is in its cycle, in the words a person would use.
 *
 * A compound on its off-weeks is still part of the stack — it has not been
 * stopped, it is resting, and it comes back on a known date. Dropping it off
 * the screen entirely is what makes people think they have lost it, or worse,
 * re-add it as a second copy.
 */
export function cyclePhase(peptide, dateStr) {
  const c = cycleInfo(peptide, dateStr)
  if (c.ongoing) return { ...c, phase: 'ongoing', daysLeft: null, backOn: null }
  if (c.beforeStart) return { ...c, phase: 'before', daysLeft: null, backOn: null }

  const onDays = c.onDays || 0
  const offDays = c.offDays || 0
  if (!onDays || !offDays) return { ...c, phase: 'ongoing', daysLeft: null, backOn: null }

  if (c.isOn) {
    // the last day of the on-stretch still has one day left on it, itself
    const daysLeft = onDays - c.cycleDay + 1
    return {
      ...c,
      phase: 'on',
      dayOfPhase: c.cycleDay,
      phaseLength: onDays,
      daysLeft,
      restsOn: addDaysStr(dateStr, daysLeft),
      backOn: null,
    }
  }

  const dayOff = c.cycleDay - onDays
  const daysLeft = offDays - dayOff + 1
  return {
    ...c,
    phase: 'rest',
    dayOfPhase: dayOff,
    phaseLength: offDays,
    daysLeft,
    restsOn: null,
    backOn: addDaysStr(dateStr, daysLeft),
  }
}

export function dosesPerWeek(frequency) {
  switch (frequency) {
    case 'weekly': return 1
    case '2xweek': return 2
    case '3xweek': return 3
    case '5on2off': return 5
    case 'daily':
    case 'nightly':
    default: return 7
  }
}

// Whether a compound is owed on a date is decided in one place: isDue in
// ./due.js. This file only knows the cycle and the ladder.

/**
 * Days of the half-open window [fromStr, toStr) that fall in an off-cycle
 * stretch. A compound with no cycle, and any day before its start, is never
 * counted as off: the cycle is only knowable from the day it began.
 */
export function offCycleDaysBetween(peptide, fromStr, toStr) {
  const onDays = peptide?.cycleOnDays || 0
  const offDays = peptide?.cycleOffDays || 0
  if (!onDays || !offDays || !fromStr || !toStr) return 0
  const n = daysBetween(fromStr, toStr)
  if (n <= 0) return 0
  const len = onDays + offDays
  const since0 = daysBetween(peptide.startDate, fromStr)
  let off = 0
  for (let i = 0; i < n; i++) {
    const s = since0 + i
    if (s < 0) continue
    if (s % len >= onDays) off += 1
  }
  return off
}

/** Days between two dates that were not off cycle: time that actually counts as time on it. */
export function onDaysBetween(peptide, fromStr, toStr) {
  const n = daysBetween(fromStr, toStr)
  if (n <= 0) return 0
  return n - offCycleDaysBetween(peptide, fromStr, toStr)
}

/**
 * Which on-stretch a date belongs to, counting the rest after a stretch as
 * part of the next one. Something set during a rest is meant for the stretch
 * that follows it, so a dose chosen then is not undone when that stretch starts.
 */
export function cycleKey(peptide, dateStr) {
  const c = cycleInfo(peptide, dateStr)
  if (c.ongoing) return 0
  // a level set before the cycle began belongs to the first stretch
  if (c.beforeStart) return 1
  return c.isOn ? c.cycleNumber : c.cycleNumber + 1
}

/** The first day of the on-stretch a date belongs to (or follows), for a cycled compound. */
export function onStretchStart(peptide, dateStr) {
  const c = cycleInfo(peptide, dateStr)
  if (c.ongoing || c.beforeStart) return null
  if (c.isOn) return addDaysStr(dateStr, -(c.cycleDay - 1))
  return addDaysStr(dateStr, c.onDays + c.offDays - (c.cycleDay - 1))
}

// Confirmed current rung — tolerance-gated, never auto-advances.
export function currentRung(peptide, tState) {
  const rungs = buildRungs(peptide.ladder)
  const level = Math.min(tState?.level ?? 0, rungs.length - 1)
  return { level, dose: rungs[level], maxLevel: rungs.length - 1, rungs }
}

/**
 * What a compound does with its dose when a cycle restarts: pick up where it
 * was ('resume') or climb the ladder again from the floor ('floor').
 *
 * A choice made on the compound wins. Otherwise the compound's own playbook,
 * where it states one; no compound in the reference does, so the answer is to
 * resume the last dose.
 */
export const RESTART_MODES = ['resume', 'floor']
export function restartMode(peptide) {
  if (RESTART_MODES.includes(peptide?.restartDose)) return peptide.restartDose
  if (RESTART_MODES.includes(peptide?.playbook?.restartDose)) return peptide.playbook.restartDose
  return 'resume'
}

/**
 * The ladder position that applies on a date. Normally the confirmed one; on a
 * compound set to restart from the floor, the first on-stretch after the one
 * the level was set in starts again from the floor. Pure, so a widget or the
 * Watch can show tomorrow's restart dose without the app having been opened.
 */
export function levelStateOn(peptide, tState, dateStr) {
  const level = tState?.level ?? 0
  const since = tState?.levelStartDate || peptide?.startDate
  if (restartMode(peptide) !== 'floor' || !(peptide?.cycleOnDays > 0 && peptide?.cycleOffDays > 0) || !since) {
    return { level, levelStartDate: tState?.levelStartDate }
  }
  const c = cycleInfo(peptide, dateStr)
  if (!c.isOn || c.ongoing) return { level, levelStartDate: tState?.levelStartDate }
  if (cycleKey(peptide, dateStr) > cycleKey(peptide, since) && level > 0) {
    return { level: 0, levelStartDate: onStretchStart(peptide, dateStr), restarted: true }
  }
  return { level, levelStartDate: tState?.levelStartDate }
}

/** The rung in force on a date, restarts from the floor taken into account. */
export function rungOn(peptide, tState, dateStr) {
  const st = levelStateOn(peptide, tState, dateStr)
  return { ...currentRung(peptide, { ...tState, level: st.level }), restarted: !!st.restarted }
}

// Is a step-up prompt due on `dateStr`?
export function stepUpDue(peptide, tState, dateStr) {
  const { level, maxLevel } = currentRung(peptide, tState)
  if (level >= maxLevel) return false
  const interval = (peptide.ladder?.intervalWeeks || 1) * 7
  // time at a dose is time on it: rest days do not count towards the interval
  if (onDaysBetween(peptide, tState.levelStartDate, dateStr) < interval) return false
  return cycleInfo(peptide, dateStr).isOn
}

export function nextStepUpDate(peptide, tState) {
  const { level, maxLevel } = currentRung(peptide, tState)
  if (level >= maxLevel) return null
  const interval = (peptide.ladder?.intervalWeeks || 1) * 7
  const first = addDaysStr(tState.levelStartDate, interval)
  if (!(peptide.cycleOnDays > 0 && peptide.cycleOffDays > 0)) return first
  // the first on-cycle day by which the interval has been spent on the cycle
  let d = first
  for (let i = 0; i < 4000; i++) {
    if (cycleInfo(peptide, d).isOn && onDaysBetween(peptide, tState.levelStartDate, d) >= interval) return d
    d = addDaysStr(d, 1)
  }
  return first
}

// Project a dated schedule `days` ahead from `fromStr`. Dates on/before `todayStr`
// never auto-advance (advances are tolerance-gated); future dates assume confirmation.
// Ceiling is never exceeded because rungs are clamped.
export function projectSchedule(peptide, tState, fromStr, days, todayStr) {
  const { rungs, maxLevel } = currentRung(peptide, tState)
  const interval = (peptide.ladder?.intervalWeeks || 1) * 7
  const first = levelStateOn(peptide, tState, fromStr)
  let simLevel = Math.min(first.level ?? 0, maxLevel)
  let simStart = first.levelStartDate || peptide.startDate
  const out = []
  for (let i = 0; i < days; i++) {
    const date = addDaysStr(fromStr, i)
    const c = cycleInfo(peptide, date)
    let stepUp = false
    // a cycle that restarts from the floor climbs the ladder again
    if (restartMode(peptide) === 'floor' && c.isOn && !c.ongoing && c.cycleDay === 1 && c.cycleNumber > 1 && simLevel > 0) {
      simLevel = 0
      simStart = date
    }
    if (
      simLevel < maxLevel &&
      c.isOn &&
      onDaysBetween(peptide, simStart, date) >= interval &&
      daysBetween(todayStr, date) > 0
    ) {
      simLevel += 1
      simStart = date
      stepUp = true
    }
    out.push({
      date,
      isOn: c.isOn,
      dose: rungs[simLevel],
      level: simLevel,
      stepUp,
      cycleDay: c.cycleDay,
    })
  }
  return out
}

/**
 * Where a hand-set dose lands on the ladder.
 *
 * The rule is that the number wins. A dose the schedule did not plan for is
 * still the dose in the syringe, so the ladder is reshaped to accommodate it
 * rather than the change being refused — refusing would leave the app
 * disagreeing with what actually happened, which is the one outcome worth
 * avoiding.
 *
 * Four cases, in order:
 *  - it is already a rung → step to it, leave the plan alone
 *  - there is a climb and it is above the top → raise the ceiling, stand on the new top rung
 *  - there is a climb and it is below the top → the ladder starts here, so the climb above survives
 *  - there is no climb → floor and ceiling both become the dose
 *
 * The first thing every branch but the first checks is `step > 0`, because a
 * flat ladder has no rungs to move between: raising the ceiling of a
 * floor-50/step-0/ceiling-50 ladder to 62.5 leaves `buildRungs` returning [50]
 * and the change quietly not happening. A steady dose has to be moved by moving
 * both ends.
 *
 * Pure, so the arithmetic can be tested without a store behind it.
 */
export function resolveDoseChange(ladder, dose) {
  const rungs = buildRungs(ladder)
  const at = rungs.findIndex((r) => Math.abs(r - dose) < 1e-9)
  if (at >= 0) return { ladder: { ...ladder }, level: at, onLadder: true }

  const climbs = ladder?.step > 0 && ladder?.ceiling > ladder?.floor
  if (climbs && dose > ladder.ceiling) {
    const raised = { ...ladder, ceiling: dose }
    return { ladder: raised, level: buildRungs(raised).length - 1, onLadder: false, raisedCeiling: true }
  }
  if (climbs && dose < ladder.ceiling) {
    return { ladder: { ...ladder, floor: dose }, level: 0, onLadder: false, movedFloor: true }
  }
  return { ladder: { ...ladder, floor: dose, ceiling: dose }, level: 0, onLadder: false, flattened: true }
}
