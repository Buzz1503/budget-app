// v40 — pausing the protocol, and a month you can correct.
//
// The pause tests are mostly about what a pause must NOT be confused with. It
// is not a skip, so it is not a decision about one dose. It is not a push, so
// nothing moves. It is not a stop, so the run stays open. And it is not a gap,
// so the days inside it are neither taken nor missed — which is the whole point,
// and the thing every arithmetic below has to agree on.
import { describe, it, expect } from 'vitest'
import {
  PAUSE_REASONS, reasonWords, pauseEnd, isOver, coversPeptide, coversDate,
  isPausedOn, pauseOn, pausesOn, anyPausedOn, activePause, pausedDays, pauseLength,
  pausedDaysBetween, advanceOverPauses, pausesFor, pauseHistory, pauseBands,
  scopeWords, pauseDates,
} from './pauses'
import { adherenceFor, adherenceSummary, scheduledCount, takenCount, pausedCount } from './adherence'
import { entryState, DOSE_STATES } from './backfill'
import { runOutInfo } from './inventory'
import { monthSummary, adherenceTally, monthGridRange, addMonths } from './calendarView'
import { dotsFor, completion } from '../components/MonthGrid'
import { addDaysStr } from './schedule'

const T = '2026-09-29'
const day = (o) => addDaysStr(T, o)

const pause = (over = {}) => ({
  id: `pa-${Math.random()}`, startedOn: day(-10), endedOn: null, endsOn: null,
  reason: 'holiday', reasonText: '', note: '', peptideIds: null, at: `${day(-10)}T09:00:00Z`,
  ...over,
})

const pep = (over = {}) => ({
  id: 'reta', name: 'Retatrutide', startDate: day(-90), startedOn: day(-90),
  frequency: 'weekly', scheduleWeekdays: [1], route: 'SubQ', slot: 'AM',
  ladder: { unit: 'mg', floor: 0.5, step: 0, ceiling: 0.5, intervalWeeks: 4 },
  cycleOnDays: 0, cycleOffDays: 0,
  recon: { vialMg: 10, bacMl: 2, expiryDays: 90 },
  ...over,
})

// --------------------------------------------------------------- the span

describe('what a pause covers', () => {
  it('offers the reasons the brief names, and no others', () => {
    expect(PAUSE_REASONS.map((r) => r.label)).toEqual([
      'Holiday', 'Sick', 'Injury', 'Out of stock', 'Cycling off', 'Taking a break', 'Other',
    ])
  })

  it('says a reason in words, and uses the free text for Other', () => {
    expect(reasonWords(pause({ reason: 'sick' }))).toBe('Sick')
    expect(reasonWords(pause({ reason: 'other', reasonText: 'wedding season' }))).toBe('wedding season')
    // an empty "other" still has to say something
    expect(reasonWords(pause({ reason: 'other', reasonText: '  ' }))).toBe('Other')
  })

  it('runs from its start with no end until one is set', () => {
    const p = pause()
    expect(pauseEnd(p)).toBe(null)
    expect(coversDate(p, day(-10))).toBe(true)
    expect(coversDate(p, day(0))).toBe(true)
    expect(coversDate(p, day(400))).toBe(true)
    expect(coversDate(p, day(-11))).toBe(false)
  })

  it('ends on a planned end date without anyone pressing anything', () => {
    const p = pause({ endsOn: day(-3) })
    expect(pauseEnd(p)).toBe(day(-3))
    expect(coversDate(p, day(-3))).toBe(true)
    expect(coversDate(p, day(-2))).toBe(false)
    expect(isOver(p, T)).toBe(true)
  })

  it('takes whichever end came first when both exist', () => {
    // resumed early: the plan said the 26th, the button was pressed on the 22nd
    expect(pauseEnd(pause({ endsOn: day(-3), endedOn: day(-7) }))).toBe(day(-7))
    // let run past the plan: the plan still ends it
    expect(pauseEnd(pause({ endsOn: day(-7), endedOn: day(-3) }))).toBe(day(-7))
  })

  it('covers everything, or only what it names', () => {
    expect(coversPeptide(pause(), 'anything')).toBe(true)
    const some = pause({ peptideIds: ['reta', 'teste'] })
    expect(coversPeptide(some, 'reta')).toBe(true)
    expect(coversPeptide(some, 'selank')).toBe(false)
  })

  it('answers "is this one paused on this day"', () => {
    const ps = [pause({ peptideIds: ['reta'], startedOn: day(-5), endsOn: day(-2) })]
    expect(isPausedOn(ps, 'reta', day(-3))).toBe(true)
    expect(isPausedOn(ps, 'reta', day(-1))).toBe(false)
    expect(isPausedOn(ps, 'selank', day(-3))).toBe(false)
    expect(pauseOn(ps, 'reta', day(-3)).reason).toBe('holiday')
  })

  it('prefers the whole-protocol pause when two are running', () => {
    const ps = [pause({ peptideIds: ['reta'], reason: 'out-of-stock' }), pause({ reason: 'holiday' })]
    expect(activePause(ps, T).reason).toBe('holiday')
    expect(pausesOn(ps, T)).toHaveLength(2)
    expect(anyPausedOn(ps, T)).toBe(true)
  })

  it('has no active pause when everything has ended', () => {
    expect(activePause([pause({ endsOn: day(-1) })], T)).toBe(null)
    expect(anyPausedOn([pause({ endsOn: day(-1) })], T)).toBe(false)
  })
})

