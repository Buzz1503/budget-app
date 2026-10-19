// Readiness, 0 to 100: how this morning compares with your own usual.
//
//   HRV 40 % (higher than usual counts up), resting HR 25 % (lower counts up),
//   sleep 25 %, respiratory rate 5 % and wrist temperature 5 % (only ever
//   count down, and only when above usual).
//
// composite = Σ weight × z, weights re-normalised over what is present.
// score = clamp(round(60 + 22 × composite), 0, 100).
//
// Needs HRV or resting HR, plus sleep, from last night; otherwise it says so.
// The sleep component is last night's hours asleep against your own baseline
// — the brief's 0.4 h sigma floor for sleep only makes sense in hours — while
// the 0–100 sleep performance score lives on the Sleep screen.

import { READINESS } from './config'
import { baselineFor, zScore, adjustingChip } from './baseline'
import type { Baseline, ProtocolEvent, MetricKey } from './baseline'
import { clamp, isNum } from './stats'

export type ReadinessKey = 'hrv' | 'rhr' | 'sleep' | 'resp' | 'temp'

export interface ReadinessSeries {
  hrv: Map<string, number>   // ms (overnight, falling back to the day mean)
  rhr: Map<string, number>   // bpm
  sleep: Map<string, number> // hours asleep, keyed by wake date
  resp: Map<string, number>  // breaths/min
  temp: Map<string, number>  // °C
}

export interface Component {
  key: ReadinessKey
  value: number | null
  baseline: Baseline
  /** Raw z of the value against the baseline (ln for HRV). */
  z: number | null
  /** z after direction: positive is always better for readiness. */
  effect: number | null
  weight: number
}

export type BandId = 'low' | 'moderate' | 'high'

export interface Readiness {
  status: 'ok' | 'building' | 'insufficient'
  score: number | null
  band: BandId | null
  bandLabel: string | null
  components: Component[]
  /** "day X of 14" while the baseline is being built. */
  buildingDay: number
  chip: string | null
}

const METRIC: Record<ReadinessKey, MetricKey> = { hrv: 'hrv', rhr: 'rhr', sleep: 'sleep', resp: 'resp', temp: 'temp' }
const ln = (v: number) => Math.log(v)

export function bandFor(score: number): { id: BandId; label: string } {
  const b = READINESS.bands.find((x) => score <= x.max) || READINESS.bands[READINESS.bands.length - 1]
  return { id: b.id as BandId, label: b.label }
}

/** Direction: what a z of +1 means for readiness. */
function effectOf(key: ReadinessKey, z: number | null): number | null {
  if (z == null) return null
  if (key === 'hrv' || key === 'sleep') return z
  if (key === 'rhr') return -z
  return -Math.max(0, z) // resp, temp: only an upward move counts, and it counts down
}

export function readinessFor(date: string, series: ReadinessSeries, { events = [] }: { events?: ProtocolEvent[] } = {}): Readiness {
  const components: Component[] = (Object.keys(READINESS.weights) as ReadinessKey[]).map((key) => {
    const transform = key === 'hrv' ? ln : (v: number) => v
    const baseline = baselineFor(series[key], date, METRIC[key], { events, transform })
    const raw = series[key].get(date)
    const value = isNum(raw) ? raw : null
    const z = zScore(value, baseline, transform)
    return { key, value, baseline, z, effect: effectOf(key, z), weight: 0 }
  })
  const get = (k: ReadinessKey) => components.find((c) => c.key === k) as Component
  const hrv = get('hrv')
  const rhr = get('rhr')
  const chip = adjustingChip(hrv.baseline, date) || adjustingChip(rhr.baseline, date)
  const base = { components, chip, buildingDay: 0 }

  if (!hrv.baseline.ready && !rhr.baseline.ready) {
    const days = Math.max(hrv.baseline.n, rhr.baseline.n)
    return { ...base, status: 'building', score: null, band: null, bandLabel: null, buildingDay: Math.min(days, hrv.baseline.needed) }
  }
  const usable = components.filter((c) => c.effect != null)
  const hasHeart = usable.some((c) => c.key === 'hrv' || c.key === 'rhr')
  const hasSleep = usable.some((c) => c.key === 'sleep')
  if (!hasHeart || !hasSleep) {
    return { ...base, status: 'insufficient', score: null, band: null, bandLabel: null }
  }
  const totalWeight = usable.reduce((s, c) => s + READINESS.weights[c.key], 0)
  for (const c of usable) c.weight = READINESS.weights[c.key] / totalWeight
  const composite = usable.reduce((s, c) => s + c.weight * (c.effect as number), 0)
  const score = clamp(Math.round(READINESS.center + READINESS.scale * composite), 0, 100)
  const band = bandFor(score)
  return { ...base, status: 'ok', score, band: band.id, bandLabel: band.label }
}
