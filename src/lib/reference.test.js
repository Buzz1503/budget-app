import { describe, it, expect } from 'vitest'
import {
  referenceFor, isExcludedTier, protocolTextFrom, enrichPeptide, confidenceParts,
  REFERENCE_COMPOUNDS, EVIDENCE_TIERS, tierMeta,
} from './reference'
import { LIB_TO_COMPOUND, loadMatrix } from './mixMatrix'

const matrix = await loadMatrix()

describe('peptide reference data', () => {
  it('loads all 84 compounds and 6 tier definitions', () => {
    expect(REFERENCE_COMPOUNDS.length).toBe(84)
    expect(Object.keys(EVIDENCE_TIERS)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'TX'])
  })

  it('every reference id exists in the mix matrix (ids line up)', () => {
    for (const c of REFERENCE_COMPOUNDS) {
      expect(matrix.byId.get(c.id), c.id).toBeTruthy()
    }
  })

  it('every seeded library peptide resolves to a reference', () => {
    for (const cid of Object.values(LIB_TO_COMPOUND)) {
      expect(referenceFor(cid), cid).toBeTruthy()
    }
  })

  it('every compound carries all reference fields', () => {
    for (const c of REFERENCE_COMPOUNDS) {
      for (const f of ['tier', 'human_data', 'dose', 'frequency', 'cycle', 'mechanism', 'confidence']) {
        expect(c[f], `${c.id}.${f}`).toBeTruthy()
      }
      expect(Array.isArray(c.established), c.id).toBe(true)
      expect(Array.isArray(c.reported), c.id).toBe(true)
      expect(Array.isArray(c.safety), c.id).toBe(true)
      expect(Array.isArray(c.monitor), c.id).toBe(true)
    }
  })

  it('keeps established and reported as separate arrays', () => {
    const r = referenceFor('semaglutide')
    expect(r.established.length).toBeGreaterThan(0)
    expect(r.reported.length).toBeGreaterThan(0)
    expect(r.established).not.toEqual(r.reported)
  })
})

describe('TX (excluded) handling', () => {
  const tx = REFERENCE_COMPOUNDS.filter((c) => c.tier === 'TX')

  it('there are TX compounds and they are flagged', () => {
    expect(tx.length).toBe(6)
    expect(isExcludedTier('TX')).toBe(true)
    expect(isExcludedTier('T1')).toBe(false)
  })

  it('never produces pre-fill dose text for a TX compound', () => {
    for (const c of tx) {
      const text = protocolTextFrom(c)
      expect(text.excluded, c.id).toBe(true)
      expect(text.doseText, c.id).toBe('')
      expect(text.frequencyText, c.id).toBe('')
      expect(text.cycleText, c.id).toBe('')
    }
  })

  it('TX compounds still surface a safety reason', () => {
    for (const c of tx) expect(c.safety.join(' ').length, c.id).toBeGreaterThan(20)
  })

  it('enriching a TX peptide attaches info but no dose text', () => {
    const patch = enrichPeptide({ id: tx[0].id })
    expect(patch.reference.tier).toBe('TX')
    expect(patch.reference.safety.length).toBeGreaterThan(0)
    expect(patch.doseText).toBeUndefined()
  })
})

describe('pre-fill and enrichment', () => {
  it('pre-fills descriptive text for a normal compound', () => {
    const text = protocolTextFrom(referenceFor('bpc157'))
    expect(text.excluded).toBe(false)
    expect(text.doseText.length).toBeGreaterThan(0)
    expect(text.frequencyText.length).toBeGreaterThan(0)
  })

  it('enrich never overwrites protocol text the user already set', () => {
    const patch = enrichPeptide({
      id: 'bpc157', doseText: 'my own dose', frequencyText: 'my own freq', cycleText: 'my own cycle',
    })
    expect(patch.doseText).toBeUndefined()
    expect(patch.frequencyText).toBeUndefined()
    expect(patch.cycleText).toBeUndefined()
    expect(patch.reference.mechanism).toBeTruthy() // info still attached
  })

  it('enrich fills only the empty descriptive fields', () => {
    const patch = enrichPeptide({ id: 'bpc157', doseText: 'mine' })
    expect(patch.doseText).toBeUndefined()
    expect(patch.frequencyText).toBeTruthy()
  })

  it('enrich returns null for a compound with no reference (custom peptide)', () => {
    expect(enrichPeptide({ id: 'custom-12345' })).toBe(null)
  })

  it('attaches evidence + community effects separately', () => {
    const patch = enrichPeptide({ id: 'bpc157' })
    expect(Array.isArray(patch.reference.established)).toBe(true)
    expect(Array.isArray(patch.reference.reported)).toBe(true)
  })
})

describe('presentation helpers', () => {
  it('splits a one-word confidence', () => {
    expect(confidenceParts('high')).toEqual({ word: 'high', detail: null })
  })
  it('splits a sentence-style confidence into chip + detail', () => {
    const p = confidenceParts('medium - dose steps genuinely unsettled in public sources')
    expect(p.word).toBe('medium')
    expect(p.detail).toMatch(/unsettled/)
  })
  it('handles an empty confidence', () => {
    expect(confidenceParts(null).word).toBe(null)
  })
  it('every real confidence string yields a chip or a detail', () => {
    for (const c of REFERENCE_COMPOUNDS) {
      const p = confidenceParts(c.confidence)
      expect(p.word || p.detail, c.id).toBeTruthy()
    }
  })
  it('maps every tier to display metadata', () => {
    for (const t of Object.keys(EVIDENCE_TIERS)) {
      expect(tierMeta(t).label).toBe(t)
      expect(tierMeta(t).tone).toBeTruthy()
    }
  })
})