describe('how long', () => {
  it('counts a running pause up to today, inclusive of both ends', () => {
    expect(pausedDays(pause({ startedOn: T }), T)).toBe(1)
    expect(pausedDays(pause({ startedOn: day(-6) }), T)).toBe(7)
  })

  it('reports a finished pause at its own length, not up to today', () => {
    const p = pause({ startedOn: day(-20), endedOn: day(-14) })
    expect(pauseLength(p)).toBe(7)
    expect(pausedDays(p, T)).toBe(7)
  })

  it('has no length while it is still running', () => {
    expect(pauseLength(pause())).toBe(null)
  })

  it('counts a day once even when two pauses cover it', () => {
    // a whole-protocol holiday sitting inside a longer out-of-stock on one
    // compound: double-counting would silently subtract the day twice
    const ps = [
      pause({ startedOn: day(-10), endsOn: day(-1) }),
      pause({ startedOn: day(-6), endsOn: day(-4), peptideIds: ['reta'] }),
    ]
    expect(pausedDaysBetween(ps, 'reta', day(-10), day(-1))).toBe(10)
  })

  it('counts only the days inside the window', () => {
    const ps = [pause({ startedOn: day(-10), endsOn: day(-5) })]
    expect(pausedDaysBetween(ps, 'reta', day(-7), T)).toBe(3)
    expect(pausedDaysBetween(ps, 'reta', day(-2), T)).toBe(0)
    expect(pausedDaysBetween([], 'reta', day(-7), T)).toBe(0)
  })
})

// --------------------------------------------------------------- adherence

