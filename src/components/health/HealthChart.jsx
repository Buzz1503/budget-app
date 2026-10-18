import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Layers, Check } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { addDays } from '../../health/tz'
import { doseTicks, doseChanges, tenureSpans, bloodPoints, shortName } from '../../health/engine/overlay'
import { affectsBaseline } from '../../health/engine/protocol'
import { useCompounds } from './useHealthModel'

export const HEALTH_RANGES = [
  { key: '30D', days: 30 },
  { key: '90D', days: 90 },
  { key: '6M', days: 182 },
  { key: '1Y', days: 365 },
]

const W = 320
const PAD = { l: 34, r: 30, t: 14, b: 22 }
const PLOT_H = 120
const TICK_ROW = 9

const dayNum = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000)
const fmt = (v, dp) => (v == null ? '—' : Number(v).toFixed(dp))

/** The same chip row the blood marker charts use. */
export function RangeChips({ value, onChange, ranges = HEALTH_RANGES }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Time range">
      {ranges.map((r) => {
        const on = value === r.key
        return (
          <button key={r.key} data-testid={`range-${r.key}`} data-on={on ? 'true' : 'false'} aria-pressed={on}
            onClick={() => onChange(r.key)} className="min-h-[34px] rounded-full px-3 text-xs font-bold"
            style={on ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            {r.key}
          </button>
        )
      })}
    </div>
  )
}

function Chip({ on, onClick, children, testid }) {
  return (
    <button onClick={onClick} data-testid={testid} data-on={on ? 'true' : 'false'} aria-pressed={on}
      className="flex min-h-[30px] items-center gap-1 rounded-full px-2.5 text-xs font-bold"
      style={on ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)', border: '1px solid transparent' }}>
      {on && <Check size={11} />}{children}
    </button>
  )
}

/**
 * A health metric over time, with the protocol behind it.
 *
 * Overlay layers: dose ticks (a row per compound along the bottom), dose
 * changes (vertical lines with a short label, on by default) and tenure bands
 * (faint spans for time on a compound). Blood markers can be added on a
 * second axis. The choice is kept per chart type.
 */
