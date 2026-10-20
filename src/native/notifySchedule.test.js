import { describe, it, expect } from 'vitest'
import { buildSchedule, stockAlerts, rowLine, doseCategory, ID_PREFIX, SCHEDULE_DAYS } from './notifySchedule'

// Tuesday 20 Oct 2026, 06:00 local
const NOW = new Date(2026, 9, 20, 6, 0, 0)
const T = '2026-10-20'
const pep = (over) => ({
  frequency: 'daily', startDate: '2026-01-01', slot: 'AM', route: 'SubQ',
  ladder: { floor: 1, step: 0, ceiling: 1, intervalWeeks: 4, unit: 'mg' }, recon: { vialMg: 10, bacMl: 2 },
  ...over,
})
const reta = pep({ id: 'reta', name: 'Retatrutide', shortName: 'Reta', frequency: 'weekly', scheduleWeekdays: [2], slot: 'PM', ladder: { floor: 3, step: 0, ceiling: 3, intervalWeeks: 4, unit: 'mg' }, recon: { vialMg: 20, bacMl: 2 } })
const bpc = pep({ id: 'bpc157', name: 'BPC-157', ladder: { floor: 250, step: 0, ceiling: 250, intervalWeeks: 4, unit: 'mcg' }, recon: { vialMg: 5, bacMl: 2 } })
const tb = pep({ id: 'tb500', name: 'TB-500', ladder: { floor: 2, step: 0, ceiling: 2, intervalWeeks: 4, unit: 'mg' } })
const fish = { id: 'fish', name: 'Fish oil', form: 'capsule', dose: '2 capsules', slot: 'AM' }
const state = (over = {}) => ({
  peptides: [reta, bpc, tb], titration: {}, doseLogs: [], pushes: [], pauses: [], skips: [],
  supplements: [fish], supplementLogs: [], saunaTimer: null, reactions: [], injectionRecords: [],
  notificationSettings: { amTime: '07:00', pmTime: '20:00', nudgeDelayMin: 90 },
  ...over,
})
const verdictOf = (a, b) => ([a, b].sort().join('|') === 'bpc157|tb500' ? 'MIX' : null)
const byId = (list) => Object.fromEntries(list.map((n) => [n.id.replace(ID_PREFIX, ''), n]))

describe('dose reminders', () => {
  const sched = byId(buildSchedule(state(), { now: NOW, verdictOf }))

  it('AM and PM at the set times, titled by slot and threaded per slot', () => {
    const am = sched[`dose.${T}.AM`]
    expect(new Date(am.fireAt)).toEqual(new Date(2026, 9, 20, 7, 0))
    expect(am.title).toBe('AM doses')
    expect(am.threadId).toBe('pepito.slot.AM')
    expect(new Date(sched[`dose.${T}.PM`].fireAt)).toEqual(new Date(2026, 9, 20, 20, 0))
    expect(sched[`dose.${T}.PM`].title).toBe('PM doses')
  })

  it('lists each item or group with dose and units, one per line, in the app\'s words', () => {
    expect(sched[`dose.${T}.AM`].body).toBe('Draw together: BPC-157 + TB-500, 50 units\nFish oil 2 capsules')
    expect(sched[`dose.${T}.PM`].body).toBe('Reta 3 mg, 30 units')
    expect(sched[`dose.${T}.AM`].payload.groups).toEqual([{ id: `${T}:AM:group:0`, refIds: ['bpc157', 'tb500'] }])
    expect(sched[`dose.${T}.AM`].payload.items).toEqual([{ refId: 'fish', kind: 'supplement', canPush: false }])
  })

  it('time-sensitive by default, and off when the setting is off', () => {
    expect(sched[`dose.${T}.AM`].timeSensitive).toBe(true)
    const off = buildSchedule(state({ notificationSettings: { timeSensitive: false } }), { now: NOW })
    expect(off.every((n) => n.timeSensitive === false)).toBe(true)
  })

  it('one nudge per slot, at the delay, never more than one', () => {
    expect(new Date(sched[`nudge.${T}.AM`].fireAt)).toEqual(new Date(2026, 9, 20, 8, 30))
    expect(sched[`nudge.${T}.AM`].body.startsWith('Still to log:\n')).toBe(true)
    const all = buildSchedule(state(), { now: NOW, verdictOf })
    const nudgesToday = all.filter((n) => n.id.startsWith(`${ID_PREFIX}nudge.${T}.AM`))
    expect(nudgesToday).toHaveLength(1)
  })

  it('rolls seven days ahead and leaves out what has already passed', () => {
    const later = buildSchedule(state(), { now: new Date(2026, 9, 20, 7, 30), verdictOf })
    const ids = later.map((n) => n.id.replace(ID_PREFIX, ''))
    expect(ids).not.toContain(`dose.${T}.AM`)
    expect(ids).toContain(`nudge.${T}.AM`) // 08:30 is still ahead
    const days = new Set(later.filter((n) => n.id.includes('.dose.')).map((n) => n.payload.date))
    expect(days.size).toBe(SCHEDULE_DAYS)
    expect([...days].sort().at(-1)).toBe('2026-10-26')
  })

  it('logged and skipped items drop out; a slot with nothing left has no reminder and no nudge', () => {
    const s = byId(buildSchedule(state({
      doseLogs: [{ peptideId: 'bpc157', date: T }, { peptideId: 'tb500', date: T }],
      skips: [{ kind: 'supplement', supplementId: 'fish', date: T }],
    }), { now: NOW, verdictOf }))
    expect(s[`dose.${T}.AM`]).toBeUndefined()
    expect(s[`nudge.${T}.AM`]).toBeUndefined()
    expect(s[`dose.2026-10-21.AM`]).toBeDefined()
  })

  it('a paused protocol gets no reminders until the pause ends', () => {
    const s = buildSchedule(state({ pauses: [{ id: 'p', startedOn: '2026-10-19', endsOn: '2026-10-22', reason: 'holiday' }], supplements: [] }), { now: NOW })
    const dates = new Set(s.map((n) => n.payload.date))
    expect([...dates].sort()).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'])
  })

  it('a dose skipped for a day is not reminded that day', () => {
    const s = byId(buildSchedule(state({ skips: [{ kind: 'peptide', peptideId: 'reta', date: T }] }), { now: NOW }))
    expect(s[`dose.${T}.PM`]).toBeUndefined()
  })

  it('the buttons follow what is in it: Take for supplements, Push only when something can move', () => {
    expect(doseCategory([{ items: [{ kind: 'supplement', canPush: false }] }])).toBe('DOSE_TAKE')
    expect(doseCategory([{ items: [{ kind: 'peptide', canPush: false }] }])).toBe('DOSE_LOG')
    expect(doseCategory([{ items: [{ kind: 'peptide', canPush: true }, { kind: 'supplement', canPush: false }] }])).toBe('DOSE_LOG_PUSH')
    expect(rowLine({ group: null, items: [{ line: 'Semax 1 spray' }] })).toBe('Semax 1 spray')
  })
})

