// What the Sauna tab can say now, for someone who uses a sauna almost every
// day: since you started against the 4 weeks before, comparisons inside sauna
// days (evening against earlier, longer against shorter, hotter against
// cooler), and heat adaptation as heart rate at minute 10 at the same
// temperature. Pure; Health comes in through lookups. Association only:
// "higher after", never "because of".

import { addDays, daysBetween } from '../health/tz'
import { changeLabel } from '../health/engine/phases'
import type { ChangeLabel } from '../health/engine/phases'
import { minutesOf, weekOf } from './sauna'
import type { SaunaSession } from './sauna'
import { firstSessionDate, tempBand } from './analytics'
import type { NightRow, MorningRow, HRSeries } from './analytics'

export const INSIGHTS = {
  beforeDays: 28, // the 4 weeks before the first session
  earlyDays: 14, // "Early: 6 days" until 14 days since the first session
  overlapDays: 14, // a compound change this close to the first session gets the caveat
  withinMin: 5, // a split needs 5 sessions on each side
  eveningFrom: 18 * 60, // an evening session starts at 6 pm or later
  minute10Sec: 600, // heart rate at minute 10
  minute10TolSec: 60, // readings within a minute of it
  adaptationMin: 6, // sessions at one temperature band before a verdict
  adaptationCompare: 3, // the first 3 against the latest 3
  adaptationBpm: 3, // a change of 3 bpm or more is a change
  lengthChangeMin: 5, // "your sessions have also got longer" from a 5 minute difference
  gridMaxWeeks: 12,
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null
}

// ------------------------------------------------- since you started vs before

export interface Lookups {
  night: (wake: string) => (NightRow & { asleepMin?: number | null }) | null
  morning: (date: string) => MorningRow
}

const BEFORE_SINCE = [
  { key: 'rhr', label: 'Resting heart rate', unit: 'bpm', dp: 0, wobble: 2, get: (l: Lookups, d: string) => l.morning(d).rhr },
  { key: 'hrv', label: 'HRV', unit: 'ms', dp: 0, wobble: 6, get: (l: Lookups, d: string) => l.morning(d).hrv },
  { key: 'sleepingHR', label: 'Sleeping heart rate', unit: 'bpm', dp: 0, wobble: 2, get: (l: Lookups, d: string) => l.night(d)?.sleepingHR ?? null },
  { key: 'sleep', label: 'Sleep', unit: 'h', dp: 1, wobble: 0.5, get: (l: Lookups, d: string) => { const v = l.night(d)?.asleepMin; return v == null ? null : v / 60 } },
  { key: 'deepSleep', label: 'Deep sleep', unit: 'min', dp: 0, wobble: 15, get: (l: Lookups, d: string) => l.night(d)?.deepMin ?? null },
  { key: 'restlessness', label: 'Restlessness', unit: 'per hour', dp: 1, wobble: 1, get: (l: Lookups, d: string) => l.night(d)?.restless ?? null },
  { key: 'readiness', label: 'Readiness', unit: '', dp: 0, wobble: 8, get: (l: Lookups, d: string) => l.morning(d).readiness },
] as const

export interface BeforeSinceRow { key: string; text: string; before: number; since: number; nBefore: number; nSince: number; label: ChangeLabel }

const fmt = (v: number, dp: number) => (dp ? v.toFixed(dp) : String(Math.round(v)))

/**
 * Since you started sauna against the 4 weeks before the first session, every day
 * since (mornings from the first session's day, nights from the first night after it).
 * Shown from day one, marked "Early" for the first 14 days.
 */
