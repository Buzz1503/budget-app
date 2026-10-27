// The Sleep Lab's records in the store: as-needed logs, variable grams, the
// evening factors and the morning check, and the v26 migration.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}

let useStore
let todayStr
beforeAll(async () => {
  const mod = await import('../store/useStore')
  useStore = mod.default
  todayStr = mod.todayStr
})

beforeEach(() => {
  useStore.setState({ asNeededLogs: [], supplementLogs: [], habitLogs: {}, eveningDetails: {}, morningChecks: {}, skips: [] })
})

describe('as needed', () => {
  it('logs amount, unit and time; never shows as due or missed', () => {
    const at = '2026-10-23T11:20:00.000Z'
    const log = useStore.getState().logAsNeeded('an-temazepam', { amount: 10, at, source: 'watch' })
    expect(log).toMatchObject({ itemId: 'an-temazepam', amount: 10, unit: 'mg', at, source: 'watch' })
    expect(useStore.getState().asNeededLogs).toHaveLength(1)
    expect(useStore.getState().logAsNeeded('an-temazepam', { amount: 0 })).toBeNull()
    expect(useStore.getState().logAsNeeded('nope', { amount: 1 })).toBeNull()
    // nothing about as-needed items reaches the daily lists
    const s = useStore.getState()
    expect(s.supplements.some((x) => /temazepam|dex/i.test(x.name))).toBe(false)
    expect(s.peptides.some((x) => /temazepam|dex/i.test(x.name))).toBe(false)
    useStore.getState().deleteAsNeededLog(log.id)
    expect(useStore.getState().asNeededLogs).toHaveLength(0)
  })

  it('Restavit can be logged in tablets', () => {
    const log = useStore.getState().logAsNeeded('an-restavit', { amount: 1, unit: 'tablets', at: '2026-10-23T11:00:00Z', source: 'watch' })
    expect(log.unit).toBe('tablets')
  })
})

describe('variable grams', () => {
  it('one log per day with the amount and time; a second log replaces the amount', () => {
    useStore.setState({ supplements: [{ id: 'mg', name: 'Magnesium glycinate', slot: 'PM', amountUnit: 'g', form: 'powder' }] })
    const t = todayStr()
    useStore.getState().logSupplementAmount('mg', { amount: 0.4, at: '2026-10-23T10:30:00Z' })
    useStore.getState().logSupplementAmount('mg', { amount: 0.6, at: '2026-10-23T10:40:00Z' })
    const logs = useStore.getState().supplementLogs.filter((l) => l.supplementId === 'mg')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ date: t, amount: 0.6, unit: 'g', takenAt: '2026-10-23T10:40:00.000Z', dose: '0.6 g' })
    expect(useStore.getState().logSupplementAmount('mg', { amount: -1 })).toBeNull()
  })
})

describe('evening and morning', () => {
  it('"Nothing unusual" answers the evening as no and no drinks', () => {
    useStore.getState().setEveningDetail('2026-10-23', { lastMealAt: '19:20' })
    useStore.getState().answerNothingUnusual('2026-10-23')
    const s = useStore.getState()
    expect(Object.values(s.habitLogs['2026-10-23']).every((v) => v === false)).toBe(true)
    expect(s.habitLogs['2026-10-23'].stress).toBe(false)
    expect(s.eveningDetails['2026-10-23']).toMatchObject({ drinks: 0, lastMealAt: '19:20' })
  })

  it('the morning check is stored by wake date and merged', () => {
    useStore.getState().answerMorningCheck('2026-10-24', { rested: 2 })
    useStore.getState().answerMorningCheck('2026-10-24', { dreams: 'nightmare', pee: 2 })
    expect(useStore.getState().morningChecks['2026-10-24']).toMatchObject({ rested: 2, dreams: 'nightmare', pee: 2 })
  })
})

describe('v26 migration', () => {
  it('converts magnesium glycinate in place, keeps its logs, hides the old habits and keeps their answers', () => {
    const migrate = useStore.persist.getOptions().migrate
    const save = {
      supplements: [{ id: 'mag1', name: 'Magnesium Glycinate 500mg', slot: 'PM', form: 'capsule' }],
      supplementLogs: [{ id: 'l1', supplementId: 'mag1', date: '2026-10-01' }],
      habits: [{ id: 'alcohol', name: 'Alcohol' }, { id: 'caffeine-late', name: 'Caffeine after 2pm' }, { id: 'cold-plunge', name: 'Cold plunge' }],
      habitLogs: { '2026-10-01': { 'caffeine-late': true, 'cold-plunge': true } },
    }
    const out = migrate(save, 25)
    expect(out.supplements.find((x) => x.id === 'mag1')).toMatchObject({ amountUnit: 'g' })
    expect(out.supplements.find((x) => x.name === 'Phosphatidylserine')).toMatchObject({ amountUnit: 'g', slot: 'PM' })
    expect(out.supplementLogs).toEqual(save.supplementLogs)
    expect(out.habits.find((h) => h.id === 'caffeine-late').hidden).toBe(true)
    expect(out.habits.find((h) => h.id === 'cold-plunge').hidden).toBe(true)
    expect(out.habitLogs).toEqual(save.habitLogs)
    expect(out.asNeededItems.map((i) => i.short)).toEqual(['Dex', 'Temazepam', 'Valium', 'Restavit'])
  })
})

