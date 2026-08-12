// Insights — plain-language patterns read back out of the user's own logs.
//
// The whole engine obeys one rule: it reports *what was logged*, never why.
// Every sentence it produces is a description of the data (counts, deltas,
// dates, percentages). None of them may claim a compound caused anything or
// that a compound "works" — the timing of a change and the reason for it are
// different things, and only the first one is in this data. Where a compound
// and a change sit in the same window, the wording says exactly that and
// nothing more.
//
// Nothing is guessed. An insight that doesn't have enough logged days behind it
// is not generated at all, so an empty Insights screen means "not enough data
// yet", never "no effect".

import { symptomLabel, categoryOf } from './attribution'
import { metricSeries, METRIC_BY_KEY } from './metrics'
import { adherenceSummary } from './adherence'
import { addDaysStr, daysBetween } from './schedule'

/** Shown wherever insights are, every time. Not fine print — the framing. */
export const INSIGHTS_CAVEAT =
  'These are patterns in what you logged, not proof of cause. Things that move together often have nothing to do with each other, and plenty else in your life is not in this app. Nothing here is medical advice.'

/** Minimum evidence before the engine will say anything at all. */
export const GATES = {
  checkinDays: 10, // distinct days with a symptom check-in
  windowDays: 28, // span from first to most recent check-in
  measurements: 2, // body-comp entries…
  measurementSpan: 14, // …at least this many days apart
  doseLogs: 10, // logged injections
}

const WINDOW = 14 // the comparison window used throughout: last 14 vs prior 14

// ---------------------------------------------------------------- readiness

/**
 * What the engine can and can't speak to yet. Returned even when ready, so the
 * UI can explain which sections are still asleep instead of silently hiding.
 */
export function insightsReadiness({ symptomLogs = [], measurements = [], doseLogs = [], todayStr }) {
  const days = new Set(symptomLogs.map((l) => l.date)).size
  const dates = symptomLogs.map((l) => l.date).sort()
  const span = dates.length ? daysBetween(dates[0], todayStr) : 0

  const mDates = measurements.map((m) => m.date).sort()
  const mSpan = mDates.length > 1 ? daysBetween(mDates[0], mDates.at(-1)) : 0

  const symptomsReady = days >= GATES.checkinDays && span >= GATES.windowDays
  const bodyReady = measurements.length >= GATES.measurements && mSpan >= GATES.measurementSpan
  const adherenceReady = doseLogs.length >= GATES.doseLogs

  const missing = []
  if (!symptomsReady) {
    missing.push(days < GATES.checkinDays
      ? `${GATES.checkinDays - days} more day${GATES.checkinDays - days === 1 ? '' : 's'} of symptom check-ins`
      : `a bit more time — patterns need about ${GATES.windowDays} days of history`)
  }
  if (!bodyReady) missing.push('two body measurements at least two weeks apart')
  if (!adherenceReady) missing.push(`${GATES.doseLogs - doseLogs.length} more logged injections`)

  return {
    ready: symptomsReady || bodyReady || adherenceReady,
    symptomsReady, bodyReady, adherenceReady,
    checkinDays: days, spanDays: span, missing,
  }
}

// ------------------------------------------------------------------ helpers

const SEV_RANK = { mild: 1, moderate: 2, strong: 3 }

function inWindow(logs, fromStr, toStr) {
  return logs.filter((l) => l.date >= fromStr && l.date <= toStr)
}

/** How many days in a set of logs carried each symptom id. */
function countBySymptom(logs, polarity) {
  const out = new Map()
  for (const l of logs) {
    for (const t of l.tags || []) {
      if (polarity && t.polarity !== polarity) continue
      const cur = out.get(t.id) || { days: 0, sev: 0 }
      cur.days += 1
      cur.sev += SEV_RANK[t.severity] || 1
      out.set(t.id, cur)
    }
  }
  return out
}

