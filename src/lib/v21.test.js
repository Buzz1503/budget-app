import { describe, it, expect } from 'vitest'
import {
  batchesFor, sealedCount, sealedMg, breakdownText, summaryLine, groupStock, blankBatch,
} from './stock'
import { unitsFor, concentration } from './calc'
import { addDaysStr } from './schedule'

const T = '2026-06-18'
const day = (o) => addDaysStr(T, o)

// 10 mg in 2 mL = 5 mg/mL; a 1 mg dose is 0.2 mL = 20 units
const pep = (over = {}) => ({
  id: 'reta', name: 'Retatrutide', startDate: day(-60), frequency: 'weekly',
  ladder: { unit: 'mg', floor: 1, step: 0, ceiling: 1, intervalWeeks: 4 },
  cycleOnDays: 0, cycleOffDays: 0, route: 'SubQ',
  recon: { vialMg: 10, bacMl: 2, expiryDays: 28 },
  ...over,
})
const tState = { level: 0, levelStartDate: day(-60) }

const batch = (over = {}) => ({
  id: 'b1', peptideId: 'reta', name: 'Retatrutide', vialMg: 10, vendor: 'Vendor A',
  qtyOnHand: 2, qtyPurchased: 2, usdPerVial: 180, lot: '', sealedExpiry: '', coaKey: null, ...over,
})
const dose = (offset, units = 20, peptideId = 'reta') => ({
  id: `d${offset}`, peptideId, date: day(offset),
  loggedAt: `${day(offset)}T09:00:00.000Z`, insulinUnits: units,
})

// ============================================================ 1 · batches

describe('batches of the same peptide', () => {
  const vials = [
    batch({ id: 'a', vialMg: 10, vendor: 'Vendor A', qtyOnHand: 2 }),
    batch({ id: 'b', vialMg: 20, vendor: 'Vendor B', qtyOnHand: 1 }),
    batch({ id: 'c', peptideId: 'bpc157', name: 'BPC-157', vialMg: 5, qtyOnHand: 3 }),
  ]

  it('keeps two batches of one peptide apart', () => {
    const mine = batchesFor(vials, 'reta')
    expect(mine).toHaveLength(2)
    expect(mine.map((b) => b.vialMg)).toEqual([10, 20])
  })

  it('totals the vials across batches', () => {
    expect(sealedCount(vials, 'reta')).toBe(3)
    expect(sealedCount(vials, 'bpc157')).toBe(3)
    expect(sealedCount(vials, 'nothing')).toBe(0)
  })

  it('totals the mg across batches of different sizes', () => {
    // 2 × 10 + 1 × 20
    expect(sealedMg(vials, 'reta')).toBe(40)
  })

  it('spells out the breakdown so a single total is never misleading', () => {
    expect(breakdownText(batchesFor(vials, 'reta')))
      .toBe('2× 10 mg (Vendor A), 1× 20 mg (Vendor B)')
  })

  it('reads as the sentence the spec asked for', () => {
    expect(summaryLine('Retatrutide', batchesFor(vials, 'reta')))
      .toBe('Retatrutide — 3 vials: 2× 10 mg (Vendor A), 1× 20 mg (Vendor B)')
  })

  it('leaves empty batches out of the breakdown', () => {
    const withEmpty = [...batchesFor(vials, 'reta'), batch({ id: 'z', vialMg: 5, qtyOnHand: 0 })]
    expect(breakdownText(withEmpty)).not.toMatch(/0×/)
  })

  it('omits an empty bracket when a batch has no vendor', () => {
    expect(breakdownText([batch({ vendor: '', qtyOnHand: 1 })])).toBe('1× 10 mg')
  })

  it('says so plainly when there is nothing left', () => {
    expect(summaryLine('Retatrutide', [])).toBe('Retatrutide — none in stock')
    expect(summaryLine('Retatrutide', [batch({ qtyOnHand: 0 })])).toBe('Retatrutide — none in stock')
  })
})

describe('grouping for the screen', () => {
  const peptides = [pep(), pep({ id: 'bpc157', name: 'BPC-157' })]
  const vials = [
    batch({ id: 'a', vialMg: 10, vendor: 'Vendor A', qtyOnHand: 2 }),
    batch({ id: 'b', vialMg: 20, vendor: 'Vendor B', qtyOnHand: 1 }),
  ]

  it('groups batches under their peptide', () => {
    const g = groupStock(vials, peptides).find((x) => x.peptideId === 'reta')
    expect(g.batchCount).toBe(2)
    expect(g.vialCount).toBe(3)
    expect(g.mg).toBe(40)
  })

  it('still lists a stack peptide with nothing on the shelf', () => {
    const g = groupStock(vials, peptides).find((x) => x.peptideId === 'bpc157')
    expect(g).toBeTruthy()
    expect(g.vialCount).toBe(0)
    expect(g.summary).toMatch(/none in stock/)
  })

  it('lists stock for something no longer in the stack, and marks it', () => {
    const orphan = [batch({ id: 'o', peptideId: 'gone', name: 'Old Peptide', qtyOnHand: 1 })]
    const g = groupStock(orphan, peptides).find((x) => x.peptideId === 'gone')
    expect(g.inStack).toBe(false)
    expect(g.name).toBe('Old Peptide')
  })

  it('puts what you are running first', () => {
    const all = groupStock([batch({ id: 'o', peptideId: 'gone', name: 'AAA Old' })], peptides)
    expect(all[0].inStack).toBe(true)
  })

  it('pre-fills a new batch from the library, and invents nothing else', () => {
    const b = blankBatch(pep())
    expect(b.vialMg).toBe(10)
    expect(b.peptideId).toBe('reta')
    expect(b.vendor).toBe('')
    // unpriced rather than zero: 'Retatrutide' at 10 mg is in the reference
    // table, so a blank batch opens with the table's price, not with free
    expect(b.usdPerVial).toBe(10)
    expect(b.coaKey).toBe(null)
  })
})

