import { describe, it, expect } from 'vitest'
import {
  FORMS, LIBRARY, SLOTS, defaultSlotFor, slotForCategory, libraryShelf, searchLibrary,
  fromLibrary, blankSupplement, bySlot, dueInSlot, wasTaken, takenOn,
  activeCautions, stackedCautions, allCautions, supplementAdherence,
} from './supplements'
import { buildCalendar } from './calendarView'
import { concentration, doseToUnits, unitsToDoseMg, unitsToMl, toMg, fromMg } from './calc'
import { addDaysStr } from './schedule'

const T = '2026-06-18'
const day = (o) => addDaysStr(T, o)

const supp = (over = {}) => ({
  id: 's1', name: 'Glycine', brand: 'Switch', form: 'powder', dose: '3 g',
  doseNote: '', caution: '', category: 'sleep', slot: 'PM', addedOn: day(-30), ...over,
})
const log = (supplementId, offset) => ({
  id: `l${supplementId}${offset}`, supplementId, date: day(offset),
})

// ------------------------------------------------------- free-form calculator

// Manual mode adds no maths of its own — it removes the requirement for a
// named compound. These pin the arithmetic the screen displays either way.
describe('free-form calculator maths', () => {
  it('turns a vial and a volume into a concentration', () => {
    expect(concentration(10, 2)).toBe(5)
    expect(concentration(5, 2)).toBe(2.5)
    expect(concentration(50, 2)).toBe(25)
  })

  it('turns a target dose into insulin units and mL', () => {
    const conc = concentration(10, 2) // 5 mg/mL
    const units = doseToUnits(toMg(500, 'mcg'), conc)
    expect(units).toBeCloseTo(10, 6)
    expect(unitsToMl(units)).toBeCloseTo(0.1, 6)
  })

  it('runs the other way: units drawn back to a delivered dose', () => {
    const conc = concentration(10, 2)
    const mg = unitsToDoseMg(20, conc)
    expect(mg).toBeCloseTo(1, 6)
    expect(fromMg(mg, 'mcg')).toBeCloseTo(1000, 6)
  })

  it('round-trips a dose through units and back', () => {
    const conc = concentration(20, 2) // 10 mg/mL
    for (const mcg of [100, 250, 500, 1000, 2500]) {
      const units = doseToUnits(toMg(mcg, 'mcg'), conc)
      expect(fromMg(unitsToDoseMg(units, conc), 'mcg')).toBeCloseTo(mcg, 6)
    }
  })

  it('gives no answer rather than a wrong one when the vial is empty', () => {
    // an empty vial has no concentration, and dividing by it yields 0 rather
    // than Infinity — the screen shows "—" instead of a nonsense unit count
    expect(concentration(0, 2)).toBe(0)
    expect(doseToUnits(1, 0)).toBe(0)
    expect(unitsToDoseMg(10, 0)).toBe(0)
  })
})

// ------------------------------------------------------------- the library

describe('supplement library', () => {
  it('ships the owned shelf and the rest', () => {
    const { owned, available } = libraryShelf()
    expect(owned.length).toBe(12)
    expect(available.length).toBeGreaterThan(0)
    expect(owned.length + available.length).toBe(LIBRARY.length)
  })

  it('carries a form from the declared set for every entry', () => {
    for (const s of LIBRARY) expect(FORMS).toContain(s.form)
  })

  it('carries an optimal dose and a note on every entry', () => {
    for (const s of LIBRARY) {
      expect(s.optimal_dose?.length).toBeGreaterThan(0)
      expect(s.dose_note?.length).toBeGreaterThan(0)
    }
  })

  it('ranks what you already own above what you could add', () => {
    const hits = searchLibrary('magnesium')
    expect(hits.length).toBeGreaterThan(1)
    expect(hits[0].owned).toBe(true)
  })

  it('searches brand as well as name', () => {
    expect(searchLibrary('bioceuticals').length).toBeGreaterThan(0)
    expect(searchLibrary('thorne').map((s) => s.name)).toContain('B-Complex #12')
  })

  it('pre-fills brand, form, optimal dose, timing and note from a library row', () => {
    const row = LIBRARY.find((s) => s.id === 'd3k2')
    const entry = fromLibrary(row)
    expect(entry.brand).toBe('BioCeuticals')
    expect(entry.form).toBe('spray')
    expect(entry.dose).toBe('2 sprays daily')
    expect(entry.slot).toBe('AM')
    expect(entry.doseNote).toMatch(/blood level/i)
    expect(entry.libraryId).toBe('d3k2')
  })

  it('invents nothing for a hand-entered supplement', () => {
    const b = blankSupplement()
    expect(b.name).toBe('')
    expect(b.dose).toBe('')
    expect(b.brand).toBe('')
    expect(b.libraryId).toBe(null)
  })
})

