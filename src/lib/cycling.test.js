// Compound cycling: one rule for "is it due", and a rest between cycles that is
// honoured on every surface. Dates are fixed so the cycle arithmetic can be read
// off the page:
//
//   epi starts 20 Jan 2026, 10 days on and 15 off (a 25-day cycle)
//     on   20 Jan to 29 Jan     off  30 Jan to 13 Feb
//     on   14 Feb to 23 Feb     off  24 Feb to 10 Mar    (crossing 28 Feb into March)
//     on   11 Mar to 20 Mar     off  21 Mar to 4 Apr
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { isDue, canPushOn, pushDestination, cycleStatus, offCycleOn, offCycleLine, restartsOn, restartWords, cycleEvents, isResting } from './due'
import { cycleInfo, levelStateOn, rungOn, projectSchedule, stepUpDue, nextStepUpDate, onDaysBetween, offCycleDaysBetween, restartMode, addDaysStr } from './schedule'
import { adherenceFor, scheduledCount } from './adherence'
import { runwayFor, coverageFor } from './stock'
import { runOutInfo } from './inventory'
import { lowStockItems } from './lowStock'
import { tenureFor, doseTenure } from './tenure'
import { buildCalendar } from './calendarView'
import { eventsForPeptide, buildIcs } from './calendar'
import { buildSnapshot } from '../native/snapshot'
import { buildSchedule } from '../native/notifySchedule'
import { trackedEvents, describeChanges } from '../health/engine/phases'
import { latestRun } from '../health/engine/compoundEffects'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}
let useStore
beforeAll(async () => { useStore = (await import('../store/useStore')).default })

const pep = (over = {}) => ({
  id: 'epithalon', name: 'Epithalon', frequency: 'daily', startDate: '2026-01-20', startedOn: '2026-01-20',
  slot: 'AM', route: 'SubQ', cycleOnDays: 10, cycleOffDays: 15,
  ladder: { floor: 1, step: 1, intervalWeeks: 1, ceiling: 3, unit: 'mg' },
  recon: { vialMg: 10, bacMl: 2, expiryDays: 28 },
  ...over,
})
const always = pep({ id: 'bpc157', name: 'BPC-157', cycleOnDays: 0, cycleOffDays: 0, ladder: { floor: 250, step: 0, ceiling: 250, intervalWeeks: 4, unit: 'mcg' } })
const range = (from, n) => Array.from({ length: n }, (_, i) => addDaysStr(from, i))
const dueDates = (p, from, n, ctx) => range(from, n).filter((d) => isDue(p, d, ctx))

// ------------------------------------------------------------ the one rule

