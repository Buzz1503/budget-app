// The Sleep Lab's analyses. Everything here is association, not cause: each
// result shows the difference, a 95% confidence interval and how many nights
// sit on each side. A difference is called "Clear" only when its interval
// does not cross zero; with many comparisons on screen, a footnote says some
// will look real by chance.

import { addDays } from '../../health/tz'
import { OUTCOMES, OUTCOME_BY_KEY, factorName } from './dataset'
import type { NightRow, OutcomeKey, OutcomeDef, Names } from './dataset'
import { bootstrapDiff, bootstrapMean, ridgeWithCI, excludesZero, seedOf, mean, sd } from './stats'
import type { CI } from './stats'

export const ANALYSIS = {
  minPerGroup: 7, // simple comparisons need 7 nights each side
  adjustedFrom: 60, // adjusted effects from 60 nights with factor data
  manyComparisons: 20, // more than this on screen: the chance footnote
  bestWorstShare: 0.2, // top and bottom 20% by sleep score
  minPerBin: 3,
  topN: 5,
}

export const CHANCE_NOTE = 'With this many comparisons, some differences will look real by chance. Only rows whose interval stays clear of zero are called Clear.'
export const ADJUSTED_NOTE = 'Adjusted effects separate overlapping factors as well as the data allows. They are still associations, not causes.'

export type Label = 'Clear' | 'Unclear'

export interface Comparison {
  factor: string
  outcome: OutcomeKey
  nWith: number
  nWithout: number
  meanWith: number
  meanWithout: number
  diff: number
  ci: CI
  label: Label
  text: string
}

const fmt = (v: number, dp: number) => {
  const r = Number(Math.abs(v).toFixed(dp))
  return dp === 0 ? String(Math.round(Math.abs(v))) : String(r)
}

/** "Deep sleep 9 min lower (95% CI 3 to 15 lower)" */
export function effectWords(o: OutcomeDef, diff: number, ci: CI): string {
  const unit = o.unit ? ` ${o.unit}` : ''
  const dir = diff >= 0 ? o.words[0] : o.words[1]
  const sameSide = excludesZero(ci)
  const lo = diff >= 0 ? ci.lo : -ci.hi
  const hi = diff >= 0 ? ci.hi : -ci.lo
  const range = sameSide
    ? `95% CI ${fmt(lo, o.dp)} to ${fmt(hi, o.dp)} ${dir}`
    : `95% CI ${fmt(ci.lo, o.dp)} ${ci.lo < 0 ? o.words[1] : o.words[0]} to ${fmt(ci.hi, o.dp)} ${ci.hi < 0 ? o.words[1] : o.words[0]}`
  return `${o.label} ${fmt(diff, o.dp)}${unit} ${dir} (${range})`
}

/** Pairs of values for one factor on one outcome: with and without. */
function split(rows: NightRow[], inGroup: (r: NightRow) => boolean | null, outcome: OutcomeKey) {
  const a: number[] = []
  const b: number[] = []
  for (const r of rows) {
    const v = r.outcomes[outcome]
    if (v == null || !Number.isFinite(v)) continue
    const g = inGroup(r)
    if (g == null) continue
    ;(g ? a : b).push(v)
  }
  return { a, b }
}

/** One factor against one outcome: with against without. Null under 7 nights a side. */
export function compare(rows: NightRow[], factor: string, outcome: OutcomeKey, names: Names, inGroup?: (r: NightRow) => boolean | null): Comparison | null {
  const g = inGroup || ((r: NightRow) => r.binary[factor] ?? null)
  const { a, b } = split(rows, g, outcome)
  if (a.length < ANALYSIS.minPerGroup || b.length < ANALYSIS.minPerGroup) return null
  const { diff, ci } = bootstrapDiff(a, b, seedOf(`${factor}|${outcome}`))
  const o = OUTCOME_BY_KEY[outcome]
  return {
    factor, outcome, nWith: a.length, nWithout: b.length, meanWith: mean(a), meanWithout: mean(b), diff, ci,
    label: excludesZero(ci) ? 'Clear' : 'Unclear',
    text: `${effectWords(o, diff, ci)} with ${factorName(factor, names).toLowerCase()}`,
  }
}

