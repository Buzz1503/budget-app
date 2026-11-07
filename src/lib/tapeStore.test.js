import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }

let useStore, buildSchedule, buildBackup, BodyDiagram, siteRows
beforeAll(async () => {
  useStore = (await import('../store/useStore')).default
  buildSchedule = (await import('../native/notifySchedule')).buildSchedule
  buildBackup = (await import('./backup')).buildBackup
  BodyDiagram = (await import('../components/measurements/MeasurementsArea')).BodyDiagram
  siteRows = (await import('../body/tape')).siteRows
})

beforeEach(() => {
  useStore.setState({
    measurements: [
      { id: 'm1', date: '2026-10-01', source: 'manual', waist: 100, hips: 104, note: 'morning' },
      { id: 's1', date: '2026-10-20', source: 'scan', device: 'Evolt 360', weight: 98, abdominalCircumference: 101 },
    ],
    tapeSettings: { sites: null, better: {}, reminder: false },
  })
})

describe('saving tape', () => {
  it('a new day is a new entry with only the sites changed', () => {
    useStore.getState().logTape('2026-10-21', { waist: 99.2 })
    const e = useStore.getState().measurements.find((m) => m.date === '2026-10-21')
    expect(e).toMatchObject({ source: 'manual', waist: 99.2 })
    expect(e.hips).toBeUndefined()
    expect(useStore.getState().measurements).toHaveLength(3)
  })

  it('the same day adds to the typed entry and keeps everything on it', () => {
    useStore.getState().logTape('2026-10-01', { armL: 37.5 })
    const list = useStore.getState().measurements
    expect(list).toHaveLength(2)
    expect(list.find((m) => m.id === 'm1')).toMatchObject({ waist: 100, hips: 104, note: 'morning', armL: 37.5 })
  })

  it('a scan on the same day is never written into', () => {
    useStore.getState().logTape('2026-10-20', { waist: 99 })
    expect(useStore.getState().measurements.find((m) => m.id === 's1').waist).toBeUndefined()
    expect(useStore.getState().measurements).toHaveLength(3)
  })

  it('nothing changed, nothing saved', () => {
    expect(useStore.getState().logTape('2026-10-21', {})).toBeNull()
    expect(useStore.getState().measurements).toHaveLength(2)
  })

  it('the settings are in the backup', async () => {
    useStore.getState().setTapeSettings({ better: { thighL: 'up' }, reminder: true })
    const state = (await buildBackup()).appState.state
    expect(state.tapeSettings).toMatchObject({ better: { thighL: 'up' }, reminder: true })
    expect(state.measurements.find((m) => m.id === 'm1').waist).toBe(100)
  })
})

describe('the reminder every 2 weeks', () => {
  const now = new Date('2026-10-12T09:00:00')
  it('off by default; on, it fires 14 days after the last tape entry and opens Measurements', () => {
    expect(buildSchedule(useStore.getState(), { now }).some((x) => x.category === 'TAPE')).toBe(false)
    useStore.getState().setTapeSettings({ reminder: true })
    const tape = buildSchedule(useStore.getState(), { now }).filter((x) => x.category === 'TAPE')
    expect(tape).toHaveLength(1)
    expect(tape[0].id).toBe('pepito.sched.tape.2026-10-15')
    expect(new Date(tape[0].fireAt).getHours()).toBe(8)
    expect(tape[0].payload).toEqual({ kind: 'tape', route: 'measurements' })
    // more than a week away: not planned yet
    expect(buildSchedule(useStore.getState(), { now: new Date('2026-10-02T09:00:00') }).some((x) => x.category === 'TAPE')).toBe(false)
  })
})

describe('the body diagram', () => {
  it('a label per measured site with its latest value and a change chip coloured by the better way', () => {
    const ms = [
      { date: '2026-01-01', waist: 104, armL: 36, calfR: 39 },
      { date: '2026-02-01', waist: 101.5, armL: 35.6, calfR: 39 },
    ]
    const html = renderToStaticMarkup(createElement(BodyDiagram, { rows: siteRows(ms) }))
    expect(html).toMatch(/data-testid="diagram-waist" data-tone="better"/)
    expect(html).toMatch(/data-testid="diagram-armL" data-tone="worse"/)
    expect(html).toMatch(/data-testid="diagram-calfR" data-tone="same"/)
    expect(html).toContain('101.5')
    expect(html).toContain('−2.5')
    expect(html).not.toContain('diagram-hips')
    // a plain drawn figure, never a photo
    expect(html).not.toMatch(/<img/)
  })
})