describe('isDue across the edges of a cycle', () => {
  it('is due on the last on day and not on the first rest day', () => {
    expect(isDue(pep(), '2026-01-29')).toBe(true)
    expect(isDue(pep(), '2026-01-30')).toBe(false)
  })

  it('is not due on the last rest day and is due on the first day back', () => {
    expect(isDue(pep(), '2026-02-13')).toBe(false)
    expect(isDue(pep(), '2026-02-14')).toBe(true)
  })

  it('holds across a month end, and through February into March', () => {
    expect(dueDates(pep(), '2026-01-28', 5)).toEqual(['2026-01-28', '2026-01-29']) // 30, 31 Jan, 1 Feb rest
    expect(dueDates(pep(), '2026-02-22', 12)).toEqual(['2026-02-22', '2026-02-23']) // 28 Feb and 1 Mar rest
    expect(isDue(pep(), '2026-03-10')).toBe(false)
    expect(isDue(pep(), '2026-03-11')).toBe(true)
  })

  it('is never due before it starts, and always due when it has no cycle', () => {
    expect(isDue(pep(), '2026-01-19')).toBe(false)
    expect(dueDates(always, '2026-02-01', 30)).toHaveLength(30)
  })

  it('still needs the weekday pattern, and a protocol that is set up', () => {
    const mon = pep({ frequency: 'weekly', scheduleWeekdays: [1] }) // Mondays
    expect(dueDates(mon, '2026-01-20', 10)).toEqual(['2026-01-26']) // 26 Jan is the Monday inside the on stretch
    expect(isDue(pep({ ladder: { floor: 0, ceiling: 0, unit: 'mg' } }), '2026-01-21')).toBe(false)
  })

  it('leaves pauses to the caller: Home keeps its own, the rest pass them in', () => {
    const pauses = [{ id: 'p', startedOn: '2026-01-22', endsOn: '2026-01-24', peptideIds: null }]
    expect(isDue(pep(), '2026-01-23')).toBe(true)
    expect(isDue(pep(), '2026-01-23', { pauses })).toBe(false)
  })

  it('a pause across the end of an on stretch and into the rest changes nothing about the rest', () => {
    const pauses = [{ id: 'p', startedOn: '2026-01-28', endsOn: '2026-02-05', peptideIds: null }]
    expect(dueDates(pep(), '2026-01-26', 10, { pauses })).toEqual(['2026-01-26', '2026-01-27'])
    // after the pause ends the rest still runs to 13 Feb
    expect(isDue(pep(), '2026-02-08', { pauses })).toBe(false)
    expect(isDue(pep(), '2026-02-14', { pauses })).toBe(true)
  })

  it('reports resting for the days between, and only those', () => {
    expect(isResting(pep(), '2026-01-29')).toBe(false)
    expect(isResting(pep(), '2026-01-30')).toBe(true)
    expect(isResting(pep(), '2026-02-14')).toBe(false)
    expect(isResting(pep(), '2026-01-01')).toBe(false) // not started
    expect(isResting(always, '2026-01-30')).toBe(false)
  })
})

describe('a push never lands in a rest', () => {
  // Thursdays only, on four days out of fourteen: Mon 2 Mar to Thu 5 Mar on, then off to 15 Mar
  const thu = pep({
    id: 'thu', name: 'Thursday', frequency: 'weekly', scheduleWeekdays: [4], startDate: '2026-03-02', startedOn: '2026-03-02',
    cycleOnDays: 4, cycleOffDays: 10,
  })

  it('goes to tomorrow when tomorrow is on cycle, and to the next on day when it is not', () => {
    expect(pushDestination(always, '2026-03-05')).toBe('2026-03-06')
    expect(pushDestination(thu, '2026-03-05')).toBe('2026-03-16') // 6 to 15 Mar are rest
    expect(pushDestination(thu, '2026-03-03')).toBe('2026-03-04')
  })

  it('a push already written onto a rest day shows up on the next on day instead', () => {
    const legacy = [{ id: 'x', peptideId: 'thu', from: '2026-03-05', to: '2026-03-06', at: '', name: '' }]
    expect(isDue(thu, '2026-03-05', { pushes: legacy })).toBe(false) // moved off
    expect(isDue(thu, '2026-03-06', { pushes: legacy })).toBe(false) // a rest
    expect(isDue(thu, '2026-03-16', { pushes: legacy })).toBe(true) // its first on day
  })

  it('canPushOn refuses a compound with nowhere to go', () => {
    const base = { pushes: [], loggedIds: new Set(), skippedIds: new Set(), dateStr: '2026-03-05' }
    expect(canPushOn(thu, base)).toBe(true)
    expect(canPushOn(always, base)).toBe(false) // daily: nothing to move it to
  })

  it('the store records the landing day, so a push is never written onto a rest', () => {
    useStore.setState({ peptides: [thu], doseLogs: [], skips: [], pushes: [] })
    const id = useStore.getState().pushDose('thu', '2026-03-05')
    expect(id).toBeTruthy()
    expect(useStore.getState().pushes[0]).toMatchObject({ from: '2026-03-05', to: '2026-03-16' })
    expect(isDue(thu, '2026-03-16', { pushes: useStore.getState().pushes })).toBe(true)
  })
})

// ------------------------------------------------------------ the words

