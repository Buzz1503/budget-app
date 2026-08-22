// v18's insight-engine and weekly-recap suites went with those features in v23.
// What remains here is everything v18 shipped that is still in the app: clean
// number formatting, the 2 mL reconstitution default, and the symptom catalogue.
import { describe, it, expect } from 'vitest'
import { format as formatNum } from '../components/ui/NumberField'
import {
  categoryOf, CATEGORIES, groupedSymptoms, searchSymptoms, browseSymptoms,
  allNegativeSymptoms, likelyNow, recentlyLogged, stackSymptoms, attributeSymptom,
} from './attribution'
import { addDaysStr } from './schedule'
import { DEFAULT_BAC_ML, LEGACY_BAC_ML, seedPeptides } from '../data/seed'

const T = '2026-06-15' // a Monday

const day = (offset) => addDaysStr(T, offset)
const check = (offset, tags, extra = {}) => ({
  id: `s${offset}`, date: day(offset), tags, note: '', site: null, activePeptides: [], ...extra,
})
const neg = (id, severity = 'moderate') => ({ id, label: id, polarity: 'neg', severity })
const pos = (id) => ({ id, label: id, polarity: 'pos' })

// A stack that's been running a while, so nothing reads as "just started".
const pep = (over = {}) => ({
  id: 'bpc157', name: 'BPC-157', startDate: day(-120), frequency: 'daily',
  ladder: { unit: 'mcg', floor: 250, step: 250, ceiling: 500, intervalWeeks: 2 },
  cycleOnDays: 0, cycleOffDays: 0, route: 'SubQ',
  recon: { vialMg: 5, bacMl: 2, expiryDays: 28 },
  ...over,
})

// ---------------------------------------------------------------- number field

describe('NumberField formatting', () => {
  it('never renders a padded zero', () => {
    expect(formatNum(0)).toBe('0')
    expect(formatNum(7)).toBe('7')
    expect(formatNum(0.5)).toBe('0.5')
    expect(formatNum(2.0)).toBe('2')
  })
  it('renders empty for null and undefined, not "0" or "NaN"', () => {
    expect(formatNum(null)).toBe('')
    expect(formatNum(undefined)).toBe('')
  })
  it('trims float noise rather than printing 17 decimals', () => {
    expect(formatNum(0.1 + 0.2)).toBe('0.3')
  })
})

// ------------------------------------------------------------------- 2 mL BAC

describe('2 mL reconstitution default', () => {
  it('is 2 mL', () => {
    expect(DEFAULT_BAC_ML).toBe(2)
  })
  it('applies to every reconstituted seed peptide', () => {
    for (const p of seedPeptides()) {
      if (!p.recon || p.id === 'testosterone-e') continue
      expect(p.recon.bacMl).toBe(DEFAULT_BAC_ML)
    }
  })
  it('leaves the pre-mixed oil vial alone — it is not reconstituted', () => {
    const te = seedPeptides().find((p) => p.id === 'testosterone-e')
    expect(te.recon.bacMl).toBe(10)
    expect(te.recon.vialMg / te.recon.bacMl).toBe(250) // mg/mL unchanged
  })
  it('records the old default for every peptide the migration may touch', () => {
    for (const id of Object.keys(LEGACY_BAC_ML)) {
      expect(seedPeptides().some((p) => p.id === id)).toBe(true)
    }
    expect(LEGACY_BAC_ML['testosterone-e']).toBeUndefined()
  })
})

// -------------------------------------------------------------- symptom browse

