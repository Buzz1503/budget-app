import { useMemo, useState } from 'react'
import { Layers, Check, X } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import {
  RANGES, rangeBounds, bucketFor, bucketPoints, yAxis, MIN_SPAN, labelPlacement, pickLabels,
  xTicks, groupEvents, rangeChangeWords, shortDate,
} from '../../body/chartPoints'
import { bloodPoints, shortName } from '../../health/engine/overlay'
import { wobble as wobbleOf } from '../../health/engine/phases'
import { useLanes, LaneMenu, LaneRows, laneChangeWords, LANE_H } from './Lanes'
import { PHASES } from '../../health/engine/config'

/** The four series colours; every other line is drawn in the primary text colour. */
export const SERIES_COLOR = {
  weight: 'var(--series-weight)', leanMass: 'var(--series-lean)', fatMass: 'var(--series-fat)', muscleMass: 'var(--series-muscle)',
}
export const colorFor = (metric) => SERIES_COLOR[metric] || 'var(--series-weight)'

export const W = 340
export const PAD = { l: 34, r: 14, t: 16, b: 20 }
export const PLOT_H = 150
const PIN_ROW = 24
const dayNum = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000)
const fmt = (v, dp) => Number(v).toFixed(dp)

/** 30D · 90D · 6M · 1Y · All, the same chips on every chart. */
export function RangeChips({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Time range">
      {RANGES.map((r) => {
        const on = value === r.key
        return (
          <button key={r.key} data-testid={`range-${r.key}`} data-on={on ? 'true' : 'false'} aria-pressed={on}
            onClick={() => onChange(r.key)} className="min-h-[32px] rounded-full px-3 text-xs font-bold"
            style={on ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)', border: '1px solid transparent' }}>
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

/** Pick a bucket for a fixed window (the Effects drill-down) by its length. */
const bucketForSpan = (from, to) => {
  const span = dayNum(to) - dayNum(from)
  return span <= 45 ? 'day' : span <= 200 ? 'week' : 'month'
}

export function useChartGeometry({ points, from, to, metric, zero = false, extraValues = [] }) {
  return useMemo(() => {
    const axis = yAxis([...points.map((p) => p.value), ...extraValues], MIN_SPAN[metric] ?? 1, { zero })
    const x0 = dayNum(from)
    const x1 = dayNum(to)
    const xFor = (d) => (x1 === x0 ? (PAD.l + W - PAD.r) / 2 : PAD.l + ((dayNum(d) - x0) / (x1 - x0)) * (W - PAD.l - PAD.r))
    const yFor = (v) => PAD.t + PLOT_H - ((v - axis.lo) / (axis.hi - axis.lo || 1)) * PLOT_H
    return { axis, xFor, yFor }
  }, [points, from, to, metric, zero, extraValues])
}

/** Gridlines, their labels and the dates along the bottom. */
export function Axes({ axis, yFor, from, to, dp }) {
  const plotBottom = PAD.t + PLOT_H
  const ticks = xTicks(from, to)
  const x0 = dayNum(from)
  const x1 = dayNum(to)
  const xFor = (d) => PAD.l + ((dayNum(d) - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r)
  const tickDp = axis.ticks.some((v) => !Number.isInteger(v)) ? Math.min(dp, 1) : 0
  return (
    <g>
      {axis.ticks.map((v) => (
        <g key={`y${v}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={yFor(v)} y2={yFor(v)} stroke="var(--border)" strokeWidth="1" />
          <text x={PAD.l - 5} y={yFor(v) + 3} fontSize="9" fontWeight="600" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{fmt(v, tickDp)}</text>
        </g>
      ))}
      {ticks.map((t, i) => (
        <text key={`x${t.date}`} x={xFor(t.date)} y={plotBottom + 13} fontSize="9" fontWeight="600" fill="var(--text-3)"
          textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{t.label}</text>
      ))}
    </g>
  )
}

const pointDates = (p) => (p.from === p.to ? shortDate(p.from) : `${shortDate(p.from)} to ${shortDate(p.to)}`)

/**
 * One metric over time, readable at a glance: daily, weekly or monthly points
 * depending on the range, a value on each point, straight lines between them,
 * and numbered pins below the axis where the protocol changed.
 */
export default function TrendChart({
  metric, chartType = metric, title, unit = '', dp = 1, series, current = null, currentCaption = null,
  events = [], wobble: wobbleProp, window: fixed = null, defaultRange = '90D', testid, note = null, onEditDate = null,
  startLine = null, refBand = null,
}) {
  const [rangeKey, setRangeKey] = useState(defaultRange)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const tests = useStore((s) => s.bloods?.tests || [])
  const saved = useStore((s) => s.healthSettings?.overlays?.[chartType])
  const setChartOverlay = useStore((s) => s.setChartOverlay)
  const t = todayStr()

  // normal wobble: how far daily values usually sit from their 7-day average
  const wobble = useMemo(() => (wobbleProp !== undefined ? wobbleProp
    : metric in PHASES.wobbleFallback ? wobbleOf(series || [], metric, t).value : null), [wobbleProp, metric, series, t])
  const ov = { pins: saved?.pins ?? true, wobble: saved?.wobble ?? false, bloods: saved?.bloods ?? [] }
  const setOv = (patch) => setChartOverlay?.(chartType, patch)
  const markerNames = useMemo(() => [...new Set(tests.flatMap((x) => Object.keys(x.values || {})))].sort(), [tests])

  const { from, to } = fixed || rangeBounds(rangeKey, t, series || [])
  const bucket = fixed ? bucketForSpan(fixed.from, fixed.to) : bucketFor(rangeKey)
  const points = useMemo(() => bucketPoints(series || [], bucket, from, to), [series, bucket, from, to])
  const band = ov.wobble && wobble ? [wobble, -wobble] : []
  // the starting value, drawn when the start is inside or before the range
  // shown (and kept on the axis so the line is always in view)
  const start = startLine && startLine.date <= to && points.length ? startLine : null
  const extra = useMemo(() => [
    ...(band.length ? points.flatMap((p) => [p.value + wobble, p.value - wobble]) : []),
    ...(start ? [start.value] : []),
    ...(refBand ? [refBand.lo, refBand.hi] : []),
  ], [points, band.length, wobble, start, refBand])
  const { axis, xFor, yFor } = useChartGeometry({ points, from, to, metric, extraValues: extra })
  const color = colorFor(metric)

  const line = points.filter((p) => !p.scan)
  const place = labelPlacement(points.map((p) => p.value))
  const boxes = points.map((p, i) => {
    const text = fmt(p.value, dp)
    return { x: xFor(p.x), y: yFor(p.value) + (place[i] === 'above' ? -11 : 13), w: text.length * 5.2 + 3, h: 10, value: p.value, scan: p.scan, text }
  })
  const keep = pickLabels(boxes)

  const groups = ov.pins ? groupEvents(events.filter((e) => e.date >= from && e.date <= to)) : []
  const { compounds: laneCompounds, chosen: laneIds, lanes, toggle: toggleLane } = useLanes(chartType, from, to)
  const blood = ov.bloods.length ? bloodPoints(tests, ov.bloods, from, to) : []
  const plotBottom = PAD.t + PLOT_H
  const laneTop = plotBottom + PAD.b
  const pinTop = laneTop + lanes.length * LANE_H
  const H = pinTop + (groups.length ? PIN_ROW : 0)
  const shownValue = current ?? (points.length ? points[points.length - 1].value : null)
  const change = rangeChangeWords(line.length ? line : points, unit, dp, from, to)

  const bloodY = (b) => {
    const vals = blood.filter((x) => x.marker === b.marker).map((x) => x.value)
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    return plotBottom - 10 - (hi === lo ? 0.5 : (b.value - lo) / (hi - lo)) * (PLOT_H - 20)
  }

  const sel = selected?.type === 'point' ? points[selected.i] : null
  const pin = selected?.type === 'pin' ? groups[selected.i] : null
  const laneChange = selected?.type === 'lane' ? selected.change : null

  return (
    <div className="card p-3" data-testid={testid || `trend-chart-${chartType}`} data-range={fixed ? 'window' : rangeKey} data-bucket={bucket}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>{title}</p>
          <p className="text-2xl font-black tabular-nums leading-tight" data-testid="chart-current">
            {shownValue != null ? fmt(shownValue, dp) : '–'}{unit && <span className="ml-1 text-xs font-bold" style={{ color: 'var(--text-3)' }}>{unit}</span>}
          </p>
          {(currentCaption || change) && (
            <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="chart-change">
              {[currentCaption, change].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <button onClick={() => setOverlayOpen((v) => !v)} data-testid="overlay-button" aria-expanded={overlayOpen}
          className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold"
          style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
          <Layers size={12} /> Overlay
        </button>
      </div>
      {!fixed && <div className="mt-2"><RangeChips value={rangeKey} onChange={(k) => { setRangeKey(k); setSelected(null) }} /></div>}

      {overlayOpen && (
        <div className="mt-2 space-y-2 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="overlay-panel">
          <div className="flex flex-wrap gap-1.5">
            <Chip on={ov.pins} onClick={() => setOv({ pins: !ov.pins })} testid="ov-pins">Pins</Chip>
            {wobble != null && <Chip on={ov.wobble} onClick={() => setOv({ wobble: !ov.wobble })} testid="ov-wobble">Normal wobble band</Chip>}
          </div>
          <LaneMenu compounds={laneCompounds} chosen={laneIds} toggle={toggleLane} />
          {markerNames.length > 0 && (
            <>
              <p className="t-caption" style={{ color: 'var(--text-3)' }}>Bloods</p>
              <div className="flex flex-wrap gap-1.5">
                {markerNames.map((m) => {
                  const on = ov.bloods.includes(m)
                  return (
                    <Chip key={m} on={on} testid="ov-blood"
                      onClick={() => setOv({ bloods: on ? ov.bloods.filter((x) => x !== m) : [...ov.bloods, m] })}>{m}</Chip>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {points.length === 0 ? (
        <p className="mt-3 text-xs font-medium" style={{ color: 'var(--text-2)' }} data-testid="chart-empty">No data in this range yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`${title} over time`}>
          <Axes axis={axis} yFor={yFor} from={from} to={to} dp={dp} />
          {refBand && (
            <g data-testid="chart-ref-band">
              <rect x={PAD.l} width={W - PAD.l - PAD.r} y={yFor(refBand.hi)} height={Math.max(1, yFor(refBand.lo) - yFor(refBand.hi))} fill="var(--text)" opacity="0.06" />
              <text x={PAD.l + 3} y={yFor(refBand.hi) + 9} fontSize="8" fontWeight="700" fill="var(--text-3)">{refBand.label || 'Reference range'}</text>
            </g>
          )}
          {start && (
            <g data-testid="chart-start-line">
              <line x1={PAD.l} x2={W - PAD.r} y1={yFor(start.value)} y2={yFor(start.value)} stroke="var(--text-3)" strokeDasharray="4 4" strokeWidth="1" opacity="0.7" />
              <text x={W - PAD.r} y={yFor(start.value) - 3} fontSize="8" fontWeight="700" textAnchor="end" fill="var(--text-3)">Start</text>
            </g>
          )}
          {band.length > 0 && line.length > 1 && (
            <polygon data-testid="wobble-band" fill={color} opacity="0.08"
              points={[...line.map((p) => `${xFor(p.x)},${yFor(p.value + wobble)}`), ...[...line].reverse().map((p) => `${xFor(p.x)},${yFor(p.value - wobble)}`)].join(' ')} />
          )}
          {groups.map((g, i) => (
            <line key={`pl${g.date}`} x1={xFor(g.date)} x2={xFor(g.date)} y1={PAD.t} y2={plotBottom} stroke="var(--text-3)" strokeDasharray="3 3" strokeWidth="1" opacity="0.6" data-pin-line={i + 1} />
          ))}
          {line.length > 1 && (
            <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
              points={line.map((p) => `${xFor(p.x).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(' ')} />
          )}
          {blood.map((b, i) => (
            <g key={`b${i}`} data-testid="overlay-blood">
              <rect x={xFor(b.date) - 3} y={bloodY(b) - 3} width="6" height="6" transform={`rotate(45 ${xFor(b.date)} ${bloodY(b)})`} fill="var(--text-3)" />
              <text x={xFor(b.date) + 6} y={bloodY(b) - 4} fontSize="8" fontWeight="700" fill="var(--text-3)">{shortName(b.marker)} {b.value}</text>
            </g>
          ))}
          {points.map((p, i) => (
            <g key={`${p.x}-${p.scan}`}>
              {p.scan
                ? <circle cx={xFor(p.x)} cy={yFor(p.value)} r="4" fill="var(--surface-solid)" stroke={color} strokeWidth="2" data-testid="chart-scan" />
                : <circle cx={xFor(p.x)} cy={yFor(p.value)} r="3" fill={color} data-testid="chart-point" />}
              {keep.has(i) && (
                <text x={boxes[i].x} y={boxes[i].y + 3} fontSize="9" fontWeight="600" textAnchor="middle" fill="var(--text-2)" className="tabular-nums" data-testid="chart-label">{boxes[i].text}</text>
              )}
              <circle cx={xFor(p.x)} cy={yFor(p.value)} r="11" fill="transparent" onClick={() => setSelected({ type: 'point', i })} data-testid="chart-hit" style={{ cursor: 'pointer' }} />
            </g>
          ))}
          {laneChange && (
            <line x1={xFor(laneChange.date)} x2={xFor(laneChange.date)} y1={PAD.t} y2={laneTop + lanes.length * LANE_H} stroke="var(--text-2)" strokeDasharray="3 3" data-testid="lane-guide" />
          )}
          <LaneRows lanes={lanes} top={laneTop} xFor={xFor} left={PAD.l} right={W - PAD.r} picked={laneChange}
            onPick={(change) => setSelected({ type: 'lane', change })} />
          {groups.map((g, i) => (
            <g key={`pin${g.date}`} onClick={() => setSelected({ type: 'pin', i })} style={{ cursor: 'pointer' }} data-testid="chart-pin">
              <circle cx={xFor(g.date)} cy={pinTop + 9} r="8" fill="var(--surface2)" stroke="var(--border)" />
              <text x={xFor(g.date)} y={pinTop + 12} fontSize="9" fontWeight="800" textAnchor="middle" fill="var(--text)">{i + 1}</text>
            </g>
          ))}
        </svg>
      )}

      {sel && (
        <div className="mt-2 flex items-start gap-2 rounded-[10px] p-2.5" style={{ background: 'var(--surface-sunk)' }} data-testid="point-popover">
          <div className="min-w-0 flex-1 text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            <p className="font-bold" style={{ color: 'var(--text)' }}>{pointDates(sel)}: {fmt(sel.value, dp)}{unit ? ` ${unit}` : ''}</p>
            <p>{sel.n === 1 ? '1 reading' : `Average of ${sel.n} readings`} · {sel.sources.join(', ')}{sel.scan ? ' (scan)' : ''}</p>
            {onEditDate && sel.from === sel.to && (
              <button onClick={() => onEditDate(sel.from)} className="mt-1 font-bold" style={{ color: 'var(--text)' }} data-testid="point-edit">Edit this entry</button>
            )}
          </div>
          <button onClick={() => setSelected(null)} aria-label="Close" className="shrink-0 p-0.5" style={{ color: 'var(--text-3)' }}><X size={14} /></button>
        </div>
      )}
      {pin && (
        <div className="mt-2 flex items-start gap-2 rounded-[10px] p-2.5" style={{ background: 'var(--surface-sunk)' }} data-testid="pin-popover">
          <div className="min-w-0 flex-1 space-y-0.5 text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            {pin.events.map((e, i) => <p key={i}><b style={{ color: 'var(--text)' }}>{shortDate(e.date)}</b> · {e.text}</p>)}
          </div>
          <button onClick={() => setSelected(null)} aria-label="Close" className="shrink-0 p-0.5" style={{ color: 'var(--text-3)' }}><X size={14} /></button>
        </div>
      )}
      {laneChange && (
        <div className="mt-2 flex items-start gap-2 rounded-[10px] p-2.5" style={{ background: 'var(--surface-sunk)' }} data-testid="lane-popover">
          <p className="min-w-0 flex-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>{laneChangeWords(laneChange)}</p>
          <button onClick={() => setSelected(null)} aria-label="Close" className="shrink-0 p-0.5" style={{ color: 'var(--text-3)' }}><X size={14} /></button>
        </div>
      )}
      {note && <p className="mt-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{note}</p>}
    </div>
  )
}
