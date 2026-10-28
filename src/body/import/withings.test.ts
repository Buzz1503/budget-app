import { describe, it, expect } from 'vitest'
import { parseCsv, detectColumns, readWithingsCsv, readZip, parseWithingsReport, isWithingsReportText, reportPeriod, isBodyCsvName } from './withings'
import { linesFromText } from './pdfLines'
import { WITHINGS_REPORT_TEXT } from './fixtures'

/** A zip written by hand: stored or deflated entries, enough for the reader. */
async function makeZip(files: Array<{ name: string; text: string; deflate?: boolean }>): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const raw = enc.encode(f.text)
    let data = raw
    if (f.deflate) {
      const cs = new (globalThis as unknown as { CompressionStream: new (f: string) => TransformStream }).CompressionStream('deflate-raw')
      data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer())
    }
    const name = enc.encode(f.name)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, f.deflate ? 8 : 0, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const cen = new Uint8Array(46 + name.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, f.deflate ? 8 : 0, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cen.set(name, 46)
    parts.push(local, data)
    central.push(cen)
    offset += local.length + data.length
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0))
  let p = 0
  for (const a of all) { out.set(a, p); p += a.length }
  return out
}

const EXPORT = [
  'Date,"Weight (kg)","Fat mass (kg)","Bone mass (kg)","Muscle mass (kg)","Hydration (kg)",Comments',
  '"2024-05-02 07:10:11",95.2,29.4,3.3,62.7,46.1,',
  '"2024-05-01 07:12:33",95.6,29.9,3.3,62.6,46.0,"after travel"',
].join('\n')

describe('Withings CSV', () => {
  it('parses quoted cells and finds the delimiter', () => {
    expect(parseCsv('a;"b;c";d\n1;2;3')).toEqual([['a', 'b;c', 'd'], ['1', '2', '3']])
    expect(parseCsv('"x ""y""",z\r\n1,2\r\n')).toEqual([['x "y"', 'z'], ['1', '2']])
  })

  it('finds columns by header name, any case and order, and lists the rest', () => {
    const c = detectColumns(['Comments', 'HYDRATION (kg)', 'weight (kg)', 'date', 'Fat Mass (kg)', 'Muscle mass', 'Bone Mass (kg)', 'Pulse'])
    expect(c.columns.date?.index).toBe(3)
    expect(c.columns.weight?.index).toBe(2)
    expect(c.columns.fatMass?.index).toBe(4)
    expect(c.columns.muscleMass?.index).toBe(5)
    expect(c.columns.boneMass?.index).toBe(6)
    expect(c.columns.hydration?.index).toBe(1)
    expect(c.unmatched).toEqual(['Comments', 'Pulse'])
  })

  it('accepts renamed columns', () => {
    const c = detectColumns(['Timestamp', 'Body weight [lb]', 'Body fat %', 'Water mass'])
    expect(Object.keys(c.columns).sort()).toEqual(['date', 'fatRatio', 'hydration', 'weight'])
    const read = readWithingsCsv('Timestamp,Body weight [lb],Body fat %\n2024-01-03 08:00,210,31.2')
    expect(read.readings[0].weight).toBe(95.25)
    expect(read.readings[0].bodyFat).toBe(31.2)
  })

  it('makes Scale entries with source Withings, muscle, bone and hydration on their own fields', () => {
    const read = readWithingsCsv(EXPORT)
    expect(read.error).toBeNull()
    expect(read.columns.unmatched).toEqual(['Comments'])
    expect(read.readings.map((r) => r.date)).toEqual(['2024-05-01', '2024-05-02'])
    const r = read.readings[0]
    expect(r).toMatchObject({ source: 'withings', device: 'Withings', family: 'scale', time: '07:12', weight: 95.6, fatMass: 29.9, bodyFat: 31.3, withingsMuscleMass: 62.6, withingsBoneMass: 3.3, withingsHydration: 46 })
    expect(r.muscleMass).toBeUndefined()
    expect(r.skeletalMuscleMass).toBeUndefined()
  })

  it('a file with no date column is not recognised, not a crash', () => {
    expect(readWithingsCsv('steps,calories\n100,20').error).toBe('No date column found.')
  })

  it('decimal commas with a semicolon delimiter', () => {
    const read = readWithingsCsv('Date;Weight (kg)\n2024-02-01 07:00;94,7')
    expect(read.readings[0].weight).toBe(94.7)
  })
})

describe('zip handling', () => {
  it('reads stored and deflated files from a Withings export', async () => {
    const zip = await makeZip([
      { name: 'data/weight.csv', text: EXPORT, deflate: true },
      { name: 'data/activities.csv', text: 'Date,Steps\n2024-01-01,100' },
      { name: 'data/readme.txt', text: 'hello' },
    ])
    const all = await readZip(zip)
    expect(all.map((f) => f.name)).toEqual(['data/weight.csv', 'data/activities.csv', 'data/readme.txt'])
    expect(new TextDecoder().decode(all[0].data)).toBe(EXPORT)
    const body = await readZip(zip, isBodyCsvName)
    expect(body.map((f) => f.name)).toEqual(['data/weight.csv'])
  })

  it('a file that is not a zip says so', async () => {
    await expect(readZip(new TextEncoder().encode('not a zip at all, just some text here'))).rejects.toThrow('Not a zip file')
  })
})

describe('Withings Medical Report', () => {
  const lines = linesFromText(WITHINGS_REPORT_TEXT)

  it('is recognised by its title, Overview and a date range', () => {
    expect(isWithingsReportText(WITHINGS_REPORT_TEXT)).toBe(true)
    expect(isWithingsReportText('Health report\nNo period here')).toBe(false)
    expect(reportPeriod('Overview 24 May - 24 Jun 2026')).toEqual({ from: '2026-05-24', to: '2026-06-24' })
    expect(reportPeriod('15 Dec - 14 Jan 2026')).toEqual({ from: '2025-12-15', to: '2026-01-14' })
    expect(reportPeriod('May 24 - Jun 24, 2026')).toEqual({ from: '2026-05-24', to: '2026-06-24' })
  })

  it('reads the 24 May to 24 Jun 2026 summary', () => {
    const r = parseWithingsReport(lines, 'report.pdf')
    expect(r).toMatchObject({
      from: '2026-05-24', to: '2026-06-24', weight: 93.9, weightTrend: -1, weighIns: 36, bmi: 33, bmr: 1959, metabolicAge: 39,
      bodyFat: 30.4, boneMass: 3.3, muscleMass: 63, visceralFat: 4.8, leanMass: 66.3, waterMass: 45.9,
      hrAwake: 70, hrAsleep: 58, sleepWeekdayMin: 6 * 60 + 35, sleepWeekendMin: 6 * 60 + 29, sleepEfficiency: 91, snoringMin: 0, snoringNights: 14,
    })
  })
})
