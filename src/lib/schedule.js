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

export function dosesPerWeek(frequency) {
  switch (frequency) {
    case 'weekly': return 1
    case '3xweek': return 3
    case '5on2off': return 5
    case 'daily':
    case 'nightly':
    default: return 7
  }
}

// Does the frequency pattern hit this date? (independent of cycle on/off)
export function frequencyHits(peptide, dateStr) {
  const since = daysBetween(peptide.startDate, dateStr)
  if (since < 0) return false
  const inWeek = ((since % 7) + 7) % 7
  switch (peptide.frequency) {
    case 'weekly': return since % 7 === 0
    case '3xweek': return inWeek === 0 || inWeek === 2 || inWeek === 4
    case '5on2off': return inWeek < 5
    default: return true // daily / nightly
  }
}

export function isDueOn(peptide, dateStr) {
  const c = cycleInfo(peptide, dateStr)
  return c.isOn && frequencyHits(peptide, dateStr)
}

// Confirmed current rung — tolerance-gated, never auto-advances.
export function currentRung(peptide, tState) {
  const rungs = buildRungs(peptide.ladder)
  const level = Math.min(tState?.level ?? 0, rungs.length - 1)
  return { level, dose: rungs[level], maxLevel: rungs.length - 1, rungs }
}

// Is a step-up prompt due on `dateStr`?
export function stepUpDue(peptide, tState, dateStr) {
  const { level, maxLevel } = currentRung(peptide, tState)
  if (level >= maxLevel) return false
  const interval = (peptide.ladder?.intervalWeeks || 1) * 7
  if (daysBetween(tState.levelStartDate, dateStr) < interval) return false
  return cycleInfo(peptide, dateStr).isOn
}

export function nextStepUpDate(peptide, tState) {
  const { level, maxLevel } = currentRung(peptide, tState)
  if (level >= maxLevel) return null
  const interval = (peptide.ladder?.intervalWeeks || 1) * 7
  return addDaysStr(tState.levelStartDate, interval)
}

// Project a dated schedule `days` ahead from `fromStr`. Dates on/before `todayStr`
// never auto-advance (advances are tolerance-gated); future dates assume confirmation.
// Ceiling is never exceeded because rungs are clamped.
export function projectSchedule(peptide, tState, fromStr, days, todayStr) {
  const { rungs, maxLevel } = currentRung(peptide, tState)
  const interval = (peptide.ladder?.intervalWeeks || 1) * 7
  let simLevel = Math.min(tState?.level ?? 0, maxLevel)
  let simStart = tState?.levelStartDate || peptide.startDate
  const out = []
  for (let i = 0; i < days; i++) {
    const date = addDaysStr(fromStr, i)
    const c = cycleInfo(peptide, date)
    let stepUp = false
    if (
      simLevel < maxLevel &&
      c.isOn &&
      daysBetween(simStart, date) >= interval &&
      daysBetween(todayStr, date) > 0
    ) {
      simLevel += 1
      simStart = date
      stepUp = true
    }
    out.push({
      date,
      isOn: c.isOn,
      due: c.isOn && frequencyHits(peptide, date),
      dose: rungs[simLevel],
      level: simLevel,
      stepUp,
      cycleDay: c.cycleDay,
    })
  }
  return out
}
