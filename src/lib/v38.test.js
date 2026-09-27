// v38 — doses moved to the next day.
//
// A push is the third thing that can happen to a scheduled dose. Most of these
// tests are about the two things it must NOT be confused with: it is not a log,
// so nothing comes out of a vial, and it is not a skip, so adherence must not
// read it as a day somebody went without. The rest are about the schedule
// surviving — one occurrence moves, the protocol does not.
import { describe, it, expect } from 'vitest'
import {
  canPush, canPushOn, pushedAway, pushedOnto, originDate, pushedLabel,
  dueWithPushes, arrivalsOn, pushesFor, pushesInRange,
} from './pushes'
import { adherenceFor, adherenceSummary } from './adherence'
import { doseTimeline } from './tenure'
import { addDaysStr } from './schedule'
import { isDueToday, weekdayOf } from './daily'

const T = '2026-09-27' // a Sunday
const day = (o) => addDaysStr(T, o)

const pep = (over = {}) => ({
  id: 'teste', name: 'Testosterone Enanthate', startDate: day(-180), startedOn: day(-180),
  frequency: '2xweek', scheduleWeekdays: [1, 4], route: 'SubQ', slot: 'AM', timing: 'Mon & Thu',
  ladder: { unit: 'mg', floor: 50, step: 0, ceiling: 50, intervalWeeks: 4 },
  cycleOnDays: 0, cycleOffDays: 0,
  recon: { vialMg: 2500, bacMl: 10, expiryDays: 90 },
  ...over,
})

const push = (over = {}) => ({
  id: `pu-${Math.random()}`, peptideId: 'teste', from: day(-1), to: T,
  at: `${day(-1)}T09:00:00.000Z`, name: 'Testosterone Enanthate', ...over,
})

// the next Monday on or after T, so tests can talk about a real scheduled day
const MON = (() => {
  let d = T
  while (weekdayOf(d) !== 1) d = addDaysStr(d, 1)
  return d
})()

// ================================================== 1 · who can be pushed

describe('canPush', () => {
  it('allows a compound taken several days a week', () => {
    expect(canPush(pep())).toBe(true)
    expect(canPush(pep({ frequency: '3xweek', scheduleWeekdays: [1, 3, 5] }))).toBe(true)
    expect(canPush(pep({ frequency: '5on2off', scheduleWeekdays: [1, 2, 3, 4, 5] }))).toBe(true)
  })

  it('refuses a daily compound — tomorrow already has a dose of its own', () => {
    expect(canPush(pep({ frequency: 'daily', scheduleWeekdays: undefined }))).toBe(false)
    expect(canPush(pep({ frequency: 'nightly', scheduleWeekdays: undefined }))).toBe(false)
  })

  it('refuses a once-weekly compound — moving its day is the right fix there', () => {
    expect(canPush(pep({ frequency: 'weekly', scheduleWeekdays: [1] }))).toBe(false)
  })

  it('has nothing to say about nothing', () => {
    expect(canPush(null)).toBe(false)
  })
})

describe('canPushOn', () => {
  const base = { pushes: [], loggedIds: new Set(), skippedIds: new Set(), dateStr: MON }

  it('allows it on a day the dose is owed', () => {
    expect(canPushOn(pep(), base)).toBe(true)
  })

  it('refuses once the dose is logged', () => {
    expect(canPushOn(pep(), { ...base, loggedIds: new Set(['teste']) })).toBe(false)
  })

  it('refuses once the dose is skipped', () => {
    expect(canPushOn(pep(), { ...base, skippedIds: new Set(['teste']) })).toBe(false)
  })

  it('refuses on a day the dose is not owed at all', () => {
    const notDue = addDaysStr(MON, 1) // Tuesday
    expect(canPushOn(pep(), { ...base, dateStr: notDue })).toBe(false)
  })

  it('allows it again on the day a pushed dose landed', () => {
    const landed = addDaysStr(MON, 1)
    const pushes = [push({ from: MON, to: landed })]
    expect(canPushOn(pep(), { ...base, pushes, dateStr: landed })).toBe(true)
  })
})

// ============================================ 2 · where the occurrence sits

