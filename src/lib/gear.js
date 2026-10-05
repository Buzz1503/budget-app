/**
 * Supplies and equipment: the gear that gets injected with, not what is injected.
 *
 * Needles, syringes, pens, cartridges, swabs, sharps containers. This is a
 * deliberately separate ledger from peptide stock. Nothing here reads or writes
 * vials, doses, run-out dates or adherence, and nothing in those reads this —
 * a box of needles running low is a different problem from a vial running low
 * and conflating them would make both numbers harder to trust.
 *
 * Every item is in one of two states: "in use" (the box being drawn from now)
 * or "stock" (unopened, waiting). The one real action is finishing the box in
 * use, which swaps a matching spare into its place and writes a dated record,
 * so how long a box lasts can be read back from the history rather than guessed.
 *
 * Pure functions only. The store holds the data and delegates to these, so every
 * rule can be tested without a screen.
 */
import seed from '../data/supplies_inventory.json'

// ------------------------------------------------------------ vocabulary

export const CATEGORIES = seed.categories
export const STATUSES = [
  { id: 'in_use', label: 'In use' },
  { id: 'stock', label: 'Spare stock' },
]
export const OTHER = 'Other'
export const PREFERRED_SYRINGE_TYPE = seed.defaults.preferred_syringe_type

/**
 * Which fields each category is described by, and which option list feeds each.
 *
 * Needles and syringes are specified by dropdowns because a free-text "32 gauge
 * 6mm" and a "32G 6 mm" are the same box and would never match. Everything else
 * is described by a name: a dropdown of names already in use, with room to add
 * one, except Other, which is free text because it is by definition the things
 * nothing else covers.
 */
export const CATEGORY_FIELDS = {
  'Pen needles': [
    { key: 'gauge', label: 'Gauge', options: 'pen_needle_gauge', required: true },
    { key: 'lengthMm', label: 'Length', options: 'pen_needle_length_mm', required: true, suffix: 'mm' },
  ],
  'Syringe needles': [
    { key: 'gauge', label: 'Gauge', options: 'syringe_needle_gauge', required: true },
    { key: 'lengthMm', label: 'Length', options: 'syringe_needle_length_mm', required: true, suffix: 'mm' },
  ],
  Syringes: [
    { key: 'syringeType', label: 'Type', options: 'syringe_type', required: true },
    { key: 'volumeMl', label: 'Volume', options: 'syringe_volume_ml', suffix: 'mL' },
  ],
  Pens: [{ key: 'name', label: 'Pen', options: 'name_Pens', required: true }],
  Cartridges: [{ key: 'name', label: 'Cartridge', options: 'name_Cartridges', required: true }],
  'Swabs & prep': [{ key: 'name', label: 'Item', options: 'name_Swabs & prep', required: true }],
  'Sharps disposal': [{ key: 'name', label: 'Item', options: 'name_Sharps disposal', required: true }],
  [OTHER]: [{ key: 'name', label: 'Name', free: true, required: true }],
}

export const SPEC_KEYS = ['gauge', 'lengthMm', 'syringeType', 'volumeMl', 'name']

export const UNIT_KEY = 'unit'
export const DEFAULT_UNIT = 'box'

/** Option lists whose values are numbers, so they sort and compare as numbers. */
const NUMERIC_OPTIONS = new Set(['pen_needle_length_mm', 'syringe_needle_length_mm', 'syringe_volume_ml'])
const GAUGE_OPTIONS = new Set(['pen_needle_gauge', 'syringe_needle_gauge'])

// ---------------------------------------------------------------- options

/**
 * The values a dropdown offers: the seed's list, whatever has been added, and —
 * for the name-based categories — every name already in the inventory, so a
 * seeded "Alcohol swabs" is selectable the next time one is added.
 */
export function optionsFor(key, { extras = {}, items = [] } = {}) {
  const base = seed.options[key] ? [...seed.options[key]] : []
  const added = extras[key] || []
  let fromItems = []
  if (key.startsWith('name_')) {
    const cat = key.slice(5)
    fromItems = items.filter((i) => i.category === cat && i.name).map((i) => i.name)
  }
  const out = []
  const seen = new Set()
  for (const v of [...base, ...added, ...fromItems]) {
    const id = typeof v === 'string' ? v.trim().toLowerCase() : v
    if (v === '' || v == null || seen.has(id)) continue
    seen.add(id)
    out.push(typeof v === 'string' ? v.trim() : v)
  }
  if (NUMERIC_OPTIONS.has(key)) return out.sort((a, b) => a - b)
  if (GAUGE_OPTIONS.has(key)) return out.sort((a, b) => gaugeNumber(a) - gaugeNumber(b))
  if (key === 'syringe_type') {
    // the user's preferred type leads, whatever else has been added
    return out.sort((a, b) => (b === PREFERRED_SYRINGE_TYPE) - (a === PREFERRED_SYRINGE_TYPE))
  }
  return out
}

