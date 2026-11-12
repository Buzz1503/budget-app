// Automatic context from Apple Health, the weather cache and the dose log,
// added as factors wherever factors are used (Sleep Lab, What shaped last
// night, good and bad nights, adjusted comparisons). Pure: everything goes in.
//
//   workoutAfter5      any workout finishing after 5 pm on the evening
//   saunaNearBed       sauna ending within 3 h of bed (sauna log or a Health sauna workout)
//   bedOffMin/wakeOffMin  minutes from your 14-night median bed and wake time
//   respDev            breathing rate in sleep against the median of the 28 nights before
//   wristTempDev       sleeping wrist temperature against the median of the 28 days before
//   outsideAvgC/MinC   overnight outside temperature, 9 pm to 6 am (Open-Meteo)
//   injHours:<id>      hours from the injection to that night's bed
//   injMorning/Afternoon/Evening:<id>  when that day's injection was
//   daysSince:<id>     day since the last injection (1 = within 24 h)
//   injDay12:<id>      day 1 or 2 since the injection
//   doseLevel:<id>     the dose that night (the protocol's level)
//   why:<tag>          why-I-woke chips on tagged nights (unknown on untagged nights)

const H = 3600000
const MIN = 60000
const DAY = 86400000

export const CONTEXT = {
  lateWorkoutHour: 17,
  saunaNearBedH: 3,
  consistencyNights: 14,
  baselineNights: 28,
  baselineMin: 7,
  morningBefore: 12,
  eveningFrom: 17,
}

export interface ContextNight { date: string; start: number; end: number; respRate?: number | null }
export interface ContextInput {
  nights: ContextNight[]
  /** local clock hour (with fraction) of an instant */
  hourOf: (ms: number) => number
  workouts: Array<{ start: number; end: number; type?: string; title?: string }>
  sauna: Array<{ date: string; end: number }>
  wristTemp: Map<string, number>
  weather: Record<string, { avgC?: number | null; minC?: number | null }>
  doses: Array<{ compoundId: string; t: number }>
  /** dose level per compound and date, from the protocol */
  doseLevel?: (compoundId: string, date: string) => number | null
  compounds: Array<{ id: string; name: string }>
  wakeReasons?: Record<string, { tags: string[]; skipped?: boolean }>
}

export interface ContextRow { binary: Record<string, boolean | null>; continuous: Record<string, number | null>; line: string[] }

