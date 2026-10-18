// Personal baselines: what is usual for you, so today can be compared with it.
//
// Trailing 28 days, today excluded. Median and MAD rather than mean and SD, so
// one bad night does not move the baseline. Sigma has a floor per metric, so a
// spell of very steady readings cannot turn a tiny wobble into a big z-score.
// No baseline until 14 valid days exist.
//
// Protocol events. When a flagged compound starts, stops or changes dose, the
// days after it may sit at a new level. Until 10 days of post-event data exist
// the baseline from before the event is used; after that, only post-event data.

import { BASELINE } from './config'
import { median, mad, clamp, isNum } from './stats'
import { addDays, daysBetween } from '../tz'

export type MetricKey = keyof typeof BASELINE.floors

export interface ProtocolEvent {
  date: string
  peptideId: string
  name: string
  kind: string
}

export interface Baseline {
  ready: boolean
  /** Valid days the baseline was (or would be) built from. */
  n: number
  /** Days needed before it is ready. */
  needed: number
  median: number | null
  sigma: number | null
  regime: 'normal' | 'prior' | 'post'
  event: ProtocolEvent | null
  /** Days of post-event data so far (only while regime is 'prior'). */
  postDays: number
}

/** Values for dates in [from, to], in order, skipping missing ones. */
function valuesIn(series: Map<string, number>, from: string, to: string, transform: (v: number) => number): number[] {
  const out: number[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = series.get(d)
    if (isNum(v)) out.push(transform(v))
  }
  return out
}

function build(values: number[], floor: number, minDays: number): Pick<Baseline, 'ready' | 'n' | 'needed' | 'median' | 'sigma'> {
  const n = values.length
  if (n < minDays) return { ready: false, n, needed: minDays, median: null, sigma: null }
  const m = median(values) as number
  const spread = mad(values) as number
  return { ready: true, n, needed: minDays, median: m, sigma: Math.max(BASELINE.madScale * spread, floor) }
}

/**
 * The baseline for `metric` as of `date`.
 *
 * `events` are the protocol events that should reset baselines (flagged
 * compounds only), any order. `transform` is applied to every value first —
 * HRV is analysed as ln(HRV).
 */
export function baselineFor(
  series: Map<string, number>,
  date: string,
  metric: MetricKey,
  { events = [], transform = (v: number) => v }: { events?: ProtocolEvent[]; transform?: (v: number) => number } = {},
): Baseline {
  const floor = BASELINE.floors[metric]
  const yesterday = addDays(date, -1)
  const windowStart = addDays(date, -BASELINE.windowDays)
  const event = [...events].filter((e) => e.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0] || null

  // an event older than the window has already washed out of it
  if (event && event.date > windowStart) {
    const post = valuesIn(series, event.date, yesterday, transform)
    if (post.length < BASELINE.postEventMinDays) {
      const prior = valuesIn(series, addDays(event.date, -BASELINE.windowDays), addDays(event.date, -1), transform)
      return { ...build(prior, floor, BASELINE.minDays), regime: 'prior', event, postDays: post.length }
    }
    return { ...build(post, floor, BASELINE.postEventMinDays), regime: 'post', event, postDays: post.length }
  }
  return { ...build(valuesIn(series, windowStart, yesterday, transform), floor, BASELINE.minDays), regime: 'normal', event: null, postDays: 0 }
}

/** (value - median) / sigma, clipped to ±3. Null when either side is missing. */
export function zScore(value: number | null | undefined, b: Baseline, transform = (v: number) => v): number | null {
  if (!isNum(value) || !b.ready || b.median == null || b.sigma == null) return null
  return clamp((transform(value) - b.median) / b.sigma, -BASELINE.zClip, BASELINE.zClip)
}

/** "Baseline adjusting: Retatrutide dose change 3 days ago", while the prior baseline is in use. */
export function adjustingChip(b: Baseline, date: string): string | null {
  if (b.regime !== 'prior' || !b.event) return null
  const ago = daysBetween(b.event.date, date)
  const what = b.event.kind === 'start' || b.event.kind === 'prior' || b.event.kind === 'restart' ? 'started'
    : b.event.kind === 'stop' ? 'stopped' : 'dose change'
  return `Baseline adjusting: ${b.event.name} ${what} ${ago === 0 ? 'today' : `${ago} day${ago === 1 ? '' : 's'} ago`}`
}
