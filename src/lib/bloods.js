import seed from '../data/blood_results.json'
import { daysBetween, addDaysStr } from './schedule'

/**
 * Blood results: what the lab measured, and nothing about what it means.
 *
 * This file draws a hard line it does not cross. It will tell you a number is
 * outside the lab's interval, which way it moved, and what your protocol was
 * doing at the time. It will not tell you why, what to do, or which compound
 * to blame — the arrow next to a figure is arithmetic, not a finding, and the
 * only honest reading of a marker that has moved belongs to someone qualified
 * to read it.
 *
 * The reference intervals are the lab's own and are editable, because two labs
 * running the same assay will publish different intervals and the one that
 * matters is the one printed on your report.
 */

export const PANEL_ORDER = [
  'Hormones', 'Metabolic', 'Lipids', 'Haematology',
  'Liver', 'Kidney', 'Chemistry', 'Iron studies', 'Inflammation',
]

/** The keys in a result row that are not markers. */
const META_KEYS = new Set(['id', 'date', 'lab', 'ref', 'notes', 'attachment', 'seeded'])

export const SEED_DISCLAIMER = seed.disclaimer || ''
export const SEED_PATIENT_NOTE = seed.patient_note || ''

/** The catalogue as shipped, ordered by panel then name. */
export function seedMarkers() {
  return seed.markers.map((m) => ({
    name: m.name,
    panel: m.panel,
    unit: m.unit || '',
    refLow: m.ref_low ?? null,
    refHigh: m.ref_high ?? null,
    note: m.note || '',
    watchFor: m.watch_for || [],
    custom: false,
  }))
}

/**
 * Every recorded test, oldest first.
 *
 * Chronological because everything downstream — deltas, the line on a graph,
 * "since your last test" — reads them in order, and sorting once here is the
 * only way to be sure nothing further on has to remember to.
 */