describe('a paused day is not a missed day', () => {
  const p = pep()
  // Mondays, so the window holds a predictable number of doses
  const from = day(-56)
  const to = day(-1)

  it('counts scheduled doses when nothing is paused', () => {
    const n = scheduledCount(p, from, to, [], [])
    expect(n).toBeGreaterThan(0)
  })

  it('takes paused days out of what was scheduled', () => {
    const before = scheduledCount(p, from, to, [], [])
    const ps = [pause({ startedOn: from, endsOn: to })]
    expect(scheduledCount(p, from, to, [], ps)).toBe(0)
    expect(before).toBeGreaterThan(0)
  })

  it('reports them as paused rather than losing them', () => {
    const ps = [pause({ startedOn: from, endsOn: to })]
    const scheduled = scheduledCount(p, from, to, [], [])
    expect(pausedCount(p, from, to, [], ps)).toBe(scheduled)
  })

  it('leaves adherence unharmed by a break', () => {
    const logs = []
    const ps = [pause({ startedOn: from, endsOn: to })]
    const a = adherenceFor(p, logs, from, to, [], ps)
    expect(a.scheduled).toBe(0)
    expect(a.missed).toBe(0)
    expect(a.pct).toBe(null)   // nothing to be adherent to, not 0%
    const without = adherenceFor(p, logs, from, to, [], [])
    expect(without.missed).toBeGreaterThan(0)
    expect(without.pct).toBe(0)
  })

  it('does not let a dose taken on holiday push adherence over 100%', () => {
    const ps = [pause({ startedOn: from, endsOn: to })]
    // one dose taken anyway, on a Monday inside the pause
    const monday = (() => {
      let d = from
      for (let i = 0; i < 14; i++) {
        if (new Date(`${d}T00:00:00`).getDay() === 1) return d
        d = addDaysStr(d, 1)
      }
      return from
    })()
    const logs = [{ id: 'l1', peptideId: p.id, date: monday, doseValue: 0.5, unit: 'mg' }]
    const a = adherenceFor(p, logs, from, to, [], ps)
    expect(a.taken).toBe(0)        // not counted against a denominator it is not in
    expect(a.pausedTaken).toBe(1)  // but not lost either
    expect(a.pct).toBe(null)
  })

  it('keeps a compound in the summary when all its days were paused', () => {
    const ps = [pause({ startedOn: from, endsOn: to })]
    const sum = adherenceSummary([p], [], from, to, [], ps)
    expect(sum.rows.map((r) => r.peptideId)).toContain('reta')
    expect(sum.overall.paused).toBeGreaterThan(0)
    expect(sum.overall.missed).toBe(0)
  })

  it('only excuses the compounds a partial pause names', () => {
    const other = pep({ id: 'selank', name: 'Selank' })
    const ps = [pause({ startedOn: from, endsOn: to, peptideIds: ['reta'] })]
    expect(scheduledCount(p, from, to, [], ps)).toBe(0)
    expect(scheduledCount(other, from, to, [], ps)).toBeGreaterThan(0)
  })
})

describe('entryState', () => {
  const d = { isPast: true, isToday: false, isFuture: false }

  it('reads a paused dose as paused, not missed', () => {
    expect(entryState({ paused: true }, d)).toBe('paused')
    expect(entryState({}, d)).toBe('missed')
  })

  it('still reads a dose taken during a pause as logged', () => {
    // you took it; the break does not unmake that
    expect(entryState({ paused: true, taken: true }, d)).toBe('logged')
  })

  it('puts a deliberate skip ahead of the pause', () => {
    expect(entryState({ paused: true, skipped: true }, d)).toBe('skipped')
  })

  it('has words for the new state', () => {
    expect(DOSE_STATES.paused.label).toBe('Paused')
    expect(DOSE_STATES.paused.words).toMatch(/break/)
  })
})

// ------------------------------------------------------------------ stock

describe('a pause does not draw anything', () => {
  const p = pep({ frequency: 'daily' })
  const vials = [{ peptideId: 'reta', vialMg: 10, qtyOnHand: 1 }]
  const open = { remainingMg: 0 }

  it('runs out on the same day when nothing is paused', () => {
    const r = runOutInfo(p, { level: 0 }, vials, open, T, [])
    expect(r.runOutDate).toBe(addDaysStr(T, r.consumingDays))
    expect(r.pausedDays).toBe(0)
  })

  it('pushes the run-out date out by exactly the days paused', () => {
    const ps = [pause({ startedOn: T, endsOn: addDaysStr(T, 6) })]
    const base = runOutInfo(p, { level: 0 }, vials, open, T, [])
    const with7 = runOutInfo(p, { level: 0 }, vials, open, T, ps)
    // the same number of doses, seven days later in the calendar
    expect(with7.consumingDays).toBe(base.consumingDays)
    expect(with7.pausedDays).toBe(7)
    expect(with7.daysLeft).toBe(base.daysLeft + 7)
    expect(with7.runOutDate).toBe(addDaysStr(base.runOutDate, 7))
  })

  it('leaves the milligrams on hand alone either way', () => {
    const ps = [pause({ startedOn: T })]
    expect(runOutInfo(p, { level: 0 }, vials, open, T, ps).mg)
      .toBe(runOutInfo(p, { level: 0 }, vials, open, T, []).mg)
  })

  it('has no run-out date at all while paused with no end', () => {
    const ps = [pause({ startedOn: T })]
    const r = runOutInfo(p, { level: 0 }, vials, open, T, ps)
    expect(r.runOutDate).toBe(null)
    expect(r.daysLeft).toBe(Infinity)
    expect(r.pausedIndefinitely).toBe(true)
  })

  it('walks over a pause without counting it as supply', () => {
    const ps = [pause({ startedOn: addDaysStr(T, 2), endsOn: addDaysStr(T, 4) })]
    const w = advanceOverPauses(T, 5, 'reta', ps)
    expect(w.pausedDays).toBe(3)
    expect(w.open).toBe(false)
    // five dosing days plus three stepped over: the supply runs out on day 8
    expect(w.date).toBe(addDaysStr(T, 8))
  })

  it('says so rather than looping forever on an open-ended pause', () => {
    const w = advanceOverPauses(T, 30, 'reta', [pause({ startedOn: T })])
    expect(w.open).toBe(true)
    expect(w.date).toBe(null)
  })
})

