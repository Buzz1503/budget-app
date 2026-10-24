// Blood oxygen through one night, from Apple Watch's periodic readings. The
// Watch samples SpO2 every so often in the background, so a short dip between
// readings is missed: these numbers can only undercount.

export interface Spo2Night {
  readings: number
  lowest: number | null
  /** share of readings below 90%, % */
  pctBelow90: number | null
  /** readings 3 points or more below the night's own median */
  dips: number
  median: number | null
}

export const OXYGEN = { low: 90, dipPoints: 3 }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Lowest reading, the share below 90%, and dips of 3 points or more below the night's median. */
export function spo2Night(readings: Array<[number, number]> | null | undefined): Spo2Night {
  const v = (readings || []).map(([, p]) => p).filter((p) => Number.isFinite(p))
  if (!v.length) return { readings: 0, lowest: null, pctBelow90: null, dips: 0, median: null }
  const med = median(v)
  return {
    readings: v.length,
    lowest: Math.min(...v),
    pctBelow90: Math.round((v.filter((p) => p < OXYGEN.low).length / v.length) * 1000) / 10,
    dips: v.filter((p) => p <= med - OXYGEN.dipPoints).length,
    median: Math.round(med * 10) / 10,
  }
}