export default function HealthChart({
  chartType, title, unit = '', series, secondary = null, secondaryLabel = null,
  refLine = null, refLabel = null, dp = 0, defaultRange = '90D', testid, note = null,
}) {
  const [rangeKey, setRangeKey] = useState(defaultRange)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const compounds = useCompounds()
  const doseLogs = useStore((s) => s.doseLogs)
  const tests = useStore((s) => s.bloods?.tests || [])
  const saved = useStore((s) => s.healthSettings.overlays?.[chartType])
  const setChartOverlay = useStore((s) => s.setChartOverlay)
  const t = todayStr()

  const flagged = useMemo(() => compounds.filter(affectsBaseline).map((c) => c.id), [compounds])
  const ov = {
    ticks: saved?.ticks ?? false,
    changes: saved?.changes ?? true,
    tenure: saved?.tenure ?? false,
    compounds: saved?.compounds ?? flagged,
    bloods: saved?.bloods ?? [],
  }
  const setOv = (patch) => setChartOverlay(chartType, patch)
  const markerNames = useMemo(() => [...new Set(tests.flatMap((x) => Object.keys(x.values || {})))].sort(), [tests])

  const range = HEALTH_RANGES.find((r) => r.key === rangeKey) || HEALTH_RANGES[1]
  const from = addDays(t, -(range.days - 1))
  const to = t
  const pts = (series || []).filter((p) => p.value != null && p.date >= from && p.date <= to)
  const sec = (secondary || []).filter((p) => p.value != null && p.date >= from && p.date <= to)

  const nameOf = (id) => compounds.find((c) => c.id === id)?.name || id
  const ticks = ov.ticks ? doseTicks(doseLogs, ov.compounds, from, to).filter((r) => r.dates.length) : []
  const changes = ov.changes ? doseChanges(compounds, from, to, ov.compounds) : []
  const spans = ov.tenure ? tenureSpans(compounds, from, to, ov.compounds) : []
  const blood = ov.bloods.length ? bloodPoints(tests, ov.bloods, from, to) : []

  const plotBottom = PAD.t + PLOT_H
  const H = plotBottom + PAD.b + ticks.length * TICK_ROW
  const x0 = dayNum(from)
  const x1 = dayNum(to)
  const xFor = (d) => PAD.l + ((dayNum(d) - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r)

  const ys = [...pts.map((p) => p.value), ...sec.map((p) => p.value), ...(refLine != null ? [refLine] : [])]
  let lo = Math.min(...ys)
  let hi = Math.max(...ys)
  if (!Number.isFinite(lo)) { lo = 0; hi = 1 }
  if (hi === lo) { hi += 1; lo -= 1 }
  const pad = (hi - lo) * 0.12
  lo -= pad; hi += pad
  const yFor = (v) => plotBottom - ((v - lo) / (hi - lo)) * PLOT_H

  // blood markers on their own axis, one scale per marker would be unreadable:
  // each marker is scaled to the plot height on its own and labelled with its value
  const bloodY = (p) => {
    const vals = blood.filter((b) => b.marker === p.marker).map((b) => b.value)
    const bLo = Math.min(...vals)
    const bHi = Math.max(...vals)
    const f = bHi === bLo ? 0.5 : (p.value - bLo) / (bHi - bLo)
    return plotBottom - 10 - f * (PLOT_H - 20)
  }

  const line = (arr) => arr.map((p) => `${xFor(p.date).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(' ')
  const plottable = pts.length >= 2

  return (
    <div className="card p-3" data-testid={testid || `health-chart-${chartType}`} data-range={rangeKey}>
      <div className="flex items-center gap-2">
        <p className="t-caption min-w-0 flex-1" style={{ color: 'var(--text-2)' }}>{title}</p>
        <button onClick={() => setOverlayOpen((v) => !v)} data-testid="overlay-button" aria-expanded={overlayOpen}
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold"
          style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
          <Layers size={12} /> Overlay
        </button>
      </div>
      <div className="mt-2"><RangeChips value={rangeKey} onChange={setRangeKey} /></div>

      {overlayOpen && (
        <div className="mt-2 space-y-2 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="overlay-panel">
          <div className="flex flex-wrap gap-1.5">
            <Chip on={ov.ticks} onClick={() => setOv({ ticks: !ov.ticks })} testid="ov-ticks">Dose ticks</Chip>
            <Chip on={ov.changes} onClick={() => setOv({ changes: !ov.changes })} testid="ov-changes">Dose changes</Chip>
            <Chip on={ov.tenure} onClick={() => setOv({ tenure: !ov.tenure })} testid="ov-tenure">Time on compound</Chip>
          </div>
          <p className="t-caption" style={{ color: 'var(--text-3)' }}>Compounds</p>
          <div className="flex flex-wrap gap-1.5">
            {compounds.map((c) => {
              const on = ov.compounds.includes(c.id)
              return (
                <Chip key={c.id} on={on} testid="ov-compound"
                  onClick={() => setOv({ compounds: on ? ov.compounds.filter((x) => x !== c.id) : [...ov.compounds, c.id] })}>
                  {c.name}
                </Chip>
              )
            })}
          </div>
          {markerNames.length > 0 && (
            <>
              <p className="t-caption" style={{ color: 'var(--text-3)' }}>Bloods</p>
              <div className="flex flex-wrap gap-1.5">
                {markerNames.map((m) => {
                  const on = ov.bloods.includes(m)
                  return (
                    <Chip key={m} on={on} testid="ov-blood"
                      onClick={() => setOv({ bloods: on ? ov.bloods.filter((x) => x !== m) : [...ov.bloods, m] })}>
                      {m}
                    </Chip>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {!plottable ? (
        <p className="mt-3 text-xs font-medium" style={{ color: 'var(--text-2)' }} data-testid="health-chart-empty">
          {pts.length === 0 ? 'No data in this range yet.' : 'Not enough data in this range to draw a line.'}
        </p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`${title} over time`} style={{ overflow: 'visible' }}>
          {spans.map((s, i) => (
            <rect key={`span-${i}`} data-testid="overlay-tenure" x={xFor(s.from)} y={PAD.t} width={Math.max(1, xFor(s.to) - xFor(s.from))} height={PLOT_H}
              fill="var(--text)" opacity="0.05" />
          ))}
          {[lo + pad, (lo + hi) / 2, hi - pad].map((v, i) => (
            <g key={`g-${i}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={yFor(v)} y2={yFor(v)} stroke="var(--border)" strokeWidth="1" />
              <text x={PAD.l - 4} y={yFor(v) + 3} fontSize="9" fontWeight="700" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{fmt(v, dp)}</text>
            </g>
          ))}
          {refLine != null && (
            <g data-testid="health-chart-ref">
              <line x1={PAD.l} x2={W - PAD.r} y1={yFor(refLine)} y2={yFor(refLine)} stroke="var(--text-2)" strokeDasharray="3 3" strokeWidth="1" />
              <text x={W - PAD.r + 2} y={yFor(refLine) + 3} fontSize="8" fontWeight="700" fill="var(--text-2)">{refLabel}</text>
            </g>
          )}
          {changes.map((c, i) => (
            <g key={`c-${i}`} data-testid="overlay-change" data-date={c.date}>
              <line x1={xFor(c.date)} x2={xFor(c.date)} y1={PAD.t} y2={plotBottom} stroke="var(--text-3)" strokeDasharray="2 3" strokeWidth="1" />
              <text x={xFor(c.date) + 2} y={PAD.t + 7 + (i % 3) * 9} fontSize="8" fontWeight="700" fill="var(--text-2)">{c.label}</text>
            </g>
          ))}
          <polyline fill="none" stroke={sec.length ? 'var(--text-3)' : 'var(--text)'} strokeWidth={sec.length ? 1 : 2} strokeLinejoin="round" points={line(pts)} />
          {sec.length >= 2 && <polyline fill="none" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round" points={line(sec)} data-testid="health-chart-secondary" />}
          {pts.length <= 45 && pts.map((p) => (
            <circle key={p.date} cx={xFor(p.date)} cy={yFor(p.value)} r="2" fill="var(--text)" data-testid="health-point" />
          ))}
          {blood.map((b, i) => (
            <g key={`b-${i}`} data-testid="overlay-blood">
              <rect x={xFor(b.date) - 3} y={bloodY(b) - 3} width="6" height="6" transform={`rotate(45 ${xFor(b.date)} ${bloodY(b)})`} fill="var(--info)" />
              <text x={xFor(b.date) + 5} y={bloodY(b) - 4} fontSize="8" fontWeight="700" fill="var(--info)">{shortName(b.marker)} {b.value}</text>
            </g>
          ))}
          <text x={PAD.l} y={plotBottom + 13} fontSize="9" fontWeight="700" fill="var(--text-3)">{format(parseISO(from), 'd MMM')}</text>
          <text x={W - PAD.r} y={plotBottom + 13} fontSize="9" fontWeight="700" textAnchor="end" fill="var(--text-3)">{format(parseISO(to), 'd MMM')}</text>
          {ticks.map((row, r) => {
            const y = plotBottom + PAD.b + r * TICK_ROW
            return (
              <g key={row.compoundId} data-testid="overlay-ticks" data-compound={row.compoundId}>
                <text x={PAD.l - 4} y={y + 3} fontSize="7" fontWeight="700" textAnchor="end" fill="var(--text-3)">{shortName(nameOf(row.compoundId))}</text>
                {row.dates.map((d) => (
                  <line key={d} x1={xFor(d)} x2={xFor(d)} y1={y - 3} y2={y + 3} stroke="var(--text-2)" strokeWidth="1.2" />
                ))}
              </g>
            )
          })}
        </svg>
      )}
      {(unit || secondaryLabel || note) && (
        <p className="mt-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>
          {[unit && `In ${unit}`, secondaryLabel, note].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}
