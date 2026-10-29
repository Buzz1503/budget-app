// The night card, read for one moment and as a story. Pure: the stages, the
// Watch's movement, heart rate, blood oxygen and Sleep sounds for one night go
// in; what each lane says at a minute, the restless stretches, the night's
// notable moments in time order, and one summary line come out. Plain words,
// association only: "you moved a lot just before", never "because".

import { snoreRuns } from './sounds'
import type { SoundsSession } from './sounds'

const MIN = 60000

export type Stage = 'awake' | 'rem' | 'core' | 'deep' | 'asleep'
export interface NightLike {
  start: number
  end: number
  segments?: Array<{ start: number; end: number; stage: Stage }>
}
export interface Overnight {
  /** [minutes from the night's start, bpm] */
  hr?: Array<[number, number]>
  /** [minutes from the night's start, %] */
  spo2?: Array<[number, number]>
}
/** The Watch's movement: one value a minute, the share of that minute spent moving (0 to 1). */
export interface Restless { start: number; series: number[] }
/** A heart rate surge from the nightmare estimate. */
export interface SurgeEvent { t: number; surge: number }

export interface NightData {
  night: NightLike
  overnight?: Overnight | null
  restless?: Restless | null
  /** Sleep sounds sessions filed under this night; [] means it did not run */
  sounds?: SoundsSession[] | null
  /** heart rate surges */
  events?: SurgeEvent[]
}

export const NIGHT = {
  /** a minute is Still under this share of movement, Light under `restless`, else Restless */
  still: 0.02,
  restless: 0.25,
  /** a restless period: a 5-minute block with this many seconds of movement (the Watch's rule) */
  blockMin: 5,
  restlessSeconds: 30,
  /** a heart rate or blood oxygen reading counts for a moment this close */
  hrNearMin: 5,
  spo2NearMin: 10,
  /** a wake worth listing */
  wakeMin: 2,
  /** a snoring run worth listing */
  snoreRunMin: 2,
  /** blood oxygen below this is shown in colour and listed */
  spo2Low: 90,
  /** a wake is "heart rate rose" when its peak is this far over the night's median */
  hrRise: 5,
}

export const STAGE_WORD: Record<Stage, string> = { awake: 'Awake', rem: 'REM', core: 'Core', deep: 'Deep', asleep: 'Asleep' }

export function movementWord(v: number | null | undefined): 'Still' | 'Light' | 'Restless' | null {
  if (v == null) return null
  return v < NIGHT.still ? 'Still' : v < NIGHT.restless ? 'Light' : 'Restless'
}

/** The 5-minute restless blocks, neighbours joined into stretches: [{ s, e }] in ms. */
export function restlessBands(r: Restless | null | undefined): Array<{ s: number; e: number }> {
  if (!r?.series?.length) return []
  const out: Array<{ s: number; e: number }> = []
  for (let i = 0; i < r.series.length; i += NIGHT.blockMin) {
    const block = r.series.slice(i, i + NIGHT.blockMin)
    if (block.reduce((a, b) => a + b, 0) * 60 < NIGHT.restlessSeconds) continue
    const s = r.start + i * MIN
    const e = r.start + Math.min(r.series.length, i + NIGHT.blockMin) * MIN
    const last = out[out.length - 1]
    if (last && s <= last.e) last.e = e
    else out.push({ s, e })
  }
  return out
}

const nearest = (pts: Array<[number, number]> | undefined, start: number, t: number, withinMin: number): number | null => {
  let best: number | null = null
  let bestD = Infinity
  for (const [m, v] of pts || []) {
    const d = Math.abs(start + m * MIN - t)
    if (d <= withinMin * MIN && d < bestD) { best = v; bestD = d }
  }
  return best
}

export const stageAt = (night: NightLike, t: number): Stage | null => (night.segments || []).find((s) => s.start <= t && s.end > t)?.stage ?? null

export function movementAt(r: Restless | null | undefined, t: number): number | null {
  if (!r?.series?.length) return null
  const i = Math.floor((t - r.start) / MIN)
  return i >= 0 && i < r.series.length ? r.series[i] : null
}

export interface Moment {
  t: number
  stage: Stage | null
  movement: 'Still' | 'Light' | 'Restless' | null
  hr: number | null
  spo2: number | null
  sound: string | null
  event: string | null
}

/** What every lane says at one moment: the crosshair's panel. */
export function momentAt(d: NightData, t: number): Moment {
  const start = d.night.start
  const ev = (d.sounds || []).flatMap((s) => s.events).find((e) => e.s - 30000 <= t && e.e + 30000 >= t)
  const surge = (d.events || []).find((e) => Math.abs(e.t - t) <= 2 * MIN)
  return {
    t,
    stage: stageAt(d.night, t),
    movement: movementWord(movementAt(d.restless, t)),
    hr: nearest(d.overnight?.hr, start, t, NIGHT.hrNearMin),
    spo2: nearest(d.overnight?.spo2, start, t, NIGHT.spo2NearMin),
    sound: ev ? (ev.label === 'snoring' ? 'Snoring' : ev.label === 'cough' ? 'Cough' : 'Talking') : null,
    event: surge ? `Heart rate up ${surge.surge} bpm` : null,
  }
}

