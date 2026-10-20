import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseScanImport } from './scanImport'
import { EVOLT_START_SCAN } from './scanFields'
import { lossSplit, evoltScans, ffmi, heightFor, segmentChanges, symmetry, compareScans, projectGoal, weeklyBars, latestScanMeta } from './composition'

const scans = parseScanImport(JSON.parse(readFileSync(new URL('../data/evolt_scans.json', import.meta.url), 'utf8'))).entries
const all = [...scans, EVOLT_START_SCAN]

describe('what you have lost', () => {
  it('first Evolt scan on or after 13 Jan 2025 against the latest: 102.6 to 93.3 kg, 8.5 fat, 0.8 lean, 91% fat', () => {
    const s = lossSplit(all, '2025-01-13')!
    expect(s.from).toMatchObject({ date: '2025-01-13', weight: 102.6, estimated: false })
    expect(s.to).toMatchObject({ date: '2026-10-12', weight: 93.3 })
    expect(s).toMatchObject({ weight: -9.3, fat: -8.5, lean: -0.8, fatShare: 91 })
    expect(s.lines).toEqual(['Down 9.3 kg since 13 Jan 2025.', '8.5 kg fat, 0.8 kg lean.', '91% of the loss was fat.'])
  })

  it('against the adjusted starting scan it is an estimate', () => {
    const s = lossSplit(all, '2025-01-13', EVOLT_START_SCAN)!
    expect(s.from.estimated).toBe(true)
    expect(s).toMatchObject({ weight: -12.3, fat: -10.9, lean: -1.4, fatShare: 89 })
  })

  it('a gain, or lean mass rising, is said plainly; one scan or none gives nothing', () => {
    const up = lossSplit([
      { id: 'a', date: '2025-01-01', source: 'scan', device: 'Evolt 360', weight: 90, fatMass: 30, leanMass: 60 },
      { id: 'b', date: '2025-03-01', source: 'scan', device: 'Evolt 360', weight: 88, fatMass: 27, leanMass: 61 },
    ], '2025-01-01')!
    expect(up.lines[1]).toBe('3.0 kg less fat, and lean mass rose 1.0 kg.')
    expect(up.fatShare).toBeNull()
    expect(lossSplit([scans[0]], '2024-01-01')).toBeNull()
    expect(lossSplit([], '2024-01-01')).toBeNull()
  })

  it('only real Evolt scans count: the estimated start and hidden entries are left out', () => {
    expect(evoltScans(all)).toHaveLength(15)
  })
})

describe('FFMI, segments and symmetry', () => {
  it('FFMI is lean kg over height in metres squared', () => {
    expect(ffmi(63.8, 170)).toBe(22.1)
    expect(ffmi(null, 170)).toBeNull()
    expect(heightFor(null, all)).toBe(170)
    expect(heightFor(182, all)).toBe(182)
  })

  it('segment change since the first scan, coloured by meaning, under 0.1 kg neutral', () => {
    const fat = segmentChanges(all, 'Fat')
    const torso = fat.find((s) => s.key === 'torso')!
    expect(torso).toMatchObject({ first: 21.17, latest: 17.24, delta: -3.93, tone: 'good' })
    const lean = segmentChanges(all, 'Lean')
    expect(lean.find((s) => s.key === 'leftArm')).toMatchObject({ first: 3.65, latest: 3.58, delta: -0.07, tone: 'neutral' })
    expect(lean.find((s) => s.key === 'leftLeg')).toMatchObject({ delta: 0.19, tone: 'good' })
  })

  it('left against right as a percentage of their average', () => {
    const s = symmetry(scans.at(-1))
    expect(s.arms.lean).toBe(-3.8)
    expect(s.legs.fat).toBe(6.4)
    expect(symmetry(null).arms.lean).toBeNull()
  })
})

describe('scan compare', () => {
  it('lists every shared metric and segment, biggest relative change first', () => {
    const rows = compareScans(scans[0], scans.at(-1)!)
    expect(rows.length).toBeGreaterThan(30)
    expect(rows[0].pct).toBeGreaterThanOrEqual(rows[1].pct)
    expect(rows.every((r, i) => i === 0 || rows[i - 1].pct >= r.pct)).toBe(true)
    const fat = rows.find((r) => r.key === 'fatMass')!
    expect(fat).toMatchObject({ a: 36.6, b: 29.5, diff: -7.1 })
  })
})

describe('goal projection', () => {
  const falling = Array.from({ length: 28 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, value: 95 - i * 0.1 }))

  it('projects the date at the pace of the last 28 days', () => {
    const p = projectGoal(falling, 90, '2026-09-28')!
    expect(p.status).toBe('toward')
    expect(p.perWeek).toBeCloseTo(-0.7, 6)
    expect(p.date).toBe('2026-10-21') // 92.3 kg to 90 kg at 0.1 kg a day: 23 days
    expect(p.words).toMatch(/estimate/)
  })

  it('says so when the trend runs the other way, and needs a few readings', () => {
    expect(projectGoal(falling, 99, '2026-09-28')).toMatchObject({ status: 'away', words: 'Not trending toward your goal at the moment.' })
    expect(projectGoal(falling.slice(0, 2), 90, '2026-09-28')?.status).toBe('insufficient')
    expect(projectGoal(falling, null, '2026-09-28')).toBeNull()
  })
})

describe('weekly change bars and scan meta', () => {
  it('twelve Monday-to-Sunday weeks, each against the week before', () => {
    const series = Array.from({ length: 100 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 12 + i)).toISOString().slice(0, 10)
      return { date: d, value: 95 - i * 0.05 }
    })
    const bars = weeklyBars(series, '2026-10-19')
    expect(bars).toHaveLength(12)
    expect(bars.at(-1)!.weekStart).toBe('2026-10-19')
    expect(bars[5].change).toBeCloseTo(-0.35, 2)
  })

  it('a week with fewer than two weigh-ins is an empty slot, not a bar', () => {
    const series = [
      { date: '2026-10-05', value: 93 }, { date: '2026-10-07', value: 93 }, // week of 5 Oct
      { date: '2026-10-12', value: 92.4 },                                  // one weigh-in only
      { date: '2026-10-19', value: 92 }, { date: '2026-10-19', value: 92 },
    ]
    const bars = weeklyBars(series, '2026-10-19')
    expect(bars).toHaveLength(12)
    const wk = (d: string) => bars.find((b) => b.weekStart === d)!
    expect(wk('2026-10-12')).toMatchObject({ count: 1, change: null })
    expect(wk('2026-10-05').count).toBe(2)
    expect(wk('2026-10-05').change).toBeNull() // nothing the week before to compare with
    expect(wk('2026-10-19').change).toBeCloseTo(-0.4, 5)
    expect(wk('2026-09-14')).toMatchObject({ count: 0, mean: null, change: null })
  })

  it('the latest scan status and reference range for a field', () => {
    expect(latestScanMeta(all, 'bodyFat')).toEqual({ status: 'High', range: [15, 20], date: '2026-10-12' })
    expect(latestScanMeta(all, 'bmr')).toEqual({ status: null, range: null, date: '2026-10-12' })
  })
})
