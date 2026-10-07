/**
 * Importing blood results from a file.
 *
 * The importer's job is to be careful, so the tests are about what it refuses,
 * what it asks, and what it leaves alone: a bad file must say why rather than
 * throw, a duplicate date must need an answer, a merge must not touch what is
 * there, and nothing may be dropped without being shown.
 */
import { describe, it, expect } from 'vitest'
import {
  IMPORT_SCHEMA, parseImport, buildPreview, commitPlan, applyImport, countsLine, summaryWords,
  exportResults, exportText, normName, normUnit, unitsDiffer, isRealDate, parseValueText,
} from './bloodImport'
import { seedTests, seedMarkers } from './bloods'

const wrap = (result, extra = {}) => ({ schema: IMPORT_SCHEMA, result, ...extra })
const text = (v) => JSON.stringify(v)

const test = (o) => ({
  id: o.id || `bt-${o.date}`, date: o.date, lab: '', ref: '', notes: '', values: {}, attachment: null, ...o,
})

const ctx = (tests = [], extra = {}) => ({ tests, customMarkers: [], overrides: {}, today: '2026-10-01', ...extra })
const preview = (file, tests = [], edits = {}, extra = {}) => {
  const parsed = parseImport(typeof file === 'string' ? file : text(file))
  if (!parsed.ok) throw new Error(parsed.error)
  return buildPreview(parsed.entries, ctx(tests, extra), edits)
}

const VALID = wrap({
  date: '2026-08-10', lab: 'Imedical', ref: '404358', notes: 'Collected 07:12 AM.',
  Testosterone: 18, Haematocrit: 0.46,
})

// ------------------------------------------------------------------ parsing