// ----------------------------------------------------------------- slotting

describe('slotting', () => {
  it('puts daily supplements in the morning and sleep ones at night', () => {
    expect(slotForCategory('daily')).toBe('AM')
    expect(slotForCategory('sleep')).toBe('PM')
    expect(slotForCategory(undefined)).toBe('AM')
  })

  it('applies the category rule when the entry names no slot', () => {
    expect(defaultSlotFor({ category: 'daily' })).toBe('AM')
    expect(defaultSlotFor({ category: 'sleep' })).toBe('PM')
  })

  it("lets the library's own slot win where it disagrees with the rule", () => {
    // ashwagandha is `daily` but the data deliberately places it in the evening
    const ash = LIBRARY.find((s) => s.id === 'ashwagandha')
    expect(ash.category).toBe('daily')
    expect(ash.slot).toBe('PM')
    expect(defaultSlotFor(ash)).toBe('PM')
  })

  it('lands every sleep supplement in the evening', () => {
    for (const s of LIBRARY.filter((x) => x.category === 'sleep')) {
      expect(defaultSlotFor(s)).toBe('PM')
    }
  })

  it('splits a shelf into morning and evening', () => {
    const shelf = [supp({ id: 'a', name: 'A', slot: 'AM' }), supp({ id: 'b', name: 'B', slot: 'PM' })]
    const out = bySlot(shelf)
    expect(out.AM.map((s) => s.id)).toEqual(['a'])
    expect(out.PM.map((s) => s.id)).toEqual(['b'])
  })

  it('treats a missing slot as morning rather than dropping it', () => {
    const out = bySlot([supp({ id: 'x', slot: undefined })])
    expect(out.AM).toHaveLength(1)
    expect(dueInSlot([supp({ id: 'x', slot: undefined })], 'AM')).toHaveLength(1)
  })
})

// ----------------------------------------------------------------- cautions

describe('cautions', () => {
  const pillar = supp({ id: 'p', name: 'Triple Magnesium', caution: 'Keep total magnesium 300-400 mg.' })
  const magzorb = supp({ id: 'm', name: 'Magnesium Glycinate 500mg', caution: 'Counts toward your total magnesium.' })
  const berberine = supp({
    id: 'b', name: 'Berberine', category: 'daily', slot: 'AM',
    caution: 'Adds to the glucose-lowering effect of your retatrutide/tesamorelin/MOTS-c.',
  })

  it('surfaces a caution the library put on a single product', () => {
    const out = allCautions([berberine])
    expect(out).toHaveLength(1)
    expect(out[0].text).toMatch(/glucose-lowering/i)
  })

  it('raises a combination warning for two magnesium products', () => {
    const out = stackedCautions([pillar, magzorb])
    expect(out).toHaveLength(1)
    expect(out[0].text).toMatch(/more than one magnesium/i)
    expect(out[0].name).toMatch(/Triple Magnesium/)
  })

  it('does not warn about one magnesium product on its own', () => {
    expect(stackedCautions([pillar])).toEqual([])
  })

  it('says the magnesium warning once, not three times', () => {
    const out = allCautions([pillar, magzorb])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('stack-magnesium')
  })

  it('keeps an unrelated caution alongside a combination one', () => {
    const out = allCautions([pillar, magzorb, berberine])
    expect(out).toHaveLength(2)
    expect(out.some((c) => /glucose-lowering/i.test(c.text))).toBe(true)
  })

  it('says nothing when nothing on the shelf carries one', () => {
    expect(allCautions([supp()])).toEqual([])
  })
})

