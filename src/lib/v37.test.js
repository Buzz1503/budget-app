// v37 — the cycle line, and time at the current dose.
//
// Two small figures that the rest of v30.1 is built on. The cycle line has to
// fit on one row of a dose card and still say something true on the day a
// compound flips state; time-at-dose has to be a different number from time on
// compound, because the whole point of it is that the two disagree.
import { describe, it, expect } from 'vitest'
import { cyclePosition, doseTenure } from './tenure'
import { autoShortName } from './naming'
import { buildSummaryHtml } from './summaryDoc'
import { adherenceSummary } from './adherence'
import { addDaysStr } from './schedule'

const T = '2026-09-26'
const day = (o) => addDaysStr(T, o)

const pep = (over = {}) => ({
  id: 'bpc157', name: 'BPC-157', startDate: day(-10), startedOn: day(-10),
  frequency: 'daily', route: 'SubQ', slot: 'AM', timing: 'morning',
  ladder: { unit: 'mcg', floor: 250, step: 250, ceiling: 1000, intervalWeeks: 2 },
  cycleOnDays: 0, cycleOffDays: 0,
  recon: { vialMg: 5, bacMl: 2, expiryDays: 28 },
  ...over,
})

const ev = (over = {}) => ({
  id: `de-${Math.random()}`, peptideId: 'bpc157', kind: 'step-up',
  date: day(-30), from: 250, to: 500, unit: 'mcg', ...over,
})

// ========================================================= 1 · cycle line

describe('cyclePosition.short', () => {
  it('says nothing for a compound with no cycle', () => {
    const c = cyclePosition(pep(), T)
    expect(c.cycled).toBe(false)
    expect(c.short).toBe(null)
  })

  it('reads "Day N of M" while on', () => {
    const p = pep({ cycleOnDays: 28, cycleOffDays: 14, startDate: day(-10), startedOn: day(-10) })
    expect(cyclePosition(p, T).short).toBe('Day 11 of 28')
  })

  it('names the date it comes back while off', () => {
    const p = pep({ cycleOnDays: 28, cycleOffDays: 14, startDate: day(-30), startedOn: day(-30) })
    const c = cyclePosition(p, T)
    expect(c.phase).toBe('rest')
    expect(c.short).toMatch(/^Off · resumes \d{1,2} \w{3}$/)
  })

  it('marks the last day on, which is the one worth seeing early', () => {
    const p = pep({ cycleOnDays: 28, cycleOffDays: 14, startDate: day(-27), startedOn: day(-27) })
    const c = cyclePosition(p, T)
    expect(c.daysLeft).toBe(1)
    expect(c.lastDay).toBe(true)
    expect(c.short).toBe('Day 28 of 28 · last day on')
  })

  it('says tomorrow rather than a date on the last day off', () => {
    const p = pep({ cycleOnDays: 28, cycleOffDays: 14, startDate: day(-41), startedOn: day(-41) })
    const c = cyclePosition(p, T)
    expect(c.phase).toBe('rest')
    expect(c.short).toBe('Off · back on tomorrow')
  })

  it('stays short enough for one line in every state', () => {
    for (const off of [0, 30]) {
      const p = pep({ cycleOnDays: 28, cycleOffDays: 14, startDate: day(-off), startedOn: day(-off) })
      const { short } = cyclePosition(p, T)
      if (short) expect(short.length).toBeLessThanOrEqual(30)
    }
  })
})

// ================================================== 2 · time at this dose

