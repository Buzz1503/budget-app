// The arithmetic behind Body › Composition. Pure: every function takes the
// readings it needs and today's date, and returns numbers and plain words.

import { familySeries, dailySeries, slopePerDay, FAMILY_FIELDS } from './bodySeries'
import type { BodyInput, DayPoint } from './bodySeries'
import { SCAN_METRICS, SEGMENTS } from './scanFields'

const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000)
const fromNum = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10)
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const longDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`

export interface ScanLike {
  id: string
  date: string
  time?: string | null
  source?: string | null
  device?: string | null
  estimated?: boolean
  hiddenFromCharts?: boolean
  [field: string]: unknown
}

const isEvolt = (m: ScanLike) => m.source === 'scan' && /evolt/i.test(String(m.device || ''))
const n = (m: ScanLike, k: string) => (typeof m[k] === 'number' ? (m[k] as number) : null)

/** Evolt scans that are real measurements (not estimated, not kept off the charts), oldest first. */
export function evoltScans(measurements: ScanLike[]): ScanLike[] {
  return measurements.filter((m) => isEvolt(m) && !m.estimated && !m.hiddenFromCharts)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')))
}

// ---------------------------------------------------------- what you have lost

export interface LossSplit {
  from: { date: string; weight: number; fat: number; lean: number; estimated: boolean }
  to: { date: string; weight: number; fat: number; lean: number }
  weight: number
  fat: number
  lean: number
  /** share of the weight change that was fat, 0 to 100, when weight, fat and lean all fell */
  fatShare: number | null
  lines: string[]
}

function splitWords(weight: number, fat: number, lean: number, since: string): string[] {
  const w = Math.abs(weight).toFixed(1)
  if (Math.abs(weight) < 0.05) return [`About the same weight as ${since}.`, `Fat ${fat > 0 ? 'up' : 'down'} ${Math.abs(fat).toFixed(1)} kg, lean ${lean > 0 ? 'up' : 'down'} ${Math.abs(lean).toFixed(1)} kg.`]
  const lines = [`${weight < 0 ? 'Down' : 'Up'} ${w} kg since ${since}.`]
  if (weight < 0 && fat <= 0 && lean <= 0) {
    lines.push(`${Math.abs(fat).toFixed(1)} kg fat, ${Math.abs(lean).toFixed(1)} kg lean.`)
    lines.push(`${Math.round((fat / weight) * 100)}% of the loss was fat.`)
  } else if (weight < 0 && fat < 0 && lean > 0) {
    lines.push(`${Math.abs(fat).toFixed(1)} kg less fat, and lean mass rose ${lean.toFixed(1)} kg.`)
  } else {
    lines.push(`Fat ${fat > 0 ? 'up' : 'down'} ${Math.abs(fat).toFixed(1)} kg, lean ${lean > 0 ? 'up' : 'down'} ${Math.abs(lean).toFixed(1)} kg.`)
  }
  return lines
}

/**
 * "What you have lost": the first Evolt scan on or after the starting date
 * against the latest Evolt scan, so both sides come from the same device.
 * With `from` given (the adjusted starting scan), that is used instead of
 * the first scan, and the result is an estimate.
 */
export function lossSplit(measurements: ScanLike[], startDate: string, from: ScanLike | null = null): LossSplit | null {
  const scans = evoltScans(measurements)
  const a = from || scans.find((s) => s.date >= startDate) || null
  const b = scans[scans.length - 1] || null
  if (!a || !b || a.id === b.id || b.date <= a.date) return null
  const [wa, fa, la] = [n(a, 'weight'), n(a, 'fatMass'), n(a, 'leanMass')]
  const [wb, fb, lb] = [n(b, 'weight'), n(b, 'fatMass'), n(b, 'leanMass')]
  if ([wa, fa, la, wb, fb, lb].some((v) => v == null)) return null
  const weight = r1((wb as number) - (wa as number))
  const fat = r1((fb as number) - (fa as number))
  const lean = r1((lb as number) - (la as number))
  return {
    from: { date: a.date, weight: wa as number, fat: fa as number, lean: la as number, estimated: !!a.estimated },
    to: { date: b.date, weight: wb as number, fat: fb as number, lean: lb as number },
    weight, fat, lean,
    fatShare: weight < 0 && fat <= 0 && lean <= 0 ? Math.round((fat / weight) * 100) : null,
    lines: splitWords(weight, fat, lean, longDate(a.date)),
  }
}

// ---------------------------------------------------------------- FFMI

/** Fat-free mass index: lean mass in kg over height in metres squared. */
export function ffmi(leanKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (leanKg == null || !heightCm || heightCm < 100) return null
  const m = heightCm / 100
  return r1(leanKg / (m * m))
}

/** Height for FFMI: the setting, else the latest scan's, else 170 cm. */
export function heightFor(setting: number | null | undefined, measurements: ScanLike[]): number {
  if (setting && setting >= 100) return setting
  const s = [...measurements].reverse().find((m) => typeof m.heightCm === 'number')
  return (s?.heightCm as number) || 170
}

// ------------------------------------------------------------- segmental

export interface SegmentChange {
  key: string
  label: string
  latest: number | null
  first: number | null
  delta: number | null
  /** good: lean up or fat down; bad: the opposite; neutral: under 0.1 kg either way */
  tone: 'good' | 'bad' | 'neutral'
}

export function segmentChanges(measurements: ScanLike[], kind: 'Lean' | 'Fat'): SegmentChange[] {
  const scans = evoltScans(measurements).filter((s) => SEGMENTS.some((g) => n(s, `${g.key}${kind}`) != null))
  const first = scans[0]
  const last = scans[scans.length - 1]
  return SEGMENTS.map((g) => {
    const k = `${g.key}${kind}`
    const latest = last ? n(last, k) : null
    const f = first ? n(first, k) : null
    const delta = latest != null && f != null && first !== last ? r2(latest - f) : null
    let tone: SegmentChange['tone'] = 'neutral'
    if (delta != null && Math.abs(delta) >= 0.1) tone = (kind === 'Lean' ? delta > 0 : delta < 0) ? 'good' : 'bad'
    return { key: g.key, label: g.label, latest, first: f, delta, tone }
  })
}

/** Left against right, as a percentage of their average (positive: left larger). */
export function symmetry(scan: ScanLike | null | undefined): { arms: { lean: number | null; fat: number | null }; legs: { lean: number | null; fat: number | null } } {
  const pct = (l: number | null, r: number | null) => (l == null || r == null || l + r === 0 ? null : r1(((l - r) / ((l + r) / 2)) * 100))
  const g = (k: string) => (scan ? n(scan, k) : null)
  return {
    arms: { lean: pct(g('leftArmLean'), g('rightArmLean')), fat: pct(g('leftArmFat'), g('rightArmFat')) },
    legs: { lean: pct(g('leftLegLean'), g('rightLegLean')), fat: pct(g('leftLegFat'), g('rightLegFat')) },
  }
}

// ---------------------------------------------------------------- compare

export interface CompareRow { key: string; label: string; unit: string; a: number; b: number; diff: number; pct: number; dp: number }

/** Every metric and segment both scans have, biggest relative change first. */
export function compareScans(a: ScanLike, b: ScanLike): CompareRow[] {
  const rows: CompareRow[] = []
  for (const m of SCAN_METRICS) {
    const va = n(a, m.key)
    const vb = n(b, m.key)
    if (va == null || vb == null) continue
    const diff = r2(vb - va)
    rows.push({ key: m.key, label: m.label, unit: m.unit, a: va, b: vb, diff, pct: va === 0 ? 0 : Math.abs(diff / va) * 100, dp: m.dp })
  }
  return rows.sort((x, y) => y.pct - x.pct || Math.abs(y.diff) - Math.abs(x.diff))
}

// ------------------------------------------------------------- projection

export interface Projection {
  status: 'toward' | 'away' | 'reached' | 'insufficient'
  /** change per week over the window */
  perWeek: number | null
  date: string | null
  words: string
}

/**
 * When the goal would be reached at the pace of the last 28 days (a least-
 * squares line through the readings). Always an estimate.
 */
export function projectGoal(series: Array<{ date: string; value: number }>, goal: number | null | undefined, today: string, { windowDays = 28, unit = 'kg', current: now = null }: { windowDays?: number; unit?: string; current?: number | null } = {}): Projection | null {
  if (goal == null || !Number.isFinite(goal)) return null
  const from = fromNum(dayNum(today) - (windowDays - 1))
  const win = series.filter((p) => p.date >= from && p.date <= today)
  if (win.length < 3) return { status: 'insufficient', perWeek: null, date: null, words: `Needs a few more readings in the last ${windowDays} days.` }
  const slope = slopePerDay(win) as number
  // where you are now is the headline reading when one is given; the pace is the trend over the window
  const current = now ?? win[win.length - 1].value
  const gap = goal - current
  const perWeek = r2(slope * 7)
  if (Math.abs(gap) < 0.05) return { status: 'reached', perWeek, date: null, words: 'At your goal.' }
  if (!slope || Math.sign(slope) !== Math.sign(gap)) return { status: 'away', perWeek, date: null, words: 'Not trending toward your goal at the moment.' }
  const days = Math.round(gap / slope)
  const date = fromNum(dayNum(today) + days)
  return { status: 'toward', perWeek, date, words: `At ${Math.abs(perWeek).toFixed(2)} ${unit} a week, around ${longDate(date)} (estimate).` }
}

// ----------------------------------------------------------- weekly change

export interface WeekBar {
  weekStart: string
  mean: number | null
  /** weigh-ins that week */
  count: number
  /** this week's mean against the week before, or null (a dash) when the week has under 2 weigh-ins or the week before has none */
  change: number | null
}

/**
 * The last `weeks` weeks (Monday to Sunday): each week's mean and its change
 * from the week before. A week needs at least 2 weigh-ins to draw a bar; the
 * week before only needs one reading to compare against.
 */
export function weeklyBars(series: Array<{ date: string; value: number }>, today: string, weeks = 12, minReadings = 2): WeekBar[] {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
  const thisMonday = dayNum(today) - dow
  const starts = Array.from({ length: weeks + 1 }, (_, i) => thisMonday - (weeks - i) * 7)
  const stats = starts.map((s) => {
    const pts = series.filter((p) => dayNum(p.date) >= s && dayNum(p.date) < s + 7)
    return { count: pts.length, mean: pts.length ? pts.reduce((a, p) => a + p.value, 0) / pts.length : null }
  })
  return starts.slice(1).map((s, i) => {
    const cur = stats[i + 1]
    const prev = stats[i]
    return {
      weekStart: fromNum(s),
      mean: cur.mean == null ? null : r2(cur.mean),
      count: cur.count,
      change: cur.count >= minReadings && cur.mean != null && prev.mean != null ? r2(cur.mean - prev.mean) : null,
    }
  })
}

// ------------------------------------------------------------ helpers

/** The series a tile or row reads: one family for body fat, fat and lean mass, merged otherwise. */
export function seriesForMetric(field: string, input: BodyInput, family: string | null): DayPoint[] {
  return FAMILY_FIELDS.has(field) && family ? familySeries(field, input, family) : dailySeries(field, input)
}

/** The latest scan's status and reference range for a field, as printed on it. */
export function latestScanMeta(measurements: ScanLike[], field: string): { status: string | null; range: [number, number] | null; date: string | null } {
  const s = [...evoltScans(measurements)].reverse().find((m) => typeof m[field] === 'number')
  if (!s) return { status: null, range: null, date: null }
  const status = ((s.status || {}) as Record<string, string>)[field] || null
  const range = ((s.ranges || {}) as Record<string, [number, number]>)[field] || null
  return { status, range, date: s.date }
}

// ------------------------------------------------- the two boxes at the top

export type Tone = 'good' | 'bad' | 'flat'
export interface StoryLine { key: string; text: string; tone: Tone }

const shortDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`
const toneOf = (delta: number, better: 'down' | 'up'): Tone => (Math.abs(delta) < 0.05 ? 'flat' : (better === 'down' ? delta < 0 : delta > 0) ? 'good' : 'bad')
const f1 = (v: number) => v.toFixed(1)

