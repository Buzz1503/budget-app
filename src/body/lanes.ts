// A compound's lane under a chart: its dose as a step line, a label at each
// change ("1.5 mg", "3 mg", "stopped"), and the time on it shaded. Pure: the
// chart only draws what this returns.

export interface DosePoint { date: string; kind: string; to?: number | null; unit?: string | null }
export interface Run { startedOn: string; endedOn?: string | null }

export interface LaneSegment { from: string; to: string; dose: number; unit: string | null }
export interface LaneChange { date: string; label: string; kind: 'dose' | 'stop' }
export interface Lane { segments: LaneSegment[]; changes: LaneChange[]; spans: Array<{ from: string; to: string }>; maxDose: number }

const DOSE_KINDS = new Set(['start', 'restart', 'prior', 'step-up', 'override'])
const MS = 86400000
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / MS)
const fromNum = (n: number) => new Date(n * MS).toISOString().slice(0, 10)
const fmt = (v: number, unit: string | null) => `${Number.isInteger(v) ? v : Math.round(v * 100) / 100}${unit ? ` ${unit}` : ''}`

/** The lane for one compound over [from, to]. */
export function laneFor(points: DosePoint[], runs: Run[], from: string, to: string): Lane {
  const pts = points.filter((p) => DOSE_KINDS.has(p.kind) || p.kind === 'stop').sort((a, b) => a.date.localeCompare(b.date))
  const segments: LaneSegment[] = []
  const changes: LaneChange[] = []
  let cur: { dose: number; unit: string | null; since: string } | null = null
  const close = (end: string) => {
    if (!cur) return
    const a = cur.since < from ? from : cur.since
    const b = end > to ? to : end
    if (a <= b) segments.push({ from: a, to: b, dose: cur.dose, unit: cur.unit })
  }
  for (const p of pts) {
    if (p.kind === 'stop') {
      if (cur) close(fromNum(dayNum(p.date) - 1))
      cur = null
      if (p.date >= from && p.date <= to) changes.push({ date: p.date, label: 'stopped', kind: 'stop' })
      continue
    }
    if (p.to == null) continue
    if (cur && cur.dose === p.to) continue
    if (cur) close(fromNum(dayNum(p.date) - 1))
    cur = { dose: p.to, unit: p.unit ?? null, since: p.date }
    if (p.date >= from && p.date <= to) changes.push({ date: p.date, label: fmt(p.to, p.unit ?? null), kind: 'dose' })
  }
  close(to)
  const spans = runs
    .map((r) => ({ from: r.startedOn < from ? from : r.startedOn, to: !r.endedOn || r.endedOn > to ? to : r.endedOn }))
    .filter((s) => s.from <= s.to && s.from <= to)
  return { segments, changes, spans, maxDose: Math.max(0, ...segments.map((s) => s.dose)) }
}

export const MAX_LANES = 4

/** "3 mg" for a compound on a date: the dose of the segment covering it, or null when it was not on it. */
export function doseAt(lane: Pick<Lane, 'segments'>, date: string): string | null {
  const seg = lane.segments.find((x) => x.from <= date && date <= x.to)
  return seg ? fmt(seg.dose, seg.unit) : null
}

/**
 * What each lane says at a date, for the scrub readout: "Retatrutide 3 mg",
 * "Sauna 25 min". A lane with nothing at that date says nothing.
 */
export function laneValuesAt(
  lanes: Array<{ name: string; kind?: string; segments: LaneSegment[]; dots?: Array<{ date: string; minutes: number }> }>,
  date: string,
): string[] {
  const out: string[] = []
  for (const l of lanes) {
    if (l.kind === 'dots') {
      const hit = (l.dots || []).find((d) => d.date === date)
      if (hit) out.push(`${l.name} ${hit.minutes} min`)
      continue
    }
    const dose = doseAt(l, date)
    if (dose) out.push(`${l.name} ${dose}`)
  }
  return out
}
