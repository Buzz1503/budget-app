import { describe, it, expect } from 'vitest'
import {
  MIN_INJECTIONS, statsFor, byPeptide, byNeedle, byRegion, patterns, componentsOf, isCoDraw, BLENDS,
} from './reactionPatterns'
import { applyCheck } from './reactionCourse'
import {
  suggestNeedle, inUseNeedles, needleKey, needleLabel, coDrawInfo, captureFor, normaliseNeedle,
} from './injectionCapture'

let n = 0
const NEEDLE = { gauge: '32G', lengthMm: 6 }
function inj(peptideId, { reacted = false, days = null, symptoms = [], peak = 'mild', checked = true, needle = NEEDLE, group = 'abdomen', coDraw = false } = {}) {
  const id = `r${n++}`
  const record = { id, peptideId, siteGroup: group, needle, coDraw, coDrawPeptideIds: coDraw ? [peptideId, 'other'] : [peptideId], timestamp: '2026-09-01T10:00:00Z' }
  let reaction
  if (checked) {
    reaction = applyCheck(null, { date: '2026-09-01', severity: reacted ? peak : 'none', symptoms })
    if (reacted && days != null) reaction = applyCheck(reaction, { date: `2026-09-${String(1 + days).padStart(2, '0')}`, severity: 'none' })
    reaction = { ...reaction, injectionRecordId: id }
  }
  return { record, reaction }
}
const ctx = (list, peptides = []) => ({
  records: list.map((x) => x.record), reactions: list.map((x) => x.reaction).filter(Boolean), peptides,
})
const many = (k, peptideId, opts = () => ({})) => Array.from({ length: k }, (_, i) => inj(peptideId, opts(i)))

describe('minimum injections', () => {
  it('shows counts and no rate below five', () => {
    const s = statsFor(many(4, 'a', (i) => ({ reacted: i < 2 })))
    expect(MIN_INJECTIONS).toBe(5)
    expect(s.status).toBe('insufficient')
    expect(s.rate).toBeNull()
    expect(s.medianDaysToResolve).toBeNull()
    expect(s.peakSpread).toBeNull()
    expect(s.words).toBe('Not enough data yet')
    expect(s.injections).toBe(4)
    expect(s.reactions).toBe(2)
  })

  it('computes the rate at five and above', () => {
    const s = statsFor(many(5, 'a', (i) => ({ reacted: i < 2 })))
    expect(s.status).toBe('ok')
    expect(s.rate).toBeCloseTo(0.4)
    expect(statsFor(many(10, 'a', (i) => ({ reacted: i < 3 }))).rate).toBeCloseTo(0.3)
  })

  it('unchecked injections are neither reactions nor clear — they are left out of the rate', () => {
    const rows = [...many(5, 'a', (i) => ({ reacted: i === 0 })), ...many(6, 'a', () => ({ checked: false }))]
    const s = statsFor(rows)
    expect(s.injections).toBe(11)
    expect(s.checked).toBe(5)
    expect(s.rate).toBeCloseTo(0.2)
    expect(statsFor(many(8, 'a', () => ({ checked: false }))).status).toBe('insufficient')
  })

  it('median days to resolve, peak spread and common symptoms', () => {
    const rows = [
      inj('a', { reacted: true, days: 2, peak: 'mild', symptoms: ['redness', 'itching'] }),
      inj('a', { reacted: true, days: 4, peak: 'moderate', symptoms: ['redness'] }),
      inj('a', { reacted: true, days: 9, peak: 'severe', symptoms: ['redness', 'heat'] }),
      inj('a'), inj('a'),
    ]
    const s = statsFor(rows)
    expect(s.medianDaysToResolve).toBe(4)
    expect(s.resolved).toBe(3)
    expect(s.peakSpread).toEqual({ mild: 1, moderate: 1, severe: 1 })
    expect(s.symptoms[0]).toEqual({ id: 'redness', label: 'Redness', reactions: 3 })
    expect(s.symptoms).toHaveLength(3)
  })

  it('the median of an even number is the midpoint', () => {
    const rows = [inj('a', { reacted: true, days: 2 }), inj('a', { reacted: true, days: 5 }), ...many(3, 'a')]
    expect(statsFor(rows).medianDaysToResolve).toBe(3.5)
  })
})

