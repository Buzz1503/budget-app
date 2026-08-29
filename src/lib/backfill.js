import { addDaysStr, daysBetween } from './schedule'

/**
 * Working out what a day that has already been and gone still owes you.
 *
 * A scheduled dose on a past day is in exactly one of three states, and they
 * are not interchangeable: it was taken (a log exists), it was deliberately
 * skipped (a skip exists — a decision, not a lapse), or it was missed (neither,
 * so the day passed and nothing was recorded either way). Only the third is
 * something to catch up on.
 */

export const DOSE_STATES = {
  logged: { id: 'logged', label: 'Logged', words: 'taken and recorded' },
  skipped: { id: 'skipped', label: 'Skipped', words: 'deliberately not taken' },
  missed: { id: 'missed', label: 'Missed', words: 'nothing recorded either way' },
  due: { id: 'due', label: 'Due', words: 'still to do today' },
  scheduled: { id: 'scheduled', label: 'Scheduled', words: 'coming up' },
}

/** Which of the three states one calendar entry is in. */
export function entryState(entry, day) {
  if (entry.taken) return 'logged'
  if (entry.skipped) return 'skipped'
  if (day.isFuture) return 'scheduled'
  if (day.isToday) return 'due'
  return 'missed'
}

/** The injectable + nasal entries on a past day that were never accounted for. */
export function missedOn(day) {
  if (!day || !day.isPast) return []
  return day.entries.filter((e) => entryState(e, day) === 'missed')
}

/** Same, for oral supplements — logged separately, caught up separately. */
export function missedOralsOn(day) {
  if (!day || !day.isPast) return []
  return day.oralEntries.filter((e) => entryState(e, day) === 'missed')
}

/**
 * Missed doses grouped the way they would have been given.
 *
 * Compounds that share a syringe were one injection into one site, so they are
 * caught up as one event with one site — not as three separate shots that never
 * happened. The grouping comes from the same plan the calendar drew, so a
 * backfill can never disagree with what the day said was going to happen.
 */
export function missedGroups(day) {
  if (!day || !day.isPast) return []
  const missed = new Map(missedOn(day).map((e) => [e.peptideId, e]))
  if (missed.size === 0) return []

  const groups = []
  for (const slot of ['AM', 'PM']) {
    for (const g of day.plans?.[slot]?.groups || []) {
      const items = g.items.map((it) => missed.get(it.id)).filter(Boolean)
      if (items.length === 0) continue
      groups.push({
        key: `${day.date}-${slot}-${items.map((i) => i.peptideId).join('+')}`,
        slot,
        items,
        nasal: false,
        // only the units of what is actually being caught up, not of the
        // whole original group — half of which may already be logged
        units: items.reduce((s, i) => s + (i.units || 0), 0),
        oneShot: items.length > 1,
      })
      for (const i of items) missed.delete(i.peptideId)
    }
  }
  // nasal sprays and anything the plan did not place: each on its own
  for (const e of missed.values()) {
    groups.push({
      key: `${day.date}-solo-${e.peptideId}`,
      slot: null,
      items: [e],
      nasal: !!e.nasal,
      units: e.units || 0,
      oneShot: false,
    })
  }
  return groups
}

