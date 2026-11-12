// Resting and sleeping heart rate, by compound and dose. Pure: the screens
// pass nights, days, compound timelines and logs in.
//
//  - A night's heart rate is read in 5-minute averages, so one stray reading
//    is not the night's lowest or highest. Highest leaves out minutes marked
//    Awake (the awake peak is kept on its own).
//  - Periods: before the first GLP-1 class compound, then each compound at
//    each dose level. Everything is set against the good sleep reference:
//    by default the 8 weeks before the first Retatrutide dose.
//  - Association only. Nothing here says a compound caused a change, and no
//    dose of one compound is ever set equal to a dose of another.

const MIN = 60000
const DAY = 86400000

export const HEART = {
  binMin: 5,
  typicalDip: [10, 20] as const,
  refWeeks: 8,
  beforeDays: 182,
  z: 1.96,
  minNights: 7,
  doseBinMin: 6,
  adjustedFrom: 60,
  changeBefore: 14,
  changeAfter: 14,
  settleFrom: 15,
  settleTo: 42,
  switchGapDays: 14,
  switchEarlyNights: 21,
  oldWeeks: 4,
  transitionDays: 14,
  transitionOptions: [0, 7, 14, 21],
  trendRun: 3,
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const r1 = (v: number) => Math.round(v * 10) / 10

// ---------------------------------------------------------- one night

export interface Seg { start: number; end: number; stage: string }
export interface Bin { t: number; bpm: number; awake: boolean }
export interface NightHeart {
  avg: number
  low: { bpm: number; t: number }
  high: { bpm: number; t: number } | null
  awakePeak: { bpm: number; t: number } | null
  /** minutes from falling asleep to the lowest 5-minute average */
  timeToLowMin: number | null
  /** sleeping average below the daytime average, in %, or null without a daytime average */
  dipPct: number | null
  bins: number
}

const stageAt = (segs: Seg[] | undefined, t: number) => (segs || []).find((s) => s.start <= t && s.end > t)?.stage ?? null

/**
 * Heart rate through the night in 5-minute averages: each bin is the mean of
 * the readings in it, timed at its middle and marked awake when the stage at
 * that moment is Awake. `hr` is [minutes from `start`, bpm].
 */
export function fiveMinBins(hr: Array<[number, number]> | undefined, start: number, segs?: Seg[], binMin = HEART.binMin): Bin[] {
  const by = new Map<number, number[]>()
  for (const [m, b] of hr || []) {
    if (!(b > 25)) continue
    const k = Math.floor(m / binMin)
    if (!by.has(k)) by.set(k, [])
    by.get(k)!.push(b)
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => {
    const t = start + (k * binMin + binMin / 2) * MIN
    return { t, bpm: Math.round(mean(v)! * 10) / 10, awake: stageAt(segs, t) === 'awake' }
  })
}

/** The night's heart rate: average, lowest and highest asleep (5-minute averages), awake peak, time to lowest, dip. */
export function nightHeart(night: { start: number; end: number; segments?: Seg[] }, hr: Array<[number, number]> | undefined, daytimeAvg: number | null | undefined): NightHeart | null {
  const bins = fiveMinBins(hr, night.start, night.segments).filter((b) => b.t >= night.start && b.t <= night.end)
  const asleep = bins.filter((b) => !b.awake)
  if (!asleep.length) return null
  const low = asleep.reduce((a, b) => (b.bpm < a.bpm ? b : a))
  const high = asleep.reduce((a, b) => (b.bpm > a.bpm ? b : a))
  const awake = bins.filter((b) => b.awake)
  const awakePeak = awake.length ? awake.reduce((a, b) => (b.bpm > a.bpm ? b : a)) : null
  const onset = (night.segments || []).filter((s) => s.stage !== 'awake').sort((a, b) => a.start - b.start)[0]?.start ?? night.start
  const avg = r1(mean(asleep.map((b) => b.bpm))!)
  return {
    avg,
    low: { bpm: Math.round(low.bpm), t: low.t },
    high: asleep.length > 1 ? { bpm: Math.round(high.bpm), t: high.t } : null,
    awakePeak: awakePeak ? { bpm: Math.round(awakePeak.bpm), t: awakePeak.t } : null,
    timeToLowMin: Math.max(0, Math.round((low.t - onset) / MIN)),
    dipPct: overnightDip(avg, daytimeAvg),
    bins: bins.length,
  }
}

/** Sleeping heart rate below the daytime average, in %. */
export function overnightDip(sleepAvg: number | null | undefined, dayAvg: number | null | undefined): number | null {
  if (sleepAvg == null || !dayAvg) return null
  return r1(((dayAvg - sleepAvg) / dayAvg) * 100)
}

/** "A late low can mean the body took longer to settle." */
export function timeToLowWords(min: number | null): string | null {
  if (min == null) return null
  const h = Math.floor(min / 60)
  const m = min % 60
  const t = h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} min`
  return `Lowest ${t} after falling asleep. A later low can mean your body took longer to settle.`
}

// ----------------------------------------------------- summary sentence

export interface Part { text: string; tone?: 'better' | 'worse' }

/**
 * Last night's heart rate in two or three plain sentences: the numbers, the
 * dip against the typical 10 to 20%, the good sleep reference, and a run of
 * nights rising or falling. Only the key words carry colour.
 */
export function heartSummary(o: {
  heart: NightHeart; clock: (ms: number) => string; refAvg: number | null; recentAvgs: number[]
}): Part[] {
  const { heart: h } = o
  const out: Part[] = [{ text: `Heart rate asleep: average ${Math.round(h.avg)}, lowest ${h.low.bpm} at ${o.clock(h.low.t)}${h.high ? `, highest ${h.high.bpm}` : ''}. ` }]
  if (h.dipPct != null) {
    const [lo, hi] = HEART.typicalDip
    const d = Math.round(h.dipPct)
    if (d >= lo && d <= hi) {
      out.push({ text: `It dropped ${d}% below your daytime average. A ${lo} to ${hi}% drop while asleep is typical for adults, so yours is ` }, { text: 'in that range', tone: 'better' }, { text: '. ' })
    } else if (d < lo) {
      out.push({ text: `It dropped ${Math.max(0, d)}% below your daytime average, ` }, { text: `a smaller drop than the typical ${lo} to ${hi}%`, tone: 'worse' }, { text: '. ' })
    } else {
      out.push({ text: `It dropped ${d}% below your daytime average, more than the typical ${lo} to ${hi}%. ` })
    }
  }
  if (o.refAvg != null) {
    const diff = Math.round(h.avg - o.refAvg)
    if (Math.abs(diff) < 2) out.push({ text: 'About the same as your good sleep period', tone: 'better' }, { text: '. ' })
    else out.push({ text: "That's " }, { text: `${Math.abs(diff)} ${diff > 0 ? 'above' : 'below'} your good sleep period`, tone: diff > 0 ? 'worse' : 'better' }, { text: '. ' })
  }
  const run = trendRun(o.recentAvgs)
  if (Math.abs(run) >= HEART.trendRun) out.push({ text: `${run > 0 ? 'Rising' : 'Falling'} for ${Math.abs(run)} nights`, tone: run > 0 ? 'worse' : 'better' }, { text: '.' })
  return out
}

/** Nights in a row that rose (positive) or fell (negative) against the night before, ending with the latest; oldest first in. */
export function trendRun(values: number[]): number {
  if (values.length < 2) return 0
  const up = values[values.length - 1] > values[values.length - 2]
  let n = 0
  for (let i = values.length - 1; i > 0; i--) {
    const d = values[i] - values[i - 1]
    if (d === 0 || (d > 0) !== up) break
    n++
  }
  return n === 0 ? 0 : up ? n : -n
}

// ------------------------------------------------------------ periods

export interface TimelinePoint { date: string; kind: string; to?: number | null; unit?: string | null }
export interface CompoundTL { id: string; name: string; libraryId?: string | null; frequency?: string | null; points: TimelinePoint[] }
export interface DoseSegment { compoundId: string; name: string; dose: number | null; unit: string | null; from: string; to: string }

const DOSE_KINDS = new Set(['start', 'restart', 'prior', 'step-up', 'override', 'hold', 'cycle-reset'])
const fmtDose = (d: number | null, u: string | null) => (d == null ? '' : `${Number.isInteger(d) ? d : Math.round(d * 100) / 100}${u ? ` ${u}` : ''}`)
export const GLP1 = /(semaglutide|tirzepatide|retatrutide|survodutide|mazdutide|cagrilintide|ozempic|wegovy|mounjaro|zepbound|\breta\b|\btirz)/i
export const isGlp1 = (c: { id: string; name: string; libraryId?: string | null }) => GLP1.test(`${c.id} ${c.name} ${c.libraryId || ''}`)
export const isReta = (c: { id: string; name: string; libraryId?: string | null }) => /retatrutide|\breta\b/i.test(`${c.id} ${c.name} ${c.libraryId || ''}`)

/** A compound's dose over time as segments: each runs until the next dose change, a stop, or today. */
export function doseSegments(c: CompoundTL, today: string): DoseSegment[] {
  const pts = [...c.points].filter((p) => DOSE_KINDS.has(p.kind) || p.kind === 'stop').sort((a, b) => a.date.localeCompare(b.date))
  const out: DoseSegment[] = []
  const st: { cur: DoseSegment | null } = { cur: null }
  const close = (date: string) => {
    if (!st.cur) return
    st.cur.to = addDays(date, -1)
    if (st.cur.to >= st.cur.from) out.push(st.cur)
    st.cur = null
  }
  for (const p of pts) {
    if (p.kind === 'stop') { close(p.date); continue }
    const dose = p.to ?? st.cur?.dose ?? null
    const unit = p.unit ?? st.cur?.unit ?? null
    if (st.cur && st.cur.dose === dose && st.cur.unit === unit) continue
    close(p.date)
    st.cur = { compoundId: c.id, name: c.name, dose, unit, from: p.date, to: today }
  }
  if (st.cur && st.cur.from <= today) out.push(st.cur)
  return out
}

export interface Period {
  key: string
  label: string
  compoundId: string | null
  name: string | null
  dose: number | null
  unit: string | null
  /** inclusive date ranges; a dose level returned to later has more than one */
  ranges: Array<[string, string]>
  /** which compound in the list (0, 1, ...) for its colour; -1 before any */
  colour: number
}

export const inRanges = (d: string, ranges: Array<[string, string]>) => ranges.some(([a, b]) => d >= a && d <= b)

/**
 * The periods the Heart section compares: the 26 weeks before the first GLP-1
 * class compound, then each such compound at each dose level (a level
 * returned to later is one period with two ranges).
 */
export function periodsFor(compounds: CompoundTL[], today: string, beforeDays = HEART.beforeDays): Period[] {
  const focus = compounds.filter(isGlp1).map((c) => ({ c, segs: doseSegments(c, today) })).filter((x) => x.segs.length)
    .sort((a, b) => a.segs[0].from.localeCompare(b.segs[0].from))
  if (!focus.length) return []
  const first = focus[0].segs[0].from
  const out: Period[] = [{ key: 'before', label: `Before ${focus[0].c.name}`, compoundId: null, name: null, dose: null, unit: null, ranges: [[addDays(first, -beforeDays), addDays(first, -1)]], colour: -1 }]
  focus.forEach(({ c, segs }, i) => {
    const by = new Map<string, Period>()
    for (const s of segs) {
      const k = `${c.id}:${s.dose ?? 'x'}:${s.unit ?? ''}`
      if (!by.has(k)) by.set(k, { key: k, label: `${c.name} ${fmtDose(s.dose, s.unit)}`.trim(), compoundId: c.id, name: c.name, dose: s.dose, unit: s.unit, ranges: [], colour: i })
      by.get(k)!.ranges.push([s.from, s.to])
    }
    out.push(...[...by.values()].sort((a, b) => a.ranges[0][0].localeCompare(b.ranges[0][0])))
  })
  return out
}

/** The good sleep reference by default: the 8 weeks before the first Retatrutide dose (else the first GLP-1 class compound). */
export function defaultReference(compounds: CompoundTL[], today: string): { from: string; to: string } | null {
  const pick = (cs: CompoundTL[]) => cs.map((c) => doseSegments(c, today)[0]?.from).filter(Boolean).sort()[0] as string | undefined
  const first = pick(compounds.filter(isReta)) || pick(compounds.filter(isGlp1))
  if (!first) return null
  return { from: addDays(first, -HEART.refWeeks * 7), to: addDays(first, -1) }
}

// ----------------------------------------------------------- statistics

export interface Stat { mean: number; lo: number; hi: number; n: number; sd: number }

/** Mean with a 95% interval (mean ± 1.96 standard errors); null under 2 values. */
export function meanCI(values: number[]): Stat | null {
  const v = values.filter((x) => Number.isFinite(x))
  const n = v.length
  if (n < 2) return null
  const m = mean(v)!
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1))
  const half = HEART.z * (sd / Math.sqrt(n))
  return { mean: m, lo: m - half, hi: m + half, n, sd }
}

export type Status = 'Early' | 'Normal' | 'Possible' | 'Clear'

/**
 * Against the reference: Early under 7 nights; Clear when the interval stays
 * clear of the reference average; Possible when the average sits more than
 * half the reference's spread away; otherwise Normal.
 */
export function statusVs(s: Stat | null, ref: Stat | null, minN = HEART.minNights): Status {
  if (!s || s.n < minN || !ref) return 'Early'
  if (s.lo > ref.mean || s.hi < ref.mean) return 'Clear'
  if (Math.abs(s.mean - ref.mean) > 0.5 * ref.sd) return 'Possible'
  return 'Normal'
}

export type Lookup = Map<string, number>
export interface MetricDef { key: string; label: string; unit: string; dp: number; dir: 'up' | 'down' | null }

export const HEART_METRICS: MetricDef[] = [
  { key: 'rhr', label: 'Resting HR', unit: 'bpm', dp: 0, dir: 'down' },
  { key: 'sleepHR', label: 'Sleeping HR', unit: 'bpm', dp: 0, dir: 'down' },
  { key: 'wakeUps', label: 'Wake-ups', unit: 'a night', dp: 1, dir: 'down' },
  { key: 'awakeMin', label: 'Awake', unit: 'min', dp: 0, dir: 'down' },
  { key: 'hrv', label: 'HRV', unit: 'ms', dp: 0, dir: 'up' },
  { key: 'deep', label: 'Deep sleep', unit: 'min', dp: 0, dir: 'up' },
]

const valuesIn = (lookup: Lookup | undefined, ranges: Array<[string, string]>, counts: (d: string) => boolean) => {
  const out: number[] = []
  for (const [d, v] of lookup || []) if (inRanges(d, ranges) && counts(d)) out.push(v)
  return out
}

export interface PeriodRow { period: Period; cells: Record<string, { stat: Stat | null; status: Status; diff: number | null }> }

/** One row per period: each metric's mean, 95% interval, n and status against the reference. */
export function periodTable(periods: Period[], lookups: Record<string, Lookup>, ref: { from: string; to: string } | null, counts: (d: string) => boolean = () => true, metrics = HEART_METRICS): { rows: PeriodRow[]; ref: Record<string, Stat | null> } {
  const refStats: Record<string, Stat | null> = {}
  for (const m of metrics) refStats[m.key] = ref ? meanCI(valuesIn(lookups[m.key], [[ref.from, ref.to]], counts)) : null
  const rows = periods.map((p) => {
    const cells: PeriodRow['cells'] = {}
    for (const m of metrics) {
      const stat = meanCI(valuesIn(lookups[m.key], p.ranges, counts))
      const r = refStats[m.key]
      cells[m.key] = { stat, status: statusVs(stat, r), diff: stat && r ? stat.mean - r.mean : null }
    }
    return { period: p, cells }
  })
  return { rows, ref: refStats }
}

// -------------------------------------------------- around dose changes

export interface DoseChange { date: string; compoundId: string; name: string; from: string; to: string; up: boolean }

/** Every increase or decrease within a compound (not starts and stops), oldest first. */
export function doseChanges(compounds: CompoundTL[], today: string): DoseChange[] {
  const out: DoseChange[] = []
  for (const c of compounds.filter(isGlp1)) {
    const segs = doseSegments(c, today)
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1]
      const b = segs[i]
      if (days(a.to, b.from) !== 1 || a.dose == null || b.dose == null || a.dose === b.dose) continue
      out.push({ date: b.from, compoundId: c.id, name: c.name, from: fmtDose(a.dose, a.unit), to: fmtDose(b.dose, b.unit), up: b.dose > a.dose })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** 14 nights before, 14 after, then weeks 3 to 6 after, for one metric. */
export function changeWindows(date: string, lookup: Lookup | undefined, counts: (d: string) => boolean = () => true) {
  const w = (a: number, b: number): Array<[string, string]> => [[addDays(date, a), addDays(date, b)]]
  return {
    before: meanCI(valuesIn(lookup, w(-HEART.changeBefore, -1), counts)),
    after: meanCI(valuesIn(lookup, w(0, HEART.changeAfter - 1), counts)),
    settle: meanCI(valuesIn(lookup, w(HEART.settleFrom - 1, HEART.settleTo - 1), counts)),
  }
}

// ------------------------------------------------------ days since dose

export const isWeekly = (frequency: string | null | undefined) => frequency === 'weekly'

export interface SinceBin { key: number; label: string; stat: Stat | null }

/**
 * By day since the last injection (weekly: day 0 to 6, the evening before the
 * night counted), or by 12 hours since the last dose (more often: 0 to 48 h).
 * `ok` only when every bin has at least 6 nights.
 */
export function sinceDose(o: {
  weekly: boolean
  /** dose times (epoch ms) */
  doses: number[]
  /** night date → bedtime (epoch ms), for the nights that count */
  bedtimes: Map<string, number>
  lookup: Lookup | undefined
}): { bins: SinceBin[]; ok: boolean } {
  const doses = [...o.doses].sort((a, b) => a - b)
  const n = o.weekly ? 7 : 4
  const buckets: number[][] = Array.from({ length: n }, () => [])
  for (const [date, bed] of o.bedtimes) {
    const v = o.lookup?.get(date)
    if (v == null) continue
    let last: number | null = null
    for (const t of doses) { if (t <= bed) last = t; else break }
    if (last == null) continue
    const k = o.weekly ? Math.floor((bed - last) / DAY) : Math.floor((bed - last) / (12 * 3600000))
    if (k >= 0 && k < n) buckets[k].push(v)
  }
  const bins = buckets.map((vals, k) => ({ key: k, label: o.weekly ? `Day ${k}` : `${k * 12} to ${k * 12 + 12} h`, stat: meanCI(vals) }))
  return { bins, ok: bins.every((b) => (b.stat?.n ?? 0) >= HEART.doseBinMin) }
}

/** "Wake-ups are highest 1 day after your injection (2.4 a night, against 1.6 on the other days)." */
export function sinceDoseAnswer(label: string, r: { bins: SinceBin[]; ok: boolean }, weekly: boolean, dp = 1): string {
  if (!r.ok) return `Needs ${HEART.doseBinMin} nights in every ${weekly ? 'day' : '12 hours'} since a dose.`
  const top = r.bins.reduce((a, b) => ((b.stat?.mean ?? -Infinity) > (a.stat?.mean ?? -Infinity) ? b : a))
  const rest = mean(r.bins.filter((b) => b !== top).map((b) => b.stat!.mean))
  const when = weekly ? (top.key === 0 ? 'on the night of your injection' : `${top.key} ${top.key === 1 ? 'day' : 'days'} after your injection`) : `${top.label} after a dose`
  return `${label} highest ${when} (${top.stat!.mean.toFixed(dp)}, against ${rest!.toFixed(dp)} the rest of the week).`.replace('the rest of the week', weekly ? 'the rest of the week' : 'at other times')
}

// --------------------------------------------- other things that changed

export interface Context {
  events: Array<{ date: string; compoundId: string; name: string; kind: string; dose: string | null }>
  sauna: string[]
  alcohol: string[]
  sedatives: Array<{ date: string; name: string }>
  weights: Array<{ date: string; value: number }>
}

/** kg a week from a straight line through the readings; null under 3 readings or 14 days. */
export function slopePerWeek(points: Array<{ date: string; value: number }>): number | null {
  if (points.length < 3) return null
  const xs = points.map((p) => Date.parse(`${p.date}T00:00:00Z`) / DAY)
  if (Math.max(...xs) - Math.min(...xs) < 14) return null
  const mx = mean(xs)!
  const my = mean(points.map((p) => p.value))!
  let num = 0
  let den = 0
  points.forEach((p, i) => { num += (xs[i] - mx) * (p.value - my); den += (xs[i] - mx) ** 2 })
  return den ? Math.round((num / den) * 7 * 100) / 100 : null
}

/** One line per period: other compounds' changes, sauna, alcohol, sedatives and the weight trend in it. */
export function contextLine(period: Period, ctx: Context, refPerWeek: { sauna: number | null } = { sauna: null }): string {
  const parts: string[] = []
  const inside = (d: string) => inRanges(d, period.ranges)
  const daysIn = period.ranges.reduce((s, [a, b]) => s + days(a, b) + 1, 0)
  const verb: Record<string, string> = { start: 'started', change: 'changed', stop: 'stopped' }
  const ev = ctx.events.filter((e) => inside(e.date) && e.compoundId !== period.compoundId)
  if (ev.length) parts.push(ev.slice(0, 3).map((e) => `${e.name} ${verb[e.kind] || e.kind}${e.dose && e.kind !== 'stop' ? ` at ${e.dose}` : ''} ${shortDate(e.date)}`).join(', ') + (ev.length > 3 ? `, and ${ev.length - 3} more` : ''))
  const sauna = ctx.sauna.filter(inside).length
  if (sauna) {
    const perWeek = r1((sauna / daysIn) * 7)
    parts.push(`sauna ${perWeek} a week${refPerWeek.sauna != null ? ` (reference ${refPerWeek.sauna})` : ''}`)
  }
  const alc = new Set(ctx.alcohol.filter(inside)).size
  if (alc) parts.push(`alcohol on ${alc} of ${daysIn} days`)
  const sed = ctx.sedatives.filter((s) => inside(s.date))
  if (sed.length) {
    const byName = new Map<string, number>()
    for (const s of sed) byName.set(s.name, (byName.get(s.name) || 0) + 1)
    parts.push([...byName].map(([n, c]) => `${n} on ${c} ${c === 1 ? 'night' : 'nights'}`).join(', '))
  }
  const slope = slopePerWeek(ctx.weights.filter((w) => inside(w.date)))
  if (slope != null) parts.push(Math.abs(slope) < 0.05 ? 'weight steady' : `weight ${slope < 0 ? 'down' : 'up'} ${Math.abs(slope).toFixed(1)} kg a week`)
  return parts.length ? `Also in this period: ${parts.join('; ')}.` : 'Nothing else logged changed in this period.'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`
export const monthWords = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`

// ----------------------------------------------- adjusted comparison

export interface AdjRow { date: string; period: string | null; y: number; conf: number[] }

/**
 * Each period's average adjusted for the things you log (sauna, alcohol,
 * sedatives, dexamphetamine, late meals, weekend), from 60 nights. `fit` is
 * the Sleep Lab's ridge with bootstrap intervals; the period's adjusted value
 * is the fitted level at the average of every other factor.
 */
export function adjustedPeriods(
  rows: AdjRow[], periodKeys: string[],
  fit: (X: number[][], y: number[]) => { coef: number[]; intercept: number; ci: Array<{ lo: number; hi: number }> } | null,
): { locked: true; have: number } | { locked: false; n: number; values: Record<string, { adj: number; lo: number; hi: number }> } {
  const usable = rows.filter((r) => r.period != null && Number.isFinite(r.y))
  if (usable.length < HEART.adjustedFrom) return { locked: true, have: usable.length }
  const others = periodKeys.slice(1).filter((k) => usable.some((r) => r.period === k))
  const X = usable.map((r) => [...others.map((k) => (r.period === k ? 1 : 0)), ...r.conf])
  const f = fit(X, usable.map((r) => r.y))
  if (!f) return { locked: true, have: usable.length }
  const nc = usable[0].conf.length
  const confMean = Array.from({ length: nc }, (_, j) => mean(usable.map((r) => r.conf[j]))!)
  const base = f.intercept + confMean.reduce((s, m, j) => s + m * f.coef[others.length + j], 0)
  const values: Record<string, { adj: number; lo: number; hi: number }> = {}
  if (usable.some((r) => r.period === periodKeys[0])) values[periodKeys[0]] = { adj: base, lo: NaN, hi: NaN }
  others.forEach((k, j) => { values[k] = { adj: base + f.coef[j], lo: base + f.ci[j].lo, hi: base + f.ci[j].hi } })
  return { locked: false, n: usable.length, values }
}

// ------------------------------------------------------------ switches

export interface SwitchRecord { id: string; from: string; to: string; date: string }

/**
 * A stop of one GLP-1 class compound and the start of another within 14
 * days, not yet recorded or dismissed: "Track this as a switch?"
 */
export function switchCandidates(compounds: CompoundTL[], today: string, known: Array<{ from: string; to: string; date?: string }> = [], dismissed: string[] = []): Array<{ from: string; to: string; fromName: string; toName: string; date: string; key: string }> {
  const focus = compounds.filter(isGlp1).map((c) => ({ c, segs: doseSegments(c, today) })).filter((x) => x.segs.length)
  const out = []
  for (const a of focus) {
    const lastA = a.segs[a.segs.length - 1]
    if (lastA.to >= today) continue // still going
    for (const b of focus) {
      if (b === a) continue
      const startB = b.segs[0].from
      const gap = days(lastA.to, startB)
      if (gap < -HEART.switchGapDays || gap > HEART.switchGapDays + 1) continue
      const key = `${a.c.id}>${b.c.id}`
      if (known.some((k) => k.from === a.c.id && k.to === b.c.id) || dismissed.includes(key)) continue
      out.push({ from: a.c.id, to: b.c.id, fromName: a.c.name, toName: b.c.name, date: startB, key })
    }
  }
  return out
}

/**
 * The two sides of a switch: the last 4 weeks of the old compound at its
 * final (stable) dose, and the new compound once the transition window is
 * over, up to today. Nights in the transition are left out.
 */
export function switchWindows(sw: SwitchRecord, compounds: CompoundTL[], today: string, transitionDays = HEART.transitionDays) {
  const old = compounds.find((c) => c.id === sw.from)
  const segs = old ? doseSegments(old, today).filter((s) => s.from < sw.date) : []
  const last = segs[segs.length - 1]
  const oldTo = last ? (last.to < sw.date ? last.to : addDays(sw.date, -1)) : addDays(sw.date, -1)
  const oldFrom = [addDays(oldTo, -(HEART.oldWeeks * 7 - 1)), last?.from || '0000-01-01'].sort().reverse()[0]
  const newFrom = addDays(sw.date, transitionDays)
  return {
    old: [oldFrom, oldTo] as [string, string],
    oldDose: last ? fmtDose(last.dose, last.unit) : null,
    transition: [sw.date, addDays(newFrom, -1)] as [string, string],
    new: [newFrom, today] as [string, string],
    inTransition: today < newFrom,
  }
}

export interface SwitchRow { key: string; label: string; unit: string; dp: number; before: Stat | null; after: Stat | null; diff: number | null; tone: 'better' | 'worse' | 'same' }

/** Before and after a switch for each metric; Early until each side has 21 nights. */
export function switchCompare(w: { old: [string, string]; new: [string, string] }, lookups: Record<string, Lookup>, metrics: MetricDef[], counts: (d: string) => boolean = () => true): { rows: SwitchRow[]; nBefore: number; nAfter: number; early: boolean } {
  const rows = metrics.map((m) => {
    const before = meanCI(valuesIn(lookups[m.key], [w.old], counts))
    const after = meanCI(valuesIn(lookups[m.key], [w.new], counts))
    const diff = before && after ? after.mean - before.mean : null
    const k = 10 ** m.dp
    const rounded = diff == null ? null : Math.round(diff * k) / k
    const tone: SwitchRow['tone'] = rounded == null || rounded === 0 || !m.dir ? 'same' : (rounded > 0) === (m.dir === 'up') ? 'better' : 'worse'
    return { key: m.key, label: m.label, unit: m.unit, dp: m.dp, before, after, diff: rounded, tone }
  })
  const nOf = (key: string, r: [string, string]) => valuesIn(lookups[key], [r], counts).length
  const anchor = metrics.find((m) => lookups[m.key]?.size)?.key || metrics[0].key
  const nBefore = Math.max(...metrics.map((m) => nOf(m.key, w.old)), nOf(anchor, w.old))
  const nAfter = Math.max(...metrics.map((m) => nOf(m.key, w.new)), nOf(anchor, w.new))
  return { rows, nBefore, nAfter, early: nBefore < HEART.switchEarlyNights || nAfter < HEART.switchEarlyNights }
}

/** "On tirzepatide so far: resting HR 4 lower, 1.5 fewer wake-ups a night, weight loss 0.3 kg a week slower." */
export function switchAnswer(toName: string, rows: SwitchRow[], weight: { before: number | null; after: number | null }): string {
  const parts: string[] = []
  const r = Object.fromEntries(rows.map((x) => [x.key, x]))
  if (r.rhr?.diff != null) parts.push(Math.abs(r.rhr.diff) < 1 ? 'resting HR about the same' : `resting HR ${Math.abs(r.rhr.diff)} ${r.rhr.diff < 0 ? 'lower' : 'higher'}`)
  if (r.wakeUps?.diff != null) parts.push(Math.abs(r.wakeUps.diff) < 0.1 ? 'wake-ups about the same' : `${Math.abs(r.wakeUps.diff)} ${r.wakeUps.diff < 0 ? 'fewer' : 'more'} wake-ups a night`)
  if (weight.before != null && weight.after != null) {
    const lossB = -weight.before
    const lossA = -weight.after
    const d = Math.round((lossA - lossB) * 10) / 10
    parts.push(Math.abs(d) < 0.1 ? 'weight trend about the same' : `weight loss ${Math.abs(d)} kg a week ${d > 0 ? 'faster' : 'slower'}`)
  }
  return parts.length ? `On ${toName} so far: ${parts.join(', ')}.` : `On ${toName} so far: not enough nights on both sides yet.`
}

export const NO_EQUIVALENCE = 'Doses of different compounds are not equivalent: compare each compound with itself, dose by dose.'
export const HEART_INFO = 'Studies of GLP-1 based medicines, including tirzepatide and retatrutide, have reported rises in average resting heart rate, often larger at higher doses. Your own data shows what happens for you. Talk to your prescriber about any changes.'
export const SLEEP_HR_INFO = [
  'Adult daytime resting heart rate is commonly 60 to 100 bpm.',
  'Heart rate normally drops while you sleep, often by 10 to 20% below the daytime average.',
  'A smaller drop, or a sleeping heart rate that keeps rising, can go with poorer sleep, stress, alcohol, illness or some medicines.',
  'This is a description of your numbers, not a diagnosis.',
]

// ----------------------------------------------------------- coverage

export interface Coverage { key: string; label: string; first: string | null; count: number }

/** What came through from Apple Health: the earliest date for each kind of data, and how many nights have stages. */
export function historyCoverage(
  daily: Array<{ date: string; restingHR?: number | null; hrvOvernight?: number | null; hrvDayMean?: number | null; respRate?: number | null; spo2?: number | null }>,
  nights: Array<{ date: string; hasStages?: boolean; overnight?: { hr?: unknown[] } | null }>,
): { rows: Coverage[]; stageNights: number; nights: number } {
  const first = <T extends { date: string }>(xs: T[], ok: (x: T) => boolean) => {
    const f = xs.filter(ok).map((x) => x.date).sort()
    return { first: f[0] ?? null, count: f.length }
  }
  const rows: Coverage[] = [
    { key: 'sleep', label: 'Sleep analysis', ...first(nights, () => true) },
    { key: 'stages', label: 'Sleep stages', ...first(nights, (n) => !!n.hasStages) },
    { key: 'sleepHR', label: 'Heart rate inside sleep', ...first(nights, (n) => !!n.overnight?.hr?.length) },
    { key: 'restingHR', label: 'Resting heart rate', ...first(daily, (d) => d.restingHR != null) },
    { key: 'hrv', label: 'HRV', ...first(daily, (d) => d.hrvOvernight != null || d.hrvDayMean != null) },
    { key: 'resp', label: 'Respiratory rate', ...first(daily, (d) => d.respRate != null) },
    { key: 'spo2', label: 'Blood oxygen', ...first(daily, (d) => d.spo2 != null) },
  ]
  return { rows, stageNights: nights.filter((n) => n.hasStages).length, nights: nights.length }
}
