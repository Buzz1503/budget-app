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

describe('v22 migration', () => {
  const migrate = () => useStore.persist.getOptions().migrate

  it('imports the 15 Evolt scans, replaces the untimed 13 Jan copy, and makes the hidden adjusted scan the start', () => {
    const v21 = {
      measurements: [
        { id: 'x', date: '2026-01-01', weight: 99 },
        { id: scan.EVOLT_ORIGINAL_ID, date: '2025-01-13', source: 'scan', device: 'Evolt 360', weight: 102.6, hiddenFromCharts: true, extras: { bmr: 1765 } },
      ],
      healthSettings: { wakeTarget: '13:50', sleepNeedH: 8 },
    }
    const out = migrate()(v21, 21)
    const scans = out.measurements.filter((m) => m.source === 'scan' && !m.estimated)
    expect(scans).toHaveLength(15)
    expect(scans[0].date).toBe('2024-08-23')
    expect(scans.at(-1).date).toBe('2026-10-12')
    expect(out.measurements.find((m) => m.id === scan.EVOLT_ORIGINAL_ID)).toBeUndefined()
    const jan = scans.find((m) => m.date === '2025-01-13')
    expect(jan).toMatchObject({ time: '02:23', weight: 102.6, skeletalMuscleMass: 35.3, torsoFat: 21.84 })
    expect(jan.hiddenFromCharts).toBeUndefined()
    const start = out.measurements.find((m) => m.id === scan.EVOLT_START_ID)
    expect(start).toMatchObject({ estimated: true, hiddenFromCharts: true, weight: 105.6, totalBodyWater: 47.0, bmr: 1779, torsoFat: 21.84 })
    expect(out.bodyStart).toMatchObject({ date: '2025-01-13', label: 'Start (adjusted to 105.6 kg)', entryId: scan.EVOLT_START_ID, device: 'Evolt 360' })
    expect(out.bodyStart.values.muscleMass).toBeUndefined()
    expect(out.bodyStart.values.skeletalMuscleMass).toBe(35.6)
    expect(out.measurements.find((m) => m.id === 'x')).toEqual({ id: 'x', date: '2026-01-01', weight: 99 })
    // the wake target stored by mistake is cleared
    expect(out.healthSettings.wakeTarget).toBeNull()
  })

  it('runs once: scans already there are not duplicated, a chosen start and a sensible wake time are kept', () => {
    const first = migrate()({ measurements: [] }, 20)
    const again = migrate()({ ...first, bodyStart: { date: '2025-06-01', values: {} }, healthSettings: { wakeTarget: '06:45' } }, 21)
    expect(again.measurements.filter((m) => m.source === 'scan' && !m.estimated)).toHaveLength(15)
    expect(again.measurements.filter((m) => m.id === scan.EVOLT_START_ID)).toHaveLength(1)
    expect(again.bodyStart.date).toBe('2025-06-01')
    expect(again.healthSettings.wakeTarget).toBe('06:45')
  })
})
