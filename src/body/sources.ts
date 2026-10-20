// The three families body data comes from. Nothing else is ever mixed in.
//
//   Scale  Withings, every weight or body fat typed in by hand, and weight from
//          other apps (MyFitnessPal, Hevy and so on). Inside Scale the same-day
//          order is Withings, then typed in, then other apps.
//   Evolt  Every Evolt 360 scan, and the estimated starting entry.
//   DEXA   Any other scan. It has its own page, compares only with itself and
//          never appears on a chart.
//
// The family is read from the entry each time (a scan's device decides it), so
// correcting a device moves the entry. The migration also stamps `family` and
// `originalSource` on every entry as a record of where it came from. Nothing is
// deleted and no value changes: this only decides which line an entry joins.

export type SourceFamily = 'scale' | 'evolt' | 'dexa'

export const FAMILIES: SourceFamily[] = ['scale', 'evolt', 'dexa']
export const FAMILY_LABEL: Record<string, string> = { scale: 'Scale', evolt: 'Evolt', dexa: 'DEXA' }

/** Source families a chart can offer; DEXA is never one of them. */
export const CHART_FAMILIES: SourceFamily[] = ['scale', 'evolt']

/** Same-day order inside Scale. A higher number wins. */
export const SCALE_RANK: Record<string, number> = { withings: 3, manual: 2, other: 1 }

export interface EntryLike {
  id?: string
  date: string
  source?: string | null
  device?: string | null
  scanType?: string | null
  family?: string | null
  originalSource?: string | null
  [k: string]: unknown
}

const SCAN_DEVICE = /evolt|dexa|inbody/i

/** Is this entry a body scan (any device)? A device on the entry counts even if the scan box was not ticked. */
export function isScanEntry(m: EntryLike): boolean {
  return m.source === 'scan' || SCAN_DEVICE.test(m.device || '') || SCAN_DEVICE.test(m.scanType || '')
}

export const isEvoltEntry = (m: EntryLike): boolean => isScanEntry(m) && /evolt/i.test(`${m.device || ''} ${m.scanType || ''}`)

/** Evolt scans are Evolt, every other scan is DEXA, everything else is Scale. */
export function familyOfEntry(m: EntryLike): SourceFamily {
  if (!isScanEntry(m)) return 'scale'
  return isEvoltEntry(m) ? 'evolt' : 'dexa'
}

export interface FamilyMigration<T extends EntryLike> {
  measurements: T[]
  /** entries now in DEXA that were not before (every non-Evolt scan) */
  dexa: T[]
  /** typed-in and other-app entries now in Scale */
  scale: number
  evolt: number
}

/**
 * Stamp every entry with its family and keep the source it had. An entry that
 * already carries `originalSource` keeps that one. `dexa` lists every entry
 * that lands in DEXA, for the report.
 */
export function migrateSourceFamilies<T extends EntryLike>(measurements: T[]): FamilyMigration<T> {
  const dexa: T[] = []
  let scale = 0
  let evolt = 0
  const out = measurements.map((m) => {
    const family = familyOfEntry(m)
    if (family === 'dexa') dexa.push(m)
    else if (family === 'evolt') evolt++
    else scale++
    return { ...m, family, originalSource: m.originalSource ?? (m.source || 'manual') } as T
  })
  return { measurements: out, dexa, scale, evolt }
}

/** The DEXA scans, oldest first. */
export const dexaScans = <T extends EntryLike>(measurements: T[]): T[] =>
  measurements.filter((m) => familyOfEntry(m) === 'dexa').sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')))

/** Which source a chart shows for a metric: the saved choice when it has data, else the default, else the first that has data. */
export function resolveSource(metric: string, available: string[], saved?: string | null): string | null {
  if (!available.length) return null
  if (saved && available.includes(saved)) return saved
  const preferred = metric === 'weight' ? 'scale' : 'evolt'
  return available.includes(preferred) ? preferred : available[0]
}
