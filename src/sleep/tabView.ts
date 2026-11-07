// The Sleep tab, answer first: how did I sleep, is that normal for me, what
// shaped it, and what about tonight. Pure: the screen passes nights, series
// and the Sleep Lab's results in, and gets numbers and words back.
//
// "Your normal" is the middle 80% (10th to 90th percentile) of the 28 nights
// before, from the chosen sleep source only, once there are 7 of them.

export const NORMAL = { nights: 28, lowQ: 0.1, highQ: 0.9, minNights: 7 }
export const VERDICT = { great: 85, good: 70, fair: 55, onTimeMin: 30 }
export const LAB_OUTCOME_ORDER = ['sleepScore', 'asleep', 'deep', 'rem', 'awake', 'hrLow', 'hrv', 'rested']

export type Dir = 'up' | 'down' | null
export type Tone = 'better' | 'worse' | 'same'

const DAY = 86400000
const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Linear-interpolated quantile of a sorted list. */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** The middle 80% of a set of values, with the median; null under 7 values. */
export function normalRange(values: number[]): { lo: number; hi: number; median: number; n: number } | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length < NORMAL.minNights) return null
  return { lo: quantile(v, NORMAL.lowQ), hi: quantile(v, NORMAL.highQ), median: quantile(v, 0.5), n: v.length }
}

/** Inside the band is grey; outside it, green the better way and amber the other; no better side stays grey. */
export function rangeTone(value: number | null, range: { lo: number; hi: number } | null, dir: Dir): Tone {
  if (value == null || !range || !dir) return 'same'
  if (value >= range.lo && value <= range.hi) return 'same'
  const above = value > range.hi
  return above === (dir === 'up') ? 'better' : 'worse'
}

export interface MetricSpec { key: string; label: string; unit: string; dp: number; dir: Dir; series: Map<string, number> }
export interface NormalRow {
  key: string; label: string; unit: string; dp: number; dir: Dir
  value: number | null; lo: number | null; hi: number | null; median: number | null; n: number
  tone: Tone; delta: number | null
}

/**
 * Last night against your normal, one row per metric: the 28 nights before
 * `date` that count (`counts`, the chosen source only) make the band.
 */
export function vsNormal(specs: MetricSpec[], date: string, counts: (d: string) => boolean = () => true): NormalRow[] {
  return specs.map((s) => {
    const value = s.series.get(date) ?? null
    const hist: number[] = []
    for (let i = 1; i <= NORMAL.nights; i++) {
      const d = addDays(date, -i)
      const v = s.series.get(d)
      if (v != null && counts(d)) hist.push(v)
    }
    const r = normalRange(hist)
    const k = 10 ** s.dp
    return {
      key: s.key, label: s.label, unit: s.unit, dp: s.dp, dir: s.dir, value,
      lo: r?.lo ?? null, hi: r?.hi ?? null, median: r?.median ?? null, n: r?.n ?? hist.length,
      tone: rangeTone(value, r, s.dir),
      delta: value != null && r ? Math.round((value - r.median) * k) / k : null,
    }
  })
}

/**
 * Time asleep is judged against your need, not your normal: green at or over
 * it, amber more than 30 minutes under, grey in between. The chip is the
 * difference, kept on one line: "+12 min", "−1h 23".
 */
export function asleepVsNeed(asleepMin: number, needH: number): { tone: Tone; needDelta: number; chipText: string } {
  const d = Math.round(asleepMin - needH * 60)
  const tone: Tone = d >= 0 ? 'better' : d < -30 ? 'worse' : 'same'
  const a = Math.abs(d)
  const chipText = `${d >= 0 ? '+' : '−'}${a >= 60 ? `${Math.floor(a / 60)}h\u00a0${String(a % 60).padStart(2, '0')}` : `${a}\u00a0min`}`
  return { tone, needDelta: d, chipText }
}

// ---------------------------------------------------------------- verdict

/** "7 h 52 m" */
export function hm(min: number): string {
  const m = Math.max(0, Math.round(min))
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`
}
/** "48 min" / "1 h 40 m" */
export function spanWords(min: number): string {
  const m = Math.round(Math.abs(min))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`
}

export function verdictWord(score: number | null | undefined): string {
  if (score == null) return 'Last night'
  return score >= VERDICT.great ? 'Great night' : score >= VERDICT.good ? 'Good night' : score >= VERDICT.fair ? 'Fair night' : 'A rough night'
}

