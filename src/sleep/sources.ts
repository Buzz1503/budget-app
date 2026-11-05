// The sleep source picker. Only sources Apple Health actually returned are
// listed: each night carries every source that wrote a main sleep that date
// (`SleepNight.sources`), so nothing here assumes any app writes to Health.

export interface NightSourcesLike {
  date: string
  sources?: Array<{ name: string; cls: string; stages: string[] }>
}

export interface SourceRow {
  name: string
  cls: string
  /** nights in the window this source wrote a main sleep for */
  nights: number
  /** stages it gave on any of those nights */
  stages: string[]
}

const STAGE_ORDER = ['awake', 'rem', 'core', 'deep', 'asleep']

/** Every source with sleep in the last `days` days (up to `today`), most nights first. */
export function sourceRows(nights: NightSourcesLike[], today: string, days = 30): SourceRow[] {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10)
  const by = new Map<string, SourceRow & { st: Set<string> }>()
  for (const n of nights) {
    if (n.date < from || n.date > today) continue
    for (const s of n.sources || []) {
      const row = by.get(s.name) || { name: s.name, cls: s.cls, nights: 0, stages: [], st: new Set<string>() }
      row.nights++
      for (const x of s.stages) row.st.add(x)
      by.set(s.name, row)
    }
  }
  return [...by.values()]
    .map(({ st, ...r }) => ({ ...r, stages: STAGE_ORDER.filter((x) => st.has(x)) }))
    .sort((a, b) => b.nights - a.nights || a.name.localeCompare(b.name))
}

const STAGE_WORDS: Record<string, string> = { awake: 'Awake', rem: 'REM', core: 'Core', deep: 'Deep', asleep: 'Asleep' }

/** "Awake, REM, Core, Deep" or "Asleep only" for the picker. */
export function stagesWords(stages: string[]): string {
  const staged = stages.filter((s) => s !== 'asleep')
  if (!staged.some((s) => s !== 'awake')) return stages.includes('asleep') ? 'Asleep and awake only, no stages' : 'No stage detail'
  return staged.map((s) => STAGE_WORDS[s]).join(', ')
}

/** Nights that count for baselines and the Sleep Lab: the chosen source only. */
export const countsForBaselines = (n: { fallback?: boolean } | null | undefined) => !!n && !n.fallback

export const OTHER_SOURCE_LABEL = 'Other source'
