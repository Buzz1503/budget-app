// v35 — tenure and the dose timeline.
//
// The thing under test is a distinction the rest of the app has to keep: a log
// is a record of something recorded, `startedOn` is a claim about the past, and
// typed-in prior history is arithmetic on a memory. All three are useful; only
// the first one is evidence. Every test here is ultimately about keeping them
// from being quietly added together.
import { describe, it, expect } from 'vitest'
import {
  durationWords, runsFor, tenureFor, onVsOff, cyclePosition,
  doseTimeline, cumulativeExposure, milestonesFor, MILESTONES,
  reassessPrompt, protocolTenure,
} from './tenure'
import { addDaysStr } from './schedule'

const T = '2026-09-26'
const day = (o) => addDaysStr(T, o)

const pep = (over = {}) => ({
  id: 'bpc157', name: 'BPC-157', startDate: day(-60), startedOn: day(-60),
  frequency: 'daily', route: 'SubQ', slot: 'AM', timing: 'morning',
  ladder: { unit: 'mcg', floor: 250, step: 250, ceiling: 500, intervalWeeks: 2 },
  cycleOnDays: 0, cycleOffDays: 0,
  recon: { vialMg: 5, bacMl: 2, expiryDays: 28 },
  ...over,
})

const log = (over = {}) => ({
  id: `l-${Math.random()}`, peptideId: 'bpc157', date: T, loggedAt: `${T}T08:00:00.000Z`,
  doseValue: 250, unit: 'mcg', route: 'SubQ', ...over,
})

// ============================================================ 1 · durations

describe('durationWords', () => {
  it('counts days while days are still the honest unit', () => {
    expect(durationWords(0)).toBe('today')
    expect(durationWords(1)).toBe('1 day')
    expect(durationWords(13)).toBe('13 days')
  })

  it('switches to weeks, then months, then years', () => {
    expect(durationWords(14)).toBe('2 weeks')
    expect(durationWords(16)).toBe('2 weeks, 2 days')
    expect(durationWords(70)).toMatch(/^2 months/)
    expect(durationWords(365)).toBe('1 year')
    expect(durationWords(400)).toBe('1 year, 1 month')
  })

  it('has no answer for nonsense rather than inventing one', () => {
    expect(durationWords(null)).toBe(null)
    expect(durationWords(-5)).toBe(null)
    expect(durationWords(NaN)).toBe(null)
  })
})

// ================================================================= 2 · runs

