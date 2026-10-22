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

  it('imports the 15 Evolt scans, replaces the untimed 13 Jan copy, and makes the estimated 1 Jan 2025 entry the start', () => {
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
    expect(start).toMatchObject({ date: '2025-01-01', estimated: true, label: 'Start (estimated)', weight: 105.6, totalBodyWater: 47.0, bmr: 1779, torsoFat: 21.84 })
    expect(start.hiddenFromCharts).toBeUndefined()
    expect(out.bodyStart).toMatchObject({ date: '2025-01-01', label: 'Start (estimated)', entryId: scan.EVOLT_START_ID, device: 'Evolt 360' })
    expect(out.bodyStart.values.muscleMass).toBeUndefined()
    expect(out.bodyStart.values.skeletalMuscleMass).toBe(35.6)
    // a typed-in entry is untouched except for the family stamp (Scale) and the source it had
    expect(out.measurements.find((m) => m.id === 'x')).toEqual({ id: 'x', date: '2026-01-01', weight: 99, family: 'scale', originalSource: 'manual' })
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

describe('v23 migration', () => {
  const migrate = () => useStore.persist.getOptions().migrate

  it('a v22 save: the start moves to 1 Jan 2025, every entry joins a family, nothing is deleted', () => {
    const legacy = { ...scan.EVOLT_START_SCAN, id: scan.EVOLT_START_LEGACY_IDS[0], date: '2025-01-13', label: 'Start (adjusted to 105.6 kg)', hiddenFromCharts: true }
    const v22 = {
      measurements: [
        { id: 'w1', date: '2026-03-01', weight: 95, waist: 104 },
        { id: 'dx', date: '2026-05-24', source: 'scan', device: 'DEXA', weight: 98.6, bodyFat: 31.2 },
        { id: 'ev', date: '2026-10-12', source: 'scan', device: 'Evolt 360', weight: 93.3 },
        legacy,
      ],
      bodyStart: { date: '2025-01-13', label: legacy.label, values: { weight: 105.6 }, entryId: legacy.id, device: 'Evolt 360' },
    }
    const out = migrate()(v22, 22)
    expect(out.measurements).toHaveLength(4)
    const byId = Object.fromEntries(out.measurements.map((m) => [m.id, m]))
    expect(byId.w1).toMatchObject({ family: 'scale', originalSource: 'manual', weight: 95, waist: 104 })
    expect(byId.dx).toMatchObject({ family: 'dexa', originalSource: 'scan', weight: 98.6, bodyFat: 31.2 })
    expect(byId.ev).toMatchObject({ family: 'evolt', originalSource: 'scan' })
    expect(byId[scan.EVOLT_START_ID]).toMatchObject({ date: '2025-01-01', family: 'evolt', estimated: true, label: 'Start (estimated)' })
    expect(byId[legacy.id]).toBeUndefined()
    expect(out.bodyStart).toMatchObject({ date: '2025-01-01', entryId: scan.EVOLT_START_ID })
    // a second pass is a no-op
    expect(migrate()(out, 25)).toBe(out)
  })
})
