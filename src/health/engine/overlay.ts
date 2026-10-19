// Labels for dose changes, and blood results for a chart's Bloods overlay,
// each clipped to the chart's date range.

import type { TimelinePoint } from './protocol'

/** "Reta", "Tirz", "BPC" — the first word of the name, at most four letters. */
export function shortName(name: string): string {
  const first = (name || '').split(/[\s-]+/)[0] || name
  return first.length > 4 ? first.slice(0, 4) : first
}

const fmtDose = (v: number | null | undefined, unit: string | null | undefined) =>
  v == null ? '' : ` ${Number.isInteger(v) ? v : Math.round(v * 100) / 100}${unit ? ` ${unit}` : ''}`

export interface DoseChangeLine {
  date: string
  compoundId: string
  kind: string
  label: string
}

const CHANGE_KINDS = new Set(['start', 'restart', 'prior', 'step-up', 'override', 'stop'])

/** Start, stop and dose-change lines with a short label, e.g. "Reta 4 mg". */
export function doseChanges(
  compounds: Array<{ id: string; name: string; points: TimelinePoint[] }>,
  from: string,
  to: string,
  only?: string[],
): DoseChangeLine[] {
  const out: DoseChangeLine[] = []
  for (const c of compounds) {
    if (only && !only.includes(c.id)) continue
    for (const p of c.points) {
      if (!CHANGE_KINDS.has(p.kind) || p.date < from || p.date > to) continue
      const label = p.kind === 'stop' ? `${shortName(c.name)} stopped` : `${shortName(c.name)}${fmtDose(p.to, p.unit)}`
      out.push({ date: p.date, compoundId: c.id, kind: p.kind, label })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export interface BloodPoint {
  marker: string
  date: string
  value: number
}

/** Blood results for the chosen markers, at their test dates, inside the range. */
export function bloodPoints(tests: Array<{ date: string; values?: Record<string, unknown> }>, markers: string[], from: string, to: string): BloodPoint[] {
  const out: BloodPoint[] = []
  for (const t of tests) {
    if (t.date < from || t.date > to) continue
    for (const m of markers) {
      const v = t.values?.[m]
      if (v != null && Number.isFinite(Number(v))) out.push({ marker: m, date: t.date, value: Number(v) })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.marker.localeCompare(b.marker))
}
