import { describe, it, expect } from 'vitest'
import {
  entryState, missedOn, missedOralsOn, missedGroups, missedDays, catchUpRun,
  vialOnDate, stockNote, doseOnDate,
} from './backfill'
import { sheetMaxHeight, ACCESSORY_BAR } from './viewport'

// --------------------------------------------------------------- fixtures

const entry = (id, over = {}) => ({
  peptideId: id, name: id, dose: 250, unit: 'mcg', units: 5,
  nasal: false, taken: false, skipped: false, ...over,
})

const oral = (id, over = {}) => ({
  supplementId: id, name: id, dose: '1 cap', oral: true, taken: false, skipped: false, ...over,
})

// A day shaped the way buildCalendar shapes one, with just the parts backfill reads.
const day = (date, entries, over = {}) => ({
  date,
  entries,
  oralEntries: over.oralEntries || [],
  plans: over.plans || {
    AM: { groups: entries.filter((e) => !e.nasal).map((e) => ({ items: [{ id: e.peptideId }] })) },
    PM: { groups: [] },
  },
  scheduled: entries.length + (over.oralEntries?.length || 0),
  isPast: true, isToday: false, isFuture: false,
  ...over,
})

// --------------------------------------------------------------- three states

describe('a dose is in exactly one of three states', () => {
  const d = day('2026-08-20', [])

  it('a log makes it logged', () => {
    expect(entryState(entry('a', { taken: true }), d)).toBe('logged')
  })

  it('a skip makes it skipped — a decision, not a lapse', () => {
    expect(entryState(entry('a', { skipped: true }), d)).toBe('skipped')
  })

  it('neither, on a day gone by, makes it missed', () => {
    expect(entryState(entry('a'), d)).toBe('missed')
  })

  it('a log beats a skip, because the dose was actually taken', () => {
    expect(entryState(entry('a', { taken: true, skipped: true }), d)).toBe('logged')
  })

  it('today is due, never missed — the day is not over', () => {
    expect(entryState(entry('a'), { ...d, isPast: false, isToday: true })).toBe('due')
  })

  it('a future day is scheduled, never missed', () => {
    expect(entryState(entry('a'), { ...d, isPast: false, isFuture: true })).toBe('scheduled')
  })
})

describe('missedOn', () => {
  it('picks out only what was never accounted for', () => {
    const d = day('2026-08-20', [
      entry('a', { taken: true }),
      entry('b', { skipped: true }),
      entry('c'),
    ])
    expect(missedOn(d).map((e) => e.peptideId)).toEqual(['c'])
  })

  it('never reports a missed dose on a day that has not been', () => {
    const d = day('2026-08-20', [entry('a')], { isPast: false, isToday: true })
    expect(missedOn(d)).toEqual([])
  })

  it('reads orals from their own bucket', () => {
    const d = day('2026-08-20', [], { oralEntries: [oral('m'), oral('z', { taken: true })] })
    expect(missedOralsOn(d).map((e) => e.supplementId)).toEqual(['m'])
  })
})

// --------------------------------------------------------------- co-draw

describe('missed doses group the way they would have been given', () => {
  const plans = {
    AM: { groups: [{ items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'c' }] }] },
    PM: { groups: [] },
  }

  it('compounds that shared a syringe catch up as one shot', () => {
    const d = day('2026-08-20', [entry('a'), entry('b'), entry('c')], { plans })
    const g = missedGroups(d)
    expect(g).toHaveLength(2)
    expect(g[0].items.map((i) => i.peptideId)).toEqual(['a', 'b'])
    expect(g[0].oneShot).toBe(true)
    expect(g[1].oneShot).toBe(false)
  })

  it('a group half-logged catches up only the half that is missing', () => {
    const d = day('2026-08-20', [entry('a', { taken: true }), entry('b'), entry('c')], { plans })
    const g = missedGroups(d)
    expect(g[0].items.map((i) => i.peptideId)).toEqual(['b'])
    // and the units are of what is actually being given, not of the old group
    expect(g[0].units).toBe(5)
    expect(g[0].oneShot).toBe(false)
  })

  it('sums the units of everything sharing the syringe', () => {
    const d = day('2026-08-20', [entry('a'), entry('b'), entry('c')], { plans })
    expect(missedGroups(d)[0].units).toBe(10)
  })

  it('a nasal spray is never folded into a syringe group', () => {
    const d = day('2026-08-20', [entry('n', { nasal: true, units: null })], {
      plans: { AM: { groups: [] }, PM: { groups: [] } },
    })
    const g = missedGroups(d)
    expect(g).toHaveLength(1)
    expect(g[0].nasal).toBe(true)
  })

  it('a day with nothing missed produces no groups at all', () => {
    const d = day('2026-08-20', [entry('a', { taken: true })], { plans })
    expect(missedGroups(d)).toEqual([])
  })
})

// --------------------------------------------------------------- the gap

describe('missedDays', () => {
  const days = [
    day('2026-08-18', [entry('a')]),
    day('2026-08-19', [entry('a', { taken: true })]),
    day('2026-08-20', [entry('a'), entry('b')]),
    day('2026-08-21', [entry('a')], { isPast: false, isToday: true }),
  ]

  it('lists past days still carrying a hole, oldest first', () => {
    expect(missedDays(days).map((m) => m.date)).toEqual(['2026-08-18', '2026-08-20'])
  })

  it('counts every missed dose on the day, not just the day', () => {
    expect(missedDays(days).find((m) => m.date === '2026-08-20').count).toBe(2)
  })

  it('today is never in the list', () => {
    expect(missedDays(days).some((m) => m.date === '2026-08-21')).toBe(false)
  })
})