/** "Fat mass down 0.9 kg (26.9 to 26.0)" */
function changeSince(key: string, label: string, a: number | null, b: number | null, better: 'down' | 'up'): StoryLine | null {
  if (a == null || b == null) return null
  const d = r1(b - a)
  if (Math.abs(d) < 0.05) return { key, text: `${label} unchanged at ${f1(b)} kg`, tone: 'flat' }
  return { key, text: `${label} ${d < 0 ? 'down' : 'up'} ${f1(Math.abs(d))} kg (${f1(a)} to ${f1(b)})`, tone: toneOf(d, better) }
}

/** "Body fat mass down from 40.4 to 26.0 kg" */
function changeFrom(key: string, label: string, a: number | null, b: number | null, better: 'down' | 'up'): StoryLine | null {
  if (a == null || b == null) return null
  const d = r1(b - a)
  if (Math.abs(d) < 0.05) return { key, text: `${label} unchanged at ${f1(b)} kg`, tone: 'flat' }
  return { key, text: `${label} ${d < 0 ? 'down' : 'up'} from ${f1(a)} to ${f1(b)} kg`, tone: toneOf(d, better) }
}

/** "Body fat 28.1%, was 28.9%" */
function bodyFatLine(a: number | null, b: number | null): StoryLine | null {
  if (a == null || b == null) return null
  return { key: 'bodyFat', text: `Body fat ${f1(b)}%, was ${f1(a)}%`, tone: toneOf(b - a, 'down') }
}

