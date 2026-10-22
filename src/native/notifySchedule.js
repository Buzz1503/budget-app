// The notification schedule: every reminder for the next seven days, built
// from the protocol with the same day plan the snapshot uses, so a reminder
// lists exactly what Home lists. Pure; the PepitoBridge plugin hands the
// requests to iOS, which replaces the previous schedule with them.
//
//   dose     the AM and PM slot reminders, one notification per slot listing
//            each item or draw-together group with its dose and units. Left
//            to the Watch when "Remind me on" is Watch and the Watch app is
//            installed: it schedules the same reminders itself from the
//            snapshot (ios/PepitoKit WatchReminders.swift, same ids, so with
//            Both the system shows one of each on the wrist)
//   nudge    one follow-up per slot if something is still unlogged by then
//   restart  the evening before a compound's next on-cycle stretch begins
//            ("Epithalon restarts tomorrow"); goes where dose reminders go
//   reaction one daily reminder to check an open reaction
//   stock    order-by, fridge-life and weekly-count notices, and the question after a
//            log that left a vial about empty (see stockNotices.js)
//   sauna    at the session target time
//
// Logged, skipped and paused items are left out. A slot with nothing left in
// it has no reminder and no nudge.
import { addDaysStr } from '../lib/schedule'
import { dayPlan, slotRows, localDate, DEFAULT_SLOT_TIMES, REMIND_ON } from './snapshot'
import { openReactions, dueForCheck } from '../lib/reactionCourse'
import { restartsOn, restartWords } from '../lib/due'
import { displayName } from '../lib/naming'

export const SCHEDULE_DAYS = 7
export const ID_PREFIX = 'pepito.sched.'
export const DEFAULT_NOTIFICATION_SETTINGS = {
  amTime: DEFAULT_SLOT_TIMES.AM, pmTime: DEFAULT_SLOT_TIMES.PM, nudgeDelayMin: 90,
  doses: true, nudges: true, timeSensitive: true, reactions: true, reactionTime: '19:00', stock: true, sauna: true,
  remindOn: 'watch', restarts: true, restartTime: '19:00',
}

/**
 * Which devices schedule dose reminders and nudges. "Watch" falls back to the
 * iPhone while the Watch app is not installed, so a setting never leaves
 * nobody reminding.
 */
export function doseReminderDevices(remindOn, watchReady) {
  const on = REMIND_ON.includes(remindOn) ? remindOn : 'watch'
  if (on === 'iphone') return { phone: true, watch: false }
  if (on === 'both') return { phone: true, watch: !!watchReady }
  return { phone: !watchReady, watch: !!watchReady }
}

/** A local date and 'HH:MM' as a Date. */
export function at(date, hhmm) {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, m] = String(hhmm || '00:00').split(':').map(Number)
  return new Date(y, mo - 1, d, h || 0, m || 0, 0, 0)
}

/** "Reta 3 mg, 30 units", or "Draw together: BPC-157 + TB-500, 20 units". */
export function rowLine(row) {
  if (!row.group) return row.items[0].line
  const units = row.group.line.split(', ').slice(1).join(', ')
  return units ? `${row.group.title}, ${units}` : row.group.title
}

/** The category decides which buttons a dose notification gets. */
export function doseCategory(rows) {
  const items = rows.flatMap((r) => r.items)
  if (items.every((i) => i.kind === 'supplement')) return 'DOSE_TAKE'
  return items.some((i) => i.canPush) ? 'DOSE_LOG_PUSH' : 'DOSE_LOG'
}

/** What a Log, Skip or Push on the banner acts on: each group once, every other item on its own. */
function payloadFor(rows, date, slot) {
  return {
    kind: 'dose',
    date,
    slot,
    groups: rows.filter((r) => r.group).map((r) => ({ id: r.group.id, refIds: r.group.refIds })),
    items: rows.filter((r) => !r.group).map((r) => ({ refId: r.items[0].refId, kind: r.items[0].kind, canPush: r.items[0].canPush })),
    pushable: rows.flatMap((r) => r.items).filter((i) => i.canPush).map((i) => i.refId),
  }
}

/**
 * @param state  the store
 * @param opts.now Date
 * @param opts.verdictOf matrix lookup for draw-together groups (null leaves groups out)
 * @param opts.watchReady the Watch app is installed (from PepitoBridge.watchStatus)
 * @returns [{ id, title, body, fireAt (ISO), category, threadId, timeSensitive, payload }]
 */