describe('what the Protocol view and Home say', () => {
  it('"On, day 9 of 10" and "Off, back 14 Feb"', () => {
    expect(cycleStatus(pep(), '2026-01-28').words).toBe('On, day 9 of 10')
    expect(cycleStatus(pep(), '2026-01-31').words).toBe('Off, back 14 Feb')
    expect(cycleStatus(pep(), '2026-02-13').words).toBe('Off, back 14 Feb')
    expect(cycleStatus(pep(), '2026-02-14').words).toBe('On, day 1 of 10')
    expect(cycleStatus(always, '2026-02-14')).toBe(null) // nothing to say
  })

  it('the Home line names what is resting and when it is back, and is empty otherwise', () => {
    const list = offCycleOn([pep(), always], '2026-02-01')
    expect(offCycleLine(list)).toBe('Off cycle: Epithalon, back 14 Feb')
    expect(offCycleLine(offCycleOn([pep(), always], '2026-02-14'))).toBe('')
    // KPV started 25 Jan: on to 3 Feb, resting to 18 Feb
    const two = offCycleOn([pep(), pep({ id: 'kpv', name: 'KPV', startDate: '2026-01-25', startedOn: '2026-01-25' })], '2026-02-05')
    expect(offCycleLine(two)).toBe('Off cycle: Epithalon, back 14 Feb; KPV, back 19 Feb')
  })

  it('a compound that is not set up is not "resting"', () => {
    expect(offCycleOn([pep({ ladder: { floor: 0, ceiling: 0, unit: 'mg' } })], '2026-02-01')).toEqual([])
  })
})

// ------------------------------------------------------ adherence and calendar

describe('adherence and the calendar leave rests alone', () => {
  const logs = (dates) => dates.map((d) => ({ id: d, peptideId: 'epithalon', date: d }))

  it('only on-cycle days are scheduled, so a rest is never a miss', () => {
    expect(scheduledCount(pep(), '2026-01-20', '2026-02-28')).toBe(20) // 10 + 10
    const none = adherenceFor(pep(), [], '2026-01-20', '2026-02-28')
    expect(none).toMatchObject({ scheduled: 20, taken: 0, missed: 20 })
  })

  it('taking every dose of every on stretch is 100 percent, whatever the rests in between', () => {
    const on = dueDates(pep(), '2026-01-20', 40)
    const r = adherenceFor(pep(), logs(on), '2026-01-20', '2026-02-28')
    expect(r).toMatchObject({ scheduled: 20, taken: 20, missed: 0, pct: 100 })
  })

  it('a push onto a rest day is not a miss either', () => {
    const r = adherenceFor(pep(), [], '2026-01-30', '2026-02-13')
    expect(r.scheduled).toBe(0)
    expect(r.missed).toBe(0)
  })

  it('the calendar marks rests as off cycle and counts nothing as missed on them', () => {
    const cal = buildCalendar({
      peptides: [pep()], titration: {}, todayStr: '2026-02-20', from: '2026-01-28', to: '2026-02-16',
    })
    const day = (d) => cal.byDate[d]
    expect(day('2026-01-28').offCycle).toEqual([])
    expect(day('2026-01-28').missed).toBe(1)
    for (const d of range('2026-01-30', 15)) {
      expect(day(d).offCycle).toEqual([{ peptideId: 'epithalon', name: 'Epithalon' }])
      expect(day(d).scheduled).toBe(0)
      expect(day(d).missed).toBe(0)
    }
    expect(day('2026-02-14').offCycle).toEqual([])
  })
})

// ------------------------------------------------------------------ stock