export const gaugeNumber = (g) => parseInt(String(g), 10) || 0

/**
 * A raw typed-in option, cleaned up, or null when it is not usable.
 *
 * "28" and "28g" both become "28G"; a length of "-3" or "abc" is refused rather
 * than stored as an option nobody could ever match against.
 */
export function normaliseOption(key, raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (GAUGE_OPTIONS.has(key)) {
    const m = text.match(/^(\d{1,2})\s*g?$/i)
    return m && +m[1] > 0 ? `${+m[1]}G` : null
  }
  if (NUMERIC_OPTIONS.has(key)) {
    const n = Number(text.replace(/\s*(mm|ml)$/i, ''))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  if (key === UNIT_KEY) return text.toLowerCase()
  return text
}

/** Add a value to one option list, without duplicating what is already there. */
export function withOption(extras = {}, key, raw, items = []) {
  const value = normaliseOption(key, raw)
  if (value == null) return { extras, value: null }
  const existing = optionsFor(key, { extras, items })
  const dup = existing.find((v) => (typeof v === 'string'
    ? v.toLowerCase() === String(value).toLowerCase()
    : v === value))
  if (dup !== undefined) return { extras, value: dup }
  return { extras: { ...extras, [key]: [...(extras[key] || []), value] }, value }
}

// ------------------------------------------------------------------ seed

/** The user's starting inventory, from the file, with stable ids. */
export function seedGear() {
  return seed.items.map((raw, i) => {
    const item = {
      id: `gear-seed-${i + 1}`,
      category: raw.category,
      status: raw.status,
      qty: raw.qty ?? 0,
      unit: raw.unit || DEFAULT_UNIT,
      brand: '',
      vendor: '',
      cost: null,
      note: raw.note || '',
      verify: !!raw.verify,
      usedFrom: null,
      createdAt: i,
    }
    if (raw.gauge) item.gauge = raw.gauge
    if (raw.length_mm != null) item.lengthMm = raw.length_mm
    if (raw.syringe_type) item.syringeType = raw.syringe_type
    if (raw.syringe_volume_ml != null) item.volumeMl = raw.syringe_volume_ml
    if (raw.name) item.name = raw.name
    return item
  })
}

// ---------------------------------------------------------------- matching

/**
 * "1 mL" in a syringe type is the volume. Read it when none was stored, so a
 * seeded "Luer lock 1 mL low dead space" and one added later with volume 1 are
 * the same syringe.
 */
export function effectiveVolume(item) {
  if (item.volumeMl != null && item.volumeMl !== '') return Number(item.volumeMl)
  const m = String(item.syringeType || '').match(/(\d+(?:\.\d+)?)\s*mL/i)
  return m ? Number(m[1]) : null
}

const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase())

/**
 * What makes two items the same thing: category, gauge, length, type, volume —
 * and name, for the categories that are described by one. Brand, vendor, cost,
 * quantity and notes are deliberately not part of it: two boxes of the same
 * needle from different shops are the same needle.
 */
export function specKey(item) {
  const vol = effectiveVolume(item)
  return [
    norm(item.category),
    norm(item.gauge),
    item.lengthMm == null ? '' : Number(item.lengthMm),
    norm(item.syringeType),
    vol == null ? '' : vol,
    norm(item.name),
  ].join('|')
}

export const sameSpec = (a, b) => specKey(a) === specKey(b)

/**
 * An existing row this item would duplicate: same spec, same state.
 *
 * Same state matters. An in-use box and a spare of the same needle are two rows
 * on purpose — that pair is what makes a swap possible — so only an existing row
 * in the *same* state is offered as the one to top up.
 */
export function findDuplicate(items, candidate) {
  const key = specKey(candidate)
  return items.find((i) => i.id !== candidate.id && i.status === candidate.status && specKey(i) === key) || null
}

