import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, Check, X, Maximize2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react'
import { createPortal } from 'react-dom'
import useStore, { todayStr } from '../../store/useStore'
import { haptic } from '../../lib/feedback'
import {
  RANGES, rangeBounds, bucketFor, bucketPoints, yAxis, MIN_SPAN, labelPlacement,
  xTicks, groupEvents, rangeChange, shortDate, lineSegments, mergeScans, nearestPoint,
  defaultRangeFor, LIST_UNDER_POINTS, chartMode, pinsOffByDefault,
  bandInView, bandCaption, placeLabels, labelPriority, zoomWindow, panWindow,
} from '../../body/chartPoints'
import { laneValuesAt } from '../../body/lanes'
import { bloodPoints, shortName } from '../../health/engine/overlay'
import { wobble as wobbleOf } from '../../health/engine/phases'
import { useLanes, LaneMenu, LaneRows, laneChangeWords, LANE_H } from './Lanes'
import { PHASES } from '../../health/engine/config'
import { chartQuestion, chartAnswer, axisUnit, betterHint, legendItems, needsLegend } from '../../body/chartGlance'
import { TONE_COLOR } from '../../lib/glance'
import { chartBetter } from '../../body/chartGlance'

/** The four series colours; every other line is drawn in the primary text colour. */
export const SERIES_COLOR = {
  weight: 'var(--series-weight)', leanMass: 'var(--series-lean)', fatMass: 'var(--series-fat)', muscleMass: 'var(--series-muscle)',
  sleep: 'var(--series-sleep)', sleepScore: 'var(--series-sleep)', deepSleep: 'var(--series-sleep)', remSleep: 'var(--series-sleep)',
  sleepHR: 'var(--series-sleep)', bedtime: 'var(--series-sleep)',
  saunaLength: 'var(--series-sauna)', saunaTemp: 'var(--series-sauna)',
}
export const colorFor = (metric) => SERIES_COLOR[metric] || 'var(--series-weight)'

export const W = 340
export const PAD = { l: 42, r: 14, t: 28, b: 26 }
/** Plot height on a card; with the axes the chart is well over 220 pt tall at phone width. */
export const PLOT_H = 200
/** Plot height in full screen when the window cannot be measured. */
const FULL_PLOT_H = 300
const PIN_ROW = 26
/** Label sizes in chart units; a card is drawn at about 0.96 of a unit per point, so these read at 12 pt or more. */
export const FS = 12.5
const CH = 7 // width of one label character at FS, for collision boxes
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

export function useChartGeometry({ points, from, to, metric, zero = false, extraValues = [], plotH = PLOT_H, w = W }) {
  return useMemo(() => {
    const axis = yAxis([...points.map((p) => p.value), ...extraValues], MIN_SPAN[metric] ?? 1, { zero })
    const x0 = dayNum(from)
    const x1 = dayNum(to)
    const xFor = (d) => (x1 === x0 ? (PAD.l + w - PAD.r) / 2 : PAD.l + ((dayNum(d) - x0) / (x1 - x0)) * (w - PAD.l - PAD.r))
    const yFor = (v) => PAD.t + plotH - ((v - axis.lo) / (axis.hi - axis.lo || 1)) * plotH
    return { axis, xFor, yFor }
  }, [points, from, to, metric, zero, extraValues, plotH, w])
}

/** The date labels along the bottom, as boxes other labels must not cover. */
export function xTickBoxes(from, to, plotBottom, w = W) {
  const ticks = xTicks(from, to)
  const x0 = dayNum(from)
  const x1 = dayNum(to)
  return ticks.map((t, i) => ({
    id: `x${t.date}`, w: t.label.length * CH + 2, h: 13, y: plotBottom + 18,
    x: PAD.l + ((dayNum(t.date) - x0) / Math.max(1, x1 - x0)) * (w - PAD.l - PAD.r),
    anchor: i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle',
  }))
}

/**
 * Gridlines, their labels and the dates along the bottom. Above the plot: the
 * y axis unit on the left ("kg", "bpm", "hours") and, where a measure has a
 * better side, a small "↑ better" or "↓ better" on the right.
 */
