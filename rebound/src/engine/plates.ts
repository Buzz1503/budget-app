export const DEFAULT_PLATES = [20, 15, 10, 5, 2.5, 1.25] as const

export interface PlateLoad {
  perSide: number[]
  /** Loaded weight the plates actually make (both sides). */
  loadedKg: number
  /** Target minus loaded; > 0 means it can't be made exactly. */
  shortByKg: number
}

/**
 * Plates per side for a leg press target. Weights in the app are loaded
 * plates only (not the sled), so the target is split evenly across sides.
 */
export function platesPerSide(targetKg: number, plates: readonly number[] = DEFAULT_PLATES): PlateLoad {
  const sorted = [...plates].sort((a, b) => b - a)
  let remaining = Math.max(0, targetKg) / 2
  const perSide: number[] = []
  for (const p of sorted) {
    while (remaining + 1e-9 >= p) {
      perSide.push(p)
      remaining -= p
    }
  }
  const loadedKg = Number((perSide.reduce((a, b) => a + b, 0) * 2).toFixed(2))
  return { perSide, loadedKg, shortByKg: Number((targetKg - loadedKg).toFixed(2)) }
}
