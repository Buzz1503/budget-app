// When does the stock run out? Walked day by day, so a rest costs nothing.
//
// Stock is drawn down by doses, not by dates. A day off cycle draws nothing
// from the compound's own dose, and neither does a day paused, so both move
// the run-out date further into the calendar instead of letting it arrive on
// time with the vial still full. A rate averaged over the cycle cannot say
// that: it is right on average and wrong on every particular day, which is the
// day a low-stock alert has to be right on.
//
// Someone else drawing from the same vial does not rest when the owner does, so
// their share is taken every day that is not paused.
import { daysBetween, addDaysStr } from './schedule'
import { coversPeptide, pauseEnd } from './pauses'

const EPS = 1e-9

/**
 * @param peptide    the compound (its cycle and start date decide the rest days)
 * @param totalMg    what is left to draw on
 * @param onDayMg    what the compound uses on a day it is on cycle
 * @param otherDayMg what other people draw on any day that is not paused
 * @param todayStr   the first day to walk
 * @param pauses     the pauses (only those covering this compound count)
 * @returns { days, runOutDate, consumingDays, pausedDays, offCycleDays, open, capped }
 *   `days` is calendar days from today to the run-out date; `open` means an
 *   open-ended pause stops the walk before it finishes.
 */
export function runOutWalk({ peptide, totalMg, onDayMg, otherDayMg = 0, todayStr, pauses = [], maxDays = 4000 }) {
  const onDays = peptide?.cycleOnDays || 0
  const offDays = peptide?.cycleOffDays || 0
  const cycled = onDays > 0 && offDays > 0
  const len = onDays + offDays
  const since0 = peptide?.startDate ? daysBetween(peptide.startDate, todayStr) : 0

  // pauses as day offsets from today: [start, end] with end null while open-ended
  const spans = pauses
    .filter((p) => coversPeptide(p, peptide?.id) && p.startedOn)
    .map((p) => ({ start: daysBetween(todayStr, p.startedOn), end: pauseEnd(p) ? daysBetween(todayStr, pauseEnd(p)) : null }))
  const pauseAt = (i) => spans.find((s) => s.start <= i && (s.end == null || i <= s.end)) || null

  // Nothing resting and nothing paused: one steady rate, no need to walk.
  const rate = onDayMg + otherDayMg
  if (!cycled && !spans.length && since0 >= 0 && rate > EPS) {
    const days = Math.floor(totalMg / rate + EPS)
    return { days, runOutDate: addDaysStr(todayStr, days), consumingDays: days, pausedDays: 0, offCycleDays: 0, open: false }
  }

  let left = totalMg
  let consuming = 0
  let paused = 0
  let off = 0
  for (let i = 0; i < maxDays; i++) {
    const p = pauseAt(i)
    if (p) {
      if (p.end == null) return { open: true, pausedDays: paused, offCycleDays: off, consumingDays: consuming }
      paused += 1
      continue
    }
    const s = since0 + i
    const on = cycled ? s >= 0 && s % len < onDays : s >= 0 || !peptide?.startDate
    // before a future start date nothing is taken, and nothing is "off cycle" either
    const use = (on ? onDayMg : 0) + otherDayMg
    if (cycled && s >= 0 && !on) off += 1
    if (use <= EPS) continue
    if (left + EPS < use) {
      return { days: i, runOutDate: addDaysStr(todayStr, i), consumingDays: consuming, pausedDays: paused, offCycleDays: off, open: false }
    }
    left -= use
    consuming += 1
  }
  // further out than a person plans for: say so rather than loop for ever
  return { days: maxDays, runOutDate: addDaysStr(todayStr, maxDays), consumingDays: consuming, pausedDays: paused, offCycleDays: off, open: false, capped: true }
}