export function beforeVsSince(input: Lookups & { sessions: SaunaSession[]; today: string; wobble?: Partial<Record<string, number>> }) {
  const first = firstSessionDate(input.sessions)
  if (!first) return { status: 'none' as const, text: 'Log a session to start this comparison.', rows: [] as BeforeSinceRow[], days: 0, early: null as string | null }
  const days = Math.max(0, daysBetween(first, input.today))
  const before: string[] = []
  for (let i = INSIGHTS.beforeDays; i >= 1; i--) before.push(addDays(first, -i))
  const since: string[] = []
  for (let d = first; d < input.today; d = addDays(d, 1)) since.push(d)
  const rows: BeforeSinceRow[] = []
  for (const m of BEFORE_SINCE) {
    // a morning belongs to its own date; a night to its wake date (the night after day d wakes on d + 1)
    const isNight = ['sleepingHR', 'sleep', 'deepSleep', 'restlessness'].includes(m.key)
    const at = (d: string) => (isNight ? addDays(d, 1) : d)
    const b = before.map((d) => m.get(input, at(d))).filter((v): v is number => v != null && Number.isFinite(v))
    const s = since.map((d) => m.get(input, at(d))).filter((v): v is number => v != null && Number.isFinite(v))
    if (!b.length || !s.length) continue
    const mb = mean(b) as number
    const ms = mean(s) as number
    const label = changeLabel(ms - mb, input.wobble?.[m.key] ?? m.wobble)
    const u = m.unit ? ` ${m.unit}` : ''
    rows.push({
      key: m.key, before: mb, since: ms, nBefore: b.length, nSince: s.length, label,
      text: `${m.label} ${fmt(ms, m.dp)}${u} since you started sauna, ${fmt(mb, m.dp)}${u} in the 4 weeks before.`,
    })
  }
  const early = days < INSIGHTS.earlyDays ? `Early: ${days} ${days === 1 ? 'day' : 'days'}` : null
  if (!rows.length) return { status: 'locked' as const, text: 'Needs Health data from the 4 weeks before your first session and the days since. You have none on one side yet.', rows, days, early }
  return { status: 'ok' as const, text: null, rows, days, early }
}

/**
 * The mandatory caveat: a compound started, stopped or changed dose within 14 days of
 * the first session (or in the 4 weeks before it), so the two periods mix both.
 */
export function compoundCaveat(sessions: SaunaSession[], events: Array<{ date: string; text: string }>): string | null {
  const first = firstSessionDate(sessions)
  if (!first) return null
  const from = addDays(first, -INSIGHTS.beforeDays)
  const to = addDays(first, INSIGHTS.overlapDays)
  const near = events.filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => Math.abs(daysBetween(a.date, first)) - Math.abs(daysBetween(b.date, first)))[0]
  if (!near) return null
  const d = daysBetween(near.date, first) // positive: before the first session
  const when = d === 0 ? 'the same day you started sauna' : `${Math.abs(d)} ${Math.abs(d) === 1 ? 'day' : 'days'} ${d > 0 ? 'before' : 'after'} you started sauna`
  return `${near.text.replace(/\.$/, '')} ${when}, so this mixes both.`
}

// ------------------------------------------------------- within sauna days

export interface SplitRow { split: string; key: string; text: string; nA: number; nB: number; diff: number; label: ChangeLabel }
export interface SplitResult { key: string; title: string; locked: string | null; rows: SplitRow[] }

const OUTCOMES = [
  { key: 'sleepScore', label: 'Sleep score that night', unit: '', wobble: 8, get: (l: Lookups, d: string) => l.night(addDays(d, 1))?.score ?? null },
  { key: 'hrv', label: 'HRV the next morning', unit: 'ms', wobble: 6, get: (l: Lookups, d: string) => l.morning(addDays(d, 1)).hrv },
  { key: 'rhr', label: 'Resting heart rate the next morning', unit: 'bpm', wobble: 2, get: (l: Lookups, d: string) => l.morning(addDays(d, 1)).rhr },
] as const

/** Split sessions into two groups by rank: the lower half and the upper half of a value, ties by date. */
export function splitAtMedian<T extends SaunaSession>(list: T[], value: (s: T) => number): { low: T[]; high: T[]; median: number | null } {
  const sorted = [...list].sort((a, b) => value(a) - value(b) || (a.date + a.start).localeCompare(b.date + b.start))
  const half = Math.floor(sorted.length / 2)
  return { low: sorted.slice(0, half), high: sorted.slice(sorted.length - half), median: median(list.map(value)) }
}

