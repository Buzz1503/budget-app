// The chart glance test, as pure helpers every chart shares: the question a
// chart answers, its one bold answer line, the y axis unit in words, the
// "better" hint, and the legend (shown whenever a chart has more than one kind
// of mark). TrendChart, the night card and the sauna charts read these.

import { betterOf, type Better } from '../lib/glance'

/** The question each chart answers, by metric. */
export const CHART_QUESTION: Record<string, string> = {
  weight: 'How is my weight moving?',
  bodyFat: 'Is my body fat coming down?',
  fatMass: 'Is my fat mass coming down?',
  leanMass: 'Am I keeping lean mass?',
  muscleMass: 'Am I keeping muscle?',
  skeletalMuscleMass: 'Am I keeping muscle?',
  waist: 'Is my waist getting smaller?',
  visceralFatLevel: 'Is visceral fat coming down?',
  readiness: 'How ready am I, day to day?',
  hrv: 'Is my HRV going up?',
  rhr: 'Is my resting heart rate going down?',
  sleep: 'Am I sleeping enough?',
  sleepScore: 'How well am I sleeping?',
  deepSleep: 'Am I getting deep sleep?',
  remSleep: 'Am I getting REM sleep?',
  sleepHR: 'Is my heart rate lower asleep?',
  bedtime: 'Is my bedtime steady?',
  restlessness: 'Am I sleeping more still?',
  breathing: 'Are breathing disturbances low?',
  snoring: 'Am I snoring less?',
  restlessMove: 'Am I moving less in my sleep?',
  saunaLength: 'How long are my sessions?',
  saunaTemp: 'How hot are my sessions?',
}

/** Chart metric keys that differ from the glance metric names. */
const ALIAS: Record<string, string> = { remSleep: 'rem', sleepHR: 'sleepingHR', skeletalMuscleMass: 'skeletalMuscle' }

export const chartBetter = (metric: string): Better => betterOf(ALIAS[metric] ?? metric)

export function chartQuestion(metric: string, title: string): string {
  return CHART_QUESTION[metric] ?? title
}

/** "down 0.6 kg over 78 days" → "Down 0.6 kg over 78 days." */
export function chartAnswer(words: string | null | undefined): string | null {
  if (!words) return null
  const s = words.trim()
  return `${s[0].toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}`
}

const UNIT_WORDS: Record<string, string> = { h: 'hours', min: 'min', ms: 'ms', bpm: 'bpm', kg: 'kg', '%': '%', cm: 'cm', C: '°C', '°C': '°C', 'per h': 'per hour', '/min': 'per min' }

/** The y axis label: the unit in words, or the scale for a score. */
export function axisUnit(unit: string | null | undefined, metric = ''): string | null {
  if (unit) return UNIT_WORDS[unit] ?? unit
  if (metric === 'readiness' || metric === 'sleepScore') return 'score'
  if (metric === 'bedtime') return 'time'
  if (metric === 'visceralFatLevel') return 'level'
  return null
}

/** "↑ better" or "↓ better", or nothing for a measure with no better side. */
export function betterHint(metric: string): string | null {
  const b = chartBetter(metric)
  return b === 'up' ? '↑ better' : b === 'down' ? '↓ better' : null
}

export type LegendKind = 'line' | 'dot' | 'ring' | 'ring-dashed' | 'dashed' | 'band' | 'hollow' | 'diamond' | 'triangle' | 'bar' | 'flame' | 'trend'
export interface LegendItem { key: string; label: string; kind: LegendKind; color?: string }

/** What a single-series chart drew, as legend items. */
export function legendItems(o: {
  averaged?: boolean; daily?: boolean; scans?: boolean; estimatedStart?: boolean; startLine?: boolean
  wobble?: boolean; refBand?: string | null; suspects?: boolean; bloods?: boolean; gap?: boolean; trend?: boolean; color?: string
}): LegendItem[] {
  const out: LegendItem[] = []
  if (o.daily) out.push({ key: 'daily', label: 'Reading', kind: 'dot', color: o.color })
  if (o.averaged) out.push({ key: 'avg', label: 'Average', kind: 'dot', color: o.color })
  if (o.scans) out.push({ key: 'scan', label: 'Scan', kind: 'ring', color: o.color })
  if (o.estimatedStart) out.push({ key: 'est', label: 'Estimated start', kind: 'ring-dashed', color: o.color })
  if (o.startLine) out.push({ key: 'start', label: 'Start', kind: 'dashed' })
  if (o.trend) out.push({ key: 'trend', label: 'trend', kind: 'trend', color: o.color })
  if (o.wobble) out.push({ key: 'wobble', label: 'Normal wobble', kind: 'band', color: o.color })
  if (o.refBand) out.push({ key: 'ref', label: o.refBand, kind: 'band' })
  if (o.gap) out.push({ key: 'gap', label: 'Gap in readings', kind: 'dashed', color: o.color })
  if (o.suspects) out.push({ key: 'suspect', label: 'Looks wrong', kind: 'hollow' })
  if (o.bloods) out.push({ key: 'blood', label: 'Bloods', kind: 'diamond' })
  return out
}

/** A legend only when there is more than one kind of mark. */
export const needsLegend = (items: LegendItem[]) => items.length > 1
