// Watch sleep mode, the iPhone's half: the lights-out and get-up times the
// Watch sends, kept per night (by wake date), and the time it took to fall
// asleep, from lights out to the start of the main sleep Health recorded.

export interface SleepModeNight { lightsOut?: number; upAt?: number }
export type SleepModeLog = Record<string, SleepModeNight>

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The wake date a time belongs to: an evening lights-out (noon or later) wakes the next day. */
export function wakeDateOf(atMs: number): string {
  const d = new Date(atMs)
  if (d.getHours() >= 12) d.setDate(d.getDate() + 1)
  return localDate(d)
}

/** Record lights out or "I'm up". Get-up belongs to the night it ends: the same wake date. */
export function recordSleepMode(log: SleepModeLog, kind: 'lightsOut' | 'up', atMs: number): SleepModeLog {
  const date = kind === 'lightsOut' ? wakeDateOf(atMs) : localDate(new Date(atMs))
  const night = { ...(log[date] || {}) }
  if (kind === 'lightsOut') night.lightsOut = atMs
  else night.upAt = atMs
  const next = { ...log, [date]: night }
  // a year is plenty
  const keys = Object.keys(next).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - 366))) delete next[k]
  return next
}

/** Minutes from lights out to sleep onset, or null when the two do not belong together. */
export function onsetMin(lightsOutMs: number | null | undefined, sleepStartMs: number | null | undefined): number | null {
  if (!Number.isFinite(lightsOutMs as number) || !Number.isFinite(sleepStartMs as number)) return null
  const min = ((sleepStartMs as number) - (lightsOutMs as number)) / 60000
  // asleep before lights out (more than 30 min) or hours later: not the same night
  if (min < -30 || min > 240) return null
  return Math.max(0, Math.round(min))
}

/** "Fell asleep 14 min after lights out" */
export function onsetWords(min: number | null): string | null {
  if (min == null) return null
  return min === 0 ? 'Fell asleep as the lights went out' : `Fell asleep ${min} min after lights out`
}
