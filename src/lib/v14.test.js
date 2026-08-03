import { describe, it, expect } from 'vitest'
import {
  stackSymptoms, stackSymptomIndex, attributeSymptom, attributeAll, attributionSnapshot,
  effectIdFor, compoundEffects, symptomLabel, symptomIcon, distinctiveness,
  recencyScore, proximityScore, likelihoodFor, lastChange, tierWeight,
  RECENCY_WINDOW, WEIGHTS, ATTRIBUTION_CAVEAT, TIER_WORDS, SYMPTOM_META, EFFECT_COMPOUNDS,
} from './attribution'
import { drawMessage, bagProgress, MESSAGES } from './motivation'
import { addDaysStr } from './schedule'

const T = '2026-05-20'

function peptide(id, name, over = {}) {
  return {
    id, name, frequency: 'daily', timing: 'AM', slot: 'AM',
    startDate: addDaysStr(T, -200), cycleOnDays: 0, cycleOffDays: 0, route: 'SubQ',
    ladder: { floor: 250, step: 0, intervalWeeks: 2, ceiling: 250, unit: 'mcg' },
    recon: { vialMg: 10, bacMl: 2, expiryDays: 28 },
    ...over,
  }
}
const tit = (id, date) => ({ [id]: { level: 0, levelStartDate: date } })
const dosedToday = (id) => ({ peptideId: id, date: T })

// ---------- data + mapping ----------
describe('side-effect data mapping', () => {
  it('maps the app\'s oil injectable onto the teste entry', () => {
    expect(effectIdFor('testosterone-e')).toBe('teste')
    expect(compoundEffects('testosterone-e').name).toBe('Testosterone Enanthate')
  })

  it('maps every other compound onto its own id', () => {
    for (const id of ['bpc157', 'retatrutide', 'semax', 'nad', 'tesamorelin', 'ghkcu', 'dsip']) {
      expect(effectIdFor(id)).toBe(id)
    }
  })

  it('returns nothing for a compound with no effect data', () => {
    expect(effectIdFor('custom-12345')).toBeNull()
    expect(compoundEffects('custom-12345')).toBeNull()
  })

  it('every symptom referenced by a compound exists in the symptom table', () => {
    for (const [id, c] of Object.entries(EFFECT_COMPOUNDS)) {
      for (const s of [...c.positive, ...c.negative]) {
        expect(SYMPTOM_META[s], `${id} references unknown symptom ${s}`).toBeTruthy()
      }
    }
  })

  it('gives every symptom a plain label and an icon', () => {
    for (const id of Object.keys(SYMPTOM_META)) {
      expect(symptomLabel(id)).toBeTruthy()
      expect(symptomLabel(id)).not.toBe(id) // a label, not the raw key
      expect(symptomIcon(id)).toBeTruthy()
    }
  })

  it('every tier used in the data has a weight and plain words', () => {
    for (const c of Object.values(EFFECT_COMPOUNDS)) {
      expect(TIER_WORDS[c.tier], `no words for ${c.tier}`).toBeTruthy()
      expect(tierWeight(c.tier)).toBeGreaterThan(0)
    }
  })
})

// ---------- stack-relevant list ----------
describe('stackSymptoms', () => {
  const stack = [peptide('bpc157', 'BPC-157'), peptide('testosterone-e', 'Testosterone Enanthate')]

  it('offers only what the stack is known for, grouped by type', () => {
    const { positive, negative } = stackSymptoms(stack)
    const pos = positive.map((s) => s.id)
    const neg = negative.map((s) => s.id)
    // BPC-157's positives and Test E's positives, and nothing else
    expect(pos).toEqual(expect.arrayContaining(['recovery', 'less_joint_pain', 'gut_relief', 'muscle_strength', 'libido_up']))
    expect(neg).toEqual(expect.arrayContaining(['head_pressure', 'acne', 'high_hct', 'mood_swings']))
    // nothing from a compound that isn't in the stack
    expect([...pos, ...neg]).not.toContain('tanning') // melanotan
    expect([...pos, ...neg]).not.toContain('nasal_irritation') // semax
    expect(positive.every((s) => s.polarity === 'pos')).toBe(true)
    expect(negative.every((s) => s.polarity === 'neg')).toBe(true)
  })

  it('is a union, not a duplicate list, when two compounds share an effect', () => {
    const shared = stackSymptoms([peptide('bpc157', 'BPC-157'), peptide('tb500', 'TB-500')])
    const ids = shared.positive.map((s) => s.id)
    expect(ids.filter((i) => i === 'recovery')).toHaveLength(1)
  })

  it('carries plain labels and is sorted for scanning', () => {
    const { negative } = stackSymptoms(stack)
    expect(negative.find((s) => s.id === 'high_hct').label).toBe('Thick blood / high haematocrit (flag on bloods)')
    const labels = negative.map((s) => s.label)
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)))
  })

  it('is empty for a stack with no effect data rather than throwing', () => {
    const { positive, negative } = stackSymptoms([peptide('custom-x', 'My blend')])
    expect(positive).toEqual([])
    expect(negative).toEqual([])
  })

  it('indexes flat by id for lookups', () => {
    const idx = stackSymptomIndex(stack)
    expect(idx.acne.polarity).toBe('neg')
    expect(idx.recovery.polarity).toBe('pos')
    expect(idx.tanning).toBeUndefined()
  })
})