describe('catchUpRun', () => {
  it('finds the unbroken run of missed days', () => {
    const days = [
      day('2026-08-18', [entry('a')]),
      day('2026-08-19', [entry('a')]),
      day('2026-08-20', [entry('a')]),
    ]
    const run = catchUpRun(days, '2026-08-21')
    expect(run.from).toBe('2026-08-18')
    expect(run.to).toBe('2026-08-20')
    expect(run.days).toBe(3)
    expect(run.doses).toBe(3)
  })

  it('a logged day breaks the run', () => {
    const days = [
      day('2026-08-18', [entry('a')]),
      day('2026-08-19', [entry('a', { taken: true })]),
      day('2026-08-20', [entry('a')]),
    ]
    expect(catchUpRun(days, '2026-08-21').from).toBe('2026-08-20')
  })

  it('a day with nothing scheduled does not break the run — nothing was owed', () => {
    const days = [
      day('2026-08-18', [entry('a')]),
      day('2026-08-19', []),
      day('2026-08-20', [entry('a')]),
    ]
    expect(catchUpRun(days, '2026-08-21').days).toBe(2)
    expect(catchUpRun(days, '2026-08-21').from).toBe('2026-08-18')
  })

  it('is null when nothing was missed', () => {
    expect(catchUpRun([day('2026-08-18', [entry('a', { taken: true })])], '2026-08-19')).toBe(null)
  })
})

// --------------------------------------------------------------- inventory

describe('which vial was open on a past date', () => {
  const openVials = { a: { remainingMg: 5, batchId: 'v2', vialMg: 10, reconstitutedAt: '2026-08-15' } }
  const finishedVials = [
    { peptideId: 'a', batchId: 'v1', vialMg: 10, activatedAt: '2026-08-01T09:00:00.000Z', date: '2026-08-14' },
  ]

  it('a date inside the open vial draws from it', () => {
    const v = vialOnDate('a', '2026-08-18', { openVials, finishedVials })
    expect(v.where).toBe('current')
    expect(v.batchId).toBe('v2')
    expect(v.movesStock).toBe(true)
  })

  it('a date on a vial since finished leaves the open one alone', () => {
    const v = vialOnDate('a', '2026-08-10', { openVials, finishedVials })
    expect(v.where).toBe('finished')
    expect(v.batchId).toBe('v1')
    // the drug came out of a vial that is already gone; taking it out of
    // today's would make this one read emptier than it is
    expect(v.movesStock).toBe(false)
  })

  it('a date before any vial was opened draws from nothing', () => {
    const v = vialOnDate('a', '2026-07-20', { openVials, finishedVials })
    expect(v.movesStock).toBe(false)
  })

  it('an unlinked item never moves stock, because there is no vial behind it', () => {
    const v = vialOnDate('u', '2026-08-18', { openVials: { u: { remainingMg: 0, unlinked: true } }, finishedVials: [] })
    expect(v.movesStock).toBe(false)
  })

  it('a compound with no inventory at all is safe to ask about', () => {
    expect(vialOnDate('nope', '2026-08-18', {}).where).toBe('none')
  })

  it('every outcome has a plain sentence to show for it', () => {
    for (const where of ['current', 'finished', 'before', 'none']) {
      expect(stockNote({ where }).length).toBeGreaterThan(20)
    }
  })
})

describe('the dose to pre-fill for a past day', () => {
  const p = { id: 'a', ladder: { unit: 'mcg' } }

  it('uses what was actually recorded nearest that day', () => {
    const logs = [
      { peptideId: 'a', date: '2026-08-10', doseValue: 200, unit: 'mcg' },
      { peptideId: 'a', date: '2026-08-17', doseValue: 300, unit: 'mcg' },
      { peptideId: 'a', date: '2026-08-25', doseValue: 400, unit: 'mcg' },
    ]
    const d = doseOnDate(p, '2026-08-20', logs, 999)
    expect(d.dose).toBe(300)
    expect(d.source).toBe('logged')
    expect(d.from).toBe('2026-08-17')
  })

  it('falls back to the ladder rung when nothing was ever logged', () => {
    const d = doseOnDate(p, '2026-08-20', [], 250)
    expect(d.dose).toBe(250)
    expect(d.source).toBe('ladder')
  })

  it('ignores another compound\'s logs', () => {
    const logs = [{ peptideId: 'b', date: '2026-08-19', doseValue: 111, unit: 'mcg' }]
    expect(doseOnDate(p, '2026-08-20', logs, 250).dose).toBe(250)
  })
})

// --------------------------------------------------------------- keyboard

describe('a sheet is sized against what the keyboard has left', () => {
  it('keeps a sheet a sheet when the keyboard is down', () => {
    const h = sheetMaxHeight({ height: 844, keyboardOpen: false })
    expect(h).toBeLessThan(844)
    expect(h).toBeGreaterThan(700)
  })

  it('takes the whole visible viewport bar the accessory strip when it is up', () => {
    // 390x844 with a typical iOS keyboard: 844 - 336 = 508 visible
    expect(sheetMaxHeight({ height: 508, keyboardOpen: true })).toBe(508 - ACCESSORY_BAR)
  })

  it('never sizes a sheet against the window the keyboard is covering', () => {
    expect(sheetMaxHeight({ height: 508, keyboardOpen: true })).toBeLessThan(844)
  })

  it('leaves room for at least four rows plus a search field on a small phone', () => {
    // header ~52 + pinned search ~52; a result row is ~60
    const body = sheetMaxHeight({ height: 508, keyboardOpen: true }) - 104
    expect(Math.floor(body / 60)).toBeGreaterThanOrEqual(4)
  })
})
