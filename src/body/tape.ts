// Tape measurements: girths you log by hand, kept on the measurement entries
// (`measurements`, one field per site, e.g. { date, waist: 98.4, armL: 38.1 }).
// Pure: the Measurements area, its log sheet, the compare and the reminder
// all ask here. Nothing is ever rewritten or dropped; an entry with a value
// for a site is part of that site's history.

export type Better = 'up' | 'down'

export interface TapeSite {
  key: string
  label: string
  /** the name on the body diagram and in short rows */
  short: string
  /** both sides of one site, e.g. arm for armL and armR */
  pair?: string
  side?: 'L' | 'R'
  better: Better
  /** recorded before left and right were split; shown, never logged again */
  legacy?: boolean
}

/**
 * Bigger is better for arms, forearms, chest and calves; smaller for waist,
 * hips, neck and thighs. Each can be turned round in the settings.
 */
export const TAPE_SITES: TapeSite[] = [
  { key: 'neck', label: 'Neck', short: 'Neck', better: 'down' },
  { key: 'chest', label: 'Chest', short: 'Chest', better: 'up' },
  { key: 'waist', label: 'Waist', short: 'Waist', better: 'down' },
  { key: 'hips', label: 'Hips', short: 'Hips', better: 'down' },
  { key: 'armL', label: 'Upper arm, left', short: 'L arm', pair: 'arm', side: 'L', better: 'up' },
  { key: 'armR', label: 'Upper arm, right', short: 'R arm', pair: 'arm', side: 'R', better: 'up' },
  { key: 'forearmL', label: 'Forearm, left', short: 'L forearm', pair: 'forearm', side: 'L', better: 'up' },
  { key: 'forearmR', label: 'Forearm, right', short: 'R forearm', pair: 'forearm', side: 'R', better: 'up' },
  { key: 'thighL', label: 'Thigh, left', short: 'L thigh', pair: 'thigh', side: 'L', better: 'down' },
  { key: 'thighR', label: 'Thigh, right', short: 'R thigh', pair: 'thigh', side: 'R', better: 'down' },
  { key: 'calfL', label: 'Calf, left', short: 'L calf', pair: 'calf', side: 'L', better: 'up' },
  { key: 'calfR', label: 'Calf, right', short: 'R calf', pair: 'calf', side: 'R', better: 'up' },
  { key: 'arms', label: 'Arms (before left and right)', short: 'Arms', better: 'up', legacy: true },
  { key: 'thighs', label: 'Thighs (before left and right)', short: 'Thighs', better: 'down', legacy: true },
]
export const TAPE_SITE_BY_KEY: Record<string, TapeSite> = Object.fromEntries(TAPE_SITES.map((s) => [s.key, s]))
export const PAIRS: Record<string, { label: string; L: string; R: string }> = {
  arm: { label: 'Upper arms', L: 'armL', R: 'armR' },
  forearm: { label: 'Forearms', L: 'forearmL', R: 'forearmR' },
  thigh: { label: 'Thighs', L: 'thighL', R: 'thighR' },
  calf: { label: 'Calves', L: 'calfL', R: 'calfR' },
}
/** Sites a fresh install shows in the log sheet before anything is logged. */
export const DEFAULT_SITES = ['waist', 'hips', 'chest', 'armL', 'armR', 'thighL', 'thighR']
export const TAPE_TIP = 'Measure first thing in the morning, same spot, tape snug not tight.'
export const REMINDER_DAYS = 14

export interface TapeSettings {
  /** sites shown in the log sheet and the diagram; null until changed */
  sites?: string[] | null
  /** better direction turned round, per site */
  better?: Record<string, Better>
  /** every 2 weeks, through the app's notifications */
  reminder?: boolean
}

export interface Entry { id?: string; date: string; hiddenFromCharts?: boolean; [k: string]: unknown }
export interface Point { date: string; value: number }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
const r1 = (v: number) => Math.round(v * 10) / 10

/** The better way for a site, with any setting applied. */
export const betterFor = (key: string, settings?: TapeSettings | null): Better =>
  settings?.better?.[key] || TAPE_SITE_BY_KEY[key]?.better || 'down'

/**
 * One value per date for a site, oldest first. Two entries on one day: the
 * later one in the list wins (it was typed after). Every entry counts, also
 * those hidden from the body charts: they are tape too.
 */
export function siteSeries(measurements: Entry[], key: string): Point[] {
  const by = new Map<string, number>()
  for (const m of measurements) {
    const v = num(m[key])
    if (v != null && m.date) by.set(m.date, v)
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }))
}

/** How many entries have a value for each site (raw entries, not days). */
export function siteCounts(measurements: Entry[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of TAPE_SITES) {
    const n = measurements.filter((m) => num(m[s.key]) != null).length
    if (n) out[s.key] = n
  }
  return out
}

/** Sites with at least one value, in the order of TAPE_SITES. */
export const measuredSites = (measurements: Entry[]): string[] => TAPE_SITES.filter((s) => siteSeries(measurements, s.key).length).map((s) => s.key)