/** Every binary factor seen in the rows. */
export function binaryFactors(rows: NightRow[]): string[] {
  const keys = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r.binary)) keys.add(k)
  return [...keys].filter((k) => k !== 'weekend').sort()
}

/** Every outcome that has values. */
export function presentOutcomes(rows: NightRow[]): OutcomeKey[] {
  return OUTCOMES.map((o) => o.key).filter((k) => rows.some((r) => r.outcomes[k] != null))
}

/** Each binary factor against each outcome (only the pairs with 7 nights a side). */
export function simpleComparisons(rows: NightRow[], names: Names, outcomes = presentOutcomes(rows)) {
  const out: Comparison[] = []
  const locked: Array<{ factor: string; have: number }> = []
  for (const f of binaryFactors(rows)) {
    let any = false
    let have = Infinity
    for (const o of outcomes) {
      const c = compare(rows, f, o, names)
      if (c) { out.push(c); any = true } else {
        const { a, b } = split(rows, (r) => r.binary[f] ?? null, o)
        have = Math.min(have, Math.min(a.length, b.length))
      }
    }
    if (!any) locked.push({ factor: f, have: Number.isFinite(have) ? have : 0 })
  }
  return { comparisons: out, locked, chanceNote: out.length > ANALYSIS.manyComparisons ? CHANCE_NOTE : null }
}

// ---------------------------------------------------------- adjusted effects

export interface Adjusted {
  factor: string
  outcome: OutcomeKey
  effect: number
  ci: CI
  label: Label
  raw: Comparison | null
  text: string
}

/** Sleep debt over the 7 nights before each row (need minus sleep, hours), for the model. */
export function sleepDebt7(rows: NightRow[], needMin: number): Map<string, number> {
  const byDate = new Map(rows.map((r) => [r.date, r.outcomes.totalSleep ?? null]))
  const out = new Map<string, number>()
  for (const r of rows) {
    let debt = 0
    let seen = 0
    for (let i = 1; i <= 7; i++) {
      const v = byDate.get(addDays(r.date, -i))
      if (v == null) continue
      debt += needMin - v
      seen++
    }
    out.set(r.date, seen ? (debt / seen) * 7 / 60 : 0)
  }
  return out
}

/**
 * Ridge regression per outcome on every factor with enough variation, plus
 * weekend, the 7-night sleep debt and the long-term trend. Unlocks at 60
 * nights with factor data. Each factor's adjusted effect comes with a
 * bootstrap CI and, beside it, the simple comparison.
 */
