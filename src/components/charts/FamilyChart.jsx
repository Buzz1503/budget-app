import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { todayStr } from '../../store/useStore'
import { rangeBounds, bucketFor, bucketPoints, groupEvents, shortDate, rangeChangeWords } from '../../body/chartPoints'
import { FAMILY_LABEL } from '../../body/bodySeries'
import { RangeChips, Axes, colorFor, useChartGeometry, W, PAD, PLOT_H } from './TrendChart'

const fmt = (v, dp) => Number(v).toFixed(dp)

/**
 * Body fat, fat mass or lean mass with one line per device family, never
 * mixed: Withings (and other scales) solid with dots, Evolt scans dashed with
 * rings. Each family can be switched off from the legend.
 */
export default function FamilyChart({
  metric, title, unit, dp = 1, families, refBand = null, startLine = null, events = [], defaultRange = 'All', testid,
}) {
  const t = todayStr()
  const [rangeKey, setRangeKey] = useState(defaultRange)
  const [hidden, setHidden] = useState(() => new Set())
  const [pin, setPin] = useState(null)
  const keys = Object.keys(families).sort((a, b) => (a === 'evolt' ? -1 : b === 'evolt' ? 1 : a.localeCompare(b)))
  const all = keys.flatMap((k) => families[k])
  const { from, to } = rangeBounds(rangeKey, t, all)
  const bucket = bucketFor(rangeKey)
  const lines = useMemo(() => keys.filter((k) => !hidden.has(k)).map((k) => ({
    key: k,
    scan: k !== 'withings' && k !== 'manual' && k !== 'other',
    points: bucketPoints(families[k], bucket, from, to),
  })), [keys.join(), hidden, families, bucket, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const start = startLine && startLine.date <= to ? startLine : null
  const extra = [...(refBand ? [refBand.lo, refBand.hi] : []), ...(start ? [start.value] : [])]
  const { axis, xFor, yFor } = useChartGeometry({ points: lines.flatMap((l) => l.points), from, to, metric, extraValues: extra })
  const groups = groupEvents(events.filter((e) => e.date >= from && e.date <= to))
  const plotBottom = PAD.t + PLOT_H
  const H = plotBottom + PAD.b + (groups.length ? 24 : 0)
  const color = colorFor(metric)
  const toggle = (k) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <div className="card p-3" data-testid={testid || `family-chart-${metric}`} data-range={rangeKey}>
      <p className="t-caption" style={{ color: 'var(--text-2)' }}>{title}</p>
      <div className="mt-2"><RangeChips value={rangeKey} onChange={setRangeKey} /></div>
      {lines.every((l) => l.points.length === 0) ? (
        <p className="mt-3 text-xs font-medium" style={{ color: 'var(--text-2)' }}>No data in this range yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`${title} by device`}>
          <Axes axis={axis} yFor={yFor} from={from} to={to} dp={dp} />
          {refBand && (
            <g data-testid="chart-ref-band">
              <rect x={PAD.l} width={W - PAD.l - PAD.r} y={yFor(refBand.hi)} height={Math.max(1, yFor(refBand.lo) - yFor(refBand.hi))} fill="var(--text)" opacity="0.06" />
              <text x={PAD.l + 3} y={yFor(refBand.hi) + 9} fontSize="8" fontWeight="700" fill="var(--text-3)">{refBand.label || 'Evolt reference range'}</text>
            </g>
          )}
          {start && (
            <g data-testid="chart-start-line">
              <line x1={PAD.l} x2={W - PAD.r} y1={yFor(start.value)} y2={yFor(start.value)} stroke="var(--text-3)" strokeDasharray="4 4" opacity="0.7" />
              <text x={W - PAD.r} y={yFor(start.value) - 3} fontSize="8" fontWeight="700" textAnchor="end" fill="var(--text-3)">Start</text>
            </g>
          )}
          {groups.map((g) => (
            <line key={`pl${g.date}`} x1={xFor(g.date)} x2={xFor(g.date)} y1={PAD.t} y2={plotBottom} stroke="var(--text-3)" strokeDasharray="3 3" opacity="0.6" />
          ))}
          {lines.map((l) => (
            <g key={l.key} data-testid={`family-line-${l.key}`}>
              {l.points.length > 1 && (
                <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeDasharray={l.scan ? '5 4' : undefined}
                  opacity={l.scan ? 0.9 : 1} points={l.points.map((p) => `${xFor(p.x).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(' ')} />
              )}
              {l.points.map((p, i) => (
                <g key={`${p.x}-${i}`}>
                  {l.scan
                    ? <circle cx={xFor(p.x)} cy={yFor(p.value)} r="4" fill="var(--surface-solid)" stroke={color} strokeWidth="2" />
                    : <circle cx={xFor(p.x)} cy={yFor(p.value)} r="2.5" fill={color} />}
                  {(i === 0 || i === l.points.length - 1) && (
                    <text x={xFor(p.x)} y={yFor(p.value) - 7} fontSize="9" fontWeight="600" textAnchor="middle" fill="var(--text-2)" className="tabular-nums">{fmt(p.value, dp)}</text>
                  )}
                </g>
              ))}
            </g>
          ))}
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
      <div className="mt-2 rows" data-testid="family-legend">
        {keys.map((k) => {
          const on = !hidden.has(k)
          const s = families[k]
          const last = s[s.length - 1]
          const scan = k !== 'withings' && k !== 'manual' && k !== 'other'
          const inRange = bucketPoints(s, bucket, from, to)
          return (
            <button key={k} onClick={() => toggle(k)} aria-pressed={on} data-testid={`family-toggle-${k}`} className="flex w-full items-center gap-2 py-2 text-left">
              <svg width="22" height="10" aria-hidden="true" className="shrink-0">
                <line x1="1" x2="21" y1="5" y2="5" stroke={on ? color : 'var(--text-3)'} strokeWidth="2" strokeDasharray={scan ? '4 3' : undefined} />
                {scan ? <circle cx="11" cy="5" r="3" fill="var(--surface-solid)" stroke={on ? color : 'var(--text-3)'} strokeWidth="1.5" /> : <circle cx="11" cy="5" r="2" fill={on ? color : 'var(--text-3)'} />}
              </svg>
              <span className="min-w-0 flex-1 text-sm font-semibold" style={{ color: on ? 'var(--text)' : 'var(--text-3)' }}>{FAMILY_LABEL[k] || k}</span>
              <span className="text-sm font-black tabular-nums" style={{ color: on ? 'var(--text)' : 'var(--text-3)' }}>{last ? `${fmt(last.value, dp)}${unit === '%' ? '%' : ` ${unit}`}` : '–'}</span>
              <span className="w-[86px] shrink-0 text-right text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>{rangeChangeWords(inRange, unit === '%' ? 'pts' : unit, dp, from, to, false) || '–'}</span>
              {on && <Check size={12} className="shrink-0" style={{ color: 'var(--text-3)' }} />}
            </button>
          )
        })}
      </div>
      <p className="mt-1 text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Each device is its own line. Readings from different devices are never averaged together.</p>
    </div>
  )
}