/** Every date with any tape value, oldest first. */
export function tapeDates(measurements: Entry[]): string[] {
  const set = new Set<string>()
  for (const m of measurements) if (TAPE_SITES.some((s) => num(m[s.key]) != null)) set.add(m.date)
  return [...set].sort()
}

export interface SiteRow {
  key: string
  site: TapeSite
  latest: Point
  previous: Point | null
  first: Point
  sinceLast: number | null
  sinceFirst: number | null
  better: Better
  series: Point[]
  /** 'better' | 'worse' | 'same' for the change since last */
  tone: 'better' | 'worse' | 'same'
}

export const toneOf = (delta: number | null, better: Better): 'better' | 'worse' | 'same' =>
  delta == null || Math.abs(delta) < 0.05 ? 'same' : (delta > 0) === (better === 'up') ? 'better' : 'worse'

/** One row per measured site: latest, change since last and since first. */
export function siteRows(measurements: Entry[], settings?: TapeSettings | null): SiteRow[] {
  const out: SiteRow[] = []
  for (const site of TAPE_SITES) {
    const series = siteSeries(measurements, site.key)
    if (!series.length) continue
    const latest = series[series.length - 1]
    const previous = series.length > 1 ? series[series.length - 2] : null
    const first = series[0]
    const better = betterFor(site.key, settings)
    const sinceLast = previous ? r1(latest.value - previous.value) : null
    out.push({
      key: site.key, site, latest, previous, first, series, better,
      sinceLast, sinceFirst: series.length > 1 ? r1(latest.value - first.value) : null,
      tone: toneOf(sinceLast, better),
    })
  }
  return out
}

/**
 * The answer line: every girth's change since its own first entry, added up
 * ("Down 14.2 cm in total since 1 Jan 2025"), and since last time: each site
 * measured on the latest day against its own value before. The old combined
 * arms and thighs are left out of the total, so a site is never counted twice.
 */
export function totalChange(measurements: Entry[]): { total: number; since: string; sites: number; lastTime: number | null; lastDate: string | null; prevDate: string | null } | null {
  let total = 0
  let sites = 0
  let since: string | null = null
  for (const site of TAPE_SITES) {
    if (site.legacy) continue
    const s = siteSeries(measurements, site.key)
    if (s.length < 2) continue
    total += s[s.length - 1].value - s[0].value
    sites++
    if (!since || s[0].date < since) since = s[0].date
  }
  if (!sites || !since) return null
  const dates = tapeDates(measurements)
  const lastDate = dates[dates.length - 1] || null
  let lastTime: number | null = null
  let prevDate: string | null = null
  if (lastDate) {
    let sum = 0
    let n = 0
    for (const site of TAPE_SITES) {
      if (site.legacy) continue
      const s = siteSeries(measurements, site.key)
      const i = s.findIndex((p) => p.date === lastDate)
      if (i < 1) continue
      sum += s[i].value - s[i - 1].value
      n++
      if (!prevDate || s[i - 1].date > prevDate) prevDate = s[i - 1].date
    }
    lastTime = n ? r1(sum) : null
  }
  return { total: r1(total), since, sites, lastTime, lastDate, prevDate }
}

/** "Down 14.2 cm", "Up 0.4 cm", "No change" */
export function changeWords(delta: number | null): string {
  if (delta == null) return ''
  if (Math.abs(delta) < 0.05) return 'No change'
  return `${delta < 0 ? 'Down' : 'Up'} ${Math.abs(delta).toFixed(1)} cm`
}

// ------------------------------------------------------------------ compare

export interface CompareRow { key: string; site: TapeSite; before: number | null; after: number | null; change: number | null; tone: 'better' | 'worse' | 'same' }

/** The value for a site on one date, or null (a dash). */
export const valueOn = (measurements: Entry[], key: string, date: string): number | null =>
  siteSeries(measurements, key).find((p) => p.date === date)?.value ?? null

/** Every measured site on two dates side by side; a site missing on either date has no change. */
export function compareDates(measurements: Entry[], a: string, b: string, settings?: TapeSettings | null): CompareRow[] {
  return measuredSites(measurements).map((key) => {
    const before = valueOn(measurements, key, a)
    const after = valueOn(measurements, key, b)
    const change = before != null && after != null ? r1(after - before) : null
    return { key, site: TAPE_SITE_BY_KEY[key], before, after, change, tone: toneOf(change, betterFor(key, settings)) }
  }).filter((r) => r.before != null || r.after != null)
}

/** The quick choices: latest against the one before, and against the first. */
export function quickPairs(measurements: Entry[]): { latestVsPrevious: [string, string] | null; latestVsFirst: [string, string] | null } {
  const d = tapeDates(measurements)
  if (d.length < 2) return { latestVsPrevious: null, latestVsFirst: null }
  return { latestVsPrevious: [d[d.length - 2], d[d.length - 1]], latestVsFirst: [d[0], d[d.length - 1]] }
}

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400000

