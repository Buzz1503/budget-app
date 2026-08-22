import { describe, it, expect } from 'vitest'
import {
  batchesFor, sealedCount, sealedMg, breakdownText, summaryLine, groupStock, blankBatch,
  mlDrawnSince, vialVolumeMl, activeVialStatus, coverageFor, coverageWords,
  lowStockAlerts, replacementsFor, activationPreview,
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
  qtyOnHand: 2, qtyPurchased: 2, costAud: 180, lot: '', sealedExpiry: '', coaKey: null, ...over,
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
    expect(b.costAud).toBe(0)
    expect(b.coaKey).toBe(null)
  })
})

// ==================================================== 2 · the active vial

describe('what is left in the open vial', () => {
  const open = { vialMg: 10, batchId: 'a', activatedAt: `${day(-30)}T00:00:00.000Z`, reconstitutedAt: day(-30) }

  it('adds up the volume actually drawn since the vial was opened', () => {
    const logs = [dose(-20), dose(-13), dose(-6)] // 3 × 20 units
    expect(mlDrawnSince(logs, 'reta', open.activatedAt)).toBeCloseTo(0.6, 6)
  })

  it('ignores doses logged before this vial was opened', () => {
    const logs = [dose(-40), dose(-6)]
    expect(mlDrawnSince(logs, 'reta', open.activatedAt)).toBeCloseTo(0.2, 6)
  })

  it('ignores other peptides entirely', () => {
    const logs = [dose(-6), dose(-6, 20, 'bpc157')]
    expect(mlDrawnSince(logs, 'reta', open.activatedAt)).toBeCloseTo(0.2, 6)
  })

  it('counts the doses left from the logs, not from a stored counter', () => {
    const st = activeVialStatus(pep(), tState, open, [dose(-20), dose(-13), dose(-6)])
    expect(st.capacityMl).toBe(2)
    expect(st.drawnMl).toBeCloseTo(0.6, 3)
    expect(st.leftMl).toBeCloseTo(1.4, 3)
    expect(st.perDoseUnits).toBe(20)
    expect(st.dosesLeft).toBe(7) // 1.4 mL ÷ 0.2 mL
  })

  it('re-reads the drain rate when the dose changes, with no recalibration', () => {
    const logs = [dose(-20), dose(-13), dose(-6)]
    const small = activeVialStatus(pep(), tState, open, logs)
    // double the dose: the same remaining volume is now half as many doses
    const bigger = pep({ ladder: { unit: 'mg', floor: 2, step: 0, ceiling: 2, intervalWeeks: 4 } })
    const large = activeVialStatus(bigger, tState, open, logs)
    expect(large.perDoseUnits).toBe(small.perDoseUnits * 2)
    expect(large.dosesLeft).toBe(Math.floor(small.dosesLeft / 2))
  })

  it('follows a change of frequency without touching the vial maths', () => {
    // frequency drives coverage, not what is left in the open vial
    const logs = [dose(-6)]
    const weekly = activeVialStatus(pep(), tState, open, logs)
    const daily = activeVialStatus(pep({ frequency: 'daily' }), tState, open, logs)
    expect(daily.dosesLeft).toBe(weekly.dosesLeft)
  })

  it('reports an empty vial rather than a negative one', () => {
    const logs = Array.from({ length: 12 }, (_, i) => dose(-i))
    const st = activeVialStatus(pep(), tState, open, logs)
    expect(st.leftMl).toBe(0)
    expect(st.dosesLeft).toBe(0)
    expect(st.empty).toBe(true)
  })

  it('has nothing to say about a nasal spray', () => {
    expect(activeVialStatus(pep({ route: 'Nasal' }), tState, open, [])).toBe(null)
  })

  it('treats a never-opened vial as full', () => {
    const st = activeVialStatus(pep(), tState, { vialMg: 10, activatedAt: null }, [dose(-40)])
    // with no activation clock every log counts, which is the safe over-count;
    // once a vial is actually activated the clock scopes it properly
    expect(st.capacityMl).toBe(2)
  })

  it('uses the vial volume as supplied for a pre-mixed compound', () => {
    const oil = pep({ preparation: 'premixed', recon: { vialMg: 2500, bacMl: 10, expiryDays: 0 } })
    expect(vialVolumeMl(oil, { vialMg: 2500 })).toBe(10)
  })
})

// ======================================================= 3 · low stock

describe('coverage off the sealed shelf', () => {
  const vials = [batch({ qtyOnHand: 2, vialMg: 10 })] // 20 mg sealed

  it('counts weeks from sealed mg and the weekly burn', () => {
    // 1 mg weekly → 20 weeks
    const cov = coverageFor(pep(), tState, vials, T)
    expect(cov.mgOnShelf).toBe(20)
    expect(cov.weeks).toBe(20)
  })

  it('shortens as the dose goes up, with no other change', () => {
    const bigger = pep({ ladder: { unit: 'mg', floor: 2, step: 0, ceiling: 2, intervalWeeks: 4 } })
    expect(coverageFor(bigger, tState, vials, T).weeks).toBe(10)
  })

  it('shortens as the frequency goes up', () => {
    const daily = pep({ frequency: 'daily' })
    expect(coverageFor(daily, tState, vials, T).weeks).toBeLessThan(
      coverageFor(pep(), tState, vials, T).weeks
    )
  })

  it('ignores the open vial — it is already draining and reports itself', () => {
    // coverage takes no openVial argument at all; the shelf is the shelf
    expect(coverageFor(pep(), tState, [batch({ qtyOnHand: 0 })], T).mgOnShelf).toBe(0)
  })

  it('puts the runway in words a person would use', () => {
    expect(coverageWords(0.5)).toBe('under a week')
    expect(coverageWords(1.4)).toBe('~1 week')
    expect(coverageWords(2.2)).toBe('~2 weeks')
    expect(coverageWords(12)).toBe('~3 months')
    expect(coverageWords(Infinity)).toBe('plenty')
  })
})

