// Sleep sounds, read for one night: snoring minutes and their share of sleep,
// the longest snoring run, coughs, sleep talking, loud moments, the bedroom
// temperature, and whether the phone moved a lot (then snoring is low
// confidence). The iPhone keeps only timestamps, labels and confidence; this
// turns them into the night's numbers.

export interface SoundEvent { s: number; e: number; label: string; c: number }
export interface SoundsSession {
  id: string
  start: number
  end: number
  events: SoundEvent[]
  /** [minute start ms, dB relative to full scale] */
  levels: number[][]
  loudMinutes: number
  movingMinutes: number
  lowConfidence: boolean
  /** [ms, °C, humidity % or -1] */
  room: number[][]
  startedBy: string
  stopReason?: string | null
  /** still listening, or cut short before it could finish (the iPhone closes it on the next launch) */
  open?: boolean
  /** the last time the iPhone saved this session, ms */
  lastCheckpoint?: number
  /** stretches with no audio captured: a call, Siri, an alarm, AirPods switching, another app */
  gaps?: SoundGap[]
  checkpoints?: number
  /** found open on a later launch and closed at its last checkpoint */
  recovered?: boolean
}

export interface SoundGap { s: number; e: number; reason: string }

export interface LoudEvent { s: number; e: number; db: number }

export interface SoundsNight {
  recorded: true
  snoringMin: number
  /** share of the night's sleep, % (null without the night) */
  snoringPct: number | null
  longestSnoreMin: number
  coughs: number
  talking: number
  loudMinutes: number
  lowConfidence: boolean
  roomMeanC: number | null
  roomMaxC: number | null
  humidityMean: number | null
  startedBy: string
  /** minutes of audio actually captured across the night's sessions (gaps taken out) */
  capturedMin: number
  /** ran long enough for the analysis and the apnea screen: at least 4 hours of audio */
  eligible: boolean
  /** when the longest snoring run began, ms (null with no snoring) */
  longestSnoreAt: number | null
  /** the 10 minutes with the highest average level */
  loudestWindow: { s: number; e: number; db: number } | null
  /** average level over the night, dB relative to full scale */
  avgDb: number | null
  /** minutes 15 dB or more above the night's median, neighbours joined */
  loudEvents: LoudEvent[]
}

export const SOUNDS = {
  /** snoring feeds the analysis and the apnea screen only from nights with at least this much audio */
  minAnalysisMin: 240,
  loudAboveMedianDb: 15,
  loudestWindowMin: 10,
  runGapSec: 60, // snoring events less than a minute apart are one run
  roomHotC: 24, // a bedroom averaging this or more overnight counts as "room too hot"
}

const MIN = 60000
const r1 = (v: number) => Math.round(v * 10) / 10

/** Minutes of audio a session captured: its length less the gaps. */
export function capturedMin(s: Pick<SoundsSession, 'start' | 'end' | 'gaps'>): number {
  const gap = (s.gaps || []).reduce((t, g) => t + Math.max(0, Math.min(g.e, s.end) - Math.max(g.s, s.start)), 0)
  return Math.max(0, (s.end - s.start - gap) / MIN)
}

/**
 * The wake-up date a session is filed under: the day it ended. A session cut
 * short before midnight (it began in the evening and ended the same evening) is
 * the night that ends the next morning.
 */
