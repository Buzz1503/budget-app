import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseScanImport, planScanImport, applyScanImport, planCounts, scanKey } from './scanImport'
import { dailySeries, familySeries, pickFamily, seriesByFamily } from './bodySeries'

const FILE = JSON.parse(readFileSync(new URL('../data/evolt_scans.json', import.meta.url), 'utf8'))

describe('parsing pepito-scan-import/v1', () => {
  it('reads all 15 Evolt scans from 23 Aug 2024 to 12 Oct 2026 with no errors', () => {
    const p = parseScanImport(FILE)
    expect(p.errors).toEqual([])
    expect(p.warnings).toEqual([])
    expect(p.entries).toHaveLength(15)
    expect(p.entries[0]).toMatchObject({ date: '2024-08-23', time: '11:07', device: 'Evolt 360', weight: 100.4 })
    expect(p.entries.at(-1)).toMatchObject({ date: '2026-10-12', time: '07:11', weight: 93.3 })
  })

  it('maps every metric to its own first-class field, status, range and segment', () => {
    const jan = parseScanImport(FILE).entries.find((e) => e.date === '2025-01-13')!
    expect(jan).toMatchObject({
      bodyFat: 37.0, fatMass: 38.0, leanMass: 64.6, skeletalMuscleMass: 35.3, protein: 12.3, mineral: 5.8,
      totalBodyWater: 46.5, icf: 31.1, icfPct: 67, ecf: 15.4, ecfPct: 33,
      subcutaneousFatMass: 30.7, subcutaneousFatPct: 29.9, visceralFatMass: 7.3, visceralFatPct: 7.1,
      visceralFatArea: 185, visceralFatLevel: 16, bmr: 1765, tee: 2718, bioAge: 41, bwiScore: 5.4,
      abdominalCircumference: 116.6, waistHipRatio: 1.02, heightCm: 170, ageAtScan: 34,
      leftArmLean: 3.65, rightLegFat: 5.49, torsoLean: 28.86,
    })
    expect(jan.status).toMatchObject({ bodyFat: 'High', visceralFatLevel: 'Over Range' })
    expect(jan.ranges).toMatchObject({ bodyFat: [15, 20], skeletalMuscleMass: [26.4, 32.3] })
    expect(jan.balance).toEqual({ upperLower: 'Balanced', leftRight: 'Balanced' })
    expect(jan.recommendations).toMatchObject({ caloriesKcal: [2165, 2265], proteinG: [162, 170] })
  })

  it('keeps skeletal muscle mass and visceral fat level apart from muscle mass and visceral fat', () => {
    const entries = parseScanImport(FILE).entries
    expect(entries.every((e) => e.muscleMass === undefined && e.visceralFat === undefined)).toBe(true)
    expect(dailySeries('muscleMass', { measurements: entries })).toEqual([])
    expect(dailySeries('visceralFat', { measurements: entries })).toEqual([])
    expect(dailySeries('skeletalMuscleMass', { measurements: entries })).toHaveLength(15)
  })

  it('rejects a wrong schema, an empty file and a scan without a date or weight', () => {
    expect(parseScanImport({ schema: 'other', scans: [] }).errors[0]).toMatch(/Expected schema/)
    expect(parseScanImport({ schema: 'pepito-scan-import/v1', scans: [] }).errors[0]).toMatch(/no scans/)
    const p = parseScanImport({ schema: 'pepito-scan-import/v1', scans: [{ date: 'x', weight_kg: 90 }, { date: '2026-01-01' }, { date: '2026-01-02', weight_kg: 90, lean_body_mass_kg: 70, fat_mass_kg: 30 }] })
    expect(p.errors).toHaveLength(2)
    expect(p.entries).toHaveLength(1)
    expect(p.warnings[0]).toMatch(/lean \+ fat does not add up/)
  })
})