export function Axes({ axis, yFor, from, to, dp, format = null, plotH = PLOT_H, w = W, unit = null, better = null }) {
  const plotBottom = PAD.t + plotH
  const ticks = xTicks(from, to)
  const x0 = dayNum(from)
  const x1 = dayNum(to)
  const xFor = (d) => PAD.l + ((dayNum(d) - x0) / Math.max(1, x1 - x0)) * (w - PAD.l - PAD.r)
  const tickDp = axis.ticks.some((v) => !Number.isInteger(v)) ? Math.min(dp, 1) : 0
  return (
    <g>
      {unit && <text x={2} y={PAD.t - 12} fontSize={FS - 1} fontWeight="700" fill="var(--text-3)" data-testid="axis-unit">{unit}</text>}
      {better && <text x={w - PAD.r} y={PAD.t - 12} fontSize={FS - 1} fontWeight="700" textAnchor="end" fill="var(--text-3)" data-testid="axis-better">{better}</text>}
      {axis.ticks.map((v) => (
        <g key={`y${v}`}>
          <line x1={PAD.l} x2={w - PAD.r} y1={yFor(v)} y2={yFor(v)} stroke="var(--border)" strokeWidth="1" />
          <text x={PAD.l - 5} y={yFor(v) + 4} fontSize={FS} fontWeight="600" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{format ? format(v) : fmt(v, tickDp)}</text>
        </g>
      ))}
      {ticks.map((t, i) => (
        <text key={`x${t.date}`} x={xFor(t.date)} y={plotBottom + 18} fontSize={FS} fontWeight="600" fill="var(--text-3)"
          textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'} data-testid="axis-date">{t.label}</text>
      ))}
    </g>
  )
}

const SWATCH = {
  dot: (c) => <circle cx="7" cy="6" r="3.5" fill={c} />,
  ring: (c) => <circle cx="7" cy="6" r="4" fill="none" stroke={c} strokeWidth="2" />,
  'ring-dashed': (c) => <circle cx="7" cy="6" r="4" fill="none" stroke={c} strokeWidth="2" strokeDasharray="2 2" />,
  dashed: (c) => <line x1="1" x2="13" y1="6" y2="6" stroke={c} strokeWidth="1.5" strokeDasharray="3 2" />,
  trend: (c) => <line x1="1" x2="13" y1="6" y2="6" stroke={c} strokeWidth="1.5" strokeDasharray="4 3" />,
  line: (c) => <line x1="1" x2="13" y1="6" y2="6" stroke={c} strokeWidth="2" />,
  band: (c) => <rect x="1" y="2" width="12" height="8" rx="2" fill={c} opacity="0.25" />,
  hollow: () => <circle cx="7" cy="6" r="3.5" fill="none" stroke="var(--text-3)" strokeWidth="1.5" />,
  diamond: () => <rect x="4" y="3" width="6" height="6" transform="rotate(45 7 6)" fill="var(--text-3)" />,
  triangle: (c) => <path d="M7 2 l5 8 h-10 z" fill={c} />,
  bar: (c) => <rect x="3" y="1" width="8" height="10" rx="2" fill={c} />,
  flame: (c) => <circle cx="7" cy="6" r="3" fill={c} />,
}

/** The legend under a chart, shown whenever it has more than one kind of mark. */
export function ChartLegend({ items }) {
  if (!needsLegend(items)) return null
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1" data-testid="chart-legend">
      {items.map((it) => (
        <span key={it.key} className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--text-2)' }} data-testid="legend-item">
          <svg width="14" height="12" aria-hidden="true">{SWATCH[it.kind]?.(it.color || 'var(--text-2)')}</svg>{it.label}
        </span>
      ))}
    </div>
  )
}

const pointDates = (p) => (p.from === p.to ? shortDate(p.from) : `${shortDate(p.from)} to ${shortDate(p.to)}`)
const SCRUB_MOVE = 4 // px of drag before a press becomes a scrub rather than a tap

/** A pin's short label: the start of its text, cut at a word, never mid-word. */
export function pinLabel(text = '', max = 14) {
  const head = String(text).split(/ · |, |\. /)[0]
  if (head.length <= max) return head
  const words = head.split(' ')
  let out = ''
  for (const w of words) {
    if ((out ? `${out} ${w}` : w).length > max) break
    out = out ? `${out} ${w}` : w
  }
  return out || words[0]
}

/**
 * One metric from one source over time. Every point is joined to the next by
 * one connected line (a silence longer than 120 days is a faint dashed
 * connector, not a break), averaged points are dots and scans are rings, and
 * pressing and dragging reads any point, with each lane's value at that date.
 *
 * Readable first: the y axis fits the data with a little room, a reference band
 * is drawn only where it overlaps the axis (else one caption says where it is),
 * value labels are the last, first, lowest and highest point, then the start
 * label, each kept only where it collides with nothing. Scans within 10 days
 * share one marker silently (the scrub lists them all). Event pins are small
 * labelled dots in one row under the dates; the line through the plot appears
 * only for the pin tapped. Readings that look wrong (`suspects`) are hollow grey
 * dots, left out of the line, listed under the chart to keep or hide.
 *
 * Tap the chart (or the expand button) for full screen: pinch to zoom, two
 * fingers or the arrows to pan, the same scrub, chips and source switch.
 *
 * `startLine` ({ value, date }) adds the "Since start" range, a dashed line at
 * the start value, and measures the header change from it.
 */
