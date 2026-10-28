// Withings files: the account export (a zip of CSVs such as weight.csv, or one
// CSV on its own) and the Medical Report PDF.
//
// CSV columns are found by their header names, any case, any order, never by
// position: date, weight, fat mass, fat ratio, muscle mass, bone mass and
// hydration. A column that matches nothing is listed, not an error. Rows
// become Scale entries with source Withings. Weight and fat mass go to the
// charts; muscle, bone and hydration are kept on their own fields
// (withingsMuscleMass and so on) and shown as "Withings, muscle mass", never
// mixed with a scan's values.
//
// The Medical Report is a summary of a period: latest values, trends and
// counts. It never becomes readings; it is kept as one report entry.

import type { PdfLine } from './pdfLines'
import { xMid } from './pdfLines'

// --------------------------------------------------------------------- CSV

/** Split CSV text into rows, quotes and all. The delimiter is guessed from the header. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const firstLine = clean.split(/\r?\n/, 1)[0] || ''
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) { row.push(cell); cell = '' } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows.map((r) => r.map((x) => x.trim()))
}

export type WithingsColumn = 'date' | 'weight' | 'fatMass' | 'fatRatio' | 'muscleMass' | 'boneMass' | 'hydration'

export const WITHINGS_FIELD: Record<Exclude<WithingsColumn, 'date'>, string> = {
  weight: 'weight', fatMass: 'fatMass', fatRatio: 'bodyFat', muscleMass: 'withingsMuscleMass', boneMass: 'withingsBoneMass', hydration: 'withingsHydration',
}

/** What each Withings-only field is called in All metrics. */
export const WITHINGS_METRICS = [
  { key: 'withingsMuscleMass', label: 'Withings, muscle mass', unit: 'kg', dp: 1, better: 'up' as const },
  { key: 'withingsBoneMass', label: 'Withings, bone mass', unit: 'kg', dp: 1, better: null },
  { key: 'withingsHydration', label: 'Withings, hydration', unit: 'kg', dp: 1, better: null },
]

const COLUMN_MATCH: Array<[RegExp, WithingsColumn]> = [
  [/^(date|time|timestamp|date ?time|measured( at)?|datum|fecha)$/, 'date'],
  [/^(fat ?mass|body ?fat ?mass|fat mass weight|masse grasse)$/, 'fatMass'],
  [/^(fat ?ratio|fat ?%|fat ?percent(age)?|body ?fat( ?%| ?ratio| ?percent(age)?)?|fat)$/, 'fatRatio'],
  [/^(muscle ?mass|muscle|masse musculaire)$/, 'muscleMass'],
  [/^(bone ?mass|bone|masse osseuse)$/, 'boneMass'],
  [/^(hydration|water|water ?mass|body ?water|hydratation)$/, 'hydration'],
  [/^(weight|body ?weight|poids|gewicht|peso)$/, 'weight'],
]

/** "Fat mass (kg)" → "fat mass"; the unit is kept apart. */
function headerParts(h: string): { name: string; unit: string | null } {
  const unit = h.match(/\(([^)]+)\)|\[([^\]]+)\]/)
  const name = h.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return { name, unit: unit ? (unit[1] || unit[2]).trim().toLowerCase() : null }
}

export interface ColumnMap {
  columns: Partial<Record<WithingsColumn, { index: number; unit: string | null }>>
  /** headers that match nothing, shown in the list */
  unmatched: string[]
}

export function detectColumns(header: string[]): ColumnMap {
  const out: ColumnMap = { columns: {}, unmatched: [] }
  header.forEach((h, index) => {
    const { name, unit } = headerParts(h)
    const hit = COLUMN_MATCH.find(([re]) => re.test(name))
    if (hit && !out.columns[hit[1]]) out.columns[hit[1]] = { index, unit }
    else if (h.trim()) out.unmatched.push(h.trim())
  })
  return out
}

const LB = 0.45359237

