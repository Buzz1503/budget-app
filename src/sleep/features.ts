// One row of factors per night, from everything already logged or read from
// Health: nothing here needs extra logging. A night is filed under the date
// you woke up (like SleepNight); its evening is the day before.
//
// Factors are of two kinds: yes/no (`binary`) and numbers (`continuous`), and
// every one is null when it cannot be known for that night. Time-to-bed
// features are hours from an event to getting into bed: positive before bed,
// negative after it (a dose taken in bed).

import { addDays } from '../health/tz'
import type { Tz } from '../health/tz'
import type { AsNeededItem, AsNeededLog, EveningDetail } from './logging'

export interface NightLike { date: string; start: number; end: number; naps?: Array<{ start: number; end: number }> }
export interface WorkoutLike { start: number; end: number; energyKcal?: number | null; durationMin?: number }
export interface SaunaLike {
  date: string; start: string; lengthMin: number; tempC: number; startedAt?: number; endedAt?: number
  electrolytes?: boolean | null; waterMl?: number | null
  rating?: { feel: number | null; lightheaded: boolean; headache: boolean; cramps: boolean } | null
}
export interface SuppLogLike { supplementId: string; date: string; takenAt?: string; amount?: number | null; unit?: string | null }
export interface DoseLogLike { peptideId: string; date: string; loggedAt?: string; backfilled?: boolean }

export interface FeatureInput {
  tz: Tz
  /** main sleeps, any order */
  nights: NightLike[]
  asNeededItems: AsNeededItem[]
  asNeededLogs: AsNeededLog[]
  /** supplements with a variable amount (amountUnit set) are numbers; the rest yes/no */
  supplements: Array<{ id: string; name: string; amountUnit?: string | null }>
  supplementLogs: SuppLogLike[]
  doseLogs: DoseLogLike[]
  compounds: Array<{ id: string; name: string }>
  /** { date: { habitId: boolean } } for the evening of `date` */
  habitLogs: Record<string, Record<string, boolean>>
  habits: Array<{ id: string; name: string; hidden?: boolean }>
  eveningDetails: Record<string, EveningDetail>
  workouts: WorkoutLike[]
  /** training load by local date, for "higher load" */
  load?: Map<string, number>
  sauna: SaunaLike[]
  daylight: Map<string, number>
  steps: Map<string, number>
  /** sleeps outside the main one, by the date they started on */
  naps?: Array<{ date: string; start: number; end: number }>
}

export interface NightFeatures {
  /** wake date */
  date: string
  /** the evening before */
  evening: string
  binary: Record<string, boolean | null>
  continuous: Record<string, number | null>
  /** human words for this night's logged items: "2 drinks, last 9:40 pm" */
  line: string[]
}

export const FEATURES = {
  lateWithinH: 3, // a workout, sauna or meal ending within 3 h of bed is "late"
  earlyStartMin: 60, // a wake time earlier than the median minus 60 min
  medianWakeNights: 28,
  windowBeforeBedH: 20, // without a previous night, the window opens 20 h before bed
}

const H = 3600000
const r1 = (v: number) => Math.round(v * 10) / 10

/** The instant of an 'HH:MM' said on the evening of `date`: before noon means after midnight. */
export function eveningClock(date: string, hhmm: string | null | undefined, tz: Tz): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null
  const [h, m] = hhmm.split(':').map(Number)
  const day = h < 12 ? addDays(date, 1) : date
  return tz.startOfDay(day) + (h * 60 + m) * 60000
}

/** Hours from an instant to bed, one decimal; negative after getting into bed. */
export const hoursToBed = (at: number | null, bed: number) => (at == null ? null : r1((bed - at) / H))