export function adjustedEffects(rows: NightRow[], outcome: OutcomeKey, names: Names, { needMin = 480 } = {}): { locked: true; have: number } | { locked: false; effects: Adjusted[]; n: number } {
  const withFactors = rows.filter((r) => r.outcomes[outcome] != null && Object.values(r.binary).some((v) => v != null))
  if (withFactors.length < ANALYSIS.adjustedFrom) return { locked: true, have: withFactors.length }
  // binary factors with at least 7 nights each way among these rows
  const factors = binaryFactors(withFactors).filter((f) => {
    let yes = 0
    let no = 0
    for (const r of withFactors) { const v = r.binary[f]; if (v === true) yes++; else if (v === false) no++ }
    return yes >= ANALYSIS.minPerGroup && no >= ANALYSIS.minPerGroup
  })
  if (!factors.length) return { locked: false, effects: [], n: withFactors.length }
  const debt = sleepDebt7(rows, needMin)
  const t0 = Date.parse(withFactors[0].date)
  // an unknown answer takes the column's average (its share of yes)
  const share = factors.map((f) => {
    const known = withFactors.map((r) => r.binary[f]).filter((v) => v != null)
    return known.length ? known.filter(Boolean).length / known.length : 0
  })
  const X = withFactors.map((r) => [
    ...factors.map((f, j) => (r.binary[f] == null ? share[j] : r.binary[f] ? 1 : 0)),
    r.weekend ? 1 : 0,
    debt.get(r.date) ?? 0,
    (Date.parse(r.date) - t0) / (365 * 86400000),
  ])
  const y = withFactors.map((r) => r.outcomes[outcome] as number)
  const fit = ridgeWithCI(X, y, seedOf(`ridge|${outcome}`))
  if (!fit) return { locked: false, effects: [], n: withFactors.length }
  const o = OUTCOME_BY_KEY[outcome]
  const effects = factors.map((f, j) => {
    const ci = fit.ci[j]
    const raw = compare(rows, f, outcome, names)
    const name = factorName(f, names).toLowerCase()
    return {
      factor: f, outcome, effect: fit.coef[j], ci, label: (excludesZero(ci) ? 'Clear' : 'Unclear') as Label, raw,
      text: `${raw ? `Alone: ${effectWords(o, raw.diff, raw.ci).replace(/ \(95%.*$/, '')}. ` : ''}After accounting for everything else: ${effectWords(o, fit.coef[j], ci)} with ${name}`,
    }
  })
  return { locked: false, effects, n: withFactors.length }
}

// ---------------------------------------------------------- helps and hurts

export interface Ranked { factor: string; outcome: OutcomeKey; effect: number; ci: CI; n: number; text: string; adjusted: boolean }

/**
 * "What helps" and "What hurts": clear effects ranked by size against the
 * outcome's spread, adjusted where unlocked, simple comparisons until then.
 */
export function helpsAndHurts(rows: NightRow[], names: Names, opts: { needMin?: number } = {}) {
  const ranked: Array<Ranked & { score: number; good: boolean }> = []
  for (const o of presentOutcomes(rows)) {
    const def = OUTCOME_BY_KEY[o]
    const spread = sd(rows.map((r) => r.outcomes[o]).filter((v): v is number => v != null)) || 1
    const adj = adjustedEffects(rows, o, names, opts)
    const items = adj.locked
      ? simpleComparisons(rows, names, [o]).comparisons.map((c) => ({ factor: c.factor, effect: c.diff, ci: c.ci, n: c.nWith + c.nWithout, text: c.text, adjusted: false }))
      : adj.effects.map((e) => ({ factor: e.factor, effect: e.effect, ci: e.ci, n: adj.n, text: e.text, adjusted: true }))
    for (const it of items) {
      if (!excludesZero(it.ci)) continue
      const good = (it.effect > 0) === (def.better === 'up')
      ranked.push({ ...it, outcome: o, score: Math.abs(it.effect) / spread, good })
    }
  }
  ranked.sort((a, b) => b.score - a.score)
  const strip = ({ score: _s, good: _g, ...r }: Ranked & { score: number; good: boolean }) => r
  return {
    helps: ranked.filter((r) => r.good).slice(0, ANALYSIS.topN).map(strip),
    hurts: ranked.filter((r) => !r.good).slice(0, ANALYSIS.topN).map(strip),
  }
}

// ----------------------------------------------------------- dose-response

export interface Bin { label: string; n: number; mean: number | null; ci: CI | null }
export interface BinSpec { key: string; label: string; bins: Array<{ label: string; test: (v: number) => boolean }> }

const range = (lo: number, hi: number) => (v: number) => v >= lo && v < hi

/** Bins from the data: none, then thirds of the nights that had any. */
export function dataBins(values: number[], unit: string, dp = 1): Array<{ label: string; test: (v: number) => boolean }> {
  const pos = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (pos.length < 3) return [{ label: 'None', test: (v) => v === 0 }, { label: `Any`, test: (v) => v > 0 }]
  const t1 = pos[Math.floor(pos.length / 3)]
  const t2 = pos[Math.floor((2 * pos.length) / 3)]
  const w = (v: number) => Number(v.toFixed(dp))
  const bins = [{ label: 'None', test: (v: number) => v === 0 }]
  if (t1 === t2 || t1 === pos[0]) {
    bins.push({ label: `Up to ${w(t2)} ${unit}`, test: (v) => v > 0 && v <= t2 }, { label: `Over ${w(t2)} ${unit}`, test: (v) => v > t2 })
  } else {
    bins.push({ label: `Under ${w(t1)} ${unit}`, test: (v) => v > 0 && v < t1 }, { label: `${w(t1)} to ${w(t2)} ${unit}`, test: (v) => v >= t1 && v <= t2 }, { label: `Over ${w(t2)} ${unit}`, test: (v) => v > t2 })
  }
  return bins
}

/** The fixed bins of the brief, and data-driven ones for amounts. */
export function binSpecs(rows: NightRow[], names: Names): BinSpec[] {
  const specs: BinSpec[] = [
    { key: 'drinks', label: 'Drinks', bins: [{ label: '0', test: (v) => v === 0 }, { label: '1 to 2', test: (v) => v >= 1 && v <= 2 }, { label: '3 or more', test: (v) => v >= 3 }] },
    { key: 'toBed:an-dex', label: 'Hours from Dex to bed', bins: [{ label: 'Under 8 h', test: (v) => v < 8 }, { label: '8 to 12 h', test: range(8, 12.0001) }, { label: 'Over 12 h', test: (v) => v > 12 }] },
    { key: 'toBed:lastMeal', label: 'Hours from last meal to bed', bins: [{ label: 'Under 2 h', test: (v) => v < 2 }, { label: '2 to 4 h', test: range(2, 4.0001) }, { label: 'Over 4 h', test: (v) => v > 4 }] },
    { key: 'toBed:workout', label: 'Hours from workout to bed', bins: [{ label: 'Under 3 h', test: (v) => v < 3 }, { label: '3 to 6 h', test: range(3, 6.0001) }, { label: 'Over 6 h', test: (v) => v > 6 }] },
    { key: 'toBed:sauna', label: 'Hours from sauna to bed', bins: [{ label: 'Under 3 h', test: (v) => v < 3 }, { label: '3 to 6 h', test: range(3, 6.0001) }, { label: 'Over 6 h', test: (v) => v > 6 }] },
  ]
  const keys = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r.continuous)) keys.add(k)
  for (const k of [...keys].sort()) {
    if (k.startsWith('grams:') || k.startsWith('amount:')) {
      const vals = rows.map((r) => r.continuous[k]).filter((v): v is number => v != null)
      if (!vals.some((v) => v > 0)) continue
      const unit = k.startsWith('grams:') ? 'g' : 'mg'
      specs.push({ key: k, label: factorName(k, names), bins: dataBins(vals, unit, k.startsWith('grams:') ? 2 : 1) })
    }
  }
  return specs
}

