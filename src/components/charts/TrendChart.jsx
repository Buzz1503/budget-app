import { useMemo, useRef, useState } from 'react'
import { Layers, Check, X } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { haptic } from '../../lib/feedback'
import {
  RANGES, rangeBounds, bucketFor, bucketPoints, yAxis, MIN_SPAN, labelPlacement, pickLabels,
  xTicks, groupEvents, rangeChange, shortDate, lineSegments, mergeScans, nearestPoint,
} from '../../body/chartPoints'
import { laneValuesAt } from '../../body/lanes'
import { bloodPoints, shortName } from '../../health/engine/overlay'
import { wobble as wobbleOf } from '../../health/engine/phases'
import { useLanes, LaneMenu, LaneRows, laneChangeWords, LANE_H } from './Lanes'
import { PHASES } from '../../health/engine/config'

/** The four series colours; every other line is drawn in the primary text colour. */
export const SERIES_COLOR = {
  weight: 'var(--series-weight)', leanMass: 'var(--series-lean)', fatMass: 'var(--series-fat)', muscleMass: 'var(--series-muscle)',
  sleep: 'var(--series-sleep)', sleepScore: 'var(--series-sleep)', deepSleep: 'var(--series-sleep)', remSleep: 'var(--series-sleep)',
  sleepHR: 'var(--series-sleep)', bedtime: 'var(--series-sleep)',
  saunaLength: 'var(--series-sauna)', saunaTemp: 'var(--series-sauna)',
}
export const colorFor = (metric) => SERIES_COLOR[metric] || 'var(--series-weight)'

export const W = 340
export const PAD = { l: 34, r: 14, t: 16, b: 20 }
export const PLOT_H = 150
const PIN_ROW = 24
const dayNum = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000)
const fmt = (v, dp) => Number(v).toFixed(dp)

