// Switch tracking around the Heart section: the store keeps switches and the
// good sleep period (both in the backup), tirzepatide comes from the library
// with no dose, the doctor PDF carries the numbers, and nothing anywhere
// words doses of different compounds as equivalent.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { heartReportPdf } from '../lib/pdf/reports'
import { wizardSuggestion } from '../lib/wizardDefaults'
import { rhrVsReference, rangeMean, NO_EQUIVALENCE, HEART } from './heart'
import { vsNormal } from '../sleep/tabView'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}

let useStore
beforeAll(async () => { useStore = (await import('../store/useStore')).default })

const str = (bytes) => new globalThis.TextDecoder('latin1').decode(bytes)

describe('switches and the good sleep period in the store', () => {
  it('defaults: no reference, a 14-day transition, no switches', () => {
    const s = useStore.getState()
    expect(s.heartSettings).toEqual({ reference: null, transitionDays: HEART.transitionDays })
    expect(s.switches).toEqual([])
    expect(HEART.transitionOptions).toEqual([0, 7, 14, 21])
  })
  it('records one switch per pair, removes it, and remembers a dismissed offer', () => {
    const s = useStore.getState()
    const a = s.addSwitch({ from: 'retatrutide', to: 'tirzepatide', date: '2026-10-01' })
    const b = useStore.getState().addSwitch({ from: 'retatrutide', to: 'tirzepatide', date: '2026-10-03' })
    expect(useStore.getState().switches).toHaveLength(1)
    expect(useStore.getState().switches[0]).toMatchObject({ id: b, date: '2026-10-03' })
    expect(a).not.toBe(b)
    expect(useStore.getState().addSwitch({ from: 'x' })).toBeNull()
    useStore.getState().removeSwitch(b)
    expect(useStore.getState().switches).toEqual([])
    useStore.getState().dismissSwitch('retatrutide>tirzepatide@2026-10-01')
    useStore.getState().dismissSwitch('retatrutide>tirzepatide@2026-10-01')
    expect(useStore.getState().switchDismissed).toEqual(['retatrutide>tirzepatide@2026-10-01'])
  })
  it('the good sleep period and transition are settings that merge', () => {
    useStore.getState().setHeartSettings({ reference: { from: '2026-05-01', to: '2026-06-25' } })
    useStore.getState().setHeartSettings({ transitionDays: 7 })
    expect(useStore.getState().heartSettings).toEqual({ reference: { from: '2026-05-01', to: '2026-06-25' }, transitionDays: 7 })
  })
})

describe('tirzepatide in the compound library', () => {
  it('weekly, SubQ, and no dose filled in', () => {
    const t = wizardSuggestion('tirzepatide')
    expect(t.name).toBe('Tirzepatide')
    expect(t.frequency).toBe('weekly')
    expect(t.route).toBe('SubQ')
    expect(t.ladder).toBeNull()
  })
})

describe('resting HR against the good sleep period', () => {
  it('the hero answer and chip', () => {
    expect(rhrVsReference(64.2, 57.1)).toEqual({ diff: 7, answer: 'Resting HR 64, 7 above your good sleep period.', chip: '+7 vs good sleep', tone: 'worse' })
    expect(rhrVsReference(55, 58).tone).toBe('better')
    expect(rhrVsReference(58.2, 58).answer).toBe('Resting HR 58, about the same as your good sleep period.')
    expect(rhrVsReference(58, null).chip).toBeNull()
    expect(rhrVsReference(null, 58).answer).toBe('No resting heart rate from Apple Health yet.')
    expect(rangeMean(new Map([['2026-05-01', 56], ['2026-05-02', 58], ['2026-07-01', 70]]), { from: '2026-05-01', to: '2026-06-25' })).toBe(57)
  })
  it('Sleep vs normal uses the good sleep period as the band once set', () => {
    const series = new Map()
    for (let i = 1; i <= 20; i++) series.set(`2026-05-${String(i).padStart(2, '0')}`, 50 + (i % 3))
    for (let i = 1; i <= 28; i++) series.set(`2026-10-${String(i).padStart(2, '0')}`, 60 + (i % 3))
    series.set('2026-10-29', 61)
    const spec = { key: 'hr', label: 'Sleeping HR', unit: 'bpm', dp: 0, dir: 'down', series }
    const [usual] = vsNormal([spec], '2026-10-29')
    const [ref] = vsNormal([{ ...spec, range: { from: '2026-05-01', to: '2026-05-31' } }], '2026-10-29')
    expect(usual.basis).toBe('normal')
    expect(usual.tone).toBe('same')
    expect(ref.basis).toBe('reference')
    expect(ref.n).toBe(20)
    expect(ref.tone).toBe('worse')
  })
})

