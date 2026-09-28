// v39 — blood results, and a dose changed by hand.
//
// Two halves. The bloods half is mostly about what the library refuses to do:
// it must not turn a blank into a zero, must not invent an interval a marker
// does not have, and must not quietly rank an out-of-range number below an
// unremarkable one. The dose half is about the opposite — a hand-set dose must
// never be refused, whatever the ladder thinks, because the syringe has already
// happened by the time anyone types it in.
import { describe, it, expect } from 'vitest'
import {
  PANEL_ORDER, seedMarkers, seedTests, allMarkers, markerByName, rangeOf,
  statusOf, isOutOfRange, rangePosition, seriesFor, latestFor, deltaFor,
  watchList, outOfRangeNow, panelRows, panelsWithData, lastTestForPanel,
  retestDue, validateValue, fmtRange, fmtDelta, deltaWords, DEFAULT_RETEST_DAYS,
} from './bloods'
import { buildRungs, resolveDoseChange } from './schedule'

// ------------------------------------------------------------- the seed

describe('the seed', () => {
  const markers = seedMarkers()
  const tests = seedTests()

  it('carries every marker with a panel and a name', () => {
    expect(markers.length).toBeGreaterThan(50)
    for (const m of markers) {
      expect(m.name).toBeTruthy()
      expect(m.panel).toBeTruthy()
    }
  })

  it('files every marker under one of the stated panels', () => {
    const stray = [...new Set(markers.map((m) => m.panel))].filter((p) => !PANEL_ORDER.includes(p))
    expect(stray).toEqual([])
  })

  it('names each marker once', () => {
    expect(new Set(markers.map((m) => m.name)).size).toBe(markers.length)
  })

  it('reads the tests oldest first', () => {
    const dates = tests.map((t) => t.date)
    expect([...dates].sort((a, b) => a.localeCompare(b))).toEqual(dates)
    expect(tests.length).toBeGreaterThan(1)
  })

  it('records no marker the catalogue does not carry', () => {
    const known = new Set(markers.map((m) => m.name))
    for (const t of tests) {
      for (const k of Object.keys(t.values)) expect(known.has(k)).toBe(true)
    }
  })

  it('never turns a skipped marker into a zero', () => {
    // every recorded value is a real number that was actually printed; a panel
    // that did not measure something leaves the key out entirely
    for (const t of tests) {
      for (const v of Object.values(t.values)) {
        expect(typeof v).toBe('number')
        expect(Number.isFinite(v)).toBe(true)
      }
    }
    // and at least one test is a partial panel, or the point is untested
    const widths = tests.map((t) => Object.keys(t.values).length)
    expect(Math.min(...widths)).toBeLessThan(Math.max(...widths))
  })

  it('marks seeded tests as seeded', () => {
    expect(tests.every((t) => t.seeded === true)).toBe(true)
  })
})

// ----------------------------------------------------------- the markers

const twoSided = { name: 'Haemoglobin', panel: 'Haematology', unit: 'g/L', refLow: 135, refHigh: 175 }
const maxOnly = { name: 'CRP', panel: 'Inflammation', unit: 'mg/L', refLow: null, refHigh: 5 }
const minOnly = { name: 'eGFR', panel: 'Kidney', unit: '', refLow: 59, refHigh: null }
const noRange = { name: 'Mystery', panel: 'Chemistry', unit: '', refLow: null, refHigh: null }

describe('statusOf', () => {
  it('reads a two-sided interval both ways', () => {
    expect(statusOf(150, rangeOf(twoSided))).toBe('in')
    expect(statusOf(120, rangeOf(twoSided))).toBe('low')
    expect(statusOf(190, rangeOf(twoSided))).toBe('high')
  })

  it('treats the bounds themselves as inside', () => {
    expect(statusOf(135, rangeOf(twoSided))).toBe('in')
    expect(statusOf(175, rangeOf(twoSided))).toBe('in')
  })

  it('only judges the side a one-sided interval states', () => {
    expect(statusOf(0.4, rangeOf(maxOnly))).toBe('in')
    expect(statusOf(9, rangeOf(maxOnly))).toBe('high')
    expect(statusOf(90, rangeOf(minOnly))).toBe('in')
    expect(statusOf(40, rangeOf(minOnly))).toBe('low')
  })

  it('says nothing about a marker with no stated interval', () => {
    expect(statusOf(42, rangeOf(noRange))).toBe('unknown')
    expect(isOutOfRange(42, rangeOf(noRange))).toBe(false)
  })

  it('says nothing about a missing value', () => {
    expect(statusOf(null, rangeOf(twoSided))).toBe('unknown')
    expect(statusOf(undefined, rangeOf(twoSided))).toBe('unknown')
  })
})