describe('runsFor', () => {
  it('implies one open run from startedOn when no run history exists', () => {
    const runs = runsFor(pep(), {})
    expect(runs).toHaveLength(1)
    expect(runs[0].startedOn).toBe(day(-60))
    expect(runs[0].endedOn).toBe(null)
  })

  it('returns stored runs oldest first', () => {
    const runs = runsFor(pep(), {
      bpc157: [
        { id: 'r2', startedOn: day(-30), endedOn: null },
        { id: 'r1', startedOn: day(-200), endedOn: day(-150) },
      ],
    })
    expect(runs.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('has nothing to say about a compound with no start at all', () => {
    expect(runsFor(pep({ startedOn: null }), {})).toEqual([])
  })
})

describe('tenureFor', () => {
  it('reports current run and lifetime as one number when there is one run', () => {
    const t = tenureFor(pep(), { runs: {}, todayStr: T })
    expect(t.currentDays).toBe(60)
    expect(t.lifetimeDays).toBe(60)
    expect(t.runCount).toBe(1)
    expect(t.summary).toBe(durationWords(60))
  })

  it('keeps the current stretch separate from the lifetime across a restart', () => {
    const t = tenureFor(pep({ startedOn: day(-200) }), {
      runs: {
        bpc157: [
          { id: 'r1', startedOn: day(-200), endedOn: day(-150) }, // 50 days
          { id: 'r2', startedOn: day(-40), endedOn: null },       // 40 days
        ],
      },
      todayStr: T,
    })
    expect(t.currentDays).toBe(40)
    expect(t.lifetimeDays).toBe(90)
    expect(t.longestRunDays).toBe(50)
    expect(t.summary).toContain('across 2 runs')
    expect(t.running).toBe(true)
  })

  it('knows when nothing is running now but history still stands', () => {
    const t = tenureFor(pep(), {
      runs: { bpc157: [{ id: 'r1', startedOn: day(-100), endedOn: day(-60) }] },
      todayStr: T,
    })
    expect(t.running).toBe(false)
    expect(t.currentDays).toBe(0)
    expect(t.currentWords).toBe(null)
    expect(t.lifetimeDays).toBe(40)
  })
})

// =========================================================== 3 · on vs off

describe('onVsOff', () => {
  it('says so plainly when a compound is not cycled', () => {
    expect(onVsOff(pep(), { todayStr: T }).cycled).toBe(false)
  })

  it('counts on-weeks inside the window for a cycled compound', () => {
    const p = pep({ cycleOnDays: 42, cycleOffDays: 14, startDate: day(-112), startedOn: day(-112) })
    const r = onVsOff(p, { todayStr: T, weeks: 16 })
    expect(r.cycled).toBe(true)
    expect(r.onWeeks).toBeLessThan(r.weeks)
    expect(r.onWeeks).toBeGreaterThan(0)
    expect(r.words).toBe(`on ${r.onWeeks} of the last ${r.weeks} weeks`)
  })

  it('never counts back further than the compound existed', () => {
    const p = pep({ cycleOnDays: 42, cycleOffDays: 14, startDate: day(-20), startedOn: day(-20) })
    expect(onVsOff(p, { todayStr: T, weeks: 20 }).weeks).toBeLessThanOrEqual(3)
  })

  it('has nothing to say in the first fortnight rather than saying zero', () => {
    const p = pep({ cycleOnDays: 42, cycleOffDays: 14, startDate: T, startedOn: T })
    const r = onVsOff(p, { todayStr: T })
    expect(r.tooNew).toBe(true)
    expect(r.words).toBe(null)
  })

  it('does not count backdated days as off — the cycle was unknowable then', () => {
    // on the protocol for two years, but only scheduled here three months ago
    const p = pep({ cycleOnDays: 42, cycleOffDays: 14, startDate: day(-90), startedOn: day(-730) })
    const r = onVsOff(p, { todayStr: T, weeks: 20 })
    expect(r.weeks).toBeLessThanOrEqual(13)
    expect(r.onWeeks).toBeGreaterThan(0)
  })
})

describe('cyclePosition', () => {
  it('is quiet about compounds that do not cycle', () => {
    expect(cyclePosition(pep(), T).cycled).toBe(false)
  })

  it('gives the day, the cycle number and the date it flips', () => {
    const p = pep({ cycleOnDays: 42, cycleOffDays: 14, startDate: day(-10), startedOn: day(-10) })
    const c = cyclePosition(p, T)
    expect(c.phase).toBe('on')
    expect(c.cycleNumber).toBe(1)
    expect(c.dayOfPhase).toBe(11)
    expect(c.phaseLength).toBe(42)
    expect(c.nextChange).toBe(day(32)) // 42 - 11 + 1 = 32 days left on the stretch
    expect(c.words).toBe('cycle 1, day 11 of 42 on')
  })

  it('reads the rest phase and the date it comes back', () => {
    const p = pep({ cycleOnDays: 42, cycleOffDays: 14, startDate: day(-45), startedOn: day(-45) })
    const c = cyclePosition(p, T)
    expect(c.phase).toBe('rest')
    expect(c.nextChange).toBeTruthy()
    expect(c.words).toContain('off')
  })
})

// ============================================================ 4 · timeline

describe('doseTimeline', () => {
  it('puts manually entered history first and marks every point of it estimated', () => {
    const p = pep({
      startedOn: day(-60),
      priorDoseHistory: [
        { id: 'ph1', fromDate: day(-400), dose: 250, unit: 'mcg', frequency: 'daily' },
        { id: 'ph2', fromDate: day(-200), dose: 500, unit: 'mcg', frequency: 'daily' },
      ],
    })
    const { points } = doseTimeline(p, {
      doseEvents: [{ id: 'e1', peptideId: 'bpc157', date: day(-60), kind: 'start', to: 250, unit: 'mcg' }],
      todayStr: T,
    })
    expect(points[0].kind).toBe('prior')
    expect(points[0].estimated).toBe(true)
    expect(points[0].detail).toBe('Entered manually, before logging')
    expect(points[1].estimated).toBe(true)
    expect(points[2].kind).toBe('start')
    expect(points[2].estimated).toBe(false)
  })

  it('shows a step-up with the dose before and after', () => {
    const { points } = doseTimeline(pep(), {
      doseEvents: [
        { id: 'e1', peptideId: 'bpc157', date: day(-60), kind: 'start', to: 250, unit: 'mcg' },
        { id: 'e2', peptideId: 'bpc157', date: day(-30), kind: 'step-up', from: 250, to: 500, unit: 'mcg' },
      ],
      todayStr: T,
    })
    const step = points.find((x) => x.kind === 'step-up')
    expect(step.from).toBe(250)
    expect(step.to).toBe(500)
    expect(step.detail).toBe('250 → 500 mcg')
  })

  it('ignores events belonging to other compounds', () => {
    const { points } = doseTimeline(pep(), {
      doseEvents: [{ id: 'e1', peptideId: 'tb500', date: day(-5), kind: 'step-up', from: 1, to: 2 }],
      todayStr: T,
    })
    expect(points.filter((x) => x.kind === 'step-up')).toHaveLength(0)
  })

  it('marks a logging gap so a flat line is not read as steady dosing', () => {
    const { points } = doseTimeline(pep(), {
      doseLogs: [log({ date: day(-90) }), log({ date: day(-10) })],
      todayStr: T,
    })
    const gap = points.find((x) => x.kind === 'gap')
    expect(gap).toBeTruthy()
    expect(gap.detail).toBe('80 days with nothing logged')
  })

  it('leaves short gaps alone', () => {
    const { points } = doseTimeline(pep(), {
      doseLogs: [log({ date: day(-10) }), log({ date: day(-6) })],
      todayStr: T,
    })
    expect(points.some((x) => x.kind === 'gap')).toBe(false)
  })

  it('marks the end of a closed run as a stop', () => {
    const { points } = doseTimeline(pep(), {
      runs: { bpc157: [{ id: 'r1', startedOn: day(-100), endedOn: day(-60), reason: 'removed' }] },
      todayStr: T,
    })
    const stop = points.find((x) => x.kind === 'stop')
    expect(stop.date).toBe(day(-60))
    expect(stop.detail).toBe('Taken off the protocol')
  })

  it('bands the cycle on and off behind the line', () => {
    const p = pep({ cycleOnDays: 42, cycleOffDays: 14, startDate: day(-120), startedOn: day(-120) })
    const { bands } = doseTimeline(p, { todayStr: T })
    expect(bands.length).toBeGreaterThan(1)
    expect(bands.some((b) => b.on)).toBe(true)
    expect(bands.some((b) => !b.on)).toBe(true)
    // contiguous, no holes
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].from).toBe(addDaysStr(bands[i - 1].to, 1))
    }
  })

  it('draws no bands for a compound that does not cycle', () => {
    expect(doseTimeline(pep(), { todayStr: T }).bands).toHaveLength(0)
  })

  it('starts the bands where the cycle became knowable, not where the line does', () => {
    const p = pep({
      cycleOnDays: 42, cycleOffDays: 14, startDate: day(-60), startedOn: day(-400),
      priorDoseHistory: [{ id: 'ph1', fromDate: day(-400), dose: 250, unit: 'mcg', frequency: 'daily' }],
    })
    const { points, bands } = doseTimeline(p, { todayStr: T })
    expect(points[0].date).toBe(day(-400))
    expect(bands[0].from).toBe(day(-60))
  })

  it('turns dose points into flat segments that meet end to end', () => {
    const { segments } = doseTimeline(pep(), {
      doseEvents: [
        { id: 'e1', peptideId: 'bpc157', date: day(-60), kind: 'start', to: 250, unit: 'mcg' },
        { id: 'e2', peptideId: 'bpc157', date: day(-30), kind: 'step-up', from: 250, to: 500, unit: 'mcg' },
      ],
      todayStr: T,
    })
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ from: day(-60), to: day(-30), dose: 250 })
    expect(segments[1]).toMatchObject({ from: day(-30), to: T, dose: 500 })
  })

  it('has nothing to draw for no compound', () => {
    expect(doseTimeline(null, {})).toEqual({ points: [], bands: [], segments: [] })
  })
})

