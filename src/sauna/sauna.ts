// Sauna sessions: what is stored, and everything the Sauna tab and Home work
// out from it. Pure functions; "today" and "now" are always passed in.
//
// A session on day D belongs to the night of D (which Health files under the
// wake-up date D + 1) and to the morning of D + 1.

import { addDays, daysBetween, dateRange } from '../health/tz'

export type SaunaType = 'Infrared' | 'Traditional' | 'Steam'
export type SaunaSource = 'manual' | 'timer' | 'watch'

export interface SaunaSession {
  id: string
  date: string // local date the session started
  start: string // 'HH:MM' local
  lengthMin: number
  tempC: number
  type: SaunaType
  rounds: number
  coldMin: number | null // cold exposure after, minutes; null = none
  weightBeforeKg: number | null
  weightAfterKg: number | null
  notes: string
  source: SaunaSource
  workoutId: string | null // the Health workout it came from, if any
}

export interface SaunaSettings {
  weeklyTarget: number
  usualLengthMin: number | null // null: worked out from recent sessions
  usualTempC: number | null
  showOnHome: boolean
}

export interface SaunaTimer {
  startedAt: number // epoch ms; elapsed time is always now - startedAt
  targetMin: number
  tempC: number
  rounds: number
}

export const SAUNA_TYPES: SaunaType[] = ['Infrared', 'Traditional', 'Steam']
export const SAUNA = {
  defaultLengthMin: 20,
  defaultTempC: 60,
  defaultTarget: 4,
  usualFromLast: 10, // the usual length and temperature: median of the last 10 sessions
  heatLevels: [1, 15, 30, 45], // heatmap: minutes in a day at which shades 1 to 4 begin
  lengthBuckets: [20, 30], // under 20, 20 to 30, over 30 min
  lateWithinH: 3, // a session ending within 3 h of bedtime is late
  minPerGroup: 7,
}

export const DEFAULT_SAUNA_SETTINGS: SaunaSettings = { weeklyTarget: SAUNA.defaultTarget, usualLengthMin: null, usualTempC: null, showOnHome: true }

const pad = (n: number) => String(n).padStart(2, '0')
export const hhmmOf = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}
export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const byNewest = (a: SaunaSession, b: SaunaSession) => (b.date + b.start).localeCompare(a.date + a.start)

/** Usual length and temperature: the setting, or the median of the last 10 sessions, or 20 min at 60 C. */
export function usualFor(sessions: SaunaSession[], settings: Partial<SaunaSettings> = {}): { lengthMin: number; tempC: number } {
  const recent = [...sessions].sort(byNewest).slice(0, SAUNA.usualFromLast)
  return {
    lengthMin: settings.usualLengthMin ?? Math.round(median(recent.map((s) => s.lengthMin)) ?? SAUNA.defaultLengthMin),
    tempC: settings.usualTempC ?? Math.round(median(recent.map((s) => s.tempC)) ?? SAUNA.defaultTempC),
  }
}

/** A new session's start: now minus its length, so "just finished" is the default. */
export function defaultStart(now: { date: string; minutes: number }, lengthMin: number): { date: string; start: string } {
  const m = now.minutes - lengthMin
  return m >= 0 ? { date: now.date, start: hhmmOf(m) } : { date: addDays(now.date, -1), start: hhmmOf(m + 1440) }
}

/** A complete session from a partial one, with the defaults filled in. */
export function newSession(p: Partial<SaunaSession> & { date: string; start: string; lengthMin: number; tempC: number }, id: string): SaunaSession {
  return {
    id,
    type: 'Infrared',
    rounds: 1,
    coldMin: null,
    weightBeforeKg: null,
    weightAfterKg: null,
    notes: '',
    source: 'manual',
    workoutId: null,
    ...p,
  }
}

// ---------------------------------------------------------------- week

/** Monday to Sunday around a date. */
export function weekOf(date: string): { from: string; to: string } {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  const from = addDays(date, -dow)
  return { from, to: addDays(from, 6) }
}

export const heatMinutes = (sessions: SaunaSession[]) => sessions.reduce((s, x) => s + (x.lengthMin || 0), 0)

/** This week's sessions against the target, for the ring. */
export function weekSummary(sessions: SaunaSession[], today: string, target: number) {
  const { from, to } = weekOf(today)
  const week = sessions.filter((s) => s.date >= from && s.date <= to)
  return { from, to, count: week.length, target, heatMin: heatMinutes(week), fill: target > 0 ? Math.min(1, week.length / target) : 0 }
}

