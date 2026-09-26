import { describe, it, expect } from 'vitest'
import {
  SKIP_REASONS, REASON_LABEL, isSkipped, isSupplementSkipped, skippedOn,
  supplementsSkippedOn, skipFor, splitAdherence, dayOutcome, skipsInRange, skipCounts,
} from './skips'
import { buildCalendar, ADHERENCE_TONE, ADHERENCE_WORDS } from './calendarView'
import { seedPeptides, TEST_E_ID } from '../data/seed'
import { addDaysStr } from './schedule'

const T = '2026-06-18'
const day = (o) => addDaysStr(T, o)

const THIGH_IDS = ['thl-uo', 'thl-ui', 'thl-lo', 'thl-li', 'thr-uo', 'thr-ui', 'thr-lo', 'thr-li']
const BELLY_IDS = ['abd-ul', 'abd-ur', 'abd-ml', 'abd-mr', 'abd-ll', 'abd-lr', 'lh-l', 'lh-r']

const log = (siteId, offset, peptideId = 'ss31') => ({
  id: `l-${siteId}-${offset}`, siteId, peptideId,
  date: day(offset), loggedAt: `${day(offset)}T09:00:00`,
})
const ctx = (over = {}) => ({ doseLogs: [], reactions: {}, todayStr: T, route: 'SubQ', ...over })

// ================================================================ 1 · zones

describe('skipping a dose', () => {
  const skips = [
    { id: 'k1', kind: 'peptide', peptideId: 'ss31', date: T, name: 'SS-31', reason: 'travel', at: `${T}T08:00` },
    { id: 'k2', kind: 'supplement', supplementId: 's1', date: T, name: 'Glycine', reason: '', at: `${T}T09:00` },
    { id: 'k3', kind: 'peptide', peptideId: 'nad', date: day(-3), name: 'NAD+', reason: 'stock', at: `${day(-3)}T08:00` },
  ]

  it('reads back what was skipped, by kind and date', () => {
    expect(isSkipped(skips, 'ss31', T)).toBe(true)
    expect(isSkipped(skips, 'ss31', day(-1))).toBe(false)
    expect(isSupplementSkipped(skips, 's1', T)).toBe(true)
    // a supplement id must not match a peptide lookup
    expect(isSkipped(skips, 's1', T)).toBe(false)
  })

  it('gives the ids for a date as sets', () => {
    expect(skippedOn(skips, T)).toEqual(new Set(['ss31']))
    expect(supplementsSkippedOn(skips, T)).toEqual(new Set(['s1']))
  })

  it('keeps the reason when there is one, and copes when there is not', () => {
    expect(skipFor(skips, 'ss31', T).reason).toBe('travel')
    expect(REASON_LABEL.travel).toBe('Travelling')
    expect(skipFor(skips, 'missing', T)).toBe(null)
  })

  it('offers reasons but never demands one', () => {
    expect(SKIP_REASONS.length).toBeGreaterThan(2)
    // an empty reason is still a valid skip
    expect(isSupplementSkipped(skips, 's1', T)).toBe(true)
    expect(skips.find((k) => k.id === 'k2').reason).toBe('')
  })

  it('lists and counts skips in a window', () => {
    expect(skipsInRange(skips, day(-7), T)).toHaveLength(3)
    expect(skipsInRange(skips, T, T)).toHaveLength(2)
    expect(skipCounts(skips, day(-7), T)).toEqual({ ss31: 1, s1: 1, nad: 1 })
  })

  it('is newest first, so the recent decision is the visible one', () => {
    const rows = skipsInRange(skips, day(-7), T)
    expect(rows[0].date >= rows[rows.length - 1].date).toBe(true)
  })
})

describe('skips are not misses', () => {
  it('separates skipped from missed in the totals', () => {
    const a = splitAdherence({ scheduled: 10, taken: 7, skipped: 2 })
    expect(a.skipped).toBe(2)
    expect(a.missed).toBe(1) // 10 − 2 skipped − 7 taken
    expect(a.attempted).toBe(8)
  })

  it('reports the honest headline and the fairer read side by side', () => {
    const a = splitAdherence({ scheduled: 10, taken: 7, skipped: 2 })
    expect(a.pct).toBe(70) // of everything scheduled
    expect(a.ofAttempted).toBe(88) // of what wasn't deliberately skipped
    expect(a.ofAttempted).toBeGreaterThan(a.pct)
  })

  it('never reports a negative miss count', () => {
    const a = splitAdherence({ scheduled: 3, taken: 3, skipped: 3 })
    expect(a.missed).toBe(0)
  })

  it('has no rate to report when nothing was scheduled', () => {
    const a = splitAdherence({ scheduled: 0, taken: 0, skipped: 0 })
    expect(a.pct).toBe(null)
    expect(a.ofAttempted).toBe(null)
  })

  it('calls a fully skipped day skipped, never missed', () => {
    expect(dayOutcome({ scheduled: 2, taken: 0, skipped: 2 })).toBe('skipped')
    expect(dayOutcome({ scheduled: 2, taken: 0, skipped: 0 })).toBe('missed')
  })

  it('calls a day taken-and-skipped a resolved day, not a lapse', () => {
    expect(dayOutcome({ scheduled: 3, taken: 2, skipped: 1 })).toBe('partial-skipped')
  })

  it('still calls a genuinely incomplete day partial', () => {
    expect(dayOutcome({ scheduled: 3, taken: 1, skipped: 0 })).toBe('partial')
    expect(dayOutcome({ scheduled: 3, taken: 3, skipped: 0 })).toBe('all')
  })

  it('gives skipped its own colour and wording on the calendar', () => {
    expect(ADHERENCE_TONE.skipped).toBeTruthy()
    expect(ADHERENCE_TONE.skipped).not.toBe(ADHERENCE_TONE.missed)
    expect(ADHERENCE_WORDS.skipped).toBe('skipped')
  })
})

describe('skips in the calendar', () => {
  const p = {
    id: 'bpc157', name: 'BPC-157', startDate: day(-30), frequency: 'daily',
    ladder: { unit: 'mcg', floor: 250, step: 0, ceiling: 250, intervalWeeks: 2 },
    cycleOnDays: 0, cycleOffDays: 0, route: 'SubQ',
    recon: { vialMg: 5, bacMl: 2, expiryDays: 28 },
  }
  const base = {
    peptides: [p], titration: { bpc157: { level: 0, levelStartDate: day(-30) } },
    doseLogs: [], openVials: {}, vials: [], supplements: [], supplementLogs: [],
    restock: {}, todayStr: T,
  }

  it('marks a skipped day as skipped rather than missed', () => {
    const cal = buildCalendar({
      ...base, skips: [{ id: 'k', kind: 'peptide', peptideId: 'bpc157', date: day(-2) }],
      from: day(-2), to: day(-2),
    })
    expect(cal.byDate[day(-2)].adherence).toBe('skipped')
    expect(cal.byDate[day(-2)].skipped).toBe(1)
  })

  it('leaves an ordinary missed day alone', () => {
    const cal = buildCalendar({ ...base, skips: [], from: day(-2), to: day(-2) })
    expect(cal.byDate[day(-2)].adherence).toBe('missed')
  })

  it('does not let a skip make a day look taken', () => {
    const cal = buildCalendar({
      ...base, skips: [{ id: 'k', kind: 'peptide', peptideId: 'bpc157', date: day(-2) }],
      from: day(-2), to: day(-2),
    })
    expect(cal.byDate[day(-2)].done).toBe(0)
  })
})