/** The night's low and high heart rate, for the lane's edge. */
export function hrRange(hr: Array<[number, number]> | undefined): { low: number; high: number } | null {
  if (!hr?.length) return null
  const v = hr.map((p) => p[1])
  return { low: Math.round(Math.min(...v)), high: Math.round(Math.max(...v)) }
}

/** The Sound lane: ran and heard something, ran and heard nothing, or not recording. */
export function soundLane(sessions: SoundsSession[] | null | undefined): 'heard' | 'quiet' | 'off' {
  if (!sessions?.length) return 'off'
  return sessions.some((s) => s.events.length) ? 'heard' : 'quiet'
}

export const SOUND_LANE_WORDS = { quiet: 'Nothing heard', off: 'Not recording' } as const

export interface Happening { t: number; kind: 'wake' | 'restless' | 'surge' | 'spo2' | 'snoring'; text: string }

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : null
}
const mins = (ms: number) => Math.max(1, Math.round(ms / MIN))

/**
 * The night's notable moments in time order, one line each, so the lanes read
 * together: wakes (with the heart rate and movement around them), restless
 * stretches, heart rate surges, low blood oxygen readings and snoring runs.
 */
export function whatHappened(d: NightData, clock: (ms: number) => string): Happening[] {
  const { night } = d
  const out: Happening[] = []
  const hr = d.overnight?.hr || []
  const usual = median(hr.map((p) => p[1]))
  const bands = restlessBands(d.restless)

  for (const s of night.segments || []) {
    if (s.stage !== 'awake' || s.start <= night.start || s.end >= night.end) continue
    const len = s.end - s.start
    if (len < NIGHT.wakeMin * MIN) continue
    const peak = hr.filter(([m]) => {
      const t = night.start + m * MIN
      return t >= s.start - 2 * MIN && t <= s.end
    }).reduce((a, [, b]) => Math.max(a, b), 0)
    const before = (d.restless?.series?.length ? bands.some((b) => b.e >= s.start - 5 * MIN && b.s <= s.start) : false)
    const extras: string[] = []
    if (usual != null && peak >= usual + NIGHT.hrRise) extras.push(`Heart rate rose to ${Math.round(peak)}`)
    if (before) extras.push('you moved a lot just before')
    const joined = extras.join(', ')
    const tail = joined ? ` ${joined.charAt(0).toUpperCase()}${joined.slice(1)}.` : ''
    out.push({ t: s.start, kind: 'wake', text: `${clock(s.start)} Woke for ${mins(len)} min.${tail}` })
  }
  for (const b of bands) {
    out.push({ t: b.s, kind: 'restless', text: `${clock(b.s)} Restless for ${mins(b.e - b.s)} min, to ${clock(b.e)}.` })
  }
  for (const e of d.events || []) {
    out.push({ t: e.t, kind: 'surge', text: `${clock(e.t)} Heart rate rose ${e.surge} bpm above your usual for the night.` })
  }
  for (const [m, p] of d.overnight?.spo2 || []) {
    if (p >= NIGHT.spo2Low) continue
    const t = night.start + m * MIN
    out.push({ t, kind: 'spo2', text: `${clock(t)} Blood oxygen reading ${p}%.` })
  }
  const events = (d.sounds || []).flatMap((s) => s.events)
  for (const [a, b] of snoreRuns(events, night.start, night.end)) {
    if (b - a < NIGHT.snoreRunMin * MIN) continue
    out.push({ t: a, kind: 'snoring', text: `${clock(a)} Snoring for ${mins(b - a)} min.` })
  }
  return out.sort((x, y) => x.t - y.t)
}

/** One line under the hypnogram: "Restless 3 times, longest 14 min. Heart rate low 51. No snoring heard." */
export function nightSummary(d: NightData): string {
  const parts: string[] = []
  if (d.restless?.series?.length) {
    const bands = restlessBands(d.restless)
    if (!bands.length) parts.push('No restless stretches')
    else {
      const longest = Math.max(...bands.map((b) => mins(b.e - b.s)))
      parts.push(`Restless ${bands.length === 1 ? 'once' : `${bands.length} times`}, longest ${longest} min`)
    }
  }
  const range = hrRange(d.overnight?.hr)
  if (range) parts.push(`Heart rate low ${range.low}`)
  const lane = soundLane(d.sounds)
  if (lane !== 'off') {
    const snoring = snoreRuns((d.sounds || []).flatMap((s) => s.events), d.night.start, d.night.end).reduce((t, [a, b]) => t + (b - a), 0)
    parts.push(snoring >= MIN ? `Snoring ${mins(snoring)} min` : 'No snoring heard')
  }
  return parts.length ? `${parts.join('. ')}.` : ''
}