function toNumber(s: string | undefined, decimalComma: boolean): number | null {
  if (s == null || s.trim() === '') return null
  const t = decimalComma ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** "2024-05-01 07:12:33", "2024-05-01T07:12:33+02:00", "01/05/2024 07:12" (day first) */
export function parseWhen(s: string): { date: string; time: string | null } | null {
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (iso) return { date: `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`, time: iso[4] ? `${iso[4].padStart(2, '0')}:${iso[5]}` : null }
  const dmy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/)
  if (dmy) return { date: `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`, time: dmy[4] ? `${dmy[4].padStart(2, '0')}:${dmy[5]}` : null }
  return null
}

export interface WithingsReading {
  id: string
  date: string
  time: string | null
  source: 'withings'
  device: 'Withings'
  family: 'scale'
  originalSource: 'withings'
  [field: string]: unknown
}

export interface WithingsCsvRead {
  readings: WithingsReading[]
  columns: ColumnMap
  /** rows with no date or no number at all */
  skipped: number
  /** the file has no date column or nothing to read */
  error: string | null
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function readWithingsCsv(text: string): WithingsCsvRead {
  const rows = parseCsv(text)
  const empty = (error: string, columns: ColumnMap = { columns: {}, unmatched: [] }): WithingsCsvRead => ({ readings: [], columns, skipped: 0, error })
  if (rows.length < 1) return empty('The file is empty.')
  const columns = detectColumns(rows[0])
  const c = columns.columns
  if (!c.date) return empty('No date column found.', columns)
  const values = (['weight', 'fatMass', 'fatRatio', 'muscleMass', 'boneMass', 'hydration'] as const).filter((k) => c[k])
  if (!values.length) return empty('No weight, fat, muscle, bone or hydration column found.', columns)
  const decimalComma = rows.slice(1, 6).some((r) => values.some((k) => /^\d+,\d+$/.test(r[c[k]!.index] || '')))
  const readings: WithingsReading[] = []
  let skipped = 0
  const seen = new Set<string>()
  for (const row of rows.slice(1)) {
    const when = parseWhen(row[c.date.index] || '')
    if (!when) { skipped++; continue }
    const entry: WithingsReading = {
      id: `m-withings-${when.date}${when.time ? `-${when.time.replace(':', '')}` : ''}`,
      date: when.date, time: when.time, source: 'withings', device: 'Withings', family: 'scale', originalSource: 'withings',
    }
    let any = false
    for (const k of values) {
      let v = toNumber(row[c[k]!.index], decimalComma)
      if (v == null || v <= 0) continue
      const unit = c[k]!.unit
      if (k !== 'fatRatio' && unit && /^(lb|lbs|pounds?)$/.test(unit)) v = v * LB
      if (k !== 'fatRatio' && unit === 'g') v = v / 1000
      entry[WITHINGS_FIELD[k]] = r2(v)
      any = true
    }
    if (!any) { skipped++; continue }
    // Withings works its fat % out as fat mass over weight; the same here when the file has no ratio column
    if (entry.bodyFat == null && typeof entry.fatMass === 'number' && typeof entry.weight === 'number') {
      entry.bodyFat = Math.round(((entry.fatMass as number) / (entry.weight as number)) * 1000) / 10
    }
    if (seen.has(entry.id)) { skipped++; continue }
    seen.add(entry.id)
    readings.push(entry)
  }
  readings.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
  return { readings, columns, skipped, error: readings.length ? null : 'No rows with a date and a value.' }
}

/** The CSVs in a Withings export worth reading: body measures, not activity or sleep. */
export const isBodyCsvName = (name: string) => /(^|\/)(weight|body|measures?|poids)[^/]*\.csv$/i.test(name)

// --------------------------------------------------------------------- zip

export interface ZipFile { name: string; data: Uint8Array }

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new (globalThis as unknown as { DecompressionStream: new (f: string) => TransformStream }).DecompressionStream('deflate-raw')
  const stream = new Blob([data as unknown as ArrayBuffer]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * The files in a zip, read in the browser with no library: the central
 * directory gives each file's name and where it sits; stored files are taken
 * as they are, deflated ones go through DecompressionStream.
 */
export async function readZip(buf: ArrayBuffer | Uint8Array, want: (name: string) => boolean = () => true): Promise<ZipFile[]> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a zip file')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const out: ZipFile[] = []
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip file')
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/') || !want(name)) continue
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true)
    const raw = bytes.subarray(start, start + compSize)
    if (method === 0) out.push({ name, data: raw.slice() })
    else if (method === 8) out.push({ name, data: await inflateRaw(raw) })
  }
  return out
}

