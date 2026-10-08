// Calendar day models. One place that answers "what happens on this date" —
// what's due, in which slot, how many syringes that really is, what dose it
// will be by then, what lands on the day, and whether it was actually taken.
//
// Nothing here re-derives scheduling: whether a dose is due comes from
// dueWithPushes (the same call Home makes), and only the *dose value* on a future
// date comes from the titration projection. That split is deliberate — it's
// what stops the Calendar drifting a day away from the Home list.
import { addDaysStr, daysBetween, projectSchedule, cycleInfo, currentRung } from './schedule'
import { slotOf, needsProtocolSetup, SLOTS } from './daily'
import { unitsFor, isNasal } from './calc'
import { planShots } from './grouping'
import { LIB_TO_COMPOUND } from './mixMatrix'
import { expiryInfo, runOutInfo } from './inventory'
import { runsFor, MILESTONES } from './tenure'
import { dueWithPushes, pushedAway } from './pushes'
import { isPausedOn, pauseOn, pausesOn, reasonWords } from './pauses'
import { isReaction, openedOn, severityWord } from './reactionCourse'
import { PIN_BY_ID } from './sitePins'

export const WEEK_STARTS_ON = 1 // Monday

// Event markers the calendar paints on a day.
export const EVENT_META = {
  'step-up': { label: 'Step-up', tone: 'var(--violet)', glyph: '⬆' },
  'cycle-on': { label: 'Cycle starts', tone: 'var(--lime)', glyph: '▶' },
  'cycle-off': { label: 'Rest period', tone: 'var(--amber)', glyph: '⏸' },
  'vial-expiry': { label: 'Vial expires', tone: 'var(--coral)', glyph: '🧪' },
  'restock-by': { label: 'Runs out', tone: 'var(--coral)', glyph: '📦' },
  delivery: { label: 'Delivery expected', tone: 'var(--indigo)', glyph: '🚚' },
  started: { label: 'Started', tone: 'var(--indigo)', glyph: '◆' },
  anniversary: { label: 'Time on compound', tone: 'var(--lime)', glyph: '◇' },
  reaction: { label: 'Reaction', tone: 'var(--warn)', glyph: '●' },
}

// Adherence states a past day can be in. Future days are 'future'; a day with
// nothing scheduled is 'none' and never counts against you.
export const ADHERENCE_TONE = {
  all: 'var(--lime)',
  partial: 'var(--amber)',
  missed: 'var(--coral)',
  pending: 'var(--indigo)', // today, still to do — never counted as missed
  skipped: 'var(--violet)', // deliberately cleared — a decision, not a lapse
  paused: 'var(--text-3)',  // the protocol was not running — not a lapse either
  future: 'var(--surface2)',
  none: 'transparent',
}

export const ADHERENCE_WORDS = {
  all: 'all taken',
  partial: 'some taken',
  missed: 'missed',
  pending: 'still to do',
  skipped: 'skipped',
  paused: 'paused',
  future: 'scheduled',
  none: 'nothing scheduled',
}

function ymd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parse(dateStr) {
  return new Date(`${dateStr}T00:00:00`)
}

/** Monday of the week `dateStr` falls in. */
export function weekStart(dateStr) {
  const d = parse(dateStr)
  const shift = (d.getDay() - WEEK_STARTS_ON + 7) % 7
  return addDaysStr(dateStr, -shift)
}

export function monthStart(dateStr) {
  return `${dateStr.slice(0, 7)}-01`
}

export function monthEnd(dateStr) {
  const d = parse(monthStart(dateStr))
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  return ymd(d)
}

export function addMonths(dateStr, n) {
  const d = parse(monthStart(dateStr))
  d.setMonth(d.getMonth() + n)
  return ymd(d)
}

/** The 7-column grid a month is drawn on — always whole weeks, Monday first. */
export function monthGridRange(dateStr) {
  const from = weekStart(monthStart(dateStr))
  const lastWeek = weekStart(monthEnd(dateStr))
  return { from, to: addDaysStr(lastWeek, 6) }
}

