// Calendar day models. One place that answers "what happens on this date" —
// what's due, in which slot, how many syringes that really is, what dose it
// will be by then, what lands on the day, and whether it was actually taken.
//
// Nothing here re-derives scheduling: whether a dose is due comes from
// isDueToday (the same call Home makes), and only the *dose value* on a future
// date comes from the titration projection. That split is deliberate — it's
// what stops the Calendar drifting a day away from the Home list.
import { addDaysStr, daysBetween, projectSchedule, cycleInfo, currentRung } from './schedule'
import { isDueToday, slotOf, needsProtocolSetup, SLOTS } from './daily'
import { unitsFor, isNasal } from './calc'
import { planShots } from './grouping'
import { LIB_TO_COMPOUND } from './mixMatrix'
import { expiryInfo, runOutInfo } from './inventory'

export const WEEK_STARTS_ON = 1 // Monday

// Event markers the calendar paints on a day.
export const EVENT_META = {
  'step-up': { label: 'Step-up', tone: 'var(--violet)', glyph: '⬆' },
  'cycle-on': { label: 'Cycle starts', tone: 'var(--lime)', glyph: '▶' },
  'cycle-off': { label: 'Rest period', tone: 'var(--amber)', glyph: '⏸' },
  'vial-expiry': { label: 'Vial expires', tone: 'var(--coral)', glyph: '🧪' },
  'restock-by': { label: 'Runs out', tone: 'var(--coral)', glyph: '📦' },
  delivery: { label: 'Delivery expected', tone: 'var(--indigo)', glyph: '🚚' },
}

// Adherence states a past day can be in. Future days are 'future'; a day with
// nothing scheduled is 'none' and never counts against you.
export const ADHERENCE_TONE = {
  all: 'var(--lime)',
  partial: 'var(--amber)',
  missed: 'var(--coral)',
  pending: 'var(--indigo)', // today, still to do — never counted as missed
  future: 'var(--surface2)',
  none: 'transparent',
}

export const ADHERENCE_WORDS = {
  all: 'all taken',
  partial: 'some taken',
  missed: 'missed',
  pending: 'still to do',
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
  supplements = [], supplementLogs = [],
  restock = {}, todayStr, from, to, verdictOf = null, leadDays = 30,
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
    const ro = runOutInfo(p, titration[p.id], vials, openVials[p.id], todayStr)
    if (ro.runOutDate && isFinite(ro.daysLeft)) {
      pushEvent(ro.runOutDate, {
        kind: 'restock-by', peptideId: p.id,
        text: `${p.name} — stock runs out${ro.daysLeft <= leadDays ? ' (order now)' : ''}`,
      })
    }
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
    const slots = { AM: [], PM: [] }
    // Orals are kept in their own bucket rather than mixed into `slots`: every
    // consumer of `entries` reasons about syringes, units and co-draws, none of
    // which a capsule has. They still count towards the day's totals.
    const orals = { AM: [], PM: [] }

    for (const p of active) {
      if (!isDueToday(p, date)) continue
      const row = projection[p.id]?.[date]
      const dose = row ? row.dose : currentRung(p, titration[p.id]).dose
      const nasal = isNasal(p)
      slots[slotOf(p)].push({
        peptideId: p.id,
        name: p.name,
        dose,
        unit: p.ladder.unit,
        nasal,
        units: nasal ? null : unitsFor(p, dose),
        projected: rel > 0,
        taken: taken.has(p.id),
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
      })
    }

    const oralEntries = [...orals.AM, ...orals.PM]
    const entries = [...slots.AM, ...slots.PM]
    const plans = { AM: planFor(slots.AM), PM: planFor(slots.PM) }
    const shots = SLOTS.reduce((s, k) => s + (plans[k]?.shots || 0), 0)
      + entries.filter((e) => e.nasal).length

    const scheduled = entries.length + oralEntries.length
    const done = entries.filter((e) => e.taken).length + oralEntries.filter((e) => e.taken).length
    let adherence = 'none'
    if (scheduled > 0) {
      if (done === scheduled) adherence = 'all'
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
      done,
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
  const out = { all: 0, partial: 0, missed: 0, pending: 0, future: 0, none: 0 }
  for (const d of days) out[d.adherence] += 1
  const rated = out.all + out.partial + out.missed
  return { ...out, rated, pct: rated === 0 ? null : Math.round((out.all / rated) * 100) }
}
