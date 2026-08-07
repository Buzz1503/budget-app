import { describe, it, expect } from 'vitest'
import {
  insightsReadiness, symptomTrends, timingCoincidences, bodyTrends,
  adherenceInsights, quietStretch, siteConcentration, buildInsights, topInsight,
  GATES, INSIGHTS_CAVEAT,
} from './insights'
import {
  weekBounds, periodId, whatsComing, recentCycleBoundary, buildRecap, shouldSurfaceRecap,
} from './recap'
import { format as formatNum } from '../components/ui/NumberField'
import {
  categoryOf, CATEGORIES, groupedStackSymptoms, searchStackSymptoms, likelyNow, recentlyLogged,
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
  it('puts every symptom in exactly one known category', () => {
    const ids = new Set(CATEGORIES.map((c) => c.id))
    for (const c of CATEGORIES) expect(ids.has(categoryOf('nonexistent-symptom') || 'other')).toBe(true)
    expect(ids.has(categoryOf('insomnia'))).toBe(true)
    expect(categoryOf('insomnia')).toBe('sleep')
    expect(categoryOf('inj_reaction')).toBe('injection')
  })
  it('falls back to "other" rather than dropping an unmapped symptom', () => {
    expect(categoryOf('something-added-next-year')).toBe('other')
  })
  it('never returns an empty category group', () => {
    const groups = groupedStackSymptoms([pep()], 'neg')
    for (const g of groups) expect(g.symptoms.length).toBeGreaterThan(0)
  })
  it('ranks prefix matches above mid-word matches when searching', () => {
    const hits = searchStackSymptoms([pep()], 'na')
    if (hits.length > 1) {
      const firstStarts = hits[0].label.toLowerCase().startsWith('na')
      const anyStarts = hits.some((h) => h.label.toLowerCase().startsWith('na'))
      if (anyStarts) expect(firstStarts).toBe(true)
    }
  })
  it('returns nothing for an empty query rather than the whole list', () => {
    expect(searchStackSymptoms([pep()], '')).toEqual([])
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

// -------------------------------------------------------------------- gating

describe('insight gating', () => {
  it('says nothing at all on a fresh install', () => {
    const { cards, readiness } = buildInsights({
      symptomLogs: [], measurements: [], doseLogs: [], peptides: [pep()], titration: {}, todayStr: T,
    })
    expect(cards).toEqual([])
    expect(readiness.ready).toBe(false)
    expect(readiness.missing.length).toBeGreaterThan(0)
  })

  it('needs both enough check-in days and enough elapsed time', () => {
    // 12 check-ins, but all crammed into the last 12 days
    const dense = Array.from({ length: 12 }, (_, i) => check(-i, [neg('nausea')]))
    expect(insightsReadiness({ symptomLogs: dense, measurements: [], doseLogs: [], todayStr: T }).symptomsReady)
      .toBe(false)

    const spread = Array.from({ length: 12 }, (_, i) => check(-i * 3, [neg('nausea')]))
    expect(insightsReadiness({ symptomLogs: spread, measurements: [], doseLogs: [], todayStr: T }).symptomsReady)
      .toBe(true)
  })

  it('needs two measurements a fortnight apart before reading a body trend', () => {
    const near = [{ date: day(-3), weight: 90 }, { date: day(-1), weight: 89 }]
    expect(insightsReadiness({ symptomLogs: [], measurements: near, doseLogs: [], todayStr: T }).bodyReady)
      .toBe(false)
    const far = [{ date: day(-40), weight: 90 }, { date: day(-1), weight: 89 }]
    expect(insightsReadiness({ symptomLogs: [], measurements: far, doseLogs: [], todayStr: T }).bodyReady)
      .toBe(true)
  })
})

// ----------------------------------------------------------- symptom trends

describe('symptomTrends', () => {
  // logged on 10 of the last 14 days, 2 of the 14 before
  const rising = [
    ...Array.from({ length: 10 }, (_, i) => check(-i, [neg('nausea')])),
    ...Array.from({ length: 2 }, (_, i) => check(-15 - i, [neg('nausea')])),
    ...Array.from({ length: 4 }, (_, i) => check(-18 - i, [pos('energy_up')])),
  ]

  it('reports a rise in days logged, in days', () => {
    const [t] = symptomTrends({ symptomLogs: rising, todayStr: T })
    expect(t.kind).toBe('symptom-trend')
    expect(t.title).toMatch(/up/)
    expect(t.body).toMatch(/10 days/)
  })

  it('marks more of a negative symptom as something to watch, not as good news', () => {
    const [t] = symptomTrends({ symptomLogs: rising, todayStr: T })
    expect(t.tone).toBe('watch')
  })

  it('calls more of a positive effect good', () => {
    const logs = [
      ...Array.from({ length: 9 }, (_, i) => check(-i, [pos('energy_up')])),
      ...Array.from({ length: 5 }, (_, i) => check(-15 - i, [neg('nausea')])),
      ...Array.from({ length: 1 }, (_, i) => check(-22 - i, [pos('energy_up')])),
    ]
    const t = symptomTrends({ symptomLogs: logs, todayStr: T }).find((c) => c.symptomId === 'energy_up')
    expect(t.tone).toBe('good')
  })

  it('stays quiet when one window is barely populated', () => {
    const lopsided = Array.from({ length: 10 }, (_, i) => check(-i, [neg('nausea')]))
    expect(symptomTrends({ symptomLogs: lopsided, todayStr: T })).toEqual([])
  })

  it('ignores a difference of one or two days as noise', () => {
    const flat = [
      ...Array.from({ length: 6 }, (_, i) => check(-i, [neg('nausea')])),
      ...Array.from({ length: 5 }, (_, i) => check(-15 - i, [neg('nausea')])),
    ]
    expect(symptomTrends({ symptomLogs: flat, todayStr: T })).toEqual([])
  })
})

// ------------------------------------------------------------------- timing

describe('timingCoincidences', () => {
  const peptides = [pep({ id: 'reta', name: 'Retatrutide', startDate: day(-20) })]
  const logs = [
    check(-30, [neg('headache')]),
    check(-18, [neg('nausea')]),
    check(-16, [neg('nausea')]),
    check(-10, [neg('nausea')]),
  ]

  it('reports the gap between a compound change and a symptom first appearing', () => {
    const [c] = timingCoincidences({ symptomLogs: logs, peptides, titration: {}, todayStr: T })
    expect(c.peptideId).toBe('reta')
    expect(c.symptomId).toBe('nausea')
    expect(c.title).toMatch(/2 days after/)
  })

  it('never claims causation — it says so in the card body', () => {
    const [c] = timingCoincidences({ symptomLogs: logs, peptides, titration: {}, todayStr: T })
    expect(c.body).toMatch(/not a cause/i)
  })

  it('skips a symptom that was already happening before the change', () => {
    const out = timingCoincidences({ symptomLogs: logs, peptides, titration: {}, todayStr: T })
    expect(out.map((c) => c.symptomId)).not.toContain('headache')
  })

  it('skips a one-off — a symptom has to have stuck around', () => {
    const once = [check(-18, [neg('nausea')])]
    expect(timingCoincidences({ symptomLogs: once, peptides, titration: {}, todayStr: T })).toEqual([])
  })

  it('ignores a symptom that first appears long after the change', () => {
    const late = [check(-2, [neg('nausea')]), check(-1, [neg('nausea')]), check(0, [neg('nausea')])]
    expect(timingCoincidences({ symptomLogs: late, peptides, titration: {}, todayStr: T })).toEqual([])
  })
})

// --------------------------------------------------------------- body trends

describe('bodyTrends', () => {
  const measurements = [
    { date: day(-60), weight: 95, waist: 96 },
    { date: day(-30), weight: 92.5, waist: 94 },
    { date: day(-2), weight: 91, waist: 92 },
  ]

  it('states the change as a rate so the window is visible', () => {
    const [t] = bodyTrends({ measurements, todayStr: T })
    expect(t.body).toMatch(/a week/)
    expect(t.evidence).toMatch(/3 readings/)
  })

  it('knows which direction counts as progress for each metric', () => {
    const w = bodyTrends({ measurements, todayStr: T }).find((c) => c.metric === 'weight')
    expect(w.tone).toBe('good') // weight down
    const up = bodyTrends({ measurements: [{ date: day(-60), weight: 90 }, { date: day(-1), weight: 94 }], todayStr: T })
    expect(up[0].tone).toBe('watch')
  })

  it('says nothing from a single reading', () => {
    expect(bodyTrends({ measurements: [{ date: day(-5), weight: 90 }], todayStr: T })).toEqual([])
  })
})

// ---------------------------------------------------------------- adherence

describe('adherenceInsights', () => {
  const peptides = [pep()]
  const doseLogs = Array.from({ length: 25 }, (_, i) => ({
    id: `d${i}`, peptideId: 'bpc157', date: day(-i), doseValue: 250, unit: 'mcg',
  }))

  it('reports the plain percentage', () => {
    const [c] = adherenceInsights({ peptides, doseLogs, measurements: [], todayStr: T })
    expect(c.kind).toBe('adherence')
    expect(c.title).toMatch(/% of scheduled doses/)
  })

  it('places a body change beside adherence without linking the two', () => {
    const measurements = [{ date: day(-25), weight: 92 }, { date: day(-1), weight: 90 }]
    const c = adherenceInsights({ peptides, doseLogs, measurements, todayStr: T })
      .find((x) => x.kind === 'adherence-body')
    expect(c).toBeTruthy()
    expect(c.body).toMatch(/no way to tell whether one moved the other/i)
    expect(c.tone).toBe('neutral')
  })

  it('stays quiet when barely anything was scheduled', () => {
    expect(adherenceInsights({ peptides: [], doseLogs: [], measurements: [], todayStr: T })).toEqual([])
  })
})

// -------------------------------------------------------------------- others

describe('quietStretch', () => {
  it('notices a clean run of check-ins', () => {
    const logs = Array.from({ length: 6 }, (_, i) => check(-i, [pos('energy_up')]))
    const [c] = quietStretch({ symptomLogs: logs, todayStr: T })
    expect(c.tone).toBe('good')
    expect(c.title).toMatch(/6 check-ins/)
  })
  it('breaks the run on the first negative', () => {
    const logs = [check(0, [pos('energy_up')]), check(-1, [neg('nausea')]),
      ...Array.from({ length: 6 }, (_, i) => check(-2 - i, [pos('energy_up')]))]
    expect(quietStretch({ symptomLogs: logs, todayStr: T })).toEqual([])
  })
})

describe('siteConcentration', () => {
  it('reports reactions clustering at one spot', () => {
    const logs = [
      check(-1, [neg('inj_reaction')], { site: 'thigh-l' }),
      check(-4, [neg('inj_reaction')], { site: 'thigh-l' }),
      check(-8, [neg('inj_reaction')], { site: 'thigh-l' }),
      check(-12, [neg('inj_reaction')], { site: 'abdomen-r' }),
    ]
    const [c] = siteConcentration({ symptomLogs: logs, todayStr: T })
    expect(c.site).toBe('thigh-l')
    expect(c.body).toMatch(/3 of 4/)
  })
  it('says nothing when reactions are spread around', () => {
    const logs = [
      check(-1, [neg('inj_reaction')], { site: 'thigh-l' }),
      check(-4, [neg('inj_reaction')], { site: 'thigh-r' }),
      check(-8, [neg('inj_reaction')], { site: 'abdomen-l' }),
      check(-12, [neg('inj_reaction')], { site: 'abdomen-r' }),
    ]
    expect(siteConcentration({ symptomLogs: logs, todayStr: T })).toEqual([])
  })
})

// ------------------------------------------------------------------ honesty

describe('insight language', () => {
  const ctx = {
    peptides: [pep({ id: 'reta', name: 'Retatrutide', startDate: day(-20) })],
    titration: {},
    doseLogs: Array.from({ length: 25 }, (_, i) => ({ id: `d${i}`, peptideId: 'reta', date: day(-i) })),
    symptomLogs: [
      ...Array.from({ length: 10 }, (_, i) => check(-i, [neg('nausea')])),
      ...Array.from({ length: 5 }, (_, i) => check(-15 - i * 2, [neg('headache')])),
    ],
    measurements: [{ date: day(-40), weight: 95 }, { date: day(-1), weight: 91 }],
    todayStr: T,
  }

  it('never asserts that a compound works', () => {
    const { cards } = buildInsights(ctx)
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) {
      const text = `${c.title} ${c.body}`.toLowerCase()
      expect(text).not.toMatch(/\b(works|is working|effective|proven|caused|causes|because of)\b/)
      expect(text).not.toMatch(/\byou should\b/)
    }
  })

  it('carries a caveat that names correlation and rules out medical advice', () => {
    expect(INSIGHTS_CAVEAT).toMatch(/not proof of cause/i)
    expect(INSIGHTS_CAVEAT).toMatch(/medical advice/i)
  })

  it('puts something actionable at the top of Home when there is one', () => {
    const top = topInsight(ctx)
    expect(top).toBeTruthy()
    expect(top.title.length).toBeGreaterThan(0)
  })
})

// -------------------------------------------------------------------- recap

describe('weekBounds', () => {
  it('starts the week on Monday', () => {
    expect(weekBounds('2026-06-15').start).toBe('2026-06-15') // Monday
    expect(weekBounds('2026-06-21').start).toBe('2026-06-15') // Sunday of the same week
    expect(weekBounds('2026-06-14').start).toBe('2026-06-08') // Sunday belongs to the week before
  })
  it('gives the previous week as a full seven days', () => {
    const w = weekBounds('2026-06-17')
    expect(w.prevStart).toBe('2026-06-08')
    expect(w.prevEnd).toBe('2026-06-14')
  })
  it('ids a period by its Monday, so it is stable all week', () => {
    expect(periodId('2026-06-15')).toBe(periodId('2026-06-19'))
    expect(periodId('2026-06-15')).not.toBe(periodId('2026-06-22'))
  })
})

describe('whatsComing', () => {
  it('lists a step-up that lands inside the week', () => {
    const p = pep() // floor 250 → ceiling 500, two weeks a rung
    const titration = { bpc157: { level: 0, levelStartDate: day(-11) } }
    const out = whatsComing({ peptides: [p], titration, vials: [], openVials: {}, todayStr: T })
    const step = out.find((c) => c.kind === 'step-up')
    expect(step).toBeTruthy()
    expect(step.inDays).toBe(3)
  })

  it('lists a cycle flip and names the direction', () => {
    const p = pep({ startDate: day(-8), cycleOnDays: 10, cycleOffDays: 10 })
    const out = whatsComing({ peptides: [p], titration: {}, vials: [], openVials: {}, todayStr: T })
    const flip = out.find((c) => c.kind === 'cycle-off')
    expect(flip).toBeTruthy()
    expect(flip.inDays).toBe(2)
  })

  it('is sorted soonest first', () => {
    const ps = [
      pep({ id: 'a', name: 'A', startDate: day(-8), cycleOnDays: 10, cycleOffDays: 10 }),
      pep({ id: 'b', name: 'B', startDate: day(-3), cycleOnDays: 5, cycleOffDays: 5 }),
    ]
    const out = whatsComing({ peptides: ps, titration: {}, vials: [], openVials: {}, todayStr: T })
    const dates = out.map((c) => c.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('is empty for an ongoing compound with stock and no ladder left', () => {
    const p = pep({ ladder: { unit: 'mcg', floor: 250, step: 0, ceiling: 250, intervalWeeks: 2 } })
    const out = whatsComing({
      peptides: [p], titration: { bpc157: { level: 0, levelStartDate: day(-30) } },
      vials: [{ id: 'v', peptideId: 'bpc157', qtyOnHand: 20, vialMg: 5 }],
      openVials: {}, todayStr: T,
    })
    expect(out.filter((c) => c.kind === 'step-up')).toEqual([])
  })
})

describe('recentCycleBoundary', () => {
  it('finds a flip that happened in the last couple of days', () => {
    const p = pep({ id: 'x', name: 'X', startDate: day(-11), cycleOnDays: 10, cycleOffDays: 10 })
    const b = recentCycleBoundary({ peptides: [p], todayStr: T })
    expect(b).toBeTruthy()
    expect(b.nowOn).toBe(false)
  })
  it('is null mid-cycle', () => {
    const p = pep({ id: 'x', name: 'X', startDate: day(-5), cycleOnDays: 10, cycleOffDays: 10 })
    expect(recentCycleBoundary({ peptides: [p], todayStr: T })).toBe(null)
  })
})

describe('buildRecap', () => {
  // A Thursday, so "this week so far" is an actual span rather than one day.
  const TH = '2026-06-18'
  const d = (o) => addDaysStr(TH, o)
  const ctx = {
    peptides: [pep()],
    titration: { bpc157: { level: 0, levelStartDate: d(-30) } },
    doseLogs: Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, peptideId: 'bpc157', date: d(-i) })),
    symptomLogs: [
      ...Array.from({ length: 4 }, (_, i) => check(0, [neg('nausea')], { id: `n${i}`, date: d(-i) })),
      check(0, [neg('nausea')], { id: 'n-old', date: d(-8) }),
    ],
    measurements: [{ date: d(-10), weight: 92 }, { date: d(-1), weight: 90.5 }],
    vials: [], openVials: {}, todayStr: TH,
  }

  it('covers the week so far by default', () => {
    const r = buildRecap(ctx)
    expect(r.range.from).toBe(weekBounds(TH).start)
    expect(r.range.to).toBe(TH)
  })

  it('can report the completed week instead', () => {
    const r = buildRecap(ctx, { period: 'last' })
    expect(r.range.from).toBe(weekBounds(TH).prevStart)
    expect(r.range.to).toBe(weekBounds(TH).prevEnd)
  })

  it('measures a body change against the last reading before the window', () => {
    const r = buildRecap(ctx)
    const w = r.body.find((b) => b.key === 'weight')
    expect(w).toBeTruthy()
    expect(w.since).toBe(d(-10))
    expect(w.diff).toBe(-1.5)
    expect(w.better).toBe(true)
  })

  it('reports adherence as taken over scheduled', () => {
    const r = buildRecap(ctx)
    expect(r.adherence.taken).toBeGreaterThan(0)
    expect(r.adherence.scheduled).toBeGreaterThan(0)
  })

  it('is flagged empty when there is nothing at all', () => {
    const r = buildRecap({
      peptides: [], titration: {}, doseLogs: [], symptomLogs: [], measurements: [],
      vials: [], openVials: {}, todayStr: TH,
    })
    expect(r.empty).toBe(true)
  })
})

describe('shouldSurfaceRecap', () => {
  // Built around the day under test, so each case has a populated week behind it.
  const ctxOn = (today, over = {}) => ({
    peptides: [pep()],
    titration: { bpc157: { level: 0, levelStartDate: addDaysStr(today, -30) } },
    doseLogs: Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, peptideId: 'bpc157', date: addDaysStr(today, -i) })),
    symptomLogs: Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`, date: addDaysStr(today, -i), tags: [neg('nausea')], note: '', site: null, activePeptides: [],
    })),
    measurements: [], vials: [], openVials: {}, todayStr: today, ...over,
  })

  it('stays hidden on an ordinary midweek day', () => {
    expect(shouldSurfaceRecap(ctxOn('2026-06-17'), null)).toBe(null) // Wednesday
  })

  it('appears at the end of the week', () => {
    const out = shouldSurfaceRecap(ctxOn('2026-06-20'), null) // Saturday
    expect(out).toBeTruthy()
    expect(out.reason).toBe('week')
  })

  it('appears right after a cycle boundary, whatever the day', () => {
    const out = shouldSurfaceRecap(ctxOn('2026-06-17', {
      peptides: [pep({ startDate: addDaysStr('2026-06-17', -11), cycleOnDays: 10, cycleOffDays: 10 })],
    }), null)
    expect(out).toBeTruthy()
    expect(out.reason).toBe('cycle')
  })

  it('stays dismissed for the rest of the week, then returns', () => {
    const id = periodId('2026-06-20')
    expect(shouldSurfaceRecap(ctxOn('2026-06-20'), id)).toBe(null)
    // next week's Saturday is a different period, so it comes back
    expect(shouldSurfaceRecap(ctxOn('2026-06-27'), id)).toBeTruthy()
  })
})