describe('symptom categorisation', () => {
  it("reads categories out of the data file, in the file's own order", () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(15)
    expect(CATEGORIES[0].id).toBe('sleep')
    expect(CATEGORIES.at(-1).id).toBe('other')
    for (const c of CATEGORIES) expect(typeof c.icon).toBe('string')
  })
  it("takes each symptom's category from the data", () => {
    expect(categoryOf('insomnia')).toBe('sleep')
    expect(categoryOf('inj_reaction')).toBe('injection_site')
    expect(categoryOf('dizziness')).toBe('head_nerves')
    expect(categoryOf('bloating')).toBe('gut')
  })
  it('falls back to "other" rather than dropping an unmapped symptom', () => {
    expect(categoryOf('something-added-next-year')).toBe('other')
  })
  it('never returns an empty category group', () => {
    const groups = groupedSymptoms([pep()], 'neg')
    for (const g of groups) expect(g.symptoms.length).toBeGreaterThan(0)
  })
  it('ranks prefix matches above mid-word matches when searching', () => {
    const hits = searchSymptoms([pep()], 'na')
    if (hits.length > 1) {
      const firstStarts = hits[0].label.toLowerCase().startsWith('na')
      const anyStarts = hits.some((h) => h.label.toLowerCase().startsWith('na'))
      if (anyStarts) expect(firstStarts).toBe(true)
    }
  })
  it('returns nothing for an empty query rather than the whole list', () => {
    expect(searchSymptoms([pep()], '')).toEqual([])
  })
})

// The point of the v18 data change: anything can be logged, not only what the
// stack is known for.
describe('the broad negative catalogue', () => {
  it('offers every negative symptom regardless of the stack', () => {
    const all = allNegativeSymptoms()
    expect(all.length).toBeGreaterThanOrEqual(100)
    const ids = new Set(all.map((s) => s.id))
    // general review-of-systems entries no stack compound claims
    for (const id of ['insomnia', 'broken_sleep', 'dizziness', 'bloating', 'back_pain',
      'nocturia', 'cough', 'blurred_vision', 'brain_fog']) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it("shows the full catalogue under Issues, not just the stack's effects", () => {
    const stackOnly = stackSymptoms([pep()]).negative
    const browse = browseSymptoms([pep()], 'neg')
    expect(browse.length).toBeGreaterThan(stackOnly.length)
    expect(browse.length).toBe(allNegativeSymptoms().length)
  })

  it('keeps Good effects tied to the stack', () => {
    const good = browseSymptoms([pep()], 'pos')
    const stackPos = stackSymptoms([pep()]).positive
    expect(good.map((s) => s.id).sort()).toEqual(stackPos.map((s) => s.id).sort())
    // BPC-157 alone must not offer, say, tanning
    expect(good.map((s) => s.id)).not.toContain('tanning')
  })

  it('finds a general symptom by search even with a one-compound stack', () => {
    const labels = searchSymptoms([pep()], 'waking').map((h) => h.label)
    expect(labels).toContain('Waking through the night')
    expect(labels).toContain('Waking too early')
  })

  it("groups the catalogue into the file's categories", () => {
    const groups = groupedSymptoms([pep()], 'neg')
    const ids = groups.map((g) => g.id)
    for (const id of ['sleep', 'gut', 'head_nerves', 'injection_site', 'urinary']) {
      expect(ids).toContain(id)
    }
    // and in the data file's order, not alphabetical
    expect(ids.indexOf('sleep')).toBeLessThan(ids.indexOf('gut'))
    const total = groups.reduce((n, g) => n + g.symptoms.length, 0)
    expect(total).toBe(allNegativeSymptoms().length)
  })

  it('still attributes nothing when the stack is not a known cause', () => {
    const ctx = { peptides: [pep()], titration: {}, doseLogs: [], todayStr: T }
    // BPC-157 does not claim insomnia
    expect(attributeSymptom('insomnia', ctx).top).toBe(null)
    // but it does claim head pressure
    expect(attributeSymptom('head_pressure', ctx).top?.name).toBe('BPC-157')
  })
})

describe('recentlyLogged', () => {
  it('is most-recent first and de-duplicated', () => {
    const logs = [
      check(-1, [neg('nausea')]),
      check(-3, [neg('nausea'), neg('headache')]),
    ]
    const out = recentlyLogged(logs, { limit: 5 })
    expect(out[0].id).toBe('nausea')
    expect(out.filter((o) => o.id === 'nausea')).toHaveLength(1)
  })
  it('honours the exclude set so a chip never shows twice on screen', () => {
    const logs = [check(-1, [neg('nausea'), neg('headache')])]
    const out = recentlyLogged(logs, { exclude: new Set(['nausea']) })
    expect(out.map((o) => o.id)).not.toContain('nausea')
  })
})
