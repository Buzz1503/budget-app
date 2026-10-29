// Matching the Watch's movement summary to the night it belongs to, and what
// the Move lane says when there is none.
//
// The Watch files a summary under the wake date of its own main sleep. The
// iPhone's night for that date is usually the same sleep, but not always: a
// time zone change, a nap the Watch took for the main sleep, or a night that
// ended just after midnight can put it under the day before or after. So a
// night takes the summary filed under its own date when that one covers it,
// else any summary from the day either side that overlaps it by at least half
// of the shorter of the two.

const DAY = 86400000

export interface RestlessLike { start: number; end: number; series?: number[] }
export interface NightSpan { date: string; start: number; end: number }

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)

/** How much of the shorter of the two the overlap covers (0 to 1). */
export function overlapShare(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const o = Math.min(a.end, b.end) - Math.max(a.start, b.start)
  const shorter = Math.min(a.end - a.start, b.end - b.start)
  return o > 0 && shorter > 0 ? o / shorter : 0
}

export const MATCH_SHARE = 0.5

export function restlessForNight(extras: Record<string, { restless?: RestlessLike | null } | undefined>, night: NightSpan): RestlessLike | null {
  const own = extras[night.date]?.restless
  // an entry with no window (older data) is trusted where it was filed
  if (own && (own.start == null || own.end == null || overlapShare(own, night) >= MATCH_SHARE)) return own
  let best: RestlessLike | null = null
  let bestShare = MATCH_SHARE
  for (const d of [shift(night.date, -1), shift(night.date, 1), night.date]) {
    const r = extras[d]?.restless
    if (!r || r.start == null || r.end == null) continue
    const share = overlapShare(r, night)
    if (share >= bestShare) { best = r; bestShare = share }
  }
  return best
}

export type MoveLane = 'recorded' | 'waiting' | 'missing' | 'none'

/** The Watch has this long after waking to send the night before the lane says "Not recorded". */
export const WAIT_FOR_WATCH_H = 12

/**
 * What the Move lane shows: the recording; "Waiting for your Watch" for the
 * latest night while the Watch can still send it; "Not recorded" once
 * recording has worked before and this night has none; otherwise nothing.
 */
export function moveLane(input: { enabled: boolean; hasRecording: boolean; date: string; firstRecorded: string | null; nightEnd: number; now: number; latest: boolean }): MoveLane {
  if (input.hasRecording) return 'recorded'
  if (!input.enabled) return 'none'
  if (input.latest && input.now - input.nightEnd < WAIT_FOR_WATCH_H * 3600000) return 'waiting'
  if (!input.firstRecorded || input.date <= input.firstRecorded) return 'none'
  return 'missing'
}

// ------------------------------------------------- the Watch's own report

const BY_WORDS: Record<string, string> = {
  appRun: 'the Pepito Watch app', snapshot: 'an update from your iPhone', soundsStarted: 'Sleep sounds starting',
  schedule: 'the 9 pm schedule', startSleep: 'Start sleep', complication: 'a Pepito complication',
}
const RESULT_WORDS: Record<string, string> = {
  sent: 'the last night was sent', upToDate: 'nothing new to send', noSleep: 'no sleep in Health yet', noData: 'the night had no movement recorded',
}

/**
 * One line from the Watch's report for Sleep setup: when it last asked for a
 * recording window, what asked, and what its last read found.
 * "Movement recording asked for at 21:02 by Sleep sounds starting. Last read: the last night was sent."
 */
export function motionWords(m: { at?: number | null; by?: string | null; result?: string | null } | null | undefined, clock: (ms: number) => string, now: number): string | null {
  if (!m?.at) return null
  const when = now - m.at > 20 * 3600000 ? 'over 20 hours ago' : `at ${clock(m.at)}`
  const by = m.by && BY_WORDS[m.by] ? ` by ${BY_WORDS[m.by]}` : ''
  const read = m.result && RESULT_WORDS[m.result] ? ` Last read: ${RESULT_WORDS[m.result]}.` : ''
  return `Movement recording asked for ${when}${by}.${read}`
}
