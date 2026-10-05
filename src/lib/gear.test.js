/**
 * Supplies and equipment.
 *
 * The rules that matter are all pure — matching, swapping, duplicates, how long
 * a box lasts — so they are tested directly, against fixed dates, rather than
 * through a screen.
 */
import { describe, it, expect } from 'vitest'
import {
  CATEGORIES, CATEGORY_FIELDS, PREFERRED_SYRINGE_TYPE, MIN_INTERVALS,
  seedGear, specKey, sameSpec, effectiveVolume, findDuplicate, describeItem,
  matchingSpares, isLowStock, lowStockIds, finishItem, boxDurations, estimateBox,
  optionsFor, normaliseOption, withOption, validateItem, cleanItem, groupByCategory,
  blankItem, durationWords, quantityWords,
} from './gear'
import seed from '../data/supplies_inventory.json'

const item = (o) => ({
  id: o.id || `i-${Math.random().toString(36).slice(2, 6)}`,
  category: 'Syringe needles', status: 'stock', qty: 1, unit: 'box',
  brand: '', vendor: '', cost: null, note: '', verify: false, usedFrom: null, createdAt: 0,
  ...o,
})

// ------------------------------------------------------------------- seed

describe('the seed', () => {
  const items = seedGear()

  it('carries every item in the file, none added and none dropped', () => {
    expect(items).toHaveLength(seed.items.length)
    expect(items).toHaveLength(16)
  })

  it('splits nine in use from seven spare, as the file does', () => {
    expect(items.filter((i) => i.status === 'in_use')).toHaveLength(9)
    expect(items.filter((i) => i.status === 'stock')).toHaveLength(7)
  })

  it('keeps every field from the file', () => {
    const first = items[0]
    expect(first).toMatchObject({ category: 'Pen needles', gauge: '32G', lengthMm: 6, status: 'in_use', qty: 1, unit: 'box' })
    const reta = items.find((i) => i.gauge === '34G')
    expect(reta).toMatchObject({ lengthMm: 8, qty: 2, verify: true })
    expect(reta.note).toMatch(/confirm gauge and quantity/)
  })

  it('flags exactly the three items the file marks verify', () => {
    expect(items.filter((i) => i.verify)).toHaveLength(3)
  })

  it('leaves unspecified quantities at zero rather than inventing one', () => {
    const zero = items.filter((i) => i.qty === 0)
    expect(zero.map((i) => i.category).sort()).toEqual(['Sharps disposal', 'Swabs & prep', 'Syringes'])
  })

  it('gives every item a unique stable id', () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
  })

  it('uses only categories the file declares', () => {
    for (const i of items) expect(CATEGORIES).toContain(i.category)
  })

  it('declares all eight categories, each with a form', () => {
    expect(CATEGORIES).toHaveLength(8)
    for (const c of CATEGORIES) expect(CATEGORY_FIELDS[c]).toBeTruthy()
  })
})

// ---------------------------------------------------------------- matching

describe('what makes two items the same', () => {
  const base = item({ category: 'Syringe needles', gauge: '25G', lengthMm: 13 })

  it('ignores quantity, brand, vendor, cost and notes', () => {
    const other = item({ ...base, qty: 9, brand: 'BD', vendor: 'Chemist', cost: 12, note: 'x' })
    expect(sameSpec(base, other)).toBe(true)
  })

  it('separates on category', () => {
    expect(sameSpec(base, item({ category: 'Pen needles', gauge: '25G', lengthMm: 13 }))).toBe(false)
  })
  it('separates on gauge', () => {
    expect(sameSpec(base, item({ category: 'Syringe needles', gauge: '27G', lengthMm: 13 }))).toBe(false)
  })
  it('separates on length', () => {
    expect(sameSpec(base, item({ category: 'Syringe needles', gauge: '25G', lengthMm: 16 }))).toBe(false)
  })
  it('separates on syringe type', () => {
    const a = item({ category: 'Syringes', syringeType: 'Luer lock 1 mL low dead space', volumeMl: 1 })
    const b = item({ category: 'Syringes', syringeType: 'Luer slip 1 mL', volumeMl: 1 })
    expect(sameSpec(a, b)).toBe(false)
  })
  it('separates on volume', () => {
    const a = item({ category: 'Syringes', syringeType: 'Insulin syringe U-100 fixed needle', volumeMl: 0.3 })
    const b = item({ category: 'Syringes', syringeType: 'Insulin syringe U-100 fixed needle', volumeMl: 0.5 })
    expect(sameSpec(a, b)).toBe(false)
  })
  it('separates on name, for the categories described by one', () => {
    const a = item({ category: 'Swabs & prep', name: 'Alcohol swabs' })
    const b = item({ category: 'Swabs & prep', name: 'Chlorhexidine wipes' })
    expect(sameSpec(a, b)).toBe(false)
    expect(sameSpec(a, item({ category: 'Swabs & prep', name: 'ALCOHOL SWABS ' }))).toBe(true)
  })

  it('reads a syringe volume off its type when none was stored', () => {
    expect(effectiveVolume({ syringeType: 'Luer lock 1 mL low dead space' })).toBe(1)
    expect(effectiveVolume({ syringeType: 'Insulin syringe U-100 fixed needle' })).toBe(null)
    const seeded = item({ category: 'Syringes', syringeType: PREFERRED_SYRINGE_TYPE })
    const added = item({ category: 'Syringes', syringeType: PREFERRED_SYRINGE_TYPE, volumeMl: 1 })
    expect(sameSpec(seeded, added)).toBe(true)
  })

  it('does not let a length of 6 and "6" differ', () => {
    expect(specKey(item({ gauge: '32G', lengthMm: 6 }))).toBe(specKey(item({ gauge: '32G', lengthMm: '6' })))
  })
})