export function datesBetween(fromStr, toStr) {
  const n = daysBetween(fromStr, toStr)
  if (n < 0) return []
  return Array.from({ length: n + 1 }, (_, i) => addDaysStr(fromStr, i))
}

// ---------- the model ----------

/**
 * @param verdictOf (compoundIdA, compoundIdB) => verdict | null. Without it a
 *   co-draw can't be proven safe, so every dose counts as its own syringe —
 *   the over-count, and the UI says which it is.
 */
export function buildCalendar({
  peptides = [], titration = {}, doseLogs = [], openVials = {}, vials = [],
  supplements = [], supplementLogs = [], skips = [],
  restock = {}, runs = {}, pushes = [], pauses = [], symptomLogs = [], bloodTests = [],
  reactions = [], injectionRecords = [],
  todayStr, from, to, verdictOf = null, leadDays = 30,
}) {
  const dates = datesBetween(from, to)
  if (dates.length === 0) return { days: [], byDate: {}, from, to, grouped: !!verdictOf }

  const active = peptides.filter((p) => !needsProtocolSetup(p))

  // Dose value + step-up flag per date, per peptide. Projected once for the
  // whole visible range rather than per day.
  const projection = {}
  for (const p of active) {
    const rows = projectSchedule(p, titration[p.id], from, dates.length, todayStr)
    projection[p.id] = Object.fromEntries(rows.map((r) => [r.date, r]))
  }

  // Logs indexed by date → peptide id, so "taken" is a lookup not a scan.
  const logsByDate = {}
  for (const l of doseLogs) {
    if (!l.date) continue
    ;(logsByDate[l.date] ||= new Set()).add(l.peptideId)
  }
  const takenByDate = {}
  for (const l of supplementLogs) {
    if (!l.date) continue
    ;(takenByDate[l.date] ||= new Set()).add(l.supplementId)
  }
  const skippedByDate = {}
  for (const k of skips) {
    if (!k.date) continue
    ;(skippedByDate[k.date] ||= new Set()).add(k.peptideId || k.supplementId)
  }

  // Other things that landed on a day. Indexed rather than scanned so a month
  // grid does not walk both lists once per cell.
  const symptomByDate = {}
  for (const l of symptomLogs) if (l.date) symptomByDate[l.date] = l
  const bloodByDate = {}
  for (const b of bloodTests) if (b.date) (bloodByDate[b.date] ||= []).push(b)

  const dayEvents = {}
  const pushEvent = (date, ev) => {
    if (date < from || date > to) return
    ;(dayEvents[date] ||= []).push(ev)
  }

  // Cycle transitions across the window (plus the day before, so a transition
  // on the first visible day is still detected).
  for (const p of active) {
    let prevOn = cycleInfo(p, addDaysStr(from, -1)).isOn
    for (const date of dates) {
      const on = cycleInfo(p, date).isOn
      if (on && !prevOn) pushEvent(date, { kind: 'cycle-on', peptideId: p.id, text: `${p.name} — cycle starts` })
      if (!on && prevOn) pushEvent(date, { kind: 'cycle-off', peptideId: p.id, text: `${p.name} — rest period starts` })
      prevOn = on
    }
    // projected step-ups
    for (const date of dates) {
      const row = projection[p.id]?.[date]
      if (row?.stepUp) {
        pushEvent(date, {
          kind: 'step-up', peptideId: p.id,
          text: `${p.name} — step up to level ${row.level + 1}`,
          dose: row.dose, unit: p.ladder.unit,
        })
      }
    }
    // reconstituted-vial expiry and projected run-out
    const exp = expiryInfo(p, openVials[p.id], todayStr)
    if (exp?.expiresAt) {
      pushEvent(exp.expiresAt, { kind: 'vial-expiry', peptideId: p.id, text: `${p.name} — open vial expires` })
    }
    const ro = runOutInfo(p, titration[p.id], vials, openVials[p.id], todayStr, pauses)
    if (ro.runOutDate && isFinite(ro.daysLeft)) {
      pushEvent(ro.runOutDate, {
        kind: 'restock-by', peptideId: p.id,
        text: `${p.name} — stock runs out${ro.daysLeft <= leadDays ? ' (order now)' : ''}`,
      })
    }

    // The day each run began, and the markers since. These are tenure, so they
    // come off the run list and `startedOn` rather than off the first log — the
    // two are different dates for anyone who was on something before installing
    // this, and the calendar should show the one they would recognise.
    for (const r of runsFor(p, runs)) {
      pushEvent(r.startedOn, { kind: 'started', peptideId: p.id, text: `${p.name} — started` })
      if (r.endedOn) continue
      for (const m of MILESTONES) {
        pushEvent(addDaysStr(r.startedOn, m.days), {
          kind: 'anniversary', peptideId: p.id, text: `${p.name} — ${m.label} on it`,
        })
      }
    }
  }

  // An injection-site reaction lands on the day it was logged, whether or not
  // it has cleared since — the calendar is a record of what happened when.
  for (const rx of reactions) {
    if (!isReaction(rx)) continue
    const rec = injectionRecords.find((r) => r.id === rx.injectionRecordId)
    if (!rec) continue
    const p = peptides.find((x) => x.id === rec.peptideId)
    const first = (rx.ratings || []).find((r) => r.severity !== 'none')
    pushEvent(openedOn(rx), {
      kind: 'reaction', peptideId: rec.peptideId, recordId: rec.id,
      text: `Reaction — ${PIN_BY_ID[rec.pinId]?.label || 'no site'}${p ? `, ${p.name}` : ''}${first ? ` (${severityWord(first.severity).toLowerCase()})` : ''}`,
    })
  }

  // expected deliveries from the restock list
  for (const [key, date] of Object.entries(restock?.delivery || {})) {
    if (!date) continue
    const id = key.startsWith('vial:') ? key.slice(5) : null
    const p = id ? peptides.find((x) => x.id === id) : null
    pushEvent(date, { kind: 'delivery', peptideId: id, text: `${p ? p.name : 'Order'} — delivery expected` })
  }

  // The same set of peptides recurs constantly, so plan each distinct set once.
  const planCache = new Map()
  const planFor = (entries) => {
    const injectable = entries.filter((e) => !e.nasal)
    if (injectable.length === 0) return null
    const key = injectable.map((e) => `${e.peptideId}@${e.units}`).sort().join('|')
    if (!planCache.has(key)) {
      const items = injectable.map((e) => ({
        id: e.peptideId,
        compoundId: e.alwaysSeparate ? null : (LIB_TO_COMPOUND[e.peptideId] || e.peptideId),
        name: e.name,
        units: e.units,
        ml: e.units / 100,
        separate: !!e.alwaysSeparate,
        separateReason: e.separateReason,
      }))
      planCache.set(key, verdictOf
        ? planShots(items, verdictOf)
        : { groups: items.map((i) => ({ items: [i], units: i.units, ml: i.ml, pairs: [], separate: !!i.separate })), shots: items.length, before: items.length, combinable: 0, saved: 0 })
    }
    return planCache.get(key)
  }

  const days = dates.map((date) => {
    const rel = daysBetween(todayStr, date) // <0 past, 0 today, >0 future
    const taken = logsByDate[date] || new Set()
    const tookOral = takenByDate[date] || new Set()
    const skippedIds = skippedByDate[date] || new Set()
    const slots = { AM: [], PM: [] }
    // Orals are kept in their own bucket rather than mixed into `slots`: every
    // consumer of `entries` reasons about syringes, units and co-draws, none of
    // which a capsule has. They still count towards the day's totals.
    const orals = { AM: [], PM: [] }

    for (const p of active) {
      // Pushes move the occurrence, so the calendar has to ask the same
      // question Home does — otherwise a day someone deliberately moved a dose
      // off still reads here as a day they missed one.
      if (!dueWithPushes(p, pushes, date)) continue
      const row = projection[p.id]?.[date]
      const dose = row ? row.dose : currentRung(p, titration[p.id]).dose
      const nasal = isNasal(p)
      const pause = pauseOn(pauses, p.id, date)
      slots[slotOf(p)].push({
        peptideId: p.id,
        name: p.name,
        dose,
        unit: p.ladder.unit,
        nasal,
        units: nasal ? null : unitsFor(p, dose),
        projected: rel > 0,
        taken: taken.has(p.id),
        skipped: skippedIds.has(p.id),
        // A dose owed by the schedule on a day the protocol was not running.
        // Neither taken nor missed — see entryState in lib/backfill.js.
        paused: !!pause,
        pauseReason: pause ? reasonWords(pause) : null,
        pushedOff: !!pushedAway(pushes, p.id, date),
        alwaysSeparate: !!p.alwaysSeparate,
        separateReason: p.separateReason || null,
        route: p.route,
      })
    }

    for (const sup of supplements) {
      // nothing was missed on a day before it was on the shelf
      if (sup.addedOn && date < sup.addedOn) continue
      orals[sup.slot === 'PM' ? 'PM' : 'AM'].push({
        supplementId: sup.id,
        name: sup.name,
        dose: sup.dose || '',
        form: sup.form,
        oral: true,
        projected: rel > 0,
        taken: tookOral.has(sup.id),
        skipped: skippedIds.has(sup.id),
        // supplements ride on a whole-protocol pause, not a per-compound one
        paused: isPausedOn(pauses.filter((x) => !x.peptideIds), sup.id, date),
      })
    }

    const oralEntries = [...orals.AM, ...orals.PM]
    const entries = [...slots.AM, ...slots.PM]
    const plans = { AM: planFor(slots.AM), PM: planFor(slots.PM) }
    const shots = SLOTS.reduce((s, k) => s + (plans[k]?.shots || 0), 0)
      + entries.filter((e) => e.nasal).length

    const all = [...entries, ...oralEntries]
    // Doses that left this day for the next one. They are not in `entries` —
    // dueWithPushes already moved them — so the count comes off the push list,
    // which is the only place the day they left is still written down.
    const pushedOffCount = active.filter((p) => pushedAway(pushes, p.id, date)).length
    const dayPause = pausesOn(pauses, date)[0] || null
    const dayPauseReason = dayPause ? reasonWords(dayPause) : null
    const scheduled = all.length
    const done = all.filter((e) => e.taken).length
    const skippedCount = all.filter((e) => e.skipped && !e.taken).length
    const pausedCount = all.filter((e) => e.paused && !e.taken && !e.skipped).length
    // Doses the protocol actually owed you that day: a paused dose was owed by
    // the schedule but not by the protocol, so it is the denominator everything
    // below divides by and never part of what was missed.
    const owed = scheduled - pausedCount
    // Only a day that has been and gone can have missed anything. Today's
    // outstanding doses are still to do, and counting them as missed would have
    // every morning open on a failure.
    const missedCount = rel < 0 ? Math.max(0, owed - done - skippedCount) : 0
    // A day you deliberately cleared is not a lapse, so it never reads as
    // missed — see dayOutcome in lib/skips.js for the same rule. A day the
    // whole thing was paused is not a lapse either, and outranks the rest:
    // there was nothing to be adherent to.
    let adherence = 'none'
    if (scheduled > 0) {
      if (owed === 0) adherence = done > 0 ? 'all' : 'paused'
      else if (done === owed) adherence = 'all'
      else if (skippedCount > 0 && done + skippedCount === owed) adherence = done > 0 ? 'partial' : 'skipped'
      else if (rel > 0) adherence = 'future'
      else if (rel === 0) adherence = done === 0 ? 'pending' : 'partial'
      else adherence = done === 0 ? 'missed' : 'partial'
    }

    return {
      date,
      weekday: parse(date).getDay(),
      isToday: rel === 0,
      isPast: rel < 0,
      isFuture: rel > 0,
      slots,
      orals,
      plans,
      entries,
      oralEntries,
      shots,
      scheduled,
      owed,
      done,
      skipped: skippedCount,
      paused: pausedCount,
      missed: missedCount,
      // the whole day, not just some of its doses — what mutes the month cell
      wholeDayPaused: scheduled > 0 && pausedCount === scheduled,
      pauseReason: dayPauseReason,
      pushedOff: pushedOffCount,
      symptom: symptomByDate[date] || null,
      bloodTests: bloodByDate[date] || [],
      adherence,
      events: dayEvents[date] || [],
    }
  })

  return {
    days,
    byDate: Object.fromEntries(days.map((d) => [d.date, d])),
    from, to,
    grouped: !!verdictOf,
  }
}