// ---------- scoring parts ----------
describe('scoring components', () => {
  it('recency peaks on the day of a change and dies at the window edge', () => {
    expect(recencyScore(T, T)).toBe(1)
    expect(recencyScore(addDaysStr(T, -RECENCY_WINDOW), T)).toBe(0)
    expect(recencyScore(addDaysStr(T, -100), T)).toBe(0)
    expect(recencyScore(addDaysStr(T, -7), T)).toBeCloseTo(1 - 7 / 21, 5)
    // a start date in the future isn't "recent", it hasn't happened
    expect(recencyScore(addDaysStr(T, 3), T)).toBe(0)
    expect(recencyScore(null, T)).toBe(0)
  })

  it('a step-up counts as a change, even on a long-running compound', () => {
    const p = peptide('bpc157', 'BPC-157', { startDate: addDaysStr(T, -300) })
    expect(lastChange(p, { levelStartDate: addDaysStr(T, -4) })).toBe(addDaysStr(T, -4))
    expect(recencyScore(lastChange(p, { levelStartDate: addDaysStr(T, -4) }), T)).toBeGreaterThan(0.7)
  })

  it('proximity falls away as the last dose recedes', () => {
    const p = peptide('bpc157', 'BPC-157')
    const at = (d) => proximityScore(p, [{ peptideId: 'bpc157', date: addDaysStr(T, d) }], T)
    expect(at(0)).toBe(1)
    expect(at(-1)).toBe(0.75)
    expect(at(-3)).toBe(0.5)
    expect(at(-30)).toBeLessThan(0.1)
    // strictly decreasing as it gets older
    const series = [0, -1, -3, -7, -14, -30].map(at)
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeLessThan(series[i - 1])
  })

  it('a never-logged compound scores on whether it is even running', () => {
    const on = peptide('bpc157', 'BPC-157')
    const off = peptide('bpc157', 'BPC-157', { startDate: addDaysStr(T, -8), cycleOnDays: 5, cycleOffDays: 5 })
    expect(proximityScore(on, [], T)).toBeGreaterThan(0)
    expect(proximityScore(off, [], T)).toBe(0)
  })

  it('a symptom claimed by one compound is more distinctive than a common one', () => {
    expect(distinctiveness('skin_staining')).toBe(1) // GHK-Cu only
    expect(distinctiveness('nausea')).toBeLessThan(0.6) // claimed by several
    expect(distinctiveness('acne')).toBe(1) // Test E only
  })

  it('likelihood is relative to the strongest candidate, and the top is always High', () => {
    expect(likelihoodFor(1, 1)).toBe('High')
    expect(likelihoodFor(0.8, 1)).toBe('High')
    expect(likelihoodFor(0.5, 1)).toBe('Medium')
    expect(likelihoodFor(0.2, 1)).toBe('Low')
    expect(likelihoodFor(0, 0)).toBe('Low')
  })

  it('weights recency above the other two factors', () => {
    expect(WEIGHTS.recency).toBeGreaterThan(WEIGHTS.proximity)
    expect(WEIGHTS.recency).toBeGreaterThan(WEIGHTS.evidence)
  })
})

