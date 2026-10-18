// Small, dependable statistics. Every function ignores nothing silently: an
// empty input returns null, never 0.

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Median absolute deviation from the median. */
export function mad(xs: number[]): number | null {
  const m = median(xs)
  if (m == null) return null
  return median(xs.map((x) => Math.abs(x - m)))
}

/** Population standard deviation. */
export function sd(xs: number[]): number | null {
  const m = mean(xs)
  if (m == null) return null
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
}

/** Sample standard deviation (n - 1). */
export function sampleSd(xs: number[]): number | null {
  if (xs.length < 2) return null
  const m = mean(xs) as number
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const round = (v: number | null, dp = 0): number | null => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp)
