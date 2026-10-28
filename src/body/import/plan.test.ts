import { describe, it, expect } from 'vitest'
import { evoltItem, withingsItems, withingsReportItem, jsonItems, pdfItem, settleBatch, importPayload, importCounts, importButton, summaryWords, isDuplicate, recheckEvolt, STATUS_WORD } from './plan'
import { linesFromText } from './pdfLines'
import { evolt26Oct, WITHINGS_REPORT_TEXT } from './fixtures'
import { SCAN_SCHEMA } from '../scanImport'

const none = { measurements: [] }
const CSV = 'Date,Weight (kg),Fat mass (kg),Muscle mass (kg),Pulse\n2024-05-01 07:12:33,95.6,29.9,62.6,61\n2024-05-02 07:10:00,95.2,29.4,62.7,60\n'

describe('import list', () => {
  it('an Evolt PDF is a new scan with date, weight and body fat', () => {
    const it0 = evoltItem('scan.pdf', evolt26Oct(), none)
    expect([it0.what, it0.date, it0.weight, it0.bodyFat, it0.status, it0.include]).toEqual(['Evolt 360 scan', '2026-10-26', 92.5, 28.1, 'new', true])
    expect(STATUS_WORD[it0.status]).toBe('New')
  })

  it('a PDF that is neither Evolt nor a Withings report is Not recognised, with its file name', () => {
    const it0 = pdfItem('invoice.pdf', linesFromText('Invoice 2026\nTotal 40.00'), none)
    expect([it0.file, it0.status, it0.include, STATUS_WORD[it0.status]]).toEqual(['invoice.pdf', 'unknown', false, 'Not recognised'])
  })

  it('a scan that fails a check needs a check and is not included until it is fixed', () => {
    const lines = evolt26Oct().map((l) => (l.text.startsWith('170 cm') ? { ...l, text: '170 cm 95.5 kg 36 Male' } : l))
    const it0 = evoltItem('scan.pdf', lines, none)
    expect(it0.status).toBe('check')
    expect(it0.include).toBe(false)
    expect(it0.problems?.[0]).toMatch(/is not weight/)
    const fixed = recheckEvolt(it0, { ...it0.raw, weight_kg: 92.5 }, none)
    expect([fixed.status, fixed.include, fixed.weight]).toEqual(['new', true, 92.5])
    const kept = recheckEvolt(it0, it0.raw as Record<string, unknown>, none, true)
    expect(kept.include).toBe(true)
    expect(kept.entries[0].importNote).toMatch(/after a check/)
  })

  it('a Withings report is a summary with no readings', () => {
    const it0 = withingsReportItem('report.pdf', linesFromText(WITHINGS_REPORT_TEXT), none)
    expect([it0.what, it0.status, it0.note, it0.entries.length, it0.weight]).toEqual(['Withings report', 'new', 'Summary report: no individual readings', 0, 93.9])
    expect(importPayload([it0]).reports).toHaveLength(1)
    expect(importPayload([it0]).measurements).toHaveLength(0)
  })

  it('a Withings CSV is one row with its unmatched columns shown', () => {
    const [it0] = withingsItems('weight.csv', CSV, none)
    expect(it0.entries).toHaveLength(2)
    expect(it0.note).toBe('Columns not used: Pulse')
    expect(it0.weight).toBe(95.2)
  })

  it('the existing JSON format keeps working', () => {
    const items = jsonItems('scans.json', { schema: SCAN_SCHEMA, scans: [{ date: '2026-01-02', time: '08:00', device: 'Evolt 360', weight_kg: 95, lean_body_mass_kg: 65, fat_mass_kg: 30 }] }, none)
    expect(items.map((i) => [i.what, i.status])).toEqual([['Evolt 360 scan', 'new']])
    expect(jsonItems('x.json', { nope: 1 }, none)[0].status).toBe('unknown')
  })
})

describe('duplicates', () => {
  const scan = { id: 's1', date: '2026-10-26', time: '12:41', device: 'Evolt 360', source: 'scan', weight: 92.5 }

  it('same device, date and time is already imported, and skipped by default', () => {
    const it0 = evoltItem('scan.pdf', evolt26Oct(), { measurements: [{ ...scan, weight: 80 }] })
    expect([it0.status, it0.include, STATUS_WORD[it0.status]]).toEqual(['duplicate', false, 'Already imported'])
  })

  it('same date and weight within 0.1 kg is already imported', () => {
    expect(isDuplicate({ ...scan, id: 'x', time: '09:00' } as never, { measurements: [{ ...scan, time: null, weight: 92.6 }] })).toBe(true)
    expect(isDuplicate({ ...scan, id: 'x', time: '09:00' } as never, { measurements: [{ ...scan, time: null, weight: 92.7 }] })).toBe(false)
  })

  it('a scan is never a duplicate of a scale weigh-in, and the reverse', () => {
    expect(isDuplicate({ ...scan, id: 'x' } as never, { measurements: [{ id: 'w', date: scan.date, source: 'withings', device: 'Withings', weight: 92.5 }] })).toBe(false)
  })

  it('Withings rows already in from Apple Health are left out', () => {
    const [it0] = withingsItems('weight.csv', CSV, { measurements: [], health: [{ date: '2024-05-01', weight: 95.6 }] })
    expect(it0.entries.map((e) => e.date)).toEqual(['2024-05-02'])
    expect(it0.dupes).toBe(1)
    expect(it0.note).toMatch(/^1 already on record, skipped/)
  })

  it('the same file twice in one batch: the second is a duplicate', () => {
    const items = settleBatch([evoltItem('a.pdf', evolt26Oct(), none), evoltItem('b.pdf', evolt26Oct(), none),
      withingsReportItem('r1.pdf', linesFromText(WITHINGS_REPORT_TEXT), none), withingsReportItem('r2.pdf', linesFromText(WITHINGS_REPORT_TEXT), none)])
    expect(items.map((i) => i.status)).toEqual(['new', 'duplicate', 'new', 'duplicate'])
  })

  it('a report for a period already kept is already imported', () => {
    const first = withingsReportItem('r.pdf', linesFromText(WITHINGS_REPORT_TEXT), none)
    expect(withingsReportItem('r.pdf', linesFromText(WITHINGS_REPORT_TEXT), { measurements: [], reports: [first.report!] }).status).toBe('duplicate')
  })
})

describe('summary', () => {
  it('counts what is added and what is skipped, and names the button', () => {
    const items = settleBatch([
      evoltItem('a.pdf', evolt26Oct(), none),
      evoltItem('b.pdf', evolt26Oct(), none),
      pdfItem('other.pdf', linesFromText('Hello'), none),
    ])
    expect(importCounts(items)).toEqual({ add: 1, skipped: 2, scans: 1 })
    expect(importButton(items)).toBe('Import 1 scan')
    expect(summaryWords(1, 2)).toBe('Added 1, skipped 2')
    const withCsv = [...items, ...withingsItems('weight.csv', CSV, { measurements: [], health: [{ date: '2024-05-01', weight: 95.6 }] })]
    expect(importCounts(withCsv)).toEqual({ add: 2, skipped: 3, scans: 1 })
    expect(importButton(withCsv)).toBe('Import 2 items')
  })
})
