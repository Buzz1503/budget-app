import { useMemo, useState } from 'react'
import { todayStr } from '../../store/useStore'
import { rangeBounds, bucketFor, bucketPoints, rangeChangeWords, groupEvents, shortDate } from '../../body/chartPoints'
import { dailySeries, getLatestMeasurement } from '../../body/bodySeries'
import { useBodyInput } from '../../lib/useBody'
import { RangeChips, Axes, colorFor, useChartGeometry, W, PAD, PLOT_H } from './TrendChart'
import useChartEvents from './useChartEvents'

const SERIES = [
  { key: 'weight', label: 'Weight' },
  { key: 'leanMass', label: 'Lean mass' },
  { key: 'fatMass', label: 'Fat mass' },
  { key: 'muscleMass', label: 'Muscle mass' },
]

/**
 * Weight, lean mass and fat mass (and muscle mass once a scan has it) on one
 * axis from zero, so their sizes read against each other. Labels only on each
 * line's first and last points and on scans; the legend carries the rest.
 */
export default function ProgressChart() {
  const input = useBodyInput()
  const events = useChartEvents()
  const t = todayStr()
  const [rangeKey, setRangeKey] = useState('6M')
  const [pin, setPin] = useState(null)

  const all = useMemo(() => SERIES.map((s) => ({ ...s, data: dailySeries(s.key, input) }))
    .filter((s) => s.data.length && (s.key !== 'muscleMass' || s.data.some((p) => p.source === 'scan'))), [input])
  const combined = all.flatMap((s) => s.data)
  const { from, to } = rangeBounds(rangeKey, t, combined)
  const bucket = bucketFor(rangeKey)
  const lines = all.map((s) => ({ ...s, points: bucketPoints(s.data, bucket, from, to) }))
  const values = lines.flatMap((l) => l.points.map((p) => p.value))
  const { axis, xFor, yFor } = useChartGeometry({ points: lines.flatMap((l) => l.points), from, to, metric: 'progress', zero: true })
  const groups = groupEvents(events.filter((e) => e.date >= from && e.date <= to))
  const plotBottom = PAD.t + PLOT_H
  const H = plotBottom + PAD.b + (groups.length ? 24 : 0)

  if (!all.length) return null

  return (
    <div className="card p-3" data-testid="progress-chart">
      <p className="t-caption" style={{ color: 'var(--text-2)' }}>Overall progress</p>
      <div className="mt-2"><RangeChips value={rangeKey} onChange={setRangeKey} /></div>
      {values.length === 0 ? (
        <p className="mt-3 text-xs font-medium" style={{ color: 'var(--text-2)' }}>No data in this range yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Weight, lean mass and fat mass over time">
          <Axes axis={axis} yFor={yFor} from={from} to={to} dp={0} />
          {groups.map((g) => (
            <line key={`pl${g.date}`} x1={xFor(g.date)} x2={xFor(g.date)} y1={PAD.t} y2={plotBottom} stroke="var(--text-3)" strokeDasharray="3 3" opacity="0.6" />
          ))}
          {lines.map((l) => {
            const line = l.points.filter((p) => !p.scan)
            const color = colorFor(l.key)
            return (
              <g key={l.key} data-testid={`progress-${l.key}`}>
                {line.length > 1 && <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" points={line.map((p) => `${xFor(p.x).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(' ')} />}
                {l.points.map((p, i) => (
                  <g key={`${p.x}-${p.scan}`}>
                    {p.scan
                      ? <circle cx={xFor(p.x)} cy={yFor(p.value)} r="4" fill="var(--surface-solid)" stroke={color} strokeWidth="2" />
                      : <circle cx={xFor(p.x)} cy={yFor(p.value)} r="3" fill={color} />}
                    {(i === 0 || i === l.points.length - 1 || p.scan) && (
                      <text x={xFor(p.x)} y={yFor(p.value) - 7} fontSize="9" fontWeight="600" textAnchor="middle" fill="var(--text-2)" className="tabular-nums">{p.value.toFixed(1)}</text>
                    )}
                  </g>
                ))}
              </g>
            )
          })}
          {groups.map((g, i) => (
            <g key={`pin${g.date}`} onClick={() => setPin(pin === i ? null : i)} style={{ cursor: 'pointer' }} data-testid="chart-pin">
              <circle cx={xFor(g.date)} cy={plotBottom + PAD.b + 9} r="8" fill="var(--surface2)" stroke="var(--border)" />
              <text x={xFor(g.date)} y={plotBottom + PAD.b + 12} fontSize="9" fontWeight="800" textAnchor="middle" fill="var(--text)">{i + 1}</text>
            </g>
          ))}
        </svg>
      )}
      {pin != null && groups[pin] && (
        <div className="mt-2 space-y-0.5 rounded-[10px] p-2.5 text-xs font-medium" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="pin-popover">
          {groups[pin].events.map((e, i) => <p key={i}><b style={{ color: 'var(--text)' }}>{shortDate(e.date)}</b> · {e.text}</p>)}
        </div>
      )}
      <div className="mt-2 rows" data-testid="progress-legend">
        {lines.map((l) => {
          const latest = getLatestMeasurement(l.key, input, t)
          const line = l.points.filter((p) => !p.scan)
          const change = rangeChangeWords(line.length > 1 ? line : l.points, 'kg', 1, from, to)
          return (
            <div key={l.key} className="flex items-center gap-2 py-2" data-testid="legend-row">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor(l.key) }} />
              <span className="min-w-0 flex-1 text-sm font-semibold">{l.label}</span>
              <span className="text-sm font-black tabular-nums">{latest ? `${latest.value.toFixed(1)} kg` : '–'}</span>
              <span className="w-[120px] shrink-0 text-right text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>{change || 'no change yet'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
