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

import { dailySeries, familySeries, pickFamily, getLatestMeasurement, FAMILY_FIELDS } from './bodySeries'
import { familyOfEntry } from './sources'
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

/** The family a starting point's own values came from (an Evolt start is Evolt; typed-in values are Scale). */
const startFamily = (start: BodyStart): string => (start.device ? familyOfEntry({ date: start.date, source: 'scan', device: start.device }) : 'scale')

/**
 * The value a field's "since" delta starts from, or null to hide the delta.
 *
 *  - Weight: the value set on the starting point (105.6), for the Scale view
 *    and the Evolt view alike.
 *  - Body fat, fat mass, lean mass: the Evolt view uses the starting point's
 *    own values (they are an Evolt entry); the Scale view uses its first Scale
 *    reading on or after the starting date, never the Evolt estimate.
 *  - Every other field: the value set, else its first reading on or after the
 *    starting date.
 */
export function getStartValue(field: BodyField, start: BodyStart | null, input: BodyInput, { family = null }: { family?: string | null } = {}): StartValue | null {
  if (!start?.date) return null
  const set = start.values?.[field]
  const hasSet = set != null && Number.isFinite(Number(set))
  const famField = FAMILY_FIELDS.has(field)
  const own = startFamily(start)
  if (hasSet && (!famField || family == null || family === own)) {
    return { value: Number(set), date: start.date, device: start.device ?? null, fromSetting: true, family: famField ? own : null }
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
 * A field's change since the starting point. Without a family, weight and the
 * other fields use the newest reading from any source; body fat, fat mass and
 * lean mass compare one family with itself. With a family (the one a chart is
 * showing) every field reads that family on both sides.
 */
export function compareSinceStart(field: BodyField, start: BodyStart | null, input: BodyInput, today: string, { family = null }: { family?: string | null } = {}): SinceStart {
  const famField = FAMILY_FIELDS.has(field)
  if (!famField && !family) {
    const s = getStartValue(field, start, input)
    const latest = getLatestMeasurement(field, input, today)
    return { start: s, latest, delta: sinceStart(latest?.value, s), family: null }
  }
  const chosen = family ?? (start ? (getStartValue(field, start, input)?.family ?? pickFamily(field, input, start.date, today)) : null)
  const s = getStartValue(field, start, input, { family: chosen })
  const series = chosen ? familySeries(field, input, chosen) : []
  const latest = series.length ? series[series.length - 1] : null
  return { start: s, latest, delta: sinceStart(latest?.value, s), family: chosen }
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