describe('co-draws cannot isolate a compound', () => {
  it('co-draw injections stay out of the compound\'s own rate', () => {
    const solo = many(5, 'bpc157', (i) => ({ reacted: i === 0 }))
    const co = many(5, 'bpc157', () => ({ reacted: true, coDraw: true }))
    const row = byPeptide(ctx([...solo, ...co])).find((r) => r.peptideId === 'bpc157')
    expect(row.clean.injections).toBe(5)
    expect(row.clean.rate).toBeCloseTo(0.2) // not 0.6
    expect(row.coDraw).toMatchObject({ injections: 5, reactions: 5, unableToIsolate: true })
    expect(row.coDraw.rate).toBeUndefined()
  })

  it('a compound that only ever shared a syringe has no clean rate at all', () => {
    const row = byPeptide(ctx(many(8, 'x', () => ({ reacted: true, coDraw: true })))).find((r) => r.peptideId === 'x')
    expect(row.clean.status).toBe('insufficient')
    expect(row.clean.rate).toBeNull()
    expect(row.clean.injections).toBe(0)
    expect(row.coDraw.injections).toBe(8)
  })

  it('same pin at the same moment (mixed) counts as a co-draw', () => {
    expect(isCoDraw({ mixed: true })).toBe(true)
    expect(isCoDraw({ coDrawId: 'cd-1' })).toBe(true)
    expect(isCoDraw({ coDrawPeptideIds: ['a', 'b'] })).toBe(true)
    expect(isCoDraw({ coDrawPeptideIds: ['a'] })).toBe(false)
  })
})

describe('blends are not clean data for what is in them', () => {
  const peptides = [{ id: 'klow', name: 'KLOW' }, { id: 'ghkcu', name: 'GHK-Cu' }]

  it('knows what KLOW contains', () => {
    expect(componentsOf('klow', peptides)).toContain('ghkcu')
    expect(BLENDS.klow).toEqual(expect.arrayContaining(['bpc157', 'ghkcu', 'tb500', 'kpv']))
    expect(componentsOf('ghkcu', peptides)).toEqual([])
    expect(componentsOf('mystery', [{ id: 'mystery', name: 'Glow stack' }])).toEqual(BLENDS.glow)
    expect(componentsOf('mine', [{ id: 'mine', blendOf: ['a', 'b'] }])).toEqual(['a', 'b'])
  })

  it('a blend\'s reactions do not enter GHK-Cu\'s rate', () => {
    const list = [...many(6, 'klow', () => ({ reacted: true })), ...many(5, 'ghkcu', (i) => ({ reacted: i === 0 }))]
    const rows = byPeptide(ctx(list, peptides))
    const ghk = rows.find((r) => r.peptideId === 'ghkcu')
    const klow = rows.find((r) => r.peptideId === 'klow')
    expect(ghk.clean.injections).toBe(5)
    expect(ghk.clean.rate).toBeCloseTo(0.2)
    expect(ghk.viaBlends).toEqual([{ blendId: 'klow', injections: 6, checked: 6, reactions: 6 }])
    expect(klow.isBlend).toBe(true)
    expect(klow.clean.rate).toBe(1)
  })

  it('a constituent seen only through a blend still gets a row, with no clean data', () => {
    const rows = byPeptide(ctx(many(6, 'klow', () => ({ reacted: true })), peptides))
    const ghk = rows.find((r) => r.peptideId === 'ghkcu')
    expect(ghk).toBeTruthy()
    expect(ghk.clean.injections).toBe(0)
    expect(ghk.clean.rate).toBeNull()
    expect(ghk.viaBlends[0].reactions).toBe(6)
  })
})