/** One continuous factor binned, the outcome's mean and CI in each bin. */
export function doseResponse(rows: NightRow[], spec: BinSpec, outcome: OutcomeKey): { spec: BinSpec; outcome: OutcomeKey; bins: Bin[]; enough: boolean } {
  const bins = spec.bins.map((b) => {
    const vals = rows.filter((r) => { const v = r.continuous[spec.key]; return v != null && b.test(v) }).map((r) => r.outcomes[outcome]).filter((v): v is number => v != null)
    if (vals.length < ANALYSIS.minPerBin) return { label: b.label, n: vals.length, mean: null, ci: null }
    const m = bootstrapMean(vals, seedOf(`${spec.key}|${b.label}|${outcome}`))
    return { label: b.label, n: vals.length, mean: m.mean, ci: m.ci }
  })
  return { spec, outcome, bins, enough: bins.filter((b) => b.mean != null).length >= 2 }
}

// --------------------------------------------------------------- carry-over

export const CARRY_OVER = ['asNeeded:an-diazepam', 'asNeeded:an-temazepam', 'habit:alcohol', 'asNeeded:an-dex']

/** Rows with "the night after" factors added: `lag:<key>` is the factor on the night before. */
export function withLag(rows: NightRow[], keys = CARRY_OVER): NightRow[] {
  const byDate = new Map(rows.map((r) => [r.date, r]))
  return rows.map((r) => {
    const prev = byDate.get(addDays(r.date, -1))
    const binary = { ...r.binary }
    for (const k of keys) binary[`lag:${k}`] = prev ? (prev.binary[k] ?? null) : null
    return { ...r, binary }
  })
}

/** The night after each carry-over factor, against nights not after one (and not on one). */
export function carryOver(rows: NightRow[], names: Names, outcomes = presentOutcomes(rows)) {
  const lagged = withLag(rows)
  const out: Comparison[] = []
  for (const k of CARRY_OVER) {
    for (const o of outcomes) {
      // the night itself is left out, so the comparison is about the next night only
      const c = compare(lagged, `lag:${k}`, o, names, (r) => (r.binary[k] === true ? null : r.binary[`lag:${k}`] ?? null))
      if (c) out.push(c)
    }
  }
  return out
}