describe('stock counts only on-cycle days', () => {
  const vial = (qty = 1, mg = 5) => [{ id: 'v', peptideId: 'epithalon', vialMg: mg, qtyOnHand: qty, qtyPurchased: qty }]
  const tState = { level: 0, levelStartDate: '2026-01-20' }
  const asOf = (p, d) => runwayFor(p, tState, null, vial(), [], d, 30)

  it('5 mg at 1 mg a day lasts 5 on days, and the rest in the middle costs none', () => {
    // from 30 Jan (resting): the 5 doses are 14 to 18 Feb, so it runs out on 19 Feb
    const r = asOf(pep(), '2026-01-30')
    expect(r.runOutDate).toBe('2026-02-19')
    expect(r.days).toBe(20)
    expect(r.consumingDays).toBe(5)
    expect(r.offCycleDays).toBe(15)
    // with no cycle it would have run out in 5 days
    expect(asOf(pep({ cycleOnDays: 0, cycleOffDays: 0 }), '2026-01-30').days).toBe(5)
  })

  it('runs out inside an on stretch when that is where the stock ends', () => {
    // from 14 Feb, 5 mg is gone after 18 Feb
    expect(asOf(pep(), '2026-02-14')).toMatchObject({ runOutDate: '2026-02-19', days: 5 })
  })

  it('a stretch of rest then a pause on it does not move the date twice', () => {
    const pauses = [{ id: 'p', startedOn: '2026-02-01', endsOn: '2026-02-10', peptideIds: ['epithalon'] }]
    const withPause = runwayFor(pep(), tState, null, vial(), [], '2026-01-30', 30, pauses)
    expect(withPause.runOutDate).toBe('2026-02-19')
  })

  it('a pause inside an on stretch does move it, by the days paused', () => {
    const pauses = [{ id: 'p', startedOn: '2026-02-15', endsOn: '2026-02-16', peptideIds: ['epithalon'] }]
    const r = runwayFor(pep(), tState, null, vial(), [], '2026-02-14', 30, pauses)
    expect(r.runOutDate).toBe('2026-02-21')
    expect(r.pausedDays).toBe(2)
  })

  it('the sealed shelf, the dot and the alerts use the same walk', () => {
    const cov = coverageFor(pep(), tState, vial(), '2026-01-30')
    expect(cov.runOutDate).toBe('2026-02-19')
    expect(cov.days).toBe(20)
    const items = lowStockItems({ peptides: [pep()], titration: { epithalon: tState }, vials: vial(), today: '2026-01-30', leadDays: 30 })
    expect(items).toHaveLength(1)
    // 10 mg is used up on 23 Feb and the next dose is not until 11 Mar, so it runs out in 40 days: not low
    const long = lowStockItems({ peptides: [pep()], titration: { epithalon: tState }, vials: vial(2), today: '2026-01-30', leadDays: 30 })
    expect(long).toEqual([])
    expect(coverageFor(pep(), tState, vial(2), '2026-01-30').days).toBe(40)
  })

  it('the calendar and restock figure agrees with the Stock room', () => {
    const info = runOutInfo(pep(), tState, vial(), null, '2026-01-30')
    expect(info.runOutDate).toBe('2026-02-19')
    expect(info.daysLeft).toBe(20)
  })

  it('someone else drawing from the same vial does not rest when the owner does', () => {
    const shared = [{ id: 'v', peptideId: 'epithalon', vialMg: 5, qtyOnHand: 1, qtyPurchased: 1, drawProfiles: [{ doseMg: 0.5, frequency: 'daily' }] }]
    const alone = runwayFor(pep(), tState, null, vial(), [], '2026-01-30', 30)
    const together = runwayFor(pep(), tState, null, shared, [], '2026-01-30', 30)
    expect(together.days).toBeLessThan(alone.days)
  })
})

// ------------------------------------------------------- tenure and time at dose