export function seedTests() {
  return seed.results
    .map((r, i) => {
      const values = {}
      for (const [k, v] of Object.entries(r)) {
        if (!META_KEYS.has(k) && v != null) values[k] = v
      }
      return {
        id: `bt-seed-${i}`,
        date: r.date,
        lab: r.lab || '',
        ref: r.ref || '',
        notes: r.notes || '',
        values,
        attachment: null,
        seeded: true,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

// --------------------------------------------------------------- markers

/** Seed plus anything added by hand, keyed by name. */
export function allMarkers(custom = []) {
  const out = [...seedMarkers()]
  const known = new Set(out.map((m) => m.name))
  for (const c of custom) {
    if (!c?.name) continue
    if (known.has(c.name)) continue
    out.push({
      name: c.name,
      panel: c.panel || 'Chemistry',
      unit: c.unit || '',
      refLow: c.refLow ?? null,
      refHigh: c.refHigh ?? null,
      note: c.note || '',
      watchFor: c.watchFor || [],
      custom: true,
    })
  }
  return out
}

export function markerByName(name, custom = []) {
  return allMarkers(custom).find((m) => m.name === name) || null
}

/**
 * The interval to judge a value against.
 *
 * An override always wins: the lab's number is a default, not a fact about the
 * person, and a report from a different lab carries different bounds.
 */
export function rangeOf(marker, overrides = {}) {
  if (!marker) return { low: null, high: null }
  const o = overrides[marker.name] || {}
  return {
    low: o.refLow !== undefined ? o.refLow : marker.refLow,
    high: o.refHigh !== undefined ? o.refHigh : marker.refHigh,
    edited: o.refLow !== undefined || o.refHigh !== undefined,
  }
}

/** 'in' | 'low' | 'high' | 'unknown' — never a word about what it means. */
export function statusOf(value, range) {
  if (value == null || !isFinite(value)) return 'unknown'
  if (range.low != null && value < range.low) return 'low'
  if (range.high != null && value > range.high) return 'high'
  if (range.low == null && range.high == null) return 'unknown'
  return 'in'
}

export function isOutOfRange(value, range) {
  const s = statusOf(value, range)
  return s === 'low' || s === 'high'
}

/**
 * Where a value sits on a drawn bar.
 *
 * A two-sided interval draws itself. A one-sided one has no far edge to scale
 * against, so the window is built around the threshold and the value — the bar
 * still says "this side of the line or that", which is the whole question a
 * one-sided interval asks.
 */
export function rangePosition(value, range) {
  const { low, high } = range
  const v = Number(value)
  if (!isFinite(v)) return null

  let winLow
  let winHigh
  let bandFrom
  let bandTo

  if (low != null && high != null) {
    const span = high - low || Math.abs(high) || 1
    winLow = low - span * 0.35
    winHigh = high + span * 0.35
    bandFrom = low
    bandTo = high
  } else if (high != null) {
    // "under this" — the floor is zero for every marker in the catalogue
    winLow = Math.min(0, v)
    winHigh = Math.max(high * 1.5, v * 1.1, high + Math.abs(high) * 0.5)
    bandFrom = winLow
    bandTo = high
  } else if (low != null) {
    // "over this" — no ceiling exists, so the window is drawn around the floor
    winLow = Math.min(low * 0.5, v * 0.9)
    winHigh = Math.max(low * 1.8, v * 1.1)
    bandFrom = low
    bandTo = winHigh
  } else {
    return null
  }

  const span = winHigh - winLow || 1
  const pct = (x) => Math.max(0, Math.min(100, ((x - winLow) / span) * 100))
  return {
    pct: pct(v),
    bandStart: pct(bandFrom),
    bandEnd: pct(bandTo),
    status: statusOf(v, range),
    oneSided: low == null || high == null,
  }
}

// ------------------------------------------------------------ the record

/** Every value recorded for one marker, oldest first. */
export function seriesFor(name, tests = []) {
  return tests
    .filter((t) => t.values?.[name] != null)
    .map((t) => ({
      testId: t.id, date: t.date, lab: t.lab,
      value: Number(t.values[name]),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function latestFor(name, tests = []) {
  const s = seriesFor(name, tests)
  return s.length ? s[s.length - 1] : null
}

/**
 * The move since the test before this one.
 *
 * Deliberately "since 17 Jul 2025" rather than "over the last six months": the
 * gap between two tests is rarely round, and rounding it invites a reading of
 * the rate that the two points do not support.
 */
export function deltaFor(name, tests = []) {
  const s = seriesFor(name, tests)
  if (s.length < 2) return null
  const last = s[s.length - 1]
  const prev = s[s.length - 2]
  const amount = Math.round((last.value - prev.value) * 1e6) / 1e6
  return {
    amount,
    from: prev.value,
    since: prev.date,
    direction: amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat',
    days: daysBetween(prev.date, last.date),
  }
}

// -------------------------------------------------------------- watching

/** Loose enough to match "MOTS-c" to "MOTS-c (5 mg)", strict enough to be right. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The markers this protocol has a reason to watch.
 *
 * Driven by each marker's own `watch_for` list, matched against what is
 * actually being taken. It is a statement about which numbers are worth having
 * in front of you, not a claim that a compound has moved any of them.
 */
export function watchList({ tests = [], custom = [], peptides = [], overrides = {} } = {}) {
  const mine = peptides.map((p) => ({ id: p.id, name: p.name, key: norm(p.name) }))
  const out = []
  for (const marker of allMarkers(custom)) {
    if (!marker.watchFor?.length) continue
    const hits = marker.watchFor
      .map((w) => mine.find((p) => p.key === norm(w) || p.key.includes(norm(w)) || norm(w).includes(p.key)))
      .filter(Boolean)
    if (!hits.length) continue
    const latest = latestFor(marker.name, tests)
    if (!latest) continue
    const range = rangeOf(marker, overrides)
    out.push({
      marker,
      range,
      latest,
      delta: deltaFor(marker.name, tests),
      position: rangePosition(latest.value, range),
      status: statusOf(latest.value, range),
      // de-duplicated: two compounds can watch the same marker
      compounds: [...new Map(hits.map((h) => [h.id, h])).values()],
    })
  }
  // out-of-range first, then by panel order — the ones that need looking at
  // should not be below the ones that do not
  return out.sort((a, b) => {
    const oa = isOutOfRange(a.latest.value, a.range) ? 0 : 1
    const ob = isOutOfRange(b.latest.value, b.range) ? 0 : 1
    if (oa !== ob) return oa - ob
    const pa = PANEL_ORDER.indexOf(a.marker.panel)
    const pb = PANEL_ORDER.indexOf(b.marker.panel)
    return pa - pb || a.marker.name.localeCompare(b.marker.name)
  })
}

/** Everything currently outside its interval, whatever panel it sits in. */
export function outOfRangeNow({ tests = [], custom = [], overrides = {} } = {}) {
  const out = []
  for (const marker of allMarkers(custom)) {
    const latest = latestFor(marker.name, tests)
    if (!latest) continue
    const range = rangeOf(marker, overrides)
    const status = statusOf(latest.value, range)
    if (status !== 'low' && status !== 'high') continue
    out.push({ marker, range, latest, status, delta: deltaFor(marker.name, tests) })
  }
  return out.sort((a, b) => {
    const pa = PANEL_ORDER.indexOf(a.marker.panel)
    const pb = PANEL_ORDER.indexOf(b.marker.panel)
    return pa - pb || a.marker.name.localeCompare(b.marker.name)
  })
}

/** One panel's markers, with everything a row needs. */
export function panelRows(panel, { tests = [], custom = [], overrides = {} } = {}) {
  return allMarkers(custom)
    .filter((m) => m.panel === panel)
    .map((marker) => {
      const latest = latestFor(marker.name, tests)
      const range = rangeOf(marker, overrides)
      return {
        marker,
        range,
        latest,
        delta: latest ? deltaFor(marker.name, tests) : null,
        position: latest ? rangePosition(latest.value, range) : null,
        status: latest ? statusOf(latest.value, range) : 'unknown',
      }
    })
    .sort((a, b) => a.marker.name.localeCompare(b.marker.name))
}

/** Panels that actually have something in them, in the stated order. */
export function panelsWithData({ tests = [], custom = [] } = {}) {
  const seen = new Set()
  for (const t of tests) for (const k of Object.keys(t.values || {})) seen.add(k)
  const byName = new Map(allMarkers(custom).map((m) => [m.name, m]))
  const panels = new Set()
  for (const n of seen) {
    const m = byName.get(n)
    if (m) panels.add(m.panel)
  }
  const extra = allMarkers(custom).filter((m) => m.custom).map((m) => m.panel)
  for (const p of extra) panels.add(p)
  const ordered = PANEL_ORDER.filter((p) => panels.has(p))
  // a custom marker can invent a panel name; it goes on the end rather than
  // disappearing because it is not in the canonical list
  for (const p of panels) if (!ordered.includes(p)) ordered.push(p)
  return ordered
}

// ------------------------------------------------------------- retesting

export const DEFAULT_RETEST_DAYS = 180

/** The most recent test that carried anything from this panel. */
export function lastTestForPanel(panel, { tests = [], custom = [] } = {}) {
  const names = new Set(allMarkers(custom).filter((m) => m.panel === panel).map((m) => m.name))
  const hits = tests.filter((t) => Object.keys(t.values || {}).some((k) => names.has(k)))
  return hits.length ? hits[hits.length - 1] : null
}

/**
 * When a panel is next due, on an interval the user sets.
 *
 * The app has no opinion about how often anyone should be tested — the default
 * is a placeholder for a number that belongs to whoever ordered the test.
 */
export function retestDue(panel, { tests = [], custom = [], intervals = {}, todayStr } = {}) {
  const last = lastTestForPanel(panel, { tests, custom })
  if (!last || !todayStr) return null
  const every = intervals[panel] ?? DEFAULT_RETEST_DAYS
  if (!every) return null
  const due = addDaysStr(last.date, every)
  const daysLeft = daysBetween(todayStr, due)
  return { panel, last: last.date, due, every, daysLeft, overdue: daysLeft < 0 }
}

// ------------------------------------------------------------ validation

/**
 * A sanity check on a typed number, not a verdict on a result.
 *
 * It exists to catch 1550 where 155 was meant. Something genuinely far outside
 * the interval is exactly the kind of result worth recording, so this warns and
 * never blocks.
 */
export function validateValue(marker, raw, overrides = {}) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: true, empty: true }
  const value = Number(text)
  if (!isFinite(value)) return { ok: false, error: 'That is not a number.' }
  if (value < 0) return { ok: false, error: 'A result cannot be negative.' }

  const range = rangeOf(marker, overrides)
  const status = statusOf(value, range)
  if (status === 'in' || status === 'unknown') return { ok: true, value, status }

  // The typo this is trying to catch is a stray digit: 1550 where 155 was
  // meant. So the test is the one a person would do in their head — shift the
  // decimal point one place and see whether the number lands back inside.
  //
  // It only asks that question of a value already well past the bound. A CRP of
  // 8 against "under 5" divides neatly into range, and is also an entirely
  // ordinary result; warning about it would train the warning to be ignored,
  // which is worse than not having one.
  const bound = status === 'high' ? range.high : range.low
  const far = bound != null && bound > 0
    && (status === 'high' ? value > bound * 3 : value < bound / 3)
  const slipped = far && (status === 'high'
    ? statusOf(value / 10, range) === 'in'
    : statusOf(value * 10, range) === 'in')
  const wild = bound != null && (status === 'high' ? value > bound * 10 : bound > 0 && value < bound / 10)
  return {
    ok: true,
    value,
    status,
    warn: slipped || wild
      ? `${value} is a long way outside the interval (${fmtRange(range, marker.unit)}). Worth checking for a stray digit — it will be saved either way.`
      : null,
  }
}

/** "135–175 g/L", "under 5 mg/L", "over 59" — the interval in words. */
export function fmtRange(range, unit = '') {
  const u = unit ? ` ${unit}` : ''
  if (range.low != null && range.high != null) return `${range.low}–${range.high}${u}`
  if (range.high != null) return `under ${range.high}${u}`
  if (range.low != null) return `over ${range.low}${u}`
  return 'no stated interval'
}

/** "+0.7" / "−3" — a signed number with a real minus sign. */
export function fmtDelta(amount) {
  if (amount == null) return ''
  const n = Math.round(Math.abs(amount) * 1e6) / 1e6
  return `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${n}`
}

/** "+0.7 since 17 Jul 2025" — or, for a number that did not move, that it didn't. */
export function deltaWords(delta, prettyDate) {
  if (!delta) return ''
  const when = prettyDate(delta.since)
  // "0 since 2 Oct 2024" reads like a measurement of nought rather than an
  // absence of movement, which is the opposite of what it means
  return delta.amount === 0 ? `unchanged since ${when}` : `${fmtDelta(delta.amount)} since ${when}`
}