describe('from the Watch and notifications', () => {
  it('an as-needed item, the evening factors and the morning check come through the queue once', () => {
    const t0 = '2026-10-23T11:30:00.000Z'
    useStore.getState().applyNativeActions([
      { id: 'w1', type: 'logAsNeeded', at: t0, source: 'watch', payload: { refId: 'an-temazepam', amount: 10, unit: 'mg', takenAt: t0 } },
      { id: 'w1', type: 'logAsNeeded', at: t0, source: 'watch', payload: { refId: 'an-temazepam', amount: 10, unit: 'mg', takenAt: t0 } },
      { id: 'w2', type: 'logAsNeeded', at: t0, source: 'watch', payload: { refId: 'an-temazepam', amount: 0 } },
      { id: 'w3', type: 'eveningNothing', at: t0, source: 'notification', payload: { date: '2026-10-23' } },
      { id: 'w4', type: 'eveningLog', at: t0, source: 'watch', payload: { date: '2026-10-22', drinks: 2, factors: ['stress'] } },
      { id: 'w5', type: 'morningCheck', at: t0, source: 'notification', payload: { date: '2026-10-24', rested: 3, dreams: 'vivid' } },
    ])
    const s = useStore.getState()
    expect(s.asNeededLogs).toHaveLength(1)
    expect(s.asNeededLogs[0]).toMatchObject({ itemId: 'an-temazepam', amount: 10, at: t0, source: 'watch' })
    expect(s.habitLogs['2026-10-23'].stress).toBe(false)
    expect(s.eveningDetails['2026-10-23'].drinks).toBe(0)
    expect(s.habitLogs['2026-10-22']).toMatchObject({ alcohol: true, stress: true })
    expect(s.eveningDetails['2026-10-22'].drinks).toBe(2)
    expect(s.morningChecks['2026-10-24']).toMatchObject({ rested: 3, dreams: 'vivid' })
  })

  it('a variable-gram supplement ticked on the Watch uses the last amount', () => {
    useStore.setState({
      supplements: [{ id: 'mg', name: 'Magnesium glycinate', slot: 'PM', amountUnit: 'g', form: 'powder' }],
      supplementLogs: [{ id: 'x', supplementId: 'mg', date: '2026-10-20', amount: 0.4, unit: 'g', takenAt: '2026-10-20T10:00:00Z' }],
    })
    useStore.getState().applyNativeActions([{ id: 'w6', type: 'logDose', at: '2026-10-23T10:00:00.000Z', source: 'watch', payload: { kind: 'supplement', refId: 'mg', date: '2026-10-23' } }])
    const l = useStore.getState().supplementLogs.find((x) => x.date === '2026-10-23')
    expect(l).toMatchObject({ amount: 0.4, unit: 'g', takenAt: '2026-10-23T10:00:00.000Z' })
  })
})

describe('overnight data from the Watch and the iPhone', () => {
  it('the Watch summary lands on its wake date; a bad one is ignored', () => {
    useStore.setState({ nightExtras: {} })
    const summary = { start: 1, end: 2, movementMin: 6.5, positionChanges: 3, restlessPeriods: 2, indexPerHour: 0.7, series: [0, 0.2] }
    useStore.getState().applyNativeActions([
      { id: 'r1', type: 'restlessness', at: '2026-10-24T08:00:00.000Z', source: 'watch', payload: { date: '2026-10-24', restless: summary } },
      { id: 'r2', type: 'restlessness', at: '2026-10-24T08:00:00.000Z', source: 'watch', payload: { date: '2026-10-24', restless: { nope: 1 } } },
    ])
    expect(useStore.getState().nightExtras['2026-10-24'].restless).toEqual(summary)
  })

  it('a session closed after a kill replaces its open copy by id', () => {
    useStore.setState({ nightExtras: {} })
    const open = { id: 'ss-2', start: 1000, end: 5000, events: [], levels: [], loudMinutes: 0, movingMinutes: 0, lowConfidence: false, room: [], startedBy: 'shortcut', open: true }
    const closed = { ...open, open: false, recovered: true, stopReason: 'appClosed', end: 4000 }
    useStore.getState().addSoundSessions([open], () => '2026-10-24')
    useStore.getState().addSoundSessions([closed], () => '2026-10-24')
    const list = useStore.getState().nightExtras['2026-10-24'].sounds
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ recovered: true, stopReason: 'appClosed', end: 4000 })
  })

  it('the start log keeps each attempt once and the newest 200', () => {
    useStore.setState({ soundsLog: [] })
    const e = { at: 1000, kind: 'start', by: 'shortcut', result: 'blockedLocked', error: 'x' }
    useStore.getState().addSoundsLog([e, e])
    useStore.getState().addSoundsLog([e])
    expect(useStore.getState().soundsLog).toHaveLength(1)
    useStore.getState().addSoundsLog(Array.from({ length: 250 }, (_, i) => ({ at: 2000 + i, kind: 'start', by: 'app', result: 'started' })))
    expect(useStore.getState().soundsLog).toHaveLength(200)
    expect(useStore.getState().soundsLog.at(-1).at).toBe(2249)
  })

  it('Sleep sounds nights are kept once by id, under the morning they ended', () => {
    useStore.setState({ nightExtras: {} })
    const ss = { id: 'ss-1', start: 1000, end: 2000, events: [], levels: [], loudMinutes: 0, movingMinutes: 0, lowConfidence: false, room: [], startedBy: 'automation' }
    useStore.getState().addSoundSessions([ss, ss], () => '2026-10-24')
    useStore.getState().addSoundSessions([ss], () => '2026-10-24')
    expect(useStore.getState().nightExtras['2026-10-24'].sounds).toHaveLength(1)
  })
})