describe('time on a compound does not accrue in a rest', () => {
  it('counts on days only, and reports the rest beside them', () => {
    const t = tenureFor(pep(), { runs: {}, todayStr: '2026-02-14' })
    expect(t.elapsedDays).toBe(25)
    expect(t.offCycleDays).toBe(15)
    expect(t.currentDays).toBe(10)
    expect(t.offCycleWords).toBe('15 days off cycle')
    expect(offCycleDaysBetween(pep(), '2026-01-20', '2026-02-14')).toBe(15)
    expect(onDaysBetween(pep(), '2026-01-20', '2026-02-14')).toBe(10)
  })

  it('a compound with no cycle is unchanged', () => {
    const t = tenureFor(always, { runs: {}, todayStr: '2026-02-14' })
    expect(t.currentDays).toBe(25)
    expect(t.offCycleDays).toBe(0)
  })

  it('time at the current dose skips the rest too', () => {
    const at = doseTenure(pep(), { titration: { epithalon: { level: 1, levelStartDate: '2026-01-25' } }, todayStr: '2026-02-16' })
    // 25 Jan to 16 Feb is 22 days; 15 of them were a rest
    expect(at.elapsed).toBe(7)
    expect(at.days).toBe(7)
  })

  it('a pause that sits inside a rest is not reported twice', () => {
    const pauses = [{ id: 'p', startedOn: '2026-02-01', endsOn: '2026-02-05', peptideIds: null }]
    const t = tenureFor(pep(), { runs: {}, pauses, todayStr: '2026-02-14' })
    expect(t.pausedDays).toBe(0)
    expect(t.currentDays).toBe(10)
  })

  it('a step up is not due on rest days, and the interval counts on days only', () => {
    const ts = { level: 0, levelStartDate: '2026-01-28' } // 7 day interval
    // 17 calendar days later, but only 2 of them on cycle
    expect(stepUpDue(pep(), ts, '2026-02-14')).toBe(false)
    expect(nextStepUpDate(pep(), ts)).toBe('2026-02-19')
    expect(stepUpDue(pep(), ts, '2026-02-19')).toBe(true)
    expect(stepUpDue(pep(), ts, '2026-03-01')).toBe(false) // a rest
    // no cycle: nothing changes
    expect(nextStepUpDate(pep({ cycleOnDays: 0, cycleOffDays: 0 }), { level: 0, levelStartDate: '2026-01-28' })).toBe('2026-02-04')
  })
})

// ------------------------------------------------------ the effects engine

describe('effects: going off and back on cycle are stops and starts', () => {
  const events = cycleEvents(pep(), '2026-03-20')

  it('a rest begins as a stop and the next stretch as a restart, never the first stretch', () => {
    expect(events.map((e) => `${e.kind} ${e.date}`)).toEqual([
      'stop 2026-01-30', 'restart 2026-02-14', 'stop 2026-02-24', 'restart 2026-03-11',
    ])
  })

  const compound = {
    id: 'epithalon', name: 'Epithalon', trackEffects: true,
    points: [{ date: '2026-01-20', kind: 'start', to: 1, unit: 'mg' }, ...events],
  }

  it('become start and stop events the engine already understands, worded as cycle', () => {
    const ev = trackedEvents([compound])
    expect(ev.map((e) => `${e.kind} ${e.date}${e.cycle ? ' cycle' : ''}`)).toEqual([
      'start 2026-01-20', 'stop 2026-01-30 cycle', 'start 2026-02-14 cycle', 'stop 2026-02-24 cycle', 'start 2026-03-11 cycle',
    ])
    expect(describeChanges([ev[1]])).toBe('Epithalon off cycle')
    expect(describeChanges([ev[2]])).toBe('Epithalon back on cycle')
  })

  it('so the latest run is the stretch it is in, or the one that just ended', () => {
    const asOf = (today) => trackedEvents([{ ...compound, points: [compound.points[0], ...cycleEvents(pep(), today)] }])
    expect(latestRun(asOf('2026-03-15'), 'epithalon', '2026-03-15')).toMatchObject({ start: '2026-03-11', ongoing: true })
    expect(latestRun(asOf('2026-03-05'), 'epithalon', '2026-03-05')).toMatchObject({ start: '2026-02-14', end: '2026-02-24', ongoing: false })
  })

  it('a compound with no cycle has none of these', () => {
    expect(cycleEvents(always, '2026-03-20')).toEqual([])
  })
})

// ------------------------------------------------------ restart dose