/** "9:40 pm" */
export function clockWords(ms: number, tz: Tz): string {
  const h = tz.hourOf(ms)
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${h12}:${String(mm === 60 ? 0 : mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * The factors for every night. Each night's window runs from the end of the
 * night before (or 20 h before bed) to this night's wake-up: anything taken
 * in it belongs to this night, including a dose at 3 am.
 */
export function nightFeatures(input: FeatureInput): NightFeatures[] {
  const { tz } = input
  const nights = [...input.nights].sort((a, b) => a.start - b.start)
  const itemById = new Map(input.asNeededItems.map((i) => [i.id, i]))
  const asNeeded = input.asNeededLogs.map((l) => ({ ...l, t: Date.parse(l.at) })).filter((l) => Number.isFinite(l.t))
  const suppVar = new Map(input.supplements.filter((s) => s.amountUnit).map((s) => [s.id, s]))
  const suppLogs = input.supplementLogs.map((l) => ({ ...l, t: l.takenAt ? Date.parse(l.takenAt) : NaN }))
  const doses = input.doseLogs.map((l) => ({ ...l, t: l.loggedAt && !l.backfilled ? Date.parse(l.loggedAt) : NaN }))
  const habits = input.habits.filter((h) => !h.hidden)
  const out: NightFeatures[] = []

  nights.forEach((n, idx) => {
    const prev = idx > 0 ? nights[idx - 1] : null
    const from = prev && n.start - prev.end < 30 * H ? prev.end : n.start - FEATURES.windowBeforeBedH * H
    const to = n.end
    const bed = n.start
    const evening = addDays(n.date, -1)
    const inWin = (t: number) => t > from && t <= to
    const binary: Record<string, boolean | null> = {}
    const continuous: Record<string, number | null> = {}
    const line: string[] = []

    // evening factors (answered evenings only)
    const row = input.habitLogs[evening]
    const detail = input.eveningDetails[evening] || {}
    const answered = !!(row && Object.keys(row).length) || detail.drinks != null
    for (const h of habits) binary[`habit:${h.id}`] = answered ? row?.[h.id] === true : null
    const drinks = detail.drinks != null ? detail.drinks : answered ? (row?.alcohol ? null : 0) : null
    continuous.drinks = drinks
    if (drinks != null && answered) binary['habit:alcohol'] = drinks > 0 || row?.alcohol === true
    const lastDrink = eveningClock(evening, detail.lastDrinkAt, tz)
    continuous['toBed:lastDrink'] = drinks ? hoursToBed(lastDrink, bed) : null
    if (drinks) line.push(`${drinks} drink${drinks === 1 ? '' : 's'}${lastDrink ? `, last ${clockWords(lastDrink, tz)}` : ''}`)
    const meal = eveningClock(evening, detail.lastMealAt, tz)
    continuous['toBed:lastMeal'] = hoursToBed(meal, bed)
    binary.lateMeal = meal != null ? bed - meal < FEATURES.lateWithinH * H : null
    if (detail.wokenBy?.length) line.push(`Woken by ${detail.wokenBy.join(', ').toLowerCase()}`)

    // as-needed items: taken or not, total amount, hours from the last one to bed
    for (const item of input.asNeededItems) {
      const mine = asNeeded.filter((l) => l.itemId === item.id && inWin(l.t)).sort((a, b) => a.t - b.t)
      binary[`asNeeded:${item.id}`] = mine.length > 0
      const unit = item.units[0]
      continuous[`amount:${item.id}`] = mine.length ? mine.filter((l) => l.unit === unit).reduce((s, l) => s + l.amount, 0) : 0
      continuous[`toBed:${item.id}`] = mine.length ? hoursToBed(mine[mine.length - 1].t, bed) : null
      for (const l of mine) line.push(`${itemById.get(l.itemId)?.short || l.name} ${l.amount} ${l.unit} ${clockWords(l.t, tz)}`)
    }

    // supplements: grams for the variable ones, yes/no for the rest (logged on the evening date)
    for (const s of input.supplements) {
      const mine = suppLogs.filter((l) => l.supplementId === s.id && (Number.isFinite(l.t) ? inWin(l.t) : l.date === evening))
      if (suppVar.has(s.id)) {
        const amounts = mine.map((l) => l.amount).filter((a): a is number => a != null && Number.isFinite(a))
        continuous[`grams:${s.id}`] = amounts.length ? Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100 : mine.length ? null : 0
        if (amounts.length) line.push(`${s.name.split(' ')[0]} ${amounts.reduce((a, b) => a + b, 0)} ${s.amountUnit}`)
      } else {
        binary[`supp:${s.id}`] = mine.length > 0
      }
    }

    // compound doses: on the evening's date or inside the window, and hours to bed when timed
    for (const c of input.compounds) {
      const mine = doses.filter((l) => l.peptideId === c.id && (Number.isFinite(l.t) ? inWin(l.t) : l.date === evening))
      binary[`dose:${c.id}`] = mine.length > 0
      const timed = mine.filter((l) => Number.isFinite(l.t)).sort((a, b) => a.t - b.t)
      continuous[`toBed:dose:${c.id}`] = timed.length ? hoursToBed(timed[timed.length - 1].t, bed) : null
    }

    // workouts ending in the window
    const ws = input.workouts.filter((w) => inWin(w.end) && w.end <= bed + H)
    binary.workout = ws.length > 0
    const lastW = ws.sort((a, b) => a.end - b.end).at(-1)
    continuous['toBed:workout'] = lastW ? hoursToBed(lastW.end, bed) : null
    binary.lateWorkout = lastW ? bed - lastW.end < FEATURES.lateWithinH * H : false
    continuous.workoutKcal = ws.length ? Math.round(ws.reduce((s, w) => s + (w.energyKcal || 0), 0)) : 0
    continuous.workoutLoad = input.load ? (input.load.get(evening) ?? 0) : null

    // sauna: on the evening's date
    const ss = input.sauna.filter((s) => s.date === evening)
    binary.sauna = ss.length > 0
    const endOf = (s: SaunaLike) => s.endedAt ?? (s.startedAt ?? (tz.startOfDay(s.date) + toMin(s.start) * 60000)) + s.lengthMin * 60000
    const lastS = [...ss].sort((a, b) => endOf(a) - endOf(b)).at(-1)
    continuous['toBed:sauna'] = lastS ? hoursToBed(endOf(lastS), bed) : null
    binary.lateSauna = lastS ? bed - endOf(lastS) < FEATURES.lateWithinH * H : false
    continuous.saunaMin = ss.reduce((s, x) => s + x.lengthMin, 0)
    continuous.saunaTemp = lastS ? lastS.tempC : null
    binary.saunaElectrolytes = lastS ? (lastS.electrolytes ?? null) : null
    continuous.saunaWaterMl = lastS ? (lastS.waterMl ?? null) : null
    // the rating step: unknown (null) when the session was not rated
    const rated = lastS?.rating ?? null
    continuous.saunaFeel = rated?.feel ?? null
    binary.saunaLightheaded = rated ? !!rated.lightheaded : null
    binary.saunaHeadache = rated ? !!rated.headache : null
    binary.saunaCramps = rated ? !!rated.cramps : null

    // naps that day, daylight, steps
    const naps = (input.naps || []).filter((x) => x.date === evening)
    binary.nap = naps.length > 0
    continuous.napMin = Math.round(naps.reduce((s, x) => s + (x.end - x.start) / 60000, 0))
    continuous.daylightMin = input.daylight.get(evening) ?? null
    continuous.steps = input.steps.get(evening) ?? null

    // calendar: a weekend night is Friday or Saturday evening
    const dow = new Date(`${evening}T00:00:00Z`).getUTCDay()
    binary.weekend = dow === 5 || dow === 6
    out.push({ date: n.date, evening, binary, continuous, line })
  })

  // an early start: a wake-up 60 min or more before the median of the 28 nights before
  const wakeMin = (n: NightLike) => { const h = tz.hourOf(n.end); return h * 60 }
  out.forEach((f, i) => {
    const before = nights.slice(Math.max(0, i - FEATURES.medianWakeNights), i).map(wakeMin)
    const m = median(before)
    f.binary.earlyStart = m == null || before.length < 7 ? null : wakeMin(nights[i]) <= m - FEATURES.earlyStartMin
  })
  return out
}

const toMin = (hhmm: string) => { const [h, m] = (hhmm || '0:0').split(':').map(Number); return h * 60 + m }

/** The night after: shift a feature one night later (lag 1), for carry-over. */
export function lagged(rows: NightFeatures[], key: string, kind: 'binary' | 'continuous' = 'binary'): Map<string, boolean | number | null> {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const out = new Map<string, boolean | number | null>()
  for (let i = 1; i < sorted.length; i++) {
    // only consecutive nights: a gap means the night before is unknown
    if (addDays(sorted[i - 1].date, 1) !== sorted[i].date) { out.set(sorted[i].date, null); continue }
    out.set(sorted[i].date, sorted[i - 1][kind][key] ?? null)
  }
  if (sorted.length) out.set(sorted[0].date, null)
  return out
}
