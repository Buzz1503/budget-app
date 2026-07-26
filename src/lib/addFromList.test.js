import { describe, it, expect } from 'vitest'
import { loadMatrix, LIB_TO_COMPOUND } from './mixMatrix'
import { needsProtocolSetup, isDueToday, isScheduledToday } from './daily'

const m = await loadMatrix()

// The blank protocol the Add-from-list flow creates (no invented dosing).
const BLANK = {
  frequency: 'daily', timing: '', cycleOnDays: 0, cycleOffDays: 0,
  ladder: { floor: 0, step: 0, intervalWeeks: 1, ceiling: 0, unit: 'mcg' },
  recon: { vialMg: 0, bacMl: 0, expiryDays: 28 },
}
const fromCompound = (c) => ({ ...BLANK, id: c.id, name: c.name, startDate: '2026-01-05' })

describe('adding a peptide from the compound list', () => {
  it('offers all 86 compounds', () => {
    expect(m.compounds.length).toBe(86)
  })

  it('search matches on name, class and id', () => {
    const q = (s) => m.compounds.filter(
      (c) => c.name.toLowerCase().includes(s) || c.class.toLowerCase().includes(s) || c.id.includes(s)
    )
    expect(q('cagri').some((c) => c.id === 'cagrilintide')).toBe(true)
    expect(q('tb500').some((c) => c.id === 'tb500')).toBe(true)
    expect(q('glp1').length).toBeGreaterThan(0)
    expect(q('zzzznope').length).toBe(0)
  })

  it('carrying the compound id makes the new peptide resolve in Mix with no manual mapping', () => {
    const tb500 = m.byId.get('tb500')
    const p = fromCompound(tb500)
    // this is exactly how MixTab / CoDrawModal resolve a library peptide
    const resolved = m.byId.get(LIB_TO_COMPOUND[p.id] || p.id)
    expect(resolved).toBeTruthy()
    expect(resolved.name).toMatch(/^TB-500/)
    // and it returns real verdicts against existing stack members
    const pair = m.lookup(LIB_TO_COMPOUND[p.id] || p.id, 'bpc157')
    expect(pair).toBeTruthy()
    expect(['MIX', 'CAUTION', 'DONT_MIX', 'NEVER']).toContain(pair.verdict)
  })

  it('every one of the 86 compounds resolves once added', () => {
    for (const c of m.compounds) {
      const p = fromCompound(c)
      expect(m.byId.get(LIB_TO_COMPOUND[p.id] || p.id), c.id).toBeTruthy()
    }
  })

  it('carries class/charge/flags for display without inventing dosing', () => {
    const c = m.byId.get('ipamorelin')
    const p = { ...fromCompound(c), compoundClass: c.class, charge: c.charge, flags: c.flags || [] }
    expect(p.compoundClass).toBe(c.class)
    expect(p.charge).toBe(c.charge)
    expect(p.ladder.floor).toBe(0)
    expect(p.ladder.ceiling).toBe(0)
    expect(p.recon.vialMg).toBe(0)
  })

  it('a blank protocol needs setup and stays out of the due list', () => {
    const p = fromCompound(m.byId.get('tb500'))
    expect(needsProtocolSetup(p)).toBe(true)
    expect(isDueToday(p, '2026-01-05')).toBe(false)
    // scheduling itself stays pure — the gate lives in isDueToday
    expect(isScheduledToday(p, '2026-01-05')).toBe(true)
  })

  it('once the user fills the protocol it becomes schedulable', () => {
    const p = {
      ...fromCompound(m.byId.get('tb500')),
      ladder: { floor: 250, step: 250, intervalWeeks: 1, ceiling: 500, unit: 'mcg' },
      recon: { vialMg: 10, bacMl: 2, expiryDays: 28 },
    }
    expect(needsProtocolSetup(p)).toBe(false)
    expect(isDueToday(p, '2026-01-05')).toBe(true)
  })

  it('a partly-filled protocol still counts as needing setup', () => {
    const base = fromCompound(m.byId.get('tb500'))
    expect(needsProtocolSetup({ ...base, ladder: { ...base.ladder, ceiling: 500 } })).toBe(true) // recon still blank
    expect(needsProtocolSetup({ ...base, recon: { vialMg: 10, bacMl: 2, expiryDays: 28 } })).toBe(true) // ladder still blank
  })

  it('seeded peptides already use compound ids, so duplicates are detectable by id', () => {
    for (const cid of Object.values(LIB_TO_COMPOUND)) expect(m.byId.get(cid)).toBeTruthy()
    const existing = new Set(Object.values(LIB_TO_COMPOUND))
    expect(existing.has('bpc157')).toBe(true)   // already in the stack
    expect(existing.has('tb500')).toBe(false)   // addable
  })
})