/** Every past day in the range still carrying a missed dose, oldest first. */
export function missedDays(days = []) {
  return days
    .filter((d) => d.isPast && (missedOn(d).length > 0 || missedOralsOn(d).length > 0))
    .map((d) => ({
      date: d.date,
      day: d,
      groups: missedGroups(d),
      orals: missedOralsOn(d),
      count: missedOn(d).length + missedOralsOn(d).length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * The most recent unbroken run of missed days ending yesterday-or-earlier.
 *
 * A gap you can catch up in one go is a gap you actually stopped for — a week
 * away, a fortnight of forgetting. Days with nothing scheduled do not break the
 * run, because nothing was owed on them.
 */
export function catchUpRun(days = [], todayStr) {
  const missed = new Set(missedDays(days).map((m) => m.date))
  if (missed.size === 0) return null
  const scheduled = new Map(days.map((d) => [d.date, d]))

  let end = null
  for (const d of days) {
    if (d.isPast && missed.has(d.date) && (!end || d.date > end)) end = d.date
  }
  if (!end) return null

  let start = end
  for (let cursor = addDaysStr(end, -1); daysBetween(cursor, end) < 400; cursor = addDaysStr(cursor, -1)) {
    const day = scheduled.get(cursor)
    if (!day) break
    if (missed.has(cursor)) { start = cursor; continue }
    // a day where nothing was due is not a break in the run
    if (day.scheduled === 0) continue
    break
  }

  const dates = []
  for (let c = start; c <= end; c = addDaysStr(c, 1)) {
    if (missed.has(c)) dates.push(c)
  }
  return {
    from: start,
    to: end,
    dates,
    days: dates.length,
    doses: dates.reduce((s, date) => s + (missedOn(scheduled.get(date)).length + missedOralsOn(scheduled.get(date)).length), 0),
    // "since Tuesday" reads better than a date when it is close
    daysAgo: todayStr ? Math.abs(daysBetween(todayStr, start)) : null,
  }
}

/**
 * Which vial was open on a given date.
 *
 * A dose you are adding three days late came out of whatever vial was in the
 * fridge three days ago. If that vial has since been finished, taking the drug
 * out of today's vial would tell the inventory a lie in both directions — this
 * vial emptier than it is, that one fuller — and every run-out date downstream
 * would inherit it. So the vial is identified first, and only a dose that came
 * from the vial still open is allowed to move it.
 */
export function vialOnDate(peptideId, dateStr, { openVials = {}, finishedVials = [] } = {}) {
  const open = openVials[peptideId]
  const openedOn = open?.reconstitutedAt || (open?.activatedAt || '').slice(0, 10) || null

  // a vial finished on or after the date, opened on or before it, was the one
  const finished = (finishedVials || [])
    .filter((f) => f.peptideId === peptideId)
    .filter((f) => {
      const from = (f.activatedAt || '').slice(0, 10)
      const to = f.date || (f.finishedAt || '').slice(0, 10)
      if (to && dateStr > to) return false
      if (from && dateStr < from) return false
      return !!to
    })
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0]

  if (finished) {
    return { where: 'finished', batchId: finished.batchId || null, vialMg: finished.vialMg ?? null, movesStock: false }
  }
  if (open && !open.finished && (!openedOn || dateStr >= openedOn)) {
    return { where: 'current', batchId: open.batchId || null, vialMg: open.vialMg ?? null, movesStock: !open.unlinked }
  }
  if (open && !open.finished && openedOn && dateStr < openedOn) {
    return { where: 'before', batchId: null, vialMg: null, movesStock: false }
  }
  return { where: 'none', batchId: null, vialMg: null, movesStock: false }
}

/** Plain sentence for what the backfill will and won't do to the stock. */
export function stockNote(v) {
  if (v.where === 'current') return 'Comes out of the vial you have open, so your run-out date catches up too.'
  if (v.where === 'finished') return 'That day was on a vial you have since finished, so your open vial is left alone.'
  if (v.where === 'before') return 'You hadn\'t opened this vial yet on that day, so your open vial is left alone.'
  return 'No vial recorded for that day, so there is nothing to take it out of — the dose is still logged.'
}

/**
 * The dose to pre-fill for a past day.
 *
 * The ladder only remembers the rung it is on now and when that rung started —
 * not the rungs before it. So rather than invent a history, this uses the dose
 * actually recorded nearest that day when there is one (a fact), and otherwise
 * the rung in force (a reasonable default). Either way it is shown, and can be
 * changed, before anything is written.
 */
export function doseOnDate(peptide, dateStr, doseLogs = [], fallbackDose) {
  const mine = doseLogs
    .filter((l) => l.peptideId === peptide.id && l.date <= dateStr)
    .sort((a, b) => b.date.localeCompare(a.date))
  if (mine.length > 0) {
    return { dose: mine[0].doseValue, unit: mine[0].unit, source: 'logged', from: mine[0].date }
  }
  return { dose: fallbackDose, unit: peptide.ladder?.unit, source: 'ladder', from: null }
}