/** "Yesterday, 25 min at 60 C". */
export function lastSessionLine(sessions: SaunaSession[], today: string): string | null {
  const last = [...sessions].sort(byNewest)[0]
  if (!last) return null
  const ago = daysBetween(last.date, today)
  const when = ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : ago < 7 ? `${ago} days ago` : new Date(`${last.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${when}, ${last.lengthMin} min at ${last.tempC} C`
}

/** The morning after a session: was there one yesterday? */
export const saunaLastNight = (sessions: SaunaSession[], today: string) => sessions.some((s) => s.date === addDays(today, -1))

// --------------------------------------------------------------- timer

/** Elapsed time from the stored start, so a closed app or a locked phone keeps the right time. */
export function timerState(timer: SaunaTimer, now: number) {
  const elapsedMs = Math.max(0, now - timer.startedAt)
  const targetMs = timer.targetMin * 60000
  return { elapsedMs, targetMs, fraction: targetMs > 0 ? Math.min(1, elapsedMs / targetMs) : 0, done: elapsedMs >= targetMs, endsAt: timer.startedAt + targetMs }
}

/** "12:05" from milliseconds; past an hour, "1:02:05". */
export function clockWords(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Where each round ends on the ring, as fractions of the target. */
export const roundMarkers = (rounds: number) => (rounds > 1 ? Array.from({ length: rounds - 1 }, (_, i) => (i + 1) / rounds) : [])

/** The log sheet prefilled from a stopped timer. Length rounds to the nearest minute, at least one. */
export function sessionFromTimer(timer: SaunaTimer, now: number, toLocal: (ms: number) => { date: string; minutes: number }) {
  const lengthMin = Math.max(1, Math.round(timerState(timer, now).elapsedMs / 60000))
  const start = toLocal(timer.startedAt)
  return { date: start.date, start: hhmmOf(start.minutes), lengthMin, tempC: timer.tempC, rounds: timer.rounds, source: 'timer' as const }
}

// ------------------------------------------------------------- history

/** Twelve weeks, Monday first, oldest week first; each day's heat minutes and a shade from 0 to 4. */
export function heatmap(sessions: SaunaSession[], today: string, weeks = 12) {
  const end = weekOf(today).to
  const start = addDays(end, -(weeks * 7 - 1))
  const mins = new Map<string, number>()
  for (const s of sessions) if (s.date >= start && s.date <= end) mins.set(s.date, (mins.get(s.date) || 0) + s.lengthMin)
  const days = dateRange(start, end).map((date) => {
    const minutes = mins.get(date) || 0
    const level = SAUNA.heatLevels.filter((l) => minutes >= l).length
    return { date, minutes, level, future: date > today }
  })
  return Array.from({ length: weeks }, (_, w) => days.slice(w * 7, w * 7 + 7))
}

/** Sessions and hours by month ('2026-10') or year ('2026'), newest first. */
export function totals(sessions: SaunaSession[], by: 'month' | 'year') {
  const out = new Map<string, { key: string; sessions: number; minutes: number }>()
  for (const s of sessions) {
    const key = by === 'month' ? s.date.slice(0, 7) : s.date.slice(0, 4)
    const row = out.get(key) || { key, sessions: 0, minutes: 0 }
    row.sessions++
    row.minutes += s.lengthMin
    out.set(key, row)
  }
  return [...out.values()].sort((a, b) => b.key.localeCompare(a.key)).map((r) => ({ ...r, hours: Math.round((r.minutes / 60) * 10) / 10 }))
}

/** Fluid lost from before and after weights: 1 kg is about 1 L. Null without both, or when the scale went up. */
export function fluidLost(beforeKg: number | null | undefined, afterKg: number | null | undefined): { litres: number; text: string } | null {
  if (!(Number(beforeKg) > 0) || !(Number(afterKg) > 0)) return null
  const litres = Math.round((Number(beforeKg) - Number(afterKg)) * 10) / 10
  if (litres <= 0) return null
  return { litres, text: `about ${litres.toFixed(1)} L` }
}

// --------------------------------------------------------- Apple Watch

export interface WorkoutLike { id: string; type: string; title: string; start: number; end: number; date: string; durationMin: number }

/**
 * Health workouts that might be a sauna: type Other or named Sauna, and not
 * already linked to a session or dismissed. Never turned into a session
 * without a tap.
 */
export function saunaCandidates(workouts: WorkoutLike[], sessions: SaunaSession[], dismissed: string[] = []): WorkoutLike[] {
  const linked = new Set(sessions.map((s) => s.workoutId).filter(Boolean))
  const gone = new Set(dismissed)
  return workouts
    .filter((w) => (/^other$/i.test(w.type) || /sauna/i.test(w.title || '')) && !linked.has(w.id) && !gone.has(w.id))
    .sort((a, b) => b.start - a.start)
}

// --------------------------------------------------------------- lanes

/** One dot per session day in a chart range, radius growing with heat minutes. */
export function saunaLaneDots(sessions: SaunaSession[], from: string, to: string) {
  const mins = new Map<string, number>()
  for (const s of sessions) if (s.date >= from && s.date <= to) mins.set(s.date, (mins.get(s.date) || 0) + s.lengthMin)
  const max = Math.max(1, ...mins.values())
  return [...mins.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, minutes]) => ({ date, minutes, r: 2 + 4 * Math.sqrt(minutes / max) }))
}

/** Sessions keyed by date. */
export function sessionsByDate(sessions: SaunaSession[]): Map<string, SaunaSession[]> {
  const out = new Map<string, SaunaSession[]>()
  for (const s of sessions) out.set(s.date, [...(out.get(s.date) || []), s])
  return out
}
