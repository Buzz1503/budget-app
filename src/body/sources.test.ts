import { describe, it, expect } from 'vitest'
import { familyOfEntry, isScanEntry, migrateSourceFamilies, dexaScans, resolveSource, SCALE_RANK } from './sources'
import { moveStartEntry } from './scanHistory'
import { EVOLT_START_ID, EVOLT_START_LEGACY_IDS, EVOLT_START_SCAN } from './scanFields'
import { dailySeries, familySeries, seriesByFamily } from './bodySeries'
import { entryValues } from './startPoint'

const manual = { id: 'm1', date: '2026-03-01', weight: 95, bodyFat: 30, waist: 104 }
const evolt = { id: 'e1', date: '2026-10-12', source: 'scan', device: 'Evolt 360', weight: 93.3, bodyFat: 31.6 }
const dexa = { id: 'd1', date: '2026-05-24', source: 'scan', device: 'DEXA', weight: 98.6, bodyFat: 31.2 }
const inbody = { id: 'i1', date: '2025-06-01', source: 'scan', device: 'InBody', weight: 92, bodyFat: 28 }
const unnamed = { id: 'u1', date: '2025-07-01', source: 'scan', weight: 91 }
const deviceOnly = { id: 'v1', date: '2025-08-01', device: 'DEXA', weight: 90 } // the scan box was never ticked

describe('source families', () => {
  it('Evolt scans are Evolt, every other scan is DEXA, everything else is Scale', () => {
    expect(familyOfEntry(manual)).toBe('scale')
    expect(familyOfEntry(evolt)).toBe('evolt')
    expect(familyOfEntry(EVOLT_START_SCAN)).toBe('evolt')
    for (const e of [dexa, inbody, unnamed, deviceOnly]) expect(familyOfEntry(e)).toBe('dexa')
    expect(isScanEntry(deviceOnly)).toBe(true)
    expect(isScanEntry(manual)).toBe(false)
  })

  it('the migration stamps every entry, keeps its original source, lists what moved to DEXA, and changes no value', () => {
    const list = [manual, evolt, dexa, inbody, unnamed, { id: 'm2', date: '2026-03-02', source: 'manual', waist: 103 }]
    const out = migrateSourceFamilies(list)
    expect(out.dexa.map((e) => e.id)).toEqual(['d1', 'i1', 'u1'])
    expect(out.scale).toBe(2)
    expect(out.evolt).toBe(1)
    expect(out.measurements.find((m) => m.id === 'm1')).toEqual({ ...manual, family: 'scale', originalSource: 'manual' })
    expect(out.measurements.find((m) => m.id === 'd1')).toEqual({ ...dexa, family: 'dexa', originalSource: 'scan' })
    // nothing deleted, no number changed
    expect(out.measurements).toHaveLength(list.length)
    // running it again changes nothing
    expect(migrateSourceFamilies(out.measurements).measurements).toEqual(out.measurements)
  })

  it('DEXA is in no series and no family, and is found on its own', () => {
    const input = { measurements: [manual, evolt, dexa], health: [{ date: '2026-10-16', weight: 91.7, weightSource: 'Withings', bodyFatPct: 28.7 }] }
    expect(dailySeries('weight', input).map((p) => p.date)).toEqual(['2026-03-01', '2026-10-12', '2026-10-16'])
    expect(dailySeries('bodyFat', input).some((p) => p.value === 31.2)).toBe(false)
    expect(Object.keys(seriesByFamily('weight', input)).sort()).toEqual(['evolt', 'scale'])
    expect(familySeries('weight', input, 'dexa')).toEqual([])
    expect(dexaScans([evolt, dexa, inbody]).map((e) => e.id)).toEqual(['i1', 'd1'])
  })

  it('Scale: Withings, then typed in, then other apps on the same day; Withings and typed-in weights share one line', () => {
    expect(SCALE_RANK.withings).toBeGreaterThan(SCALE_RANK.manual)
    expect(SCALE_RANK.manual).toBeGreaterThan(SCALE_RANK.other)
    const day = '2026-03-01'
    const input = { measurements: [{ id: 'a', date: day, weight: 95 }], health: [{ date: day, weight: 94, weightSource: 'Withings' }, { date: day, weight: 96, weightSource: 'MyFitnessPal' }] }
    expect(familySeries('weight', input, 'scale')).toMatchObject([{ value: 94, source: 'withings' }])
    expect(familySeries('weight', { measurements: input.measurements, health: [input.health[1]] }, 'scale')).toMatchObject([{ value: 95, source: 'manual' }])
    expect(familySeries('weight', { health: [input.health[1]] }, 'scale')).toMatchObject([{ value: 96, source: 'other', sourceLabel: 'MyFitnessPal' }])
  })
})

