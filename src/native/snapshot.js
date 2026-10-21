// The snapshot: everything the native surfaces (notifications, widgets, the
// Live Activity, Siri and the Watch) show, worked out here from the store with
// the app's own logic and written to the App Group by the PepitoBridge plugin.
//
// Native code never recomputes a dose, a unit count, a due list or a draw
// group. It reads them from this file. That is the whole point of the
// snapshot: one source, so a widget can never disagree with Home.
//
// Pure. "now" and anything loaded lazily (the mix matrix, the Health model)
// are passed in.
import { addDaysStr } from '../lib/schedule'
import { currentRung } from '../lib/schedule'
import { slotOf } from '../lib/daily'
import { formatDose, formatUnitsLong, unitsFor, isNasal, round } from '../lib/calc'
import { displayName } from '../lib/naming'
import { LIB_TO_COMPOUND } from '../lib/mixMatrix'
import { planShots } from '../lib/grouping'
import { dueInSlot, takeVerb } from '../lib/supplements'
import { dueWithPushes, canPush } from '../lib/pushes'
import { isPausedOn, activePause, reasonWords, pauseEnd } from '../lib/pauses'
import { weekSummary, usualFor } from '../sauna/sauna'

export const SNAPSHOT_SCHEMA = 1
/**
 * Today and the next six days: surfaces roll over at midnight without the app,
 * and the Watch can schedule the same week of reminders the iPhone does.
 */
export const SNAPSHOT_DAYS = 7
/** Home switches to PM at this hour (currentSlot in lib/daily). */
export const SLOT_SPLIT_HOUR = 14
export const DEFAULT_SLOT_TIMES = { AM: '07:00', PM: '20:00' }
/** Where dose reminders go (More › Notifications › Remind me on). */
export const REMIND_ON = ['watch', 'iphone', 'both']
/** Zone floors as fractions of max heart rate (src/health/engine/config.ts). */
export const ZONE_FLOORS = [0.5, 0.6, 0.7, 0.8, 0.9]

const pad = (n) => String(n).padStart(2, '0')
export const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TESTOSTERONE = /testosterone/i

/** "3 mg" for an injection, "1 spray" for a nasal dose: how Home prints it, without the mcg aside. */
function doseWords(p, dose) {
  if (p.ladder?.unit === 'spray') {
    const n = round(dose, 0)
    return `${n} spray${n === 1 ? '' : 's'}`
  }
  return formatDose(dose, p.ladder?.unit)
}

const SPOKEN_UNIT = { mg: 'milligrams', mcg: 'micrograms', iu: 'international units', IU: 'international units', g: 'grams', ml: 'millilitres', mL: 'millilitres' }

/** "Log Retatrutide 3 milligrams": what VoiceOver reads on a button. */
export function spokenAction(verb, name, dose) {
  const said = String(dose || '').replace(/^([\d.]+)\s*([a-zA-Z]+)$/, (_, n, u) => `${n} ${SPOKEN_UNIT[u] || u}`)
  return [verb, name, said].filter(Boolean).join(' ')
}

/**
 * One day's items, peptides then supplements, in the order Home lists them,
 * each with its status. A dose the protocol is paused for is left out: it is
 * not owed.
 */