/** "Good night. 7 h 52 m, 98% of what you need, bedtime on time." */
export function verdict(o: { asleepMin: number; needH: number; score: number | null | undefined; bedDiffMin: number | null }): string {
  const pct = o.needH > 0 ? Math.round((o.asleepMin / (o.needH * 60)) * 100) : null
  const bed = o.bedDiffMin == null ? null
    : Math.abs(o.bedDiffMin) <= VERDICT.onTimeMin ? 'bedtime on time'
      : `bedtime ${spanWords(o.bedDiffMin)} ${o.bedDiffMin > 0 ? 'later' : 'earlier'} than usual`
  return `${verdictWord(o.score)}. ${hm(o.asleepMin)}${pct != null ? `, ${pct}% of what you need` : ''}${bed ? `, ${bed}` : ''}.`
}

/** The median of the bedtimes before (minutes from noon), and how far this night's was from it. */
export function bedtimeVsUsual(bedFromNoon: number | null, before: number[]): { usual: number | null; diff: number | null } {
  const v = before.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length < 3 || bedFromNoon == null) return { usual: v.length >= 3 ? quantile(v, 0.5) : null, diff: null }
  const usual = quantile(v, 0.5)
  return { usual, diff: Math.round(bedFromNoon - usual) }
}

// ------------------------------------------------------- last 14 nights

export interface NightLite { date: string; asleepMin: number; bedFromNoon: number; wakeFromNoon: number }

/** Time asleep per night against need: "Under your need on 5 of 14 nights." */
export function needBars(nights: NightLite[], needH: number): { bars: Array<{ date: string; h: number; under: boolean }>; under: number; n: number; answer: string } {
  const bars = nights.map((x) => ({ date: x.date, h: Math.round((x.asleepMin / 60) * 100) / 100, under: x.asleepMin < needH * 60 }))
  const under = bars.filter((b) => b.under).length
  const answer = !bars.length ? 'No nights yet.'
    : under === 0 ? `At or over your need on all ${bars.length} nights.`
      : `Under your need on ${under} of ${bars.length} nights.`
  return { bars, under, n: bars.length, answer }
}

/** Saturday or Sunday morning: a Friday or Saturday night. */
export const isWeekendNight = (date: string) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 6 || d === 0 }

/**
 * Bedtime consistency: the spread between the earliest and latest bedtime,
 * and how much later weekend bedtimes are on average (2 nights of each).
 * "Bedtime varied by 1 h 40 m. Weekends later by 52 min."
 */
export function windowStats(nights: NightLite[]): { spreadMin: number | null; weekendLaterMin: number | null; answer: string } {
  if (nights.length < 3) return { spreadMin: null, weekendLaterMin: null, answer: 'Needs 3 nights to say.' }
  const beds = nights.map((n) => n.bedFromNoon)
  const spreadMin = Math.round(Math.max(...beds) - Math.min(...beds))
  const we = nights.filter((n) => isWeekendNight(n.date)).map((n) => n.bedFromNoon)
  const wd = nights.filter((n) => !isWeekendNight(n.date)).map((n) => n.bedFromNoon)
  const weekendLaterMin = we.length >= 2 && wd.length >= 2 ? Math.round(mean(we)! - mean(wd)!) : null
  const weekend = weekendLaterMin == null ? ''
    : Math.abs(weekendLaterMin) < 10 ? ' Weekends about the same.'
      : ` Weekends ${weekendLaterMin > 0 ? 'later' : 'earlier'} by ${spanWords(weekendLaterMin)}.`
  return { spreadMin, weekendLaterMin, answer: `Bedtime varied by ${spanWords(spreadMin)}.${weekend}` }
}

// ------------------------------------------------------------------- debt

/** The 7-night debt as a number, its trend against the day before, and one line on what it means. */
export function debtView(debtH: number, prevDebtH: number | null, needH: number): { value: number; trend: 'up' | 'down' | 'flat'; text: string } {
  const value = Math.round(debtH * 10) / 10
  const d = prevDebtH == null ? 0 : debtH - prevDebtH
  const trend = Math.abs(d) < 0.1 ? 'flat' : d > 0 ? 'up' : 'down'
  const perNight = Math.round((debtH * 60) / 7)
  const text = value < 0.5
    ? `About square with your ${needH} h need over the last 7 nights.`
    : `${value} h short of your ${needH} h need over the last 7 nights, about ${perNight} min a night.`
  return { value, trend, text }
}

// --------------------------------------------------------- what shaped it

export interface Comparison { factor: string; outcome: string; nWith: number; nWithout: number; diff: number; label: string }
export interface OutcomeDef { key: string; label: string; unit: string; dp: number; words: [string, string] }
export const NOT_ENOUGH = 'Not enough nights yet'
const MIN_EACH = 7

const amount = (o: OutcomeDef, diff: number) => {
  const r = Number(Math.abs(diff).toFixed(o.dp))
  if (r === 0) return 'about the same'
  return `${o.dp === 0 ? Math.round(Math.abs(diff)) : r}${o.unit ? ` ${o.unit}` : ''} ${diff >= 0 ? o.words[0] : o.words[1]}`
}

