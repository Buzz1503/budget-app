// The night card, read for one moment and as a story. Pure: Apple Health's
// stages, heart rate, HRV, blood oxygen and breathing rate for one night go
// in; what each lane says at a minute, the night's notable moments in time
// order, and one summary line come out. Plain words, association only.
// (The Watch movement recording and Sleep sounds were removed: every lane is
// Health data.)

import { wakeEvents, hrSpikes, restlessNight, restlessLine, nightMedianHR, RESTLESS } from './restless'

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
  /** [minutes from the night's start, ms] */
  hrv?: Array<[number, number]>
  /** [minutes from the night's start, %] */
  spo2?: Array<[number, number]>
  /** [minutes from the night's start, breaths a minute] */
  resp?: Array<[number, number]>
}
/** A heart rate surge from the nightmare estimate. */
export interface SurgeEvent { t: number; surge: number }

export interface NightData {
  night: NightLike
  overnight?: Overnight | null
  /** heart rate surges (nightmare estimate) */
  events?: SurgeEvent[]
}

export const NIGHT = {
  /** a reading counts for a moment this close */
  hrNearMin: 5,
  hrvNearMin: 15,
  spo2NearMin: 10,
  respNearMin: 15,
  /** a wake worth listing */
  wakeMin: 2,
  /** blood oxygen below this is shown in amber and listed */
  spo2Low: 90,
  /** a wake is "heart rate rose" when its peak is this far over the night's median */
  hrRise: 5,
}

export const STAGE_WORD: Record<Stage, string> = { awake: 'Awake', rem: 'REM', core: 'Core', deep: 'Deep', asleep: 'Asleep' }

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

export interface Moment {
  t: number
  stage: Stage | null
  hr: number | null
  hrv: number | null
  spo2: number | null
  resp: number | null
  event: string | null
}

/** What every lane says at one moment: the crosshair's panel. */
export function momentAt(d: NightData, t: number): Moment {
  const start = d.night.start
  const spike = hrSpikes(d.overnight?.hr, start).find((x) => t >= x.t - MIN && t <= x.end + MIN)
  const surge = (d.events || []).find((e) => Math.abs(e.t - t) <= 2 * MIN)
  return {
    t,
    stage: stageAt(d.night, t),
    hr: nearest(d.overnight?.hr, start, t, NIGHT.hrNearMin),
    hrv: nearest(d.overnight?.hrv, start, t, NIGHT.hrvNearMin),
    spo2: nearest(d.overnight?.spo2, start, t, NIGHT.spo2NearMin),
    resp: nearest(d.overnight?.resp, start, t, NIGHT.respNearMin),
    event: spike ? `Heart rate spike, ${spike.above} above` : surge ? `Heart rate up ${surge.surge} bpm` : null,
  }
}

/** The night's low and high heart rate. */
export function hrRange(hr: Array<[number, number]> | undefined): { low: number; high: number } | null {
  if (!hr?.length) return null
  const v = hr.map((p) => p[1])
  return { low: Math.round(Math.min(...v)), high: Math.round(Math.max(...v)) }
}

export interface Happening { t: number; kind: 'wake' | 'wakes' | 'spike' | 'spo2'; text: string }

export const SETTLED = 'A settled night.'

/**
 * The notable moments, in time order: each wake-up over 5 minutes, one line
 * for the shorter wake-ups (so the list and "Woke N times" always add up),
 * heart rate spikes, and blood oxygen under 90%. An empty list reads "A
 * settled night."
 */
export function whatHappened(d: NightData, clock: (ms: number) => string): Happening[] {
  const { night } = d
  const out: Happening[] = []
  const hr = d.overnight?.hr || []
  const usual = nightMedianHR(hr)
  const wakes = wakeEvents(night.segments)
  const short: typeof wakes = []
  for (const w of wakes) {
    if (w.min <= RESTLESS.notableWakeMin) { short.push(w); continue }
    const peak = hr.filter(([m]) => {
      const t = night.start + m * MIN
      return t >= w.s - 2 * MIN && t <= w.e
    }).reduce((a, [, b]) => Math.max(a, b), 0)
    const tail = usual != null && peak >= usual + NIGHT.hrRise ? ` Heart rate rose to ${Math.round(peak)}.` : ''
    out.push({ t: w.s, kind: 'wake', text: `${clock(w.s)} Woke for ${w.min} min.${tail}` })
  }
  if (short.length) {
    const times = short.map((w) => clock(w.s)).join(', ')
    out.push({ t: short[0].s, kind: 'wakes', text: short.length === 1 ? `${times} Woke briefly, ${short[0].min} min.` : `${short.length} brief wake-ups of ${RESTLESS.wakeMin} to ${RESTLESS.notableWakeMin} min: ${times}.` })
  }
  for (const x of hrSpikes(hr, night.start)) {
    out.push({ t: x.t, kind: 'spike', text: `${clock(x.t)} Heart rate ${x.peak}, ${x.above} above the night's usual, for about ${Math.round(x.durationMin)} min.` })
  }
  for (const [m, p] of d.overnight?.spo2 || []) {
    if (p >= NIGHT.spo2Low) continue
    const t = night.start + m * MIN
    out.push({ t, kind: 'spo2', text: `${clock(t)} Blood oxygen reading ${p}%.` })
  }
  return out.sort((x, y) => x.t - y.t)
}

export function nightSummary(d: NightData): string {
  return restlessLine(restlessNight({ start: d.night.start, segments: d.night.segments, overnight: d.overnight }))
}

// ------------------------------------------------------------------ layout

/**
 * The night chart's sizes, in points. On the card the stages take 160 (one
 * row each for Awake, REM, Core and Deep) and each lane 36 to 44; in full
 * screen the stages take at least 240 and every lane 52.
 */
export const NIGHT_LAYOUT = {
  cardStagesH: 160,
  cardLaneH: { hr: 44, hrv: 36, spo2: 36, resp: 36 } as Record<string, number>,
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
  if (m.hrv != null) out.push({ key: 'hrv', label: 'HRV', value: String(Math.round(m.hrv)), unit: 'ms' })
  if (m.spo2 != null) out.push({ key: 'spo2', label: 'SpO2', value: String(m.spo2), unit: '%' })
  if (m.resp != null) out.push({ key: 'resp', label: 'Breathing', value: String(m.resp), unit: '/min' })
  if (m.event) out.push({ key: 'event', label: 'Note', value: m.event })
  return out
}

/** The legend under the night chart: one item per kind of mark it drew. */
export function nightLegend(o: { spikes?: boolean; spo2Low?: boolean; hrLow?: boolean }) {
  const out: Array<{ key: string; label: string; kind: 'band' | 'bar' | 'ring' | 'dot'; color?: string }> = []
  if (o.hrLow) out.push({ key: 'low', label: 'Lowest heart rate', kind: 'dot', color: 'var(--text)' })
  if (o.spikes) out.push({ key: 'spike', label: 'Heart rate spike', kind: 'band', color: 'var(--amber)' })
  if (o.spo2Low) out.push({ key: 'spo2', label: 'SpO2 under 90%', kind: 'dot', color: 'var(--warn)' })
  return out
}
