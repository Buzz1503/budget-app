/** Round a load to the nearest multiple of the machine increment. */
export function roundToIncrement(weightKg: number, increment: number): number {
  if (increment <= 0) return weightKg
  const r = Math.round(weightKg / increment) * increment
  return Math.max(0, Number(r.toFixed(3)))
}

/** Apply a percentage change and round to the increment. */
export function adjustByPct(weightKg: number, pct: number, increment: number): number {
  return roundToIncrement(weightKg * (1 + pct / 100), increment)
}

/** Estimated one-rep max (Epley). Used for strength-over-time charts. */
export function estimatedOneRepMax(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0
  if (reps === 1) return weightKg
  return Number((weightKg * (1 + reps / 30)).toFixed(1))
}

/** "57.5 kg", "60 kg". */
export function formatKg(weightKg: number): string {
  return `${Number(weightKg.toFixed(2))} kg`
}
