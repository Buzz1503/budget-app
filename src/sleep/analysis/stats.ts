// Statistics for the Sleep Lab, written out so every number can be checked:
// a seeded random generator (the same data always gives the same intervals),
// bootstrap confidence intervals, and ridge regression.

/** mulberry32: small, fast, seeded. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable seed from a string, so each comparison has its own repeatable resamples. */
export function seedOf(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export const mean = (xs: ArrayLike<number>) => {
  if (!xs.length) return NaN
  let s = 0
  for (let i = 0; i < xs.length; i++) s += xs[i]
  return s / xs.length
}

export function sd(xs: ArrayLike<number>): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (let i = 0; i < xs.length; i++) s += (xs[i] - m) ** 2
  return Math.sqrt(s / (xs.length - 1))
}

/** The q-quantile (0 to 1) of sorted values, linear between neighbours. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export interface CI { lo: number; hi: number }

export const BOOT = { resamples: 1000, ridgeResamples: 300, level: 0.95 }

/**
 * Difference in means (a minus b) with a percentile bootstrap 95% CI:
 * each group resampled with replacement, 1000 times, from a fixed seed.
 */
export function bootstrapDiff(a: number[], b: number[], seed: number, resamples = BOOT.resamples): { diff: number; ci: CI } {
  const diff = mean(a) - mean(b)
  const r = rng(seed)
  const out = new Float64Array(resamples)
  for (let k = 0; k < resamples; k++) {
    let sa = 0
    for (let i = 0; i < a.length; i++) sa += a[(r() * a.length) | 0]
    let sb = 0
    for (let i = 0; i < b.length; i++) sb += b[(r() * b.length) | 0]
    out[k] = sa / a.length - sb / b.length
  }
  out.sort()
  const tail = (1 - BOOT.level) / 2
  return { diff, ci: { lo: quantile(out, tail), hi: quantile(out, 1 - tail) } }
}

/** Mean of one group with a bootstrap 95% CI (for dose-response bins). */
export function bootstrapMean(a: number[], seed: number, resamples = BOOT.resamples): { mean: number; ci: CI } {
  const m = mean(a)
  const r = rng(seed)
  const out = new Float64Array(resamples)
  for (let k = 0; k < resamples; k++) {
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[(r() * a.length) | 0]
    out[k] = s / a.length
  }
  out.sort()
  const tail = (1 - BOOT.level) / 2
  return { mean: m, ci: { lo: quantile(out, tail), hi: quantile(out, 1 - tail) } }
}

export const excludesZero = (ci: CI) => (ci.lo > 0 && ci.hi > 0) || (ci.lo < 0 && ci.hi < 0)

// ------------------------------------------------------------------ ridge

/** Solve A x = b for a small symmetric positive definite A (Cholesky). Null if it is not. */
export function solveSPD(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const L = A.map(() => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      if (i === j) {
        if (s <= 1e-12) return null
        L[i][i] = Math.sqrt(s)
      } else {
        L[i][j] = s / L[j][j]
      }
    }
  }
  const y = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k]
    y[i] = s / L[i][i]
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]
    x[i] = s / L[i][i]
  }
  return x
}

export interface RidgeFit {
  /** effect of one unit of each column, in the outcome's units */
  coef: number[]
  intercept: number
}

/**
 * Ridge regression on standardised columns (so the penalty treats every
 * factor alike), returned in the original units. `lambda` is relative to the
 * number of rows.
 */
export function ridge(X: number[][], y: number[], lambda = 0.05): RidgeFit | null {
  const n = y.length
  const p = X[0]?.length ?? 0
  if (n < p + 2 || p === 0) return null
  const mu = new Array(p).fill(0)
  const sdv = new Array(p).fill(0)
  for (let j = 0; j < p; j++) {
    let s = 0
    for (let i = 0; i < n; i++) s += X[i][j]
    mu[j] = s / n
    let v = 0
    for (let i = 0; i < n; i++) v += (X[i][j] - mu[j]) ** 2
    sdv[j] = Math.sqrt(v / n) || 1
  }
  const ym = mean(y)
  const A = Array.from({ length: p }, () => new Array(p).fill(0))
  const b = new Array(p).fill(0)
  const z = new Array(p)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) z[j] = (X[i][j] - mu[j]) / sdv[j]
    const yi = y[i] - ym
    for (let j = 0; j < p; j++) {
      b[j] += z[j] * yi
      const zj = z[j]
      const row = A[j]
      for (let k = 0; k <= j; k++) row[k] += zj * z[k]
    }
  }
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < j; k++) A[k][j] = A[j][k]
    A[j][j] += lambda * n
  }
  const beta = solveSPD(A, b)
  if (!beta) return null
  const coef = beta.map((v, j) => v / sdv[j])
  const intercept = ym - coef.reduce((s, c, j) => s + c * mu[j], 0)
  return { coef, intercept }
}

/** Ridge coefficients with bootstrap 95% CIs (rows resampled, fixed seed). */
export function ridgeWithCI(X: number[][], y: number[], seed: number, { lambda = 0.05, resamples = BOOT.ridgeResamples } = {}) {
  const fit = ridge(X, y, lambda)
  if (!fit) return null
  const p = fit.coef.length
  const r = rng(seed)
  const draws: number[][] = Array.from({ length: p }, () => [])
  const n = y.length
  for (let k = 0; k < resamples; k++) {
    const Xs: number[][] = new Array(n)
    const ys: number[] = new Array(n)
    for (let i = 0; i < n; i++) {
      const j = (r() * n) | 0
      Xs[i] = X[j]
      ys[i] = y[j]
    }
    const f = ridge(Xs, ys, lambda)
    if (!f) continue
    for (let j = 0; j < p; j++) draws[j].push(f.coef[j])
  }
  const tail = (1 - BOOT.level) / 2
  return {
    ...fit,
    ci: draws.map((d) => {
      const s = Float64Array.from(d).sort()
      return { lo: quantile(s, tail), hi: quantile(s, 1 - tail) }
    }),
  }
}
