// One import list for every file dropped in: Evolt PDFs, Withings exports and
// reports, and the scan JSON. Each file becomes rows with what it is, its date,
// weight and body fat, and a status (New, Already imported, Needs a check, Not
// recognised). Nothing here saves; `importPayload` says what one "Import"
// writes, and existing entries are never replaced or changed.

import { scanFromImport, parseScanImport, type ScanEntry } from '../scanImport'
import { parseEvoltLines, checkEvolt, isEvoltText } from './evoltPdf'
import { readWithingsCsv, parseWithingsReport, isWithingsReportText, type WithingsReading, type WithingsReport } from './withings'
import type { PdfLine } from './pdfLines'

export type ItemKind = 'evolt' | 'withings' | 'withings-report' | 'json' | 'unknown'
export type ItemStatus = 'new' | 'duplicate' | 'check' | 'unknown'

export const STATUS_WORD: Record<ItemStatus, string> = {
  new: 'New', duplicate: 'Already imported', check: 'Needs a check', unknown: 'Not recognised',
}

type Entry = ScanEntry | WithingsReading

export interface ImportItem {
  key: string
  file: string
  kind: ItemKind
  what: string
  date: string | null
  weight: number | null
  bodyFat: number | null
  status: ItemStatus
  /** a plain line under the row: "Summary report: no individual readings", unmatched columns */
  note?: string
  problems?: string[]
  /** what this row would add */
  entries: Entry[]
  report?: WithingsReport
  /** a Withings file: rows already on record, left out */
  dupes?: number
  /** the Evolt values as read, for the edit sheet */
  raw?: Record<string, unknown>
  include: boolean
}

export interface Existing {
  id: string
  date: string
  time?: string | null
  device?: string | null
  source?: string | null
  weight?: unknown
  estimated?: boolean
}

export interface ExistingInput {
  measurements: Existing[]
  /** Apple Health weigh-ins (Withings through Health): date and weight */
  health?: Array<{ date: string; weight?: number | null }>
  reports?: WithingsReport[]
}

const isScan = (m: Existing) => m.source === 'scan'
const close = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 0.1 + 1e-9

/**
 * Already on record: the same device on the same date and time, or the same
 * date and a weight within 0.1 kg (scans against scans, scale readings
 * against scale readings and Health weigh-ins).
 */