describe('the low-stock alert', () => {
  const args = (over = {}) => ({
    peptides: [pep({ frequency: 'daily' })],
    titration: { reta: tState },
    vials: [batch({ qtyOnHand: 1, vialMg: 10 })], // 10 mg ≈ 10 days at 1 mg daily
    todayStr: T,
    leadDays: 30,
    ...over,
  })

  it('fires when the shelf runs shorter than the reorder lead time', () => {
    const [a] = lowStockAlerts(args())
    expect(a).toBeTruthy()
    expect(a.name).toBe('Retatrutide')
    expect(a.message).toMatch(/left across your vials — reorder/)
  })

  it('says nothing when there is plenty', () => {
    expect(lowStockAlerts(args({ vials: [batch({ qtyOnHand: 20, vialMg: 10 })] }))).toEqual([])
  })

  it('follows the lead time rather than a fixed threshold', () => {
    expect(lowStockAlerts(args({ leadDays: 3 }))).toEqual([])
    expect(lowStockAlerts(args({ leadDays: 30 }))).toHaveLength(1)
  })

  it('calls an empty shelf out separately', () => {
    const [a] = lowStockAlerts(args({ vials: [batch({ qtyOnHand: 0 })] }))
    expect(a.level).toBe('out')
    expect(a.message).toMatch(/No sealed Retatrutide left/)
  })

  it('puts the most urgent first', () => {
    const out = lowStockAlerts(args({
      peptides: [pep({ frequency: 'daily' }), pep({ id: 'x', name: 'X', frequency: 'daily' })],
      titration: { reta: tState, x: tState },
      vials: [batch({ qtyOnHand: 2, vialMg: 10 }), batch({ id: 'x1', peptideId: 'x', qtyOnHand: 1, vialMg: 5 })],
    }))
    expect(out[0].name).toBe('X')
  })

  it('skips a nasal spray, which is not drawn from a vial', () => {
    expect(lowStockAlerts(args({ peptides: [pep({ route: 'Nasal', frequency: 'daily' })] }))).toEqual([])
  })
})

// ==================================================== 4 · the replace flow

describe('replacing a finished vial', () => {
  const vials = [
    batch({ id: 'a', vialMg: 10, vendor: 'Vendor A', qtyOnHand: 2 }),
    batch({ id: 'b', vialMg: 20, vendor: 'Vendor B', qtyOnHand: 1 }),
    batch({ id: 'empty', vialMg: 5, qtyOnHand: 0 }),
    batch({ id: 'other', peptideId: 'bpc157', qtyOnHand: 4 }),
  ]

  it('offers every sealed batch of the same peptide, whatever the size', () => {
    const opts = replacementsFor(vials, 'reta')
    expect(opts.map((b) => b.id).sort()).toEqual(['a', 'b'])
  })

  it('never offers an empty batch or another peptide', () => {
    const ids = replacementsFor(vials, 'reta').map((b) => b.id)
    expect(ids).not.toContain('empty')
    expect(ids).not.toContain('other')
  })

  it('offers the batch closest to its sealed expiry first', () => {
    const dated = [
      batch({ id: 'later', sealedExpiry: '2027-01-01', qtyOnHand: 1 }),
      batch({ id: 'sooner', sealedExpiry: '2026-09-01', qtyOnHand: 1 }),
    ]
    expect(replacementsFor(dated, 'reta')[0].id).toBe('sooner')
  })

  it('has nothing to offer when the shelf is bare', () => {
    expect(replacementsFor([batch({ qtyOnHand: 0 })], 'reta')).toEqual([])
  })

  it('says a same-size replacement changes nothing', () => {
    const pv = activationPreview(pep(), tState, batch({ vialMg: 10 }))
    expect(pv.sameSize).toBe(true)
    expect(pv.oldUnits).toBe(pv.newUnits)
  })

  it('recomputes concentration and units when the size differs', () => {
    // 10 mg → 20 mg in the same 2 mL: 5 → 10 mg/mL, so 1 mg is 20 → 10 units
    const pv = activationPreview(pep(), tState, batch({ vialMg: 20 }))
    expect(pv.sameSize).toBe(false)
    expect(pv.oldConc).toBe(5)
    expect(pv.newConc).toBe(10)
    expect(pv.oldUnits).toBe(20)
    expect(pv.newUnits).toBe(10)
  })

  it('halves the units for a doubled vial, and doubles them for a halved one', () => {
    expect(activationPreview(pep(), tState, batch({ vialMg: 5 })).newUnits).toBe(40)
    expect(activationPreview(pep(), tState, batch({ vialMg: 40 })).newUnits).toBe(5)
  })

  it('keeps the dose itself untouched — only the draw changes', () => {
    const pv = activationPreview(pep(), tState, batch({ vialMg: 20 }))
    expect(pv.dose).toBe(1)
    expect(pv.unit).toBe('mg')
  })

  it('agrees with the calculator it is previewing', () => {
    const bigger = { ...pep(), recon: { ...pep().recon, vialMg: 20 } }
    const pv = activationPreview(pep(), tState, batch({ vialMg: 20 }))
    expect(pv.newUnits).toBeCloseTo(unitsFor(bigger, 1), 1)
    expect(pv.newConc).toBeCloseTo(concentration(20, 2), 3)
  })
})
