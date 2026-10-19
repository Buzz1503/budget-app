// The starting point lives in the store (and so in the backup), and the v21
// migration puts the 13 Jan 2025 Evolt scans in place and makes the adjusted
// one the start.
import { describe, it, expect, beforeAll } from 'vitest'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}

let useStore
let scan
beforeAll(async () => {
  useStore = (await import('../store/useStore')).default
  scan = await import('../body/scanFields')
})

describe('starting point in the store', () => {
  it('defaults to unset, can be set from values or an entry, and resets to the default', () => {
    const s = useStore.getState()
    expect(s.bodyStart).toBeNull()
    s.setBodyStart({ date: '2025-01-13', label: 'Start', values: { weight: 105.6, bodyFat: '', waist: null }, entryId: 'm1', device: 'Evolt 360' })
    expect(useStore.getState().bodyStart).toEqual({ date: '2025-01-13', label: 'Start', values: { weight: 105.6 }, entryId: 'm1', device: 'Evolt 360' })
    const saved = JSON.parse(globalThis.localStorage.getItem('peptide-command-center')).state
    expect(saved.bodyStart.values.weight).toBe(105.6) // persisted, so in the backup
    s.resetBodyStart()
    expect(useStore.getState().bodyStart).toBeNull()
  })

  it('a second scan on the same day from the same device kept off the charts does not replace the first', () => {
    const s = useStore.getState()
    s.addMeasurement({ date: '2025-01-13', source: 'scan', device: 'Evolt 360', weight: 105.6 })
    s.addMeasurement({ date: '2025-01-13', source: 'scan', device: 'Evolt 360', weight: 102.6, hiddenFromCharts: true })
    expect(useStore.getState().measurements.filter((m) => m.date === '2025-01-13')).toHaveLength(2)
  })
})

describe('v21 migration', () => {
  const migrate = () => useStore.persist.getOptions().migrate

  it('adds the adjusted and the original Evolt scan and sets the adjusted one as the start', () => {
    const out = migrate()({ measurements: [{ id: 'x', date: '2026-01-01', weight: 99 }] }, 20)
    const ids = out.measurements.map((m) => m.id)
    expect(ids).toEqual([scan.EVOLT_START_ID, scan.EVOLT_ORIGINAL_ID, 'x'])
    const original = out.measurements.find((m) => m.id === scan.EVOLT_ORIGINAL_ID)
    expect(original).toMatchObject({ hiddenFromCharts: true, label: 'Original scan, not used as start', weight: 102.6 })
    expect(out.bodyStart).toMatchObject({ date: '2025-01-13', label: 'Start (adjusted to 105.6 kg)', entryId: scan.EVOLT_START_ID, device: 'Evolt 360' })
    expect(out.bodyStart.values).toMatchObject({ weight: 105.6, bodyFat: 38.3, fatMass: 40.4, leanMass: 65.2, skeletalMuscleMass: 35.6, visceralFatLevel: 16 })
    expect(out.bodyStart.values.muscleMass).toBeUndefined()
  })

  it('runs once: entries already there are not duplicated, a chosen start is kept', () => {
    const first = migrate()({ measurements: [] }, 20)
    const again = migrate()({ ...first, bodyStart: { date: '2025-06-01', values: {} } }, 20)
    expect(again.measurements.filter((m) => m.id === scan.EVOLT_START_ID)).toHaveLength(1)
    expect(again.bodyStart.date).toBe('2025-06-01')
  })
})
