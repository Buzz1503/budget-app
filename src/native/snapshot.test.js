import { describe, it, expect } from 'vitest'
import { buildSnapshot, spokenAction, clockLabel, SNAPSHOT_SCHEMA } from './snapshot'
import { applyPendingActions } from './actions'

// Tuesday 20 Oct 2026, 08:00 local
const NOW = new Date(2026, 9, 20, 8, 0, 0)
const T = '2026-10-20'

const pep = (over) => ({
  frequency: 'daily', startDate: '2026-01-01', slot: 'AM',
  ladder: { floor: 1, step: 0, ceiling: 1, intervalWeeks: 4, unit: 'mg' },
  recon: { vialMg: 10, bacMl: 2 }, route: 'SubQ',
  ...over,
})
const reta = pep({ id: 'reta', name: 'Retatrutide', shortName: 'Reta', frequency: 'weekly', scheduleWeekdays: [2], slot: 'PM', ladder: { floor: 3, step: 0, ceiling: 3, intervalWeeks: 4, unit: 'mg' }, recon: { vialMg: 20, bacMl: 2 } })
const bpc = pep({ id: 'bpc157', name: 'BPC-157', ladder: { floor: 250, step: 0, ceiling: 250, intervalWeeks: 4, unit: 'mcg' }, recon: { vialMg: 5, bacMl: 2 } })
const tb = pep({ id: 'tb500', name: 'TB-500', ladder: { floor: 2, step: 0, ceiling: 2, intervalWeeks: 4, unit: 'mg' }, recon: { vialMg: 10, bacMl: 2 } })
const semax = pep({ id: 'semax', name: 'Semax', route: 'Nasal', ladder: { floor: 1, step: 0, ceiling: 1, intervalWeeks: 4, unit: 'spray' } })
const testE = pep({ id: 'test-e', name: 'Testosterone E', alwaysSeparate: true, frequency: '2xweek', scheduleWeekdays: [2, 5], ladder: { floor: 100, step: 0, ceiling: 100, intervalWeeks: 4, unit: 'mg' }, recon: { vialMg: 2500, bacMl: 10 } })
const fishOil = { id: 'fish', name: 'Fish oil', form: 'capsule', dose: '2 capsules', slot: 'AM' }

const state = (over = {}) => ({
  peptides: [reta, bpc, tb, semax, testE],
  titration: {},
  doseLogs: [],
  pushes: [],
  pauses: [],
  skips: [],
  supplements: [fishOil],
  supplementLogs: [],
  saunaSessions: [],
  saunaSettings: { weeklyTarget: 4, usualLengthMin: null, usualTempC: null },
  saunaTimer: null,
  healthSettings: { maxHR: null },
  notificationSettings: { amTime: '07:00', pmTime: '20:00' },
  nativeState: { processedActionIds: [] },
  ...over,
})
// MIX for BPC-157 and TB-500, nothing else
const verdictOf = (a, b) => ([a, b].sort().join('|') === 'bpc157|tb500' ? 'MIX' : null)