/** The narrowest zoomed window on the night card: 30 minutes. */
export const NIGHT_ZOOM_MIN = 30

/** Zoom a night window by `factor` around `at` (0 left, 1 right), at least 30 minutes, inside the night. */
export function zoomNight(win: { from: number; to: number }, factor: number, at: number, night: { start: number; end: number }): { from: number; to: number } {
  const full = night.end - night.start
  const span = Math.min(full, Math.max(NIGHT_ZOOM_MIN * MIN, (win.to - win.from) * factor))
  const centre = win.from + (win.to - win.from) * at
  let from = centre - span * at
  let to = from + span
  if (from < night.start) { to += night.start - from; from = night.start }
  if (to > night.end) { from -= to - night.end; to = night.end }
  return { from: Math.max(night.start, from), to }
}

// ------------------------------------------------------------------ layout

/**
 * The night chart's sizes, in points. On the card the stages take 160 (one
 * row each for Awake, REM, Core and Deep) and each lane 36 to 44; in full
 * screen the stages take at least 240 and every lane 52.
 */
export const NIGHT_LAYOUT = {
  cardStagesH: 160,
  cardLaneH: { move: 40, sound: 36, hr: 44, spo2: 36 } as Record<string, number>,
  fullLaneH: 52,
  fullStagesMin: 240,
  /** a short screen (landscape): lanes and stages give way so it all fits */
  fullLaneTight: 36,
  fullStagesTight: 120,
  tightBelow: 480,
}

/** One colour per stage: Awake coral, REM light blue, Core mid blue, Deep deep indigo. */
export const STAGE_COLOR: Record<Stage, string> = {
  awake: 'var(--stage-awake)', rem: 'var(--stage-rem)', core: 'var(--stage-core)', deep: 'var(--stage-deep)', asleep: 'var(--stage-core)',
}

/** Minutes in each stage row over the whole night. */
export function stageTotals(steps: Array<{ start: number; end: number; row: Stage }>): Partial<Record<Stage, number>> {
  const out: Partial<Record<Stage, number>> = {}
  for (const s of steps) out[s.row] = (out[s.row] || 0) + (s.end - s.start) / MIN
  for (const k of Object.keys(out) as Stage[]) out[k] = Math.round(out[k] as number)
  return out
}

/** A smooth line through points (Catmull-Rom as cubic Béziers), for the heart rate lane. */
export function smoothPath(pts: Array<[number, number]>): string {
  if (!pts.length) return ''
  const f = (v: number) => v.toFixed(1)
  if (pts.length < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)},${f(y)}`).join(' ')
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`
  }
  return d
}

/** The night's lowest heart rate reading: where and what. */
export function hrLow(hr: Array<[number, number]> | undefined, start: number): { t: number; bpm: number } | null {
  if (!hr?.length) return null
  let best = hr[0]
  for (const p of hr) if (p[1] < best[1]) best = p
  return { t: start + best[0] * MIN, bpm: Math.round(best[1]) }
}

export interface Cell { key: string; label: string; value: string; unit?: string }

/** The crosshair panel: big values, no sentence. Stage and time are the headline; the rest are cells. */
export function crosshairCells(m: Moment): Cell[] {
  const out: Cell[] = []
  if (m.hr != null) out.push({ key: 'hr', label: 'Heart rate', value: String(Math.round(m.hr)), unit: 'bpm' })
  if (m.movement) out.push({ key: 'move', label: 'Movement', value: m.movement })
  if (m.spo2 != null) out.push({ key: 'spo2', label: 'SpO2', value: String(m.spo2), unit: '%' })
  if (m.sound) out.push({ key: 'sound', label: 'Sound', value: m.sound })
  if (m.event) out.push({ key: 'event', label: 'Note', value: m.event })
  return out
}

/** The legend under the night chart: one item per kind of mark it drew. */
export function nightLegend(o: { restless?: boolean; snoring?: boolean; other?: boolean; gaps?: boolean; spo2Low?: boolean }) {
  const out: Array<{ key: string; label: string; kind: 'band' | 'bar' | 'ring' | 'dot'; color?: string }> = []
  if (o.restless) out.push({ key: 'restless', label: 'Restless', kind: 'band', color: 'var(--amber)' })
  if (o.snoring) out.push({ key: 'snore', label: 'Snoring', kind: 'bar', color: 'var(--text-2)' })
  if (o.other) out.push({ key: 'other', label: 'Cough or talking', kind: 'ring', color: 'var(--text-2)' })
  if (o.gaps) out.push({ key: 'gap', label: 'No audio', kind: 'band', color: 'var(--text-3)' })
  if (o.spo2Low) out.push({ key: 'spo2', label: 'SpO2 under 90%', kind: 'dot', color: 'var(--warn)' })
  return out
}
