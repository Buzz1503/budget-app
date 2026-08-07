// Weekly / cycle recap — the last seven days, and the seven ahead.
//
// A recap is a summary, not an analysis: it counts what happened and lists what
// is scheduled. Where it mentions a symptom and a compound in the same breath it
// borrows the wording rules from insights.js — describe, never conclude.
//
// "Auto-surfacing" is deliberately quiet. The Home card appears when the week
// has actually turned over (or a cycle boundary is close enough to matter), and
// once dismissed for that period it stays gone until the next one.

import { addDaysStr, daysBetween, cycleInfo, currentRung, nextStepUpDate } from './schedule'
import { adherenceSummary } from './adherence'
import { metricSeries, METRIC_BY_KEY } from './metrics'
import { symptomLabel } from './attribution'
import { runOutInfo } from './inventory'

export const RECAP_CAVEAT =
  'A summary of what you logged over the period — counts and dates, not conclusions.'

/** The Monday-to-Sunday week that `todayStr` sits in, and the one before it. */
export function weekBounds(todayStr) {
  const d = new Date(`${todayStr}T00:00:00`)
  const dow = (d.getDay() + 6) % 7 // 0 = Monday
  const start = addDaysStr(todayStr, -dow)
  return {
    start,
    end: addDaysStr(start, 6),
    prevStart: addDaysStr(start, -7),
    prevEnd: addDaysStr(start, -1),
    dayOfWeek: dow,
  }
}

/** A stable id for the period a recap covers, so "seen" can be remembered. */
export function periodId(todayStr) {
  return weekBounds(todayStr).start
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function round(n, dp = 1) {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

// -------------------------------------------------------------- the sections

/** Doses taken against doses scheduled, this week and last, for the delta. */
function adherenceSection({ peptides, doseLogs }, { from, to, prevFrom, prevTo }) {
  const now = adherenceSummary(peptides, doseLogs, from, to)
  const prev = adherenceSummary(peptides, doseLogs, prevFrom, prevTo)
  if (!now.overall.scheduled) return null
  const delta = prev.overall.pct == null || now.overall.pct == null
    ? null : now.overall.pct - prev.overall.pct
  const missed = now.rows.filter((r) => r.scheduled > r.taken)
  return {
    pct: now.overall.pct,
    taken: now.overall.taken,
    scheduled: now.overall.scheduled,
    delta,
    missed: missed.map((r) => ({ name: r.name, short: r.scheduled - r.taken })),
  }
}

/** Every body metric that moved between the first and last reading in range. */
function bodySection({ measurements }, { from, to }) {
  const out = []
  for (const key of ['weight', 'bodyFat', 'muscleMass', 'waist']) {
    // one reading inside the window is not a change; reach back for a baseline
    const all = metricSeries(measurements, key)
    const inRange = all.filter((p) => p.date >= from && p.date <= to)
    if (!inRange.length) continue
    const before = all.filter((p) => p.date < from).at(-1)
    const first = before || inRange[0]
    const last = inRange.at(-1)
    if (first.date === last.date) continue
    const diff = round(last.value - first.value, 1)
    if (diff === 0) continue
    const meta = METRIC_BY_KEY[key]
    out.push({
      key, label: meta?.label || key, unit: meta?.unit || '',
      diff, value: last.value,
      better: meta?.better === 'down' ? diff < 0 : diff > 0,
      since: first.date,
    })
  }
  return out
}

/** Which symptoms showed up more, or less, than the week before. */
function symptomSection({ symptomLogs }, { from, to, prevFrom, prevTo }) {
  const count = (a, b) => {
    const m = new Map()
    for (const l of symptomLogs) {
      if (l.date < a || l.date > b) continue
      for (const t of l.tags || []) m.set(t.id, (m.get(t.id) || 0) + 1)
    }
    return m
  }
  const now = count(from, to)
  const prev = count(prevFrom, prevTo)
  const checkins = symptomLogs.filter((l) => l.date >= from && l.date <= to).length
  if (!checkins) return { checkins: 0, moved: [], top: [] }

  const polarityOf = (id) => symptomLogs
    .flatMap((l) => l.tags || []).find((t) => t.id === id)?.polarity || 'neg'

  const moved = []
  for (const id of new Set([...now.keys(), ...prev.keys()])) {
    const a = now.get(id) || 0
    const b = prev.get(id) || 0
    if (Math.abs(a - b) < 2) continue
    const pol = polarityOf(id)
    moved.push({
      id, label: symptomLabel(id), days: a, prevDays: b, polarity: pol,
      up: a > b,
      better: pol === 'pos' ? a > b : a < b,
    })
  }
  moved.sort((x, y) => Math.abs(y.days - y.prevDays) - Math.abs(x.days - x.prevDays))

  const top = [...now.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id, days]) => ({ id, label: symptomLabel(id), days, polarity: polarityOf(id) }))

  return { checkins, moved: moved.slice(0, 4), top }
}