export function sessionNight(s: Pick<SoundsSession, 'end'> & { start?: number }, dateOf: (ms: number) => string, hourOf?: (ms: number) => number): string {
  const end = dateOf(s.end)
  if (hourOf && s.start != null && dateOf(s.start) === end && hourOf(s.start) >= EVENING_HOUR) {
    const d = new Date(`${end}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
  }
  return end
}
const EVENING_HOUR = 18

function union(iv: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...iv].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const [a, b] of sorted) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** Snoring joined into runs: gaps under a minute are one run. */
export function snoreRuns(events: SoundEvent[], from: number, to: number): Array<[number, number]> {
  const snore = union(events.filter((e) => e.label === 'snoring' && e.e > from && e.s < to).map((e) => [Math.max(e.s, from), Math.min(e.e, to)] as [number, number]))
  const runs: Array<[number, number]> = []
  for (const [a, b] of snore) {
    const last = runs[runs.length - 1]
    if (last && a - last[1] <= SOUNDS.runGapSec * 1000) last[1] = b
    else runs.push([a, b])
  }
  return runs
}

/** Loud moments: minutes 15 dB or more above the median, neighbouring minutes joined. */
export function loudEventsOf(levels: number[][]): LoudEvent[] {
  if (!levels.length) return []
  const sorted = levels.map((l) => l[1]).sort((a, b) => a - b)
  const limit = sorted[Math.floor(sorted.length / 2)] + SOUNDS.loudAboveMedianDb
  const out: LoudEvent[] = []
  for (const [t, db] of [...levels].sort((a, b) => a[0] - b[0])) {
    if (db < limit) continue
    const last = out[out.length - 1]
    if (last && t - last.e <= MIN) { last.e = t + MIN; last.db = Math.max(last.db, db) } else out.push({ s: t, e: t + MIN, db })
  }
  return out
}

/** The stretch of `windowMin` minutes with the highest average level. */
export function loudestWindow(levels: number[][], windowMin = SOUNDS.loudestWindowMin): { s: number; e: number; db: number } | null {
  const sorted = [...levels].sort((a, b) => a[0] - b[0])
  if (!sorted.length) return null
  let best: { s: number; e: number; db: number } | null = null
  for (const [t] of sorted) {
    const inside = sorted.filter((l) => l[0] >= t && l[0] < t + windowMin * MIN)
    const db = inside.reduce((a, l) => a + l[1], 0) / inside.length
    if (!best || db > best.db) best = { s: t, e: Math.min(t + windowMin * MIN, inside[inside.length - 1][0] + MIN), db }
  }
  return best ? { ...best, db: Math.round(best.db) } : null
}

/**
 * One night's sound numbers. `night` (the main sleep) clips the events and
 * gives the share of sleep; without it the whole session counts and the share
 * is left out until the Watch's sleep arrives. No sessions is `null`: the night
 * did not run, which is not the same as running and hearing nothing (that is 0).
 */
export function soundsNight(sessions: SoundsSession[], night: { start: number; end: number; asleepMin: number } | null): SoundsNight | null {
  if (!sessions.length) return null
  const from = night ? night.start : Math.min(...sessions.map((s) => s.start))
  const to = night ? night.end : Math.max(...sessions.map((s) => s.end))
  const events = sessions.flatMap((s) => s.events).filter((e) => e.e > from && e.s < to)
  const snore = union(events.filter((e) => e.label === 'snoring').map((e) => [Math.max(e.s, from), Math.min(e.e, to)] as [number, number]))
  const snoringMin = snore.reduce((t, [a, b]) => t + (b - a), 0) / MIN
  const runs = snoreRuns(events, from, to)
  let longest = 0
  let longestAt: number | null = null
  for (const [a, b] of runs) if (b - a > longest) { longest = b - a; longestAt = a }
  const room = sessions.flatMap((s) => s.room).filter((r) => r[0] >= from && r[0] <= to)
  const temps = room.map((r) => r[1]).filter(Number.isFinite)
  const hums = room.map((r) => r[2]).filter((h) => h >= 0)
  const levels = sessions.flatMap((s) => s.levels || []).filter((l) => l[0] >= from && l[0] < to)
  const captured = sessions.reduce((t, s) => t + capturedMin(s), 0)
  const loud = loudEventsOf(levels)
  return {
    recorded: true,
    snoringMin: r1(snoringMin),
    snoringPct: night && night.asleepMin > 0 ? r1((snoringMin / night.asleepMin) * 100) : null,
    longestSnoreMin: r1(longest / MIN),
    coughs: events.filter((e) => e.label === 'cough').length,
    talking: events.filter((e) => e.label === 'speech').length,
    loudMinutes: sessions.reduce((t, s) => t + (s.loudMinutes || 0), 0),
    lowConfidence: sessions.some((s) => s.lowConfidence),
    roomMeanC: temps.length ? r1(temps.reduce((a, b) => a + b, 0) / temps.length) : null,
    roomMaxC: temps.length ? r1(Math.max(...temps)) : null,
    humidityMean: hums.length ? Math.round(hums.reduce((a, b) => a + b, 0) / hums.length) : null,
    startedBy: sessions[0].startedBy,
    capturedMin: Math.round(captured),
    eligible: captured >= SOUNDS.minAnalysisMin,
    longestSnoreAt: longestAt,
    loudestWindow: loudestWindow(levels),
    avgDb: levels.length ? Math.round(levels.reduce((a, l) => a + l[1], 0) / levels.length) : null,
    loudEvents: loud,
  }
}

/** The bedroom answers "Room too hot" when a sensor recorded the night. */
export const roomTooHot = (n: SoundsNight | null) => (n?.roomMeanC == null ? null : n.roomMeanC >= SOUNDS.roomHotC)