describe('duplicate detection', () => {
  const rows = [
    item({ id: 'a', category: 'Syringe needles', gauge: '25G', lengthMm: 13, status: 'stock', qty: 1 }),
    item({ id: 'b', category: 'Syringe needles', gauge: '25G', lengthMm: 13, status: 'in_use', qty: 1 }),
    item({ id: 'c', category: 'Pen needles', gauge: '32G', lengthMm: 4, status: 'stock', qty: 1 }),
  ]

  it('finds an existing row with the same spec in the same state', () => {
    const dup = findDuplicate(rows, item({ category: 'Syringe needles', gauge: '25G', lengthMm: 13, status: 'stock' }))
    expect(dup.id).toBe('a')
  })

  it('does not call an in-use box and a spare of the same needle duplicates', () => {
    // that pair is what makes a swap possible
    const dup = findDuplicate(rows, item({ category: 'Pen needles', gauge: '32G', lengthMm: 4, status: 'in_use' }))
    expect(dup).toBe(null)
  })

  it('offers the row in the matching state when both exist', () => {
    expect(findDuplicate(rows, item({ category: 'Syringe needles', gauge: '25G', lengthMm: 13, status: 'in_use' })).id).toBe('b')
  })

  it('finds nothing when any one of the spec fields differs', () => {
    for (const change of [{ gauge: '27G' }, { lengthMm: 16 }, { category: 'Pen needles' }]) {
      expect(findDuplicate(rows, item({ category: 'Syringe needles', gauge: '25G', lengthMm: 13, status: 'stock', ...change }))).toBe(null)
    }
  })

  it('matches syringes on type and volume', () => {
    const syringes = [item({ id: 's', category: 'Syringes', syringeType: 'Luer lock 3 mL', volumeMl: 3, status: 'stock' })]
    expect(findDuplicate(syringes, item({ category: 'Syringes', syringeType: 'Luer lock 3 mL', volumeMl: 3, status: 'stock' })).id).toBe('s')
    expect(findDuplicate(syringes, item({ category: 'Syringes', syringeType: 'Luer lock 3 mL', volumeMl: 5, status: 'stock' }))).toBe(null)
    expect(findDuplicate(syringes, item({ category: 'Syringes', syringeType: 'Luer slip 1 mL', volumeMl: 3, status: 'stock' }))).toBe(null)
  })

  it('never reports an item as a duplicate of itself', () => {
    expect(findDuplicate(rows, rows[0])).toBe(null)
  })
})

// ------------------------------------------------------------- swap logic

