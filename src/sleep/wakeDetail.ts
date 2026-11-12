// Wake-ups in detail. A wake-up is one definition everywhere (wakeEvents in
// restless.ts): an awake stretch of 2 minutes or more after falling asleep and
// before the final wake. For each one: the clock time, how long, the stage
// just before it, heart rate in the 10 minutes before and after it, and the
// minutes back to sleep. Pure: segments and heart rate readings go in.

import { wakeEvents, type Segment } from './restless'

const MIN = 60000

export const WAKE = {
  /** heart rate either side of a wake-up, minutes */
  hrWindowMin: 10,
  /** readings further apart than this are not joined for the curve */
  hrGapMin: 15,
  /** the clock hours the histogram covers: 9 pm to 7 am */
  hours: [21, 22, 23, 0, 1, 2, 3, 4, 5, 6],
  /** a rise this big (bpm) before waking counts as a rise */
  riseBpm: 1,
}

export type StageName = 'rem' | 'core' | 'deep'

export interface WakeDetail {
  /** start of the awake stretch, epoch ms */
  at: number
  durationMin: number
  /** the asleep stage just before it; null when the stage is not known (no stages, "asleep" only) */
  stageBefore: StageName | null
  hrBefore: number | null
  hrAfter: number | null
  hrChange: number | null
  /** from the start of the awake stretch to the next asleep sample */
  backToSleepMin: number | null
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10)

/** Every wake-up of a night with its detail. */
export function wakeDetails(segments: Segment[] | undefined, hr: Array<[number, number]> | undefined): WakeDetail[] {
  const segs = [...(segments || [])].sort((a, b) => a.start - b.start)
  const readings = [...(hr || [])].sort((a, b) => a[0] - b[0])
  const w = WAKE.hrWindowMin * MIN
  return wakeEvents(segs).map((ev) => {
    const before = segs.filter((g) => g.stage !== 'awake' && g.end <= ev.s + MIN).at(-1)
    const stage = before && (before.stage === 'rem' || before.stage === 'core' || before.stage === 'deep') ? before.stage as StageName : null
    const next = segs.find((g) => g.stage !== 'awake' && g.start >= ev.s && g.start >= ev.e - MIN)
    const hb = avg(readings.filter(([t]) => t >= ev.s - w && t < ev.s).map(([, v]) => v))
    const ha = avg(readings.filter(([t]) => t >= ev.s && t <= ev.s + w).map(([, v]) => v))
    return {
      at: ev.s,
      durationMin: ev.min,
      stageBefore: stage,
      hrBefore: r1(hb),
      hrAfter: r1(ha),
      hrChange: hb != null && ha != null ? r1(ha - hb) : null,
      backToSleepMin: next ? Math.round((next.start - ev.s) / MIN) : null,
    }
  })
}

const STAGE_WORD: Record<StageName, string> = { rem: 'REM', core: 'Core', deep: 'Deep' }

/** "2:14 am · 6 min · after REM · HR 58 → 71" */
export function wakeLine(d: WakeDetail, clock: (ms: number) => string): string {
  const parts = [clock(d.at), `${d.durationMin} min`]
  if (d.stageBefore) parts.push(`after ${STAGE_WORD[d.stageBefore]}`)
  if (d.hrBefore != null && d.hrAfter != null) parts.push(`HR ${Math.round(d.hrBefore)} → ${Math.round(d.hrAfter)}`)
  return parts.join(' · ')
}

/** "2:14 am" in the given time zone. */
export function clock12(ms: number, tz?: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(new Date(ms)).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase()
  } catch {
    const d = new Date(ms)
    const h = d.getHours()
    return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
  }
}

/** The local clock hour of a moment. */
export function hourOf(ms: number, tz?: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date(ms))) % 24
  } catch {
    return new Date(ms).getHours()
  }
}

const hourWord = (h: number) => (h === 0 ? '12 am' : h === 12 ? '12 pm' : h < 12 ? `${h} am` : `${h - 12} pm`)