describe('reaction and sauna reminders', () => {
  it('one reminder a day while a reaction is open, and none today once today is checked', () => {
    const records = [{ id: 'r1', peptideId: 'bpc157', timestamp: '2026-10-18T08:00:00Z' }]
    const open = { injectionRecordId: 'r1', ratings: [{ date: '2026-10-18', severity: 'mild' }], goneAt: null }
    const s = buildSchedule(state({ injectionRecords: records, reactions: [open] }), { now: NOW })
    const reminders = s.filter((n) => n.category === 'REACTION')
    expect(reminders.length).toBeGreaterThan(0)
    expect(reminders[0].payload.route).toBe('reactions')
    const checked = { ...open, ratings: [...open.ratings, { date: T, severity: 'mild' }] }
    const s2 = buildSchedule(state({ injectionRecords: records, reactions: [checked] }), { now: NOW })
    expect(s2.some((n) => n.id === `${ID_PREFIX}reaction.${T}`)).toBe(false)
  })

  it('the sauna session target gets one notification with Stop', () => {
    const start = NOW.getTime() - 5 * 60000
    const s = buildSchedule(state({ saunaTimer: { startedAt: start, targetMin: 20, tempC: 60 } }), { now: NOW })
    const sauna = s.find((n) => n.category === 'SAUNA_DONE')
    expect(new Date(sauna.fireAt).getTime()).toBe(start + 20 * 60000)
    expect(sauna.body).toBe('20 min is up.')
  })
})

describe('low stock', () => {
  const lowState = state({
    peptides: [reta],
    vials: [], // nothing sealed left: low
  })
  it('notifies once when an item first runs low, then stays quiet', () => {
    const first = stockAlerts(lowState, { now: NOW, alerted: [] })
    expect(first.notify).toHaveLength(1)
    expect(first.notify[0].payload.route).toBe('supplies')
    expect(first.alerted).toEqual(['reta'])
    const second = stockAlerts(lowState, { now: NOW, alerted: first.alerted })
    expect(second.notify).toEqual([])
  })

  it('alerts again after a restock has run low again', () => {
    const restocked = stockAlerts(state({ peptides: [reta], vials: [{ id: 'v', peptideId: 'reta', qtyOnHand: 20, vialMg: 20 }] }), { now: NOW, alerted: ['reta'] })
    expect(restocked.alerted).toEqual([])
    const lowAgain = stockAlerts(lowState, { now: NOW, alerted: restocked.alerted })
    expect(lowAgain.notify).toHaveLength(1)
  })
})