// ------------------------------------------------------- the Medical Report

export interface WithingsReport {
  id: string
  kind: 'withings-report'
  from: string
  to: string
  /** the file it came from */
  file?: string
  importedAt?: string
  weight: number | null
  weightTrend: number | null
  weighIns: number | null
  bmi: number | null
  bodyFat: number | null
  muscleMass: number | null
  boneMass: number | null
  waterMass: number | null
  leanMass: number | null
  visceralFat: number | null
  bmr: number | null
  metabolicAge: number | null
  hrAwake: number | null
  hrAsleep: number | null
  sleepWeekdayMin: number | null
  sleepWeekendMin: number | null
  sleepEfficiency: number | null
  snoringMin: number | null
  snoringNights: number | null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const monthOf = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1

/** "24 May - 24 Jun 2026", "May 24 - Jun 24, 2026", "24/05/2026 - 24/06/2026" */
export function reportPeriod(text: string): { from: string; to: string } | null {
  const pad = (n: number | string) => String(n).padStart(2, '0')
  const a = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?\s*[-–to]+\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/)
  if (a && monthOf(a[2]) > 0 && monthOf(a[5]) > 0) {
    const y2 = Number(a[6]); const m1 = monthOf(a[2]); const m2 = monthOf(a[5])
    const y1 = a[3] ? Number(a[3]) : m1 > m2 ? y2 - 1 : y2
    return { from: `${y1}-${pad(m1)}-${pad(a[1])}`, to: `${y2}-${pad(m2)}-${pad(a[4])}` }
  }
  const b = text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\s*[-–]\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/)
  if (b && monthOf(b[1]) > 0 && monthOf(b[4]) > 0) {
    const y2 = Number(b[6]); const m1 = monthOf(b[1]); const m2 = monthOf(b[4])
    const y1 = b[3] ? Number(b[3]) : m1 > m2 ? y2 - 1 : y2
    return { from: `${y1}-${pad(m1)}-${pad(b[2])}`, to: `${y2}-${pad(m2)}-${pad(b[5])}` }
  }
  const c = text.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})\s*[-–]\s*(\d{1,2})[/.](\d{1,2})[/.](\d{4})/)
  if (c) return { from: `${c[3]}-${pad(c[2])}-${pad(c[1])}`, to: `${c[6]}-${pad(c[5])}-${pad(c[4])}` }
  return null
}

export function isWithingsReportText(text: string): boolean {
  return (/Withings\s+Medical\s+Report/i.test(text) || /Health\s+report/i.test(text)) && /Overview/i.test(text) && reportPeriod(text) != null
}

/**
 * A value for a label: on the label's line after it, else the nearest by x on
 * the next lines. `value` holds one capture group.
 */
function labelled(lines: PdfLine[], label: RegExp, value: RegExp, below = 3): string | null {
  for (let li = 0; li < lines.length; li++) {
    const m = lines[li].text.match(label)
    if (!m || m.index == null) continue
    const end = m.index + m[0].length
    const x = xMid(lines[li], m.index, end)
    const same = lines[li].text.slice(end).match(value)
    if (same && !/[a-z]{4,}/i.test(lines[li].text.slice(end, end + (same.index as number)))) return same[1]
    for (let d = 1; d <= below && li + d < lines.length; d++) {
      const l = lines[li + d]
      const hits = [...l.text.matchAll(new RegExp(value.source, value.flags.includes('g') ? value.flags : `${value.flags}g`))]
        .map((h) => ({ v: h[1], dx: Math.abs(xMid(l, h.index as number, (h.index as number) + h[0].length) - x) }))
        .filter((h) => h.dx <= 90)
        .sort((a, b) => a.dx - b.dx)
      if (hits[0]) return hits[0].v
    }
  }
  return null
}

