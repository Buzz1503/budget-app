// What store v22 does to body entries, as a pure function so it can be tested.
//
// 1. Scan values that earlier versions kept under `extras` become first-class
//    fields on the entry.
// 2. The bundled Evolt history is imported once (duplicates on date, time and
//    device are left alone; an untimed copy of the same scan is replaced by
//    the timed one).
// 3. The estimated starting scan (1 Jan 2025, Evolt) exists and is the starting
//    point unless another one was chosen. It is a point on Evolt charts.

import { parseScanImport, planScanImport, applyScanImport } from './scanImport'
import { EVOLT_START_SCAN, EVOLT_START_ID, EVOLT_START_LEGACY_IDS } from './scanFields'
import { entryValues } from './startPoint'
import type { BodyStart } from './startPoint'

type Entry = { id: string; date: string; [k: string]: unknown }

/** Lift `extras` onto the entry itself; keys already on the entry win. */
export function flattenExtras<T extends Entry>(m: T): T {
  if (!m.extras || typeof m.extras !== 'object') return m
  const { extras, ...rest } = m as T & { extras: Record<string, unknown> }
  return { ...extras, ...rest } as unknown as T
}

export const startFromEntry = (e: Entry & { label?: unknown; device?: unknown }): BodyStart => ({
  date: e.date,
  label: (e.label as string) || null,
  values: entryValues(e),
  entryId: e.id,
  device: (e.device as string) || null,
})

const isStartId = (id: unknown) => id === EVOLT_START_ID || EVOLT_START_LEGACY_IDS.includes(id as string)

/**
 * Move the estimated starting entry from 13 Jan 2025 to 1 Jan 2025. The old
 * entry is replaced by the new one (same values, new date and label, no longer
 * kept off the charts), and a starting point that pointed at it follows. If it
 * was deleted it stays deleted. A starting point chosen by hand stays as it is.
 */
export function moveStartEntry(measurements: Entry[], bodyStart: BodyStart | null | undefined): { measurements: Entry[]; bodyStart: BodyStart | null; moved: boolean } {
  const old = measurements.find((m) => EVOLT_START_LEGACY_IDS.includes(m.id))
  if (!old) return { measurements, bodyStart: bodyStart ?? null, moved: false }
  const start = { ...EVOLT_START_SCAN }
  const list = [...measurements.filter((m) => !isStartId(m.id)), start].sort((a, b) => a.date.localeCompare(b.date))
  const followed = bodyStart?.entryId && isStartId(bodyStart.entryId) ? startFromEntry(start) : (bodyStart ?? null)
  return { measurements: list, bodyStart: followed, moved: true }
}

/** The 13 Jan 2025 date the estimated starting entry used to sit on. */
const LEGACY_START_DATE = '2025-01-13'

/**
 * A starting point that still points at the 13 Jan 2025 scan (a 102.6 kg start
 * and "since 13 Jan 2025") goes back to the estimated entry on 1 Jan 2025
 * (105.6 kg, "Start (estimated)"). The entry is recreated when it is missing
 * and refreshed when it is there; the 13 Jan scan itself stays as a normal
 * scan. Any other starting point, one chosen by hand elsewhere, is left alone.
 */
export function repairStartPoint(measurements: Entry[], bodyStart: BodyStart | null | undefined): { measurements: Entry[]; bodyStart: BodyStart | null; repaired: boolean } {
  if (bodyStart?.date !== LEGACY_START_DATE) return { measurements, bodyStart: bodyStart ?? null, repaired: false }
  const start = { ...EVOLT_START_SCAN }
  const list = [...measurements.filter((m) => !isStartId(m.id)), start].sort((a, b) => a.date.localeCompare(b.date))
  return { measurements: list, bodyStart: startFromEntry(start), repaired: true }
}

export function applyScanHistory(
  measurements: Entry[],
  bodyStart: BodyStart | null | undefined,
  bundled: unknown,
): { measurements: Entry[]; bodyStart: BodyStart; imported: number; replaced: number } {
  let list = measurements.map(flattenExtras)
  const parsed = parseScanImport(bundled)
  const plan = planScanImport(list as never, parsed.entries, 'skip')
  list = applyScanImport(list, plan)
  // the starting scan: created if absent, brought up to date if present
  const start = { ...EVOLT_START_SCAN }
  list = [...list.filter((m) => !isStartId(m.id)), start].sort((a, b) => a.date.localeCompare(b.date))
  const keep = bodyStart?.date && !isStartId(bodyStart.entryId)
  return {
    measurements: list,
    bodyStart: keep ? (bodyStart as BodyStart) : startFromEntry(start),
    imported: plan.add.length + plan.replace.length,
    replaced: plan.replace.length,
  }
}
