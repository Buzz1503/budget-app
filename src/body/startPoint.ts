// The starting point every "since" delta is measured from.
//
// "Since start" used to mean the oldest record on file, which stopped meaning
// anything once Apple Health backfilled a year of older weigh-ins. Now there is
// one starting point: either one the user set (a date, an optional label, any
// values they gave it, and the entry it came from), or by default the date the
// first tracked compound was started. For each field the start value is the
// value set for that field, else the first value of the same field on or after
// the starting date, else nothing (and the delta is hidden). Fields are never
// mixed: a scan's skeletal muscle mass is not the app's muscle mass.

import { dailySeries, familySeries, familyOfDevice, pickFamily, getLatestMeasurement, FAMILY_FIELDS } from './bodySeries'
import type { BodyField, BodyInput, BodySource, DayPoint } from './bodySeries'

export interface BodyStart {
  date: string
  label?: string | null
  /** values given to the starting point, field by field */
  values?: Record<string, number | null | undefined>
  /** the body entry it was set from, if any */
  entryId?: string | null
  /** where the values came from: scan device, Withings, another app */
  device?: string | null
}

export interface StartValue {
  value: number
  date: string
  /** device or source the value came from; null when unknown (typed in) */
  device: string | null
  fromSetting: boolean
  /** device family, for body fat, fat mass and lean mass */
  family?: string | null
}

/**
 * When nothing is set: the date the first tracked compound was started, else
 * (nothing tracked yet) the first reading on record.
 */
export function defaultStartDate(compoundStarts: string[], input: BodyInput): string | null {
  const starts = compoundStarts.filter(Boolean).sort()
  if (starts.length) return starts[0]
  const dates = [
    ...(input.measurements || []).filter((m) => !m.hiddenFromCharts).map((m) => m.date),
    ...(input.health || []).map((h) => h.date),
  ].sort()
  return dates[0] || null
}

/** The starting point in force: the one set, or the default. */
export function effectiveStart(start: BodyStart | null | undefined, compoundStarts: string[], input: BodyInput): BodyStart | null {
  if (start?.date) return start
  const date = defaultStartDate(compoundStarts, input)
  return date ? { date, label: null, values: {}, entryId: null, device: null } : null
}

const deviceOf = (source: BodySource, label: string): string | null => (source === 'manual' ? null : label)

/**
 * The value a field's "since" delta starts from, or null to hide the delta.
 * For body fat, fat mass and lean mass the fallback reads one device family
 * (the one given, else the default for the window from the start date on).
 */
export function getStartValue(field: BodyField, start: BodyStart | null, input: BodyInput, { family = null }: { family?: string | null } = {}): StartValue | null {
  if (!start?.date) return null
  const set = start.values?.[field]
  const famField = FAMILY_FIELDS.has(field)
  if (set != null && Number.isFinite(Number(set))) {
    return { value: Number(set), date: start.date, device: start.device ?? null, fromSetting: true, family: famField ? familyOfDevice(start.device) : null }
  }
  const fam = famField ? (family ?? pickFamily(field, input, start.date, '9999-12-31')) : null
  const series = famField ? (fam ? familySeries(field, input, fam) : []) : dailySeries(field, input)
  const first = series.find((p) => p.date >= start.date)
  if (!first) return null
  return { value: first.value, date: first.date, device: deviceOf(first.source, first.sourceLabel), fromSetting: false, family: famField ? fam : null }
}

export interface SinceStart {
  start: StartValue | null
  latest: DayPoint | null
  delta: number | null
  /** the device family both sides come from (body fat, fat mass, lean mass), else null */
  family: string | null
}

/**
 * A field's change since the starting point. Weight and the other fields use
 * the newest reading from any source; body fat, fat mass and lean mass compare
 * one device family with itself, the family the start value came from.
 */
export function compareSinceStart(field: BodyField, start: BodyStart | null, input: BodyInput, today: string): SinceStart {
  const s = getStartValue(field, start, input)
  if (!FAMILY_FIELDS.has(field)) {
    const latest = getLatestMeasurement(field, input, today)
    return { start: s, latest, delta: sinceStart(latest?.value, s), family: null }
  }
  const family = s?.family ?? (start ? pickFamily(field, input, start.date, today) : null)
  const series = family ? familySeries(field, input, family) : []
  const latest = series.length ? series[series.length - 1] : null
  return { start: s, latest, delta: sinceStart(latest?.value, s), family }
}

/** Latest minus start, or null when either is missing. */
export function sinceStart(latest: number | null | undefined, start: StartValue | null): number | null {
  if (latest == null || !start) return null
  return Math.round((latest - start.value) * 100) / 100
}

/**
 * True when the start and the latest reading came from two different, known
 * devices (an Evolt scan against a Withings scale). Typed-in values have no
 * known device, so they never raise it.
 */
export function differentDevices(start: StartValue | null, latestDevice: string | null | undefined): boolean {
  return !!(start?.device && latestDevice && start.device !== latestDevice)
}

/** The numeric measurement values on an entry, for copying into a starting point. */
export function entryValues(entry: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(entry)) {
    if (['id', 'date', 'time', 'heightCm', 'ageAtScan'].includes(k)) continue
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}