describe('dueWithPushes', () => {
  it('drops the dose off the day it was pushed from', () => {
    const p = pep()
    expect(isDueToday(p, MON)).toBe(true)
    expect(dueWithPushes(p, [push({ from: MON, to: addDaysStr(MON, 1) })], MON)).toBe(false)
  })

  it('puts it on the day it was pushed to, which is not a scheduled day', () => {
    const p = pep()
    const tue = addDaysStr(MON, 1)
    expect(isDueToday(p, tue)).toBe(false)
    expect(dueWithPushes(p, [push({ from: MON, to: tue })], tue)).toBe(true)
  })

  it('leaves every following dose exactly where the schedule put it', () => {
    const p = pep()
    const pushes = [push({ from: MON, to: addDaysStr(MON, 1) })]
    // Thursday is the next scheduled day and must not have moved
    const thu = addDaysStr(MON, 3)
    expect(weekdayOf(thu)).toBe(4)
    expect(dueWithPushes(p, pushes, thu)).toBe(true)
    // and next Monday is still Monday
    expect(dueWithPushes(p, pushes, addDaysStr(MON, 7))).toBe(true)
  })

  it('behaves exactly as the schedule does when nothing has been pushed', () => {
    const p = pep()
    for (let i = 0; i < 14; i++) {
      const d = addDaysStr(T, i)
      expect(dueWithPushes(p, [], d)).toBe(isDueToday(p, d))
    }
  })
})

describe('repeated pushes', () => {
  const chain = [
    push({ id: 'p1', from: day(0), to: day(1) }),
    push({ id: 'p2', from: day(1), to: day(2) }),
    push({ id: 'p3', from: day(2), to: day(3) }),
  ]

  it('can be pushed day after day with no limit', () => {
    expect(dueWithPushes(pep(), chain, day(1))).toBe(false)
    expect(dueWithPushes(pep(), chain, day(2))).toBe(false)
    expect(dueWithPushes(pep(), chain, day(3))).toBe(true)
  })

  it('names the day it was originally due, not the last hop', () => {
    expect(originDate(chain, 'teste', day(3))).toBe(day(0))
  })

  it('says how far it has travelled once it is more than a day', () => {
    expect(pushedLabel(chain, 'teste', day(1))).toMatch(/^pushed from \w{3}$/)
    expect(pushedLabel(chain, 'teste', day(3))).toMatch(/· 3 days$/)
  })

  it('has no marker for a dose that arrived on its own day', () => {
    expect(pushedLabel(chain, 'teste', day(0))).toBe(null)
    expect(pushedLabel([], 'teste', T)).toBe(null)
  })
})

describe('pushedAway / pushedOnto / arrivalsOn', () => {
  const pushes = [push({ from: day(-1), to: T })]

  it('finds the record in both directions', () => {
    expect(pushedAway(pushes, 'teste', day(-1))?.to).toBe(T)
    expect(pushedOnto(pushes, 'teste', T)?.from).toBe(day(-1))
    expect(pushedAway(pushes, 'teste', T)).toBe(null)
  })

  it('ignores another compound entirely', () => {
    expect(pushedOnto(pushes, 'bpc157', T)).toBe(null)
    expect(dueWithPushes(pep({ id: 'bpc157' }), pushes, T)).toBe(isDueToday(pep({ id: 'bpc157' }), T))
  })

  it('lists what landed today', () => {
    expect(arrivalsOn([pep()], pushes, T).map((p) => p.id)).toEqual(['teste'])
    expect(arrivalsOn([pep()], pushes, day(1))).toHaveLength(0)
  })
})

// ================================================ 3 · not a miss, not a skip

describe('adherence with pushes', () => {
  const from = day(-13)
  const logs = []

  it('does not count a pushed day as a dose that was owed', () => {
    const p = pep()
    const plain = adherenceFor(p, logs, from, T)
    const moved = adherenceFor(p, logs, from, T, [push({ from: MON, to: addDaysStr(MON, 1) })])
    // the day it left stops counting, the day it landed starts
    expect(moved.scheduled).toBe(plain.scheduled)
    expect(moved.missed).toBe(plain.missed)
  })

  it('credits a dose logged on the day it was pushed to', () => {
    const p = pep({ startDate: day(-30), startedOn: day(-30) })
    const mon = addDaysStr(MON, -7)
    const tue = addDaysStr(mon, 1)
    const pushes = [push({ from: mon, to: tue })]
    const taken = [{ id: 'l1', peptideId: 'teste', date: tue, doseValue: 50, unit: 'mg' }]
    const a = adherenceFor(p, taken, from, T, pushes)
    expect(a.taken).toBe(1)
    // without the push the same log falls on an unscheduled day and counts for nothing
    expect(adherenceFor(p, taken, from, T).taken).toBe(0)
  })

  it('leaves a compound with no pushes completely unchanged', () => {
    const peptides = [pep(), pep({ id: 'bpc157', frequency: 'daily', scheduleWeekdays: undefined })]
    const before = adherenceSummary(peptides, logs, from, T)
    const after = adherenceSummary(peptides, logs, from, T, [])
    expect(after.overall).toEqual(before.overall)
  })
})