/** Human-readable spec: "32G · 6 mm", "Luer lock 1 mL low dead space · 1 mL". */
export function describeItem(item) {
  const bits = []
  if (item.name) bits.push(item.name)
  if (item.gauge) bits.push(item.gauge)
  if (item.lengthMm != null) bits.push(`${item.lengthMm} mm`)
  if (item.syringeType) bits.push(item.syringeType)
  if (item.volumeMl != null && item.volumeMl !== '') bits.push(`${item.volumeMl} mL`)
  return bits.join(' · ') || item.category
}

export const quantityWords = (item) => {
  const unit = item.qty === 1 ? item.unit : pluralise(item.unit)
  return `${trimNumber(item.qty)} ${unit}`
}
const pluralise = (u) => (u === 'each' ? 'each' : u?.endsWith('s') ? u : `${u}${u === 'box' ? 'es' : 's'}`)
const trimNumber = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))

// ------------------------------------------------------------- validation

/** What is missing before an item can be saved. An empty list means it can. */
export function validateItem(item) {
  const problems = []
  if (!CATEGORIES.includes(item.category)) problems.push('Choose a category')
  for (const f of CATEGORY_FIELDS[item.category] || []) {
    if (f.required && (item[f.key] == null || String(item[f.key]).trim() === '')) {
      problems.push(`Choose a ${f.label.toLowerCase()}`)
    }
  }
  if (!['in_use', 'stock'].includes(item.status)) problems.push('Choose in use or spare stock')
  if (!(Number(item.qty) >= 0) || item.qty === '' || item.qty == null) problems.push('Enter a quantity')
  if (!item.unit) problems.push('Choose a unit')
  return problems
}

/**
 * An item as it should be stored: only the fields its category uses, with the
 * rest dropped. Switching a row from Syringes to Pen needles must not leave a
 * syringe type behind to quietly change what it matches.
 */
export function cleanItem(item) {
  const fields = (CATEGORY_FIELDS[item.category] || []).map((f) => f.key)
  const out = {
    id: item.id,
    category: item.category,
    status: item.status,
    qty: Number(item.qty) || 0,
    unit: item.unit || DEFAULT_UNIT,
    brand: String(item.brand || '').trim(),
    vendor: String(item.vendor || '').trim(),
    cost: item.cost === '' || item.cost == null || Number.isNaN(Number(item.cost)) ? null : Number(item.cost),
    note: String(item.note || '').trim(),
    verify: !!item.verify,
    usedFrom: item.usedFrom ?? null,
    createdAt: item.createdAt ?? Date.now(),
  }
  for (const key of fields) {
    const v = item[key]
    if (v == null || v === '') continue
    out[key] = typeof v === 'string' ? v.trim() : v
  }
  return out
}

// ------------------------------------------------------------ swap / finish

/**
 * Spares that could replace this box: same spec, in stock, something left.
 * Oldest first, so the box that has been sitting longest is the one offered.
 */
