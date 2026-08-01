// Client-side .ics generation from the dose schedule. A snapshot: titration
// changes do NOT propagate to an already-exported calendar.
import { scheduledWeekdaySet, slotOf, needsProtocolSetup } from './daily'
import { currentRung } from './schedule'
import { formatDose } from './calc'

const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

// AM/PM slot → local wall-clock time for the event.
export const SLOT_TIME = { AM: { h: 8, m: 0 }, PM: { h: 21, m: 0 } }

function pad(n) { return String(n).padStart(2, '0') }

// Floating local time (no Z) so the event lands at 08:00 wherever the user is.
export function icsLocalStamp(date, h, m) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(h)}${pad(m)}00`
}

export function icsUtcStamp(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

export function escapeIcs(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// RFC 5545 says lines fold at 75 octets; most parsers cope, but be correct.
export function foldLine(line) {
  if (line.length <= 75) return line
  const out = [line.slice(0, 75)]
  let rest = line.slice(75)
  while (rest.length > 74) { out.push(' ' + rest.slice(0, 74)); rest = rest.slice(74) }
  if (rest) out.push(' ' + rest)
  return out.join('\r\n')
}

// First date on/after `from` whose weekday matches, so the first occurrence of
// a weekly rule isn't in the past.
export function firstOccurrence(fromDate, weekday) {
  const d = new Date(fromDate)
  d.setHours(0, 0, 0, 0)
  const delta = (weekday - d.getDay() + 7) % 7
  d.setDate(d.getDate() + delta)
  return d
}

// Build events for one peptide: one weekly-recurring event per scheduled weekday.
export function eventsForPeptide(peptide, tState, opts) {
  if (needsProtocolSetup(peptide)) return []
  const { from, until, includeDose } = opts
  const slot = slotOf(peptide)
  const time = SLOT_TIME[slot]
  const days = [...scheduledWeekdaySet(peptide)].sort((a, b) => a - b)
  const { dose } = currentRung(peptide, tState)
  const doseLabel = includeDose && dose > 0 ? ` (${formatDose(dose, peptide.ladder.unit)})` : ''

  return days.map((wd) => {
    const start = firstOccurrence(from, wd)
    return {
      uid: `${peptide.id}-${wd}-${slot}@peptide-command-center`,
      summary: `${peptide.name} — ${slot} shot${doseLabel}`,
      start, time, byday: ICS_DAYS[wd], until,
      description: [
        peptide.timing ? `Timing: ${peptide.timing}` : null,
        dose > 0 ? `Dose at export: ${formatDose(dose, peptide.ladder.unit)}` : null,
        'Snapshot from Pepito + — re-export after protocol changes.',
      ].filter(Boolean).join('\n'),
    }
  })
}

export function buildIcs(peptides, titration, { from = new Date(), until = null, includeDose = true } = {}) {
  const stamp = icsUtcStamp(new Date())
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Pepito Plus//Schedule Export//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Peptide schedule',
  ]

  let count = 0
  for (const p of peptides) {
    for (const ev of eventsForPeptide(p, titration[p.id], { from, until, includeDose })) {
      const dtStart = icsLocalStamp(ev.start, ev.time.h, ev.time.m)
      let rrule = `RRULE:FREQ=WEEKLY;BYDAY=${ev.byday}`
      if (ev.until) rrule += `;UNTIL=${icsUtcStamp(new Date(ev.until))}`
      lines.push(
        'BEGIN:VEVENT',
        foldLine(`UID:${ev.uid}`),
        `DTSTAMP:${stamp}`,
        `DTSTART:${dtStart}`,
        `DTEND:${icsLocalStamp(ev.start, ev.time.h, ev.time.m + 15)}`,
        rrule,
        foldLine(`SUMMARY:${escapeIcs(ev.summary)}`),
        foldLine(`DESCRIPTION:${escapeIcs(ev.description)}`),
        'END:VEVENT',
      )
      count++
    }
  }
  lines.push('END:VCALENDAR')
  return { ics: lines.join('\r\n'), eventCount: count }
}
