// Good nights against bad nights. A good night has 0 or 1 wake-ups, a bad
// night 2 or more (the one wake-up definition, wakeEvents). For every factor,
// logged or automatic: how often it appears (or its average) on good nights
// and on bad nights, the difference with a 95% interval, a p-value, and a
// label. Many factors are tested at once, so some will differ by luck: the
// p-values go through the Benjamini-Hochberg false discovery rate correction
// at 10%, and only a factor that survives it, with 10 nights or more on each
// side, is Clear. Association only.

export const GOOD_BAD = {
  /** a bad night has this many wake-ups or more */
  badFrom: 2,
  /** each side needs this many nights before a label other than Early */
  minEach: 10,
  /** the false discovery rate */
  fdr: 0.1,
  z: 1.96,
  top: 5,
}

export type GBLabel = 'Clear' | 'Possible' | 'Early' | null

export interface GBRow {
  date: string
  wakeUps: number | null
  binary: Record<string, boolean | null>
  continuous: Record<string, number | null>
}

export interface GBFactor {
  key: string
  kind: 'binary' | 'continuous'
  /** share (binary, 0 to 1) or average (continuous) on good and on bad nights */
  good: number
  bad: number
  nGood: number
  nBad: number
  /** bad minus good, with its 95% interval */
  diff: number
  lo: number
  hi: number
  p: number
  /** standardised size for ranking (Cohen's h for shares, d for averages) */
  size: number
  label: GBLabel
  survives: boolean
}

/** Standard normal cumulative distribution (Abramowitz and Stegun 7.1.26). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2)
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2
}
const twoSided = (z: number) => Math.max(0, Math.min(1, 2 * (1 - normCdf(Math.abs(z)))))

/** Benjamini-Hochberg: which p-values survive at false discovery rate q. */
export function benjaminiHochberg(ps: number[], q = GOOD_BAD.fdr): boolean[] {
  const m = ps.length
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  let k = -1
  order.forEach((o, rank) => { if (o.p <= ((rank + 1) / m) * q) k = rank })
  const out = new Array(m).fill(false)
  for (let r = 0; r <= k; r++) out[order[r].i] = true
  return out
}

/** The label: Early under 10 nights a side; Clear when it survives the correction; Possible when the interval misses zero before it. */
export function labelFor(f: { nGood: number; nBad: number; lo: number; hi: number }, survives: boolean): GBLabel {
  if (f.nGood < GOOD_BAD.minEach || f.nBad < GOOD_BAD.minEach) return 'Early'
  if (survives) return 'Clear'
  if (f.lo > 0 || f.hi < 0) return 'Possible'
  return null
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const variance = (xs: number[], m: number) => (xs.length > 1 ? xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) : 0)

function compareBinary(key: string, good: boolean[], bad: boolean[]): Omit<GBFactor, 'label' | 'survives'> | null {
  if (good.length < 2 || bad.length < 2) return null
  const p1 = good.filter(Boolean).length / good.length
  const p2 = bad.filter(Boolean).length / bad.length
  const diff = p2 - p1
  const se = Math.sqrt((p1 * (1 - p1)) / good.length + (p2 * (1 - p2)) / bad.length)
  const pool = (good.filter(Boolean).length + bad.filter(Boolean).length) / (good.length + bad.length)
  const seP = Math.sqrt(pool * (1 - pool) * (1 / good.length + 1 / bad.length))
  const p = seP > 0 ? twoSided(diff / seP) : 1
  const h = 2 * Math.asin(Math.sqrt(p2)) - 2 * Math.asin(Math.sqrt(p1))
  return { key, kind: 'binary', good: p1, bad: p2, nGood: good.length, nBad: bad.length, diff, lo: diff - GOOD_BAD.z * se, hi: diff + GOOD_BAD.z * se, p, size: Math.abs(h) }
}

