// Compare tools: days with something against days without, and before against
// after. Descriptive only. The wording these feed is "higher / lower on days
// with", never "improved" or "caused", and every result carries its group
// sizes and the caveat that other compounds are not separated out.

import { COMPARE } from './config'
import { mean, sampleSd, round, isNum } from './stats'
import { addDays } from '../tz'

export type Lookup = (date: string) => number | null | undefined

export interface GroupStats {
  n: number
  mean: number | null
  values: number[]
}

export interface Split {
  with: GroupStats
  without: GroupStats
  /** with − without */
  diff: number | null
  /** diff / pooled SD; for ranking only */
  standardised: number | null
  enough: boolean
  /** Days still needed in the smaller group. */
  needsMore: number
  /** Dots for a plot: [date, value]. */
  dots: { with: Array<[string, number]>; without: Array<[string, number]> }
}

function stats(values: number[]): GroupStats {
  const m = mean(values)
  return { n: values.length, mean: m == null ? null : (round(m, 2) as number), values }
}

function pooledSd(a: number[], b: number[]): number | null {
  const sa = sampleSd(a)
  const sb = sampleSd(b)
  if (sa == null || sb == null) return null
  const p = Math.sqrt(((a.length - 1) * sa ** 2 + (b.length - 1) * sb ** 2) / (a.length + b.length - 2))
  return p > 0 ? p : null
}

/**
 * Split `days` into those where `inGroup` is true and the rest, and compare
 * `outcome` between them. A day without an outcome value is left out of both.
 * `inGroup` may return null to leave a day out entirely (an unanswered habit).
 */
export function groupSplit(days: string[], inGroup: (d: string) => boolean | null, outcome: Lookup, min: number = COMPARE.minPerGroup): Split {
  const yes: Array<[string, number]> = []
  const no: Array<[string, number]> = []
  for (const d of days) {
    const g = inGroup(d)
    if (g == null) continue
    const v = outcome(d)
    if (!isNum(v)) continue
    ;(g ? yes : no).push([d, v])
  }
  const a = stats(yes.map((x) => x[1]))
  const b = stats(no.map((x) => x[1]))
  const enough = a.n >= min && b.n >= min
  const diff = enough && a.mean != null && b.mean != null ? round(a.mean - b.mean, 2) : null
  const psd = enough ? pooledSd(a.values, b.values) : null
  return {
    with: a,
    without: b,
    diff,
    standardised: diff != null && psd ? round(diff / psd, 2) : null,
    enough,
    needsMore: Math.max(0, min - Math.min(a.n, b.n)),
    dots: { with: yes, without: no },
  }
}

export interface BeforeAfter {
  before: GroupStats
  after: GroupStats
  diff: number | null
  enough: boolean
  needsMore: number
  window: { beforeFrom: string; beforeTo: string; afterFrom: string; afterTo: string }
}

/** Two date windows (inclusive) compared on one metric. */
export function compareWindows(
  windowDates: { beforeFrom: string; beforeTo: string; afterFrom: string; afterTo: string },
  metric: Lookup,
  min: number = COMPARE.minPerSide,
): BeforeAfter {
  const collect = (from: string, to: string) => {
    const out: number[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const v = metric(d)
      if (isNum(v)) out.push(v)
    }
    return out
  }
  const before = stats(collect(windowDates.beforeFrom, windowDates.beforeTo))
  const after = stats(collect(windowDates.afterFrom, windowDates.afterTo))
  const enough = before.n >= min && after.n >= min
  return {
    before, after, window: windowDates, enough,
    diff: enough && before.mean != null && after.mean != null ? round(after.mean - before.mean, 2) : null,
    needsMore: Math.max(0, min - Math.min(before.n, after.n)),
  }
}

/**
 * The 14 days before an event against the 14 days after it. The event day
 * itself belongs to neither side. Needs 7 values on each side.
 */
export function beforeAfter(eventDate: string, metric: Lookup, { days = COMPARE.windowDays, min = COMPARE.minPerSide }: { days?: number; min?: number } = {}): BeforeAfter {
  return compareWindows({
    beforeFrom: addDays(eventDate, -days), beforeTo: addDays(eventDate, -1),
    afterFrom: addDays(eventDate, 1), afterTo: addDays(eventDate, days),
  }, metric, min)
}

/**
 * The 14 days before a compound was started against the latest 14 days on it
 * (ending today, or on the day it stopped). The start day belongs to neither
 * side, and the "latest" window never reaches back before the start.
 */
export function sinceStart(startDate: string, endDate: string, metric: Lookup, { days = COMPARE.windowDays, min = COMPARE.minPerSide }: { days?: number; min?: number } = {}): BeforeAfter {
  const latestFrom = addDays(endDate, -(days - 1))
  const afterFrom = latestFrom > startDate ? latestFrom : addDays(startDate, 1)
  return compareWindows({
    beforeFrom: addDays(startDate, -days), beforeTo: addDays(startDate, -1),
    afterFrom, afterTo: endDate,
  }, metric, min)
}

export interface HabitEffect {
  habitId: string
  name: string
  outcomes: Record<string, Split>
  /** The largest |standardised difference| among outcomes with enough data. */
  rankScore: number | null
}

/**
 * For each habit: yes-days against no-days on next-morning and same-night
 * outcomes. A day counts only if the journal was filled in that day (any
 * habit answered): an untapped habit on such a day is a "no". Ranked by the
 * largest absolute standardised difference; habits without enough data last.
 */
export function journalImpact({ habits, habitLogs, days, outcomes }: {
  habits: Array<{ id: string; name: string }>
  habitLogs: Record<string, Record<string, boolean>>
  days: string[]
  outcomes: Record<string, Lookup>
}): HabitEffect[] {
  const rows = habits.map((h) => {
    const inGroup = (d: string) => {
      const log = habitLogs[d]
      if (!log || !Object.keys(log).length) return null
      return log[h.id] === true
    }
    const res: Record<string, Split> = {}
    for (const [key, fn] of Object.entries(outcomes)) res[key] = groupSplit(days, inGroup, fn)
    const scores = Object.values(res).map((s) => s.standardised).filter(isNum).map(Math.abs)
    return { habitId: h.id, name: h.name, outcomes: res, rankScore: scores.length ? Math.max(...scores) : null }
  })
  return rows.sort((a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1))
}

/** "Higher on days with" / "Lower on days with" / "About the same". */
export function directionWords(diff: number | null, epsilon = 0): string | null {
  if (diff == null) return null
  if (Math.abs(diff) <= epsilon) return 'About the same on days with'
  return diff > 0 ? 'Higher on days with' : 'Lower on days with'
}