describe('finishing a box', () => {
  const inUse = item({ id: 'use', status: 'in_use', gauge: '25G', lengthMm: 13, category: 'Syringe needles', qty: 1 })
  const spareA = item({ id: 'sa', status: 'stock', gauge: '25G', lengthMm: 13, category: 'Syringe needles', qty: 2, brand: 'BD', createdAt: 1 })
  const other = item({ id: 'oth', status: 'stock', gauge: '27G', lengthMm: 13, category: 'Syringe needles', qty: 5, createdAt: 2 })
  const items = [inUse, spareA, other]

  it('promotes a matching spare, takes one from it, and records the swap', () => {
    const r = finishItem(items, [], { itemId: 'use', promoteId: 'sa', date: '2026-03-10' })
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('promoted')

    const inUseNow = r.items.filter((i) => i.status === 'in_use')
    expect(inUseNow).toHaveLength(1)
    expect(inUseNow[0]).toMatchObject({ gauge: '25G', lengthMm: 13, qty: 1, brand: 'BD', usedFrom: '2026-03-10' })
    expect(inUseNow[0].id).not.toBe('use')

    const spareNow = r.items.find((i) => i.id === 'sa')
    expect(spareNow.qty).toBe(1)

    expect(r.swaps).toHaveLength(1)
    expect(r.swaps[0]).toMatchObject({
      date: '2026-03-10', outcome: 'promoted', finishedId: 'use', promotedFromId: 'sa', sparesLeft: 1,
    })
  })

  it('takes the new box into the finished one\'s place, not the end of the list', () => {
    const r = finishItem(items, [], { itemId: 'use', promoteId: 'sa', date: '2026-03-10' })
    expect(r.items[0].status).toBe('in_use')
  })

  it('removes a spare that was the last one', () => {
    const single = [inUse, { ...spareA, qty: 1 }]
    const r = finishItem(single, [], { itemId: 'use', promoteId: 'sa', date: '2026-03-10' })
    expect(r.items.find((i) => i.id === 'sa')).toBeUndefined()
    expect(r.items).toHaveLength(1)
    expect(r.swaps[0].sparesLeft).toBe(0)
  })

  it('leaves unrelated stock exactly as it was', () => {
    const r = finishItem(items, [], { itemId: 'use', promoteId: 'sa', date: '2026-03-10' })
    expect(r.items.find((i) => i.id === 'oth')).toEqual(other)
  })

  it('clears the slot cleanly when there is no match', () => {
    const noSpare = [inUse, other]
    const r = finishItem(noSpare, [], { itemId: 'use', date: '2026-03-10' })
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('cleared')
    expect(r.items).toEqual([other])
    expect(r.swaps[0]).toMatchObject({ outcome: 'cleared', promotedFromId: null, sparesLeft: 0, date: '2026-03-10' })
  })

  it('still records the date when it clears, because the date is what box life is read from', () => {
    const r = finishItem([inUse], [], { itemId: 'use', date: '2026-04-01' })
    expect(r.swaps[0].date).toBe('2026-04-01')
    expect(r.swaps[0].specKey).toBe(specKey(inUse))
  })

  it('does not change its inputs', () => {
    const snapshot = JSON.stringify(items)
    finishItem(items, [], { itemId: 'use', promoteId: 'sa', date: '2026-03-10' })
    expect(JSON.stringify(items)).toBe(snapshot)
  })

  it('refuses a spare that does not match, rather than silently clearing', () => {
    const r = finishItem(items, [], { itemId: 'use', promoteId: 'oth', date: '2026-03-10' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/no longer available/)
    expect(r.items).toBe(items)
  })

  it('refuses a spare with nothing left', () => {
    const empty = [inUse, { ...spareA, qty: 0 }]
    expect(finishItem(empty, [], { itemId: 'use', promoteId: 'sa', date: '2026-03-10' }).ok).toBe(false)
  })

  it('only finishes a box that is in use', () => {
    expect(finishItem(items, [], { itemId: 'sa', date: '2026-03-10' }).ok).toBe(false)
    expect(finishItem(items, [], { itemId: 'nope', date: '2026-03-10' }).ok).toBe(false)
  })

  it('carries brand, vendor and cost onto the box now in use, and clears its verify flag', () => {
    const flagged = [inUse, { ...spareA, brand: 'Terumo', vendor: 'Shop', cost: 9.5, verify: true }]
    const r = finishItem(flagged, [], { itemId: 'use', promoteId: 'sa', date: '2026-03-10' })
    const now = r.items.find((i) => i.status === 'in_use')
    expect(now).toMatchObject({ brand: 'Terumo', vendor: 'Shop', cost: 9.5, verify: false })
  })

  it('appends to existing history rather than replacing it', () => {
    const history = [{ id: 'old', date: '2026-01-01', specKey: 'x' }]
    const r = finishItem(items, history, { itemId: 'use', promoteId: 'sa', date: '2026-03-10' })
    expect(r.swaps).toHaveLength(2)
    expect(r.swaps[0].id).toBe('old')
  })
})

describe('matching spares and low stock', () => {
  const use = item({ id: 'u', status: 'in_use', gauge: '29G', lengthMm: 13, category: 'Syringe needles' })

  it('lists only same-spec spares with something left, oldest first', () => {
    const items = [
      use,
      item({ id: 'new', status: 'stock', gauge: '29G', lengthMm: 13, createdAt: 9 }),
      item({ id: 'old', status: 'stock', gauge: '29G', lengthMm: 13, createdAt: 1 }),
      item({ id: 'zero', status: 'stock', gauge: '29G', lengthMm: 13, qty: 0 }),
      item({ id: 'diff', status: 'stock', gauge: '27G', lengthMm: 13 }),
      item({ id: 'otheruse', status: 'in_use', gauge: '29G', lengthMm: 13 }),
    ]
    expect(matchingSpares(items, use).map((i) => i.id)).toEqual(['old', 'new'])
  })

  it('flags an in-use item with nothing behind it', () => {
    expect(isLowStock([use], use)).toBe(true)
  })

  it('does not flag one that has a spare', () => {
    expect(isLowStock([use, item({ status: 'stock', gauge: '29G', lengthMm: 13 })], use)).toBe(false)
  })

  it('does not flag a spare, only boxes in use', () => {
    const spare = item({ status: 'stock', gauge: '29G', lengthMm: 13 })
    expect(isLowStock([spare], spare)).toBe(false)
  })

  it('flags the right ones on the real seed', () => {
    const items = seedGear()
    const low = lowStockIds(items).map((id) => describeItem(items.find((i) => i.id === id)))
    // 25G x 13 and 27G x 13 have spares behind them; everything else in use does not
    expect(low).not.toContain('25G · 13 mm')
    expect(low).not.toContain('27G · 13 mm')
    expect(low).toContain('29G · 13 mm')
    expect(low).toContain('Alcohol swabs')
    expect(low).toContain('Sharps container')
  })
})

// ----------------------------------------------------- how long a box lasts

describe('how long a box lasts', () => {
  const key = 'k'
  const swap = (date, k = key) => ({ id: date + k, date, specKey: k })
  const NOW = new Date('2026-06-01T12:00:00Z')

  it('is null with no history at all', () => {
    expect(estimateBox([], key, { now: NOW })).toBe(null)
  })

  it('is null with one finish: there is no box to measure yet', () => {
    expect(estimateBox([swap('2026-01-01')], key, { now: NOW })).toBe(null)
  })

  it('is null with two finishes: that is a single data point', () => {
    expect(boxDurations([swap('2026-01-01'), swap('2026-02-12')], key)).toEqual([42])
    expect(estimateBox([swap('2026-01-01'), swap('2026-02-12')], key, { now: NOW })).toBe(null)
  })

  it('needs at least two measured boxes, which is three finishes', () => {
    expect(MIN_INTERVALS).toBe(2)
    const e = estimateBox([swap('2026-01-01'), swap('2026-02-12'), swap('2026-03-26')], key, { now: NOW })
    expect(e).not.toBe(null)
    expect(e.avgDays).toBe(42)
    expect(e.boxes).toBe(3)
  })

  it('averages the gaps between finishes', () => {
    const e = estimateBox([swap('2026-01-01'), swap('2026-01-31'), swap('2026-03-02')], key, { now: NOW })
    expect(e.avgDays).toBe(30)
    const uneven = estimateBox([swap('2026-01-01'), swap('2026-01-21'), swap('2026-03-02')], key, { now: NOW })
    expect(uneven.avgDays).toBe(30) // 20 and 40
  })

  it('only counts finishes of the same spec', () => {
    const mixed = [swap('2026-01-01'), swap('2026-01-15', 'other'), swap('2026-02-12'), swap('2026-03-26'), swap('2026-04-02', 'other')]
    expect(boxDurations(mixed, key)).toEqual([42, 42])
    expect(boxDurations(mixed, 'other')).toEqual([77])
    expect(estimateBox(mixed, 'other', { now: NOW })).toBe(null)
  })

  it('does not count two finishes on one day as a box that lasted nothing', () => {
    expect(boxDurations([swap('2026-01-01'), swap('2026-01-01'), swap('2026-02-01')], key)).toEqual([31])
  })

  it('is order-independent', () => {
    const shuffled = [swap('2026-03-26'), swap('2026-01-01'), swap('2026-02-12')]
    expect(estimateBox(shuffled, key, { now: NOW }).avgDays).toBe(42)
  })

  it('estimates the run-out from when the current box was promoted', () => {
    const swaps = [swap('2026-01-01'), swap('2026-02-12'), swap('2026-03-26')]
    const e = estimateBox(swaps, key, { current: { usedFrom: '2026-05-10' }, now: NOW })
    expect(e.runsOutOn).toBe('2026-06-21')
    expect(e.daysLeft).toBe(20)
  })

  it('falls back to the last finish when the current box has no start date', () => {
    const swaps = [swap('2026-01-01'), swap('2026-02-12'), swap('2026-03-26')]
    const e = estimateBox(swaps, key, { current: { usedFrom: null }, now: NOW })
    expect(e.runsOutOn).toBe('2026-05-07')
    expect(e.daysLeft).toBeLessThan(0)
  })

  it('gives the average but no date when there is no current box', () => {
    const swaps = [swap('2026-01-01'), swap('2026-02-12'), swap('2026-03-26')]
    const e = estimateBox(swaps, key, { current: null, now: NOW })
    expect(e.avgDays).toBe(42)
    expect(e.runsOutOn).toBe(null)
  })

  it('says durations the way a person does', () => {
    expect(durationWords(1)).toBe('1 day')
    expect(durationWords(10)).toBe('10 days')
    expect(durationWords(42)).toBe('6 weeks')
    expect(durationWords(120)).toBe('4 months')
  })
})

// ------------------------------------------------------------ the dropdowns

describe('dropdown options', () => {
  it('offers the file\'s lists for each needle', () => {
    expect(optionsFor('pen_needle_gauge')).toEqual(['29G', '30G', '31G', '32G', '33G'])
    expect(optionsFor('pen_needle_length_mm')).toEqual([4, 5, 6, 8, 10, 12])
    expect(optionsFor('syringe_needle_gauge')[0]).toBe('18G')
    expect(optionsFor('syringe_needle_length_mm')).toEqual([4, 6, 8, 13, 16, 25, 38])
    expect(optionsFor('unit')).toEqual(['box', 'pack', 'each', 'vial', 'bottle'])
  })

  it('leads the syringe types with the preferred one', () => {
    expect(optionsFor('syringe_type')[0]).toBe('Luer lock 1 mL low dead space')
    expect(PREFERRED_SYRINGE_TYPE).toBe('Luer lock 1 mL low dead space')
  })

  it('merges in what has been added, in numeric order', () => {
    expect(optionsFor('pen_needle_length_mm', { extras: { pen_needle_length_mm: [7] } })).toEqual([4, 5, 6, 7, 8, 10, 12])
    expect(optionsFor('pen_needle_gauge', { extras: { pen_needle_gauge: ['28G'] } })[0]).toBe('28G')
  })

  it('offers names already in the inventory for name-based categories', () => {
    const items = [item({ category: 'Swabs & prep', name: 'Alcohol swabs' }), item({ category: 'Pens', name: 'Ozempic pen' })]
    expect(optionsFor('name_Swabs & prep', { items })).toEqual(['Alcohol swabs'])
    expect(optionsFor('name_Pens', { items })).toEqual(['Ozempic pen'])
  })

  it('tidies a typed-in value', () => {
    expect(normaliseOption('syringe_needle_gauge', '28')).toBe('28G')
    expect(normaliseOption('syringe_needle_gauge', ' 28g ')).toBe('28G')
    expect(normaliseOption('pen_needle_length_mm', '7 mm')).toBe(7)
    expect(normaliseOption('syringe_volume_ml', '2.5')).toBe(2.5)
    expect(normaliseOption('unit', ' Sleeve ')).toBe('sleeve')
  })

  it('refuses a value nobody could ever match against', () => {
    expect(normaliseOption('syringe_needle_gauge', 'thick')).toBe(null)
    expect(normaliseOption('pen_needle_length_mm', '-3')).toBe(null)
    expect(normaliseOption('pen_needle_length_mm', 'abc')).toBe(null)
    expect(normaliseOption('unit', '   ')).toBe(null)
  })

  it('adds an option once, and says what it was stored as', () => {
    const a = withOption({}, 'syringe_needle_gauge', '28')
    expect(a.value).toBe('28G')
    expect(a.extras.syringe_needle_gauge).toEqual(['28G'])
    const b = withOption(a.extras, 'syringe_needle_gauge', '28g')
    expect(b.value).toBe('28G')
    expect(b.extras).toBe(a.extras) // nothing added twice
  })

  it('does not add what the seed already offers', () => {
    const r = withOption({}, 'pen_needle_gauge', '32')
    expect(r.value).toBe('32G')
    expect(r.extras).toEqual({})
  })
})

// ------------------------------------------------------ adding and editing

describe('the add form', () => {
  it('defaults a syringe to the Luer lock 1 mL low dead space, at 1 mL', () => {
    const b = blankItem('Syringes')
    expect(b.syringeType).toBe('Luer lock 1 mL low dead space')
    expect(b.volumeMl).toBe(1)
  })

  it('needs gauge and length for a needle', () => {
    const problems = validateItem(blankItem('Pen needles'))
    expect(problems).toContain('Choose a gauge')
    expect(problems).toContain('Choose a length')
    expect(validateItem({ ...blankItem('Pen needles'), gauge: '32G', lengthMm: 6 })).toEqual([])
  })

  it('needs a name for Other, which is free text', () => {
    expect(validateItem(blankItem('Other'))).toContain('Choose a name')
    expect(validateItem({ ...blankItem('Other'), name: 'Tourniquet' })).toEqual([])
    expect(CATEGORY_FIELDS.Other[0].free).toBe(true)
  })

  it('accepts a quantity of zero but not a missing one', () => {
    const ok = { ...blankItem('Pen needles'), gauge: '32G', lengthMm: 6 }
    expect(validateItem({ ...ok, qty: 0 })).toEqual([])
    expect(validateItem({ ...ok, qty: '' })).toContain('Enter a quantity')
  })

  it('drops fields the category does not use, so a switch cannot change what it matches', () => {
    const cleaned = cleanItem({
      ...blankItem('Pen needles'), gauge: '32G', lengthMm: 6, syringeType: 'Luer slip 1 mL', volumeMl: 1, name: 'x',
    })
    expect(cleaned.syringeType).toBeUndefined()
    expect(cleaned.volumeMl).toBeUndefined()
    expect(cleaned.name).toBeUndefined()
    expect(cleaned.gauge).toBe('32G')
  })

  it('stores cost as a number, or null when blank', () => {
    expect(cleanItem({ ...blankItem('Other'), name: 'x', cost: '12.50' }).cost).toBe(12.5)
    expect(cleanItem({ ...blankItem('Other'), name: 'x', cost: '' }).cost).toBe(null)
  })
})

describe('describing and grouping', () => {
  it('describes each kind of item', () => {
    expect(describeItem(item({ gauge: '32G', lengthMm: 6 }))).toBe('32G · 6 mm')
    expect(describeItem(item({ category: 'Syringes', syringeType: 'Luer lock 1 mL low dead space', volumeMl: 1 })))
      .toBe('Luer lock 1 mL low dead space · 1 mL')
    expect(describeItem(item({ category: 'Swabs & prep', name: 'Alcohol swabs' }))).toBe('Alcohol swabs')
  })

  it('says a quantity with the right unit', () => {
    expect(quantityWords(item({ qty: 1, unit: 'box' }))).toBe('1 box')
    expect(quantityWords(item({ qty: 2, unit: 'box' }))).toBe('2 boxes')
    expect(quantityWords(item({ qty: 3, unit: 'each' }))).toBe('3 each')
    expect(quantityWords(item({ qty: 2, unit: 'pack' }))).toBe('2 packs')
  })

  it('groups one state by category, in the declared order, skipping empty ones', () => {
    const groups = groupByCategory(seedGear(), 'in_use')
    expect(groups.map((g) => g.category)).toEqual(['Pen needles', 'Syringe needles', 'Syringes', 'Swabs & prep', 'Sharps disposal'])
    expect(groups[0].items).toHaveLength(2)
    expect(groups[1].items).toHaveLength(4)
    const stock = groupByCategory(seedGear(), 'stock')
    expect(stock.map((g) => g.category)).toEqual(['Pen needles', 'Syringe needles'])
  })

  it('sorts a group by gauge and length as numbers, not text', () => {
    const rows = [
      item({ gauge: '25G', lengthMm: 13, status: 'stock' }),
      item({ gauge: '25G', lengthMm: 6, status: 'stock' }),
    ]
    const g = groupByCategory(rows, 'stock')[0].items.map((i) => i.lengthMm)
    expect(g).toEqual([6, 13])
  })
})