describe('buildSnapshot', () => {
  const snap = buildSnapshot(state(), { now: NOW, verdictOf })
  const today = snap.days[0]
  const item = (refId) => today.items.find((i) => i.refId === refId)

  it('covers today and the next six days, with the schema version', () => {
    expect(snap.schema).toBe(SNAPSHOT_SCHEMA)
    expect(snap.days.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'])
    // Reta is weekly on Tuesday: today only
    expect(snap.days[1].items.some((i) => i.refId === 'reta')).toBe(false)
  })

  it('carries the reminder settings the Watch schedules from', () => {
    expect(snap.notifications).toEqual({ timeSensitive: true, remindOn: 'watch', doses: true, nudges: true, nudgeDelayMin: 90 })
    const other = buildSnapshot(state({ notificationSettings: { remindOn: 'both', nudges: false, nudgeDelayMin: 30, timeSensitive: false } }), { now: NOW })
    expect(other.notifications).toEqual({ timeSensitive: false, remindOn: 'both', doses: true, nudges: false, nudgeDelayMin: 30 })
    expect(buildSnapshot(state({ notificationSettings: { remindOn: 'pager' } }), { now: NOW }).notifications.remindOn).toBe('watch')
  })

  it('prints each dose the way Home does, with the syringe units', () => {
    expect(item('reta').line).toBe('Reta 3 mg, 30 units')
    expect(item('semax').line).toBe('Semax 1 spray')
    expect(item('semax').units).toBeNull()
    expect(item('bpc157').line).toBe('BPC-157 250 mcg, 10 units')
    expect(item('fish').line).toBe('Fish oil 2 capsules')
  })

  it('uses Log for peptides and Take for supplements, with a spoken label', () => {
    expect(item('reta').verb).toBe('Log')
    expect(item('fish').verb).toBe('Take')
    expect(item('reta').speech).toBe('Log Retatrutide 3 milligrams')
    expect(spokenAction('Log', 'BPC-157', '250 mcg')).toBe('Log BPC-157 250 micrograms')
  })

  it('groups only what the mix engine groups, and never Testosterone E or a nasal item', () => {
    expect(today.groups).toHaveLength(1)
    expect(today.groups[0].title).toBe('Draw together: BPC-157 + TB-500')
    expect(item('bpc157').groupId).toBe(today.groups[0].id)
    expect(item('tb500').groupId).toBe(today.groups[0].id)
    expect(item('test-e').groupId).toBeNull()
    expect(item('semax').groupId).toBeNull()
    // without the matrix there are no groups at all
    expect(buildSnapshot(state(), { now: NOW }).days[0].groups).toEqual([])
  })

  it('marks logged and skipped items, and leaves a logged item out of any group', () => {
    const s = buildSnapshot(state({
      doseLogs: [{ id: 'l1', peptideId: 'bpc157', date: T }],
      skips: [{ kind: 'peptide', peptideId: 'tb500', date: T }],
      supplementLogs: [{ supplementId: 'fish', date: T }],
    }), { now: NOW, verdictOf })
    const d = s.days[0]
    expect(d.items.find((i) => i.refId === 'bpc157').status).toBe('logged')
    expect(d.items.find((i) => i.refId === 'tb500').status).toBe('skipped')
    expect(d.items.find((i) => i.refId === 'fish').status).toBe('logged')
    expect(d.groups).toEqual([])
  })

  it('leaves out paused compounds and says the protocol is paused', () => {
    const s = buildSnapshot(state({ pauses: [{ id: 'pz', startedOn: '2026-10-19', reason: 'holiday' }] }), { now: NOW })
    expect(s.paused).toMatchObject({ active: true, reason: 'Holiday', wholeProtocol: true })
    expect(s.days[0].items).toEqual([])
    expect(s.next).toBeNull()
  })

  it('the next dose skips what is done and names the slot time', () => {
    expect(snap.next.slot).toBe('AM')
    expect(snap.next.label).toMatch(/^Next: .*, 7 am$/)
    const evening = buildSnapshot(state(), { now: new Date(2026, 9, 20, 15, 0) })
    expect(evening.next).toMatchObject({ slot: 'PM', date: T, line: 'Reta 3 mg', count: 1 })
    expect(evening.next.label).toBe('Next: Reta 3 mg, 8 pm')
    expect(clockLabel('07:30')).toBe('7:30 am')
  })

  it('carries the sauna week, the usual session and any running session', () => {
    const s = buildSnapshot(state({
      saunaSessions: [{ id: 's1', date: '2026-10-19', start: '19:00', lengthMin: 25, tempC: 65 }],
      saunaTimer: { startedAt: 1, targetMin: 20, tempC: 60, rounds: 2 },
    }), { now: NOW })
    expect(s.sauna.week).toEqual({ sessions: 1, target: 4, heatMin: 25 })
    expect(s.sauna.usual).toEqual({ lengthMin: 25, tempC: 65 })
    expect(s.sauna.active).toMatchObject({ startedAt: 1, targetMin: 20, tempC: 60, rounds: 2 })
  })

  it('passes readiness through and gives the Watch its max heart rate', () => {
    const readiness = { score: 72, band: 'moderate', bandLabel: 'Moderate', status: 'ok', asOf: NOW.toISOString() }
    const s = buildSnapshot(state(), { now: NOW, readiness, maxHR: 182 })
    expect(s.readiness).toEqual(readiness)
    expect(s.watch.maxHR).toBe(182)
    expect(s.watch.countTowardMove).toBe(false)
  })
})

describe('applyPendingActions', () => {
  const at = '2026-10-20T07:05:00.000Z'
  const act = (id, type, payload = {}) => ({ id, type, at, source: 'widget', payload })

  it('turns each action into the same store operation an in-app tap uses', () => {
    const r = applyPendingActions(state(), [
      act('a1', 'logDose', { refId: 'reta', date: T }),
      act('a2', 'logDose', { refIds: ['bpc157', 'tb500'], group: true, date: T }),
      act('a3', 'logDose', { refId: 'fish', kind: 'supplement', date: T }),
      act('a4', 'skipDose', { refId: 'semax', date: T }),
    ])
    expect(r.ops).toEqual([
      { op: 'logDose', peptideId: 'reta', date: T, at },
      { op: 'logCoDraw', peptideIds: ['bpc157', 'tb500'], date: T, at },
      { op: 'takeSupplement', supplementId: 'fish', date: T, at },
      { op: 'skipDose', peptideId: 'semax', date: T },
    ])
    expect(r.applied).toEqual(['a1', 'a2', 'a3', 'a4'])
  })

  it('applies an action once: a repeated id, in the same batch or a later one, is ignored', () => {
    const first = applyPendingActions(state(), [act('a1', 'logDose', { refId: 'reta', date: T }), act('a1', 'logDose', { refId: 'reta', date: T })])
    expect(first.ops).toHaveLength(1)
    expect(first.ignored).toEqual([{ id: 'a1', reason: 'duplicate' }])
    const again = applyPendingActions(state({ nativeState: { processedActionIds: first.processedIds } }), [act('a1', 'logDose', { refId: 'reta', date: T })])
    expect(again.ops).toEqual([])
    expect(again.ignored).toEqual([{ id: 'a1', reason: 'duplicate' }])
  })

  it('sets aside actions for doses that no longer exist or are already settled', () => {
    const r = applyPendingActions(state({ doseLogs: [{ peptideId: 'reta', date: T }] }), [
      act('b1', 'logDose', { refId: 'deleted-compound', date: T }),
      act('b2', 'logDose', { refId: 'reta', date: T }),
      act('b3', 'skipDose', { refId: 'reta', date: T }),
      act('b4', 'logDose', { refId: 'gone', kind: 'supplement', date: T }),
      act('b5', 'whatever'),
    ])
    expect(r.ops).toEqual([])
    expect(r.ignored).toEqual([
      { id: 'b1', reason: 'missing' }, { id: 'b2', reason: 'already' }, { id: 'b3', reason: 'already' },
      { id: 'b4', reason: 'missing' }, { id: 'b5', reason: 'unknown' },
    ])
  })

  it('a group keeps only its members still owed, and two actions in one batch see each other', () => {
    const r = applyPendingActions(state({ doseLogs: [{ peptideId: 'tb500', date: T }] }), [
      act('c1', 'logDose', { refIds: ['bpc157', 'tb500'], group: true, date: T }),
      act('c2', 'logDose', { refId: 'bpc157', date: T }),
    ])
    expect(r.ops).toEqual([{ op: 'logCoDraw', peptideIds: ['bpc157'], date: T, at }])
    expect(r.ignored).toEqual([{ id: 'c2', reason: 'already' }])
  })

  it('a slot log covers everything still due; push and snooze are recorded', () => {
    const r = applyPendingActions(state(), [
      act('d1', 'logSlot', { date: T, refIds: ['bpc157', 'tb500'], supplementIds: ['fish'] }),
      act('d2', 'pushDose', { refId: 'test-e', date: T }),
      act('d3', 'snoozeDose', { refIds: ['reta'], date: T }),
    ])
    expect(r.ops.map((o) => o.op)).toEqual(['logDose', 'logDose', 'takeSupplement', 'pushDose'])
    expect(r.applied).toEqual(['d1', 'd2', 'd3'])
  })

  it('sauna: start once, stop the running one, and a Watch session is added once per workout', () => {
    const r = applyPendingActions(state(), [
      act('e1', 'startSauna', { startedAt: 1000, targetMin: 20, tempC: 60 }),
      act('e2', 'startSauna', { startedAt: 2000, targetMin: 20, tempC: 60 }),
      act('e3', 'stopSauna', { stoppedAt: 5000 }),
      act('e4', 'stopSauna', { stoppedAt: 6000 }),
    ])
    expect(r.ops.map((o) => o.op)).toEqual(['startSauna', 'stopSauna'])
    expect(r.ignored).toEqual([{ id: 'e2', reason: 'already' }, { id: 'e4', reason: 'not-running' }])
    const w = applyPendingActions(state({ saunaSessions: [{ id: 's', workoutId: 'w1' }] }), [
      act('f1', 'saunaCompleted', { workoutId: 'w1', start: 0, end: 60000 }),
      act('f2', 'saunaCompleted', { workoutId: 'w2', start: 0, end: 60000 }),
    ])
    expect(w.ops.map((o) => o.op)).toEqual(['saunaFromWatch'])
    expect(w.ignored).toEqual([{ id: 'f1', reason: 'already' }])
  })
})
