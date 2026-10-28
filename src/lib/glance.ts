// The easy-to-read rules in one place, pure so they can be tested: which way is
// better for each metric, the tone and words of a delta chip, the four status
// words that replace the long change labels, a locked section's progress line,
// and the split of a sentence into plain text and bold numbers with grey units.
// Components in src/components/ui/Glance.jsx draw them.

export type Better = 'up' | 'down' | null
export type Tone = 'better' | 'worse' | 'same'
export type Status = 'Normal' | 'Possible' | 'Clear' | 'Early'

/**
 * Which direction counts as better. Missing or null means neither (weight,
 * respiratory rate, temperature): those chips stay grey whichever way they move.
 */
export const BETTER: Record<string, Better> = {
  // heart and recovery
  rhr: 'down', restingHR: 'down', sleepingHR: 'down', lowestHR: 'down', avgHR: 'down', daytimeHR: 'down',
  hrv: 'up', readiness: 'up', hrRecovery: 'up', coolDownDrop: 'up', hrAt10: 'down', vo2: 'up',
  // sleep
  sleep: 'up', asleep: 'up', asleepMin: 'up', sleepMin: 'up', sleepDuration: 'up', deepSleep: 'up', deepMin: 'up', deep: 'up',
  remMin: 'up', rem: 'up', sleepScore: 'up', score: 'up', efficiency: 'up', rested: 'up',
  restlessness: 'down', restless: 'down', awake: 'down', awakeMin: 'down', wakeups: 'down', latency: 'down', onsetMin: 'down',
  snoring: 'down', snoringMin: 'down', breathing: 'down', breathingDisturbances: 'down', lateUse: 'down',
  // body
  fatMass: 'down', bodyFat: 'down', fat: 'down', visceralFat: 'down', visceralFatLevel: 'down', visceralFatMass: 'down',
  visceralArea: 'down', waist: 'down', subcutaneousFat: 'down', bioAge: 'down',
  leanMass: 'up', lean: 'up', muscle: 'up', muscleMass: 'up', skeletalMuscle: 'up', protein: 'up',
  weight: null, respiratory: null, wristTemp: null,
}

export const betterOf = (metric: string | null | undefined): Better => (metric && metric in BETTER ? BETTER[metric] : null)

/** Better, worse or the same, from the delta and the metric's better direction. Under `epsilon` is the same. */
export function toneFor(metric: string | null | undefined, delta: number | null | undefined, epsilon = 0): Tone {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) <= epsilon || delta === 0) return 'same'
  const b = betterOf(metric)
  if (!b) return 'same'
  return (delta > 0) === (b === 'up') ? 'better' : 'worse'
}

/** better = accent green, worse = amber, the same = grey. */
export const TONE_COLOR: Record<Tone, string> = { better: 'var(--good)', worse: 'var(--warn)', same: 'var(--text-3)' }

const trim = (v: number, dp: number) => {
  const s = Math.abs(v).toFixed(dp)
  return dp > 0 ? String(Number(s)) : s
}

/** "▲ 26 ms", "▼ 2", "0 ms" (no arrow when it rounds to zero). */
export function deltaText(delta: number | null | undefined, unit = '', dp = 0): string {
  if (delta == null || !Number.isFinite(delta)) return ''
  const rounded = Number(delta.toFixed(dp))
  const u = unit ? ` ${unit}` : ''
  if (rounded === 0) return `0${u}`
  return `${rounded > 0 ? '▲' : '▼'} ${trim(rounded, dp)}${u}`
}

/** The chip's tone uses the rounded value, so a chip that reads 0 is never coloured. */
export function chip(metric: string | null | undefined, delta: number | null | undefined, unit = '', dp = 0) {
  if (delta == null || !Number.isFinite(delta)) return null
  const rounded = Number(delta.toFixed(dp))
  return { text: deltaText(delta, unit, dp), tone: toneFor(metric, rounded) }
}

/**
 * The four status words. Every engine's long label maps here: "Clear change",
 * "Clear difference", "Clear" → Clear; "Possible …" → Possible; "Within normal
 * fluctuation", "Unclear", "about the same" → Normal; "Too early", locked → Early.
 */