/**
 * Event lines for a compact day row. A whole stack starting on the same day is
 * common (everyone sets their schedule up in one sitting) and would otherwise
 * bury the doses under a dozen identical lines, so a kind with more than `max`
 * entries collapses to a count. The day detail still lists every one.
 */
export function groupEvents(events, max = 2) {
  const byKind = new Map()
  for (const e of events) {
    if (!byKind.has(e.kind)) byKind.set(e.kind, [])
    byKind.get(e.kind).push(e)
  }
  const out = []
  for (const [kind, list] of byKind) {
    if (list.length <= max) {
      out.push(...list.map((e) => ({ kind, text: e.text, count: 1 })))
    } else {
      out.push({
        kind,
        text: `${list.length} compounds — ${EVENT_META[kind].label.toLowerCase()}`,
        count: list.length,
      })
    }
  }
  return out
}

/** "This week": the numbers worth reading at a glance above the grid. */
export function weekSummary(days) {
  const kinds = (k) => days.reduce((s, d) => s + d.events.filter((e) => e.kind === k).length, 0)
  return {
    doses: days.reduce((s, d) => s + d.scheduled, 0),
    shots: days.reduce((s, d) => s + d.shots, 0),
    taken: days.reduce((s, d) => s + d.done, 0),
    stepUps: kinds('step-up'),
    expiring: kinds('vial-expiry'),
    restocks: kinds('restock-by'),
    deliveries: kinds('delivery'),
  }
}

