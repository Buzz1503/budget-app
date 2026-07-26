// Weekday- and slot-aware "what do I inject right now" logic. Layers on top of
// cycleInfo (on/off cycle) without disturbing the offset-based projection engine.
import { parseISO, getDay } from 'date-fns'
import { cycleInfo } from './schedule'

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const SLOTS = ['AM', 'PM']

export function weekdayOf(dateStr) {
  return getDay(parseISO(dateStr)) // 0=Sun .. 6=Sat
}

// The weekday set a peptide is scheduled on. Explicit peptide.scheduleWeekdays
// wins; otherwise a sensible default is derived from frequency.
export function scheduledWeekdaySet(peptide) {
  const freq = peptide.frequency
  if (freq === 'daily' || freq === 'nightly') return new Set([0, 1, 2, 3, 4, 5, 6])
  if (Array.isArray(peptide.scheduleWeekdays) && peptide.scheduleWeekdays.length) {
    return new Set(peptide.scheduleWeekdays)
  }
  // defaults when the user hasn't configured specific days
  if (freq === 'weekly') return new Set([weekdayOf(peptide.startDate)])
  if (freq === '3xweek') return new Set([1, 3, 5]) // Mon/Wed/Fri
  if (freq === '5on2off') return new Set([1, 2, 3, 4, 5]) // Mon–Fri
  return new Set([0, 1, 2, 3, 4, 5, 6])
}

// The number of scheduled weekdays that can be freely picked for this frequency.
export function weekdayPickCount(frequency) {
  switch (frequency) {
    case 'weekly': return 1
    case '3xweek': return 3
    case '5on2off': return 5
    default: return 0 // daily/nightly — every day, not configurable
  }
}

// A peptide added from the compound list starts with no protocol — we never
// invent dosing values, so it stays out of the due list until the user sets it.
export function needsProtocolSetup(peptide) {
  return !(peptide?.ladder?.ceiling > 0) || !(peptide?.recon?.vialMg > 0) || !(peptide?.recon?.bacMl > 0)
}

// Pure scheduling: does the cycle + weekday pattern land on this date?
export function isScheduledToday(peptide, dateStr) {
  const c = cycleInfo(peptide, dateStr)
  if (!c.isOn) return false
  return scheduledWeekdaySet(peptide).has(weekdayOf(dateStr))
}

// Scheduling AND ready to inject — what the Home list and streak run on.
export function isDueToday(peptide, dateStr) {
  return !needsProtocolSetup(peptide) && isScheduledToday(peptide, dateStr)
}

// Map a peptide to an AM/PM slot. Explicit peptide.slot wins; otherwise infer
// from timing keywords, defaulting to AM.
const PM_RE = /bed|evening|night|pm\b|dinner|pre-?bed/i
export function slotOf(peptide) {
  if (peptide.slot === 'AM' || peptide.slot === 'PM') return peptide.slot
  if (peptide.frequency === 'nightly') return 'PM'
  if (peptide.timing && PM_RE.test(peptide.timing)) return 'PM'
  return 'AM'
}

// Some timings genuinely span both (e.g. "AM / pre-cardio" is AM; "Fasted AM or
// bedtime" is user-choice). We treat those via the explicit slot override; this
// flag just tells the UI the timing is ambiguous so it can hint the toggle.
export function slotIsFlexible(peptide) {
  if (peptide.slot) return false
  const t = peptide.timing || ''
  return /flexible/i.test(t) || (/\bor\b|\//.test(t) && PM_RE.test(t))
}

export function isDueSlot(peptide, dateStr, slot) {
  return isScheduledToday(peptide, dateStr) && slotOf(peptide) === slot
}

// Default slot by current time: before 14:00 → AM, else PM.
export function currentSlot(now = new Date()) {
  return now.getHours() < 14 ? 'AM' : 'PM'
}