export function isDuplicate(e: Entry, existing: ExistingInput): boolean {
  const scan = e.source === 'scan'
  const pool = existing.measurements.filter((m) => (scan ? isScan(m) : !isScan(m)))
  const dev = (e.device || '').toLowerCase()
  for (const m of pool) {
    if (m.date !== e.date) continue
    if (e.time && m.time && m.time === e.time && (m.device || '').toLowerCase() === dev) return true
    if (!m.estimated && close(m.weight, e.weight)) return true
  }
  if (!scan) for (const h of existing.health || []) if (h.date === e.date && close(h.weight, e.weight)) return true
  return false
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Apr 2024" */
const monthYear = (d: string) => `${MONTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`

const fmt1 = (v: unknown) => (typeof v === 'number' ? v : null)

// ------------------------------------------------------------- each file

export function evoltItem(file: string, lines: PdfLine[], existing: ExistingInput): ImportItem {
  const read = parseEvoltLines(lines)
  const check = checkEvolt(read.raw)
  const { entry } = scanFromImport(read.raw)
  return finishScan({
    key: `${file}#evolt`, file, kind: 'evolt', what: 'Evolt 360 scan', raw: read.raw,
    problems: check.ok ? undefined : check.problems,
  }, entry, check.ok, existing)
}

function finishScan(base: Partial<ImportItem> & { key: string; file: string; kind: ItemKind; what: string }, entry: ScanEntry | null, ok: boolean, existing: ExistingInput): ImportItem {
  const status: ItemStatus = !entry || !ok ? 'check' : isDuplicate(entry, existing) ? 'duplicate' : 'new'
  return {
    ...base,
    date: entry?.date ?? (typeof base.raw?.date === 'string' ? base.raw.date : null),
    weight: fmt1(entry?.weight ?? base.raw?.weight_kg),
    bodyFat: fmt1(entry?.bodyFat ?? base.raw?.body_fat_pct),
    status,
    entries: entry ? [entry] : [],
    include: status === 'new',
  }
}

/** A Needs-a-check scan after the edit sheet: read again from the corrected values. */
export function recheckEvolt(item: ImportItem, raw: Record<string, unknown>, existing: ExistingInput, acceptAsIs = false): ImportItem {
  const check = checkEvolt(raw)
  const { entry } = scanFromImport(raw)
  const next = finishScan({ key: item.key, file: item.file, kind: item.kind, what: item.what, raw, problems: check.ok ? undefined : check.problems }, entry, check.ok || (acceptAsIs && !!entry), existing)
  if (acceptAsIs && entry && !check.ok) {
    next.entries = [{ ...entry, importNote: `Imported after a check: ${check.problems.join('; ')}` }]
    next.note = 'Kept as read, after a check'
  }
  return next
}

export function withingsItems(file: string, text: string, existing: ExistingInput): ImportItem[] {
  const read = readWithingsCsv(text)
  const note = read.columns.unmatched.length ? `Columns not used: ${read.columns.unmatched.join(', ')}` : undefined
  if (read.error) return [{ key: `${file}#csv`, file, kind: 'unknown', what: 'Not a Withings export', date: null, weight: null, bodyFat: null, status: 'unknown', note: read.error, entries: [], include: false }]
  const fresh = read.readings.filter((r) => !isDuplicate(r, existing))
  const dupes = read.readings.length - fresh.length
  const last = read.readings[read.readings.length - 1]
  const first = read.readings[0]
  const n = read.readings.length
  return [{
    key: `${file}#csv`, file, kind: 'withings',
    what: `Withings weigh-ins, ${n} row${n === 1 ? '' : 's'}${first.date !== last.date ? ` from ${monthYear(first.date)}` : ''}`,
    date: last.date, weight: fmt1(last.weight), bodyFat: fmt1(last.bodyFat),
    status: fresh.length ? 'new' : 'duplicate',
    note: [dupes ? `${dupes} already on record, skipped` : null, note].filter(Boolean).join(' · ') || undefined,
    entries: fresh, dupes, include: fresh.length > 0,
  }]
}

export function withingsReportItem(file: string, lines: PdfLine[], existing: ExistingInput): ImportItem {
  const report = parseWithingsReport(lines, file)
  if (!report) return unknownItem(file)
  const dup = (existing.reports || []).some((r) => r.from === report.from && r.to === report.to)
  return {
    key: `${file}#report`, file, kind: 'withings-report', what: 'Withings report', date: report.to,
    weight: report.weight, bodyFat: report.bodyFat,
    status: dup ? 'duplicate' : 'new',
    note: 'Summary report: no individual readings',
    entries: [], report, include: !dup,
  }
}

export function jsonItems(file: string, json: unknown, existing: ExistingInput): ImportItem[] {
  const parsed = parseScanImport(json)
  if (!parsed.entries.length) return [{ ...unknownItem(file), note: parsed.errors.join(' ') || 'No scans in the file.' }]
  return parsed.entries.map((e, i) => {
    const warned = parsed.warnings.filter((w) => w.startsWith(`${e.date}:`))
    return finishScan({ key: `${file}#${i}`, file, kind: 'json', what: `${e.device} scan`, problems: warned.length ? warned : undefined }, e, true, existing)
  })
}

export const unknownItem = (file: string): ImportItem => ({
  key: `${file}#unknown`, file, kind: 'unknown', what: 'Not an Evolt or Withings file', date: null, weight: null, bodyFat: null, status: 'unknown', entries: [], include: false,
})

/** A PDF by what its text says it is. */
export function pdfItem(file: string, lines: PdfLine[], existing: ExistingInput): ImportItem {
  const text = lines.map((l) => l.text).join('\n')
  if (isEvoltText(text)) return evoltItem(file, lines, existing)
  if (isWithingsReportText(text)) return withingsReportItem(file, lines, existing)
  return unknownItem(file)
}

// ------------------------------------------------------- the whole list

/**
 * Rows in the same batch can repeat each other (the same report dropped
 * twice, an export holding a scan already in another file): the later one is
 * a duplicate.
 */
export function settleBatch(items: ImportItem[]): ImportItem[] {
  const seen: Existing[] = []
  const periods = new Set<string>()
  return items.map((it) => {
    if (it.kind === 'withings-report' && it.report) {
      const k = `${it.report.from}|${it.report.to}`
      if (periods.has(k) && it.status === 'new') return { ...it, status: 'duplicate', include: false }
      periods.add(k)
      return it
    }
    if (!it.entries.length || it.status === 'unknown') return it
    if (it.kind === 'withings') {
      const fresh = it.entries.filter((e) => !isDuplicate(e, { measurements: seen }))
      seen.push(...(fresh as Existing[]))
      if (fresh.length === it.entries.length) return it
      const dupes = (it.dupes || 0) + it.entries.length - fresh.length
      return { ...it, entries: fresh, dupes, status: fresh.length ? it.status : 'duplicate', include: it.include && fresh.length > 0, note: `${dupes} already on record, skipped` }
    }
    const e = it.entries[0]
    if (it.status !== 'check' && isDuplicate(e, { measurements: seen })) return { ...it, status: 'duplicate', include: false }
    seen.push(e as Existing)
    return it
  })
}

export interface Payload { measurements: Entry[]; reports: WithingsReport[] }

/** What one press of Import writes: the included rows only. */
export function importPayload(items: ImportItem[]): Payload {
  const included = items.filter((i) => i.include && i.status !== 'unknown')
  return {
    measurements: included.flatMap((i) => i.entries),
    reports: included.filter((i) => i.report).map((i) => i.report as WithingsReport),
  }
}

const unitsOf = (i: ImportItem) => (i.kind === 'withings-report' ? 1 : i.kind === 'withings' ? i.entries.length + (i.dupes || 0) : Math.max(1, i.entries.length))

/** "Added 2, skipped 1": scans, weigh-ins and reports counted one each. */
export function importCounts(items: ImportItem[]): { add: number; skipped: number; scans: number } {
  let add = 0
  let skipped = 0
  let scans = 0
  for (const i of items) {
    if (i.status === 'unknown') { skipped++; continue }
    if (i.include) {
      const n = i.kind === 'withings-report' ? 1 : i.entries.length
      add += n
      if (i.kind === 'evolt' || i.kind === 'json') scans += n
      skipped += i.dupes || 0
    } else skipped += unitsOf(i)
  }
  return { add, skipped, scans }
}

/** "Import 2 scans", or "Import 40 items" when weigh-ins or reports are in. */
export function importButton(items: ImportItem[]): string {
  const { add, scans } = importCounts(items)
  if (add === scans) return `Import ${add} scan${add === 1 ? '' : 's'}`
  return `Import ${add} item${add === 1 ? '' : 's'}`
}

export const summaryWords = (added: number, skipped: number) => `Added ${added}, skipped ${skipped}`