/**
 * The Sleep Lab's line for one factor: its clearest comparison (Clear first,
 * then by outcome: score, time asleep, deep, REM...), with n. Only from 7
 * nights with it and 7 without; otherwise "Not enough nights yet".
 */
export function labLine(factor: string, name: string, comparisons: Comparison[], outcomes: Record<string, OutcomeDef>): { text: string; enough: boolean; clear: boolean } {
  const mine = comparisons.filter((c) => c.factor === factor && c.nWith >= MIN_EACH && c.nWithout >= MIN_EACH && outcomes[c.outcome])
  if (!mine.length) return { text: NOT_ENOUGH, enough: false, clear: false }
  const rank = (c: Comparison) => (c.label === 'Clear' ? 0 : 100) + (LAB_OUTCOME_ORDER.indexOf(c.outcome) + 1 || 50)
  const c = [...mine].sort((a, b) => rank(a) - rank(b))[0]
  const o = outcomes[c.outcome]
  const lead = `Nights with ${name.charAt(0).toLowerCase()}${name.slice(1)}`
  if (c.label !== 'Clear') return { text: `${lead}: no clear difference yet, ${c.nWith} nights`, enough: true, clear: false }
  return { text: `${lead}: ${o.label.toLowerCase()} ${amount(o, c.diff)} on average, ${c.nWith} nights`, enough: true, clear: true }
}

// factor keys that are part of another chip, or not something you did
const HIDDEN = new Set(['weekend', 'lateSauna', 'lateWorkout', 'saunaElectrolytes', 'saunaLightheaded', 'saunaHeadache', 'saunaCramps', 'audioAfterSleep', 'audioLoud', 'earlyStart'])

export interface Chip { key: string; label: string; detail: string | null }

/**
 * Everything logged or detected for the night (the Sleep Lab's features for
 * that wake date, the evening before): the factors that were present, with
 * the night's own words where there are some ("2 drinks, last 9:40 pm").
 */
export function shapedChips(feature: { binary: Record<string, boolean | null>; line: string[] } | null | undefined, nameOf: (key: string) => string, extra: Chip[] = []): Chip[] {
  const out: Chip[] = []
  if (feature) {
    for (const [key, on] of Object.entries(feature.binary)) {
      if (on !== true || HIDDEN.has(key)) continue
      const label = nameOf(key)
      const first = label.split(/[ ,]/)[0].toLowerCase()
      const detail = key === 'habit:alcohol'
        ? feature.line.find((l) => /drink/.test(l)) || null
        : feature.line.find((l) => l.toLowerCase().startsWith(first)) || null
      out.push({ key, label, detail })
    }
  }
  for (const e of extra) if (!out.some((c) => c.key === e.key)) out.push(e)
  return out
}

// ------------------------------------------------------------------ trends

/** The second half of a window's average against the first half's, rounded to `dp`; null with too few nights. */
export function trendDiff(points: Array<{ date: string; value: number }>, days: number, today: string, dp = 1): number | null {
  const from = addDays(today, -days + 1)
  const inWin = points.filter((p) => p.date >= from && p.date <= today)
  if (inWin.length < 4) return null
  const mid = dayNum(from) + days / 2
  const a = mean(inWin.filter((p) => dayNum(p.date) < mid).map((p) => p.value))
  const b = mean(inWin.filter((p) => dayNum(p.date) >= mid).map((p) => p.value))
  if (a == null || b == null) return null
  return Number((b - a).toFixed(dp))
}

/** The answer's colour: the better way green, the other amber, no change or no better side grey. */
export function trendTone(diff: number | null, dir: Dir): Tone {
  if (diff == null || diff === 0 || !dir) return 'same'
  return (diff > 0) === (dir === 'up') ? 'better' : 'worse'
}

/** "Deep sleep up 8 min on average over 30 nights" from the first and second half of a window. */
export function trendAnswer(label: string, points: Array<{ date: string; value: number }>, unit: string, dp: number, days: number, today: string): string {
  const from = addDays(today, -days + 1)
  const inWin = points.filter((p) => p.date >= from && p.date <= today)
  if (inWin.length < 4) return `Needs more nights in the last ${days}.`
  const d = trendDiff(points, days, today, dp)
  if (d == null) return `${label} averaged ${mean(inWin.map((p) => p.value))!.toFixed(dp)}${unit ? ` ${unit}` : ''} over ${days} nights.`
  if (d === 0) return `${label} about the same over ${days} nights.`
  return `${label} ${d > 0 ? 'up' : 'down'} ${Math.abs(d)}${unit ? ` ${unit}` : ''} on average over ${days} nights.`
}