describe('rangeOf', () => {
  it('prefers the interval the user typed in', () => {
    const r = rangeOf(twoSided, { Haemoglobin: { refLow: 130, refHigh: 180 } })
    expect(r).toMatchObject({ low: 130, high: 180, edited: true })
    expect(statusOf(178, r)).toBe('in')
  })

  it('lets one bound be overridden without inventing the other', () => {
    const r = rangeOf(maxOnly, { CRP: { refHigh: 3 } })
    expect(r.low).toBe(null)
    expect(r.high).toBe(3)
    expect(statusOf(4, r)).toBe('high')
  })

  it('accepts null as a deliberate "no bound"', () => {
    const r = rangeOf(twoSided, { Haemoglobin: { refLow: null } })
    expect(r.low).toBe(null)
    expect(statusOf(1, r)).toBe('in')
  })
})

describe('rangePosition', () => {
  it('puts the middle of a two-sided interval in the middle', () => {
    const p = rangePosition(155, rangeOf(twoSided))
    expect(p.pct).toBeGreaterThan(45)
    expect(p.pct).toBeLessThan(55)
    expect(p.status).toBe('in')
    expect(p.oneSided).toBe(false)
  })

  it('puts a value outside the band outside the band', () => {
    const low = rangePosition(110, rangeOf(twoSided))
    expect(low.pct).toBeLessThan(low.bandStart)
    const high = rangePosition(200, rangeOf(twoSided))
    expect(high.pct).toBeGreaterThan(high.bandEnd)
  })

  it('still draws a bar for a one-sided interval', () => {
    const under = rangePosition(0.6, rangeOf(maxOnly))
    expect(under.oneSided).toBe(true)
    expect(under.pct).toBeLessThan(under.bandEnd)
    const over = rangePosition(90, rangeOf(minOnly))
    expect(over.oneSided).toBe(true)
    expect(over.pct).toBeGreaterThan(over.bandStart)
  })

  it('keeps every coordinate on the bar', () => {
    for (const marker of [twoSided, maxOnly, minOnly]) {
      for (const v of [0.01, 1, 40, 155, 900, 99999]) {
        const p = rangePosition(v, rangeOf(marker))
        for (const n of [p.pct, p.bandStart, p.bandEnd]) {
          expect(n).toBeGreaterThanOrEqual(0)
          expect(n).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('draws nothing when there is no interval and nothing to draw', () => {
    expect(rangePosition(42, rangeOf(noRange))).toBe(null)
    expect(rangePosition('not a number', rangeOf(twoSided))).toBe(null)
  })
})

// ------------------------------------------------------------ the record

const T1 = { id: 't1', date: '2025-02-01', lab: 'SNP', values: { Haemoglobin: 150, CRP: 1.2 } }
const T2 = { id: 't2', date: '2025-07-17', lab: 'SNP', values: { Haemoglobin: 152 } }
const T3 = { id: 't3', date: '2026-01-09', lab: 'ACL', values: { Haemoglobin: 152.7, CRP: 8 } }
const tests = [T1, T2, T3]

describe('the record', () => {
  it('reads one marker across every test that measured it', () => {
    expect(seriesFor('Haemoglobin', tests).map((p) => p.value)).toEqual([150, 152, 152.7])
    expect(seriesFor('CRP', tests).map((p) => p.date)).toEqual(['2025-02-01', '2026-01-09'])
  })

  it('skips the tests that did not measure it, rather than plotting a zero', () => {
    expect(seriesFor('CRP', tests)).toHaveLength(2)
    expect(seriesFor('CRP', tests).some((p) => p.value === 0)).toBe(false)
  })

  it('sorts a series even when the tests arrive out of order', () => {
    const jumbled = [T3, T1, T2]
    expect(seriesFor('Haemoglobin', jumbled).map((p) => p.date))
      .toEqual(['2025-02-01', '2025-07-17', '2026-01-09'])
  })

  it('takes the latest from the end of that order', () => {
    expect(latestFor('Haemoglobin', [T3, T1, T2]).value).toBe(152.7)
    expect(latestFor('Nothing recorded', tests)).toBe(null)
  })

  it('measures the move against the test before, not the calendar', () => {
    const d = deltaFor('Haemoglobin', tests)
    expect(d.amount).toBeCloseTo(0.7, 6)
    expect(d.since).toBe('2025-07-17')
    expect(d.direction).toBe('up')
  })

  it('skips over tests that did not carry the marker', () => {
    // CRP was not in the July test, so its delta runs back to February
    const d = deltaFor('CRP', tests)
    expect(d.since).toBe('2025-02-01')
    expect(d.amount).toBeCloseTo(6.8, 6)
  })

  it('has no delta from a single point', () => {
    expect(deltaFor('Haemoglobin', [T1])).toBe(null)
  })

  it('does not report floating-point noise as movement', () => {
    const a = { id: 'a', date: '2025-01-01', values: { X: 0.3 } }
    const b = { id: 'b', date: '2025-02-01', values: { X: 0.1 + 0.2 } }
    expect(deltaFor('X', [a, b]).amount).toBe(0)
    expect(fmtDelta(deltaFor('X', [a, b]).amount)).toBe('0')
  })
})

// ------------------------------------------------------------- watching

const pep = (name) => ({ id: name.toLowerCase().replace(/\W/g, ''), name })

describe('watchList', () => {
  const seeded = seedTests()

  it('surfaces a marker whose watch list names something being taken', () => {
    const watched = seedMarkers().find((m) => m.watchFor?.length)
    expect(watched).toBeTruthy()
    const rows = watchList({ tests: seeded, peptides: [pep(watched.watchFor[0])] })
    expect(rows.map((r) => r.marker.name)).toContain(watched.name)
  })

  it('surfaces nothing when nothing is being taken', () => {
    expect(watchList({ tests: seeded, peptides: [] })).toEqual([])
  })

  it('ignores a compound no marker watches', () => {
    expect(watchList({ tests: seeded, peptides: [pep('Creatine monohydrate')] })).toEqual([])
  })

  it('matches a compound written with its dose after it', () => {
    const watched = seedMarkers().find((m) => m.watchFor?.length)
    const rows = watchList({ tests: seeded, peptides: [pep(`${watched.watchFor[0]} (5 mg)`)] })
    expect(rows.map((r) => r.marker.name)).toContain(watched.name)
  })

  it('carries the interval, the delta and the compound on each row', () => {
    const watched = seedMarkers().find((m) => m.watchFor?.length)
    const row = watchList({ tests: seeded, peptides: [pep(watched.watchFor[0])] })
      .find((r) => r.marker.name === watched.name)
    expect(row.latest).toBeTruthy()
    expect(row.range).toBeTruthy()
    expect(row.status).toMatch(/^(in|low|high|unknown)$/)
    expect(row.compounds.length).toBeGreaterThan(0)
  })

  it('names each compound once however many of its markers match', () => {
    const watched = seedMarkers().filter((m) => m.watchFor?.length)
    const all = [...new Set(watched.flatMap((m) => m.watchFor))]
    const rows = watchList({ tests: seeded, peptides: all.map(pep) })
    for (const r of rows) {
      expect(new Set(r.compounds.map((c) => c.id)).size).toBe(r.compounds.length)
    }
  })

  it('puts an out-of-range marker above an unremarkable one', () => {
    const all = [...new Set(seedMarkers().flatMap((m) => m.watchFor || []))]
    const rows = watchList({ tests: seeded, peptides: all.map(pep) })
    const flags = rows.map((r) => (r.status === 'low' || r.status === 'high' ? 0 : 1))
    expect([...flags].sort()).toEqual(flags)
  })

  it('leaves out a watched marker that has never been measured', () => {
    const watched = seedMarkers().find((m) => m.watchFor?.length)
    const rows = watchList({ tests: [], peptides: [pep(watched.watchFor[0])] })
    expect(rows).toEqual([])
  })
})

describe('outOfRangeNow', () => {
  it('flags only what the latest test put outside its interval', () => {
    const flagged = outOfRangeNow({ tests })
    expect(flagged.map((r) => r.marker.name)).toContain('CRP')   // 8 against under 5
    expect(flagged.map((r) => r.marker.name)).not.toContain('Haemoglobin')
  })

  it('reads the latest value, not the worst one ever recorded', () => {
    const recovered = [...tests, { id: 't4', date: '2026-06-01', values: { CRP: 1 } }]
    expect(outOfRangeNow({ tests: recovered }).map((r) => r.marker.name)).not.toContain('CRP')
  })

  it('follows an edited interval rather than the lab’s own', () => {
    const flagged = outOfRangeNow({ tests, overrides: { CRP: { refHigh: 10 } } })
    expect(flagged.map((r) => r.marker.name)).not.toContain('CRP')
  })
})

// --------------------------------------------------------------- panels

describe('panels', () => {
  it('lists the panels in the stated order', () => {
    const ps = panelsWithData({ tests: seedTests() })
    const idx = ps.map((p) => PANEL_ORDER.indexOf(p))
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })

  it('lists nothing when nothing has been recorded', () => {
    expect(panelsWithData({ tests: [] })).toEqual([])
  })

  it('gives every marker in a panel a row, measured or not', () => {
    const crp = panelRows('Inflammation', { tests }).find((r) => r.marker.name === 'CRP')
    expect(crp.latest.value).toBe(8)
    expect(crp.status).toBe('high')

    // only haemoglobin was measured out of the twelve in haematology; the other
    // eleven are still rows, with nothing in them rather than a nought
    const haem = panelRows('Haematology', { tests })
    expect(haem.find((r) => r.marker.name === 'Haemoglobin').latest.value).toBe(152.7)
    const blank = haem.filter((r) => r.latest == null)
    expect(blank.length).toBe(haem.length - 1)
    expect(blank.every((r) => r.status === 'unknown' && r.delta == null)).toBe(true)
  })

  it('carries a custom marker into its panel', () => {
    const custom = [{ name: 'Lp(a)', panel: 'Lipids', unit: 'nmol/L', refLow: null, refHigh: 75 }]
    expect(allMarkers(custom).some((m) => m.name === 'Lp(a)' && m.custom)).toBe(true)
    expect(panelRows('Lipids', { tests, custom }).some((r) => r.marker.name === 'Lp(a)')).toBe(true)
    expect(panelsWithData({ tests: [], custom })).toContain('Lipids')
  })

  it('refuses to let a custom marker shadow a seeded one', () => {
    const custom = [{ name: 'CRP', panel: 'Lipids', refHigh: 999 }]
    expect(markerByName('CRP', custom).panel).toBe('Inflammation')
  })

  it('keeps a custom marker on an invented panel visible', () => {
    const custom = [{ name: 'Whatever', panel: 'Genetics' }]
    expect(panelsWithData({ tests: [], custom })).toContain('Genetics')
  })
})

describe('retesting', () => {
  it('dates a panel from the last test that carried any of it', () => {
    expect(lastTestForPanel('Inflammation', { tests }).date).toBe('2026-01-09')
    expect(lastTestForPanel('Haematology', { tests }).date).toBe('2026-01-09')
    expect(lastTestForPanel('Lipids', { tests })).toBe(null)
  })

  it('counts forward from that date on the interval set', () => {
    const due = retestDue('Inflammation', { tests, intervals: { Inflammation: 90 }, todayStr: '2026-02-08' })
    expect(due.last).toBe('2026-01-09')
    expect(due.due).toBe('2026-04-09')
    expect(due.daysLeft).toBe(60)
    expect(due.overdue).toBe(false)
  })

  it('says so when the date has gone past', () => {
    const due = retestDue('Inflammation', { tests, intervals: { Inflammation: 90 }, todayStr: '2026-09-28' })
    expect(due.overdue).toBe(true)
    expect(due.daysLeft).toBeLessThan(0)
  })

  it('falls back to the default interval rather than nothing', () => {
    const due = retestDue('Inflammation', { tests, todayStr: '2026-02-08' })
    expect(due.every).toBe(DEFAULT_RETEST_DAYS)
  })

  it('has nothing to say about a panel never tested', () => {
    expect(retestDue('Lipids', { tests, todayStr: '2026-02-08' })).toBe(null)
  })
})

// ----------------------------------------------------------- validation

describe('validateValue', () => {
  it('lets a blank through as a blank', () => {
    expect(validateValue(twoSided, '')).toMatchObject({ ok: true, empty: true })
    expect(validateValue(twoSided, null)).toMatchObject({ ok: true, empty: true })
  })

  it('refuses something that is not a number', () => {
    expect(validateValue(twoSided, 'twelve').ok).toBe(false)
    expect(validateValue(twoSided, '-4').ok).toBe(false)
  })

  it('says nothing about a value inside the interval', () => {
    const v = validateValue(twoSided, '150')
    expect(v.warn).toBeFalsy()
    expect(v.status).toBe('in')
  })

  it('accepts an out-of-range value without a word of warning', () => {
    const v = validateValue(twoSided, '190')
    expect(v.ok).toBe(true)
    expect(v.status).toBe('high')
    expect(v.warn).toBeFalsy()
  })

  it('wonders about a stray digit, and saves it anyway', () => {
    // 155 would have been unremarkable; 1550 is the same keystrokes plus one
    const v = validateValue(twoSided, '1550')
    expect(v.ok).toBe(true)
    expect(v.warn).toBeTruthy()
    expect(v.value).toBe(1550)
  })

  it('wonders about a digit dropped as well as one added', () => {
    expect(validateValue(twoSided, '15').warn).toBeTruthy()   // 150 meant
    expect(validateValue(minOnly, '9').warn).toBeTruthy()     // 90 meant
  })

  it('stays quiet about a result that is merely outside', () => {
    expect(validateValue(twoSided, '190').warn).toBeFalsy()
    expect(validateValue(twoSided, '128').warn).toBeFalsy()
    // a CRP of 8 divides neatly back into "under 5" and is also a perfectly
    // ordinary result — warning here would teach the warning to be ignored
    expect(validateValue(maxOnly, '8').warn).toBeFalsy()
    expect(validateValue(maxOnly, '12').warn).toBeFalsy()
  })

  it('never blocks, whatever it thinks', () => {
    for (const raw of ['0', '0.0001', '99999']) {
      expect(validateValue(twoSided, raw).ok).toBe(true)
    }
  })

  it('judges against an edited interval, not the lab’s', () => {
    expect(validateValue(twoSided, '178', { Haemoglobin: { refHigh: 180 } }).status).toBe('in')
  })
})

describe('wording', () => {
  it('writes an interval the way a report does', () => {
    expect(fmtRange(rangeOf(twoSided), 'g/L')).toBe('135–175 g/L')
    expect(fmtRange(rangeOf(maxOnly), 'mg/L')).toBe('under 5 mg/L')
    expect(fmtRange(rangeOf(minOnly), '')).toBe('over 59')
    expect(fmtRange(rangeOf(noRange), '')).toBe('no stated interval')
  })

  it('signs a delta with a real minus sign', () => {
    expect(fmtDelta(0.7)).toBe('+0.7')
    expect(fmtDelta(-3)).toBe('−3')
    expect(fmtDelta(0)).toBe('0')
    expect(fmtDelta(null)).toBe('')
  })
})

// -------------------------------------------------- a dose set by hand

// The governing rule is that the number wins. Every test below is a way of
// putting a dose to the ladder that the ladder did not plan for, and checking
// it was accommodated rather than refused, rounded or silently ignored.
describe('resolveDoseChange', () => {
  const climbing = { unit: 'mg', floor: 2.5, step: 2.5, ceiling: 10, intervalWeeks: 4 }
  const steady = { unit: 'mg', floor: 50, step: 0, ceiling: 50, intervalWeeks: 4 }

  it('has rungs to reason about', () => {
    expect(buildRungs(climbing)).toEqual([2.5, 5, 7.5, 10])
    expect(buildRungs(steady)).toEqual([50])
  })

  it('steps to a dose that is already a rung, leaving the plan alone', () => {
    const r = resolveDoseChange(climbing, 7.5)
    expect(r.onLadder).toBe(true)
    expect(r.ladder).toEqual(climbing)
    expect(buildRungs(r.ladder)[r.level]).toBe(7.5)
  })

  it('raises the ceiling for a dose above the top rung', () => {
    const r = resolveDoseChange(climbing, 12.5)
    expect(r.ladder.ceiling).toBe(12.5)
    expect(r.ladder.floor).toBe(2.5)
    expect(buildRungs(r.ladder)[r.level]).toBe(12.5)
    expect(r.raisedCeiling).toBe(true)
  })

  it('starts the ladder where you actually are, for a dose between rungs', () => {
    const r = resolveDoseChange(climbing, 6)
    expect(buildRungs(r.ladder)[r.level]).toBe(6)
    // and the climb above it survives rather than being thrown away
    expect(r.ladder.ceiling).toBe(10)
    expect(buildRungs(r.ladder).length).toBeGreaterThan(1)
  })

  it('accepts a dose below the floor', () => {
    const r = resolveDoseChange(climbing, 1)
    expect(buildRungs(r.ladder)[r.level]).toBe(1)
    expect(r.ladder.ceiling).toBe(10)
  })

  it('moves a steady dose without inventing a climb', () => {
    const r = resolveDoseChange(steady, 62.5)
    expect(buildRungs(r.ladder)).toEqual([62.5])
    expect(r.level).toBe(0)
  })

  it('moves a steady dose upward at all', () => {
    // raising the ceiling of a flat ladder does nothing — buildRungs stops at
    // the floor when step is 0 — so the dose has to move both ends. Testosterone
    // is exactly this shape, and this went out the door once already.
    for (const dose of [62.5, 100, 25]) {
      const r = resolveDoseChange(steady, dose)
      expect(buildRungs(r.ladder)[r.level]).toBe(dose)
    }
  })

  it('never refuses, whatever the number', () => {
    for (const ladder of [climbing, steady]) {
      for (const dose of [0.05, 1, 6, 9.99, 250, 1000]) {
        const r = resolveDoseChange(ladder, dose)
        expect(buildRungs(r.ladder)[r.level]).toBeCloseTo(dose, 6)
      }
    }
  })

  it('keeps the rung it lands on reachable', () => {
    for (const dose of [1, 6, 12.5, 40]) {
      const r = resolveDoseChange(climbing, dose)
      const rungs = buildRungs(r.ladder)
      expect(r.level).toBeGreaterThanOrEqual(0)
      expect(r.level).toBeLessThan(rungs.length)
    }
  })

  it('leaves the units, the interval and the original object alone', () => {
    const before = JSON.stringify(climbing)
    const r = resolveDoseChange(climbing, 6)
    expect(JSON.stringify(climbing)).toBe(before)
    expect(r.ladder.unit).toBe('mg')
    expect(r.ladder.intervalWeeks).toBe(4)
  })
})

describe('deltaWords', () => {
  const pd = (d) => `pretty(${d})`
  it('signs a move and dates it', () => {
    expect(deltaWords({ amount: 0.7, since: '2025-07-17' }, pd)).toBe('+0.7 since pretty(2025-07-17)')
    expect(deltaWords({ amount: -3, since: '2025-07-17' }, pd)).toBe('−3 since pretty(2025-07-17)')
  })
  it('says a number did not move rather than printing a nought', () => {
    // "0 since 2 Oct 2024" reads as a measurement of zero, which is the
    // opposite of what it means
    expect(deltaWords({ amount: 0, since: '2024-10-02' }, pd)).toBe('unchanged since pretty(2024-10-02)')
  })
  it('says nothing when there is nothing to compare against', () => {
    expect(deltaWords(null, pd)).toBe('')
  })
})
