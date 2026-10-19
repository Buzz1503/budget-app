// What store v22 does to body entries, as a pure function so it can be tested.
//
// 1. Scan values that earlier versions kept under `extras` become first-class
//    fields on the entry.
// 2. The bundled Evolt history is imported once (duplicates on date, time and
//    device are left alone; an untimed copy of the same scan is replaced by
//    the timed one).
// 3. The estimated 13 Jan 2025 starting scan exists, is kept off the charts,
//    and is the starting point unless another one was chosen.

import { parseScanImport, planScanImport, applyScanImport } from './scanImport'
import { EVOLT_START_SCAN, EVOLT_START_ID } from './scanFields'
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
  list = [...list.filter((m) => m.id !== EVOLT_START_ID), start].sort((a, b) => a.date.localeCompare(b.date))
  const keep = bodyStart?.date && bodyStart.entryId !== EVOLT_START_ID
  return {
    measurements: list,
    bodyStart: keep ? (bodyStart as BodyStart) : startFromEntry(start),
    imported: plan.add.length + plan.replace.length,
    replaced: plan.replace.length,
  }
}
