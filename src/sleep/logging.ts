// What is logged for the Sleep Lab: as-needed items, supplements taken in a
// variable amount, the evening factors and the morning check. Pure: the store
// keeps the records, these functions decide their shape.
//
// No amounts are suggested anywhere. An amount field starts from the last
// amount you logged, or empty.

export type Slot = 'AM' | 'PM'

/** An as-needed protocol item: no schedule, no reminders, never missed. */
export interface AsNeededItem {
  id: string
  name: string
  /** short form for the collapsed row and the Watch ("Dex") */
  short: string
  slot: Slot
  /** units it can be logged in; the first is the default */
  units: string[]
  /** stepper increment for the amount, in the first unit */
  step: number
  /** hidden from the row, records kept */
  archived?: boolean
  /** sedative or alcohol-like for carry-over and the apnea screen */
  sedative?: boolean
  stimulant?: boolean
}

export interface AsNeededLog {
  id: string
  itemId: string
  name: string
  amount: number
  unit: string
  /** when it was taken, ISO */
  at: string
  source?: 'phone' | 'watch' | 'notification'
}

export const DEFAULT_AS_NEEDED: AsNeededItem[] = [
  { id: 'an-dex', name: 'Dexamphetamine', short: 'Dex', slot: 'AM', units: ['mg'], step: 2.5, stimulant: true },
  { id: 'an-temazepam', name: 'Temazepam', short: 'Temazepam', slot: 'PM', units: ['mg'], step: 5, sedative: true },
  { id: 'an-diazepam', name: 'Diazepam (Valium)', short: 'Valium', slot: 'PM', units: ['mg'], step: 2, sedative: true },
  { id: 'an-restavit', name: 'Restavit', short: 'Restavit', slot: 'PM', units: ['tablets', 'mg'], step: 1, sedative: true },
]

/** Items shown in a slot's "As needed" row, in their set order. */
export const asNeededInSlot = (items: AsNeededItem[], slot: Slot) => items.filter((i) => i.slot === slot && !i.archived)

/** "As needed: Dex, Temazepam, Valium" for the collapsed row. */
export function asNeededLine(items: AsNeededItem[], slot: Slot, max = 3): string | null {
  const shown = asNeededInSlot(items, slot)
  if (!shown.length) return null
  const names = shown.map((i) => i.short)
  return `As needed: ${names.slice(0, max).join(', ')}${names.length > max ? ', …' : ''}`
}

/** The last amount and unit logged for an item (any day), or null. */
export function lastAmount(logs: Array<{ itemId?: string; supplementId?: string; amount?: number | null; unit?: string | null; at?: string; takenAt?: string }>, id: string): { amount: number; unit: string } | null {
  let best: { amount: number; unit: string; t: string } | null = null
  for (const l of logs) {
    if ((l.itemId ?? l.supplementId) !== id || l.amount == null || !Number.isFinite(l.amount)) continue
    const t = l.at ?? l.takenAt ?? ''
    if (!best || t > best.t) best = { amount: l.amount, unit: l.unit || '', t }
  }
  return best ? { amount: best.amount, unit: best.unit } : null
}

/** A log row, checked: a positive amount in one of the item's units at a real time. */
export function makeAsNeededLog(item: AsNeededItem, input: { amount: number; unit?: string; at: string; source?: AsNeededLog['source'] }, id: string): AsNeededLog | null {
  const amount = Number(input.amount)
  const unit = input.unit && item.units.includes(input.unit) ? input.unit : item.units[0]
  if (!(amount > 0) || !Number.isFinite(Date.parse(input.at))) return null
  return { id, itemId: item.id, name: item.name, amount: Math.round(amount * 1000) / 1000, unit, at: new Date(input.at).toISOString(), source: input.source || 'phone' }
}

/**
 * As-needed items are never owed: nothing is due, nothing is missed, there is
 * no reminder. Every adherence and reminder path asks this and gets nothing.
 */
export const dueAsNeeded = (_items: AsNeededItem[], _date: string): AsNeededItem[] => []