describe('chart source choice', () => {
  it('defaults: weight shows Scale; body fat, fat mass, lean mass and the rest show Evolt', () => {
    expect(resolveSource('weight', ['scale', 'evolt'])).toBe('scale')
    for (const m of ['bodyFat', 'fatMass', 'leanMass']) expect(resolveSource(m, ['scale', 'evolt'])).toBe('evolt')
  })
  it('only sources with data are offered, and a saved choice wins while it still has data', () => {
    expect(resolveSource('bodyFat', ['scale'])).toBe('scale')
    expect(resolveSource('weight', ['evolt'])).toBe('evolt')
    expect(resolveSource('bodyFat', ['scale', 'evolt'], 'scale')).toBe('scale')
    expect(resolveSource('weight', ['scale', 'evolt'], 'evolt')).toBe('evolt')
    expect(resolveSource('weight', ['scale'], 'evolt')).toBe('scale') // the remembered source has nothing now
    expect(resolveSource('weight', [])).toBeNull()
  })
})

describe('moving the estimated start to 1 Jan 2025', () => {
  const legacy = { ...EVOLT_START_SCAN, id: EVOLT_START_LEGACY_IDS[0], date: '2025-01-13', label: 'Start (adjusted to 105.6 kg)', hiddenFromCharts: true }
  const realScan = { id: 'real', date: '2025-01-13', source: 'scan', device: 'Evolt 360', weight: 102.6 }

  it('replaces the 13 Jan entry with the 1 Jan one (same values, on the charts), and the start follows it', () => {
    const start = { date: '2025-01-13', label: legacy.label, values: entryValues(legacy), entryId: legacy.id, device: 'Evolt 360' }
    const out = moveStartEntry([legacy, realScan, manual], start)
    expect(out.moved).toBe(true)
    expect(out.measurements.filter((m) => EVOLT_START_LEGACY_IDS.includes(m.id))).toHaveLength(0)
    const next = out.measurements.find((m) => m.id === EVOLT_START_ID)!
    expect(next).toMatchObject({ date: '2025-01-01', label: 'Start (estimated)', estimated: true, weight: 105.6, bodyFat: 38.3, fatMass: 40.4, leanMass: 65.2, visceralFatLevel: 16, bmr: 1779 })
    expect(next.hiddenFromCharts).toBeUndefined()
    expect(out.bodyStart).toMatchObject({ date: '2025-01-01', entryId: EVOLT_START_ID, label: 'Start (estimated)', device: 'Evolt 360' })
    // the real scan from that morning and every other entry are untouched
    expect(out.measurements.find((m) => m.id === 'real')).toEqual(realScan)
    expect(out.measurements.map((m) => m.date)).toEqual(['2025-01-01', '2025-01-13', '2026-03-01'])
  })

  it('a start chosen by hand stays; a deleted start stays deleted; running twice changes nothing', () => {
    const chosen = { date: '2025-06-01', values: {}, entryId: null, device: null }
    expect(moveStartEntry([legacy], chosen).bodyStart).toEqual(chosen)
    expect(moveStartEntry([realScan], chosen)).toEqual({ measurements: [realScan], bodyStart: chosen, moved: false })
    const once = moveStartEntry([legacy], null)
    expect(moveStartEntry(once.measurements, once.bodyStart).moved).toBe(false)
  })
})
