// The user's own Health entries (settings, check-ins, habits) travel with the
// app backup; the Health cache, rebuilt from Apple Health, does not.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}
// FileReader for blob encoding in the backup (node has none)
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`
      this.onload?.()
    })
  }
}

let useStore
let buildBackup
let HealthDB

beforeAll(async () => {
  useStore = (await import('../store/useStore')).default
  buildBackup = (await import('../lib/backup')).buildBackup
  HealthDB = (await import('./cache')).HealthDB
})

describe('health settings, check-ins and habits in the store', () => {
  it('target wake time resets to auto (null) and stays null after the app is reopened', async () => {
    const { setHealthSettings } = useStore.getState()
    setHealthSettings({ wakeTarget: '06:30' })
    expect(useStore.getState().healthSettings.wakeTarget).toBe('06:30')
    setHealthSettings({ wakeTarget: null })
    const saved = JSON.parse(globalThis.localStorage.getItem('peptide-command-center')).state.healthSettings
    expect(saved.wakeTarget).toBeNull()
    useStore.setState({ healthSettings: { ...useStore.getState().healthSettings, wakeTarget: 'stale' } }, false)
    globalThis.localStorage.setItem('peptide-command-center', JSON.stringify({ state: { ...JSON.parse(globalThis.localStorage.getItem('peptide-command-center')).state, healthSettings: saved }, version: useStore.persist.getOptions().version }))
    await useStore.persist.rehydrate()
    expect(useStore.getState().healthSettings.wakeTarget).toBeNull()
  })

  it('has sensible defaults', () => {
    const s = useStore.getState()
    expect(s.healthSettings).toMatchObject({ connected: false, sleepNeedH: 8, maxHR: null, checkinEnabled: true })
    expect(s.healthSettings.sleepPriority[0]).toBe('watch')
    // the Sleep Lab evening factors (v26); caffeine, late meal and cold plunge are no longer defaults
    expect(s.habits.map((h) => h.name)).toEqual(['Alcohol', 'Screen in bed', 'Stressful day', 'Unwell', 'Pain', 'Room too hot', 'Slept away from home', 'Woken by someone'])
  })

  it('a check-in is one 1–5 answer per item per day; tapping it again clears it', () => {
    const { setCheckin } = useStore.getState()
    setCheckin('2026-10-17', 'energy', 4)
    setCheckin('2026-10-17', 'mood', 3)
    expect(useStore.getState().checkins['2026-10-17']).toEqual({ energy: 4, mood: 3 })
    setCheckin('2026-10-17', 'energy', 4)
    expect(useStore.getState().checkins['2026-10-17']).toEqual({ mood: 3 })
    setCheckin('2026-10-17', 'mood', 3)
    expect(useStore.getState().checkins['2026-10-17']).toBeUndefined()
  })

  it('habits: yes, no or unanswered per day; add, rename, remove', () => {
    const s = useStore.getState()
    s.setHabit('2026-10-17', 'alcohol', true)
    s.setHabit('2026-10-17', 'stress', false)
    expect(useStore.getState().habitLogs['2026-10-17']).toEqual({ alcohol: true, stress: false })
    s.setHabit('2026-10-17', 'stress', null)
    expect(useStore.getState().habitLogs['2026-10-17']).toEqual({ alcohol: true })
    const id = s.addHabit('  Sauna  ')
    expect(useStore.getState().habits.at(-1)).toEqual({ id, name: 'Sauna' })
    s.renameHabit(id, 'Hot bath')
    expect(useStore.getState().habits.at(-1).name).toBe('Hot bath')
    s.removeHabit('alcohol')
    expect(useStore.getState().habits.find((h) => h.id === 'alcohol')).toBeUndefined()
    expect(useStore.getState().habitLogs['2026-10-17']).toBeUndefined()
    expect(s.addHabit('   ')).toBeNull()
  })

  it('a compound can be flagged as affecting the recovery baseline', () => {
    const p = useStore.getState().peptides[0]
    useStore.getState().setAffectsRecoveryBaseline(p.id, true)
    expect(useStore.getState().peptides[0].affectsRecoveryBaseline).toBe(true)
  })

  it('overlay choices are kept per chart type', () => {
    useStore.getState().setChartOverlay('hrv', { ticks: true })
    useStore.getState().setChartOverlay('hrv', { compounds: ['retatrutide'] })
    expect(useStore.getState().healthSettings.overlays.hrv).toEqual({ ticks: true, compounds: ['retatrutide'] })
  })
})

describe('backup', () => {
  it('includes settings, check-ins and habits, and leaves the Health cache out', async () => {
    useStore.getState().setCheckin('2026-10-18', 'drive', 5)
    useStore.getState().setHealthSettings({ sleepNeedH: 7.5 })
    const db = new HealthDB()
    await db.healthDaily.put({ date: '2026-10-18', restingHR: 51.7, weight: 87.65 })
    const bundle = await buildBackup()
    const state = bundle.appState.state
    expect(state.checkins['2026-10-18']).toEqual({ drive: 5 })
    expect(state.healthSettings.sleepNeedH).toBe(7.5)
    expect(state.habits.length).toBeGreaterThan(0)
    const text = JSON.stringify(bundle)
    expect(text).not.toContain('87.65')
    expect(text).not.toContain('healthDaily')
    expect(Object.keys(bundle.blobs)).toEqual([])
  })
})