export interface ScanStory {
  latest: { date: string; weight: number; device: string }
  previous: { date: string; weight: number | null } | null
  /** "Down 1.2 kg since 16 Oct", null with a single scan */
  change: StoryLine | null
  lines: StoryLine[]
}

/**
 * Box 1: the latest Evolt scan's weight, and what changed since the scan before it.
 * Weight and body composition from the same device on the same day.
 */
export function lastScanStory(measurements: ScanLike[]): ScanStory | null {
  const scans = evoltScans(measurements).filter((s) => n(s, 'weight') != null)
  const last = scans[scans.length - 1]
  if (!last) return null
  const prev = scans.length > 1 ? scans[scans.length - 2] : null
  const latest = { date: last.date, weight: n(last, 'weight') as number, device: String(last.device || 'Evolt') }
  if (!prev) return { latest, previous: null, change: null, lines: [] }
  const w0 = n(prev, 'weight') as number
  const dw = r1(latest.weight - w0)
  const change: StoryLine = Math.abs(dw) < 0.05
    ? { key: 'weight', text: `No change since ${shortDay(prev.date)}`, tone: 'flat' }
    : { key: 'weight', text: `${dw < 0 ? 'Down' : 'Up'} ${f1(Math.abs(dw))} kg since ${shortDay(prev.date)}`, tone: toneOf(dw, 'down') }
  const lines = [
    changeSince('fatMass', 'Fat mass', n(prev, 'fatMass'), n(last, 'fatMass'), 'down'),
    changeSince('skeletalMuscleMass', 'Skeletal muscle', n(prev, 'skeletalMuscleMass'), n(last, 'skeletalMuscleMass'), 'up'),
    bodyFatLine(n(prev, 'bodyFat'), n(last, 'bodyFat')),
  ].filter(Boolean) as StoryLine[]
  return { latest, previous: { date: prev.date, weight: w0 }, change, lines }
}

