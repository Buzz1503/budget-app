// Importing body-composition scans (schema pepito-scan-import/v1).
//
// parseScanImport turns a file into scan entries and says what is wrong with
// it; planScanImport decides, scan by scan, whether it is new, a duplicate of
// one already on record (same date, time and device), or the timed version of
// an untimed copy of the same scan, which it replaces; applyScanImport writes
// that plan. Nothing here touches anything but scan entries.

import { SCAN_METRICS, SEGMENTS } from './scanFields'

export const SCAN_SCHEMA = 'pepito-scan-import/v1'

export type ImportMode = 'merge' | 'skip'

export interface ScanEntry {
  id: string
  date: string
  time: string | null
  source: 'scan'
  device: string
  [field: string]: unknown
}

export interface ParsedImport {
  entries: ScanEntry[]
  errors: string[]
  warnings: string[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** The key two copies of one scan share. */
export const scanKey = (e: { date: string; time?: string | null; device?: string | null }) => `${e.date}|${e.time || ''}|${(e.device || '').toLowerCase()}`

export const scanId = (date: string, time: string | null, device: string) => `scan-${slug(device)}-${date}${time ? `-${time.replace(':', '')}` : ''}`

const byImportKey = Object.fromEntries(SCAN_METRICS.filter((m) => m.importKey).map((m) => [m.importKey as string, m.key]))

/** One scan from the file, as an entry. Returns null with a reason when it cannot be used. */
export function scanFromImport(raw: Record<string, unknown>): { entry: ScanEntry | null; error?: string; warnings: string[] } {
  const warnings: string[] = []
  const date = typeof raw.date === 'string' ? raw.date : ''
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { entry: null, error: `a scan has no valid date (${String(raw.date)})`, warnings }
  const time = typeof raw.time === 'string' && TIME.test(raw.time) ? raw.time : null
  const device = typeof raw.device === 'string' && raw.device.trim() ? raw.device.trim() : 'Other'
  const weight = num(raw.weight_kg)
  if (weight == null) return { entry: null, error: `the ${date} scan has no weight`, warnings }

  const entry: ScanEntry = { id: scanId(date, time, device), date, time, source: 'scan', device }
  for (const [ik, key] of Object.entries(byImportKey)) {
    const v = num(raw[ik])
    if (v != null) entry[key] = v
  }
  if (num(raw.height_cm) != null) entry.heightCm = raw.height_cm
  if (num(raw.age) != null) entry.ageAtScan = raw.age
  const seg = (raw.segmental || {}) as Record<string, { lean_kg?: unknown; fat_kg?: unknown }>
  for (const s of SEGMENTS) {
    const lean = num(seg[s.importKey]?.lean_kg)
    const fat = num(seg[s.importKey]?.fat_kg)
    if (lean != null) entry[`${s.key}Lean`] = lean
    if (fat != null) entry[`${s.key}Fat`] = fat
  }
  const bal = (raw.balance || {}) as Record<string, unknown>
  if (bal.upper_lower || bal.left_right) entry.balance = { upperLower: bal.upper_lower ?? null, leftRight: bal.left_right ?? null }
  const status: Record<string, string> = {}
  for (const [ik, v] of Object.entries((raw.status || {}) as Record<string, unknown>)) {
    if (byImportKey[ik] && typeof v === 'string') status[byImportKey[ik]] = v
  }
  if (Object.keys(status).length) entry.status = status
  const ranges: Record<string, [number, number]> = {}
  for (const [ik, v] of Object.entries((raw.reference_ranges || {}) as Record<string, unknown>)) {
    if (byImportKey[ik] && Array.isArray(v) && v.length === 2 && v.every((x) => num(x) != null)) ranges[byImportKey[ik]] = [v[0] as number, v[1] as number]
  }
  if (Object.keys(ranges).length) entry.ranges = ranges
  const rec = (raw.evolt_recommendations || {}) as Record<string, unknown>
  const recOut: Record<string, [number, number]> = {}
  for (const [ik, key] of [['calories_kcal', 'caloriesKcal'], ['protein_g', 'proteinG'], ['carbs_g', 'carbsG'], ['fat_g', 'fatG']]) {
    const v = rec[ik]
    if (Array.isArray(v) && v.length === 2 && v.every((x) => num(x) != null)) recOut[key] = [v[0] as number, v[1] as number]
  }
  if (Object.keys(recOut).length) entry.recommendations = recOut

  // the scan's own sums, checked to a tenth of a kilo
  const close = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) <= 0.15
  const n = (k: string) => (typeof entry[k] === 'number' ? (entry[k] as number) : null)
  if (n('leanMass') != null && n('fatMass') != null && !close(weight, (n('leanMass') as number) + (n('fatMass') as number))) warnings.push(`${date}: lean + fat does not add up to weight`)
  if (n('totalBodyWater') != null && n('icf') != null && n('ecf') != null && !close(n('totalBodyWater'), (n('icf') as number) + (n('ecf') as number))) warnings.push(`${date}: ICF + ECF does not add up to total body water`)
  return { entry, warnings }
}

export function parseScanImport(json: unknown): ParsedImport {
  const out: ParsedImport = { entries: [], errors: [], warnings: [] }
  const doc = json as { schema?: unknown; scans?: unknown }
  if (!doc || typeof doc !== 'object') { out.errors.push('The file is not a scan import.'); return out }
  if (doc.schema !== SCAN_SCHEMA) { out.errors.push(`Expected schema ${SCAN_SCHEMA}, found ${String(doc.schema ?? 'none')}.`); return out }
  if (!Array.isArray(doc.scans) || !doc.scans.length) { out.errors.push('The file has no scans.'); return out }
  const seen = new Set<string>()
  for (const raw of doc.scans) {
    const r = scanFromImport((raw || {}) as Record<string, unknown>)
    out.warnings.push(...r.warnings)
    if (!r.entry) { out.errors.push(r.error as string); continue }
    const k = scanKey(r.entry)
    if (seen.has(k)) { out.warnings.push(`${r.entry.date}: listed twice in the file, kept once`); continue }
    seen.add(k)
    out.entries.push(r.entry)
  }
  out.entries.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
  return out
}

export interface ImportPlan {
  add: ScanEntry[]
  /** same date, time and device as one on record; merged in or skipped */
  duplicates: Array<{ existingId: string; entry: ScanEntry }>
  /** an untimed copy of the same scan, replaced by the timed one */
  replace: Array<{ existingId: string; entry: ScanEntry }>
  mode: ImportMode
}

interface Existing { id: string; date: string; time?: string | null; device?: string | null; source?: string | null; estimated?: boolean }

export function planScanImport(existing: Existing[], incoming: ScanEntry[], mode: ImportMode): ImportPlan {
  const plan: ImportPlan = { add: [], duplicates: [], replace: [], mode }
  const scans = existing.filter((m) => m.source === 'scan')
  const used = new Set<string>()
  for (const e of incoming) {
    const dup = scans.find((m) => !used.has(m.id) && scanKey(m) === scanKey(e))
    if (dup) { used.add(dup.id); plan.duplicates.push({ existingId: dup.id, entry: e }); continue }
    // an estimated entry (an adjusted starting point) is never replaced
    const untimed = e.time ? scans.find((m) => !used.has(m.id) && !m.time && !m.estimated && m.date === e.date && (m.device || '').toLowerCase() === e.device.toLowerCase()) : null
    if (untimed) { used.add(untimed.id); plan.replace.push({ existingId: untimed.id, entry: e }); continue }
    plan.add.push(e)
  }
  return plan
}

export function applyScanImport<T extends { id: string; date: string }>(measurements: T[], plan: ImportPlan): T[] {
  const removed = new Set(plan.replace.map((r) => r.existingId))
  const merged = new Map(plan.mode === 'merge' ? plan.duplicates.map((d) => [d.existingId, d.entry]) : [])
  const out = measurements
    .filter((m) => !removed.has(m.id))
    .map((m) => (merged.has(m.id) ? { ...m, ...merged.get(m.id), id: m.id } as T : m))
  return [...out, ...(plan.add as unknown as T[]), ...(plan.replace.map((r) => r.entry) as unknown as T[])]
    .sort((a, b) => a.date.localeCompare(b.date))
}

export const planCounts = (p: ImportPlan) => ({
  new: p.add.length,
  replaced: p.replace.length,
  duplicates: p.duplicates.length,
  written: p.add.length + p.replace.length + (p.mode === 'merge' ? p.duplicates.length : 0),
})