describe('when a cycle restarts', () => {
  const floorMode = pep({ restartDose: 'floor' })
  const sat = { level: 2, levelStartDate: '2026-01-25' } // 3 mg, set in the first stretch

  it('resumes the last dose by default, and a compound that states nothing resumes', () => {
    expect(restartMode(pep())).toBe('resume')
    expect(rungOn(pep(), sat, '2026-02-14')).toMatchObject({ level: 2, dose: 3, restarted: false })
  })

  it('follows the compound playbook where it states one; a choice on the compound wins over it', () => {
    expect(restartMode(pep({ playbook: { restartDose: 'floor' } }))).toBe('floor')
    expect(restartMode(pep({ playbook: { restartDose: 'floor' }, restartDose: 'resume' }))).toBe('resume')
  })

  it('restart from the floor shows the floor on the first day back, and not before', () => {
    expect(rungOn(floorMode, sat, '2026-01-28')).toMatchObject({ level: 2, dose: 3 }) // same stretch
    expect(rungOn(floorMode, sat, '2026-02-05')).toMatchObject({ level: 2 }) // resting: nothing is shown
    expect(rungOn(floorMode, sat, '2026-02-13')).toMatchObject({ level: 2 })
    expect(rungOn(floorMode, sat, '2026-02-14')).toMatchObject({ level: 0, dose: 1, restarted: true })
    expect(levelStateOn(floorMode, sat, '2026-02-20')).toMatchObject({ level: 0, levelStartDate: '2026-02-14' })
  })

  it('a dose chosen during a rest belongs to the stretch that follows it', () => {
    const duringRest = { level: 2, levelStartDate: '2026-02-05' }
    expect(rungOn(floorMode, duringRest, '2026-02-14').level).toBe(2)
    expect(rungOn(floorMode, duringRest, '2026-03-11').level).toBe(0) // the stretch after that restarts
  })

  it('the projection climbs again from the floor in each restarted stretch', () => {
    const rows = projectSchedule(floorMode, { level: 0, levelStartDate: '2026-02-14' }, '2026-02-14', 40, '2026-02-14')
    const on = (d) => rows.find((r) => r.date === d)
    expect(on('2026-02-14').dose).toBe(1)
    expect(on('2026-02-21').dose).toBe(2) // a step up after 7 on days
    // 11 Mar is the next stretch and starts at the floor
    expect(on('2026-03-11')?.dose ?? 1).toBe(1)
  })

  it('the store puts the floor in place, once', () => {
    useStore.setState({ peptides: [floorMode], titration: { epithalon: sat }, doseEvents: [] })
    expect(useStore.getState().applyCycleRestarts('2026-02-10')).toBe(0) // still resting
    expect(useStore.getState().applyCycleRestarts('2026-02-14')).toBe(1)
    expect(useStore.getState().titration.epithalon).toEqual({ level: 0, levelStartDate: '2026-02-14' })
    expect(useStore.getState().doseEvents.at(-1)).toMatchObject({ kind: 'cycle-reset', date: '2026-02-14', from: 3, to: 1 })
    expect(useStore.getState().applyCycleRestarts('2026-02-14')).toBe(0)
  })

  it('and leaves a compound set to resume exactly as it was', () => {
    useStore.setState({ peptides: [pep({ restartDose: 'resume' })], titration: { epithalon: sat }, doseEvents: [] })
    expect(useStore.getState().applyCycleRestarts('2026-02-14')).toBe(0)
    expect(useStore.getState().titration.epithalon).toEqual(sat)
  })
})

// ---------------------------------------- snapshot, reminders and the rollover