function compareContinuous(key: string, good: number[], bad: number[]): Omit<GBFactor, 'label' | 'survives'> | null {
  if (good.length < 2 || bad.length < 2) return null
  const m1 = mean(good)
  const m2 = mean(bad)
  const v1 = variance(good, m1)
  const v2 = variance(bad, m2)
  const diff = m2 - m1
  const se = Math.sqrt(v1 / good.length + v2 / bad.length)
  const p = se > 0 ? twoSided(diff / se) : 1
  const sd = Math.sqrt(((good.length - 1) * v1 + (bad.length - 1) * v2) / (good.length + bad.length - 2))
  return { key, kind: 'continuous', good: m1, bad: m2, nGood: good.length, nBad: bad.length, diff, lo: diff - GOOD_BAD.z * se, hi: diff + GOOD_BAD.z * se, p, size: sd > 0 ? Math.abs(diff) / sd : 0 }
}

/** Good and bad nights, every factor compared, corrected and labelled, biggest difference first. */
export function goodVsBad(rows: GBRow[], skip: (key: string) => boolean = () => false): { nGood: number; nBad: number; factors: GBFactor[] } {
  const known = rows.filter((r) => r.wakeUps != null)
  const isBad = (r: GBRow) => (r.wakeUps as number) >= GOOD_BAD.badFrom
  const good = known.filter((r) => !isBad(r))
  const bad = known.filter(isBad)
  const binKeys = new Set<string>()
  const conKeys = new Set<string>()
  for (const r of known) {
    for (const k of Object.keys(r.binary)) binKeys.add(k)
    for (const k of Object.keys(r.continuous)) conKeys.add(k)
  }
  const raw: Array<Omit<GBFactor, 'label' | 'survives'>> = []
  for (const k of binKeys) {
    if (skip(k)) continue
    const g = good.map((r) => r.binary[k]).filter((v): v is boolean => v != null)
    const b = bad.map((r) => r.binary[k]).filter((v): v is boolean => v != null)
    // a factor that never happened, or always did, says nothing
    if (![...g, ...b].some(Boolean) || [...g, ...b].every(Boolean)) continue
    const c = compareBinary(k, g, b)
    if (c) raw.push(c)
  }
  for (const k of conKeys) {
    if (skip(k)) continue
    const g = good.map((r) => r.continuous[k]).filter((v): v is number => v != null && Number.isFinite(v))
    const b = bad.map((r) => r.continuous[k]).filter((v): v is number => v != null && Number.isFinite(v))
    if (new Set([...g, ...b]).size < 2) continue
    const c = compareContinuous(k, g, b)
    if (c) raw.push(c)
  }
  // the correction runs across every factor tested
  const survive = benjaminiHochberg(raw.map((f) => f.p))
  const factors = raw.map((f, i) => ({ ...f, survives: survive[i], label: labelFor(f, survive[i]) }))
    .sort((a, b) => b.size - a.size || a.key.localeCompare(b.key))
  return { nGood: good.length, nBad: bad.length, factors }
}

/** "Bad nights more often follow Retatrutide injection days 1 to 2 and late workouts." */
export function goodBadAnswer(r: { nGood: number; nBad: number; factors: GBFactor[] }, phrase: (key: string) => string): string {
  if (r.nGood + r.nBad === 0) return 'No nights with stages to compare yet.'
  if (r.nGood < GOOD_BAD.minEach || r.nBad < GOOD_BAD.minEach) return `Early: needs ${GOOD_BAD.minEach} good and ${GOOD_BAD.minEach} bad nights.`
  const shown = r.factors.filter((f) => f.label === 'Clear' || f.label === 'Possible')
  const worse = shown.filter((f) => f.kind === 'binary' && f.diff > 0).slice(0, 2)
  if (worse.length) return `Bad nights more often follow ${worse.map((f) => phrase(f.key)).join(' and ')}.`
  const better = shown.filter((f) => f.kind === 'binary' && f.diff < 0).slice(0, 2)
  if (better.length) return `Good nights more often follow ${better.map((f) => phrase(f.key)).join(' and ')}.`
  const cont = shown[0]
  if (cont) return `Bad nights come with ${cont.diff > 0 ? 'a higher' : 'a lower'} ${phrase(cont.key)}.`
  return 'Nothing stands out between good and bad nights yet.'
}
