import { describe, it, expect } from 'vitest'
import { TOPICAL_SEED, nightsFrom, backfillTopicals, isTopical } from './topicals'
import { FORMS, FORM_LABEL, takeVerb, dosePlaceholder } from './supplements'
import { buildCalendar } from './calendarView'
import useStore from '../store/useStore'

const TODAY = '2026-10-08'
const logsFor = (out, id) => out.supplementLogs.filter((l) => l.supplementId === id)

describe('topical form', () => {
  it('is offered beside the oral forms', () => {
    expect(FORMS).toEqual(expect.arrayContaining(['tablet', 'capsule', 'powder', 'spray', 'liquid', 'topical']))
    expect(FORM_LABEL.topical).toBe('Topical')
  })
  it('is applied, not taken, and has no oral placeholder', () => {
    expect(takeVerb({ form: 'topical' })).toBe('Applied')
    expect(takeVerb({ form: 'capsule' })).toBe('Taken')
    expect(dosePlaceholder('topical')).not.toMatch(/capsule|mouth|oral|inject/i)
  })
  it('isTopical', () => {
    expect(isTopical({ form: 'topical' })).toBe(true)
    expect(isTopical({ form: 'spray' })).toBe(false)
  })
})

describe('nightly backfill', () => {
  it('counts the nights from the start through today, inclusive', () => {
    expect(nightsFrom('2026-08-13', TODAY)).toHaveLength(57)
    expect(nightsFrom('2026-08-17', TODAY)).toHaveLength(53)
    expect(nightsFrom('2026-10-08', TODAY)).toEqual(['2026-10-08'])
    expect(nightsFrom('2026-10-09', TODAY)).toEqual([])
  })

  it('adds both topicals as PM, topical, with no dose', () => {
    const out = backfillTopicals({}, TODAY)
    const min = out.supplements.find((s) => s.name === 'Minoxidil')
    const tre = out.supplements.find((s) => s.name === 'Tretinoin')
    for (const s of [min, tre]) {
      expect(s.form).toBe('topical')
      expect(s.slot).toBe('PM')
      expect(s.dose).toBe('')
    }
    expect(min.addedOn).toBe('2026-08-13')
    expect(tre.addedOn).toBe('2026-08-17')
  })

  it('logs one entry per night for each, none before its start', () => {
    const out = backfillTopicals({}, TODAY)
    const min = logsFor(out, 'sup-minoxidil')
    const tre = logsFor(out, 'sup-tretinoin')
    expect(min).toHaveLength(57)
    expect(tre).toHaveLength(53)
    expect(min.map((l) => l.date).sort()[0]).toBe('2026-08-13')
    expect(tre.map((l) => l.date).sort()[0]).toBe('2026-08-17')
    expect(min.at(-1).date).toBe(TODAY)
    expect(tre.some((l) => l.date < '2026-08-17')).toBe(false)
    expect(min.every((l) => l.dose === '' && l.backfilled === false)).toBe(true)
  })

  it('on the start date itself there is exactly one night', () => {
    expect(logsFor(backfillTopicals({}, '2026-08-13'), 'sup-minoxidil')).toHaveLength(1)
    expect(logsFor(backfillTopicals({}, '2026-08-13'), 'sup-tretinoin')).toHaveLength(0)
    expect(logsFor(backfillTopicals({}, '2026-08-12'), 'sup-minoxidil')).toHaveLength(0)
  })

  it('never duplicates: running twice changes nothing', () => {
    const once = backfillTopicals({}, TODAY)
    const twice = backfillTopicals(once, TODAY)
    expect(twice.supplementLogs).toHaveLength(once.supplementLogs.length)
    expect(twice.supplements).toHaveLength(2)
    const keys = twice.supplementLogs.map((l) => `${l.supplementId}|${l.date}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('fills only what is missing, and leaves other supplements and logs alone', () => {
    const base = {
      supplements: [{ id: 'x', name: 'Zinc', form: 'capsule', slot: 'AM', dose: '15 mg' }],
      supplementLogs: [{ id: 'l1', supplementId: 'x', date: '2026-09-01' }],
    }
    const first = backfillTopicals(base, '2026-09-01')
    const later = backfillTopicals(first, TODAY)
    expect(later.supplementLogs.filter((l) => l.supplementId === 'x')).toHaveLength(1)
    expect(logsFor(later, 'sup-minoxidil')).toHaveLength(57)
    expect(later.supplements.find((s) => s.id === 'x').dose).toBe('15 mg')
  })

  it('reuses an existing Minoxidil rather than adding a second', () => {
    const out = backfillTopicals({
      supplements: [{ id: 'mine', name: 'minoxidil', form: 'topical', slot: 'PM', dose: '1 mL', addedOn: '2026-09-20' }],
    }, TODAY)
    expect(out.supplements.filter((s) => /minoxidil/i.test(s.name))).toHaveLength(1)
    const m = out.supplements.find((s) => s.id === 'mine')
    expect(m.addedOn).toBe('2026-08-13')
    expect(m.dose).toBe('1 mL') // theirs, untouched
    expect(logsFor(out, 'mine')).toHaveLength(57)
  })

  it('shows up on the calendar as taken on the PM side, from the start day only', () => {
    const out = backfillTopicals({}, TODAY)
    const cal = buildCalendar({
      supplements: out.supplements, supplementLogs: out.supplementLogs,
      todayStr: TODAY, from: '2026-08-10', to: '2026-08-20',
    })
    const day = (d) => cal.byDate[d].oralEntries.map((e) => `${e.name}:${e.taken}`).sort()
    expect(day('2026-08-12')).toEqual([])
    expect(day('2026-08-13')).toEqual(['Minoxidil:true'])
    expect(day('2026-08-17')).toEqual(['Minoxidil:true', 'Tretinoin:true'])
    expect(cal.byDate['2026-08-17'].orals.PM).toHaveLength(2)
    expect(cal.byDate['2026-08-17'].orals.AM).toHaveLength(0)
  })

  it('the store migration applies it to an older save', () => {
    const migrate = useStore.persist.getOptions().migrate
    const out = migrate({ supplements: [], supplementLogs: [] }, 19)
    expect(out.supplements.map((s) => s.name).sort()).toEqual(['Minoxidil', 'Tretinoin'])
    expect(out.supplementLogs.length).toBeGreaterThanOrEqual(0)
    expect(TOPICAL_SEED).toHaveLength(2)
  })
})
