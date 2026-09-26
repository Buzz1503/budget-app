// v36 — tenure wired into everything that reads time.
//
// The library in v35 is only useful if the rest of the app asks it rather than
// guessing from the logs. These tests hold the seams: the calendar, the outcome
// chart, symptom attribution and the shareable document all have to agree on
// when a compound started and what dose it was on when.
import { describe, it, expect } from 'vitest'
import { buildCalendar } from './calendarView'
import { peptideDoseSeries, peptideEvents } from './metrics'
import { lastChange, recencyScore, RECENCY_WINDOW } from './attribution'
import { buildSummaryHtml } from './summaryDoc'
import { adherenceSummary } from './adherence'
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

const ev = (over = {}) => ({
  id: `de-${Math.random()}`, peptideId: 'bpc157', kind: 'step-up',
  date: day(-30), from: 250, to: 500, unit: 'mcg', ...over,
})

// ============================================ 1 · the calendar knows tenure

describe('buildCalendar with runs', () => {
  const base = { todayStr: T, titration: { bpc157: { level: 0, levelStartDate: day(-60) } } }

  it('marks the day a run began', () => {
    const cal = buildCalendar({
      ...base, peptides: [pep()],
      runs: { bpc157: [{ id: 'r1', startedOn: day(-3), endedOn: null }] },
      from: day(-7), to: T,
    })
    const started = cal.byDate[day(-3)].events.filter((e) => e.kind === 'started')
    expect(started).toHaveLength(1)
    expect(started[0].text).toContain('started')
  })

  it('marks an anniversary on the day it falls', () => {
    const cal = buildCalendar({
      ...base, peptides: [pep({ startedOn: day(-28) })],
      runs: { bpc157: [{ id: 'r1', startedOn: day(-28), endedOn: null }] },
      from: day(-2), to: T,
    })
    const marks = cal.byDate[T].events.filter((e) => e.kind === 'anniversary')
    expect(marks).toHaveLength(1)
    expect(marks[0].text).toContain('4 weeks')
  })

  it('stops counting anniversaries once a run has ended', () => {
    const cal = buildCalendar({
      ...base, peptides: [pep({ startedOn: day(-28) })],
      runs: { bpc157: [{ id: 'r1', startedOn: day(-28), endedOn: day(-10) }] },
      from: day(-2), to: T,
    })
    expect(cal.byDate[T].events.some((e) => e.kind === 'anniversary')).toBe(false)
  })

  it('falls back to startedOn when there is no run list', () => {
    const cal = buildCalendar({ ...base, peptides: [pep({ startedOn: day(-1) })], from: day(-3), to: T })
    expect(cal.byDate[day(-1)].events.some((e) => e.kind === 'started')).toBe(true)
  })

  it('still builds when nothing about tenure is passed at all', () => {
    const cal = buildCalendar({ ...base, peptides: [pep()], from: day(-2), to: T })
    expect(cal.days).toHaveLength(3)
  })
})

// ===================================== 2 · the chart reads real dose history

describe('peptideDoseSeries', () => {
  it('uses the dose that was actually recorded at each date', () => {
    const series = peptideDoseSeries(pep(), { level: 1, levelStartDate: day(-30) }, day(-40), T, {
      doseEvents: [ev({ kind: 'start', date: day(-60), from: null, to: 250 }), ev({ date: day(-30) })],
    })
    const before = series.find((d) => d.date === day(-35))
    const after = series.find((d) => d.date === day(-10))
    expect(before.dose).toBe(250)
    expect(after.dose).toBe(500)
    expect(before.estimated).toBe(false)
  })

  it('falls back to the current rung and says it is a fallback', () => {
    const series = peptideDoseSeries(pep(), { level: 1, levelStartDate: day(-30) }, day(-10), T)
    expect(series.every((d) => d.estimated)).toBe(true)
    expect(series[0].dose).toBe(500)
  })

  it('reports nothing delivered on an off-cycle day', () => {
    const p = pep({ cycleOnDays: 5, cycleOffDays: 2, startDate: day(-5), startedOn: day(-5) })
    const series = peptideDoseSeries(p, { level: 0, levelStartDate: day(-5) }, day(-5), T)
    expect(series.some((d) => d.dose === 0 && !d.isOn)).toBe(true)
  })
})