function compareGroups(l: Lookups, split: string, a: SaunaSession[], b: SaunaSession[], words: [string, string]): SplitRow[] {
  const rows: SplitRow[] = []
  for (const o of OUTCOMES) {
    const va = a.map((s) => o.get(l, s.date)).filter((v): v is number => v != null)
    const vb = b.map((s) => o.get(l, s.date)).filter((v): v is number => v != null)
    if (va.length < INSIGHTS.withinMin || vb.length < INSIGHTS.withinMin) continue
    const diff = (mean(va) as number) - (mean(vb) as number)
    const label = changeLabel(diff, o.wobble)
    const d = Math.round(diff)
    const text = label === 'Within normal fluctuation' || d === 0
      ? `${o.label} was about the same ${words[0]} as ${words[1]}.`
      : `${o.label} was ${Math.abs(d)}${o.unit ? ` ${o.unit}` : ''} ${d > 0 ? 'higher' : 'lower'} ${words[0]} than ${words[1]}.`
    rows.push({ split, key: o.key, text, nA: va.length, nB: vb.length, diff, label })
  }
  return rows
}

/**
 * Inside sauna days, no days off needed: evening sessions against earlier ones, longer
 * against shorter (split at your median length), hotter against cooler (split at your
 * median temperature), each against that night's sleep and the next morning's HRV and
 * resting heart rate. One session a day (the day's longest), 5 on each side to unlock.
 */
export function withinSauna(sessions: SaunaSession[], l: Lookups): SplitResult[] {
  const byDay = new Map<string, SaunaSession>()
  for (const s of sessions) {
    const cur = byDay.get(s.date)
    if (!cur || s.lengthMin > cur.lengthMin) byDay.set(s.date, s)
  }
  const days = [...byDay.values()]
  const lock = (a: number, b: number, what: [string, string]) => (a >= INSIGHTS.withinMin && b >= INSIGHTS.withinMin ? null
    : `Needs ${INSIGHTS.withinMin} ${what[0]} and ${INSIGHTS.withinMin} ${what[1]}. You have ${a} and ${b}.`)
  const evening = days.filter((s) => minutesOf(s.start) >= INSIGHTS.eveningFrom)
  const earlier = days.filter((s) => minutesOf(s.start) < INSIGHTS.eveningFrom)
  const len = splitAtMedian(days, (s) => s.lengthMin)
  const temp = splitAtMedian(days, (s) => s.tempC)
  const res = (key: string, title: string, a: SaunaSession[], b: SaunaSession[], what: [string, string], words: [string, string]): SplitResult => {
    const locked = lock(a.length, b.length, what)
    const rows = locked ? [] : compareGroups(l, key, a, b, words)
    return { key, title, locked: locked ?? (rows.length ? null : `Needs Health data for ${INSIGHTS.withinMin} nights on each side.`), rows }
  }
  return [
    res('evening', 'Evening against earlier sessions', evening, earlier, ['evening sessions (6 pm or later)', 'earlier ones'], ['after evening sessions', 'after earlier ones']),
    res('length', `Longer against shorter sessions${len.median != null ? ` (your median is ${Math.round(len.median)} min)` : ''}`, len.high, len.low, ['longer sessions', 'shorter ones'], ['after longer sessions', 'after shorter ones']),
    res('temp', `Hotter against cooler sessions${temp.median != null ? ` (your median is ${Math.round(temp.median)} C)` : ''}`, temp.high, temp.low, ['hotter sessions', 'cooler ones'], ['after hotter sessions', 'after cooler ones']),
  ]
}

/** "Needs 7 days without sauna to compare. You have 1." */
export const nonSaunaLocked = (need: number, have: number) => `Needs ${need} days without sauna to compare. You have ${have}.`

// --------------------------------------------------------- heat adaptation

