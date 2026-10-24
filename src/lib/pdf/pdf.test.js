import { describe, it, expect } from 'vitest'
import { PdfDoc, winAnsi, textWidth, wrap, toBase64 } from './pdfDoc'
import { sleepReportPdf, healthSummaryPdf } from './reports'

const str = (bytes) => String.fromCharCode(...bytes)

/** Every object the xref points at is really there. */
function checkXref(text) {
  const start = Number(/startxref\n(\d+)/.exec(text)[1])
  expect(text.slice(start, start + 4)).toBe('xref')
  const rows = text.slice(start).split('\n').slice(3).filter((l) => /^\d{10} 00000 n $/.test(l))
  rows.forEach((l, i) => expect(text.slice(Number(l.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true))
  return rows.length
}

describe('the PDF writer', () => {
  it('writes a valid file with text and pages', () => {
    const d = new PdfDoc({ title: 'Test' })
    d.text(48, 60, 'Hello (world) 5 · 7°', { size: 12, bold: true })
    d.line(48, 70, 300, 70)
    d.addPage().text(48, 60, 'Page two')
    const t = str(d.output())
    expect(t.startsWith('%PDF-1.4')).toBe(true)
    expect(t.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(t).toContain('/Count 2')
    expect(t).toContain('(Hello \\(world\\) 5 \\267 7\\260) Tj')
    expect(checkXref(t)).toBeGreaterThan(5)
  })

  it('measures and wraps Helvetica text; anything unknown becomes a stand-in', () => {
    expect(textWidth('Hello', 10)).toBeCloseTo(22.78, 1)
    expect(wrap('one two three four five six', 60, 10).length).toBeGreaterThan(1)
    expect(winAnsi('a≥b')).toEqual([97, 62, 61, 98])
    expect(winAnsi('é')).toEqual([63])
    expect(toBase64(new Uint8Array([37, 80, 68, 70]))).toBe('JVBERg==')
  })
})

const apnea = {
  label: 'Screen, not a diagnosis.', score: 4, band: 'intermediate', known: 7, level: 'Moderate', reasons: ['STOP-BANG 4 of 8'],
  items: [{ label: 'Snoring loudly', answer: true, source: 'Sleep sounds: snoring on 9 of 20 recorded nights (45%)' }, { label: 'Neck over 40 cm', answer: null, source: 'No neck measurement' }],
}
const series = (n, f) => Array.from({ length: n }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, value: f(i) }))

describe('the doctor reports', () => {
  it('the sleep report lists the screen with sources, breathing, SpO2, snoring, logs, weight, BP and bloods', () => {
    const t = str(sleepReportPdf({
      days: 30, from: '2026-09-25', to: '2026-10-24', generatedOn: '2026-10-24',
      averages: { nights: 28, asleepMin: 412, score: 78, deepMin: 61, remMin: 92, awakeMin: 34, sleepingHR: 54.3, hrv: 58 },
      trends: { asleep: series(20, (i) => 6.5 + (i % 3) / 2), score: series(20, (i) => 70 + i), breathing: series(20, () => 3.1) },
      apnea, signals: { breathingNights: 20, elevatedNights: 3, spo2Lowest: 88, spo2PctBelow90: 1.2, spo2Nights: 20, dipNights: 4 },
      snoring: { nights: 20, avgMin: 22, over15: 9, lowConfidence: 2 },
      logs: [{ name: 'Temazepam', nights: 6, typical: '10 mg' }, { name: 'Alcohol', nights: 9, typical: '2 drinks' }],
      weight: series(10, (i) => 104 - i / 5), bp: [{ date: '2026-10-01', sys: 132, dia: 84 }, { date: '2026-10-20', sys: 128, dia: 82 }],
      bloods: [{ name: 'Haematocrit', value: 0.49, unit: 'L/L', date: '2026-09-01' }, { name: 'Testosterone', value: null }],
      testosteroneNote: 'Testosterone therapy can worsen sleep apnea in some people.',
    }))
    for (const s of ['Sleep report, last 30 days', 'STOP-BANG', 'Sleep sounds: snoring on 9 of 20 recorded nights \\(45%\\)', '3 of 20 nights', '88%', 'Temazepam', '6 of 30 evenings, usually 10 mg', 'Systolic blood pressure', 'Haematocrit', 'Testosterone therapy can worsen sleep apnea in some people.', 'page 1 of']) {
      expect(t).toContain(s)
    }
    checkXref(t)
  })

  it('the health summary lists the protocol, flagged bloods and body composition', () => {
    const t = str(healthSummaryPdf({
      generatedOn: '2026-10-24',
      protocol: [{ name: 'Retatrutide', dose: '3 mg, 30 units', schedule: 'Weekly, Monday', since: '2026-05-01' }],
      asNeeded: [{ name: 'Dexamphetamine', count: 18, typical: '10 mg' }],
      bloods: [{ name: 'Haematocrit', latest: 0.52, unit: 'L/L', date: '2026-09-01', range: '0.40 to 0.50', points: series(3, (i) => 0.48 + i / 100) }],
      body: { weight: series(10, (i) => 110 - i), bodyFat: series(4, (i) => 30 - i), leanMass: [], source: 'Scale and Evolt kept apart.' },
    }))
    for (const s of ['Health summary', 'Retatrutide', '3 mg, 30 units, Weekly, Monday, since 1 May 2026', 'Dexamphetamine', 'range 0.40 to 0.50', 'Body fat', 'Lean mass']) expect(t).toContain(s)
    checkXref(t)
  })
})

describe('report data from the store', async () => {
  const { eveningLogs, asNeededCounts, latestBloods } = await import('./reportData')
  const items = [{ id: 'an-tem', name: 'Temazepam', short: 'Temazepam', slot: 'PM', units: ['mg'], step: 5 }, { id: 'an-dex', name: 'Dexamphetamine', short: 'Dex', slot: 'AM', units: ['mg'], step: 2.5 }]
  const at = (d, h) => new Date(`${d}T${h}:00`).toISOString()
  const state = {
    asNeededItems: items,
    asNeededLogs: [
      { itemId: 'an-tem', amount: 10, unit: 'mg', at: at('2026-10-02', '22:00') },
      { itemId: 'an-tem', amount: 10, unit: 'mg', at: at('2026-10-04', '00:30') }, // the evening of the 3rd
      { itemId: 'an-tem', amount: 5, unit: 'mg', at: at('2026-10-05', '22:00') },
      { itemId: 'an-dex', amount: 10, unit: 'mg', at: at('2026-10-03', '08:00') },
    ],
    eveningDetails: { '2026-10-02': { drinks: 2 }, '2026-10-06': { drinks: 0 } },
    habitLogs: { '2026-10-07': { alcohol: true } },
    bloods: { tests: [{ id: 't1', date: '2026-09-01', values: { Haematocrit: 0.49 } }] },
  }
  it('sedative evenings and alcohol nights with the usual amount', () => {
    expect(eveningLogs(state, '2026-10-01', '2026-10-31')).toEqual([
      { name: 'Temazepam', nights: 3, typical: '10 mg' },
      { name: 'Alcohol', nights: 2, typical: '2 drinks' },
    ])
    expect(asNeededCounts(state, '2026-10-01', '2026-10-31').map((x) => [x.name, x.count])).toEqual([['Temazepam', 3], ['Dexamphetamine', 1]])
    expect(latestBloods(state, ['Haematocrit', 'Testosterone'])).toEqual([{ name: 'Haematocrit', value: 0.49, date: '2026-09-01' }, { name: 'Testosterone', value: null, date: null }])
  })
})