export function buildSchedule(state, { now = new Date(), verdictOf = null, watchReady = false } = {}) {
  const ns = { ...DEFAULT_NOTIFICATION_SETTINGS, ...(state.notificationSettings || {}) }
  const onPhone = doseReminderDevices(ns.remindOn, watchReady).phone
  const today = localDate(now)
  const out = []
  const later = (d) => d.getTime() > now.getTime()

  for (let i = 0; onPhone && i < SCHEDULE_DAYS; i++) {
    const date = addDaysStr(today, i)
    const day = dayPlan(state, date, verdictOf)
    for (const slot of ['AM', 'PM']) {
      const rows = slotRows(day, slot, { dueOnly: true })
      if (!rows.length) continue
      const time = slot === 'AM' ? ns.amTime : ns.pmTime
      const fire = at(date, time)
      const body = rows.map(rowLine).join('\n')
      const base = {
        title: slot === 'AM' ? 'AM doses' : 'PM doses',
        category: doseCategory(rows),
        threadId: `pepito.slot.${slot}`,
        timeSensitive: !!ns.timeSensitive,
        payload: payloadFor(rows, date, slot),
      }
      if (ns.doses && later(fire)) {
        out.push({ ...base, id: `${ID_PREFIX}dose.${date}.${slot}`, body, fireAt: fire.toISOString() })
      }
      const nudge = new Date(fire.getTime() + (ns.nudgeDelayMin || 90) * 60000)
      if (ns.nudges && later(nudge)) {
        out.push({ ...base, id: `${ID_PREFIX}nudge.${date}.${slot}`, body: `Still to log:\n${body}`, fireAt: nudge.toISOString(), payload: { ...base.payload, nudge: true } })
      }
    }
  }

  // restarts: the evening before a compound comes back on cycle. Off days
  // already have no dose reminder or nudge, since a rest is not a due day.
  if (onPhone && ns.restarts) {
    for (let i = 0; i < SCHEDULE_DAYS; i++) {
      const date = addDaysStr(today, i)
      const next = addDaysStr(today, i + 1)
      const names = restartsOn(state.peptides || [], next, state.pauses || []).map((p) => displayName(p))
      const fire = at(date, ns.restartTime)
      if (!names.length || !later(fire)) continue
      out.push({
        id: `${ID_PREFIX}restart.${next}`,
        title: 'Restarts tomorrow',
        body: restartWords(names),
        fireAt: fire.toISOString(),
        category: 'RESTART',
        threadId: 'pepito.restart',
        timeSensitive: false,
        payload: { kind: 'restart', date: next, route: 'protocol' },
      })
    }
  }

  // reactions: one reminder a day while one is open, from today's if it is still unchecked
  if (ns.reactions) {
    const open = openReactions({ records: state.injectionRecords || [], reactions: state.reactions || [] }, today)
    if (open.length) {
      for (let i = 0; i < SCHEDULE_DAYS; i++) {
        const date = addDaysStr(today, i)
        const fire = at(date, ns.reactionTime)
        if (!later(fire)) continue
        if (i === 0 && !open.some((o) => dueForCheck(o.reaction, today))) continue
        out.push({
          id: `${ID_PREFIX}reaction.${date}`,
          title: 'Reaction check',
          body: open.length === 1 ? 'How does the site look today?' : `${open.length} sites to check today.`,
          fireAt: fire.toISOString(),
          category: 'REACTION',
          threadId: 'pepito.reaction',
          timeSensitive: false,
          payload: { kind: 'reaction', route: 'reactions' },
        })
      }
    }
  }

  // sauna: when the running session reaches its target
  const timer = state.saunaTimer
  if (ns.sauna && timer) {
    const fire = new Date(timer.startedAt + timer.targetMin * 60000)
    if (later(fire)) {
      out.push({
        id: `${ID_PREFIX}sauna`,
        title: 'Sauna',
        body: `${timer.targetMin} min is up.`,
        fireAt: fire.toISOString(),
        category: 'SAUNA_DONE',
        threadId: 'pepito.sauna',
        timeSensitive: !!ns.timeSensitive,
        payload: { kind: 'sauna', route: 'sauna' },
      })
    }
  }
  return out
}