function pctChange(now, before) {
  if (!before) return null
  return Math.round(((now - before) / before) * 100)
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function round(n, dp = 1) {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

// --------------------------------------------------------------- generators

/**
 * A symptom logged notably more or less often than in the fortnight before.
 * Counted in days, because that's the unit the check-in actually records.
 */
export function symptomTrends({ symptomLogs = [], todayStr }, { limit = 4 } = {}) {
  const recentFrom = addDaysStr(todayStr, -(WINDOW - 1))
  const priorFrom = addDaysStr(todayStr, -(WINDOW * 2 - 1))
  const priorTo = addDaysStr(todayStr, -WINDOW)

  const recent = inWindow(symptomLogs, recentFrom, todayStr)
  const prior = inWindow(symptomLogs, priorFrom, priorTo)
  // Comparing an 8-day window against a 14-day one manufactures a "trend", so
  // both halves have to be populated before anything is said.
  if (recent.length < 4 || prior.length < 4) return []

  const now = countBySymptom(recent)
  const before = countBySymptom(prior)
  const ids = new Set([...now.keys(), ...before.keys()])

  const out = []
  for (const id of ids) {
    const a = now.get(id)?.days || 0
    const b = before.get(id)?.days || 0
    const diff = a - b
    if (Math.abs(diff) < 3) continue // one or two days is noise, not a trend
    if (a + b < 4) continue

    const polarity = [...recent, ...prior]
      .flatMap((l) => l.tags || []).find((t) => t.id === id)?.polarity || 'neg'
    const label = symptomLabel(id)
    const up = diff > 0
    // "good" means the direction is the one the user would want, whichever
    // symptom it is — more good effects, or fewer problems.
    const tone = polarity === 'pos' ? (up ? 'good' : 'watch') : (up ? 'watch' : 'good')

    out.push({
      id: `trend-${id}`,
      kind: 'symptom-trend',
      tone,
      title: `${label} ${up ? 'up' : 'down'}: ${a} of the last 14 days`,
      body: `You logged ${label.toLowerCase()} on ${plural(a, 'day')} in the last fortnight, against ${b} in the fortnight before.`,
      evidence: `${plural(recent.length, 'check-in')} recent · ${plural(prior.length, 'check-in')} prior`,
      magnitude: Math.abs(diff),
      symptomId: id,
    })
  }
  return out.sort((a, b) => b.magnitude - a.magnitude).slice(0, limit)
}

/**
 * A symptom whose first appearance lands close after a compound started or
 * stepped up. This is the closest the engine gets to linking the two, so the
 * wording is deliberately flat: it states the two dates and the gap, and says
 * outright that the order of events isn't a cause.
 */
export function timingCoincidences({ symptomLogs = [], peptides = [], titration = {}, todayStr }, { limit = 3 } = {}) {
  const byDate = [...symptomLogs].sort((a, b) => a.date.localeCompare(b.date))
  const firstSeen = new Map()
  for (const l of byDate) {
    for (const t of l.tags || []) {
      if (t.polarity !== 'neg') continue
      if (!firstSeen.has(t.id)) firstSeen.set(t.id, l.date)
    }
  }
  // A symptom logged once is an off day; it needs to have stuck around.
  const persisted = new Map()
  for (const [id, date] of firstSeen) {
    const days = byDate.filter((l) => (l.tags || []).some((t) => t.id === id)).length
    if (days >= 3) persisted.set(id, date)
  }

  const out = []
  for (const p of peptides) {
    const t = titration[p.id]
    const changes = [
      p.startDate ? { date: p.startDate, what: 'started' } : null,
      t?.levelStartDate && t.level > 0
        ? { date: t.levelStartDate, what: `stepped up to level ${t.level + 1}` } : null,
    ].filter(Boolean)

    for (const change of changes) {
      for (const [id, first] of persisted) {
        const gap = daysBetween(change.date, first)
        if (gap < 0 || gap > 10) continue
        // Only interesting if it wasn't already happening beforehand.
        const priorDays = byDate.filter((l) => l.date < change.date && (l.tags || []).some((x) => x.id === id)).length
        if (priorDays > 0) continue
        const total = byDate.filter((l) => (l.tags || []).some((x) => x.id === id)).length

        out.push({
          id: `timing-${p.id}-${id}`,
          kind: 'timing',
          tone: 'watch',
          title: `${symptomLabel(id)} first appeared ${gap === 0 ? 'the day' : `${plural(gap, 'day')} after`} you ${change.what} ${p.name}`,
          body: `You ${change.what} ${p.name} on ${change.date}, and first logged ${symptomLabel(id).toLowerCase()} on ${first}. It has shown up on ${plural(total, 'day')} since. Order of events is not a cause — something else that fortnight could explain it just as well.`,
          evidence: `gap ${plural(gap, 'day')} · ${plural(total, 'day')} logged`,
          magnitude: total - gap,
          peptideId: p.id,
          symptomId: id,
        })
      }
    }
  }
  return out.sort((a, b) => b.magnitude - a.magnitude).slice(0, limit)
}

/** Body-comp movement, stated as a rate so the window length is visible. */
export function bodyTrends({ measurements = [], todayStr }, { limit = 3 } = {}) {
  const out = []
  for (const key of ['weight', 'bodyFat', 'muscleMass', 'waist', 'visceralFat']) {
    const s = metricSeries(measurements, key)
    if (s.length < 2) continue
    const first = s[0]
    const last = s.at(-1)
    const span = daysBetween(first.date, last.date)
    if (span < GATES.measurementSpan) continue

    const diff = round(last.value - first.value, 1)
    if (diff === 0) continue
    const meta = METRIC_BY_KEY[key]
    const perWeek = round((diff / span) * 7, 2)
    const better = meta?.better === 'down' ? diff < 0 : diff > 0

    out.push({
      id: `body-${key}`,
      kind: 'body-trend',
      tone: better ? 'good' : 'watch',
      title: `${meta?.label || key} ${diff > 0 ? 'up' : 'down'} ${Math.abs(diff)}${meta?.unit || ''} over ${plural(span, 'day')}`,
      body: `From ${first.value}${meta?.unit || ''} on ${first.date} to ${last.value}${meta?.unit || ''} on ${last.date} — about ${perWeek > 0 ? '+' : ''}${perWeek}${meta?.unit || ''} a week across ${plural(s.length, 'reading')}.`,
      evidence: `${plural(s.length, 'reading')} · ${plural(span, 'day')}`,
      magnitude: Math.abs(perWeek),
      metric: key,
    })
  }
  return out.sort((a, b) => b.magnitude - a.magnitude).slice(0, limit)
}

/**
 * Adherence, and the body change that sits in the same window. Two facts
 * printed next to each other — the copy says so, and stops there.
 */
export function adherenceInsights({ peptides = [], doseLogs = [], measurements = [], todayStr }, { days = 30 } = {}) {
  const from = addDaysStr(todayStr, -(days - 1))
  const summary = adherenceSummary(peptides, doseLogs, from, todayStr)
  const out = []
  if (summary.overall.scheduled < 5) return out

  const pct = summary.overall.pct
  out.push({
    id: 'adherence-overall',
    kind: 'adherence',
    tone: pct >= 80 ? 'good' : pct >= 50 ? 'neutral' : 'watch',
    title: `${pct}% of scheduled doses taken in ${plural(days, 'day')}`,
    body: `${summary.overall.taken} of ${summary.overall.scheduled} scheduled injections logged.`,
    evidence: `last ${days} days`,
    magnitude: 100 - pct,
  })

  // the weakest single compound, if it's meaningfully behind the rest
  const rows = summary.rows.filter((r) => r.scheduled >= 4).sort((a, b) => a.pct - b.pct)
  if (rows.length > 1 && rows[0].pct < 70 && rows[0].pct < pct - 15) {
    const r = rows[0]
    out.push({
      id: `adherence-${r.peptideId}`,
      kind: 'adherence',
      tone: 'watch',
      title: `${r.name} is the one you miss most`,
      body: `${r.taken} of ${r.scheduled} scheduled doses logged (${r.pct}%), against ${pct}% across everything else.`,
      evidence: `last ${days} days`,
      magnitude: pct - r.pct,
      peptideId: r.peptideId,
    })
  }

  // a body change over the same window, placed beside it without a claim
  const w = metricSeries(measurements, 'weight').filter((p) => p.date >= from)
  if (w.length >= 2 && summary.overall.scheduled >= 8) {
    const diff = round(w.at(-1).value - w[0].value, 1)
    if (diff !== 0) {
      out.push({
        id: 'adherence-body',
        kind: 'adherence-body',
        tone: 'neutral',
        title: `Weight moved ${diff > 0 ? '+' : ''}${diff} kg in the same ${days} days`,
        body: `Adherence was ${pct}% over that window. These are two things that happened in the same period — this app has no way to tell whether one moved the other, and diet, training and sleep are not in it.`,
        evidence: `${plural(w.length, 'reading')} · ${pct}% adherence`,
        magnitude: Math.abs(diff),
      })
    }
  }
  return out
}

/** A clean run with nothing negative logged — worth knowing, and cheap to check. */
export function quietStretch({ symptomLogs = [], todayStr }) {
  const byDate = [...symptomLogs].sort((a, b) => b.date.localeCompare(a.date))
  if (byDate.length < 5) return []
  let streak = 0
  for (const l of byDate) {
    if ((l.tags || []).some((t) => t.polarity === 'neg')) break
    streak += 1
  }
  if (streak < 5) return []
  return [{
    id: 'quiet-stretch',
    kind: 'quiet',
    tone: 'good',
    title: `${plural(streak, 'check-in')} in a row with no issues logged`,
    body: 'Your last few check-ins carried no negative symptoms at all.',
    evidence: `most recent ${streak}`,
    magnitude: streak,
  }]
}

/** Negative symptoms concentrated in one body area. Descriptive, not a warning. */
export function siteConcentration({ symptomLogs = [], todayStr }) {
  const from = addDaysStr(todayStr, -59)
  const counts = new Map()
  let total = 0
  for (const l of symptomLogs) {
    if (l.date < from || !l.site) continue
    const hasSiteSymptom = (l.tags || []).some((t) => categoryOf(t.id) === 'injection_site')
    if (!hasSiteSymptom) continue
    counts.set(l.site, (counts.get(l.site) || 0) + 1)
    total += 1
  }
  if (total < 4) return []
  const [site, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (n < 3 || n / total < 0.5) return []
  return [{
    id: `site-${site}`,
    kind: 'site',
    tone: 'watch',
    title: `Most site reactions you logged were at one spot`,
    body: `${n} of ${total} injection-site reactions in the last 60 days were logged at ${site.replace(/-/g, ' ')}.`,
    evidence: `${n}/${total} · 60 days`,
    magnitude: n,
    site,
  }]
}

// ------------------------------------------------------------------ compose

/**
 * Everything the data currently supports, most substantial first. Ordering is
 * by evidence weight within kind, not by how interesting a card sounds.
 */
export function buildInsights(ctx) {
  const readiness = insightsReadiness(ctx)
  const cards = []
  if (readiness.symptomsReady) {
    cards.push(...symptomTrends(ctx), ...timingCoincidences(ctx), ...quietStretch(ctx), ...siteConcentration(ctx))
  }
  if (readiness.bodyReady) cards.push(...bodyTrends(ctx))
  if (readiness.adherenceReady) cards.push(...adherenceInsights(ctx))

  const rank = { timing: 0, 'symptom-trend': 1, 'body-trend': 2, adherence: 3, 'adherence-body': 4, site: 5, quiet: 6 }
  cards.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9))
  return { readiness, cards }
}

/** The single card worth putting on Home, if any. */
export function topInsight(ctx) {
  const { cards } = buildInsights(ctx)
  if (!cards.length) return null
  // Prefer something the user can act on over something merely notable.
  return cards.find((c) => c.tone === 'watch') || cards[0]
}