describe('the snapshot, rolled over at midnight into a new on stretch', () => {
  const state = (over = {}) => ({
    peptides: [pep(), always], titration: { epithalon: { level: 2, levelStartDate: '2026-01-25' } },
    doseLogs: [], pushes: [], pauses: [], skips: [], supplements: [], supplementLogs: [],
    saunaSessions: [], saunaSettings: { weeklyTarget: 4 }, saunaTimer: null, healthSettings: {},
    notificationSettings: { amTime: '07:00', pmTime: '20:00' }, nativeState: {},
    ...over,
  })
  const names = (snap, i) => snap.days[i].items.map((x) => x.name)

  it('leaves a resting compound out of today and the days ahead, and has it back on its first day', () => {
    // late on 10 March: a rest, back tomorrow, written before midnight
    const snap = buildSnapshot(state(), { now: new Date(2026, 2, 10, 23, 30) })
    expect(names(snap, 0)).not.toContain('Epithalon')
    expect(names(snap, 1)).toContain('Epithalon')
    expect(names(snap, 6)).toContain('Epithalon') // 16 Mar, still inside the stretch of 11 to 20 Mar
  })

  it('the stretch ends and the compound drops out of the days ahead', () => {
    const snap = buildSnapshot(state(), { now: new Date(2026, 2, 18, 8, 0) })
    expect(names(snap, 0)).toContain('Epithalon') // 18
    expect(names(snap, 2)).toContain('Epithalon') // 20, the last day on
    expect(names(snap, 3)).not.toContain('Epithalon') // 21 Mar, a rest
  })

  it('lists who restarts when, for the Watch to remind from', () => {
    const snap = buildSnapshot(state(), { now: new Date(2026, 2, 10, 8, 0) })
    expect(snap.cycles.restarts).toEqual([{ date: '2026-03-11', names: ['Epithalon'] }])
    expect(buildSnapshot(state(), { now: new Date(2026, 2, 15, 8, 0) }).cycles.restarts).toEqual([])
  })

  it('shows the dose that applies on the day: the floor, when it restarts from the floor', () => {
    const floor = state({ peptides: [pep({ restartDose: 'floor' }), always] })
    const snap = buildSnapshot(floor, { now: new Date(2026, 2, 10, 23, 30) })
    expect(snap.days[1].items.find((x) => x.refId === 'epithalon').dose).toBe('1 mg')
    const resume = buildSnapshot(state(), { now: new Date(2026, 2, 10, 23, 30) })
    expect(resume.days[1].items.find((x) => x.refId === 'epithalon').dose).toBe('3 mg')
  })

  it('a pause during the rest changes nothing, and one over the restart day leaves it out', () => {
    const paused = state({ pauses: [{ id: 'p', startedOn: '2026-03-11', endsOn: '2026-03-12', peptideIds: ['epithalon'] }] })
    const snap = buildSnapshot(paused, { now: new Date(2026, 2, 10, 8, 0) })
    expect(names(snap, 1)).not.toContain('Epithalon')
    expect(snap.cycles.restarts).toEqual([])
  })
})