export default function TrendChart(props) {
  const {
    metric, chartType = metric, title, unit = '', dp = 1, series, current = null, currentCaption = null,
    events = [], wobble: wobbleProp, window: fixed = null, defaultRange = '90D', testid, note = null, onEditDate = null,
    startLine = null, refBand = null, format = null, changeUnit = null, controls = null, headerNote = null, pinsDefault, gapDays = undefined,
    suspects = [], onReview = null, full = false, initialRange = null, onClose = null,
  } = props
  // how a value reads: a number by default, or e.g. a clock time for bedtime
  const show = format || ((v) => fmt(v, dp))
  // null until a chip is tapped: a series with under 90 days of data opens on All
  const [rangeKey, setRangeKey] = useState(initialRange)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [scrub, setScrub] = useState(null)
  const [isFull, setFull] = useState(false)
  const [zoom, setZoom] = useState(null) // full screen only: the window shown inside the range
  const drag = useRef(null)
  const pinch = useRef(null)
  const touches = useRef(new Map())
  const svgRef = useRef(null)
  const swallowClick = useRef(false)
  const tests = useStore((s) => s.bloods?.tests || [])
  const saved = useStore((s) => s.healthSettings?.overlays?.[chartType])
  const haptics = useStore((s) => s.settings?.haptics)
  const setChartOverlay = useStore((s) => s.setChartOverlay)
  const t = todayStr()
  const chosen = rangeKey ?? defaultRangeFor(series || [], t, defaultRange)
  // "Since start" needs a starting point on this chart; without one it is the 90 day view
  const range = chosen === 'Start' && !startLine ? '90D' : chosen
  // full screen fills the window: chart units are points there, so labels keep their size and the plot takes the room
  const boxRef = useRef(null)
  const [box, setBox] = useState(null)
  useEffect(() => {
    if (!full || !boxRef.current || typeof window.ResizeObserver === 'undefined') return
    const ro = new window.ResizeObserver(([e]) => setBox({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [full])
  const Wv = full && box?.w ? Math.max(300, box.w) : W
  const laneCount = (useStore.getState().healthSettings?.overlays?.[chartType]?.lanes || []).length
  const plotH = full ? (box?.h ? Math.max(200, box.h - PAD.t - PAD.b - PIN_ROW - laneCount * LANE_H - 12) : FULL_PLOT_H) : PLOT_H

  // normal wobble: how far daily values usually sit from their 7-day average
  const wobble = useMemo(() => (wobbleProp !== undefined ? wobbleProp
    : metric in PHASES.wobbleFallback ? wobbleOf(series || [], metric, t).value : null), [wobbleProp, metric, series, t])
  // sauna and sleep charts open with pins off; any chart remembers what was chosen
  const pinsOn = pinsDefault ?? !pinsOffByDefault(String(chartType))
  const ov = { pins: saved?.pins ?? pinsOn, wobble: saved?.wobble ?? false, bloods: saved?.bloods ?? [] }
  const setOv = (patch) => setChartOverlay?.(chartType, patch)
  const markerNames = useMemo(() => [...new Set(tests.flatMap((x) => Object.keys(x.values || {})))].sort(), [tests])

  const bounds = fixed || rangeBounds(range, t, series || [], startLine?.date)
  const { from, to } = full && zoom ? zoom : bounds
  const bucket = fixed || (full && zoom) ? bucketForSpan(from, to) : bucketFor(range, from, to)
  const points = useMemo(() => mergeScans(bucketPoints(series || [], bucket, from, to)), [series, bucket, from, to])
  // gapDays marks a missed night as a gap on the daily view (weekly and monthly averages already span them)
  const segments = useMemo(() => lineSegments(points, bucket === 'day' ? gapDays : undefined), [points, bucket, gapDays])
  const band = ov.wobble && wobble ? [wobble, -wobble] : []
  // the starting value: on the axis only on "Since start"; elsewhere drawn when it falls inside it
  const startOn = startLine && startLine.date <= to && points.length ? startLine : null
  const extra = useMemo(() => [
    ...(band.length ? points.flatMap((p) => [p.value + wobble, p.value - wobble]) : []),
    ...(startOn && range === 'Start' ? [startOn.value] : []),
  ], [points, band.length, wobble, startOn, range])
  const { axis, xFor, yFor } = useChartGeometry({ points, from, to, metric, extraValues: extra, plotH, w: Wv })
  const start = startOn && startOn.value >= axis.lo && startOn.value <= axis.hi ? startOn : null
  const startOff = startOn && !start ? `Start ${show(startOn.value)}${unit ? ` ${unit}` : ''}, ${startOn.value > axis.hi ? 'above' : 'below'} this chart` : null
  const color = colorFor(metric)
  const refIn = bandInView(refBand, axis)
  const refOff = bandCaption(refBand, axis, unit)

  const avg = points.filter((p) => !p.scan)
  const plotBottom = PAD.t + plotH
  const groups = ov.pins ? groupEvents(events.filter((e) => e.date >= from && e.date <= to)) : []
  const { compounds: laneCompounds, chosen: laneIds, lanes, toggle: toggleLane } = useLanes(chartType, from, to)
  const blood = ov.bloods.length ? bloodPoints(tests, ov.bloods, from, to) : []
  // pins sit in one row under the dates, then the compound lanes
  const pinTop = plotBottom + PAD.b
  const laneTop = pinTop + (groups.length ? PIN_ROW : 0)
  const H = laneTop + lanes.length * LANE_H + 2
  const shownValue = current ?? (points.length ? points[points.length - 1].value : null)
  const changeAll = rangeChange({
    series: series || [], from, to, range: fixed ? 'window' : range,
    startValue: startLine?.value ?? null, startDate: startLine?.date ?? null, unit: changeUnit ?? (unit === '%' ? 'pts' : unit), dp,
  })
  const change = changeAll.words
  const answer = chartAnswer(change)
  const better = chartBetter(metric)
  const d0 = changeAll.delta
  const answerTone = !better || d0 == null || Math.abs(d0) < Math.pow(10, -dp) / 2 ? 'same' : (d0 > 0) === (better === 'up') ? 'better' : 'worse'

  // value labels by priority (last, first, lowest, highest, then the start label); a label that
  // would cover another, the dates or the plot's edge is left out
  const place = labelPlacement(points.map((p) => p.value))
  const labelText = (p) => (p.estimated ? 'Start (est.)' : show(p.value))
  const cands = labelPriority(points.map((p) => p.value)).map((i) => {
    const x = xFor(points[i].x)
    const text = labelText(points[i])
    return {
      id: `p${i}`, i, text, w: text.length * CH + 3, h: 13, x,
      y: yFor(points[i].value) + (place[i] === 'above' ? -8 : 18),
      anchor: x < PAD.l + 22 ? 'start' : x > Wv - PAD.r - 22 ? 'end' : 'middle',
    }
  })
  if (start) {
    const text = `Start ${show(start.value)}`
    cands.push({ id: 'start', text, w: text.length * (CH - 0.6) + 3, h: 12, x: Wv - PAD.r, y: yFor(start.value) - 4, anchor: 'end' })
  }
  const keep = placeLabels(cands, xTickBoxes(from, to, plotBottom, Wv), { l: PAD.l, r: Wv, t: PAD.t - 4, b: plotBottom + 2 })

  // pins: small dots in one row, a short label where it fits
  const pinCands = groups.map((g, i) => {
    const text = pinLabel(g.events[0]?.text)
    return { id: `pin${i}`, text, x: xFor(g.date) + 7, y: pinTop + 15, w: text.length * (CH - 1) + 2, h: 12, anchor: 'start' }
  })
  const pinKeep = placeLabels([...pinCands].reverse(), groups.map((g, i) => ({ id: `d${i}`, x: xFor(g.date), y: pinTop + 15, w: 8, h: 8 })), { l: 0, r: Wv, t: pinTop, b: pinTop + PIN_ROW })

  const bloodY = (b) => {
    const vals = blood.filter((x) => x.marker === b.marker).map((x) => x.value)
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    return plotBottom - 10 - (hi === lo ? 0.5 : (b.value - lo) / (hi - lo)) * (plotH - 20)
  }

  const flagged = suspects.filter((x) => x.state !== 'hide' && x.state !== 'keep')
  const hidden = suspects.filter((x) => x.state === 'hide')
  const flaggedIn = flagged.filter((x) => x.date >= from && x.date <= to)
  const clampY = (v) => Math.min(plotBottom - 2, Math.max(PAD.t + 2, yFor(v)))

  const sel = selected?.type === 'point' ? points[selected.i] : null
  const pin = selected?.type === 'pin' ? groups[selected.i] : null
  const laneChange = selected?.type === 'lane' ? selected.change : null

  // ---- scrubbing: press and drag for a crosshair with value, date, source and lane values;
  // in full screen, two fingers pinch to zoom and drag to pan
  const svgX = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    return ((e.clientX - r.left) / (r.width || 1)) * Wv
  }
  const scrubTo = (e) => {
    const i = nearestPoint(points.map((p) => xFor(p.x)), svgX(e))
    setScrub((cur) => {
      if (i >= 0 && cur !== i && haptics) haptic(4)
      return i >= 0 ? i : cur
    })
  }
  const spanDays = dayNum(to) - dayNum(from)
  const frac = (x) => Math.min(1, Math.max(0, (x - PAD.l) / (Wv - PAD.l - PAD.r)))
  const onDown = (e) => {
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (full && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()]
      const r = svgRef.current.getBoundingClientRect()
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: (a.x + b.x) / 2, win: { from, to }, width: r.width || 1, left: r.left }
      drag.current = null
      setScrub(null)
      return
    }
    drag.current = { x: e.clientX, id: e.pointerId, on: false }
  }
  const onMove = (e) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = pinch.current
    if (full && p && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const mid = (a.x + b.x) / 2
      const at = frac(((p.mid - p.left) / p.width) * Wv)
      const zoomed = zoomWindow(p.win, p.dist / dist, at, bounds)
      const days = -((mid - p.mid) / p.width) * (dayNum(zoomed.to) - dayNum(zoomed.from))
      setZoom(panWindow(zoomed, days, bounds))
      return
    }
    const d = drag.current
    if (!d || !points.length) return
    if (!d.on && Math.abs(e.clientX - d.x) > SCRUB_MOVE) {
      d.on = true
      try { svgRef.current.setPointerCapture(d.id) } catch { /* not capturable */ }
      setSelected(null)
    }
    if (d.on) scrubTo(e)
  }
  const onUp = (e) => {
    touches.current.delete(e?.pointerId)
    if (touches.current.size < 2) pinch.current = null
    const d = drag.current
    drag.current = null
    if (d?.on) {
      setScrub(null)
      // the click that follows a drag is not a tap on a point
      swallowClick.current = true
      setTimeout(() => { swallowClick.current = false }, 0)
    }
  }
  const tap = (fn) => (e) => { e.stopPropagation(); if (swallowClick.current) return; fn(e) }
  // a tap on the plot itself (not a point or a pin) opens full screen
  const tapPlot = (e) => {
    if (full || fixed || swallowClick.current) return
    if (e.target?.closest?.('[data-testid^="lane-"]')) return
    setFull(true)
  }
  const zoomBy = (factor) => setZoom(zoomWindow({ from, to }, factor, 0.5, bounds))
  const panBy = (sign) => setZoom(panWindow({ from, to }, sign * Math.max(1, Math.round(spanDays / 3)), bounds))

  const scrubbed = scrub != null ? points[scrub] : null
  const readout = scrubbed ? {
    x: xFor(scrubbed.x),
    lines: [
      ...(scrubbed.members
        ? scrubbed.members.map((m) => `${show(m.value)}${unit ? ` ${unit}` : ''} · ${pointDates(m)}`)
        : [`${scrubbed.estimated ? 'Start (est.) ' : ''}${show(scrubbed.value)}${unit ? ` ${unit}` : ''} · ${pointDates(scrubbed)} · ${scrubbed.sources.join(', ')}`]),
      ...laneValuesAt(lanes, scrubbed.x),
    ],
  } : null

  // two readings are not a trend: a short list instead of a chart
  if (!fixed && chartMode(series || []) === 'list') {
    const rows = [...(series || [])].sort((a, b) => b.date.localeCompare(a.date))
    return (
      <div className="card p-3" data-testid={testid || `trend-chart-${chartType}`} data-mode="list">
        <p className="t-caption" style={{ color: 'var(--text-2)' }}>{title}</p>
        {rows.length === 0
          ? <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-2)' }} data-testid="chart-empty">No data yet.</p>
          : (
            <div className="mt-1" data-testid="chart-list">
              {rows.map((p) => (
                <p key={`${p.date}-${p.value}`} className="flex justify-between py-1 text-sm tabular-nums" data-testid="chart-list-row">
                  <span style={{ color: 'var(--text-2)' }}>{shortDate(p.date)}</span>
                  <span className="font-bold">{show(p.value)}{unit ? ` ${unit}` : ''}</span>
                </p>
              ))}
              <p className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>A chart appears from {LIST_UNDER_POINTS} readings.</p>
            </div>
          )}
        {note && <p className="mt-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{note}</p>}
      </div>
    )
  }

  const chart = (
    <div className={full ? 'flex min-h-0 flex-1 flex-col overflow-y-auto' : 'card p-3'} data-testid={full ? 'chart-full' : (testid || `trend-chart-${chartType}`)}
      data-range={fixed ? 'window' : range} data-bucket={bucket} data-from={from} data-to={to}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold leading-snug" data-testid="chart-question">{chartQuestion(metric, title)}</p>
          <p className="mt-1 flex items-baseline gap-2 tabular-nums">
            <span className="text-[26px] font-extrabold leading-tight" data-testid="chart-current">
              {shownValue != null ? show(shownValue) : '–'}{unit && <span className="ml-0.5 text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{unit}</span>}
            </span>
            <span className="truncate text-sm font-medium" style={{ color: 'var(--text-3)' }}>{title}</span>
          </p>
          {answer && (
            <p className="text-[15px] font-semibold tabular-nums" style={{ color: answerTone === 'same' ? 'var(--text)' : TONE_COLOR[answerTone] }} data-testid="chart-answer">{answer}</p>
          )}
          {currentCaption && (
            <p className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="chart-change">{currentCaption}</p>
          )}
          {headerNote}
        </div>
        {full ? (
          <button onClick={onClose} aria-label="Close full screen" className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }} data-testid="chart-full-close">
            <X size={14} /> Close
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            {!fixed && (
              <button onClick={() => setFull(true)} aria-label={`Open ${title} full screen`} data-testid="chart-expand"
                className="flex items-center rounded-full p-1.5" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                <Maximize2 size={13} />
              </button>
            )}
            <button onClick={() => setOverlayOpen((v) => !v)} data-testid="overlay-button" aria-expanded={overlayOpen}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              <Layers size={12} /> Overlay
            </button>
          </div>
        )}
      </div>
      {controls && <div className="mt-2">{controls}</div>}
      {!fixed && <div className="mt-2"><RangeChips value={range} withStart={!!startLine} onChange={(k) => { setRangeKey(k); setSelected(null); setZoom(null) }} /></div>}
      {full && (
        <div className="mt-2 flex items-center gap-1.5" data-testid="chart-zoom">
          <button onClick={() => zoomBy(0.5)} aria-label="Zoom in" data-testid="zoom-in" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}><ZoomIn size={15} /></button>
          <button onClick={() => zoomBy(2)} aria-label="Zoom out" data-testid="zoom-out" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}><ZoomOut size={15} /></button>
          <button onClick={() => panBy(-1)} aria-label="Earlier" data-testid="pan-left" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}><ChevronLeft size={15} /></button>
          <button onClick={() => panBy(1)} aria-label="Later" data-testid="pan-right" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}><ChevronRight size={15} /></button>
          <span className="ml-1 text-[11px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="zoom-window">{shortDate(from)} to {shortDate(to)} · pinch to zoom</span>
        </div>
      )}

      {overlayOpen && !full && (
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
        <div ref={full ? boxRef : undefined} className={full ? 'min-h-[260px] flex-1' : ''}>
        <svg ref={svgRef} viewBox={`0 0 ${Wv} ${H}`} className="mt-2 w-full select-none" role="img" aria-label={`${title} over time`}
          style={{ touchAction: full ? 'none' : 'pan-y' }} data-testid="chart-svg" data-plot-h={plotH}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClick={tapPlot}>
          <Axes axis={axis} yFor={yFor} from={from} to={to} dp={dp} format={format} plotH={plotH} w={Wv} unit={axisUnit(unit, metric)} better={betterHint(metric)} />
          {refIn && (
            <g data-testid="chart-ref-band">
              <rect x={PAD.l} width={Wv - PAD.r - PAD.l} y={yFor(refIn.hi)} height={Math.max(1, yFor(refIn.lo) - yFor(refIn.hi))} fill="var(--text)" opacity="0.06" />
            </g>
          )}
          {start && (
            <line x1={PAD.l} x2={Wv - PAD.r} y1={yFor(start.value)} y2={yFor(start.value)} stroke="var(--text-3)" strokeDasharray="4 4" strokeWidth="1" opacity="0.7" data-testid="chart-start-line" />
          )}
          {band.length > 0 && avg.length > 1 && (
            <polygon data-testid="wobble-band" fill={color} opacity="0.08"
              points={[...avg.map((p) => `${xFor(p.x)},${yFor(p.value + wobble)}`), ...[...avg].reverse().map((p) => `${xFor(p.x)},${yFor(p.value - wobble)}`)].join(' ')} />
          )}
          {pin && (
            <line x1={xFor(pin.date)} x2={xFor(pin.date)} y1={PAD.t} y2={pinTop + 6} stroke="var(--text-2)" strokeDasharray="3 3" strokeWidth="1" data-testid="pin-line" />
          )}
          {segments.map((sg, i) => (
            <line key={`s${i}`} x1={xFor(sg.a.x).toFixed(1)} y1={yFor(sg.a.value).toFixed(1)} x2={xFor(sg.b.x).toFixed(1)} y2={yFor(sg.b.value).toFixed(1)}
              stroke={color} strokeWidth={sg.gap ? 1.5 : 2} strokeLinecap="round" strokeDasharray={sg.gap ? '3 5' : undefined} opacity={sg.gap ? 0.45 : 1}
              data-testid={sg.gap ? 'chart-gap' : 'chart-segment'} />
          ))}
          {blood.map((b, i) => (
            <g key={`b${i}`} data-testid="overlay-blood">
              <rect x={xFor(b.date) - 3} y={bloodY(b) - 3} width="6" height="6" transform={`rotate(45 ${xFor(b.date)} ${bloodY(b)})`} fill="var(--text-3)" />
              <text x={xFor(b.date) + 6} y={bloodY(b) - 4} fontSize={FS - 1.5} fontWeight="700" fill="var(--text-3)">{shortName(b.marker)} {b.value}</text>
            </g>
          ))}
          {flaggedIn.map((x) => (
            <circle key={`q${x.date}${x.value}`} cx={xFor(x.date)} cy={clampY(x.value)} r="3.5" fill="none" stroke="var(--text-3)" strokeWidth="1.5" data-testid="chart-suspect">
              <title>{`${show(x.value)}${unit ? ` ${unit}` : ''} on ${shortDate(x.date)}, looks wrong`}</title>
            </circle>
          ))}
          {points.map((p, i) => {
            const cx = xFor(p.x)
            const cy = yFor(p.value)
            return (
              <g key={`${p.x}-${p.scan}`}>
                {p.scan
                  ? <circle cx={cx} cy={cy} r="4" fill="var(--surface-solid)" stroke={color} strokeWidth="2" strokeDasharray={p.estimated ? '2 2' : undefined} data-testid={p.estimated ? 'chart-start-est' : 'chart-scan'} data-members={p.members?.length || 1} />
                  : <circle cx={cx} cy={cy} r="3" fill={color} data-testid="chart-point" />}
                <circle cx={cx} cy={cy} r="11" fill="transparent" onClick={tap(() => setSelected({ type: 'point', i }))} data-testid="chart-hit" style={{ cursor: 'pointer' }} />
              </g>
            )
          })}
          {cands.filter((c) => keep.has(c.id)).map((c) => (
            <text key={c.id} x={c.x} y={c.y} fontSize={c.id === 'start' ? FS - 1 : FS} fontWeight={c.id === 'start' ? 700 : 600} textAnchor={c.anchor}
              fill={c.id === 'start' ? 'var(--text-3)' : 'var(--text-2)'} className="tabular-nums" data-testid={c.id === 'start' ? 'chart-start-label' : 'chart-label'}>{c.text}</text>
          ))}
          {laneChange && (
            <line x1={xFor(laneChange.date)} x2={xFor(laneChange.date)} y1={PAD.t} y2={laneTop + lanes.length * LANE_H} stroke="var(--text-2)" strokeDasharray="3 3" data-testid="lane-guide" />
          )}
          {groups.map((g, i) => (
            <g key={`pin${g.date}`} onClick={tap(() => setSelected({ type: 'pin', i }))} style={{ cursor: 'pointer' }} data-testid="chart-pin" data-count={g.events.length}>
              <rect x={xFor(g.date) - 8} y={pinTop} width={pinKeep.has(`pin${i}`) ? pinCands[i].w + 16 : 16} height={PIN_ROW} fill="transparent" />
              <circle cx={xFor(g.date)} cy={pinTop + 11} r={pin === g ? 4.5 : 3.5} fill={pin === g ? 'var(--text)' : 'var(--text-2)'} />
              {pinKeep.has(`pin${i}`) && <text x={pinCands[i].x} y={pinTop + 15} fontSize={FS - 1.5} fontWeight="700" fill="var(--text-3)" data-testid="pin-label">{pinCands[i].text}{g.events.length > 1 ? ` +${g.events.length - 1}` : ''}</text>}
            </g>
          ))}
          <LaneRows lanes={lanes} top={laneTop} xFor={xFor} left={PAD.l} right={Wv - PAD.r} picked={laneChange}
            onPick={(change) => setSelected({ type: 'lane', change })} />
          {readout && (
            <g data-testid="scrub" pointerEvents="none">
              <line x1={readout.x} x2={readout.x} y1={PAD.t} y2={plotBottom} stroke="var(--text)" strokeWidth="1" opacity="0.7" />
              <circle cx={readout.x} cy={yFor(scrubbed.value)} r="5" fill="none" stroke="var(--text)" strokeWidth="1.5" />
              {(() => {
                const w = Math.min(Wv - PAD.l - PAD.r, Math.max(...readout.lines.map((l) => l.length)) * (CH - 0.3) + 14)
                const left = readout.x > Wv / 2 ? PAD.l : Wv - PAD.r - w
                return (
                  <g data-testid="scrub-readout">
                    <rect x={left} y={PAD.t - 24} width={w} height={readout.lines.length * 15 + 7} rx="6" fill="var(--surface-solid)" stroke="var(--border)" />
                    {readout.lines.map((l, i) => (
                      <text key={i} x={left + 7} y={PAD.t - 11 + i * 15} fontSize={FS - 0.5} fontWeight={i ? 600 : 800} fill={i ? 'var(--text-2)' : 'var(--text)'} className="tabular-nums">{l}</text>
                    ))}
                  </g>
                )
              })()}
            </g>
          )}
        </svg>
        </div>
      )}

      {points.length > 0 && <ChartLegend items={legendItems({
        daily: bucket === 'day' && avg.length > 0 && points.some((p) => p.scan), averaged: bucket !== 'day' && avg.length > 0,
        scans: points.some((p) => p.scan && !p.estimated), estimatedStart: points.some((p) => p.estimated), startLine: !!start,
        wobble: band.length > 0, refBand: refIn ? (refBand.label || 'Reference range') : null, suspects: flaggedIn.length > 0,
        bloods: blood.length > 0, gap: segments.some((g) => g.gap), color,
      })} />}
      {(refOff || startOff) && (
        <p className="mt-1 text-[11px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="chart-off-range">{[refOff, startOff].filter(Boolean).join('. ')}</p>
      )}
      {refIn && !refOff && <p className="mt-1 text-[11px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="chart-ref-caption">Shaded: {refBand.label || 'reference range'} {refBand.lo} to {refBand.hi}{unit === '%' ? '%' : unit ? ` ${unit}` : ''}</p>}

      {(flagged.length > 0 || hidden.length > 0) && onReview && (
        <div className="mt-2 space-y-1.5 rounded-[10px] p-2.5" style={{ background: 'var(--surface-sunk)' }} data-testid="chart-suspects">
          {flagged.length > 0 && (
            <p className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-2)' }}>
              {flagged.length === 1 ? '1 reading looks wrong' : `${flagged.length} readings look wrong`} ({flagged.slice(0, 3).map((x) => `${show(x.value)}${unit ? ` ${unit}` : ''}, ${monthYear(x.date)}`).join('; ')}). Tap to keep or hide.
            </p>
          )}
          {flagged.map((x) => (
            <div key={`r${x.date}${x.value}`} className="flex items-center gap-2" data-testid="suspect-row">
              <span className="min-w-0 flex-1 text-[11px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>{show(x.value)}{unit ? ` ${unit}` : ''}, {shortDate(x.date)}{x.sourceLabel ? `, ${x.sourceLabel}` : ''}</span>
              <button onClick={() => onReview(x, 'keep')} className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: 'var(--surface2)' }} data-testid="suspect-keep">Keep</button>
              <button onClick={() => onReview(x, 'hide')} className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: 'var(--surface2)' }} data-testid="suspect-hide">Hide</button>
            </div>
          ))}
          {hidden.length > 0 && (
            <button onClick={() => hidden.forEach((x) => onReview(x, null))} className="text-[11px] font-bold" style={{ color: 'var(--text-3)' }} data-testid="suspect-show">
              {hidden.length === 1 ? '1 reading hidden' : `${hidden.length} readings hidden`}. Kept in your data. Show again
            </button>
          )}
        </div>
      )}

      {sel && (
        <div className="mt-2 flex items-start gap-2 rounded-[10px] p-2.5" style={{ background: 'var(--surface-sunk)' }} data-testid="point-popover">
          <div className="min-w-0 flex-1 text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            {sel.members ? (
              <>
                {sel.members.map((m) => (
                  <p key={m.x} className="font-bold" style={{ color: 'var(--text)' }} data-testid="merged-row">{pointDates(m)}: {show(m.value)}{unit ? ` ${unit}` : ''}</p>
                ))}
                <p>{sel.members.length} scans within 10 days, drawn as the latest · {sel.sources.join(', ')}</p>
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

  if (full) return chart
  return (
    <>
      {chart}
      {isFull && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[70] flex flex-col p-4" style={{ background: 'var(--bg)', paddingTop: 'max(16px, env(safe-area-inset-top))', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          role="dialog" aria-modal="true" aria-label={`${title}, full screen`} data-testid="chart-fullscreen">
          <TrendChart {...props} full initialRange={range} onClose={() => setFull(false)} />
        </div>,
        document.body,
      )}
    </>
  )
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthYear = (d) => `${MONTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