/** Adherence tallies over an arbitrary set of days — drives the heatmap legend. */
export function adherenceTally(days) {
  const out = { all: 0, partial: 0, missed: 0, pending: 0, skipped: 0, paused: 0, future: 0, none: 0 }
  for (const d of days) out[d.adherence] = (out[d.adherence] || 0) + 1
  const rated = out.all + out.partial + out.missed
  return { ...out, rated, pct: rated === 0 ? null : Math.round((out.all / rated) * 100) }
}

/**
 * The month in numbers, for the line above the grid.
 *
 * Counted over days that have actually happened. A month you are three days
 * into should not read as 10% done because the other twenty-eight days have not
 * arrived yet — that is a forecast dressed up as a record.
 */
export function monthSummary(days, todayStr) {
  const past = days.filter((d) => !d.isFuture)
  const owed = past.reduce((n, d) => n + (d.owed ?? d.scheduled), 0)
  const logged = past.reduce((n, d) => n + d.done, 0)
  const complete = past.filter((d) => d.adherence === 'all').length
  return {
    scheduled: owed,
    logged,
    pct: owed === 0 ? null : Math.round((logged / owed) * 100),
    complete,
    skipped: past.reduce((n, d) => n + (d.skipped || 0), 0),
    pushed: past.reduce((n, d) => n + (d.pushedOff || 0), 0),
    pausedDays: days.filter((d) => d.wholeDayPaused).length,
    missed: past.reduce((n, d) => n + (d.missed || 0), 0),
    symptomDays: days.filter((d) => d.symptom).length,
    bloodDays: days.filter((d) => d.bloodTests?.length).length,
    days: past.length,
    todayStr,
  }
}