// ------------------------------------------------------------ best and worst

export interface PresenceRow { factor: string; best: number; worst: number; overall: number; nBest: number; nWorst: number }

/** Top and bottom 20% by sleep score: how often each factor was there, against overall. */
export function bestWorst(rows: NightRow[], names: Names) {
  const scored = rows.filter((r) => r.outcomes.sleepScore != null).sort((a, b) => (b.outcomes.sleepScore as number) - (a.outcomes.sleepScore as number))
  const k = Math.floor(scored.length * ANALYSIS.bestWorstShare)
  if (k < 5) return { locked: true as const, have: scored.length, need: 25 }
  const best = scored.slice(0, k)
  const worst = scored.slice(-k)
  const share = (list: NightRow[], f: string) => {
    const known = list.filter((r) => r.binary[f] != null)
    return known.length ? known.filter((r) => r.binary[f]).length / known.length : null
  }
  const table: PresenceRow[] = []
  for (const f of binaryFactors(scored)) {
    const b = share(best, f)
    const w = share(worst, f)
    const all = share(scored, f)
    if (b == null || w == null || all == null) continue
    table.push({ factor: f, best: b, worst: w, overall: all, nBest: best.filter((r) => r.binary[f] != null).length, nWorst: worst.filter((r) => r.binary[f] != null).length })
  }
  table.sort((a, b) => Math.abs(b.worst - b.best) - Math.abs(a.worst - a.best))
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const sentences = table.filter((t) => Math.abs(t.worst - t.best) >= 0.25 && t.nBest >= 5 && t.nWorst >= 5).slice(0, 3).map((t) =>
    `${factorName(t.factor, names)} was there on ${pct(t.worst)} of your worst nights and ${pct(t.best)} of your best (${pct(t.overall)} overall).`)
  return { locked: false as const, k, table, sentences }
}

// --------------------------------------------------------- weekday, weekend

export interface WeekSplit { key: string; label: string; weekday: number | null; weekend: number | null; diff: number | null; unit: string }

/**
 * Every outcome on weekday and weekend nights, then bedtime, wake time,
 * midpoint and social jetlag (weekend midpoint minus weekday midpoint).
 * Times are minutes from noon, so a night across midnight is one number.
 */
export function weekdayWeekend(rows: NightRow[], timing: Map<string, { bedFromNoon: number; wakeFromNoon: number }>) {
  const wd = rows.filter((r) => !r.weekend)
  const we = rows.filter((r) => r.weekend)
  const avg = (list: NightRow[], get: (r: NightRow) => number | null | undefined) => {
    const v = list.map(get).filter((x): x is number => x != null && Number.isFinite(x))
    return v.length ? mean(v) : null
  }
  const out: WeekSplit[] = presentOutcomes(rows).map((k) => {
    const a = avg(wd, (r) => r.outcomes[k])
    const b = avg(we, (r) => r.outcomes[k])
    const o = OUTCOME_BY_KEY[k]
    return { key: k, label: o.label, weekday: a, weekend: b, diff: a != null && b != null ? b - a : null, unit: o.unit }
  })
  const t = (r: NightRow, f: 'bed' | 'wake' | 'mid') => {
    const x = timing.get(r.date)
    if (!x) return null
    return f === 'bed' ? x.bedFromNoon : f === 'wake' ? x.wakeFromNoon : (x.bedFromNoon + x.wakeFromNoon) / 2
  }
  for (const [key, label, f] of [['bedtime', 'Bedtime', 'bed'], ['wake', 'Wake time', 'wake'], ['midpoint', 'Midpoint of sleep', 'mid']] as const) {
    const a = avg(wd, (r) => t(r, f))
    const b = avg(we, (r) => t(r, f))
    out.push({ key, label, weekday: a, weekend: b, diff: a != null && b != null ? b - a : null, unit: 'clock' })
  }
  const mid = out.find((x) => x.key === 'midpoint')!
  return { rows: out, socialJetlagMin: mid.diff, nWeekday: wd.length, nWeekend: we.length }
}