describe('reminders, nudges and the restart notice', () => {
  const state = (over = {}) => ({
    peptides: [pep(), always], titration: {}, doseLogs: [], pushes: [], pauses: [], skips: [], supplements: [],
    supplementLogs: [], reactions: [], injectionRecords: [], saunaTimer: null,
    notificationSettings: { amTime: '07:00', pmTime: '20:00', nudgeDelayMin: 90, remindOn: 'iphone' },
    ...over,
  })
  const NOW = new Date(2026, 2, 8, 6, 0) // 8 March, in the rest
  const doseOn = (list, date) => list.find((n) => n.id.endsWith(`dose.${date}.AM`))
  const mentions = (n) => (n.payload.items || []).map((i) => i.refId).concat((n.payload.groups || []).flatMap((g) => g.refIds))

  it('has no reminder or nudge for a compound in a rest, and has them from its first day back', () => {
    const list = buildSchedule(state(), { now: NOW })
    expect(mentions(doseOn(list, '2026-03-10'))).toEqual(['bpc157'])
    expect(mentions(doseOn(list, '2026-03-11'))).toEqual(expect.arrayContaining(['epithalon', 'bpc157']))
    const nudge = list.find((n) => n.id.endsWith('nudge.2026-03-10.AM'))
    expect(mentions(nudge)).toEqual(['bpc157'])
    expect(nudge.body).not.toContain('Epithalon')
  })

  it('a slot whose only compound is resting has no reminder at all', () => {
    const list = buildSchedule(state({ peptides: [pep()] }), { now: NOW })
    expect(doseOn(list, '2026-03-10')).toBeUndefined()
    expect(list.find((n) => n.id.endsWith('nudge.2026-03-10.AM'))).toBeUndefined()
    expect(doseOn(list, '2026-03-11')).toBeDefined()
  })

  it('the evening before a restart says so, once, in plain words', () => {
    const list = buildSchedule(state(), { now: NOW })
    const r = list.filter((n) => n.id.includes('.restart.'))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'pepito.sched.restart.2026-03-11', title: 'Restarts tomorrow', body: 'Epithalon restarts tomorrow' })
    expect(new Date(r[0].fireAt)).toEqual(new Date(2026, 2, 10, 19, 0))
    expect(restartWords(['Epithalon', 'KPV'])).toBe('Epithalon and KPV restart tomorrow')
    expect(restartsOn([pep(), always], '2026-03-11').map((p) => p.id)).toEqual(['epithalon'])
    expect(restartsOn([pep()], '2026-01-20')).toEqual([]) // the first stretch is a start
  })

  it('follows Remind me on: with the Watch installed the phone leaves it to the Watch', () => {
    const watch = state({ notificationSettings: { amTime: '07:00', pmTime: '20:00', remindOn: 'watch' } })
    expect(buildSchedule(watch, { now: NOW, watchReady: true }).some((n) => n.id.includes('.restart.'))).toBe(false)
    expect(buildSchedule(watch, { now: NOW, watchReady: false }).some((n) => n.id.includes('.restart.'))).toBe(true)
    const both = state({ notificationSettings: { amTime: '07:00', pmTime: '20:00', remindOn: 'both' } })
    expect(buildSchedule(both, { now: NOW, watchReady: true }).some((n) => n.id.includes('.restart.'))).toBe(true)
  })

  it('has its own switch, on by default', () => {
    const off = state({ notificationSettings: { amTime: '07:00', pmTime: '20:00', remindOn: 'iphone', restarts: false } })
    expect(buildSchedule(off, { now: NOW }).some((n) => n.id.includes('.restart.'))).toBe(false)
  })

  it('skips a restart that falls on a paused day', () => {
    const paused = state({ pauses: [{ id: 'p', startedOn: '2026-03-11', endsOn: '2026-03-12', peptideIds: ['epithalon'] }] })
    expect(buildSchedule(paused, { now: NOW }).some((n) => n.id.includes('.restart.'))).toBe(false)
  })
})

// ------------------------------------------------------------ the export

describe('the exported calendar skips rests', () => {
  it('excludes each rest occurrence from the weekly rule', () => {
    const evs = eventsForPeptide(pep(), { level: 0 }, { from: new Date('2026-01-26T00:00:00'), until: new Date('2026-03-01T00:00:00'), includeDose: true })
    const fri = evs.find((e) => e.byday === 'FR')
    const stamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const out = fri.exdates.map(stamp)
    expect(out).toContain('2026-01-30')
    expect(out).toContain('2026-02-06')
    expect(out).not.toContain('2026-02-20') // on cycle
    const { ics } = buildIcs([pep()], { epithalon: { level: 0 } }, { from: new Date('2026-01-26T00:00:00'), until: new Date('2026-03-01T00:00:00') })
    expect(ics).toContain('EXDATE:20260130T080000')
  })

  it('a compound with no cycle has no exclusions', () => {
    const evs = eventsForPeptide(always, { level: 0 }, { from: new Date('2026-01-26T00:00:00'), includeDose: true })
    expect(evs.every((e) => e.exdates.length === 0)).toBe(true)
  })
})

describe('cycle info is the only place the cycle is worked out', () => {
  it('every date agrees between the cycle, the due rule and the status words', () => {
    for (const d of range('2026-01-15', 90)) {
      const c = cycleInfo(pep(), d)
      expect(isDue(pep(), d)).toBe(c.isOn)
      const s = cycleStatus(pep(), d)
      if (c.beforeStart) expect(s.phase).toBe('before')
      else expect(s.on).toBe(c.isOn)
    }
  })
})

beforeEach(() => { mem.clear() })