const median = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
const r1 = (x: number) => Math.round(x * 10) / 10
// clock minutes from noon, so a bedtime of 11 pm and 1 am sit 2 hours apart
const fromNoon = (hour: number) => ((hour - 12 + 24) % 24) * 60
const clock = (hour: number) => {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  return `${h % 12 || 12}:${String(m === 60 ? 0 : m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

/** Every night's automatic factors, by wake date. */
export function autoContext(input: ContextInput): Map<string, ContextRow> {
  const nights = [...input.nights].sort((a, b) => a.start - b.start)
  const out = new Map<string, ContextRow>()
  const bedMin = nights.map((n) => fromNoon(input.hourOf(n.start)))
  const wakeMin = nights.map((n) => fromNoon(input.hourOf(n.end)))
  const dosesBy = new Map<string, number[]>()
  for (const d of input.doses) dosesBy.set(d.compoundId, [...(dosesBy.get(d.compoundId) || []), d.t])
  for (const v of dosesBy.values()) v.sort((a, b) => a - b)

  nights.forEach((n, i) => {
    const binary: Record<string, boolean | null> = {}
    const continuous: Record<string, number | null> = {}
    const line: string[] = []
    const bed = n.start
    const eveningStart = bed - 20 * H

    // late workout: finishing after 5 pm, on the day before this night's bed
    const late = input.workouts.filter((w) => w.end > eveningStart && w.end <= bed + H && input.hourOf(w.end) >= CONTEXT.lateWorkoutHour && w.end - bed < 12 * H)
      .sort((a, b) => a.end - b.end)
    binary.workoutAfter5 = late.length > 0
    const lastLate = late.at(-1)
    continuous.workoutEndHour = lastLate ? r1(input.hourOf(lastLate.end)) : null
    if (lastLate) line.push(`${lastLate.title || lastLate.type || 'Workout'} ended ${clock(input.hourOf(lastLate.end))}`)

    // sauna within 3 h of bed, from the sauna log or a Health sauna workout
    const saunaEnds = [
      ...input.sauna.map((s) => s.end),
      ...input.workouts.filter((w) => /sauna/i.test(`${w.type || ''} ${w.title || ''}`)).map((w) => w.end),
    ].filter((t) => t <= bed && bed - t < 20 * H)
    const nearest = saunaEnds.length ? Math.max(...saunaEnds) : null
    binary.saunaNearBed = nearest != null ? bed - nearest < CONTEXT.saunaNearBedH * H : false

    // consistency: minutes away from the median of the 14 nights before
    const prevBed = bedMin.slice(Math.max(0, i - CONTEXT.consistencyNights), i)
    const prevWake = wakeMin.slice(Math.max(0, i - CONTEXT.consistencyNights), i)
    const mb = prevBed.length >= CONTEXT.baselineMin ? median(prevBed) : null
    const mw = prevWake.length >= CONTEXT.baselineMin ? median(prevWake) : null
    continuous.bedOffMin = mb != null ? Math.round(Math.abs(bedMin[i] - mb)) : null
    continuous.wakeOffMin = mw != null ? Math.round(Math.abs(wakeMin[i] - mw)) : null

    // breathing rate and wrist temperature against your own baseline
    const prevResp = nights.slice(Math.max(0, i - CONTEXT.baselineNights), i).map((x) => x.respRate).filter((v): v is number => v != null)
    const br = prevResp.length >= CONTEXT.baselineMin ? median(prevResp) : null
    continuous.respDev = n.respRate != null && br != null ? r1(n.respRate - br) : null
    const temps: number[] = []
    for (let k = 1; k <= CONTEXT.baselineNights; k++) {
      const d = new Date(Date.parse(`${n.date}T00:00:00Z`) - k * DAY).toISOString().slice(0, 10)
      const v = input.wristTemp.get(d)
      if (v != null) temps.push(v)
    }
    const bt = temps.length >= CONTEXT.baselineMin ? median(temps) : null
    const wt = input.wristTemp.get(n.date)
    continuous.wristTempDev = wt != null && bt != null ? Math.round((wt - bt) * 100) / 100 : null

    // overnight outside temperature
    const w = input.weather[n.date]
    continuous.outsideAvgC = w?.avgC ?? null
    continuous.outsideMinC = w?.minC ?? null

    // injections: hours to bed, time of day, day since, the dose level
    for (const c of input.compounds) {
      const list = dosesBy.get(c.id)
      if (!list?.length) continue
      let last: number | null = null
      for (const t of list) { if (t <= bed) last = t; else break }
      const today = last != null && bed - last < 24 * H ? last : null
      continuous[`injHours:${c.id}`] = today != null ? r1((bed - today) / H) : null
      const hour = today != null ? input.hourOf(today) : null
      binary[`injMorning:${c.id}`] = hour == null ? false : hour < CONTEXT.morningBefore
      binary[`injAfternoon:${c.id}`] = hour == null ? false : hour >= CONTEXT.morningBefore && hour < CONTEXT.eveningFrom
      binary[`injEvening:${c.id}`] = hour == null ? false : hour >= CONTEXT.eveningFrom
      const day = last != null ? Math.floor((bed - last) / DAY) + 1 : null
      continuous[`daysSince:${c.id}`] = day != null && day <= 14 ? day : null
      binary[`injDay12:${c.id}`] = day != null && day <= 14 ? day <= 2 : null
      if (today != null) line.push(`${c.name} ${clock(hour!)} (${r1((bed - today) / H)} h before bed)`)
      const lvl = input.doseLevel?.(c.id, n.date) ?? null
      continuous[`doseLevel:${c.id}`] = lvl
    }

    // why I woke, on tagged nights only
    const tagged = input.wakeReasons?.[n.date]
    if (tagged && !tagged.skipped && tagged.tags.length) {
      for (const t of ['Bathroom', 'Hot', 'Hungry', 'Reflux or nausea', 'Heart racing', 'Kids', 'Dog', 'Noise', "Don't know"]) binary[`why:${t}`] = tagged.tags.includes(t)
    }

    out.set(n.date, { binary, continuous, line })
  })
  return out
}

/** Words for the automatic factor keys (the rest come from factorName). */
export function contextName(key: string, compounds: Record<string, string>): string | null {
  const fixed: Record<string, string> = {
    workoutAfter5: 'A workout finishing after 5 pm', workoutEndHour: 'When the evening workout ended',
    saunaNearBed: 'Sauna within 3 h of bed', bedOffMin: 'Minutes from your usual bedtime', wakeOffMin: 'Minutes from your usual wake time',
    respDev: 'Breathing rate above your usual', wristTempDev: 'Wrist temperature above your usual',
    outsideAvgC: 'Overnight outside temperature', outsideMinC: 'Overnight low outside',
  }
  if (fixed[key]) return fixed[key]
  const [kind, id] = key.split(':')
  const name = compounds[id] || id
  if (kind === 'injHours') return `Hours from ${name} injection to bed`
  if (kind === 'injMorning') return `${name} injected in the morning`
  if (kind === 'injAfternoon') return `${name} injected in the afternoon`
  if (kind === 'injEvening') return `${name} injected in the evening`
  if (kind === 'daysSince') return `Days since ${name} injection`
  if (kind === 'injDay12') return `${name} injection days 1 to 2`
  if (kind === 'doseLevel') return `${name} dose level`
  if (kind === 'why') return `Woke: ${id.toLowerCase()}`
  return null
}

export { MIN as CONTEXT_MIN }