/** Wake-ups by clock hour, 9 pm to 7 am, and the two hours with the most. */
export function byHour(details: WakeDetail[], tz?: string): { bins: Array<{ hour: number; label: string; count: number }>; answer: string } {
  const counts = new Map(WAKE.hours.map((h) => [h, 0]))
  for (const d of details) {
    const h = hourOf(d.at, tz)
    if (counts.has(h)) counts.set(h, counts.get(h)! + 1)
  }
  const bins = WAKE.hours.map((h) => ({ hour: h, label: hourWord(h).replace(' ', ''), count: counts.get(h)! }))
  const total = bins.reduce((s, b) => s + b.count, 0)
  if (total < 3) return { bins, answer: 'Not enough wake-ups yet to see when they happen.' }
  let best = 0
  for (let i = 1; i < bins.length - 1; i++) if (bins[i].count + bins[i + 1].count > bins[best].count + bins[best + 1].count) best = i
  const from = bins[best].hour
  const to = (bins[best + 1].hour + 1) % 24
  const fw = hourWord(from)
  const tw = hourWord(to)
  // "between 1 and 3 am" when both ends share am or pm
  const same = fw.slice(-2) === tw.slice(-2)
  return { bins, answer: `Most wake-ups happen between ${same ? fw.slice(0, -3) : fw} and ${tw}.` }
}

/** Share of wake-ups by the stage just before them, and your usual share of time asleep in each stage. */
export function stageShare(details: WakeDetail[], usualMin: { rem: number; core: number; deep: number }): {
  wake: Record<StageName, number>; usual: Record<StageName, number>; n: number; answer: string
} {
  const known = details.filter((d) => d.stageBefore)
  const n = known.length
  const share = (k: StageName) => (n ? known.filter((d) => d.stageBefore === k).length / n : 0)
  const wake = { rem: share('rem'), core: share('core'), deep: share('deep') }
  const tot = usualMin.rem + usualMin.core + usualMin.deep || 1
  const usual = { rem: usualMin.rem / tot, core: usualMin.core / tot, deep: usualMin.deep / tot }
  if (n < 5) return { wake, usual, n, answer: 'Not enough wake-ups with stages yet.' }
  const keys: StageName[] = ['rem', 'core', 'deep']
  // the stage you wake from most beyond the time you spend in it
  const most = keys.reduce((a, b) => (wake[b] - usual[b] > wake[a] - usual[a] ? b : a))
  const over = wake[most] - usual[most]
  const answer = over > 0.1
    ? `You wake from ${STAGE_WORD[most]} more often than the time you spend in it: ${Math.round(wake[most] * 100)}% of wake-ups against ${Math.round(usual[most] * 100)}% of sleep.`
    : `You wake from each stage about as often as the time you spend in it.`
  return { wake, usual, n, answer }
}

/** Heart rate at a moment, read between the readings either side (null across a gap). */
function hrAt(readings: Array<[number, number]>, t: number): number | null {
  let lo: [number, number] | null = null
  let hi: [number, number] | null = null
  for (const r of readings) {
    if (r[0] <= t) lo = r
    else { hi = r; break }
  }
  if (lo && lo[0] === t) return lo[1]
  if (!lo || !hi || hi[0] - lo[0] > WAKE.hrGapMin * MIN) return null
  return lo[1] + ((hi[1] - lo[1]) * (t - lo[0])) / (hi[0] - lo[0])
}