export function statusOf(label: string | null | undefined): Status {
  const l = (label || '').toLowerCase()
  if (!l || l.startsWith('too early') || l === 'early' || l.includes('locked') || l.includes('needs')) return 'Early'
  if (l.startsWith('clear')) return 'Clear'
  if (l.startsWith('possible') || l === 'likely') return 'Possible'
  return 'Normal'
}

/** One legend per screen, behind (i). */
export const STATUS_LEGEND: Array<[Status, string]> = [
  ['Clear', 'Bigger than your usual day-to-day wobble.'],
  ['Possible', 'Larger than usual, but could still be noise.'],
  ['Normal', 'Within your normal range.'],
  ['Early', 'Not enough data yet to say.'],
]

/** "3 comparisons unlock with more sessions · 4 of 5" */
export function progressWords(count: number, noun: string, have: number, need: number, more = 'more data'): string {
  const plural = count === 1 ? noun : `${noun}s`
  return `${count} ${plural} unlock${count === 1 ? 's' : ''} with ${more} · ${Math.min(have, need)} of ${need}`
}

export interface RichPart { t: 'text' | 'num'; v: string; unit?: string }

const UNITS = 'bpm|ms|kg|cm|mg|mcg|kcal|mmol/L|pmol/L|nmol/L|IU/L|mIU/L|g|%|min|h|m|s|C|units|nights|days|sessions|weeks|points|/min'
// a number (with sign, decimals, or an h/m duration like 6 h 19 m) and an optional unit right after it
const RICH = new RegExp(`([+−-]?\\d+(?:[.,]\\d+)?)(\\s?(?:${UNITS})(?![A-Za-z]))?`, 'g')

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec'
const MONTH_AFTER = new RegExp(`^\\s(?:${MONTHS})`)
const MONTH_BEFORE = new RegExp(`(?:${MONTHS})\\s$`)

/** Split a sentence so the numbers can be bold and their units small and grey. Times (08:30) and dates stay text. */
export function richParts(text: string): RichPart[] {
  const out: RichPart[] = []
  let last = 0
  for (const m of text.matchAll(RICH)) {
    const i = m.index ?? 0
    const before = text[i - 1]
    const after = text[i + m[0].length]
    // part of a time, a date or a word (09:30, 24-05, MOTS-c, SS-31, B12): leave alone
    const rest = text.slice(i + m[0].length)
    const prior = text.slice(Math.max(0, i - 4), i)
    if (before === ':' || after === ':' || (before && /[A-Za-z0-9-]/.test(before)) || (!m[2] && after && /[A-Za-z]/.test(after))) continue
    if (!m[2] && (MONTH_AFTER.test(rest) || MONTH_BEFORE.test(prior))) continue
    if (i > last) out.push({ t: 'text', v: text.slice(last, i) })
    out.push({ t: 'num', v: m[1], unit: m[2] ? m[2] : undefined })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) })
  return out
}

interface Move { delta: number | null }

/** The answer above the morning rows: the biggest move against your usual, in words. */
export function recoveryAnswer(rows: { hrv?: Move | null; rhr?: Move | null; sleep?: Move | null }): string {
  const named = { hrv: 'HRV', rhr: 'Resting heart rate', sleep: 'Sleep' } as const
  const units = { hrv: 'ms', rhr: 'bpm', sleep: 'h' } as const
  // a rough day-to-day size for each, so the largest move is picked fairly
  const scale = { hrv: 8, rhr: 3, sleep: 0.7 } as const
  let best: { k: keyof typeof named; size: number; d: number } | null = null
  for (const k of ['hrv', 'rhr', 'sleep'] as const) {
    const d = rows[k]?.delta
    if (d == null) continue
    const size = Math.abs(d) / scale[k]
    if (size >= 1 && (!best || size > best.size)) best = { k, size, d }
  }
  if (!best) return 'Everything is close to your usual.'
  const amount = best.k === 'sleep' ? `${Number(Math.abs(best.d).toFixed(1))} h` : `${Math.abs(Math.round(best.d))} ${units[best.k]}`
  return `${named[best.k]} is ${best.d > 0 ? 'up' : 'down'} ${amount} on your usual.`
}