// ------------------------------------------------------------ the history

describe('the record of a break', () => {
  const ps = [
    pause({ id: 'a', startedOn: day(-60), endedOn: day(-50), reason: 'holiday' }),
    pause({ id: 'b', startedOn: day(-20), endedOn: day(-15), reason: 'sick', peptideIds: ['reta'] }),
    pause({ id: 'c', startedOn: day(-3), reason: 'injury', peptideIds: ['selank'] }),
  ]

  it('lists every pause, newest first', () => {
    expect(pauseHistory(ps).map((p) => p.id)).toEqual(['c', 'b', 'a'])
  })

  it('narrows to one compound, keeping the whole-protocol ones', () => {
    expect(pausesFor(ps, 'reta').map((p) => p.id)).toEqual(['b', 'a'])
    expect(pausesFor(ps, 'selank').map((p) => p.id)).toEqual(['c', 'a'])
  })

  it('says what each one covered', () => {
    const peptides = [{ id: 'reta', name: 'Retatrutide' }, { id: 'selank', name: 'Selank' }]
    expect(scopeWords(ps[0], peptides)).toBe('everything')
    expect(scopeWords(ps[1], peptides)).toBe('Retatrutide')
    expect(scopeWords(pause({ peptideIds: ['reta', 'selank'] }), peptides)).toBe('2 compounds')
  })

  it('writes its dates the way a line has room for', () => {
    expect(pauseDates(ps[0])).toMatch(/^\d{1,2} \w{3} – \d{1,2} \w{3}$/)
    expect(pauseDates(ps[2])).toMatch(/^since \d{1,2} \w{3}$/)
  })

  it('gives the timeline a band per pause, clipped to the window', () => {
    const bands = pauseBands(ps, 'reta', day(-55), T)
    expect(bands).toHaveLength(2)
    const [recent, old] = bands
    expect(recent.from).toBe(day(-20))
    expect(recent.to).toBe(day(-15))
    expect(recent.reason).toBe('Sick')
    // the older one started before the window and is cut to it, not dropped
    expect(old.from).toBe(day(-55))
    expect(old.to).toBe(day(-50))
  })

  it('runs an open band to the end of the window', () => {
    const bands = pauseBands(ps, 'selank', day(-10), T)
    expect(bands[0].open).toBe(true)
    expect(bands[0].to).toBe(T)
  })
})

// -------------------------------------------------------------- the month

const calDay = (o = {}) => ({
  date: T, isPast: true, isToday: false, isFuture: false,
  scheduled: 0, owed: 0, done: 0, skipped: 0, paused: 0, missed: 0,
  pushedOff: 0, wholeDayPaused: false, symptom: null, bloodTests: [],
  adherence: 'none', events: [], ...o,
})