// ============================================================ 5 · exposure

describe('cumulativeExposure', () => {
  it('counts logged doses exactly', () => {
    const e = cumulativeExposure(pep(), {
      doseLogs: [log({ doseValue: 250 }), log({ doseValue: 500 }), log({ peptideId: 'tb500', doseValue: 5, unit: 'mg' })],
      todayStr: T,
    })
    expect(e.doses).toBe(2)
    expect(e.loggedMg).toBeCloseTo(0.75, 5) // 250mcg + 500mcg
    expect(e.injections).toBe(2)
    expect(e.avgDoseMg).toBeCloseTo(0.375, 5)
  })

  it('separates sprays from injections', () => {
    const e = cumulativeExposure(pep(), {
      doseLogs: [log({ route: 'Nasal' }), log({ route: 'SubQ' })],
      todayStr: T,
    })
    expect(e.sprays).toBe(1)
    expect(e.injections).toBe(1)
  })

  it('never folds estimated history into the logged figure', () => {
    const p = pep({
      startedOn: day(-70),
      priorDoseHistory: [{ id: 'ph1', fromDate: day(-140), dose: 250, unit: 'mcg', frequency: 'daily' }],
    })
    const e = cumulativeExposure(p, { doseLogs: [log({ doseValue: 250 })], todayStr: T })
    expect(e.loggedMg).toBeCloseTo(0.25, 5)
    expect(e.estimatedMg).toBeGreaterThan(0)
    expect(e.hasEstimate).toBe(true)
    expect(e.totalMg).toBeCloseTo(e.loggedMg + e.estimatedMg, 5)
    expect(e.estimatedDoses).toBe(70) // 70 days, daily
  })

  it('says nothing is estimated when nothing was typed in', () => {
    const e = cumulativeExposure(pep(), { doseLogs: [log()], todayStr: T })
    expect(e.hasEstimate).toBe(false)
    expect(e.estimatedMg).toBe(0)
    expect(e.totalMg).toBe(e.loggedMg)
  })

  it('prices only what was actually logged', () => {
    const e = cumulativeExposure(pep(), {
      doseLogs: Array.from({ length: 20 }, () => log({ doseValue: 250 })),
      todayStr: T, usdPerVial: 50, fx: 1.5,
    })
    // 20 × 250mcg = 5mg = exactly one 5mg vial = 50 USD × 1.5
    expect(e.spend).toBeCloseTo(75, 4)
  })

  it('has no price when the vial price is unknown', () => {
    expect(cumulativeExposure(pep(), { doseLogs: [log()], todayStr: T }).spend).toBe(null)
  })
})