describe('breakdowns', () => {
  it('by needle spec, gauge and length together', () => {
    const list = [
      ...many(5, 'a', (i) => ({ reacted: i < 1, needle: { gauge: '32G', lengthMm: 6 } })),
      ...many(5, 'a', (i) => ({ reacted: i < 3, needle: { gauge: '27G', lengthMm: 13 } })),
      ...many(2, 'a', () => ({ needle: { gauge: '27G', lengthMm: 6 } })),
      ...many(3, 'a', () => ({ needle: null })),
    ]
    const out = byNeedle(ctx(list))
    expect(out.rows.map((r) => r.label).sort()).toEqual(['27G × 13 mm', '27G × 6 mm', '32G × 6 mm'])
    expect(out.rows.find((r) => r.label === '27G × 13 mm').rate).toBeCloseTo(0.6)
    expect(out.rows.find((r) => r.label === '32G × 6 mm').rate).toBeCloseTo(0.2)
    expect(out.rows.find((r) => r.label === '27G × 6 mm').rate).toBeNull() // only two
    expect(out.unrecorded).toBe(3)
  })

  it('by site region', () => {
    const list = [
      ...many(5, 'a', (i) => ({ reacted: i < 2, group: 'abdomen' })),
      ...many(3, 'a', () => ({ group: 'thigh' })),
    ]
    const out = byRegion(ctx(list))
    expect(out.rows.find((r) => r.key === 'abdomen').rate).toBeCloseTo(0.4)
    expect(out.rows.find((r) => r.key === 'thigh').status).toBe('insufficient')
  })

  it('patterns() bundles all three and the totals', () => {
    const p = patterns(ctx(many(6, 'a', (i) => ({ reacted: i < 1 }))))
    expect(p.totals).toEqual({ injections: 6, checked: 6, reactions: 1 })
    expect(p.peptides).toHaveLength(1)
    expect(p.needles.rows).toHaveLength(1)
    expect(p.regions.rows).toHaveLength(1)
  })

  it('ranks nothing: no cause, order or score fields come back', () => {
    const p = patterns(ctx(many(6, 'a', () => ({ reacted: true }))))
    const flat = JSON.stringify(p)
    expect(flat).not.toMatch(/"(rank|score|cause|culprit|confidence)"/)
  })
})