/** Average heart rate from 10 minutes before to 10 minutes after a wake-up, minute by minute. */
export function hrCurve(nights: Array<{ details: WakeDetail[]; hr: Array<[number, number]> | undefined }>): {
  points: Array<{ min: number; bpm: number | null; n: number }>; answer: string; n: number
} {
  const span = WAKE.hrWindowMin
  const sums = new Map<number, { s: number; n: number }>()
  let wakes = 0
  for (const night of nights) {
    const readings = [...(night.hr || [])].sort((a, b) => a[0] - b[0])
    if (!readings.length) continue
    for (const d of night.details) {
      let any = false
      for (let m = -span; m <= span; m++) {
        const v = hrAt(readings, d.at + m * MIN)
        if (v == null) continue
        any = true
        const c = sums.get(m) || { s: 0, n: 0 }
        c.s += v; c.n += 1
        sums.set(m, c)
      }
      if (any) wakes++
    }
  }
  const points = Array.from({ length: span * 2 + 1 }, (_, i) => {
    const m = i - span
    const c = sums.get(m)
    return { min: m, bpm: c && c.n ? Math.round((c.s / c.n) * 10) / 10 : null, n: c?.n || 0 }
  })
  if (wakes < 5) return { points, answer: 'Not enough wake-ups with heart rate yet.', n: wakes }
  const at = (m: number) => points.find((p) => p.min === m)?.bpm ?? null
  const base = avg([-span, -span + 1, -span + 2].map(at).filter((v): v is number => v != null))
  const atWake = at(0)
  if (base == null || atWake == null || atWake - base < WAKE.riseBpm) return { points, answer: 'Heart rate stays about level until you wake.', n: wakes }
  // the earliest minute from which it keeps rising to the wake moment
  let start = 0
  for (let m = -1; m >= -span; m--) {
    const a = at(m)
    const b = at(m + 1)
    if (a == null || b == null || a >= b) break
    start = m
  }
  if (start === 0) return { points, answer: 'Heart rate rises as you wake.', n: wakes }
  return { points, answer: `Heart rate starts rising about ${-start} ${start === -1 ? 'minute' : 'minutes'} before you wake.`, n: wakes }
}

/** The median of a list, or null. */
export function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Median minutes back to sleep, against the good sleep period's median. */
export function backToSleep(details: WakeDetail[], reference: WakeDetail[]): { median: number | null; ref: number | null; answer: string } {
  const m = median(details.map((d) => d.backToSleepMin).filter((x): x is number => x != null))
  const ref = median(reference.map((d) => d.backToSleepMin).filter((x): x is number => x != null))
  if (m == null) return { median: null, ref, answer: 'No wake-ups to time yet.' }
  const mins = (x: number) => `${Math.round(x)} ${Math.round(x) === 1 ? 'minute' : 'minutes'}`
  if (ref == null) return { median: m, ref, answer: `Back to sleep in ${mins(m)}, the middle of your wake-ups.` }
  const diff = Math.round(m - ref)
  if (diff === 0) return { median: m, ref, answer: `Back to sleep in ${mins(m)}, the same as your good sleep period.` }
  return { median: m, ref, answer: `Back to sleep in ${mins(m)}, ${Math.abs(diff)} ${diff > 0 ? 'longer' : 'quicker'} than your good sleep period.` }
}

// ---------------------------------------------------------------- why I woke

export const WAKE_REASONS = ['Bathroom', 'Hot', 'Hungry', 'Reflux or nausea', 'Heart racing', 'Kids', 'Dog', 'Noise', "Don't know"] as const

export interface WakeReasonEntry { tags: string[]; at: number; skipped?: boolean }

/** Ask on the Today card: last night had 2 or more wake-ups and nothing was saved or skipped for it. */
export function shouldAskWhy(date: string, wakeCount: number | null | undefined, saved: Record<string, WakeReasonEntry> | undefined): boolean {
  return (wakeCount ?? 0) >= 2 && !saved?.[date]
}

/** "Reflux or nausea on 6 of 9 tagged nights at 4 mg": each reason's count over the tagged nights in some ranges. */
export function reasonCounts(saved: Record<string, WakeReasonEntry> | undefined, ranges: Array<[string, string]> | null): { tagged: number; counts: Array<{ tag: string; count: number }> } {
  const inside = (d: string) => !ranges || ranges.some(([a, b]) => d >= a && d <= b)
  const nights = Object.entries(saved || {}).filter(([d, e]) => inside(d) && !e.skipped && e.tags.length)
  const counts = new Map<string, number>()
  for (const [, e] of nights) for (const t of new Set(e.tags)) counts.set(t, (counts.get(t) || 0) + 1)
  return { tagged: nights.length, counts: [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)) }
}

export const WAKE_ACCURACY = 'Apple Watch can miss very brief awakenings, so real wake-ups may be higher than shown. Comparisons between periods still hold because it is the same Watch every night.'