const numOr = (s: string | null) => (s == null ? null : Number(s.replace(',', '.').replace(/[−–]/, '-').replace(/\s/g, '')))
const minutesOf = (s: string | null) => {
  if (!s) return null
  const m = s.match(/(\d{1,2})\s*h\s*(\d{1,2})?/)
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null
}

export function parseWithingsReport(lines: PdfLine[], file?: string): WithingsReport | null {
  const text = lines.map((l) => l.text).join('\n')
  const period = reportPeriod(text)
  if (!period) return null
  const KG = /(\d{1,3}(?:[.,]\d)?)\s*kg/
  const weighIns = text.match(/(\d{1,4})\s*(?:weigh-?ins?|weighings?|measurements?)/i)
  const trend = (() => {
    for (let li = 0; li < lines.length; li++) {
      if (!/^\s*Weight\b/i.test(lines[li].text)) continue
      for (let d = 0; d <= 3 && li + d < lines.length; d++) {
        const m = lines[li + d].text.match(/([+\-−–]\s?\d{1,2}(?:[.,]\d)?)\s*kg/)
        if (m) return m[1]
      }
    }
    return null
  })()
  const snoring = text.match(/(\d{1,4})\s*min(?:utes)?\s*(?:over|in|across)\s*(\d{1,3})\s*nights/i)
  return {
    id: `withings-report-${period.from}-${period.to}`,
    kind: 'withings-report',
    from: period.from,
    to: period.to,
    ...(file ? { file } : {}),
    weight: numOr(labelled(lines, /^\s*Weight\b/i, KG)),
    weightTrend: numOr(trend),
    weighIns: weighIns ? Number(weighIns[1]) : null,
    bmi: numOr(labelled(lines, /\bBMI\b/, /(?<![\d.])(\d{2}(?:[.,]\d)?)(?![\d%])/)),
    bodyFat: numOr(labelled(lines, /(?<!visceral\s)\bFat\s*(?:mass|ratio|%)?(?!\s*free)/i, /(\d{1,2}(?:[.,]\d)?)\s*%/)),
    muscleMass: numOr(labelled(lines, /\bMuscle\s*mass\b|\bMuscle\b/i, KG)),
    boneMass: numOr(labelled(lines, /\bBone\s*mass\b|\bBone\b/i, KG)),
    waterMass: numOr(labelled(lines, /\bWater\s*mass\b|\bHydration\b|\bBody\s+water\b/i, KG)),
    leanMass: numOr(labelled(lines, /\bLean\s*mass\b|\bFat[- ]free\s+mass\b/i, KG)),
    visceralFat: numOr(labelled(lines, /\bVisceral\s*fat\b/i, /(?<![\d.])(\d{1,2}(?:[.,]\d)?)(?![\d%])/)),
    bmr: numOr(labelled(lines, /\bBMR\b|Basal\s+metabolic\s+rate/i, /(\d{3,4})\s*kcal/)),
    metabolicAge: numOr(labelled(lines, /Metabolic\s+age/i, /(?<![\d.])(\d{2,3})(?![\d.])/)),
    hrAwake: numOr(labelled(lines, /\bAwake\b/i, /(\d{2,3})\s*bpm/)),
    hrAsleep: numOr(labelled(lines, /\bAsleep\b/i, /(\d{2,3})\s*bpm/)),
    sleepWeekdayMin: minutesOf(labelled(lines, /\bWeekdays?\b/i, /(\d{1,2}\s*h\s*\d{1,2})/)),
    sleepWeekendMin: minutesOf(labelled(lines, /\bWeekends?\b/i, /(\d{1,2}\s*h\s*\d{1,2})/)),
    sleepEfficiency: numOr(labelled(lines, /Sleep\s+efficiency/i, /(\d{1,3})\s*%/)),
    snoringMin: snoring ? Number(snoring[1]) : null,
    snoringNights: snoring ? Number(snoring[2]) : null,
  }
}
