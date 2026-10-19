// Stage 2D cleanup: removed screens are unreachable, but everything they stored
// stays in the store and in the backup; needles remember the last choice; the
// low-stock dot.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { lowStockItems, showLowStockDot } from './lowStock'
import { cleanNeedle, lastNeedle, rememberNeedle, gaugeOptions, lengthOptions, NEEDLE_GAUGES } from './needle'
import { captureFor } from './injectionCapture'
import { addDaysStr } from './schedule'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}

let useStore
let buildBackup
beforeAll(async () => {
  useStore = (await import('../store/useStore')).default
  buildBackup = (await import('./backup')).buildBackup
})

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('removed features are not reachable', () => {
  const app = src('../App.jsx')
  const more = src('../components/MoreHub.jsx')
  const screens = app.slice(app.indexOf('const SCREENS = {'), app.indexOf('}', app.indexOf('const SCREENS = {')))

  it('no screen for Symptoms or Supplies, and old links land elsewhere', () => {
    expect(screens).not.toMatch(/\bsymptoms:/)
    expect(screens).not.toMatch(/\bgear:/)
    expect(screens).toMatch(/\breactions: ReactionsScreen/)
    expect(app).toMatch(/symptoms: 'reactions', gear: 'more'/)
    expect(app).not.toMatch(/SymptomsTab|GearTab/)
  })

  it('tabs are Home, Body, Sleep, Sauna, More; More starts Calendar, Reactions, Bloods, Stock', () => {
    const tabs = [...app.slice(app.indexOf('const PRIMARY = ['), app.indexOf(']\nconst PRIMARY_IDS')).matchAll(/label: '(\w+)'/g)].map((m) => m[1])
    expect(tabs).toEqual(['Home', 'Body', 'Sleep', 'Sauna', 'More'])
    const rows = [...more.matchAll(/\{ id: '(\w+)', label: '([^']+)'/g)].map((m) => m[2])
    expect(rows.slice(0, 4)).toEqual(['Calendar', 'Reactions', 'Bloods', 'Stock'])
    expect(rows).not.toContain('Symptoms')
    expect(rows).not.toContain('Supplies')
  })

  it('no Training segment in Body, and no check-in in the compare outcomes', () => {
    expect(src('../components/BodyTab.jsx')).not.toMatch(/id: 'training'/)
    expect(src('../health/engine/model.ts')).not.toMatch(/checkin:/)
    expect(src('../components/health/HomeHealthCard.jsx')).not.toMatch(/Checkin|check-in/)
    expect(src('../components/health/DayHealth.jsx')).not.toMatch(/CheckinRows/)
  })
})

describe('stored data is kept', () => {
  it('symptom check-ins, the daily check-in and Supplies items stay in the store and the backup', async () => {
    useStore.setState({
      symptomLogs: [{ id: 's1', date: '2026-10-01', tags: [{ id: 'nausea', severity: 'mild' }] }],
      checkins: { '2026-10-01': { energy: 4, mood: 3 } },
      gearItems: [{ id: 'g1', category: 'Syringe needles', gauge: '31G', lengthMm: 8, status: 'in_use' }],
    })
    const state = (await buildBackup()).appState.state
    expect(state.symptomLogs).toHaveLength(1)
    expect(state.checkins['2026-10-01']).toEqual({ energy: 4, mood: 3 })
    expect(state.gearItems[0].gauge).toBe('31G')
  })
})

describe('needles remember the last values used', () => {
  it('a needle is a gauge and a length, or nothing', () => {
    expect(cleanNeedle({ gauge: '31G', lengthMm: '8' })).toEqual({ gauge: '31G', lengthMm: 8 })
    expect(cleanNeedle({ gauge: '31G' })).toBeNull()
    expect(lastNeedle({})).toBeNull()
  })

  it('choosing one makes it the default; clearing one keeps the default', () => {
    const s1 = rememberNeedle({ currency: 'AUD' }, { gauge: '30G', lengthMm: 8 })
    expect(lastNeedle(s1)).toEqual({ gauge: '30G', lengthMm: 8 })
    expect(rememberNeedle(s1, null)).toBe(s1)
    expect(captureFor({ peptide: { route: 'SubQ' }, lastNeedle: lastNeedle(s1) }).needle).toEqual({ gauge: '30G', lengthMm: 8 })
  })

  it('an older value on a record stays pickable', () => {
    expect(gaugeOptions('26G')).toEqual([...NEEDLE_GAUGES, '26G'])
    expect(lengthOptions(12.7)).toContain(12.7)
  })

  it('the store remembers a needle picked on a record, and the next injection starts from it', () => {
    const st = useStore.getState()
    useStore.setState({ settings: { ...st.settings, lastNeedle: undefined }, injectionRecords: [] })
    const first = useStore.getState().logInjection({ peptideId: 'none', pinId: null })
    expect(first.needle).toBeNull()
    useStore.getState().updateInjectionRecord(first.id, { needle: { gauge: '31G', lengthMm: 6 } })
    expect(useStore.getState().settings.lastNeedle).toEqual({ gauge: '31G', lengthMm: 6 })
    const second = useStore.getState().logInjection({ peptideId: 'none', pinId: null })
    expect(second.needle).toEqual({ gauge: '31G', lengthMm: 6 })
  })
})

describe('low-stock dot', () => {
  const T = '2026-06-18'
  const pep = { id: 'reta', name: 'Retatrutide', startDate: addDaysStr(T, -60), frequency: 'weekly', ladder: { unit: 'mg', floor: 1, step: 0, ceiling: 1, intervalWeeks: 4 }, route: 'SubQ', recon: { vialMg: 10, bacMl: 2, expiryDays: 28 } }
  const titration = { reta: { level: 0, levelStartDate: addDaysStr(T, -60) } }
  const vials = (qty) => [{ id: 'b1', peptideId: 'reta', vialMg: 10, qtyOnHand: qty }]

  it('shows when the sealed shelf covers no more than the lead time', () => {
    // 1 mg a week: one 10 mg vial is 10 weeks, two are 20
    expect(showLowStockDot({ peptides: [pep], titration, vials: vials(1), leadDays: 70, today: T })).toBe(true)
    expect(showLowStockDot({ peptides: [pep], titration, vials: vials(2), leadDays: 70, today: T })).toBe(false)
    expect(lowStockItems({ peptides: [pep], titration, vials: [], leadDays: 30, today: T })[0].text).toBe('No sealed Retatrutide left')
  })

  it('an order arriving in time answers it; no compounds, no dot', () => {
    const restock = { delivery: { 'vial:reta': addDaysStr(T, 5) } }
    expect(lowStockItems({ peptides: [pep], titration, vials: vials(1), restock, leadDays: 70, today: T })[0].kind).toBe('ordered')
    expect(showLowStockDot({ peptides: [pep], titration, vials: vials(1), restock, leadDays: 70, today: T })).toBe(false)
    expect(showLowStockDot({ peptides: [], today: T })).toBe(false)
  })
})

describe('Home', () => {
  it('shows only readiness (iPhone app) and the log, with the sauna row unless switched off', async () => {
    const { homeSections } = await import('./homeLayout')
    expect(homeSections({ health: true, saunaOnHome: true })).toEqual(['readiness', 'log', 'sauna'])
    expect(homeSections({ health: true, saunaOnHome: false })).toEqual(['readiness', 'log'])
    expect(homeSections({ health: false })).toEqual(['log', 'sauna'])
  })

  it('no longer renders the cards that left Home', () => {
    const home = src('../components/Home.jsx')
    for (const gone of ['EveningCheckCard', 'RecentSitesCard', 'OpenReactionsCard', '<Tomorrow', '<RestingGroup', '<CycleLine', 'CheckinRows', 'HabitChips']) {
      expect(home).not.toContain(gone)
    }
    // readiness comes first, before the log's title
    expect(home.indexOf("sections.includes('readiness')")).toBeLessThan(home.indexOf('Today, {now.getDate()}'))
  })
})