/**
 * What lands in the next seven days: step-ups, cycle flips, and stock running
 * out. All of it is already on the schedule — this just gathers it in one place.
 */
export function whatsComing({ peptides = [], titration = {}, vials = [], openVials = {}, todayStr }, { days = 7 } = {}) {
  const horizon = addDaysStr(todayStr, days)
  const out = []

  for (const p of peptides) {
    const t = titration[p.id] || {}

    // A compound added but never confirmed onto a rung has no step-up clock yet,
    // and nextStepUpDate would date-parse the missing start.
    const stepUp = t.levelStartDate ? nextStepUpDate(p, t) : null
    if (stepUp && stepUp >= todayStr && stepUp <= horizon) {
      const { level, rungs } = currentRung(p, t)
      const next = rungs?.[level + 1]
      out.push({
        id: `step-${p.id}`, kind: 'step-up', date: stepUp, peptideId: p.id,
        label: `${p.name} steps up`,
        detail: next ? `to ${next.dose} ${p.ladder?.unit || ''}`.trim() : 'to the next rung',
        inDays: daysBetween(todayStr, stepUp),
      })
    }

    // a cycle flip is a change of state, so find the first day it differs
    if (p.cycleOnDays && p.cycleOffDays) {
      const nowOn = cycleInfo(p, todayStr).isOn
      for (let i = 1; i <= days; i++) {
        const date = addDaysStr(todayStr, i)
        if (cycleInfo(p, date).isOn !== nowOn) {
          out.push({
            id: `cycle-${p.id}`, kind: nowOn ? 'cycle-off' : 'cycle-on', date, peptideId: p.id,
            label: `${p.name} goes ${nowOn ? 'off' : 'back on'} cycle`,
            detail: nowOn ? `${p.cycleOffDays}-day break` : `${p.cycleOnDays} days on`,
            inDays: i,
          })
          break
        }
      }
    }

    const ro = runOutInfo(p, t, vials, openVials[p.id], todayStr)
    if (ro?.runOutDate && ro.runOutDate >= todayStr && ro.runOutDate <= horizon) {
      out.push({
        id: `stock-${p.id}`, kind: 'restock', date: ro.runOutDate, peptideId: p.id,
        label: `${p.name} runs out`,
        detail: 'order before you need it',
        inDays: daysBetween(todayStr, ro.runOutDate),
      })
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Cycle boundaries that just happened — the other reason a recap surfaces. */
export function recentCycleBoundary({ peptides = [], todayStr }, { within = 2 } = {}) {
  for (const p of peptides) {
    if (!p.cycleOnDays || !p.cycleOffDays) continue
    const nowOn = cycleInfo(p, todayStr).isOn
    for (let i = 1; i <= within; i++) {
      const date = addDaysStr(todayStr, -i)
      if (cycleInfo(p, date).isOn !== nowOn) {
        return { peptideId: p.id, name: p.name, date, nowOn }
      }
    }
  }
  return null
}

// ------------------------------------------------------------------ compose

/**
 * The full recap. `period` is 'week' (the current Mon–Sun, so far) or 'last'
 * (the completed week before it), because at week's end the interesting summary
 * is the week that just finished, not the one two hours old.
 */
export function buildRecap(ctx, { period = 'week' } = {}) {
  const { todayStr } = ctx
  const w = weekBounds(todayStr)
  const range = period === 'last'
    ? { from: w.prevStart, to: w.prevEnd, prevFrom: addDaysStr(w.prevStart, -7), prevTo: addDaysStr(w.prevStart, -1) }
    : { from: w.start, to: todayStr, prevFrom: w.prevStart, prevTo: w.prevEnd }

  const adherence = adherenceSection(ctx, range)
  const body = bodySection(ctx, range)
  const symptoms = symptomSection(ctx, range)
  const coming = whatsComing(ctx)
  const boundary = recentCycleBoundary(ctx)

  const headline = adherence
    ? `${adherence.pct}% of doses · ${plural(symptoms.checkins, 'check-in')}`
    : `${plural(symptoms.checkins, 'check-in')} logged`

  return {
    period, range, headline,
    adherence, body, symptoms, coming, boundary,
    empty: !adherence && !body.length && !symptoms.checkins && !coming.length,
  }
}

/**
 * Should Home show the recap card right now? Yes at the turn of the week, yes
 * just after a cycle flips, and no on a random Wednesday — the card earns its
 * space by being occasional.
 */
export function shouldSurfaceRecap(ctx, seenPeriod) {
  const { todayStr } = ctx
  const w = weekBounds(todayStr)
  const id = periodId(todayStr)
  if (seenPeriod === id) return null
  const endOfWeek = w.dayOfWeek >= 5 // Saturday or Sunday
  const boundary = recentCycleBoundary(ctx)
  if (!endOfWeek && !boundary) return null
  const recap = buildRecap(ctx, { period: 'week' })
  if (recap.empty) return null
  return { periodId: id, reason: boundary ? 'cycle' : 'week', recap }
}