describe('dedupe and replacement', () => {
  const scans = parseScanImport(FILE).entries

  it('dedupes on date, time and device: skip leaves the record alone, merge updates it', () => {
    const existing = [{ id: 'mine', date: '2026-10-12', time: '07:11', device: 'Evolt 360', source: 'scan', weight: 93.0, note: 'kept' }]
    const skip = planScanImport(existing, scans, 'skip')
    expect(planCounts(skip)).toEqual({ new: 14, replaced: 0, duplicates: 1, written: 14 })
    expect(applyScanImport(existing, skip).find((m) => m.id === 'mine')).toMatchObject({ weight: 93.0 })
    const merge = planScanImport(existing, scans, 'merge')
    const merged = applyScanImport(existing, merge).find((m) => m.id === 'mine')
    expect(merged).toMatchObject({ id: 'mine', weight: 93.3, note: 'kept', time: '07:11' })
    expect(applyScanImport(existing, merge)).toHaveLength(15)
  })

  it('an untimed 13 Jan 2025 Evolt entry is replaced by the timed import; an estimated one never is', () => {
    const existing = [
      { id: 'untimed', date: '2025-01-13', device: 'Evolt 360', source: 'scan', weight: 102.6 },
      { id: 'start', date: '2025-01-13', device: 'Evolt 360', source: 'scan', weight: 105.6, estimated: true },
    ]
    const plan = planScanImport(existing, scans, 'skip')
    expect(plan.replace.map((r) => r.existingId)).toEqual(['untimed'])
    const out = applyScanImport(existing, plan)
    expect(out.find((m) => m.id === 'untimed')).toBeUndefined()
    expect(out.find((m) => m.id === 'start')).toBeTruthy()
    expect(out.filter((m) => m.date === '2025-01-13')).toHaveLength(2)
  })

  it('importing the same file twice adds nothing the second time', () => {
    const once = applyScanImport([], planScanImport([], scans, 'skip'))
    const twice = planScanImport(once as never, scans, 'skip')
    expect(planCounts(twice).new).toBe(0)
    expect(new Set(once.map((m) => scanKey(m as never))).size).toBe(15)
  })
})

describe('source families', () => {
  const scans = parseScanImport(FILE).entries
  const withings = [
    { date: '2026-10-10', weight: 92.1, weightSource: 'Withings', bodyFatPct: 28.9 },
    { date: '2026-10-16', weight: 91.7, weightSource: 'Withings', bodyFatPct: 28.7 },
  ]
  const input = { measurements: [...scans, { id: 'm', date: '2026-10-14', weight: 92, bodyFat: 30 }], health: withings }

  it('body fat, fat mass and lean mass are one series per family (Scale and Evolt), never mixed', () => {
    const by = seriesByFamily('bodyFat', input)
    expect(Object.keys(by).sort()).toEqual(['evolt', 'scale'])
    expect(by.evolt.every((p) => p.family === 'evolt')).toBe(true)
    expect(by.evolt).toHaveLength(15)
    // a typed-in entry and Withings share one Scale line; Withings is listed with the entry on its own day
    expect(familySeries('bodyFat', input, 'scale').map((p) => [p.date, p.value])).toEqual([['2026-10-10', 28.9], ['2026-10-14', 30], ['2026-10-16', 28.7]])
    // fat mass worked out within Scale, not with an Evolt weight
    expect(familySeries('fatMass', input, 'scale').map((p) => p.value)).toEqual([26.62, 27.6, 26.32])
  })

  it('a comparison window uses Evolt with 2 or more Evolt readings in it, else Scale', () => {
    expect(pickFamily('bodyFat', input, '2025-01-13', '2026-10-19')).toBe('evolt')
    expect(pickFamily('bodyFat', input, '2026-10-01', '2026-10-19')).toBe('scale')
    expect(pickFamily('bodyFat', { measurements: [{ id: 'm', date: '2026-10-14', bodyFat: 30 }] }, '2026-10-01', '2026-10-19')).toBe('scale')
    expect(pickFamily('bodyFat', {}, '2026-10-01', '2026-10-19')).toBeNull()
  })
})