describe('log-time capture', () => {
  const gear = [
    { category: 'Syringe needles', gauge: '29G', lengthMm: 13, status: 'in_use' },
    { category: 'Syringe needles', gauge: '32G', lengthMm: 6, status: 'in_use' },
    { category: 'Syringe needles', gauge: '25G', lengthMm: 13, status: 'stock' },
    { category: 'Pen needles', gauge: '32G', lengthMm: 4, status: 'in_use' },
  ]

  it('lists only what is In use for the category', () => {
    expect(inUseNeedles(gear, 'Syringe needles').map(needleKey)).toEqual(['29G|13', '32G|6'])
    expect(inUseNeedles(gear, 'Pen needles')).toHaveLength(1)
  })

  it('a single needle in use is the pre-fill', () => {
    const one = [gear[1], gear[2]]
    expect(suggestNeedle({ peptide: { route: 'SubQ' }, gearItems: one }).needle).toEqual({ gauge: '32G', lengthMm: 6 })
  })

  it('with several in use and no history, SubQ takes the shortest and IM the longest', () => {
    const longer = [...gear, { category: 'Syringe needles', gauge: '23G', lengthMm: 25, status: 'in_use' }]
    expect(suggestNeedle({ peptide: { route: 'SubQ' }, gearItems: longer }).needle.lengthMm).toBe(6)
    expect(suggestNeedle({ peptide: { route: 'IM' }, gearItems: longer }).needle.lengthMm).toBe(25)
  })

  it('the last needle used wins when it is still in use, and the rest are offered', () => {
    const records = [{ needle: { gauge: '29G', lengthMm: 13 }, timestamp: '2026-10-01T00:00:00Z', route: 'SubQ' }]
    const s = suggestNeedle({ peptide: { route: 'SubQ' }, gearItems: gear, records })
    expect(s.needle).toEqual({ gauge: '29G', lengthMm: 13 })
    expect(s.choices).toHaveLength(2)
  })

  it('a needle no longer in use is not suggested from history', () => {
    const records = [{ needle: { gauge: '25G', lengthMm: 13 }, timestamp: '2026-10-01T00:00:00Z' }]
    expect(suggestNeedle({ peptide: { route: 'SubQ' }, gearItems: gear, records }).needle.gauge).not.toBe('25G')
  })

  it('nothing in use means nothing invented', () => {
    expect(suggestNeedle({ peptide: {}, gearItems: [] }).needle).toBeNull()
  })

  it('flags a co-draw when more than one shared the syringe', () => {
    const logs = [
      { id: 'a', peptideId: 'bpc157', coDrawId: 'cd1' },
      { id: 'b', peptideId: 'tb500', coDrawId: 'cd1' },
      { id: 'c', peptideId: 'kpv' },
    ]
    expect(coDrawInfo(logs, 'a')).toEqual({ coDraw: true, coDrawId: 'cd1', peptideIds: ['bpc157', 'tb500'] })
    expect(coDrawInfo(logs, 'c')).toEqual({ coDraw: false, coDrawId: null, peptideIds: ['kpv'] })
  })

  it('captureFor pulls it all together', () => {
    const logs = [{ id: 'a', peptideId: 'bpc157', coDrawId: 'cd1' }, { id: 'b', peptideId: 'tb500', coDrawId: 'cd1' }]
    const c = captureFor({ peptide: { id: 'bpc157', route: 'SubQ' }, doseLogId: 'a', doseLogs: logs, gearItems: [gear[1]] })
    expect(c).toMatchObject({ coDraw: true, coDrawPeptideIds: ['bpc157', 'tb500'], route: 'SubQ', needle: { gauge: '32G', lengthMm: 6 } })
  })

  it('needle helpers normalise', () => {
    expect(normaliseNeedle({ gauge: 32, lengthMm: '6' })).toEqual({ gauge: '32G', lengthMm: 6 })
    expect(normaliseNeedle({ gauge: '32G' })).toBeNull()
    expect(needleLabel(null)).toBe('Not recorded')
  })
})

import { suggestSite, warningsFor, openReactionPins } from './siteRotation'
import { pinStatus } from './reactionTracker'

describe('the map and the suggestion know about reactions', () => {
  const NOW = '2026-10-08T10:00:00'
  const rec = (id, pinId, ts) => ({ id, peptideId: 'bpc157', pinId, siteGroup: 'abdomen', timestamp: ts })
  const old = rec('a', 'abd-l-upper-inner', '2026-09-28T10:00:00')
  const openRx = { ...applyCheck(null, { date: '2026-10-06', severity: 'moderate' }), injectionRecordId: 'a' }
  const goneRx = { ...applyCheck(applyCheck(null, { date: '2026-10-01', severity: 'moderate' }), { date: '2026-10-03', severity: 'none' }), injectionRecordId: 'a' }
  const staleRx = { ...applyCheck(null, { date: '2026-09-29', severity: 'moderate' }), injectionRecordId: 'a' }

  it('an open reaction marks its pin as reacting even when the shot is outside the rotation window', () => {
    const ctx = { records: [old], reactions: [openRx], nowIso: NOW, windowDays: 7 }
    expect(Object.keys(openReactionPins(ctx))).toEqual(['abd-l-upper-inner'])
    expect(pinStatus('abd-l-upper-inner', ctx)).toMatchObject({ status: 'reacting', mark: 'open' })
    expect(warningsFor('abd-l-upper-inner', 'bpc157', ctx)[0].kind).toBe('reacting')
  })

  it('the suggestion keeps away from a site that is currently reacting', () => {
    const ctx = { records: [old], reactions: [openRx], nowIso: NOW, windowDays: 7, group: 'abdomen' }
    expect(suggestSite('bpc157', ctx).pinId).not.toBe('abd-l-upper-inner')
  })

  it('a resolved reaction still marks the pin but is no longer avoided', () => {
    const ctx = { records: [old], reactions: [goneRx], nowIso: NOW, windowDays: 7 }
    const st = pinStatus('abd-l-upper-inner', ctx)
    expect(st.status).not.toBe('reacting')
    expect(st.mark).toBe('resolved')
    expect(openReactionPins(ctx)).toEqual({})
  })

  it('an abandoned reaction is marked as such and stops blocking the site', () => {
    const ctx = { records: [old], reactions: [staleRx], nowIso: NOW, windowDays: 7 }
    const st = pinStatus('abd-l-upper-inner', ctx)
    expect(st.status).not.toBe('reacting')
    expect(st.mark).toBe('abandoned')
  })

  it('a pin that never reacted has no mark', () => {
    const ctx = { records: [old], reactions: [{ ...applyCheck(null, { date: '2026-10-06', severity: 'none' }), injectionRecordId: 'a' }], nowIso: NOW }
    expect(pinStatus('abd-l-upper-inner', ctx).mark).toBeNull()
  })
})