function itemsFor(state, date) {
  const { peptides = [], titration = {}, doseLogs = [], pushes = [], pauses = [], skips = [], supplements = [], supplementLogs = [] } = state
  const logged = new Set(doseLogs.filter((l) => l.date === date).map((l) => l.peptideId))
  const skipped = new Set(skips.filter((k) => k.kind === 'peptide' && k.date === date).map((k) => k.peptideId))
  const suppSkipped = new Set(skips.filter((k) => k.kind === 'supplement' && k.date === date).map((k) => k.supplementId))
  const taken = new Set(supplementLogs.filter((l) => l.date === date).map((l) => l.supplementId))
  const out = []
  for (const p of peptides) {
    if (!dueWithPushes(p, pushes, date) || isPausedOn(pauses, p.id, date)) continue
    const { dose } = currentRung(p, titration[p.id])
    const nasal = isNasal(p)
    const units = nasal ? null : unitsFor(p, dose)
    const name = displayName(p)
    const doseText = doseWords(p, dose)
    const unitsText = units == null || !isFinite(units) ? null : formatUnitsLong(units)
    out.push({
      id: `${date}:peptide:${p.id}`,
      refId: p.id,
      kind: 'peptide',
      name,
      compound: p.name,
      dose: doseText,
      units: unitsText,
      line: [`${name} ${doseText}`, unitsText].filter(Boolean).join(', '),
      form: nasal ? 'nasal' : 'injection',
      slot: slotOf(p),
      status: logged.has(p.id) ? 'logged' : skipped.has(p.id) ? 'skipped' : 'due',
      groupId: null,
      verb: 'Log',
      speech: spokenAction('Log', p.name, doseText),
      canPush: canPush(p),
      separate: !!p.alwaysSeparate || nasal || TESTOSTERONE.test(p.name || ''),
      ml: units == null ? null : units / 100,
    })
  }
  for (const slot of ['AM', 'PM']) {
    for (const x of dueInSlot(supplements, slot)) {
      if (isPausedOn(pauses.filter((pz) => !pz.peptideIds), x.id, date)) continue
      const verb = takeVerb(x, false)
      out.push({
        id: `${date}:supplement:${x.id}`,
        refId: x.id,
        kind: 'supplement',
        name: x.name,
        compound: x.name,
        dose: x.dose || '',
        units: null,
        line: x.dose ? `${x.name} ${x.dose}` : x.name,
        form: x.form || 'capsule',
        slot,
        status: taken.has(x.id) ? 'logged' : suppSkipped.has(x.id) ? 'skipped' : 'due',
        groupId: null,
        verb,
        speech: spokenAction(verb, x.name, x.dose),
        canPush: false,
        separate: true,
        ml: null,
      })
    }
  }
  return out
}

/**
 * Draw-together groups for one slot: the same planner Home runs, on the same
 * inputs (injections still due, nasal and always-separate items excluded). A
 * group only exists when the matrix has said MIX for every pair in it.
 */
function groupsFor(items, date, slot, verdictOf) {
  if (!verdictOf) return []
  const pool = items.filter((i) => i.kind === 'peptide' && i.slot === slot && i.status === 'due' && i.form === 'injection')
  if (pool.length < 2) return []
  const plan = planShots(pool.map((i) => ({
    id: i.id,
    compoundId: i.separate ? null : (LIB_TO_COMPOUND[i.refId] || i.refId),
    name: i.name,
    units: i.ml == null ? 0 : i.ml * 100,
    ml: i.ml,
    separate: i.separate,
  })), verdictOf)
  return plan.groups.filter((g) => g.items.length > 1).map((g, n) => {
    const members = g.items.map((m) => items.find((i) => i.id === m.id))
    return {
      id: `${date}:${slot}:group:${n}`,
      date,
      slot,
      itemIds: members.map((m) => m.id),
      refIds: members.map((m) => m.refId),
      title: `Draw together: ${members.map((m) => m.name).join(' + ')}`,
      line: `${members.map((m) => m.name).join(' + ')}, ${formatUnitsLong(g.units)}`,
      speech: `Log ${members.map((m) => m.compound).join(' and ')} together`,
    }
  })
}

/** One day's items and draw-together groups, as every surface shows them. */
export function dayPlan(state, date, verdictOf = null) {
  const items = itemsFor(state, date)
  const groups = [...groupsFor(items, date, 'AM', verdictOf), ...groupsFor(items, date, 'PM', verdictOf)]
  for (const g of groups) for (const id of g.itemIds) items.find((x) => x.id === id).groupId = g.id
  return { date, items: items.map(({ separate: _separate, ml: _ml, ...rest }) => rest), groups }
}

/**
 * One slot's rows: each draw-together group once (where its first member
 * was), every other item on its own. Only what is still due when `dueOnly`.
 */
export function slotRows(day, slot, { dueOnly = false } = {}) {
  const rows = []
  const seen = new Set()
  for (const item of day.items) {
    if (item.slot !== slot) continue
    if (item.groupId) {
      if (seen.has(item.groupId)) continue
      seen.add(item.groupId)
      const group = day.groups.find((g) => g.id === item.groupId)
      const members = group.itemIds.map((id) => day.items.find((i) => i.id === id))
      rows.push({ group, items: members, status: members.some((m) => m.status === 'due') ? 'due' : 'logged' })
    } else {
      rows.push({ group: null, items: [item], status: item.status })
    }
  }
  return dueOnly ? rows.filter((r) => r.status === 'due') : rows
}