export interface StartStory { lead: StoryLine; lines: StoryLine[]; estimated: boolean; startWeight: number; startDate: string }

/**
 * Box 2: since the starting point, against the latest Evolt scan. The start's own values
 * when it has them (the estimated 1 Jan 2025 entry does), else the first Evolt scan from then.
 */
export function sinceStartStory(measurements: ScanLike[], start: { date: string; values?: Record<string, number | null | undefined>; entryId?: string | null } | null): StartStory | null {
  if (!start) return null
  const scans = evoltScans(measurements)
  const last = [...scans].reverse().find((s) => n(s, 'weight') != null)
  if (!last) return null
  const entry = start.entryId ? measurements.find((m) => m.id === start.entryId) || null : null
  const first = scans.find((s) => s.date >= start.date) || null
  const v = (k: string): number | null => {
    const own = start.values?.[k]
    if (typeof own === 'number') return own
    if (entry && n(entry, k) != null) return n(entry, k)
    return first && first !== last ? n(first, k) : null
  }
  const w0 = v('weight')
  const w1 = n(last, 'weight') as number
  if (w0 == null) return null
  const d = r1(w1 - w0)
  const lead: StoryLine = {
    key: 'weight',
    text: `${Math.abs(d) < 0.05 ? 'No change' : `${d < 0 ? 'Down' : 'Up'} ${f1(Math.abs(d))} kg`} since ${longDate(start.date)} (${f1(w0)} to ${f1(w1)} kg)`,
    tone: toneOf(d, 'down'),
  }
  const lines = [
    changeFrom('fatMass', 'Body fat mass', v('fatMass'), n(last, 'fatMass'), 'down'),
    changeFrom('skeletalMuscleMass', 'Skeletal muscle', v('skeletalMuscleMass'), n(last, 'skeletalMuscleMass'), 'up'),
    bodyFatLine(v('bodyFat'), n(last, 'bodyFat')),
    changeFrom('leanMass', 'Lean mass', v('leanMass'), n(last, 'leanMass'), 'up'),
  ].filter(Boolean) as StoryLine[]
  const estimated = !!(entry?.estimated)
  return { lead, lines, estimated, startWeight: w0, startDate: start.date }
}

export interface ScanStep { date: string; fat: number | null; lean: number | null }

/** Scan to scan: fat mass and lean mass change since the scan before, per Evolt scan (the estimated start left out). */
export function scanToScan(measurements: ScanLike[]): ScanStep[] {
  const scans = evoltScans(measurements)
  const out: ScanStep[] = []
  for (let i = 1; i < scans.length; i++) {
    const a = scans[i - 1]
    const b = scans[i]
    const fa = n(a, 'fatMass')
    const fb = n(b, 'fatMass')
    const la = n(a, 'leanMass')
    const lb = n(b, 'leanMass')
    out.push({ date: b.date, fat: fa != null && fb != null ? r1(fb - fa) : null, lean: la != null && lb != null ? r1(lb - la) : null })
  }
  return out
}