describe('peptideEvents', () => {
  it('marks every recorded dose change, not just the rung standing now', () => {
    const events = peptideEvents(pep(), { level: 2, levelStartDate: day(-5) }, day(-60), T, {
      doseEvents: [ev({ date: day(-40) }), ev({ date: day(-20), from: 500, to: 750 })],
    })
    expect(events.filter((e) => e.kind === 'step-up')).toHaveLength(2)
  })

  it('falls back to the ladder\'s own bookkeeping when nothing was recorded', () => {
    const events = peptideEvents(pep(), { level: 1, levelStartDate: day(-20) }, day(-60), T)
    expect(events.filter((e) => e.kind === 'step-up')).toHaveLength(1)
  })
})

// ==================================== 3 · attribution stops blaming the old

describe('lastChange', () => {
  it('anchors on tenure, not on a schedule date that moved', () => {
    const p = pep({ startedOn: day(-300), startDate: day(-2) })
    expect(lastChange(p, { level: 0, levelStartDate: day(-300) })).toBe(day(-300))
  })

  it('takes a recorded step-up as the most recent change', () => {
    const p = pep({ startedOn: day(-300) })
    const changed = lastChange(p, { level: 0, levelStartDate: day(-300) }, [ev({ date: day(-4) })])
    expect(changed).toBe(day(-4))
  })

  it('leaves a long-standing compound out of the recent window', () => {
    const p = pep({ startedOn: day(-300), startDate: day(-2) })
    expect(recencyScore(lastChange(p, {}), T)).toBe(0)
  })

  it('scores a compound started days ago as a recent change', () => {
    const p = pep({ startedOn: day(-2) })
    const score = recencyScore(lastChange(p, {}), T)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeCloseTo(1 - 2 / RECENCY_WINDOW, 5)
  })

  it('ignores events belonging to another compound', () => {
    const p = pep({ startedOn: day(-300) })
    expect(lastChange(p, {}, [ev({ peptideId: 'tb500', date: day(-1) })])).toBe(day(-300))
  })
})

// ========================================== 4 · the document, and adherence

describe('buildSummaryHtml', () => {
  const args = () => {
    const peptides = [pep()]
    const doseLogs = [
      { id: 'l1', peptideId: 'bpc157', date: day(-2), doseValue: 250, unit: 'mcg', route: 'SubQ' },
      { id: 'l2', peptideId: 'bpc157', date: day(-1), doseValue: 250, unit: 'mcg', route: 'SubQ' },
    ]
    return {
      peptides, doseLogs, titration: { bpc157: { level: 0, levelStartDate: day(-60) } },
      measurements: [], from: day(-29), to: T,
      summary: adherenceSummary(peptides, doseLogs, day(-29), T),
      runs: { bpc157: [{ id: 'r1', startedOn: day(-60), endedOn: null }] },
    }
  }

  it('renders without a hole where a removed feature used to be', () => {
    const html = buildSummaryHtml(args())
    expect(html).not.toContain('undefined')
    expect(html).not.toMatch(/site/i)
  })

  it('states time on compound and what was taken', () => {
    const html = buildSummaryHtml(args())
    expect(html).toContain('Time on compound')
    expect(html).toContain('Doses logged')
  })

  it('says out loud that adherence counts records, not history', () => {
    expect(buildSummaryHtml(args())).toContain('recorded at the time')
  })

  it('flags an estimated column only when something was typed in', () => {
    const plain = buildSummaryHtml(args())
    expect(plain).not.toContain('multiplied out')

    const a = args()
    a.peptides = [pep({
      priorDoseHistory: [{ id: 'ph1', fromDate: day(-200), dose: 250, unit: 'mcg', frequency: 'daily' }],
    })]
    expect(buildSummaryHtml(a)).toContain('multiplied out')
  })

  it('survives a protocol with nothing in it', () => {
    const html = buildSummaryHtml({
      peptides: [], doseLogs: [], titration: {}, measurements: [],
      from: day(-29), to: T, summary: adherenceSummary([], [], day(-29), T),
    })
    expect(html).toContain('No peptides configured')
  })
})

describe('adherence against a backdated start', () => {
  it('does not change when tenure reaches back before the logs', () => {
    const logs = [{ id: 'l1', peptideId: 'bpc157', date: day(-1), doseValue: 250, unit: 'mcg' }]
    const near = adherenceSummary([pep({ startDate: day(-6), startedOn: day(-6) })], logs, day(-6), T)
    const far = adherenceSummary([pep({ startDate: day(-6), startedOn: day(-900) })], logs, day(-6), T)
    expect(far.overall).toEqual(near.overall)
  })
})