// ----------------------------------------------------------- variable grams

/** Supplements that are taken in a variable amount, by name, and their unit. */
export const VARIABLE_SUPPLEMENTS = [
  { match: /magnesium\s*glycinate/i, name: 'Magnesium glycinate', unit: 'g', step: 0.1 },
  { match: /phosphatidyl\s*serine/i, name: 'Phosphatidylserine', unit: 'g', step: 0.1 },
] as const

/** The variable-amount setting for a supplement name, if it is one of them. */
export const variableFor = (name: string) => VARIABLE_SUPPLEMENTS.find((v) => v.match.test(name || '')) || null

/**
 * Turn the two supplements into variable-amount PM items, or add them when
 * they are not in the protocol. History is kept as it is: old logs have no
 * amount and stay "taken".
 */
export function migrateVariableSupplements<T extends { id: string; name: string; slot?: string; amountUnit?: string | null; amountStep?: number | null }>(supplements: T[], makeId: (i: number) => string, today: string): { supplements: T[]; converted: string[]; added: string[] } {
  const out = supplements.map((s) => ({ ...s }))
  const converted: string[] = []
  const added: string[] = []
  VARIABLE_SUPPLEMENTS.forEach((v, i) => {
    const hits = out.filter((s) => v.match.test(s.name))
    if (hits.length) {
      for (const s of hits) {
        if (s.amountUnit) continue
        s.amountUnit = v.unit
        s.amountStep = v.step
        converted.push(s.id)
      }
    } else {
      const id = makeId(i)
      out.push({ id, name: v.name, brand: '', form: 'powder', dose: '', doseNote: '', caution: '', category: 'sleep', libraryId: null, slot: 'PM', addedOn: today, amountUnit: v.unit, amountStep: v.step } as unknown as T)
      added.push(id)
    }
  })
  return { supplements: out, converted, added }
}

// --------------------------------------------------------- evening factors

export interface FactorDef {
  id: string
  name: string
  /** extra detail asked with it */
  detail?: 'drinks' | 'who'
}

/** The evening factors, in sheet order. Alcohol carries drinks and the last drink's time. */
export const EVENING_FACTORS: FactorDef[] = [
  { id: 'alcohol', name: 'Alcohol', detail: 'drinks' },
  { id: 'screen-bed', name: 'Screen in bed' },
  { id: 'stress', name: 'Stressful day' },
  { id: 'unwell', name: 'Unwell' },
  { id: 'pain', name: 'Pain' },
  { id: 'room-hot', name: 'Room too hot' },
  { id: 'away', name: 'Slept away from home' },
  { id: 'woken', name: 'Woken by someone', detail: 'who' },
]
export const WOKEN_BY = ['Kids', 'Partner', 'Dog'] as const
/** Habits from before the Sleep Lab that are hidden now (their records are kept). */
export const HIDDEN_HABITS = ['caffeine-late', 'cold-plunge', 'late-meal']

/** Habits after the Sleep Lab: the factor list first, then anything you added; the old ones hidden. */
export function migrateHabits<T extends { id: string; name: string; hidden?: boolean }>(habits: T[]): T[] {
  const byId = new Map(habits.map((h) => [h.id, h]))
  const out: T[] = EVENING_FACTORS.map((f) => ({ ...(byId.get(f.id) || {}), id: f.id, name: f.id === 'alcohol' ? 'Alcohol' : (byId.get(f.id)?.name || f.name) } as T))
  for (const h of habits) {
    if (EVENING_FACTORS.some((f) => f.id === h.id)) continue
    out.push(HIDDEN_HABITS.includes(h.id) ? { ...h, hidden: true } : h)
  }
  return out
}

export interface EveningDetail {
  drinks?: number | null
  lastDrinkAt?: string | null
  lastMealAt?: string | null
  wokenBy?: string[] | null
}

/**
 * "Nothing unusual": every yes/no factor is no and no drinks. The meal time is
 * not a yes or no, so it is left as it is.
 */