// ================================================= 4 · it shows in history

describe('pushes in the record', () => {
  it('lists a compound\'s own pushes oldest first', () => {
    const all = [push({ from: day(-5) }), push({ from: day(-9) }), push({ peptideId: 'other', from: day(-1) })]
    expect(pushesFor(all, 'teste').map((p) => p.from)).toEqual([day(-9), day(-5)])
  })

  it('windows them newest first for the log', () => {
    const all = [push({ from: day(-2) }), push({ from: day(-40) }), push({ from: day(-1) })]
    const rows = pushesInRange(all, day(-30), T)
    expect(rows.map((p) => p.from)).toEqual([day(-1), day(-2)])
  })

  it('lands on the dose timeline as its own kind, on the day it left', () => {
    const { points } = doseTimeline(pep(), {
      pushes: [push({ from: day(-3), to: day(-2) })],
      doseEvents: [{ id: 'e1', peptideId: 'teste', date: day(-180), kind: 'start', to: 50, unit: 'mg' }],
      todayStr: T,
    })
    const pt = points.find((x) => x.kind === 'push')
    expect(pt).toBeTruthy()
    expect(pt.date).toBe(day(-3))
    expect(pt.label).toBe('Pushed to the next day')
    expect(pt.detail).toContain('not taken, not skipped')
  })

  it('is not mistaken for a skip on the timeline', () => {
    const { points } = doseTimeline(pep(), {
      pushes: [push({ from: day(-3), to: day(-2) })],
      skips: [{ id: 'sk', peptideId: 'teste', date: day(-6), reason: 'travel' }],
      todayStr: T,
    })
    expect(points.filter((x) => x.kind === 'push')).toHaveLength(1)
    expect(points.filter((x) => x.kind === 'skip')).toHaveLength(1)
  })

  it('never contributes a dose level, so it cannot bend the chart', () => {
    const { segments } = doseTimeline(pep(), {
      pushes: [push({ from: day(-3), to: day(-2) })],
      doseEvents: [{ id: 'e1', peptideId: 'teste', date: day(-180), kind: 'start', to: 50, unit: 'mg' }],
      todayStr: T,
    })
    expect(segments).toHaveLength(1)
    expect(segments[0].dose).toBe(50)
  })
})

// ======================================== 5 · pushing onto an occupied day

describe('pushing onto a day that already has a dose', () => {
  // 5-on-2-off: Friday pushed to Saturday is fine, but a Mon/Tue/Wed/Thu/Fri
  // compound pushed from Monday lands on Tuesday, which already has one.
  const p = pep({ frequency: '5on2off', scheduleWeekdays: [1, 2, 3, 4, 5] })
  const mon = (() => { let d = T; while (weekdayOf(d) !== 1) d = addDaysStr(d, 1); return d })()
  const tue = addDaysStr(mon, 1)

  it('does not double the dose — Tuesday still owes one', () => {
    const pushes = [push({ from: mon, to: tue })]
    expect(dueWithPushes(p, pushes, mon)).toBe(false)
    expect(dueWithPushes(p, pushes, tue)).toBe(true)
  })

  it('counts Tuesday once in adherence, not twice', () => {
    const pushes = [push({ from: mon, to: tue })]
    const a = adherenceFor(p, [], addDaysStr(mon, -1), addDaysStr(tue, 1), pushes)
    const plain = adherenceFor(p, [], addDaysStr(mon, -1), addDaysStr(tue, 1))
    // Monday's occurrence merged into Tuesday's, so one fewer day is owed
    expect(a.scheduled).toBe(plain.scheduled - 1)
  })

  it('still lets Tuesday be pushed on to Wednesday', () => {
    const pushes = [push({ from: mon, to: tue })]
    expect(canPushOn(p, {
      pushes, loggedIds: new Set(), skippedIds: new Set(), dateStr: tue,
    })).toBe(true)
  })
})
