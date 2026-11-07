// "Check the numbers": each night's stage minutes before and after overlaps
// were resolved, so they can be held against Apple Health's own totals for
// the chosen source. Before is each stage summed on its own (how the app
// counted until schema 6); after is the one resolved timeline.

export interface StageMin { awake: number; rem: number; core: number; deep: number }
export interface CheckRow { date: string; source: string; before: StageMin | null; after: StageMin; overlapMin: number; fixed: boolean }

interface NightLike {
  date: string
  sourceName?: string
  awakeMin: number
  remMin: number
  coreMin: number
  deepMin: number
  fallback?: boolean
  check?: { raw: StageMin; overlapMin: number } | null
}

const r = (v: number) => Math.round(v)

/** The last `n` nights, newest first. */
export function stageCheck(nights: NightLike[], n = 7): CheckRow[] {
  return [...nights].sort((a, b) => b.date.localeCompare(a.date)).slice(0, n).map((x) => {
    const after = { awake: r(x.awakeMin), rem: r(x.remMin), core: r(x.coreMin), deep: r(x.deepMin) }
    const before = x.check?.raw ? { awake: r(x.check.raw.awake), rem: r(x.check.raw.rem), core: r(x.check.raw.core), deep: r(x.check.raw.deep) } : null
    const overlapMin = r(x.check?.overlapMin ?? 0)
    return { date: x.date, source: x.sourceName || '', before, after, overlapMin, fixed: overlapMin >= 1 }
  })
}

/** "7 h 05 m" style for the check table. */
export const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} m`