// ========================================================== 6 · milestones

describe('milestonesFor', () => {
  it('lists what has passed and what is next', () => {
    const m = milestonesFor(60)
    expect(m.passed.map((x) => x.label)).toEqual(['4 weeks', '8 weeks'])
    expect(m.next.label).toBe('12 weeks')
    expect(m.next.inDays).toBe(24)
    expect(m.today).toBe(null)
  })

  it('notices the day a milestone lands', () => {
    expect(milestonesFor(84).today.label).toBe('12 weeks')
  })

  it('runs out of milestones without breaking', () => {
    const m = milestonesFor(900)
    expect(m.passed).toHaveLength(MILESTONES.length)
    expect(m.next).toBe(null)
  })
})

// ============================================================ 7 · reassess

describe('reassessPrompt', () => {
  const ceiling = { level: 1, levelStartDate: day(-120) }

  it('asks a question rather than giving an instruction', () => {
    const p = pep({ startedOn: day(-200) })
    const tenure = tenureFor(p, { runs: {}, todayStr: T })
    const r = reassessPrompt(p, { tenure, titration: { bpc157: ceiling }, todayStr: T })
    expect(r.kind).toBe('ceiling')
    expect(r.text).toMatch(/\?$/)
    expect(r.text).not.toMatch(/should|must|stop taking|reduce/i)
  })

  it('stays quiet for someone who only just reached the top of the ladder', () => {
    const p = pep()
    const tenure = tenureFor(p, { runs: {}, todayStr: T })
    expect(reassessPrompt(p, {
      tenure, titration: { bpc157: { level: 1, levelStartDate: day(-10) } }, todayStr: T,
    })).toBe(null)
  })

  it('notices a cycled compound past three full cycles', () => {
    const p = pep({ cycleOnDays: 42, cycleOffDays: 14, startDate: day(-300), startedOn: day(-300) })
    const tenure = tenureFor(p, { runs: {}, todayStr: T })
    const r = reassessPrompt(p, { tenure, titration: { bpc157: { level: 0, levelStartDate: day(-300) } }, todayStr: T })
    expect(r.kind).toBe('long-cycle')
  })

  it('notices a year uncycled', () => {
    const p = pep({ startedOn: day(-400) })
    const tenure = tenureFor(p, { runs: {}, todayStr: T })
    const r = reassessPrompt(p, { tenure, titration: { bpc157: { level: 0, levelStartDate: day(-400) } }, todayStr: T })
    expect(r.kind).toBe('long-run')
  })

  it('says nothing about a compound that is not running', () => {
    const p = pep()
    const tenure = tenureFor(p, {
      runs: { bpc157: [{ id: 'r1', startedOn: day(-500), endedOn: day(-10) }] }, todayStr: T,
    })
    expect(reassessPrompt(p, { tenure, titration: {}, todayStr: T })).toBe(null)
  })
})