describe('the month grid', () => {
  it('draws whole weeks, Monday first', () => {
    const r = monthGridRange('2026-09-15')
    expect(new Date(`${r.from}T00:00:00`).getDay()).toBe(1)
    expect(new Date(`${r.to}T00:00:00`).getDay()).toBe(0)
    expect(r.from <= '2026-09-01').toBe(true)
    expect(r.to >= '2026-09-30').toBe(true)
  })

  it('steps between months without drifting off the end of one', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01')
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-01')
    expect(addMonths('2026-12-05', 1)).toBe('2027-01-01')
  })

  it('fills the ring by the share of the day that got logged', () => {
    expect(completion(calDay({ scheduled: 4, owed: 4, done: 0 }))).toBe(0)
    expect(completion(calDay({ scheduled: 4, owed: 4, done: 2 }))).toBe(0.5)
    expect(completion(calDay({ scheduled: 4, owed: 4, done: 4 }))).toBe(1)
    expect(completion(calDay())).toBe(0)
  })

  it('never fills past full, whatever was logged', () => {
    expect(completion(calDay({ scheduled: 2, owed: 2, done: 5 }))).toBe(1)
  })

  it('divides by what the day owed, not by what the schedule said', () => {
    // three of four paused: logging the one that was owed is a full day
    expect(completion(calDay({ scheduled: 4, owed: 1, done: 1 }))).toBe(1)
  })

  it('gives one dot per category, worst first', () => {
    const { dots } = dotsFor(calDay({ done: 2, missed: 1, skipped: 1 }))
    expect(dots.map((d) => d.kind)).toEqual(['missed', 'logged', 'skipped'])
  })

  it('caps the dots and counts the rest', () => {
    const { dots, extra } = dotsFor(calDay({ done: 1, missed: 1, skipped: 1, pushedOff: 1, paused: 3 }))
    expect(dots).toHaveLength(4)
    expect(extra).toBe(3)
  })

  it('shows nothing for a day where nothing happened', () => {
    expect(dotsFor(calDay()).dots).toEqual([])
    expect(dotsFor(null).dots).toEqual([])
  })
})

describe('the month summary', () => {
  const days = [
    calDay({ date: day(-3), scheduled: 3, owed: 3, done: 3, adherence: 'all' }),
    calDay({ date: day(-2), scheduled: 3, owed: 3, done: 1, missed: 1, skipped: 1, adherence: 'partial' }),
    calDay({ date: day(-1), scheduled: 3, owed: 0, paused: 3, wholeDayPaused: true, adherence: 'paused' }),
    calDay({ date: T, isPast: false, isToday: true, scheduled: 3, owed: 3, done: 0, adherence: 'pending' }),
    calDay({ date: day(1), isPast: false, isFuture: true, scheduled: 3, owed: 3, adherence: 'future' }),
  ]

  it('counts only the days that have happened', () => {
    const s = monthSummary(days, T)
    // three past days plus today; tomorrow is not a record yet
    expect(s.days).toBe(4)
  })

  it('divides by what was owed, so a paused day is not in the denominator', () => {
    const s = monthSummary(days, T)
    expect(s.scheduled).toBe(9)   // 3 + 3 + 0 + 3
    expect(s.logged).toBe(4)
    expect(s.pct).toBe(44)
  })

  it('counts full days, skips, pushes and paused days separately', () => {
    const s = monthSummary(days, T)
    expect(s.complete).toBe(1)
    expect(s.skipped).toBe(1)
    expect(s.missed).toBe(1)
    expect(s.pausedDays).toBe(1)
  })

  it('counts the days that carry a symptom entry or a blood test', () => {
    const s = monthSummary([
      calDay({ date: day(-2), symptom: { id: 's1' } }),
      calDay({ date: day(-1), bloodTests: [{ id: 'b1' }] }),
      calDay({ date: T }),
    ], T)
    expect(s.symptomDays).toBe(1)
    expect(s.bloodDays).toBe(1)
  })

  it('has nothing to divide by in a month with nothing owed', () => {
    expect(monthSummary([calDay()], T).pct).toBe(null)
  })

  it('tallies a paused day without throwing', () => {
    const tally = adherenceTally(days)
    expect(tally.paused).toBe(1)
    expect(tally.all).toBe(1)
  })
})