// ---------- attribution ----------
describe('attributeSymptom', () => {
  const ctx = (peptides, extra = {}) => ({
    peptides, titration: {}, doseLogs: peptides.map((p) => dosedToday(p.id)), todayStr: T, ...extra,
  })

  it('headlines one compound and lists the rest', () => {
    const stack = [
      peptide('retatrutide', 'Retatrutide'),
      peptide('selank', 'Selank'),
      peptide('tb500', 'TB-500'),
    ]
    const r = attributeSymptom('fatigue', ctx(stack))
    expect(r.top).toBeTruthy()
    expect(r.candidates).toHaveLength(3)
    expect(r.others).toHaveLength(2)
    expect(r.top.likelihood).toBe('High')
    // every listed candidate carries its evidence tier
    for (const c of r.candidates) expect(c.tier).toMatch(/^T[1-5]$/)
  })

  it('ranks a recently started compound above a long-running one with better evidence', () => {
    const stack = [
      peptide('retatrutide', 'Retatrutide'), // T2, running 200 days
      peptide('selank', 'Selank', { startDate: addDaysStr(T, -2) }), // T3, just started
    ]
    const r = attributeSymptom('fatigue', ctx(stack))
    expect(r.top.name).toBe('Selank')
    expect(r.top.recentChange).toBe(true)
    expect(r.top.daysSinceChange).toBe(2)
    expect(r.others[0].name).toBe('Retatrutide')
  })

  it('ranks a just-stepped-up compound above an unchanged one', () => {
    const stack = [peptide('retatrutide', 'Retatrutide'), peptide('selank', 'Selank')]
    const r = attributeSymptom('fatigue', ctx(stack, { titration: tit('selank', addDaysStr(T, -1)) }))
    expect(r.top.name).toBe('Selank')
    expect(r.top.reasons.join(' ')).toMatch(/stepped up 1 day ago/)
  })

  it('falls back to evidence strength when timing is identical', () => {
    const stack = [
      peptide('retatrutide', 'Retatrutide'), // T2
      peptide('selank', 'Selank'), // T3
      peptide('tb500', 'TB-500'), // T4
    ]
    const r = attributeSymptom('fatigue', ctx(stack))
    expect(r.candidates.map((c) => c.name)).toEqual(['Retatrutide', 'Selank', 'TB-500'])
  })

  it('prefers the compound actually dosed recently over a dormant one', () => {
    const stack = [peptide('retatrutide', 'Retatrutide'), peptide('selank', 'Selank')]
    const r = attributeSymptom('fatigue', {
      peptides: stack, titration: {}, todayStr: T,
      doseLogs: [{ peptideId: 'selank', date: T }, { peptideId: 'retatrutide', date: addDaysStr(T, -40) }],
    })
    expect(r.top.name).toBe('Selank')
    expect(r.top.reasons).toContain('dosed today')
  })

  it('attributes Testosterone E for the effects it is actually known for', () => {
    const stack = [peptide('testosterone-e', 'Testosterone Enanthate'), peptide('bpc157', 'BPC-157')]
    for (const s of ['acne', 'high_hct', 'mood_swings', 'gyno', 'night_sweats']) {
      const r = attributeSymptom(s, ctx(stack))
      expect(r.top, `no candidate for ${s}`).toBeTruthy()
      expect(r.top.name).toBe('Testosterone Enanthate')
      expect(r.top.tier).toBe('T1')
    }
  })

  it('says nothing rather than guessing when no compound in the stack claims the symptom', () => {
    const r = attributeSymptom('tanning', ctx([peptide('bpc157', 'BPC-157')]))
    expect(r.top).toBeNull()
    expect(r.candidates).toEqual([])
    expect(r.multiple).toBe(false)
  })

  it('ignores compounds with no effect data instead of ranking them blank', () => {
    const r = attributeSymptom('acne', ctx([
      peptide('testosterone-e', 'Testosterone Enanthate'),
      peptide('custom-blend', 'My blend'),
    ]))
    expect(r.candidates.map((c) => c.name)).toEqual(['Testosterone Enanthate'])
  })

  it('handles positive effects the same way as negative ones', () => {
    const r = attributeSymptom('better_sleep', ctx([peptide('dsip', 'DSIP'), peptide('epithalon', 'Epithalon')]))
    expect(r.polarity).toBe('pos')
    expect(r.candidates).toHaveLength(2)
  })

  it('carries the label, icon and polarity so the UI never re-derives them', () => {
    const r = attributeSymptom('high_hct', ctx([peptide('testosterone-e', 'Testosterone Enanthate')]))
    expect(r.label).toBe(SYMPTOM_META.high_hct.label)
    expect(r.icon).toBeTruthy()
    expect(r.polarity).toBe('neg')
  })

  it('gives every candidate at least one plain-language reason', () => {
    const stack = [peptide('retatrutide', 'Retatrutide'), peptide('selank', 'Selank', { startDate: addDaysStr(T, -3) })]
    const r = attributeSymptom('fatigue', ctx(stack))
    for (const c of r.candidates) {
      expect(c.reasons.length).toBeGreaterThan(0)
      expect(c.reasons.join(' ')).toMatch(/T[1-5]/)
    }
  })

  it('only calls an effect distinctive when barely anything else claims it', () => {
    const acne = attributeSymptom('acne', ctx([peptide('testosterone-e', 'Testosterone Enanthate')]))
    expect(acne.top.reasons.join(' ')).toMatch(/distinctive effect/)
    // fatigue is claimed across the catalogue — it points nowhere in particular
    const fatigue = attributeSymptom('fatigue', ctx([peptide('selank', 'Selank')]))
    expect(fatigue.top.reasons.join(' ')).not.toMatch(/distinctive effect/)
  })

  it('attributes a batch in one pass', () => {
    const stack = [peptide('testosterone-e', 'Testosterone Enanthate')]
    const out = attributeAll(['acne', 'high_hct'], ctx(stack))
    expect(out.map((r) => r.symptomId)).toEqual(['acne', 'high_hct'])
  })

  it('states the caveat in plain words', () => {
    expect(ATTRIBUTION_CAVEAT).toMatch(/candidates, not a diagnosis/i)
    expect(ATTRIBUTION_CAVEAT).toMatch(/more than one thing can contribute/i)
  })
})