// ---------------------------------------------------------------- tracking

describe('taking a supplement', () => {
  it('reads back what was taken on a date', () => {
    const logs = [log('s1', 0), log('s2', -1)]
    expect(wasTaken(logs, 's1', T)).toBe(true)
    expect(wasTaken(logs, 's2', T)).toBe(false)
    expect(takenOn(logs, T)).toEqual(new Set(['s1']))
  })

  it('counts a day as scheduled only from the day it joined the shelf', () => {
    const s = supp({ id: 'new', addedOn: day(-2) })
    const out = supplementAdherence([s], [log('new', -1), log('new', 0)], day(-9), T)
    expect(out.rows[0].scheduled).toBe(3) // -2, -1, 0
    expect(out.rows[0].taken).toBe(2)
    expect(out.rows[0].pct).toBe(67)
  })

  it('never counts a supplement twice on one day', () => {
    const s = supp({ id: 'x', addedOn: day(-1) })
    const dupes = [log('x', 0), { ...log('x', 0), id: 'other' }]
    expect(supplementAdherence([s], dupes, day(-1), T).rows[0].taken).toBe(1)
  })

  it('reports the overall rate across the shelf', () => {
    const a = supp({ id: 'a', addedOn: day(-1) })
    const b = supp({ id: 'b', addedOn: day(-1) })
    const out = supplementAdherence([a, b], [log('a', 0), log('a', -1), log('b', 0)], day(-1), T)
    expect(out.overall.scheduled).toBe(4)
    expect(out.overall.taken).toBe(3)
    expect(out.overall.pct).toBe(75)
  })

  it('is empty rather than 0% when the shelf is empty', () => {
    expect(supplementAdherence([], [], day(-7), T).overall.pct).toBe(null)
  })
})

// ---------------------------------------------------------------- calendar

describe('supplements in the calendar', () => {
  const base = {
    peptides: [], titration: {}, doseLogs: [], openVials: {}, vials: {},
    restock: {}, todayStr: T,
  }

  it('counts an oral towards the day without inventing a shot', () => {
    const cal = buildCalendar({
      ...base, supplements: [supp({ id: 'g', addedOn: day(-5) })], supplementLogs: [],
      from: T, to: T,
    })
    const d = cal.byDate[T]
    expect(d.scheduled).toBe(1)
    expect(d.done).toBe(0)
    expect(d.shots).toBe(0) // a capsule is not an injection
    expect(d.entries).toEqual([]) // and never lands in the syringe list
    expect(d.oralEntries).toHaveLength(1)
  })

  it('marks the day complete once the oral is taken', () => {
    const cal = buildCalendar({
      ...base, supplements: [supp({ id: 'g', addedOn: day(-5) })],
      supplementLogs: [log('g', 0)], from: T, to: T,
    })
    expect(cal.byDate[T].done).toBe(1)
    expect(cal.byDate[T].adherence).toBe('all')
  })

  it('files the oral into its own slot bucket', () => {
    const cal = buildCalendar({
      ...base,
      supplements: [supp({ id: 'am', slot: 'AM', addedOn: day(-5) }), supp({ id: 'pm', slot: 'PM', addedOn: day(-5) })],
      supplementLogs: [], from: T, to: T,
    })
    expect(cal.byDate[T].orals.AM.map((e) => e.supplementId)).toEqual(['am'])
    expect(cal.byDate[T].orals.PM.map((e) => e.supplementId)).toEqual(['pm'])
  })

  it('does not count a day before the supplement was added as missed', () => {
    const cal = buildCalendar({
      ...base, supplements: [supp({ id: 'g', addedOn: T })], supplementLogs: [],
      from: day(-3), to: T,
    })
    expect(cal.byDate[day(-3)].scheduled).toBe(0)
    expect(cal.byDate[day(-3)].adherence).toBe('none')
    expect(cal.byDate[T].scheduled).toBe(1)
  })

  it('leaves the calendar unchanged when there are no supplements', () => {
    const cal = buildCalendar({ ...base, from: T, to: T })
    expect(cal.byDate[T].scheduled).toBe(0)
    expect(cal.byDate[T].oralEntries).toEqual([])
  })
})