// =================================================== 8 · the Protocol line

describe('protocolTenure', () => {
  it('answers what am I on and for how long in one call', () => {
    const p = pep({ cycleOnDays: 42, cycleOffDays: 14, startDate: day(-70), startedOn: day(-70) })
    const r = protocolTenure(p, { runs: {}, titration: { bpc157: { level: 0, levelStartDate: day(-70) } }, todayStr: T })
    expect(r.tenure.currentDays).toBe(70)
    expect(r.cycle.cycled).toBe(true)
    expect(r.onOff.cycled).toBe(true)
    expect(r.milestones.passed.length).toBeGreaterThan(0)
  })
})

// ============================================== 9 · backdating stays inert

describe('backdating a start date', () => {
  it('changes tenure and nothing about what was logged', () => {
    const logs = [log({ date: day(-5) }), log({ date: day(-3) })]
    const before = cumulativeExposure(pep({ startedOn: day(-10) }), { doseLogs: logs, todayStr: T })
    const after = cumulativeExposure(pep({ startedOn: day(-900) }), { doseLogs: logs, todayStr: T })
    expect(after.doses).toBe(before.doses)
    expect(after.loggedMg).toBe(before.loggedMg)
    expect(after.estimatedMg).toBe(0)

    expect(tenureFor(pep({ startedOn: day(-900) }), { runs: {}, todayStr: T }).currentDays).toBe(900)
  })

  it('does not invent a timeline point for the backdated start on its own', () => {
    const { points } = doseTimeline(pep({ startedOn: day(-900) }), { todayStr: T })
    expect(points.filter((x) => x.kind === 'prior')).toHaveLength(0)
  })
})