const toHM = (t) => {
  const [h, m] = String(t || '').split(':').map(Number)
  return Number.isFinite(h) ? { h, m: Number.isFinite(m) ? m : 0 } : null
}
/** "8 pm", "7:30 am". */
export function clockLabel(hhmm) {
  const t = toHM(hhmm)
  if (!t) return ''
  const suffix = t.h < 12 ? 'am' : 'pm'
  const h12 = t.h % 12 === 0 ? 12 : t.h % 12
  return t.m ? `${h12}:${pad(t.m)} ${suffix}` : `${h12} ${suffix}`
}

/** The slot "now" falls in, by the same rule as Home. */
export const slotAt = (now) => (now.getHours() < SLOT_SPLIT_HOUR ? 'AM' : 'PM')

/**
 * The next slot that still has something due, from the current slot onwards:
 * what the Lock Screen line and the Watch complication show.
 */
export function nextDue(days, now, slotTimes) {
  const today = localDate(now)
  const order = []
  for (const d of days) for (const s of ['AM', 'PM']) order.push([d, s])
  const startSlot = slotAt(now)
  for (const [d, s] of order) {
    if (d.date === today && startSlot === 'PM' && s === 'AM') continue
    const due = d.items.filter((i) => i.slot === s && i.status === 'due')
    if (!due.length) continue
    const first = due[0]
    const more = due.length > 1 ? ` +${due.length - 1}` : ''
    const time = slotTimes[s]
    return {
      date: d.date,
      slot: s,
      time,
      count: due.length,
      line: `${first.name} ${first.dose}${more}`.trim(),
      label: `Next: ${first.name} ${first.dose}${more}, ${clockLabel(time)}`.replace(/\s+,/, ','),
    }
  }
  return null
}

/**
 * The snapshot.
 *
 * @param state     the store's state
 * @param opts.now  Date
 * @param opts.verdictOf  (compoundA, compoundB) => verdict, from the lazily loaded matrix; null leaves groups out
 * @param opts.readiness  { score, band, bandLabel, status, asOf, rhr, rhrDelta, hrv, hrvDelta, sleepMin } or null
 * @param opts.maxHR  from the Health model; falls back to the setting
 */
export function buildSnapshot(state, { now = new Date(), verdictOf = null, readiness = null, maxHR = null } = {}) {
  const today = localDate(now)
  const ns = state.notificationSettings || {}
  const slotTimes = { AM: ns.amTime || DEFAULT_SLOT_TIMES.AM, PM: ns.pmTime || DEFAULT_SLOT_TIMES.PM }
  const days = []
  for (let i = 0; i < SNAPSHOT_DAYS; i++) days.push(dayPlan(state, addDaysStr(today, i), verdictOf))
  const pause = activePause(state.pauses || [], today)
  const sessions = state.saunaSessions || []
  const saunaSettings = state.saunaSettings || {}
  const week = weekSummary(sessions, today, saunaSettings.weeklyTarget ?? 4)
  const usual = usualFor(sessions, saunaSettings)
  const timer = state.saunaTimer
  return {
    schema: SNAPSHOT_SCHEMA,
    generatedAt: now.toISOString(),
    today,
    slotTimes,
    slotSplitHour: SLOT_SPLIT_HOUR,
    days,
    next: nextDue(days, now, slotTimes),
    paused: pause
      ? { active: true, reason: reasonWords(pause), until: pauseEnd(pause), wholeProtocol: !pause.peptideIds }
      : { active: false, reason: null, until: null, wholeProtocol: false },
    readiness: readiness || null,
    sauna: {
      week: { sessions: week.count, target: week.target, heatMin: week.heatMin },
      active: timer
        ? { startedAt: timer.startedAt, targetMin: timer.targetMin, tempC: timer.tempC, rounds: timer.rounds || 1, source: timer.source || 'phone' }
        : null,
      usual: { lengthMin: usual.lengthMin, tempC: usual.tempC },
    },
    watch: {
      maxHR: maxHR || state.healthSettings?.maxHR || 190,
      zoneFloors: ZONE_FLOORS,
      countTowardMove: !!state.watchSettings?.countSaunaTowardMove,
    },
    notifications: {
      timeSensitive: ns.timeSensitive !== false,
      remindOn: REMIND_ON.includes(ns.remindOn) ? ns.remindOn : 'watch',
      doses: ns.doses !== false,
      nudges: ns.nudges !== false,
      nudgeDelayMin: ns.nudgeDelayMin || 90,
    },
  }
}