// ---------- snapshot ----------
describe('attributionSnapshot', () => {
  const stack = [
    peptide('retatrutide', 'Retatrutide'),
    peptide('selank', 'Selank', { startDate: addDaysStr(T, -2) }),
    peptide('tb500', 'TB-500'),
  ]
  const r = attributeSymptom('fatigue', {
    peptides: stack, titration: {}, doseLogs: stack.map((p) => dosedToday(p.id)), todayStr: T,
  })

  it('keeps the top candidate and the runners-up, with tiers', () => {
    const snap = attributionSnapshot(r)
    expect(snap.top.name).toBe('Selank')
    expect(snap.top.likelihood).toBe('High')
    expect(snap.top.tier).toBe('T3')
    expect(snap.others).toHaveLength(2)
    for (const o of snap.others) expect(o.tier).toMatch(/^T[1-5]$/)
  })

  it('is null when there was nothing to attribute', () => {
    expect(attributionSnapshot({ top: null, others: [] })).toBeNull()
    expect(attributionSnapshot(null)).toBeNull()
  })
})

// ---------- motivation ----------
describe('motivation shuffle bag', () => {
  it('ships a non-trivial list of unique messages', () => {
    expect(MESSAGES.length).toBeGreaterThan(100)
    expect(new Set(MESSAGES).size).toBe(MESSAGES.length)
  })

  it('draws a message and records it', () => {
    const d = drawMessage([], () => 0)
    expect(d.message).toBe(MESSAGES[0])
    expect(d.used).toEqual([0])
    expect(d.reshuffled).toBe(false)
  })

  it('never repeats until the whole list is exhausted', () => {
    let used = []
    const seen = []
    for (let i = 0; i < MESSAGES.length; i++) {
      const d = drawMessage(used)
      expect(d.reshuffled).toBe(false)
      seen.push(d.index)
      used = d.used
    }
    expect(new Set(seen).size).toBe(MESSAGES.length)
    expect(used).toHaveLength(MESSAGES.length)
  })

  it('reshuffles once the bag empties, and starts a fresh cycle', () => {
    const full = MESSAGES.map((_, i) => i)
    const d = drawMessage(full)
    expect(d.reshuffled).toBe(true)
    expect(d.used).toHaveLength(1)
    expect(d.index).toBeGreaterThanOrEqual(0)
  })

  it('resumes mid-bag rather than restarting — the point of persisting it', () => {
    const used = [0, 1, 2, 3, 4]
    const d = drawMessage(used)
    expect(used).not.toContain(d.index)
    expect(d.used).toHaveLength(6)
  })

  it('drops stale indices from a shorter list instead of jamming the bag', () => {
    const d = drawMessage([0, 1, 9999, -3, null])
    expect(d.reshuffled).toBe(false)
    expect(d.used.every((i) => i >= 0 && i < MESSAGES.length)).toBe(true)
    expect(d.used).toHaveLength(3)
  })

  it('reports how far through the bag it is', () => {
    expect(bagProgress([])).toEqual({ drawn: 0, total: MESSAGES.length, remaining: MESSAGES.length })
    expect(bagProgress([0, 1, 2]).remaining).toBe(MESSAGES.length - 3)
    expect(bagProgress([0, 0, 1]).drawn).toBe(2) // deduped
  })
})
