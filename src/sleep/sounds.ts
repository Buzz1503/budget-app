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
}

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
}

export const SOUNDS = {
  runGapSec: 60, // snoring events less than a minute apart are one run
  roomHotC: 24, // a bedroom averaging this or more overnight counts as "room too hot"
}

const MIN = 60000
const r1 = (v: number) => Math.round(v * 10) / 10

/** The wake-up date a session is filed under: the day it ended. */
export const sessionNight = (s: Pick<SoundsSession, 'end'>, dateOf: (ms: number) => string) => dateOf(s.end)

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

/**
 * One night's sound numbers. `night` (the main sleep) clips the events and
 * gives the share of sleep; without it the whole session counts.
 */
export function soundsNight(sessions: SoundsSession[], night: { start: number; end: number; asleepMin: number } | null): SoundsNight | null {
  if (!sessions.length) return null
  const from = night ? night.start : Math.min(...sessions.map((s) => s.start))
  const to = night ? night.end : Math.max(...sessions.map((s) => s.end))
  const events = sessions.flatMap((s) => s.events).filter((e) => e.e > from && e.s < to)
  const snore = union(events.filter((e) => e.label === 'snoring').map((e) => [Math.max(e.s, from), Math.min(e.e, to)] as [number, number]))
  const snoringMin = snore.reduce((t, [a, b]) => t + (b - a), 0) / MIN
  // runs: snoring with gaps under a minute joined
  let longest = 0
  let run: [number, number] | null = null
  for (const [a, b] of snore) {
    if (run && a - run[1] <= SOUNDS.runGapSec * 1000) run[1] = b
    else run = [a, b]
    longest = Math.max(longest, run[1] - run[0])
  }
  const room = sessions.flatMap((s) => s.room).filter((r) => r[0] >= from && r[0] <= to)
  const temps = room.map((r) => r[1]).filter(Number.isFinite)
  const hums = room.map((r) => r[2]).filter((h) => h >= 0)
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
  }
}

/** The bedroom answers "Room too hot" when a sensor recorded the night. */
export const roomTooHot = (n: SoundsNight | null) => (n?.roomMeanC == null ? null : n.roomMeanC >= SOUNDS.roomHotC)