/** The item nearest a date (ties to the earlier one), with how many days away it is. */
export function nearestByDate<T extends { date: string }>(items: T[], date: string): { item: T; days: number } | null {
  let best: { item: T; days: number } | null = null
  for (const it of items) {
    const days = Math.round(Math.abs(dayNum(it.date) - dayNum(date)))
    if (!best || days < best.days || (days === best.days && it.date < best.item.date)) best = { item: it, days }
  }
  return best
}

// ------------------------------------------------------------------- ratios

export interface Ratio { key: string; label: string; value: string; meaning: string; date: string | null }

const latestOf = (measurements: Entry[], key: string) => siteSeries(measurements, key).at(-1) || null

/** The latest date both sites were measured on, with both values. */
function latestTogether(measurements: Entry[], a: string, b: string): { date: string; a: number; b: number } | null {
  const sa = siteSeries(measurements, a)
  const bBy = new Map(siteSeries(measurements, b).map((p) => [p.date, p.value]))
  for (let i = sa.length - 1; i >= 0; i--) {
    const v = bBy.get(sa[i].date)
    if (v != null) return { date: sa[i].date, a: sa[i].value, b: v }
  }
  return null
}

/**
 * Waist to height, waist to hip (when hips are logged), and the left and
 * right difference for paired sites measured on the same day. Each is a plain
 * description of the numbers, never a judgement.
 */
export function ratios(measurements: Entry[], heightCm: number | null): Ratio[] {
  const out: Ratio[] = []
  const waist = latestOf(measurements, 'waist')
  if (waist && heightCm && heightCm >= 100) {
    const v = waist.value / heightCm
    out.push({ key: 'waistHeight', label: 'Waist to height', value: v.toFixed(2), date: waist.date,
      meaning: `Your waist is ${Math.round(v * 100)}% of your height (${heightCm} cm). Lower means a smaller waist for your height.` })
  }
  const wh = latestTogether(measurements, 'waist', 'hips')
  if (wh) {
    const v = wh.a / wh.b
    out.push({ key: 'waistHip', label: 'Waist to hip', value: v.toFixed(2), date: wh.date,
      meaning: `Waist ${wh.a} cm against hips ${wh.b} cm, measured on the same day. Lower means a narrower waist than hips.` })
  }
  for (const [pair, p] of Object.entries(PAIRS)) {
    const lr = latestTogether(measurements, p.L, p.R)
    if (!lr) continue
    const diff = r1(lr.b - lr.a)
    const pct = Math.round((Math.abs(diff) / Math.max(lr.a, lr.b)) * 1000) / 10
    out.push({ key: `lr-${pair}`, label: `${p.label}, left and right`, date: lr.date,
      value: Math.abs(diff) < 0.05 ? 'Even' : `${Math.abs(diff).toFixed(1)} cm`,
      meaning: Math.abs(diff) < 0.05 ? `Left ${lr.a} cm and right ${lr.b} cm are the same.` : `${diff > 0 ? 'Right' : 'Left'} is ${Math.abs(diff).toFixed(1)} cm bigger (${pct}%): left ${lr.a} cm, right ${lr.b} cm.` })
  }
  return out
}

// ---------------------------------------------------------------- log sheet

/** The sites the log sheet shows: chosen ones, else every measured site plus the defaults, in a fixed order. */
export function sheetSites(measurements: Entry[], settings?: TapeSettings | null): string[] {
  const live = TAPE_SITES.filter((s) => !s.legacy).map((s) => s.key)
  if (settings?.sites?.length) return live.filter((k) => settings.sites!.includes(k))
  const want = new Set([...DEFAULT_SITES, ...measuredSites(measurements)])
  return live.filter((k) => want.has(k))
}

/** Each site's starting value in the sheet: its last value, else empty. */
export function prefill(measurements: Entry[], sites: string[]): Record<string, number | null> {
  return Object.fromEntries(sites.map((k) => [k, latestOf(measurements, k)?.value ?? null]))
}

/**
 * The fields to save: only sites that were touched and have a sensible
 * value. Untouched sites are not saved again as new entries.
 */
export function entryFromSheet(values: Record<string, number | null | string>, touched: Set<string> | string[]): Record<string, number> {
  const t = touched instanceof Set ? touched : new Set(touched)
  const out: Record<string, number> = {}
  for (const k of t) {
    const v = typeof values[k] === 'string' ? Number(String(values[k]).replace(',', '.')) : values[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 10 && v <= 250 && TAPE_SITE_BY_KEY[k] && !TAPE_SITE_BY_KEY[k].legacy) out[k] = r1(v)
  }
  return out
}

/** A 0.1 cm step, kept to one decimal. */
export const stepValue = (v: number | null, by: number, fallback = 50) => r1(Math.max(10, (v ?? fallback) + by))

// ----------------------------------------------------------------- reminder

/** The day the next tape reminder is due: 14 days after the last tape entry, or today when never measured. */
export function nextReminder(measurements: Entry[], today: string, days = REMINDER_DAYS): string {
  const last = tapeDates(measurements).at(-1)
  if (!last) return today
  const d = new Date(Date.parse(`${last}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
  return d < today ? today : d
}