export function nothingUnusual(habits: Array<{ id: string; hidden?: boolean }>, row: Record<string, boolean | undefined> = {}, detail: EveningDetail = {}) {
  const log: Record<string, boolean> = { ...row } as Record<string, boolean>
  for (const h of habits) if (!h.hidden) log[h.id] = false
  return { log, detail: { ...detail, drinks: 0, lastDrinkAt: null, wokenBy: [] } }
}

/** Whether the evening of a date has been answered at all. */
export const eveningAnswered = (row: Record<string, unknown> | undefined, detail: EveningDetail | undefined) =>
  !!(row && Object.keys(row).length) || !!(detail && (detail.drinks != null || detail.lastMealAt))

/** The last-meal time to prefill: yesterday's, else the median of the last 14 answered evenings. */
export function defaultMealTime(details: Record<string, EveningDetail>, date: string, addDays: (d: string, n: number) => string): string | null {
  const y = details[addDays(date, -1)]?.lastMealAt
  if (y) return y
  const mins: number[] = []
  for (let i = 2; i <= 15; i++) {
    const v = details[addDays(date, -i)]?.lastMealAt
    if (v) mins.push(toMin(v))
  }
  if (!mins.length) return null
  mins.sort((a, b) => a - b)
  return fromMin(mins[Math.floor(mins.length / 2)])
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// ------------------------------------------------------------ morning check

export type Dreams = 'none' | 'normal' | 'vivid' | 'nightmare'
export type Partner = 'snoring' | 'stopped' | 'nothing' | 'notAsked'

export interface MorningCheck {
  rested?: 1 | 2 | 3 | 4 | 5 | null
  dreams?: Dreams | null
  headache?: boolean | null
  dryMouth?: boolean | null
  /** 0, 1, 2, or 3 meaning 3 or more */
  pee?: 0 | 1 | 2 | 3 | null
  partner?: Partner | null
  /** Done or Not today was tapped */
  done?: boolean
  at?: string
}

export const DREAMS: Array<{ id: Dreams; label: string }> = [
  { id: 'none', label: 'None remembered' }, { id: 'normal', label: 'Normal' }, { id: 'vivid', label: 'Vivid' }, { id: 'nightmare', label: 'Nightmare' },
]
export const PARTNER: Array<{ id: Partner; label: string }> = [
  { id: 'snoring', label: 'Snoring' }, { id: 'stopped', label: 'Stopped breathing or gasping' }, { id: 'nothing', label: 'Nothing' }, { id: 'notAsked', label: 'Not asked' },
]

/** Keep only valid answers; merge into what is already there. */
export function mergeMorningCheck(prev: MorningCheck | undefined, patch: Partial<MorningCheck>, at: string): MorningCheck {
  const out: MorningCheck = { ...(prev || {}) }
  if (patch.rested !== undefined) out.rested = patch.rested != null && [1, 2, 3, 4, 5].includes(patch.rested) ? patch.rested : null
  if (patch.dreams !== undefined) out.dreams = DREAMS.some((d) => d.id === patch.dreams) ? patch.dreams : null
  if (patch.headache !== undefined) out.headache = patch.headache == null ? null : !!patch.headache
  if (patch.dryMouth !== undefined) out.dryMouth = patch.dryMouth == null ? null : !!patch.dryMouth
  if (patch.pee !== undefined) out.pee = patch.pee == null ? null : (Math.max(0, Math.min(3, Math.round(patch.pee))) as MorningCheck['pee'])
  if (patch.partner !== undefined) out.partner = PARTNER.some((p) => p.id === patch.partner) ? patch.partner : null
  if (patch.done !== undefined) out.done = !!patch.done
  out.at = at
  return out
}

/** The morning check card stays on the Sleep tab until any answer is in. */
export const morningAnswered = (c: MorningCheck | undefined) => !!c && (c.rested != null || c.dreams != null || c.headache != null || c.dryMouth != null || c.pee != null || c.partner != null)