describe('reading a valid file', () => {
  it('parses a single result into the expected record', () => {
    const r = parseImport(text(VALID))
    expect(r.ok).toBe(true)
    expect(r.entries).toHaveLength(1)
    const e = r.entries[0]
    expect(e).toMatchObject({ date: '2026-08-10', lab: 'Imedical', ref: '404358', notes: 'Collected 07:12 AM.' })
    expect(e.values.map((v) => [v.name, v.value])).toEqual([['Testosterone', 18], ['Haematocrit', 0.46]])
    expect(e.newMarkers).toEqual([])
  })

  it('keeps the meta keys out of the values', () => {
    const e = parseImport(text(VALID)).entries[0]
    expect(e.values.map((v) => v.name)).not.toContain('date')
    expect(e.values.map((v) => v.name)).not.toContain('lab')
  })

  it('parses an array into several records, in file order', () => {
    const file = [
      wrap({ date: '2026-01-05', Testosterone: 15 }),
      wrap({ date: '2026-04-09', Testosterone: 17 }),
      wrap({ date: '2026-08-10', Testosterone: 18 }),
    ]
    const r = parseImport(text(file))
    expect(r.ok).toBe(true)
    expect(r.entries.map((e) => e.date)).toEqual(['2026-01-05', '2026-04-09', '2026-08-10'])
    expect(r.entries.map((e) => e.index)).toEqual([0, 1, 2])
  })

  it('reads declared new markers', () => {
    const file = wrap({ date: '2026-08-10', 'Example Marker': 5 }, {
      new_markers: [{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L', ref_low: 1, ref_high: 10 }],
    })
    const e = parseImport(text(file)).entries[0]
    expect(e.newMarkers).toEqual([{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L', refLow: 1, refHigh: 10 }])
  })

  it('accepts a numeric reference and turns it into text', () => {
    const e = parseImport(text(wrap({ date: '2026-08-10', ref: 404358, Testosterone: 18 }))).entries[0]
    expect(e.ref).toBe('404358')
  })

  it('accepts a number as text, a number with a unit, and { value, unit }', () => {
    const e = parseImport(text(wrap({
      date: '2026-08-10', A: '18', B: '18 nmol/L', C: { value: 18, unit: 'nmol/L' }, D: { value: '4.5', unit: 'g/L' },
    }))).entries[0]
    expect(e.values.map((v) => [v.value, v.unit, v.invalid])).toEqual([
      [18, '', false], [18, 'nmol/L', false], [18, 'nmol/L', false], [4.5, 'g/L', false],
    ])
  })

  it('treats null as "not measured" rather than as zero or as a problem', () => {
    const e = parseImport(text(wrap({ date: '2026-08-10', Testosterone: 18, Oestradiol: null }))).entries[0]
    expect(e.values.map((v) => v.name)).toEqual(['Testosterone'])
  })

  it('keeps a value that is not a number, flagged, instead of losing it', () => {
    const e = parseImport(text(wrap({ date: '2026-08-10', Testosterone: 18, CRP: '<5' }))).entries[0]
    const crp = e.values.find((v) => v.name === 'CRP')
    expect(crp.invalid).toBe(true)
    expect(crp.raw).toBe('<5')
  })

  it('warns about, and ignores, keys the app keeps for itself and keys it does not know', () => {
    const r = parseImport(text({ ...wrap({ date: '2026-08-10', Testosterone: 18, seeded: true, id: 'x' }), extra: 1 }))
    expect(r.ok).toBe(true)
    expect(r.entries[0].values.map((v) => v.name)).toEqual(['Testosterone'])
    expect(r.warnings.join(' ')).toMatch(/"seeded"/)
    expect(r.warnings.join(' ')).toMatch(/"extra"/)
  })
})

describe('refusing a file that cannot be read', () => {
  const refuses = (input, pattern) => {
    const r = parseImport(typeof input === 'string' ? input : text(input))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(pattern)
    return r
  }

  it('says so for empty input, without throwing', () => {
    refuses('', /empty/)
    refuses('   \n ', /empty/)
    expect(() => parseImport(undefined)).not.toThrow()
    expect(parseImport(null).ok).toBe(false)
  })

  it('reports malformed JSON with the reason, without throwing', () => {
    const r = refuses('{"schema": "x", "result": {', /not valid JSON/)
    expect(r.error.length).toBeGreaterThan(25)
    refuses('this is not json at all', /not valid JSON/)
    refuses('{"a": 1,}', /not valid JSON/)
  })

  it('reports a missing date', () => {
    refuses(wrap({ Testosterone: 18 }), /no "date"/)
    refuses(wrap({ date: '', Testosterone: 18 }), /no "date"/)
    refuses(wrap({ date: null, Testosterone: 18 }), /no "date"/)
  })

  it('reports a date that is not real', () => {
    refuses(wrap({ date: '10/08/2026', Testosterone: 18 }), /not a real date/)
    refuses(wrap({ date: '2026-02-30', Testosterone: 18 }), /not a real date/)
    refuses(wrap({ date: '2026-13-01', Testosterone: 18 }), /not a real date/)
    refuses(wrap({ date: 20260810, Testosterone: 18 }), /not a real date/)
  })

  it('reports a missing result, and recognises a bare one', () => {
    refuses({ schema: IMPORT_SCHEMA }, /no "result"/)
    refuses({ schema: IMPORT_SCHEMA, result: [1, 2] }, /no "result"/)
    refuses({ date: '2026-08-10', Testosterone: 18 }, /bare result/)
  })

  it('reports the wrong schema, and says which one is expected', () => {
    refuses({ schema: 'something-else/v9', result: { date: '2026-08-10', T: 1 } }, /something-else\/v9.*pepito-bloods-import\/v1/)
  })

  it('reports things that are not objects', () => {
    refuses('42', /not an object/)
    refuses('"hello"', /not an object/)
    refuses('[1, 2]', /Result 1 is not an object/)
    refuses('[]', /empty list/)
  })

  it('says which result of several is at fault', () => {
    refuses([wrap({ date: '2026-01-05', T: 1 }), wrap({ T: 2 })], /Result 2 has no "date"/)
  })

  it('refuses a result with no markers at all', () => {
    refuses(wrap({ date: '2026-08-10', lab: 'x' }), /no marker values/)
    refuses(wrap({ date: '2026-08-10', T: null }), /no marker values/)
  })

  it('refuses two results on the same day, naming both', () => {
    refuses([wrap({ date: '2026-08-10', T: 1 }), wrap({ date: '2026-09-01', T: 2 }), wrap({ date: '2026-08-10', T: 3 })], /Results 1 and 3 are both dated 2026-08-10/)
  })

  it('refuses bad new_markers with the marker named', () => {
    const base = (m) => wrap({ date: '2026-08-10', X: 1 }, { new_markers: m })
    refuses(base('nope'), /"new_markers" must be a list/)
    refuses(base([{ panel: 'Hormones' }]), /no "name"/)
    refuses(base([{ name: 'X', panel: 'Astrology' }]), /"X" has the panel "Astrology".*Hormones/)
    refuses(base([{ name: 'X', panel: 'Hormones', unit: 5 }]), /unit that is not text/)
    refuses(base([{ name: 'X', panel: 'Hormones', ref_low: 'a' }]), /ref_low that is not a number/)
    refuses(base([{ name: 'X', panel: 'Hormones', ref_low: 10, ref_high: 1 }]), /ref_low \(10\) above ref_high \(1\)/)
  })

  it('refuses a lab, ref or notes that is not text', () => {
    refuses(wrap({ date: '2026-08-10', lab: { a: 1 }, T: 1 }), /"lab" must be text/)
    refuses(wrap({ date: '2026-08-10', notes: [1], T: 1 }), /"notes" must be text/)
  })
})

describe('small helpers', () => {
  it('compares names the way a person reads them', () => {
    expect(normName('  Testosterone ')).toBe(normName('testosterone'))
    expect(normName('Free  Androgen Index')).toBe('free androgen index')
  })

  it('compares units the way a person reads them, and never converts', () => {
    expect(unitsDiffer('umol/L', 'µmol/L')).toBe(false)
    expect(unitsDiffer('x10^9/L', '10^9/L')).toBe(false)
    expect(unitsDiffer('NMOL/L', 'nmol/L')).toBe(false)
    expect(unitsDiffer('mmol/L', 'g/L')).toBe(true)
    expect(unitsDiffer('nmol/L', 'pmol/L')).toBe(true)
    expect(normUnit(' µmol / L ')).toBe('umol/l')
  })

  it('does not call a missing unit on either side a mismatch', () => {
    expect(unitsDiffer('', 'g/L')).toBe(false)
    expect(unitsDiffer('g/L', '')).toBe(false)
    expect(unitsDiffer(undefined, undefined)).toBe(false)
  })

  it('checks a date is on the calendar', () => {
    expect(isRealDate('2026-08-10')).toBe(true)
    expect(isRealDate('2024-02-29')).toBe(true)
    expect(isRealDate('2026-02-29')).toBe(false)
    expect(isRealDate('2026-8-10')).toBe(false)
    expect(isRealDate(null)).toBe(false)
  })

  it('explains why a typed value is not a number', () => {
    expect(parseValueText('18.5')).toEqual({ value: 18.5, error: null })
    expect(parseValueText('0')).toEqual({ value: 0, error: null })
    expect(parseValueText('').error).toMatch(/exclude/)
    expect(parseValueText('-3').error).toMatch(/negative/)
    expect(parseValueText('<5').error).toMatch(/limit/)
    expect(parseValueText('abc').error).toMatch(/not a number/)
  })
})

// ------------------------------------------------------------------ preview

describe('the preview', () => {
  it('shows every value, and saves nothing', () => {
    const p = preview(VALID)
    expect(p.entries[0].rows.map((r) => r.name)).toEqual(['Testosterone', 'Haematocrit'])
    expect(p.counts.values).toBe(2)
    expect(p.canImport).toBe(true)
  })

  it('does not change the record it was given', () => {
    const tests = [test({ date: '2026-08-10', values: { Testosterone: 12 } })]
    const before = JSON.stringify(tests)
    preview(VALID, tests)
    expect(JSON.stringify(tests)).toBe(before)
  })

  it('classifies recognised, new and unrecognised markers, and counts them', () => {
    const file = wrap({
      date: '2026-08-10', Testosterone: 18, 'Example Marker': 5, 'Example Two': 2, 'Mystery Thing': 9,
    }, {
      new_markers: [
        { name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L', ref_low: 1, ref_high: 10 },
        { name: 'Example Two', panel: 'Chemistry', unit: 'mmol/L' },
      ],
    })
    const p = preview(file)
    const kinds = Object.fromEntries(p.entries[0].rows.map((r) => [r.name, r.kind]))
    expect(kinds).toEqual({
      Testosterone: 'recognised', 'Example Marker': 'new', 'Example Two': 'new', 'Mystery Thing': 'unrecognised',
    })
    expect(p.counts).toMatchObject({ values: 4, newMarkers: 2, unrecognised: 1 })
    expect(countsLine(p.counts)).toBe('4 values, 2 new markers, 1 unrecognised')
  })

  it('leaves zero counts out of the headline', () => {
    expect(countsLine(preview(VALID).counts)).toBe('2 values')
    expect(countsLine({ values: 1, newMarkers: 1, unrecognised: 0 })).toBe('1 value, 1 new marker')
  })

  it('recognises a name that differs only in case or spacing', () => {
    const p = preview(wrap({ date: '2026-08-10', ' testosterone ': 18 }))
    expect(p.entries[0].rows[0]).toMatchObject({ kind: 'recognised', canonical: 'Testosterone' })
  })

  it('treats a declared marker the app already has as recognised, not new', () => {
    const file = wrap({ date: '2026-08-10', Testosterone: 18 }, {
      new_markers: [{ name: 'Testosterone', panel: 'Hormones', unit: 'nmol/L' }],
    })
    const p = preview(file)
    expect(p.entries[0].rows[0].kind).toBe('recognised')
    expect(p.counts.newMarkers).toBe(0)
  })

  it('shows a recognised value against its range and flags out-of-range as normal', () => {
    const lo = seedMarkers().find((m) => m.name === 'Testosterone')
    expect(lo.refLow).not.toBeNull()
    const inside = preview(wrap({ date: '2026-08-10', Testosterone: (lo.refLow + lo.refHigh) / 2 })).entries[0].rows[0]
    expect(inside.status).toBe('in')
    expect(inside.rangeText).toMatch(/nmol\/L/)
    const high = preview(wrap({ date: '2026-08-10', Testosterone: lo.refHigh + 2 })).entries[0].rows[0]
    expect(high.status).toBe('high')
    const low = preview(wrap({ date: '2026-08-10', Testosterone: lo.refLow - 1 })).entries[0].rows[0]
    expect(low.status).toBe('low')
    // flagged, but not a problem: out of range is a result, not an error
    expect(high.problems).toEqual([])
    expect(preview(wrap({ date: '2026-08-10', Testosterone: lo.refHigh + 2 })).canImport).toBe(true)
  })

  it('judges against an edited range when the person has set one', () => {
    const t = seedMarkers().find((m) => m.name === 'Testosterone')
    const p = preview(wrap({ date: '2026-08-10', Testosterone: t.refHigh + 2 }), [], {}, {
      overrides: { Testosterone: { refHigh: t.refHigh + 10 } },
    })
    expect(p.entries[0].rows[0].status).toBe('in')
  })

  it('formats nothing it does not know: no range is shown for an unresolved row', () => {
    const r = preview(wrap({ date: '2026-08-10', Mystery: 3 })).entries[0].rows[0]
    expect(r.rangeText).toBe('')
    expect(r.status).toBe('unknown')
  })

  it('warns about a future date and an implausibly old one, without blocking', () => {
    expect(preview(wrap({ date: '2030-01-01', Testosterone: 18 })).entries[0].dateWarning).toMatch(/future/)
    expect(preview(wrap({ date: '1985-01-01', Testosterone: 18 })).entries[0].dateWarning).toMatch(/before 1990/)
    expect(preview(wrap({ date: '2026-08-10', Testosterone: 18 })).entries[0].dateWarning).toBe(null)
    expect(preview(wrap({ date: '2030-01-01', Testosterone: 18 })).canImport).toBe(true)
  })
})

describe('every row is editable and excludable', () => {
  it('uses an edited value in place of the file\'s', () => {
    const p = preview(VALID, [], { rows: { '0:0': { value: '21' } } })
    expect(p.entries[0].rows[0].value).toBe(21)
    expect(commitPlan(p).entries[0].values.Testosterone).toBe(21)
  })

  it('leaves an excluded row out of the plan and out of the save count', () => {
    const p = preview(VALID, [], { rows: { '0:1': { excluded: true } } })
    expect(p.counts).toMatchObject({ values: 2, excluded: 1, toSave: 1 })
    expect(commitPlan(p).entries[0].values).toEqual({ Testosterone: 18 })
  })

  it('edits the date, the lab, the reference and the notes', () => {
    const p = preview(VALID, [], { entries: { 0: { date: '2026-08-11', lab: 'Other lab', ref: '9', notes: 'n' } } })
    expect(p.entries[0]).toMatchObject({ date: '2026-08-11', lab: 'Other lab', ref: '9', notes: 'n' })
    expect(commitPlan(p).entries[0]).toMatchObject({ date: '2026-08-11', lab: 'Other lab' })
  })

  it('blocks on a bad edited date, and on a value that is not a number, until fixed or excluded', () => {
    expect(preview(VALID, [], { entries: { 0: { date: '2026-02-31' } } }).canImport).toBe(false)
    const bad = preview(VALID, [], { rows: { '0:0': { value: 'abc' } } })
    expect(bad.canImport).toBe(false)
    expect(bad.blockers.map((b) => b.kind)).toContain('invalid')
    expect(preview(VALID, [], { rows: { '0:0': { value: 'abc', excluded: true } } }).canImport).toBe(true)
  })

  it('shows a value that was not a number as it arrived, and blocks on it', () => {
    const p = preview(wrap({ date: '2026-08-10', Testosterone: 18, 'C-Reactive Protein': '<5' }))
    const row = p.entries[0].rows.find((r) => r.name === 'C-Reactive Protein')
    expect(row.valueText).toBe('<5')
    expect(row.problems[0].kind).toBe('invalid')
    expect(p.canImport).toBe(false)
  })

  it('blocks when two rows would set the same marker', () => {
    const p = preview(wrap({ date: '2026-08-10', Testosterone: 18, testosterone: 19 }))
    expect(p.canImport).toBe(false)
    expect(p.entries[0].rows.every((r) => r.problems.some((x) => x.kind === 'collision'))).toBe(true)
    expect(preview(wrap({ date: '2026-08-10', Testosterone: 18, testosterone: 19 }), [], { rows: { '0:1': { excluded: true } } }).canImport).toBe(true)
  })
})

// ------------------------------------------------------- duplicate dates

describe('a date that already has a result', () => {
  const existing = test({ date: '2026-08-10', lab: 'Old lab', values: { Testosterone: 12, Oestradiol: 90 } })

  it('is detected, with how many markers are already there', () => {
    const e = preview(VALID, [existing]).entries[0]
    expect(e.conflict).toMatchObject({ testId: existing.id, markerCount: 2 })
  })

  it('is not a conflict on a date with nothing recorded', () => {
    expect(preview(VALID, [test({ date: '2026-08-09', values: { Testosterone: 1 } })]).entries[0].conflict).toBe(null)
    expect(preview(VALID, []).entries[0].conflict).toBe(null)
  })

  it('has no default answer, and blocks until there is one', () => {
    const p = preview(VALID, [existing])
    expect(p.entries[0].mode).toBe(null)
    expect(p.canImport).toBe(false)
    expect(p.blockers.map((b) => b.kind)).toContain('conflict')
  })

  it('offers merge, replace or cancel, and each unblocks it', () => {
    expect(preview(VALID, [existing], { entries: { 0: { mode: 'merge' } } }).entries[0].mode).toBe('merge')
    expect(preview(VALID, [existing], { entries: { 0: { mode: 'replace' } } }).canImport).toBe(true)
    // cancel: nothing is left to import
    const cancelled = preview(VALID, [existing], { entries: { 0: { mode: 'skip' } } })
    expect(cancelled.entries[0].skipped).toBe(true)
    expect(cancelled.canImport).toBe(false)
    expect(commitPlan(cancelled).entries).toEqual([])
  })

  it('does not let "add" stand on a date that exists', () => {
    expect(preview(VALID, [existing], { entries: { 0: { mode: 'add' } } }).entries[0].mode).toBe(null)
  })

  it('marks which rows a merge keeps and which it fills', () => {
    const p = preview(VALID, [existing], { entries: { 0: { mode: 'merge' } } })
    const [t, h] = p.entries[0].rows
    expect(t).toMatchObject({ effect: 'kept', existingValue: 12, writes: false })
    expect(h).toMatchObject({ effect: 'fills', writes: true })
  })

  it('marks which rows a replace overwrites', () => {
    const p = preview(VALID, [existing], { entries: { 0: { mode: 'replace' } } })
    expect(p.entries[0].rows[0]).toMatchObject({ effect: 'overwrites', existingValue: 12, writes: true })
  })

  it('finds a duplicate after the date has been edited onto one', () => {
    const other = test({ date: '2026-08-11', values: { Testosterone: 5 } })
    const p = preview(VALID, [other], { entries: { 0: { date: '2026-08-11' } } })
    expect(p.entries[0].conflict.testId).toBe(other.id)
  })

  it('blocks two results in one file that end up on the same date', () => {
    const file = [wrap({ date: '2026-08-10', Testosterone: 1 }), wrap({ date: '2026-09-01', Testosterone: 2 })]
    const p = preview(file, [], { entries: { 1: { date: '2026-08-10' } } })
    expect(p.canImport).toBe(false)
    expect(p.blockers.some((b) => /More than one result/.test(b.text))).toBe(true)
  })
})

describe('merging', () => {
  const existing = test({
    id: 'keep', date: '2026-08-10', lab: '', ref: 'R1', notes: '',
    values: { Testosterone: 12, Oestradiol: 90 }, attachment: { blobKey: 'blood-keep', name: 'a.pdf' },
  })
  const bloods = { tests: [existing], customMarkers: [] }
  const run = (file, mode, edits = {}) => {
    const p = preview(file, bloods.tests, { entries: { 0: { mode } }, ...edits })
    return applyImport(bloods, commitPlan(p), { makeId: () => 'new-id' })
  }

  it('fills only the markers that are empty and leaves existing values untouched', () => {
    const r = run(wrap({ date: '2026-08-10', Testosterone: 99, Haematocrit: 0.46, Oestradiol: 1 }), 'merge')
    const t = r.bloods.tests[0]
    expect(t.values).toEqual({ Testosterone: 12, Oestradiol: 90, Haematocrit: 0.46 })
    expect(r.summary).toMatchObject({ merged: 1, valuesWritten: 1, added: 0 })
  })

  it('fills a description field only where it is blank', () => {
    const r = run(wrap({ date: '2026-08-10', lab: 'Imedical', ref: 'R2', notes: 'n', Haematocrit: 0.46 }), 'merge')
    const t = r.bloods.tests[0]
    expect(t.lab).toBe('Imedical') // was blank
    expect(t.ref).toBe('R1') // was set: untouched
    expect(t.notes).toBe('n') // was blank
  })

  it('keeps the test\'s id and its attached report', () => {
    const t = run(wrap({ date: '2026-08-10', Haematocrit: 0.46 }), 'merge').bloods.tests[0]
    expect(t.id).toBe('keep')
    expect(t.attachment).toEqual(existing.attachment)
  })

  it('does not count a merge that filled nothing', () => {
    const r = run(wrap({ date: '2026-08-10', Testosterone: 99 }), 'merge')
    expect(r.summary).toMatchObject({ merged: 0, valuesWritten: 0 })
    expect(r.bloods.tests[0].values).toEqual(existing.values)
  })

  it('is not a blocker for a merge to have nothing to add, but cannot be the whole import', () => {
    const p = preview(wrap({ date: '2026-08-10', Testosterone: 99 }), [existing], { entries: { 0: { mode: 'merge' } } })
    expect(p.blockers).toEqual([])
    expect(p.canImport).toBe(false) // nothing to save at all
  })

  it('never writes an excluded row, even into an empty slot', () => {
    const r = run(wrap({ date: '2026-08-10', Haematocrit: 0.46 }), 'merge', { rows: { '0:0': { excluded: true } } })
    expect(r.bloods.tests[0].values.Haematocrit).toBeUndefined()
  })
})

describe('replacing', () => {
  const existing = test({
    id: 'keep', date: '2026-08-10', lab: 'Old lab', ref: 'R1', notes: 'old',
    values: { Testosterone: 12, Oestradiol: 90 }, attachment: { blobKey: 'blood-keep', name: 'a.pdf' },
  })
  const bloods = { tests: [existing], customMarkers: [] }
  const run = (file, edits = {}) => {
    const p = preview(file, bloods.tests, { entries: { 0: { mode: 'replace' } }, ...edits })
    return applyImport(bloods, commitPlan(p), { makeId: () => 'new-id' })
  }

  it('takes the file\'s values wholesale, dropping markers the file does not carry', () => {
    const t = run(wrap({ date: '2026-08-10', lab: 'Imedical', Testosterone: 18, Haematocrit: 0.46 })).bloods.tests[0]
    expect(t.values).toEqual({ Testosterone: 18, Haematocrit: 0.46 })
    expect(t.lab).toBe('Imedical')
  })

  it('keeps the id and the attached report', () => {
    const t = run(wrap({ date: '2026-08-10', Testosterone: 18 })).bloods.tests[0]
    expect(t.id).toBe('keep')
    expect(t.attachment).toEqual(existing.attachment)
  })

  it('does not read a blank lab in the file as a statement that the lab was blank', () => {
    const t = run(wrap({ date: '2026-08-10', Testosterone: 18 })).bloods.tests[0]
    expect(t.lab).toBe('Old lab')
    expect(t.notes).toBe('old')
  })

  it('does not add a second test for the date', () => {
    const r = run(wrap({ date: '2026-08-10', Testosterone: 18 }))
    expect(r.bloods.tests).toHaveLength(1)
    expect(r.summary).toMatchObject({ replaced: 1, added: 0 })
  })
})

// ----------------------------------------------------- unrecognised markers

describe('markers the app does not know', () => {
  const file = wrap({ date: '2026-08-10', Testosterone: 18, 'Mystery Thing': 9 })

  it('are detected and shown, never silently dropped', () => {
    const p = preview(file)
    const row = p.entries[0].rows.find((r) => r.name === 'Mystery Thing')
    expect(row.kind).toBe('unrecognised')
    expect(row.resolved).toBe(false)
    expect(p.counts.unrecognised).toBe(1)
    expect(p.canImport).toBe(false)
    expect(p.blockers).toEqual([expect.objectContaining({ kind: 'unrecognised', name: 'Mystery Thing' })])
  })

  it('cannot be left out of the plan by accident: the plan does not exist until it is decided', () => {
    const p = preview(file)
    expect(p.canImport).toBe(false)
    expect(commitPlan(p).entries[0].values).not.toHaveProperty('Mystery Thing')
  })

  it('can be added as a new marker, with a panel and unit', () => {
    const p = preview(file, [], { resolutions: { [normName('Mystery Thing')]: { action: 'add', panel: 'Hormones', unit: 'nmol/L', refLow: 1, refHigh: 10 } } })
    expect(p.canImport).toBe(true)
    expect(p.newMarkers).toEqual([{ name: 'Mystery Thing', panel: 'Hormones', unit: 'nmol/L', refLow: 1, refHigh: 10 }])
    const row = p.entries[0].rows[1]
    expect(row).toMatchObject({ resolved: true, canonical: 'Mystery Thing', status: 'in' })
    const r = applyImport({ tests: [], customMarkers: [] }, commitPlan(p), { makeId: () => 'id' })
    expect(r.bloods.customMarkers.map((m) => m.name)).toEqual(['Mystery Thing'])
    expect(r.bloods.tests[0].values['Mystery Thing']).toBe(9)
    expect(r.summary.newMarkers).toBe(1)
  })

  it('can be mapped to an existing marker, and is then judged against that marker', () => {
    const p = preview(wrap({ date: '2026-08-10', 'Testo (total)': 18 }), [], { resolutions: { [normName('Testo (total)')]: { action: 'map', mapTo: 'Testosterone' } } })
    const row = p.entries[0].rows[0]
    expect(row).toMatchObject({ resolved: true, canonical: 'Testosterone', mappedTo: 'Testosterone' })
    expect(row.rangeText).toMatch(/nmol\/L/)
    expect(commitPlan(p).entries[0].values).toEqual({ Testosterone: 18 })
    expect(p.newMarkers).toEqual([])
  })

  it('ignores a mapping to a marker that does not exist', () => {
    const p = preview(file, [], { resolutions: { [normName('Mystery Thing')]: { action: 'map', mapTo: 'Nonsense' } } })
    expect(p.canImport).toBe(false)
  })

  it('can be skipped, and is then left out and no longer blocks', () => {
    const p = preview(file, [], { resolutions: { [normName('Mystery Thing')]: { action: 'skip' } } })
    expect(p.canImport).toBe(true)
    expect(p.entries[0].rows[1].excluded).toBe(true)
    expect(commitPlan(p).entries[0].values).toEqual({ Testosterone: 18 })
    expect(p.newMarkers).toEqual([])
  })

  it('one decision covers the name wherever it appears', () => {
    const many = [wrap({ date: '2026-01-05', 'Mystery Thing': 1 }), wrap({ date: '2026-04-09', 'Mystery Thing': 2 })]
    const p = preview(many, [], { resolutions: { [normName('Mystery Thing')]: { action: 'add', panel: 'Chemistry' } } })
    expect(p.canImport).toBe(true)
    expect(p.newMarkers).toHaveLength(1)
  })

  it('does not create a marker nothing is written against', () => {
    const p = preview(file, [], {
      resolutions: { [normName('Mystery Thing')]: { action: 'add', panel: 'Chemistry' } },
      rows: { '0:1': { excluded: true } },
    })
    expect(p.newMarkers).toEqual([])
  })
})

describe('markers the file declares as new', () => {
  const decl = (extra = {}) => wrap({ date: '2026-08-10', 'Example Marker': 5 }, {
    new_markers: [{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L', ref_low: 1, ref_high: 10, ...extra }],
  })

  it('are created when something is saved against them', () => {
    const p = preview(decl())
    expect(p.newMarkers).toEqual([{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L', refLow: 1, refHigh: 10 }])
    const r = applyImport({ tests: [], customMarkers: [] }, commitPlan(p), { makeId: () => 'id' })
    expect(r.bloods.customMarkers[0]).toMatchObject({ name: 'Example Marker', panel: 'Hormones', custom: true, refLow: 1, refHigh: 10 })
  })

  it('can have their definition edited in the preview', () => {
    const p = preview(decl(), [], { markers: { [normName('Example Marker')]: { panel: 'Lipids', unit: 'mmol/L', refHigh: 20 } } })
    expect(p.newMarkers[0]).toMatchObject({ panel: 'Lipids', unit: 'mmol/L', refHigh: 20 })
  })

  it('are not created twice when several results declare them', () => {
    const file = [decl(), wrap({ date: '2026-09-01', 'Example Marker': 6 }, { new_markers: [{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L' }] })]
    expect(preview(file).newMarkers).toHaveLength(1)
  })

  it('are not created again when the app already has them', () => {
    const r = applyImport(
      { tests: [], customMarkers: [{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L', custom: true }] },
      { entries: [], newMarkers: [{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L' }] },
    )
    expect(r.bloods.customMarkers).toHaveLength(1)
    expect(r.summary.newMarkers).toBe(0)
  })
})

// ------------------------------------------------------- flags and warnings

describe('implausible values', () => {
  const T = seedMarkers().find((m) => m.name === 'Testosterone')

  it('are flagged as a possible transcription error and need confirming', () => {
    const p = preview(wrap({ date: '2026-08-10', Testosterone: T.refHigh * 20 }))
    const row = p.entries[0].rows[0]
    expect(row.problems.map((x) => x.kind)).toEqual(['implausible'])
    expect(row.problems[0].text).toMatch(/stray digit/)
    expect(p.canImport).toBe(false)
    expect(p.blockers.map((b) => b.kind)).toContain('confirm')
  })

  it('are not blocked for good: confirming lets them through', () => {
    const wild = T.refHigh * 20
    const p = preview(wrap({ date: '2026-08-10', Testosterone: wild }), [], { rows: { '0:0': { confirmedFor: String(wild) } } })
    expect(p.canImport).toBe(true)
    expect(commitPlan(p).entries[0].values.Testosterone).toBe(wild)
  })

  it('lose their confirmation when the value is edited', () => {
    const wild = T.refHigh * 20
    const p = preview(wrap({ date: '2026-08-10', Testosterone: wild }), [], { rows: { '0:0': { confirmedFor: String(wild), value: String(wild * 2) } } })
    expect(p.canImport).toBe(false)
  })

  it('are cleared by fixing the value or excluding the row', () => {
    const wild = T.refHigh * 20
    expect(preview(wrap({ date: '2026-08-10', Testosterone: wild }), [], { rows: { '0:0': { value: String(T.refHigh) } } }).canImport).toBe(true)
    expect(preview(wrap({ date: '2026-08-10', Testosterone: 18, Haematocrit: 0.46 }), [], {}).canImport).toBe(true)
    expect(preview(wrap({ date: '2026-08-10', Testosterone: wild, Haematocrit: 0.46 }), [], { rows: { '0:0': { excluded: true } } }).canImport).toBe(true)
  })

  it('are not raised for a value that is merely out of range', () => {
    const p = preview(wrap({ date: '2026-08-10', Testosterone: T.refHigh * 1.2 }))
    expect(p.entries[0].rows[0].problems).toEqual([])
    expect(p.entries[0].rows[0].status).toBe('high')
  })
})

describe('unit mismatches', () => {
  const T = seedMarkers().find((m) => m.name === 'Testosterone')

  it('are flagged, with both units, and not converted', () => {
    const p = preview(wrap({ date: '2026-08-10', Testosterone: { value: 18, unit: 'ng/dL' } }))
    const row = p.entries[0].rows[0]
    const u = row.problems.find((x) => x.kind === 'unit')
    expect(u.text).toMatch(/ng\/dL/)
    expect(u.text).toMatch(/nmol\/L/)
    expect(u.text).toMatch(/not converted/)
    expect(row.value).toBe(18) // the number is exactly what the file said
    expect(p.canImport).toBe(false)
  })

  it('are not judged against the interval, because the units are unlike', () => {
    // 120 ng/dL against an interval in pmol/L is not "in range" or "high", it is not comparable
    const row = preview(wrap({ date: '2026-08-10', Testosterone: { value: T.refHigh * 20, unit: 'ng/dL' } })).entries[0].rows[0]
    expect(row.compared).toBe(false)
    expect(row.status).toBe('unknown')
    // and the stray-digit test does not fire on a figure that is simply in a bigger unit
    expect(row.problems.map((x) => x.kind)).toEqual(['unit'])
  })

  it('are left out of the out-of-range count', () => {
    const p = preview(wrap({ date: '2026-08-10', Testosterone: { value: T.refHigh * 20, unit: 'ng/dL' } }))
    expect(p.counts.outOfRange).toBe(0)
  })

  it('still judge a value whose unit matches', () => {
    const row = preview(wrap({ date: '2026-08-10', Testosterone: { value: T.refHigh + 2, unit: T.unit } })).entries[0].rows[0]
    expect(row.compared).toBe(true)
    expect(row.status).toBe('high')
  })

  it('can be confirmed and then kept exactly as given', () => {
    const p = preview(wrap({ date: '2026-08-10', Testosterone: { value: 18, unit: 'ng/dL' } }), [], { rows: { '0:0': { confirmedFor: '18' } } })
    expect(p.canImport).toBe(true)
    expect(commitPlan(p).entries[0].values.Testosterone).toBe(18)
  })

  it('are not raised when the unit only differs in spelling', () => {
    expect(preview(wrap({ date: '2026-08-10', Testosterone: { value: 18, unit: T.unit.toUpperCase() } })).entries[0].rows[0].problems).toEqual([])
    expect(preview(wrap({ date: '2026-08-10', Testosterone: `18 ${T.unit}` })).entries[0].rows[0].problems).toEqual([])
  })

  it('are not raised when the file gives no unit', () => {
    expect(preview(wrap({ date: '2026-08-10', Testosterone: 18 })).entries[0].rows[0].problems).toEqual([])
  })

  it('are raised for a declared new marker whose value carries another unit', () => {
    const file = wrap({ date: '2026-08-10', 'Example Marker': { value: 5, unit: 'mg/L' } }, {
      new_markers: [{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L' }],
    })
    expect(preview(file).entries[0].rows[0].problems.map((x) => x.kind)).toContain('unit')
  })
})

// ---------------------------------------------------------------- applying

describe('applying an import', () => {
  it('adds a new test, sorted into place', () => {
    const bloods = { tests: [test({ date: '2026-01-01', values: { Testosterone: 1 } }), test({ date: '2026-12-01', values: { Testosterone: 3 } })], customMarkers: [] }
    const p = preview(VALID, bloods.tests)
    const r = applyImport(bloods, commitPlan(p), { makeId: () => 'fresh' })
    expect(r.bloods.tests.map((t) => t.date)).toEqual(['2026-01-01', '2026-08-10', '2026-12-01'])
    const added = r.bloods.tests[1]
    expect(added).toMatchObject({ id: 'fresh', lab: 'Imedical', ref: '404358', notes: 'Collected 07:12 AM.', attachment: null })
    expect(added.values).toEqual({ Testosterone: 18, Haematocrit: 0.46 })
    expect(r.created).toEqual([{ index: 0, testId: 'fresh' }])
  })

  it('does not change the record it was given', () => {
    const bloods = { tests: [test({ date: '2026-01-01', values: { Testosterone: 1 } })], customMarkers: [] }
    const before = JSON.stringify(bloods)
    applyImport(bloods, commitPlan(preview(VALID, bloods.tests)), { makeId: () => 'x' })
    expect(JSON.stringify(bloods)).toBe(before)
  })

  it('leaves every other part of the blood record alone', () => {
    const bloods = {
      tests: [], customMarkers: [], rangeOverrides: { Testosterone: { refHigh: 40 } },
      markerNotes: { Testosterone: 'mine' }, retestIntervals: { Hormones: 90 },
    }
    const r = applyImport(bloods, commitPlan(preview(VALID)), { makeId: () => 'x' })
    expect(r.bloods.rangeOverrides).toEqual(bloods.rangeOverrides)
    expect(r.bloods.markerNotes).toEqual(bloods.markerNotes)
    expect(r.bloods.retestIntervals).toEqual(bloods.retestIntervals)
  })

  it('imports several tests at once', () => {
    const file = [wrap({ date: '2026-01-05', Testosterone: 15 }), wrap({ date: '2026-04-09', Testosterone: 17 })]
    let n = 0
    const r = applyImport({ tests: [], customMarkers: [] }, commitPlan(preview(file)), { makeId: () => `t${n++}` })
    expect(r.bloods.tests.map((t) => t.id)).toEqual(['t0', 't1'])
    expect(r.summary).toMatchObject({ added: 2, valuesWritten: 2 })
  })

  it('imports only the tests that were not skipped', () => {
    const file = [wrap({ date: '2026-01-05', Testosterone: 15 }), wrap({ date: '2026-04-09', Testosterone: 17 })]
    const p = preview(file, [], { entries: { 0: { mode: 'skip' } } })
    const r = applyImport({ tests: [], customMarkers: [] }, commitPlan(p), { makeId: () => 'only' })
    expect(r.bloods.tests.map((t) => t.date)).toEqual(['2026-04-09'])
  })

  it('merges rather than duplicates or overwrites if the date appeared since the preview', () => {
    const plan = { entries: [{ index: 0, mode: 'add', date: '2026-08-10', lab: '', ref: '', notes: '', existingId: null, values: { Testosterone: 99, Haematocrit: 0.4 } }], newMarkers: [] }
    const bloods = { tests: [test({ id: 'late', date: '2026-08-10', values: { Testosterone: 12 } })], customMarkers: [] }
    const r = applyImport(bloods, plan, { makeId: () => 'dup' })
    expect(r.bloods.tests).toHaveLength(1)
    expect(r.bloods.tests[0].values).toEqual({ Testosterone: 12, Haematocrit: 0.4 })
  })

  it('says what it did, in a sentence', () => {
    expect(summaryWords({ added: 1, merged: 0, replaced: 0, valuesWritten: 24, newMarkers: 2 })).toBe('1 new test: 24 values, 2 new markers')
    expect(summaryWords({ added: 0, merged: 1, replaced: 0, valuesWritten: 1, newMarkers: 0 })).toBe('1 merged: 1 value')
    expect(summaryWords({ added: 2, merged: 1, replaced: 1, valuesWritten: 9, newMarkers: 0 })).toBe('2 new tests, 1 merged, 1 replaced: 9 values')
  })
})

// ------------------------------------------------------------------ export

describe('exporting', () => {
  const bloods = {
    tests: [
      test({ date: '2026-08-10', lab: 'Imedical', ref: '404358', notes: 'Collected 07:12 AM.', values: { Haematocrit: 0.46, Testosterone: 18, 'Example Marker': 5 } }),
      test({ date: '2025-01-02', values: { Testosterone: 15 } }),
    ],
    customMarkers: [{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L', refLow: 1, refHigh: 10, custom: true }],
  }

  it('writes one entry per test, oldest first, in the import schema', () => {
    const out = exportResults(bloods)
    expect(out.map((e) => e.result.date)).toEqual(['2025-01-02', '2026-08-10'])
    expect(out.every((e) => e.schema === IMPORT_SCHEMA)).toBe(true)
  })

  it('leaves out description fields that are empty', () => {
    const [first, second] = exportResults(bloods)
    expect(first.result).toEqual({ date: '2025-01-02', Testosterone: 15 })
    expect(second.result).toMatchObject({ date: '2026-08-10', lab: 'Imedical', ref: '404358', notes: 'Collected 07:12 AM.' })
  })

  it('carries the custom markers a test uses, so each entry stands alone', () => {
    const [first, second] = exportResults(bloods)
    expect(first.new_markers).toBeUndefined()
    expect(second.new_markers).toEqual([{ name: 'Example Marker', panel: 'Hormones', unit: 'nmol/L', ref_low: 1, ref_high: 10 }])
  })

  it('keeps the catalogue\'s order, so the file reads like a report', () => {
    const keys = Object.keys(exportResults(bloods)[1].result).filter((k) => !['date', 'lab', 'ref', 'notes'].includes(k))
    const order = seedMarkers().map((m) => m.name)
    const known = keys.filter((k) => order.includes(k))
    // whatever order the catalogue happens to use, the file follows it...
    expect(known).toEqual([...known].sort((a, b) => order.indexOf(a) - order.indexOf(b)))
    expect(known).toHaveLength(2)
    // ...and a marker the catalogue does not carry comes after the ones it does
    expect(keys[keys.length - 1]).toBe('Example Marker')
  })

  it('does not include anything the app keeps for itself', () => {
    const text = exportText({ tests: [test({ date: '2026-08-10', id: 'secret', seeded: true, attachment: { blobKey: 'k' }, values: { Testosterone: 1 } })], customMarkers: [] })
    expect(text).not.toMatch(/secret|seeded|attachment|blobKey/)
  })

  it('exports an empty record as an empty list', () => {
    expect(exportResults({ tests: [], customMarkers: [] })).toEqual([])
    expect(exportResults(undefined)).toEqual([])
  })

  it('re-imports cleanly: the same tests, values, descriptions and custom markers come back', () => {
    const parsed = parseImport(exportText(bloods))
    expect(parsed.ok).toBe(true)
    const p = buildPreview(parsed.entries, ctx([]))
    expect(p.canImport).toBe(true)
    expect(p.blockers).toEqual([])
    expect(p.counts.unrecognised).toBe(0)
    let n = 0
    const r = applyImport({ tests: [], customMarkers: [] }, commitPlan(p), { makeId: () => `r${n++}` })
    const strip = (t) => ({ date: t.date, lab: t.lab, ref: t.ref, notes: t.notes, values: t.values })
    expect(r.bloods.tests.map(strip)).toEqual(bloods.tests.map(strip).sort((a, b) => a.date.localeCompare(b.date)))
    expect(r.bloods.customMarkers.map((m) => m.name)).toEqual(['Example Marker'])
    expect(r.bloods.customMarkers[0]).toMatchObject({ panel: 'Hormones', unit: 'nmol/L', refLow: 1, refHigh: 10 })
  })

  it('re-imports the real seeded record without a single flag', () => {
    const real = { tests: seedTests(), customMarkers: [] }
    const parsed = parseImport(exportText(real))
    expect(parsed.ok).toBe(true)
    expect(parsed.entries).toHaveLength(real.tests.length)
    const p = buildPreview(parsed.entries, ctx([]))
    expect(p.counts.unrecognised).toBe(0)
    expect(p.counts.flagged).toBe(0)
    expect(p.blockers).toEqual([])
    let n = 0
    const r = applyImport({ tests: [], customMarkers: [] }, commitPlan(p), { makeId: () => `s${n++}` })
    expect(r.bloods.tests.map((t) => t.values)).toEqual(real.tests.map((t) => t.values))
  })

  it('re-importing into the same record changes nothing and flags every date', () => {
    const real = { tests: seedTests(), customMarkers: [] }
    const parsed = parseImport(exportText(real))
    const p = buildPreview(parsed.entries, ctx(real.tests))
    expect(p.entries.every((e) => e.conflict)).toBe(true)
    expect(p.canImport).toBe(false)
    const merged = buildPreview(parsed.entries, ctx(real.tests), {
      entries: Object.fromEntries(parsed.entries.map((e) => [e.index, { mode: 'merge' }])),
    })
    expect(merged.counts.toSave).toBe(0)
    const r = applyImport(real, commitPlan(merged))
    expect(r.bloods.tests.map((t) => t.values)).toEqual(real.tests.map((t) => t.values))
  })
})
