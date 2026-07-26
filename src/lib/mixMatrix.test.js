import { describe, it, expect } from 'vitest'
import { loadMatrix, key, confidenceFor, LIB_TO_COMPOUND, reasonFx, compoundColor } from './mixMatrix'

const m = await loadMatrix()

describe('mix matrix engine', () => {
  it('loads all compounds and pairs', () => {
    expect(m.compounds.length).toBe(86)
    expect(m.byId.get('retatrutide')).toBeTruthy()
  })

  it('lookup is order-independent', () => {
    const ab = m.lookup('retatrutide', 'tesamorelin')
    const ba = m.lookup('tesamorelin', 'retatrutide')
    expect(ab).toBe(ba)
    expect(ab.verdict).toBe('DONT_MIX')
    expect(ab.reason_code).toBe('R01')
  })

  it('returns the four verdict types correctly', () => {
    expect(m.lookup('bpc157', 'kpv').verdict).toBe('MIX')
    expect(m.lookup('ghkcu', 'ss31').verdict).toBe('CAUTION')
    expect(m.lookup('retatrutide', 'tesamorelin').verdict).toBe('DONT_MIX')
    // find a NEVER pair (R13)
    const never = [...m.byId.keys()].flatMap((x) =>
      [...m.byId.keys()].map((y) => (x < y ? m.lookup(x, y) : null))
    ).find((p) => p && p.verdict === 'NEVER')
    expect(never).toBeTruthy()
  })

  it('every library peptide maps to a real compound', () => {
    for (const cid of Object.values(LIB_TO_COMPOUND)) {
      expect(m.byId.get(cid), cid).toBeTruthy()
    }
  })

  it('every stack pair resolves to a verdict + note', () => {
    const ids = Object.values(LIB_TO_COMPOUND)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const p = m.lookup(ids[i], ids[j])
        expect(p, `${ids[i]}+${ids[j]}`).toBeTruthy()
        expect(['MIX', 'CAUTION', 'DONT_MIX', 'NEVER']).toContain(p.verdict)
        expect(p.note || p.reason).toBeTruthy()
      }
    }
  })

  it('same compound returns null (cannot mix with itself)', () => {
    expect(m.lookup('selank', 'selank')).toBe(null)
  })

  it('key() sorts deterministically', () => {
    expect(key('b', 'a')).toBe(key('a', 'b'))
    expect(key('a', 'b')).toBe('a|b')
  })

  it('flags proven blends and models', () => {
    expect(confidenceFor('selank', 'semax').level).toBe('proven')
    expect(confidenceFor('bpc157', 'tb500').level).toBe('proven')
    expect(confidenceFor('retatrutide', 'tesamorelin').level).toBe('model')
  })

  it('maps reason codes to animation flavors', () => {
    expect(reasonFx('R01').fx).toBe('gel')
    expect(reasonFx('R00').fx).toBe('blend')
    expect(reasonFx('R13').fx).toBe('forbidden')
    expect(reasonFx('ZZZ').fx).toBe('react') // graceful default
  })

  it('gives each compound a stable colour', () => {
    const c = m.byId.get('ghkcu')
    expect(compoundColor(c)).toBe(compoundColor(c))
    expect(compoundColor(c)).toMatch(/^hsl/)
  })
})