/** Heart rate at minute 10 of a session: the median of readings within a minute of it, or null. */
export function hrAtMinute10(series: HRSeries | null | undefined): number | null {
  if (!series?.length) return null
  const near = series.filter(([sec]) => Math.abs(sec - INSIGHTS.minute10Sec) <= INSIGHTS.minute10TolSec).map((p) => p[1])
  const m = median(near)
  return m == null ? null : Math.round(m)
}

export interface AdaptSession { id: string; date: string; start: string; tempC: number; lengthMin: number; hr10: number | null }

/**
 * "Is your body getting used to the heat?" Heart rate at minute 10 at the temperature
 * band used most, oldest first: the first 3 sessions against the latest 3. Lower means
 * the same heat is asking less of your heart. Too early under 6 sessions in that band.
 */
export function heatAdaptation10(list: AdaptSession[]) {
  const usable = list.filter((s) => s.hr10 != null)
  const byBand = new Map<number, AdaptSession[]>()
  for (const s of usable) {
    const c = tempBand(s.tempC).centre
    byBand.set(c, [...(byBand.get(c) || []), s])
  }
  const [centre, inBand] = [...byBand.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0])[0] || [null, [] as AdaptSession[]]
  const band = centre != null ? tempBand(centre) : null
  const have = inBand.length
  if (!band || have < INSIGHTS.adaptationMin) {
    const where = band ? ` at ${band.label}` : ' with Watch heart rate'
    return { status: 'early' as const, verdict: `Too early: needs ${INSIGHTS.adaptationMin} sessions${where} (you have ${have})`, points: [], band, context: null as string | null }
  }
  const pts = [...inBand].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
  const k = INSIGHTS.adaptationCompare
  const first = mean(pts.slice(0, k).map((p) => p.hr10 as number)) as number
  const last = mean(pts.slice(-k).map((p) => p.hr10 as number)) as number
  const diff = Math.round(last - first)
  const verdict = diff <= -INSIGHTS.adaptationBpm
    ? `Getting used to it: heart rate at 10 minutes is ${-diff} bpm lower than your first sessions`
    : diff >= INSIGHTS.adaptationBpm
      ? `Heart rate at 10 minutes is ${diff} bpm higher than your first sessions`
      : 'No change yet: heart rate at 10 minutes is about the same as your first sessions'
  const l0 = median(pts.slice(0, k).map((p) => p.lengthMin)) as number
  const l1 = median(pts.slice(-k).map((p) => p.lengthMin)) as number
  const context = Math.abs(l1 - l0) >= INSIGHTS.lengthChangeMin
    ? `Your sessions have also got ${l1 > l0 ? 'longer' : 'shorter'} (${Math.round(l0)} to ${Math.round(l1)} min). Average heart rate ${l1 > l0 ? 'rises' : 'falls'} with session length, which is why this compares minute 10.`
    : null
  return {
    status: (diff <= -INSIGHTS.adaptationBpm ? 'better' : diff >= INSIGHTS.adaptationBpm ? 'higher' : 'same') as 'better' | 'higher' | 'same',
    verdict, band, context, diff,
    points: pts.map((p) => ({ date: p.date, value: p.hr10 as number })),
  }
}

// ------------------------------------------------------- consistency grid

/**
 * The grid's weeks: from the week of the first session, left to right, up to the last 12.
 * Under 12 weeks of history only the weeks that exist are shown.
 */
export function gridWeeks(sessions: SaunaSession[], today: string): number {
  const first = firstSessionDate(sessions)
  if (!first) return 0
  const n = Math.round(daysBetween(weekOf(first).from, weekOf(today).from) / 7) + 1
  return Math.max(1, Math.min(INSIGHTS.gridMaxWeeks, n))
}

/** "4 sessions this week · target 4" */
export function weekHeader(sessions: SaunaSession[], today: string, target: number): string {
  const w = weekOf(today)
  const n = sessions.filter((s) => s.date >= w.from && s.date <= w.to).length
  return `${n} ${n === 1 ? 'session' : 'sessions'} this week · target ${target}`
}