describe('the doctor PDF', () => {
  const stat = (mean, n) => ({ mean, lo: mean - 1, hi: mean + 1, n })
  it('lists the reference, each period with RHR, sleeping HR and wake-ups, the switch and the no-equivalence note', () => {
    const t = str(heartReportPdf({
      generatedOn: '2026-11-12',
      reference: { from: '2026-05-01', to: '2026-06-25' },
      periods: [
        { label: 'Before Retatrutide', ranges: [['2026-01-01', '2026-06-25']], rhr: stat(56, 170), sleepHR: stat(52, 160), wakeUps: stat(2.1, 150), weightPerWeek: -0.1 },
        { label: 'Retatrutide 4 mg', ranges: [['2026-07-01', '2026-09-20']], rhr: stat(63, 80), sleepHR: stat(58, 78), wakeUps: stat(3.4, 70), weightPerWeek: -0.6 },
        { label: 'Tirzepatide 5 mg', ranges: [['2026-10-15', '2026-11-12']], rhr: null, sleepHR: null, wakeUps: null, weightPerWeek: null },
      ],
      switch: {
        from: 'Retatrutide', to: 'Tirzepatide', date: '2026-10-01', answer: 'On tirzepatide so far: resting HR 4 lower.', early: true, nBefore: 28, nAfter: 12,
        old: ['2026-09-03', '2026-09-30'], new: ['2026-10-15', '2026-11-12'], overlap: 'Also across the two sides: sauna 2 a week.',
        rows: [{ label: 'Resting HR', unit: 'bpm', dp: 0, before: stat(63, 28), after: stat(59, 12) }],
        weight: { before: -0.6, after: -0.3 }, fat: { before: null, after: null }, reactions: { before: 0, after: 1 },
      },
    }))
    for (const s of [
      'Heart summary', 'Good sleep period used for comparison: 1 May 2026 to 25 Jun 2026.', 'Before Retatrutide', 'Retatrutide 4 mg', 'Tirzepatide 5 mg',
      '63 bpm \\(95% range 62 to 64, n 80\\)', '3.4 \\(95% range 2.4 to 4.4, n 70\\)', 'Wake-ups a night', 'Sleeping heart rate', 'No data', '-0.60 kg a week',
      'Switch: Retatrutide to Tirzepatide', '28 before, 12 after \\(early: under 21 nights on a side\\)', 'On tirzepatide so far: resting HR 4 lower.',
      '63 bpm \\(n 28\\) then 59 bpm \\(n 12\\)', 'Fat mass \\(Evolt\\)', 'Injection reactions logged', 'Also across the two sides: sauna 2 a week.',
      'Doses of different compounds are not equivalent', 'not causes', 'Pepito+ heart summary',
    ]) expect(t).toContain(s)
  })
})

describe('no dose equivalence and no causal words in the Heart and switch screens', () => {
  const files = []
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(jsx?|tsx?)$/.test(f) && !/\.test\./.test(f)) files.push(p)
    }
  }
  beforeAll(() => {
    files.push('src/health/heart.ts', 'src/components/health/HeartView.jsx', 'src/components/health/SwitchScreen.jsx', 'src/components/health/HeartSummary.jsx', 'src/lib/pdf/reports.js')
  })
  it('never says a dose of one compound equals a dose of another, never says "caused"', () => {
    walk('src/components/health')
    for (const f of new Set(files)) {
      // what a person can read: comments are left out
      const text = readFileSync(f, 'utf8').replace(NO_EQUIVALENCE, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(text, f).not.toMatch(/\bequivalent (?:dose|to)\b|\bequals? \d|\bsame as \d+(?:\.\d+)? ?mg|\bmatches \d+(?:\.\d+)? ?mg/i)
      expect(text, f).not.toMatch(/\bcaused\b|\bcauses (?:a|your|the)\b/i)
    }
  })
})
