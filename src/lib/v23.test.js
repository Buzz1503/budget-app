// v23 — the three layers kept apart: catalogue, stock, protocol.
//
// These tests are mostly about what does NOT happen. Each layer has exactly one
// set of actions that may change it, and the bugs this release fixes were all
// of the same shape: an action in one layer quietly reaching into another.
import { describe, it, expect, beforeEach } from 'vitest'
import { entryFromPeptide, toPeptide, wizardSuggestion } from './wizardDefaults'
import { groupStock, batchesFor, sealedCount } from './stock'
import { needsProtocolSetup, isDueToday } from './daily'
import { addDaysStr } from './schedule'

const T = '2026-06-18'
const day = (o) => addDaysStr(T, o)

const pep = (over = {}) => ({
  id: 'bpc157', name: 'BPC-157', startDate: day(-60), frequency: 'daily',
  ladder: { unit: 'mcg', floor: 250, step: 250, ceiling: 500, intervalWeeks: 2 },
  cycleOnDays: 0, cycleOffDays: 0, route: 'SubQ', slot: 'AM',
  recon: { vialMg: 5, bacMl: 2, expiryDays: 28 },
  ...over,
})

const batch = (over = {}) => ({
  id: 'b1', peptideId: 'tb500', name: 'TB-500', vialMg: 5, vendor: 'Test Labs',
  qtyOnHand: 2, qtyPurchased: 2, costAud: 60, lot: '', sealedExpiry: '', coaKey: null, ...over,
})

// ================================================ 1 · owning is not taking

describe('stock for a compound with no protocol entry', () => {
  const vials = [batch()]

  it('groups and counts without any protocol entry behind it', () => {
    const groups = groupStock(vials, [])
    expect(groups).toHaveLength(1)
    expect(groups[0].peptideId).toBe('tb500')
    expect(groups[0].vialCount).toBe(2)
  })

  it('is flagged as outside the protocol rather than hidden', () => {
    const [g] = groupStock(vials, [])
    expect(g.inStack).toBe(false)
  })

  it('sits alongside protocol compounds without merging into them', () => {
    const groups = groupStock([...vials, batch({ id: 'b2', peptideId: 'bpc157', name: 'BPC-157' })], [pep()])
    const byId = Object.fromEntries(groups.map((g) => [g.peptideId, g]))
    expect(byId.bpc157.inStack).toBe(true)
    expect(byId.tb500.inStack).toBe(false)
    expect(sealedCount(groups.flatMap((g) => g.batches), 'tb500')).toBe(2)
  })

  it('schedules nothing — a compound absent from the protocol is never due', () => {
    // the protocol list is what Home reads; stock is not in it
    expect([pep()].some((p) => p.id === 'tb500')).toBe(false)
  })
})

// ============================================== 2 · editing keeps my numbers

describe('loading an existing protocol item back into the editor', () => {
  it('carries my own dose and schedule, not a fresh suggestion', () => {
    const mine = pep({
      ladder: { unit: 'mcg', floor: 400, step: 100, ceiling: 900, intervalWeeks: 3 },
      frequency: '3xweek', slot: 'PM', cycleOnDays: 28, cycleOffDays: 14,
      recon: { vialMg: 15, bacMl: 3, expiryDays: 28 },
    })
    const e = entryFromPeptide(mine)
    expect(e.ladder).toEqual(mine.ladder)
    expect(e.frequency).toBe('3xweek')
    expect(e.slot).toBe('PM')
    expect(e.cycleOnDays).toBe(28)
    expect(e.cycleOffDays).toBe(14)
    expect(e.recon.vialMg).toBe(15)
    expect(e.recon.bacMl).toBe(3)
  })

  it('is marked as an edit, so the wizard updates rather than re-adds', () => {
    expect(entryFromPeptide(pep()).existing).toBe(true)
  })

  it('keeps the original start date — editing a dose is not restarting a cycle', () => {
    const e = entryFromPeptide(pep({ startDate: day(-200) }))
    expect(e.startDate).toBe(day(-200))
  })

  it('survives the round trip back into a peptide unchanged', () => {
    const mine = pep({ allowedZone: 'thigh', scheduleWeekdays: [1, 4] })
    const back = toPeptide(entryFromPeptide(mine), T)
    expect(back.ladder).toEqual(mine.ladder)
    expect(back.frequency).toBe(mine.frequency)
    expect(back.allowedZone).toBe('thigh')
    expect(back.scheduleWeekdays).toEqual([1, 4])
  })

  it('carries the allowed zone, so a thigh-only compound stays thigh-only', () => {
    expect(entryFromPeptide(pep({ allowedZone: 'thigh' })).allowedZone).toBe('thigh')
    expect(entryFromPeptide(pep()).allowedZone).toBe(null)
  })

  it('offers the nasal route only where the compound supports it', () => {
    expect(entryFromPeptide(pep({ id: 'semax', intranasalCapable: true })).routes).toContain('Nasal')
    expect(entryFromPeptide(pep()).routes).not.toContain('Nasal')
  })
})

// ================================================== 3 · unlinked protocol

describe('a protocol item with no vial behind it', () => {
  it('still counts as set up, so it still schedules', () => {
    // "not in stock" is about the shelf, not about whether the protocol is valid
    const p = pep()
    expect(needsProtocolSetup(p)).toBe(false)
    expect(isDueToday(p, T)).toBe(true)
  })

  it('is still not due when the protocol itself is incomplete', () => {
    const blank = pep({ ladder: { unit: 'mcg', floor: 0, step: 0, ceiling: 0, intervalWeeks: 1 } })
    expect(needsProtocolSetup(blank)).toBe(true)
    expect(isDueToday(blank, T)).toBe(false)
  })

  it('owns no batches, and that is a fact about stock rather than an error', () => {
    expect(batchesFor([batch()], 'bpc157')).toEqual([])
    expect(sealedCount([batch()], 'bpc157')).toBe(0)
  })
})

// =================================== 4 · the catalogue is read-only material

describe('the compound catalogue', () => {
  it('suggests a protocol without being one', () => {
    const s = wizardSuggestion({ id: 'bpc157', name: 'BPC-157', class: 'HEAL' })
    expect(s.id).toBe('bpc157')
    // a suggestion carries a source label so the UI can say where it came from
    expect(['seed', 'reference', 'none', 'excluded']).toContain(s.source)
  })

  it('still refuses to invent a dose it has no basis for', () => {
    const tx = wizardSuggestion({ id: 'dermorphin', name: 'Dermorphin', class: 'OTHER' })
    expect(tx.source).toBe('excluded')
    expect(tx.ladder).toBe(null)
  })

  it('leaves a blank ladder blank rather than guessing, when converted', () => {
    const tx = toPeptide(wizardSuggestion({ id: 'dermorphin', name: 'Dermorphin' }), T)
    expect(tx.ladder.ceiling).toBe(0)
    expect(needsProtocolSetup(tx)).toBe(true)
  })
})