export function matchingSpares(items, inUse) {
  const key = specKey(inUse)
  return items
    .filter((i) => i.status === 'stock' && i.id !== inUse.id && specKey(i) === key && i.qty > 0)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

/** An in-use item with nothing matching behind it. */
export function isLowStock(items, item) {
  return item.status === 'in_use' && matchingSpares(items, item).length === 0
}

export const lowStockIds = (items) => items.filter((i) => isLowStock(items, i)).map((i) => i.id)

let counter = 0
export const newId = (prefix = 'gear') => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 5)}`

/**
 * Finish the box in use, and swap a spare into its place when there is one.
 *
 *   - With `promoteId`: that spare loses one unit (and is removed when it was the
 *     last), and a fresh in-use row for one unit of it takes the finished row's
 *     place in the list.
 *   - Without: the in-use row is simply cleared.
 *
 * Either way a dated record is written, because the dates are the only thing
 * "how long does a box last" can be worked out from. Returns the new arrays and
 * leaves the inputs untouched; `ok: false` means nothing happened, and says why.
 */
export function finishItem(items, swaps, { itemId, promoteId = null, date, id = newId('swap') }) {
  const item = items.find((i) => i.id === itemId)
  if (!item) return { ok: false, reason: 'That item is not here any more.', items, swaps }
  if (item.status !== 'in_use') return { ok: false, reason: 'Only a box in use can be finished.', items, swaps }

  let spare = null
  if (promoteId) {
    spare = matchingSpares(items, item).find((s) => s.id === promoteId) || null
    if (!spare) {
      // never silently clear when a swap was asked for: the spare the person
      // picked is gone or no longer matches, and they should hear about it
      return { ok: false, reason: 'That spare is no longer available.', items, swaps }
    }
  }

  const swap = {
    id,
    date,
    category: item.category,
    specKey: specKey(item),
    label: describeItem(item),
    finishedId: item.id,
    promotedFromId: spare ? spare.id : null,
    promotedBrand: spare ? (spare.brand || spare.vendor || '') : '',
    sparesLeft: spare ? Math.max(0, spare.qty - 1) : 0,
    outcome: spare ? 'promoted' : 'cleared',
  }

  let next = items
  if (spare) {
    const promoted = {
      ...spare,
      id: newId('gear'),
      status: 'in_use',
      qty: 1,
      verify: false,
      usedFrom: date,
      createdAt: Date.now(),
    }
    next = items.flatMap((i) => {
      if (i.id === item.id) return [promoted]
      if (i.id === spare.id) return spare.qty - 1 > 0 ? [{ ...i, qty: spare.qty - 1 }] : []
      return [i]
    })
  } else {
    next = items.filter((i) => i.id !== item.id)
  }
  return { ok: true, items: next, swaps: [...swaps, swap], swap, outcome: swap.outcome }
}

// -------------------------------------------------------- how long a box lasts

/** Fewest gaps between finishes before any average is shown. Two gaps is three boxes. */
export const MIN_INTERVALS = 2
const DAY = 86400000

const dayNumber = (dateStr) => {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY)
}
const dateFromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10)

/**
 * The days each box of one spec lasted, from the gaps between its finishes.
 * Same-day entries are dropped: two finishes on one date are a correction, not a
 * box that lasted nothing.
 */
export function boxDurations(swaps, key) {
  const days = [...new Set(swaps.filter((s) => s.specKey === key).map((s) => dayNumber(s.date)))].sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i < days.length; i++) {
    const gap = days[i] - days[i - 1]
    if (gap >= 1) gaps.push(gap)
  }
  return gaps
}

/**
 * How long a box of this spec lasts, and when the current one should run out.
 *
 * Null until there are at least MIN_INTERVALS gaps to average. One gap is one
 * data point, and an average of one is just that number with a confident name.
 * The run-out date needs a start for the current box too — when it was promoted,
 * or failing that the last finish — and is left out rather than invented.
 */
export function estimateBox(swaps, key, { current = null, now = new Date() } = {}) {
  const gaps = boxDurations(swaps, key)
  if (gaps.length < MIN_INTERVALS) return null
  const avgDays = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
  if (avgDays < 1) return null

  const finishes = swaps.filter((s) => s.specKey === key).map((s) => dayNumber(s.date)).sort((a, b) => a - b)
  const startDay = current?.usedFrom ? dayNumber(current.usedFrom) : (current ? finishes[finishes.length - 1] : null)
  const today = dayNumber(now.toISOString().slice(0, 10))
  const out = { avgDays, boxes: gaps.length + 1, runsOutOn: null, daysLeft: null }
  if (startDay != null && current) {
    const endDay = startDay + avgDays
    out.runsOutOn = dateFromDay(endDay)
    out.daysLeft = endDay - today
  }
  return out
}

/** "about 6 weeks", "about 10 days" — a duration said the way a person says it. */
export function durationWords(days) {
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 70) return `${Math.round(days / 7)} weeks`
  return `${Math.round(days / 30.4)} months`
}

// ----------------------------------------------------------------- grouping

/** Items of one state, grouped by category in the order the categories are declared. */
export function groupByCategory(items, status) {
  const mine = items.filter((i) => i.status === status)
  return CATEGORIES
    .map((category) => ({
      category,
      items: mine
        .filter((i) => i.category === category)
        .sort((a, b) => describeItem(a).localeCompare(describeItem(b), undefined, { numeric: true })),
    }))
    .filter((g) => g.items.length > 0)
}

/** The form's starting values for a new item. */
export function blankItem(category = 'Syringe needles', status = 'stock') {
  const base = { category, status, qty: 1, unit: DEFAULT_UNIT, brand: '', vendor: '', cost: '', note: '' }
  if (category === 'Syringes') {
    return { ...base, syringeType: PREFERRED_SYRINGE_TYPE, volumeMl: effectiveVolume({ syringeType: PREFERRED_SYRINGE_TYPE }) }
  }
  return base
}