import { buildSummaryHtml } from './summaryDoc'
import { buildCalendar } from './calendarView'
import { describeBackup } from './backup'

describe('reactions in the calendar, the summary and the backup', () => {
  const peptides = [{ id: 'bpc157', name: 'BPC-157', ladder: { floor: 250, step: 0, intervalWeeks: 1, ceiling: 250, unit: 'mcg' }, frequency: 'daily', startDate: '2026-01-01', startedOn: '2026-01-01', slot: 'AM', recon: { vialMg: 5, bacMl: 2 } }]
  const records = [{ id: 'a', peptideId: 'bpc157', pinId: 'abd-l-upper-inner', siteGroup: 'abdomen', needle: { gauge: '32G', lengthMm: 6 }, timestamp: '2026-09-27T10:00:00Z' }]
  const rx = { ...applyCheck(applyCheck(null, { date: '2026-09-28', severity: 'moderate', symptoms: ['redness'] }), { date: '2026-09-30', severity: 'none' }), injectionRecordId: 'a' }

  it('the calendar shows it on the day it was logged, and only that day', () => {
    const cal = buildCalendar({ peptides, reactions: [rx], injectionRecords: records, todayStr: '2026-10-08', from: '2026-09-25', to: '2026-10-05' })
    const withReaction = cal.days.filter((d) => d.events.some((e) => e.kind === 'reaction')).map((d) => d.date)
    expect(withReaction).toEqual(['2026-09-28'])
    expect(cal.byDate['2026-09-28'].events.find((e) => e.kind === 'reaction').text).toMatch(/Reaction — Left .*BPC-157 \(moderate\)/)
  })

  it('the summary lists it with its outcome and needle', () => {
    const html = buildSummaryHtml({
      peptides, titration: {}, doseLogs: [], measurements: [], runs: {},
      summary: { rows: [], overall: { pct: null, taken: 0, scheduled: 0 } },
      from: '2026-09-01', to: '2026-10-08', reactions: [rx], injectionRecords: records,
    })
    expect(html).toContain('Injection-site reactions')
    expect(html).toContain('32G × 6 mm')
    expect(html).toMatch(/Resolved after 2 days/)
    expect(html).not.toContain('undefined')
  })

  it('says so when there are none', () => {
    const html = buildSummaryHtml({
      peptides, titration: {}, doseLogs: [], measurements: [], runs: {},
      summary: { rows: [], overall: { pct: null, taken: 0, scheduled: 0 } }, from: '2026-09-01', to: '2026-10-08',
    })
    expect(html).toContain('No reactions logged in this window')
  })

  it('the backup describes them', () => {
    expect(describeBackup({ appState: { state: { reactions: [rx], injectionRecords: records } } }).reactions).toBe(1)
  })
})
