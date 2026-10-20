// 3A: body data sources and chart readability. Manual body-comp logging is gone
// and the tape stays; each chart remembers its source per metric.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { PRIMARY_FIELDS, EXTRA_FIELDS, NOT_LOGGED_BY_HAND, METRIC_BY_KEY } from './metrics'
import { resolveSource } from '../body/sources'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

let useStore
beforeAll(async () => { useStore = (await import('../store/useStore')).default })

describe('manual logging', () => {
  it('weight, body fat, fat mass, lean mass and muscle mass are not typed in', () => {
    const typed = new Set([...PRIMARY_FIELDS, ...EXTRA_FIELDS])
    for (const k of ['weight', 'bodyFat', 'fatMass', 'leanMass', 'muscleMass']) {
      expect(NOT_LOGGED_BY_HAND).toContain(k)
      expect(typed.has(k)).toBe(false)
    }
  })

  it('the tape measurements are logged exactly as before', () => {
    expect(PRIMARY_FIELDS).toEqual(['waist'])
    expect(EXTRA_FIELDS).toEqual(['neck', 'chest', 'hips', 'armL', 'armR', 'forearmL', 'forearmR', 'thighL', 'thighR', 'calfL', 'calfR'])
    for (const k of [...PRIMARY_FIELDS, ...EXTRA_FIELDS]) expect(METRIC_BY_KEY[k]).toBeTruthy()
  })

  it('the log sheet is for tape only, and an entry on record keeps its values', () => {
    const sheet = src('../components/BodyTab.jsx')
    expect(sheet).toMatch(/Log tape measurement/)
    expect(sheet).not.toMatch(/Log measurement['"<]/)
    expect(sheet).toMatch(/PRIMARY_FIELDS\.map\(field\)/)
    expect(sheet).toMatch(/Kept as it was/)
  })

  it('there is no way to log a DEXA scan except its own page', () => {
    expect(src('../components/body/DexaPage.jsx')).toMatch(/Add DEXA scan/)
    expect(src('../components/body/CompositionView.jsx')).toMatch(/DEXA scans/)
  })
})

describe('chart source per metric', () => {
  it('weight defaults to Scale, body fat, fat mass and lean mass to Evolt', () => {
    expect(resolveSource('weight', ['scale', 'evolt'])).toBe('scale')
    for (const m of ['bodyFat', 'fatMass', 'leanMass']) expect(resolveSource(m, ['scale', 'evolt'])).toBe('evolt')
  })

  it('falls back to the one source that has data, and ignores a saved choice that has none', () => {
    expect(resolveSource('weight', ['evolt'])).toBe('evolt')
    expect(resolveSource('bodyFat', ['scale'])).toBe('scale')
    expect(resolveSource('weight', ['scale', 'evolt'], 'evolt')).toBe('evolt')
    expect(resolveSource('weight', ['scale'], 'evolt')).toBe('scale')
    expect(resolveSource('weight', [])).toBeNull()
  })

  it('the choice is remembered for that metric only, and survives in the store', () => {
    expect(useStore.getState().chartSources).toEqual({})
    useStore.getState().setChartSource('weight', 'evolt')
    useStore.getState().setChartSource('bodyFat', 'scale')
    const cs = useStore.getState().chartSources
    expect(cs).toEqual({ weight: 'evolt', bodyFat: 'scale' })
    expect(resolveSource('weight', ['scale', 'evolt'], cs.weight)).toBe('evolt')
    expect(resolveSource('leanMass', ['scale', 'evolt'], cs.leanMass)).toBe('evolt')
  })

  it('the old device legend is gone from the charts', () => {
    expect(src('../components/charts/TrendChart.jsx')).not.toMatch(/family-toggle|legend-device/)
    expect(() => src('../components/charts/FamilyChart.jsx')).toThrow()
  })
})