/** Since start · 30D · 90D · 6M · 1Y · 2Y · All, the same chips on every chart. "Since start" only where a chart has a starting point. */
export function RangeChips({ value, onChange, withStart = false }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Time range">
      {RANGES.filter((r) => r.key !== 'Start' || withStart).map((r) => {
        const on = value === r.key
        return (
          <button key={r.key} data-testid={`range-${r.key}`} data-on={on ? 'true' : 'false'} aria-pressed={on}
            onClick={() => onChange(r.key)} className="min-h-[32px] rounded-full px-3 text-xs font-bold"
            style={on ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)', border: '1px solid transparent' }}>
            {r.label}
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
export function Axes({ axis, yFor, from, to, dp, format = null }) {
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
          <text x={PAD.l - 5} y={yFor(v) + 3} fontSize="9" fontWeight="600" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{format ? format(v) : fmt(v, tickDp)}</text>
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
const SCRUB_MOVE = 4 // px of drag before a press becomes a scrub rather than a tap

/**
 * One metric from one source over time. Every point is joined to the next by
 * one connected line (a silence longer than 120 days is a faint dashed
 * connector, not a break), averaged points are dots and scans are rings, the
 * value labels are thinned to one per 48 px, scans a few days apart share one
 * marker with a "+1" badge, and pressing and dragging reads any point, with
 * each lane's value at that date.
 *
 * `startLine` ({ value, date }) adds the "Since start" range, a dashed line at
 * the start value, and measures the header change from it.
 */
export default function TrendChart({
  metric, chartType = metric, title, unit = '', dp = 1, series, current = null, currentCaption = null,
  events = [], wobble: wobbleProp, window: fixed = null, defaultRange = '90D', testid, note = null, onEditDate = null,
  startLine = null, refBand = null, format = null, changeUnit = null, controls = null,
}) {
  // how a value reads: a number by default, or e.g. a clock time for bedtime
  const show = format || ((v) => fmt(v, dp))
  const [rangeKey, setRangeKey] = useState(defaultRange)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [scrub, setScrub] = useState(null)
  const drag = useRef(null)
  const svgRef = useRef(null)
  const swallowClick = useRef(false)
  const tests = useStore((s) => s.bloods?.tests || [])
  const saved = useStore((s) => s.healthSettings?.overlays?.[chartType])
  const haptics = useStore((s) => s.settings?.haptics)
  const setChartOverlay = useStore((s) => s.setChartOverlay)
  const t = todayStr()
  // "Since start" needs a starting point on this chart; without one it is the 90 day view
  const range = rangeKey === 'Start' && !startLine ? '90D' : rangeKey

  // normal wobble: how far daily values usually sit from their 7-day average
  const wobble = useMemo(() => (wobbleProp !== undefined ? wobbleProp
    : metric in PHASES.wobbleFallback ? wobbleOf(series || [], metric, t).value : null), [wobbleProp, metric, series, t])
  const ov = { pins: saved?.pins ?? true, wobble: saved?.wobble ?? false, bloods: saved?.bloods ?? [] }
  const setOv = (patch) => setChartOverlay?.(chartType, patch)
  const markerNames = useMemo(() => [...new Set(tests.flatMap((x) => Object.keys(x.values || {})))].sort(), [tests])

  const { from, to } = fixed || rangeBounds(range, t, series || [], startLine?.date)
  const bucket = fixed ? bucketForSpan(fixed.from, fixed.to) : bucketFor(range, from, to)
  const points = useMemo(() => mergeScans(bucketPoints(series || [], bucket, from, to)), [series, bucket, from, to])
  const segments = useMemo(() => lineSegments(points), [points])
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

  const avg = points.filter((p) => !p.scan)
  const place = labelPlacement(points.map((p) => p.value))
  const boxes = points.map((p, i) => {
    const text = p.estimated ? 'Start (est.)' : show(p.value)
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
  const change = rangeChange({
    series: series || [], from, to, range: fixed ? 'window' : range,
    startValue: startLine?.value ?? null, startDate: startLine?.date ?? null, unit: changeUnit ?? unit, dp,
  }).words

  const bloodY = (b) => {
    const vals = blood.filter((x) => x.marker === b.marker).map((x) => x.value)
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    return plotBottom - 10 - (hi === lo ? 0.5 : (b.value - lo) / (hi - lo)) * (PLOT_H - 20)
  }

  const sel = selected?.type === 'point' ? points[selected.i] : null
  const pin = selected?.type === 'pin' ? groups[selected.i] : null
  const laneChange = selected?.type === 'lane' ? selected.change : null

  // ---- scrubbing: press and drag for a crosshair with value, date, source and lane values
  const svgX = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    return ((e.clientX - r.left) / (r.width || 1)) * W
  }
  const scrubTo = (e) => {
    const i = nearestPoint(points.map((p) => xFor(p.x)), svgX(e))
    setScrub((cur) => {
      if (i >= 0 && cur !== i && haptics) haptic(4)
      return i >= 0 ? i : cur
    })
  }
  const onDown = (e) => { drag.current = { x: e.clientX, id: e.pointerId, on: false } }
  const onMove = (e) => {
    const d = drag.current
    if (!d || !points.length) return
    if (!d.on && Math.abs(e.clientX - d.x) > SCRUB_MOVE) {
      d.on = true
      try { svgRef.current.setPointerCapture(d.id) } catch { /* not capturable */ }
      setSelected(null)
    }
    if (d.on) scrubTo(e)
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.on) {
      setScrub(null)
      // the click that follows a drag is not a tap on a point
      swallowClick.current = true
      setTimeout(() => { swallowClick.current = false }, 0)
    }
  }
  const tap = (fn) => (e) => { if (swallowClick.current) { e.stopPropagation(); return } fn(e) }

  const scrubbed = scrub != null ? points[scrub] : null
  const readout = scrubbed ? {
    x: xFor(scrubbed.x),
    lines: [
      `${scrubbed.estimated ? 'Start (est.) ' : ''}${show(scrubbed.value)}${unit ? ` ${unit}` : ''} · ${pointDates(scrubbed)} · ${scrubbed.sources.join(', ')}`,
      ...laneValuesAt(lanes, scrubbed.x),
    ],
  } : null

  return (
    <div className="card p-3" data-testid={testid || `trend-chart-${chartType}`} data-range={fixed ? 'window' : range} data-bucket={bucket}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>{title}</p>
          <p className="text-2xl font-black tabular-nums leading-tight" data-testid="chart-current">
            {shownValue != null ? show(shownValue) : '–'}{unit && <span className="ml-1 text-xs font-bold" style={{ color: 'var(--text-3)' }}>{unit}</span>}
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
      {controls && <div className="mt-2">{controls}</div>}
      {!fixed && <div className="mt-2"><RangeChips value={range} withStart={!!startLine} onChange={(k) => { setRangeKey(k); setSelected(null) }} /></div>}

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
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full select-none" role="img" aria-label={`${title} over time`}
          style={{ touchAction: 'pan-y' }} data-testid="chart-svg"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <Axes axis={axis} yFor={yFor} from={from} to={to} dp={dp} format={format} />
          {refBand && (
            <g data-testid="chart-ref-band">
              <rect x={PAD.l} width={W - PAD.l - PAD.r} y={yFor(refBand.hi)} height={Math.max(1, yFor(refBand.lo) - yFor(refBand.hi))} fill="var(--text)" opacity="0.06" />
              <text x={PAD.l + 3} y={yFor(refBand.hi) + 9} fontSize="8" fontWeight="700" fill="var(--text-3)">{refBand.label || 'Reference range'}</text>
            </g>
          )}
          {start && (
            <g data-testid="chart-start-line">
              <line x1={PAD.l} x2={W - PAD.r} y1={yFor(start.value)} y2={yFor(start.value)} stroke="var(--text-3)" strokeDasharray="4 4" strokeWidth="1" opacity="0.7" />
              <text x={PAD.l + 3} y={yFor(start.value) - 3} fontSize="8" fontWeight="700" fill="var(--text-3)" className="tabular-nums">Start {show(start.value)}</text>
            </g>
          )}
          {band.length > 0 && avg.length > 1 && (
            <polygon data-testid="wobble-band" fill={color} opacity="0.08"
              points={[...avg.map((p) => `${xFor(p.x)},${yFor(p.value + wobble)}`), ...[...avg].reverse().map((p) => `${xFor(p.x)},${yFor(p.value - wobble)}`)].join(' ')} />
          )}
          {groups.map((g, i) => (
            <line key={`pl${g.date}`} x1={xFor(g.date)} x2={xFor(g.date)} y1={PAD.t} y2={plotBottom} stroke="var(--text-3)" strokeDasharray="3 3" strokeWidth="1" opacity="0.6" data-pin-line={i + 1} />
          ))}
          {segments.map((sg, i) => (
            <line key={`s${i}`} x1={xFor(sg.a.x).toFixed(1)} y1={yFor(sg.a.value).toFixed(1)} x2={xFor(sg.b.x).toFixed(1)} y2={yFor(sg.b.value).toFixed(1)}
              stroke={color} strokeWidth={sg.gap ? 1.5 : 2} strokeLinecap="round" strokeDasharray={sg.gap ? '3 5' : undefined} opacity={sg.gap ? 0.45 : 1}
              data-testid={sg.gap ? 'chart-gap' : 'chart-segment'} />
          ))}
          {blood.map((b, i) => (
            <g key={`b${i}`} data-testid="overlay-blood">
              <rect x={xFor(b.date) - 3} y={bloodY(b) - 3} width="6" height="6" transform={`rotate(45 ${xFor(b.date)} ${bloodY(b)})`} fill="var(--text-3)" />
              <text x={xFor(b.date) + 6} y={bloodY(b) - 4} fontSize="8" fontWeight="700" fill="var(--text-3)">{shortName(b.marker)} {b.value}</text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = xFor(p.x)
            const cy = yFor(p.value)
            const more = p.members ? p.members.length - 1 : 0
            return (
              <g key={`${p.x}-${p.scan}`}>
                {p.scan
                  ? <circle cx={cx} cy={cy} r="4" fill="var(--surface-solid)" stroke={color} strokeWidth="2" strokeDasharray={p.estimated ? '2 2' : undefined} data-testid={p.estimated ? 'chart-start-est' : 'chart-scan'} />
                  : <circle cx={cx} cy={cy} r="3" fill={color} data-testid="chart-point" />}
                {more > 0 && (
                  <g data-testid="chart-merged">
                    <circle cx={cx + 7} cy={cy - 7} r="6" fill="var(--surface2)" stroke="var(--border)" />
                    <text x={cx + 7} y={cy - 4.5} fontSize="7" fontWeight="800" textAnchor="middle" fill="var(--text)">+{more}</text>
                  </g>
                )}
                {keep.has(i) && (
                  <text x={boxes[i].x} y={boxes[i].y + 3} fontSize="9" fontWeight="600" textAnchor="middle" fill="var(--text-2)" className="tabular-nums" data-testid="chart-label">{boxes[i].text}</text>
                )}
                <circle cx={cx} cy={cy} r="11" fill="transparent" onClick={tap(() => setSelected({ type: 'point', i }))} data-testid="chart-hit" style={{ cursor: 'pointer' }} />
              </g>
            )
          })}
          {laneChange && (
            <line x1={xFor(laneChange.date)} x2={xFor(laneChange.date)} y1={PAD.t} y2={laneTop + lanes.length * LANE_H} stroke="var(--text-2)" strokeDasharray="3 3" data-testid="lane-guide" />
          )}
          <LaneRows lanes={lanes} top={laneTop} xFor={xFor} left={PAD.l} right={W - PAD.r} picked={laneChange}
            onPick={(change) => setSelected({ type: 'lane', change })} />
          {groups.map((g, i) => (
            <g key={`pin${g.date}`} onClick={tap(() => setSelected({ type: 'pin', i }))} style={{ cursor: 'pointer' }} data-testid="chart-pin" data-count={g.events.length}>
              <circle cx={xFor(g.date)} cy={pinTop + 9} r="8" fill="var(--surface2)" stroke="var(--border)" />
              <text x={xFor(g.date)} y={pinTop + 12} fontSize="9" fontWeight="800" textAnchor="middle" fill="var(--text)">{i + 1}</text>
              {g.events.length > 1 && (
                <g data-testid="pin-count">
                  <circle cx={xFor(g.date) + 8} cy={pinTop + 3} r="5.5" fill="var(--text)" />
                  <text x={xFor(g.date) + 8} y={pinTop + 5.5} fontSize="7" fontWeight="900" textAnchor="middle" fill="var(--bg)">{g.events.length}</text>
                </g>
              )}
            </g>
          ))}
          {readout && (
            <g data-testid="scrub" pointerEvents="none">
              <line x1={readout.x} x2={readout.x} y1={PAD.t} y2={plotBottom} stroke="var(--text)" strokeWidth="1" opacity="0.7" />
              <circle cx={readout.x} cy={yFor(scrubbed.value)} r="5" fill="none" stroke="var(--text)" strokeWidth="1.5" />
              {(() => {
                const w = Math.min(W - PAD.l - PAD.r, Math.max(...readout.lines.map((l) => l.length)) * 5 + 12)
                const left = readout.x > W / 2 ? PAD.l : W - PAD.r - w
                return (
                  <g data-testid="scrub-readout">
                    <rect x={left} y={PAD.t - 12} width={w} height={readout.lines.length * 11 + 5} rx="6" fill="var(--surface-solid)" stroke="var(--border)" />
                    {readout.lines.map((l, i) => (
                      <text key={i} x={left + 6} y={PAD.t - 1 + i * 11} fontSize="8.5" fontWeight={i ? 600 : 800} fill={i ? 'var(--text-2)' : 'var(--text)'} className="tabular-nums">{l}</text>
                    ))}
                  </g>
                )
              })()}
            </g>
          )}
        </svg>
      )}

      {sel && (
        <div className="mt-2 flex items-start gap-2 rounded-[10px] p-2.5" style={{ background: 'var(--surface-sunk)' }} data-testid="point-popover">
          <div className="min-w-0 flex-1 text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            {sel.members ? (
              <>
                {sel.members.map((m) => (
                  <p key={m.x} className="font-bold" style={{ color: 'var(--text)' }} data-testid="merged-row">{pointDates(m)}: {show(m.value)}{unit ? ` ${unit}` : ''}</p>
                ))}
                <p>{sel.members.length} scans within 10 days · {sel.sources.join(', ')}</p>
              </>
            ) : (
              <>
                <p className="font-bold" style={{ color: 'var(--text)' }}>{sel.estimated ? 'Start (estimated) ' : ''}{pointDates(sel)}: {show(sel.value)}{unit ? ` ${unit}` : ''}</p>
                <p>{sel.n === 1 ? '1 reading' : `Average of ${sel.n} readings`} · {sel.sources.join(', ')}{sel.scan ? (sel.estimated ? ' (estimated scan)' : ' (scan)') : ''}</p>
              </>
            )}
            {onEditDate && sel.from === sel.to && !sel.members && (
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