describe('doseTenure', () => {
  it('counts from the last recorded dose change, not from the start', () => {
    const p = pep({ startedOn: day(-200) })
    const d = doseTenure(p, {
      doseEvents: [
        ev({ kind: 'start', date: day(-200), from: null, to: 250 }),
        ev({ date: day(-21), from: 250, to: 350 }),
      ],
      titration: { bpc157: { level: 1, levelStartDate: day(-21) } },
      todayStr: T,
    })
    expect(d.days).toBe(21)
    expect(d.words).toBe('3 weeks at 350 mcg')
  })

  it('reports a hand-set dose, not the rung the ladder still thinks it is on', () => {
    // an override moves the dose without moving the rung; asking the ladder
    // would report 500 and then draw a step up to it that never happened
    const d = doseTenure(pep(), {
      doseEvents: [
        ev({ kind: 'start', date: day(-60), from: null, to: 250 }),
        ev({ kind: 'override', date: day(-7), from: 250, to: 300 }),
      ],
      titration: { bpc157: { level: 1, levelStartDate: day(-60) } },
      todayStr: T,
    })
    expect(d.dose).toBe(300)
    expect(d.progression).toBe('250 → 300 mcg')
    expect(d.progression).not.toContain('500')
  })

  it('falls back to the ladder when nothing was recorded', () => {
    const d = doseTenure(pep(), {
      titration: { bpc157: { level: 0, levelStartDate: day(-14) } }, todayStr: T,
    })
    expect(d.days).toBe(14)
  })

  it('spells the whole climb out, with the unit said once', () => {
    const d = doseTenure(pep(), {
      doseEvents: [
        ev({ kind: 'start', date: day(-90), from: null, to: 250 }),
        ev({ date: day(-60), from: 250, to: 500 }),
        ev({ date: day(-30), from: 500, to: 750 }),
      ],
      titration: { bpc157: { level: 2, levelStartDate: day(-30) } },
      todayStr: T,
    })
    expect(d.progression).toBe('250 → 500 → 750 mcg')
    expect(d.changed).toBe(true)
  })

  it('says so plainly when the dose has never moved', () => {
    const d = doseTenure(pep(), { titration: { bpc157: { level: 0, levelStartDate: day(-30) } }, todayStr: T })
    expect(d.changed).toBe(false)
    expect(d.progression).toBe('250 mcg throughout')
  })

  it('does not collapse a hold into a step', () => {
    const d = doseTenure(pep(), {
      doseEvents: [
        ev({ kind: 'start', date: day(-60), from: null, to: 250 }),
        ev({ kind: 'hold', date: day(-30), from: 250, to: 250 }),
      ],
      titration: { bpc157: { level: 0, levelStartDate: day(-60) } },
      todayStr: T,
    })
    expect(d.progression).toBe('250 mcg throughout')
  })

  it('ignores another compound\'s history', () => {
    const d = doseTenure(pep(), {
      doseEvents: [ev({ peptideId: 'tb500', date: day(-2), from: 1, to: 2 })],
      titration: { bpc157: { level: 0, levelStartDate: day(-40) } },
      todayStr: T,
    })
    expect(d.days).toBe(40)
    expect(d.changed).toBe(false)
  })

  it('notes that there is typed-in history behind the recorded part', () => {
    const p = pep({ priorDoseHistory: [{ id: 'ph1', fromDate: day(-400), dose: 100, unit: 'mcg', frequency: 'daily' }] })
    expect(doseTenure(p, { titration: {}, todayStr: T }).hasEstimatedBefore).toBe(true)
    expect(doseTenure(pep(), { titration: {}, todayStr: T }).hasEstimatedBefore).toBe(false)
  })
})

// ============================================ 3 · the document leads with it

describe('buildSummaryHtml after the reorder', () => {
  const args = (over = {}) => {
    const peptides = [pep({ startedOn: day(-90) })]
    const doseLogs = [{ id: 'l1', peptideId: 'bpc157', date: day(-1), doseValue: 250, unit: 'mcg', route: 'SubQ' }]
    return {
      peptides, doseLogs, titration: { bpc157: { level: 0, levelStartDate: day(-90) } },
      doseEvents: [
        ev({ kind: 'start', date: day(-90), from: null, to: 250 }),
        ev({ date: day(-30), from: 250, to: 500 }),
      ],
      measurements: [], from: day(-29), to: T,
      summary: adherenceSummary(peptides, doseLogs, day(-29), T),
      runs: { bpc157: [{ id: 'r1', startedOn: day(-90), endedOn: null }] },
      ...over,
    }
  }

  it('puts time on compound above the current protocol', () => {
    const html = buildSummaryHtml(args())
    expect(html.indexOf('Time on compound')).toBeLessThan(html.indexOf('Current protocol'))
  })

  it('carries the dose history and every change', () => {
    const html = buildSummaryHtml(args())
    expect(html).toContain('Dose history')
    expect(html).toContain('250 → 500 mcg')
    expect(html).toContain('Every dose change')
  })

  it('still renders nothing undefined with no events at all', () => {
    const html = buildSummaryHtml(args({ doseEvents: [] }))
    expect(html).not.toContain('undefined')
    expect(html).toContain('No dose changes recorded yet')
  })
})

// ====================================================== 4 · short names

describe('autoShortName', () => {
  it('drops a trailing parenthetical', () => {
    expect(autoShortName('KLOW (BPC-157 + GHK-Cu + TB-500 + KPV)')).toBe('KLOW')
  })

  it('never leaves a bracket hanging open', () => {
    // splitting on " + " inside the brackets used to yield "KLOW (BPC-157"
    expect(autoShortName('KLOW (BPC-157 + GHK-Cu + TB-500 + KPV) long blend')).toBe('KLOW')
    expect(autoShortName('Glow (BPC + TB500')).toBe('Glow')
  })

  it('leaves an ordinary name alone', () => {
    expect(autoShortName('CJC-1295 with DAC')).toBe('CJC-1295 with DAC')
    expect(autoShortName('BPC-157')).toBe('BPC-157')
  })

  it('keeps a name that is only a composition', () => {
    expect(autoShortName('A + B')).toBe('A + B')
  })
})
