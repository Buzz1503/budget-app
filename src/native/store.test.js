// Queued native actions run through the same store logic as an in-app tap.
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

const pep = {
  id: 'reta', name: 'Retatrutide', frequency: 'daily', startDate: '2026-01-01', slot: 'AM', route: 'SubQ',
  ladder: { floor: 3, step: 0, ceiling: 3, intervalWeeks: 4, unit: 'mg' }, recon: { vialMg: 20, bacMl: 2 },
}
const bpc = { ...pep, id: 'bpc157', name: 'BPC-157', ladder: { floor: 250, step: 0, ceiling: 250, intervalWeeks: 4, unit: 'mcg' }, recon: { vialMg: 5, bacMl: 2 } }

beforeEach(() => {
  useStore.setState({
    peptides: [pep, bpc],
    titration: {},
    doseLogs: [],
    injectionRecords: [],
    skips: [],
    pushes: [],
    vials: [],
    openVials: { reta: { remainingMg: 20 }, bpc157: { remainingMg: 5 } },
    saunaSessions: [],
    saunaTimer: null,
    nativeState: { processedActionIds: [], stockAlerted: [], lastWatchSync: null },
  })
})

describe('applyNativeActions', () => {
  it('a widget tick logs the dose and moves the open vial, once', () => {
    const t = todayStr()
    const a = { id: 'w1', type: 'logDose', at: new Date().toISOString(), source: 'widget', payload: { refId: 'reta', date: t } }
    useStore.getState().applyNativeActions([a])
    const s = useStore.getState()
    expect(s.doseLogs).toHaveLength(1)
    expect(s.doseLogs[0]).toMatchObject({ peptideId: 'reta', date: t, doseValue: 3, insulinUnits: 30, loggedAt: a.at })
    expect(s.openVials.reta.remainingMg).toBe(17)
    // the same queue drained again (an app relaunch) changes nothing
    useStore.getState().applyNativeActions([a])
    expect(useStore.getState().doseLogs).toHaveLength(1)
    expect(useStore.getState().nativeState.processedActionIds).toContain('w1')
  })

  it('a draw-together group from the Watch is one co-draw', () => {
    const t = todayStr()
    useStore.getState().applyNativeActions([{ id: 'g1', type: 'logDose', at: new Date().toISOString(), source: 'watch', payload: { refIds: ['reta', 'bpc157'], group: true, date: t } }])
    const logs = useStore.getState().doseLogs
    expect(logs).toHaveLength(2)
    expect(logs[0].coDrawId).toBeTruthy()
    expect(logs[0].coDrawId).toBe(logs[1].coDrawId)
  })

  it('a Watch sauna becomes a session with its heart rate, never offered as "Was this a sauna?"', () => {
    const start = Date.now() - 30 * 60000
    useStore.getState().applyNativeActions([{
      id: 's1', type: 'saunaCompleted', at: new Date().toISOString(), source: 'watch',
      payload: { start, end: start + 25 * 60000, tempC: 70, rounds: 2, avgHR: 110, peakHR: 140, samples: [[start / 1000, 100], [start / 1000 + 5, 104]], workoutId: 'hk-1' },
    }])
    const [s] = useStore.getState().saunaSessions
    expect(s).toMatchObject({ source: 'watch', workoutId: 'hk-1', lengthMin: 25, tempC: 70, rounds: 2 })
    expect(s.hr).toMatchObject({ avg: 110, peak: 140 })
    expect(s.hr.samples).toHaveLength(2)
  })

  it('a session never stopped is saved at two hours and marked for review', () => {
    const startedAt = Date.now() - 5 * 3600000
    useStore.getState().applyNativeActions([
      { id: 'x1', type: 'startSauna', at: new Date(startedAt).toISOString(), source: 'widget', payload: { startedAt, targetMin: 20, tempC: 60 } },
      { id: 'x2', type: 'stopSauna', at: new Date().toISOString(), source: 'widget', payload: { stoppedAt: Date.now(), autoEnded: true } },
    ])
    const [s] = useStore.getState().saunaSessions
    expect(s.lengthMin).toBe(120)
    expect(s.needsReview).toBe(true)
    expect(useStore.getState().saunaTimer).toBeNull()
  })
})
