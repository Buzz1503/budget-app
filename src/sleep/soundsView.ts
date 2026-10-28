// What the Sleep sounds screens say: the status line, the session log, the
// snoring timeline and the trend. Pure; the iPhone's sessions come in as stored.
// Zero is not missing: a night the phone listened and heard no snoring is 0
// minutes; a night it did not run has no value at all and is never filled in.
import { capturedMin, SOUNDS, snoreRuns } from './sounds'
import type { SoundsNight, SoundsSession, SoundEvent } from './sounds'

const MIN = 60000

/** "38 min", "7 h 12 min", "4 h". */
export function minutesWords(min: number): string {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  if (!h) return `${m} min`
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

// ------------------------------------------------------------- status line

export interface StatusInput {
  /** Sleep sounds is switched on in the app */
  enabled: boolean
  /** listening right now, and since when (ms) */
  running: boolean
  startedAt: number | null
  /** the night in view: its numbers, or null when no session was filed under it */
  sounds: SoundsNight | null
  /** "Last night", or a name for an older night */
  label: string
  /** the night in view is the latest one, so a session running now belongs to it */
  live: boolean
  /** the night in view is last night, for the "Didn't run last night" wording */
  isLast: boolean
  clock: (ms: number) => string
}

/**
 * The one live line: "Listening now since 10:42 pm", "Last night: 38 min snoring,
 * 6% of sleep" (minutes only until the Watch's sleep for the night has arrived),
 * "Last night: ran 7 h 12 min, heard no snoring", "Didn't run last night".
 */
export function soundsLine(i: StatusInput): string {
  if (i.running && i.live && i.startedAt != null) return `Listening now since ${i.clock(i.startedAt)}`
  const n = i.sounds
  if (n) {
    if (n.snoringMin > 0) return `${i.label}: ${minutesWords(n.snoringMin)} snoring${n.snoringPct != null ? `, ${Math.round(n.snoringPct)}% of sleep` : ''}`
    return `${i.label}: ran ${minutesWords(n.capturedMin)}, heard no snoring`
  }
  if (!i.enabled) return 'Sleep sounds is off'
  return i.isLast ? "Didn't run last night" : `Didn't run, ${i.label.toLowerCase()}`
}

// ------------------------------------------------------------ session log

const STOP_REASONS: Record<string, string> = {
  focusOff: 'Sleep Focus ended',
  watchUp: "I'm up on Apple Watch",
  unplugged: 'Unplugged',
  tooLong: '11 hour limit',
  interrupted: 'Interrupted',
  appClosed: 'App closed',
  app: 'Stopped in the app',
  scheduled: 'Schedule ended',
}

const GAP_REASONS: Record<string, string> = {
  interrupted: 'A call, Siri, an alarm or another app took the microphone',
  route: 'The microphone or headphones changed',
}

export const gapReasonText = (r: string) => GAP_REASONS[r] || 'Listening paused'

/** Why a session stopped, in the words used in the log. */
export function stopReasonText(s: Pick<SoundsSession, 'open' | 'recovered' | 'stopReason'>): string {
  if (s.open) return 'Still listening'
  if (s.recovered && (!s.stopReason || s.stopReason === 'appClosed')) return STOP_REASONS.appClosed
  return (s.stopReason && STOP_REASONS[s.stopReason]) || 'Stopped'
}

export interface SessionRow {
  id: string
  start: number
  end: number
  night: string
  reason: string
  capturedMin: number
  events: number
  gaps: number
  gapMin: number
  recovered: boolean
  startedBy: string
  checkpoints: number
}

const STARTED_BY: Record<string, string> = { app: 'Started in the app', shortcut: 'Started by a Shortcuts automation', automation: 'Started by a Shortcuts automation', schedule: 'Started by the schedule', notification: 'Started from a notification', watch: 'Started from Apple Watch' }
export const startedByText = (by: string) => STARTED_BY[by] || 'Started in the app'

/** One row per session, newest first: when, why it stopped, how much audio, how many events, how many gaps. */
export function sessionRows(byNight: Record<string, SoundsSession[]>): SessionRow[] {
  const rows: SessionRow[] = []
  for (const [night, list] of Object.entries(byNight)) {
    for (const s of list) {
      const gaps = s.gaps || []
      rows.push({
        id: s.id, start: s.start, end: s.end, night, reason: stopReasonText(s), capturedMin: Math.round(capturedMin(s)),
        events: s.events.length, gaps: gaps.length, gapMin: Math.round(gaps.reduce((t, g) => t + (g.e - g.s), 0) / MIN),
        recovered: !!s.recovered, startedBy: s.startedBy, checkpoints: s.checkpoints ?? 0,
      })
    }
  }
  return rows.sort((a, b) => b.start - a.start)
}

// --------------------------------------------------------------- timeline

export interface DensityBin { t: number; min: number }

/** Snoring per 10 minutes across the night (minutes of snoring in each bin, 0 to 10). */
export function snoreDensity(events: SoundEvent[], from: number, to: number, binMin = 10): DensityBin[] {
  const bins: DensityBin[] = []
  const snore = events.filter((e) => e.label === 'snoring')
  for (let t = from; t < to; t += binMin * MIN) {
    const end = Math.min(t + binMin * MIN, to)
    const iv = snore
      .filter((e) => e.e > t && e.s < end)
      .map((e) => [Math.max(e.s, t), Math.min(e.e, end)] as [number, number])
      .sort((a, b) => a[0] - b[0])
    let covered = 0
    let cursor = t
    for (const [a, b] of iv) {
      const from2 = Math.max(a, cursor)
      if (b > from2) { covered += b - from2; cursor = b }
    }
    bins.push({ t, min: Math.round((covered / MIN) * 10) / 10 })
  }
  return bins
}

/** The snoring burst nearest a time, within `withinMs`; what a tap on the timeline opens. */
export function burstAt(events: SoundEvent[], ms: number, withinMs: number): SoundEvent | null {
  let best: SoundEvent | null = null
  let bestD = Infinity
  for (const e of events) {
    if (e.label !== 'snoring') continue
    const d = ms < e.s ? e.s - ms : ms > e.e ? ms - e.e : 0
    if (d <= withinMs && d < bestD) { best = e; bestD = d }
  }
  return best
}

/** "Quiet", "Moderate" and so on for a level in dB relative to full scale. Words, not a verdict. */
export function levelWords(db: number | null): string {
  if (db == null) return ''
  if (db < -60) return 'Very quiet'
  if (db < -45) return 'Quiet'
  if (db < -30) return 'Moderate'
  return 'Loud'
}

// ------------------------------------------------------------------ trend

/**
 * Snoring minutes by night for the trend chart. Only nights that ran at least 4 hours
 * are points; a night that did not run, or ran briefly, is left out so the line has a
 * gap there instead of a zero. A night that ran and heard nothing is a real 0.
 */
export function trendPoints(nights: Array<{ date: string; sounds: SoundsNight | null }>): Array<{ date: string; value: number }> {
  return nights
    .filter((n) => n.sounds?.eligible)
    .map((n) => ({ date: n.date, value: n.sounds!.snoringMin }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Nights the trend leaves out because they ran under 4 hours. */
export const shortRuns = (nights: Array<{ sounds: SoundsNight | null }>) => nights.filter((n) => n.sounds && !n.sounds.eligible).length

// -------------------------------------------------------------- start log

export interface StartLogEntry { at: number; kind: 'start' | 'stop'; by: string; result: string; error?: string | null }

const RESULT_WORDS: Record<string, string> = {
  started: 'Started',
  alreadyRunning: 'Already listening',
  noPermission: 'Blocked: no microphone permission',
  blockedLocked: 'Blocked: the phone was locked',
  blockedBackground: 'Blocked: the app was in the background',
  audioError: 'Audio session error',
  skippedDaytime: 'Skipped: outside 8 pm to 4 am',
  notRunning: 'Nothing was running to stop',
}
const BY_WORDS: Record<string, string> = { app: 'In the app', shortcut: 'Shortcuts automation', schedule: 'Scheduled start', notification: 'From a notification', watch: 'Start sleep on Apple Watch', test: 'Test' }

export const startResultWords = (r: string) => RESULT_WORDS[r] || 'Unknown result'

/** What the Start button says after a tap. */
export function startMessage(result: string, error?: string | null): string {
  switch (result) {
    case 'started': return 'Listening. It keeps going with the screen locked.'
    case 'alreadyRunning': return 'Already listening.'
    case 'noPermission': return 'Microphone access is off. Allow it in Settings, then tap Start again.'
    case 'blockedLocked': return 'iOS did not allow it to start while the phone was locked. Unlock it and tap Start again.'
    case 'blockedBackground': return 'iOS did not allow it to start from the background. Keep Pepito+ open and tap Start again.'
    default: return `The audio session could not start.${error ? ` ${error}` : ''}`
  }
}

export interface LogRow { key: string; at: number; title: string; detail: string; ok: boolean }

/** The start log as rows for the session log, newest first: what was tried, by what, and the iOS error text. */
export function logRows(entries: StartLogEntry[]): LogRow[] {
  return [...entries].sort((a, b) => b.at - a.at).map((e) => ({
    key: `${e.at}|${e.kind}|${e.by}`,
    at: e.at,
    title: `${e.kind === 'stop' ? 'Stop' : 'Start'}: ${startResultWords(e.result)}`,
    detail: `${BY_WORDS[e.by] || e.by}${e.error ? `. ${e.error}` : ''}`,
    ok: e.result === 'started' || e.result === 'alreadyRunning',
  }))
}

// --------------------------------------------------------------- schedule

export interface Schedule { on: boolean; start: string; stop: string }
export const DEFAULT_SCHEDULE: Schedule = { on: true, start: '21:00', stop: '05:00' }

const hm = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '')
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** "9 pm", "5 am", "9:30 pm" */
export function twelveHour(s: string): string {
  const v = hm(s)
  if (v == null) return s
  const h = Math.floor(v / 60)
  const m = v % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`
}

/** "Scheduled 9 pm to 5 am", or null when the schedule is off. */
export const scheduleWords = (s: Schedule | null | undefined): string | null => (s?.on ? `Scheduled ${twelveHour(s.start)} to ${twelveHour(s.stop)}` : null)

/** Whether a clock time ("HH:MM" now) is inside the nightly window; a stop at or before the start runs across midnight. */
export function inWindow(now: string, s: Pick<Schedule, 'start' | 'stop'>): boolean {
  const a = hm(s.start)
  const b = hm(s.stop)
  const m = hm(now)
  if (a == null || b == null || m == null) return false
  return a < b ? m >= a && m < b : m >= a || m < b
}

export interface SetupNight { date: string; state: 'started' | 'failed' | 'none'; reason?: string }
export interface SetupVerdict { ok: boolean; text: string; nights: SetupNight[] }

const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/**
 * "Check my setup": did the scheduled start fire on each of the last 3 evenings, from the
 * start log (and the sessions it started)? "Working", or the nights it did not start.
 */
export function checkSetup(input: {
  log: StartLogEntry[]
  sessions: Array<{ start: number; startedBy: string }>
  today: string
  dateOf: (ms: number) => string
  dayName: (date: string) => string
  nights?: number
}): SetupVerdict {
  const n = input.nights ?? 3
  const evenings: string[] = []
  for (let i = n; i >= 1; i--) {
    const d = new Date(`${input.today}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - i)
    evenings.push(d.toISOString().slice(0, 10))
  }
  const nights: SetupNight[] = evenings.map((date) => {
    const tries = input.log.filter((e) => e.kind === 'start' && e.by === 'schedule' && input.dateOf(e.at) === date)
    const ran = tries.some((e) => e.result === 'started' || e.result === 'alreadyRunning')
      || input.sessions.some((s) => s.startedBy === 'schedule' && input.dateOf(s.start) === date)
    if (ran) return { date, state: 'started' }
    if (tries.length) return { date, state: 'failed', reason: tries[tries.length - 1].result }
    return { date, state: 'none' }
  })
  const missed = nights.filter((x) => x.state === 'none').map((x) => input.dayName(x.date))
  const failed = nights.filter((x) => x.state === 'failed')
  if (!missed.length && !failed.length) return { ok: true, text: `Working. It started by itself on ${listWords(nights.map((x) => input.dayName(x.date)))}.`, nights }
  const parts: string[] = []
  if (missed.length) parts.push(`Didn't start on ${listWords(missed)}. Check the automation.`)
  for (const f of failed) parts.push(`Tried on ${input.dayName(f.date)} but could not start: ${startResultWords(f.reason || '').replace(/^Blocked: /, '').toLowerCase()}.`)
  return { ok: false, text: parts.join(' '), nights }
}

export { SOUNDS, snoreRuns }
