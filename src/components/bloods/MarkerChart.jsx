import { useId, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Check } from 'lucide-react'
import { prettyDate } from '../../lib/schedule'
import { statusOf } from '../../lib/bloods'
import {
  PRESETS, DEFAULT_RANGE, yearsWithResults, rangeSeries, canPlotTrend, initialView, viewBounds,
  zoomView, panView, xFor, yFor, axisFor, inView, placeEvents, refGeometry, visibleLabels, labelGap,
  dateOfDay,
} from '../../lib/chartRange'
import { isCompatMouse } from '../../lib/mapGeometry'

const CH = { w: 320, h: 170, padL: 34, padR: 10, padT: 16, padB: 30 }
const PLOT = { left: CH.padL, right: CH.w - CH.padR, top: CH.padT, bottom: CH.h - CH.padB }
const TAP_SLOP = 12
const DOUBLE_TAP_MS = 350

const rangeKey = (r) => (r.kind === 'year' ? `year-${r.year}` : r.key)

function tickText(v, span) {
  const decimals = span >= 20 ? 0 : span >= 2 ? 1 : 2
  return String(Number(v.toFixed(decimals)))
}

/**
 * The marker graph: a time range you choose, and a view you can pinch and drag.
 *
 * Choosing a range fits both axes to the results inside it, so the line uses the
 * whole chart rather than the height of the biggest value ever recorded.
 * Zooming and panning refit the y axis to whatever is in view as it moves. All
 * of the arithmetic is in lib/chartRange; this draws it and reads the fingers.
 *
 * A range with fewer than two results does not get a line. It gets the values,
 * and a sentence saying why there is no trend to show.
 */
export default function MarkerChart({ name, series, range, events, overlay, overlayable, onToggleOverlay, today }) {
  const clipId = useId().replace(/:/g, '')
  const [sel, setSel] = useState(DEFAULT_RANGE)
  const [yearsOpen, setYearsOpen] = useState(false)
  const [userView, setUserView] = useState(null)
  const svgRef = useRef(null)
  const gesture = useRef(null)
  const lastTouchAt = useRef(null)
  const lastTap = useRef(null)

  const years = useMemo(() => yearsWithResults(series), [series])
  const win = useMemo(() => rangeSeries(series, sel, today), [series, sel, today])
  const plottable = canPlotTrend(win)
  const opening = useMemo(() => initialView(series, sel, today), [series, sel, today])
  const bounds = useMemo(() => (opening ? viewBounds(series, opening) : null), [series, opening])
  const view = userView || opening

  const choose = (next) => { setSel(next); setUserView(null) }
  const reset = () => setUserView(null)

  const geom = useMemo(() => {
    if (!plottable || !view) return null
    const axis = axisFor(series, view, sel, today)
    const seen = inView(series, view)
    return { axis, seen }
  }, [plottable, view, series, sel, today])

  // ------------------------------------------------------------- gestures
  const rectOf = () => svgRef.current?.getBoundingClientRect()
  const focusAt = (clientX) => {
    const r = rectOf()
    if (!r || !r.width) return 0.5
    const unit = ((clientX - r.left) / r.width) * CH.w
    return Math.min(1, Math.max(0, (unit - PLOT.left) / (PLOT.right - PLOT.left)))
  }
  const daysPerPx = (v) => {
    const r = rectOf()
    if (!r || !r.width) return 0
    const plotPx = ((PLOT.right - PLOT.left) / CH.w) * r.width
    return (v.x1 - v.x0) / plotPx
  }
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  const begin = (touches) => {
    if (!plottable || !view) return
    if (touches.length >= 2) {
      gesture.current = {
        type: 'pinch', start: view, d0: dist(touches) || 1,
        focus: focusAt((touches[0].clientX + touches[1].clientX) / 2),
      }
    } else {
      gesture.current = {
        type: 'pan', start: view, x0: touches[0].clientX, y0: touches[0].clientY,
        moved: false, at: Date.now(),
      }
    }
  }
  const move = (touches) => {
    const g = gesture.current
    if (!g || !bounds) return
    if (g.type === 'pinch' && touches.length >= 2) {
      setUserView(zoomView(g.start, g.d0 / (dist(touches) || 1), g.focus, bounds))
    } else if (g.type === 'pan' && touches.length === 1) {
      const dx = touches[0].clientX - g.x0
      if (Math.abs(dx) > TAP_SLOP || Math.abs(touches[0].clientY - g.y0) > TAP_SLOP) g.moved = true
      if (g.moved) setUserView(panView(g.start, -dx * daysPerPx(g.start), bounds))
    }
  }
  const finishTap = (x, y) => {
    const now = Date.now()
    const prev = lastTap.current
    if (prev && now - prev.at < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < TAP_SLOP * 3) {
      lastTap.current = null
      reset()
    } else {
      lastTap.current = { at: now, x, y }
    }
  }

  const onTouchStart = (e) => { lastTouchAt.current = Date.now(); begin(e.touches) }
  const onTouchMove = (e) => { lastTouchAt.current = Date.now(); move(e.touches) }
  const onTouchEnd = (e) => {
    lastTouchAt.current = Date.now()
    const g = gesture.current
    if (e.touches.length === 0) {
      if (g?.type === 'pan' && !g.moved && Date.now() - g.at < 400) {
        const t = e.changedTouches?.[0]
        finishTap(t?.clientX ?? g.x0, t?.clientY ?? g.y0)
      }
      gesture.current = null
    } else if (g?.type === 'pinch') {
      gesture.current = null // one finger left: wait for a fresh gesture
    }
  }
  const compat = () => isCompatMouse(Date.now(), lastTouchAt.current)
  const onMouseDown = (e) => { if (!compat()) begin([e]) }
  const onMouseMove = (e) => { if (gesture.current?.type === 'pan' && !compat()) move([e]) }
  const endMouse = () => { if (!compat() && gesture.current?.type === 'pan') gesture.current = null }
  const onDoubleClick = () => { if (!compat()) reset() }

  // ------------------------------------------------------------------ UI
  const chips = (
    <div data-testid="range-select">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Time range">
        {PRESETS.map((p) => {
          const on = sel.kind === 'preset' && sel.key === p.key
          return (
            <button key={p.key} data-testid={`range-${p.key}`} data-on={on ? 'true' : 'false'} aria-pressed={on}
              onClick={() => choose({ kind: 'preset', key: p.key })}
              className="min-h-[34px] rounded-full px-3 text-xs font-bold"
              style={on ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {p.label}
            </button>
          )
        })}
        <button data-testid="range-by-year" data-on={sel.kind === 'year' ? 'true' : 'false'} aria-expanded={yearsOpen}
          onClick={() => setYearsOpen((v) => !v)}
          className="min-h-[34px] rounded-full px-3 text-xs font-bold"
          style={sel.kind === 'year' ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
          {sel.kind === 'year' ? sel.year : 'By year'}
        </button>
      </div>
      {(yearsOpen || sel.kind === 'year') && (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="range-years">
          {years.map((y) => {
            const on = sel.kind === 'year' && sel.year === y
            return (
              <button key={y} data-testid={`range-year-${y}`} data-on={on ? 'true' : 'false'} aria-pressed={on}
                onClick={() => choose({ kind: 'year', year: y })}
                className="min-h-[30px] rounded-full px-2.5 text-xs font-bold tabular-nums"
                style={on ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {y}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  // Fewer than two results in the range: show them, draw nothing.
  if (!plottable || !view || !geom) {
    return (
      <div className="card p-3" data-testid="marker-graph" data-range={rangeKey(sel)} data-sparse="true">
        <p className="t-caption" style={{ color: 'var(--text-2)' }}>Over time</p>
        <div className="mt-2">{chips}</div>
        <div className="mt-3" data-testid="chart-sparse">
          <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>
            Not enough data to plot a trend in this range
            {win.length === 1 ? ' — one result.' : ' — no results.'}
            {series.length > win.length ? ' A longer range has more.' : ''}
          </p>
          {win.length > 0 && (
            <div className="mt-2 rows" data-testid="chart-sparse-values">
              {win.map((s) => {
                const st = statusOf(s.value, range)
                return (
                  <div key={s.date} className="flex items-baseline gap-3 py-1.5" data-testid="sparse-value" data-date={s.date}>
                    <span className="min-w-0 flex-1 text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
                      {prettyDate(s.date)}
                    </span>
                    <span className="text-sm font-black tabular-nums"
                      style={{ color: st === 'in' ? 'var(--text)' : 'var(--warn)' }}>{s.value}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  const { axis } = geom
  const ref = refGeometry(range, axis, PLOT)
  const spanDays = view.x1 - view.x0
  const xText = (n) => format(parseISO(dateOfDay(n)), spanDays > 500 ? 'MMM yy' : 'd MMM yy')

  const pts = series.map((s) => ({ ...s, x: xFor(s.date, view, PLOT), y: yFor(s.value, axis, PLOT) }))
  const shown = pts.filter((p) => p.x >= PLOT.left - 0.5 && p.x <= PLOT.right + 0.5)
  const firstSeen = shown[0]
  const lastSeen = shown[shown.length - 1]
  const keep = visibleLabels(shown, {
    minGap: Math.max(...shown.map((p) => labelGap(p.value)), 24),
    priority: (p) => (statusOf(p.value, range) !== 'in' ? 2 : p === firstSeen || p === lastSeen ? 1 : 0),
  })
  const placedAll = placeEvents(events.filter((e) => overlay.has(e.peptideId)), view, PLOT)
  const placed = placedAll.filter((e) => e.visible)
  // a compound switched on whose changes all fall outside this view would look
  // like a toggle that does nothing, so say why
  const offscreen = overlayable.filter((c) => overlay.has(c.id)
    && !placed.some((e) => e.peptideId === c.id))

  const yTicks = [axis.lo, (axis.lo + axis.hi) / 2, axis.hi]
  const refYs = (ref?.lines || []).map((v) => yFor(v, axis, PLOT))
  const yAxisSpan = axis.hi - axis.lo

  return (
    <div className="card p-3" data-testid="marker-graph" data-range={rangeKey(sel)}
      data-view-from={dateOfDay(view.x0)} data-view-to={dateOfDay(view.x1)}
      data-axis-lo={axis.lo.toFixed(3)} data-axis-hi={axis.hi.toFixed(3)}
      data-zoomed={userView ? 'true' : 'false'} data-sparse="false">
      <p className="t-caption" style={{ color: 'var(--text-2)' }}>Over time</p>
      <div className="mt-2">{chips}</div>

      <svg ref={svgRef} viewBox={`0 0 ${CH.w} ${CH.h}`} className="mt-2 w-full select-none" role="img"
        aria-label={`${name} over time`} data-testid="chart-svg"
        style={{ overflow: 'visible', touchAction: 'pan-y', cursor: gesture.current ? 'grabbing' : 'grab' }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onTouchCancel={() => { lastTouchAt.current = Date.now(); gesture.current = null }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={endMouse} onMouseLeave={endMouse}
        onDoubleClick={onDoubleClick}>
        <defs>
          <clipPath id={clipId}>
            <rect x={PLOT.left} y={0} width={PLOT.right - PLOT.left} height={CH.h} />
          </clipPath>
        </defs>

        {/* faint guides, labelled in the axis' own numbers */}
        {yTicks.map((v, i) => {
          const y = yFor(v, axis, PLOT)
          const clash = refYs.some((ry) => Math.abs(ry - y) < 9)
          return (
            <g key={i}>
              <line x1={PLOT.left} y1={y} x2={PLOT.right} y2={y} stroke="var(--border)" strokeWidth="1" opacity="0.6" />
              {!clash && (
                <text x={PLOT.left - 4} y={y + 3} fontSize="9" fontWeight="700" textAnchor="end"
                  fill="var(--text-3)" className="tabular-nums">{tickText(v, yAxisSpan)}</text>
              )}
            </g>
          )
        })}

        {/* the lab's interval, behind everything */}
        {ref && (
          <rect x={PLOT.left} y={ref.top} width={PLOT.right - PLOT.left} height={Math.max(1, ref.bottom - ref.top)}
            fill="var(--good)" opacity="0.10" data-testid="ref-band" />
        )}
        {(ref?.lines || []).map((v) => (
          <g key={v}>
            <line x1={PLOT.left} y1={yFor(v, axis, PLOT)} x2={PLOT.right} y2={yFor(v, axis, PLOT)}
              stroke="var(--good)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
            <text x={PLOT.left - 4} y={yFor(v, axis, PLOT) + 3} fontSize="9" fontWeight="700" textAnchor="end"
              fill="var(--text-3)" className="tabular-nums">{v}</text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {/* what the protocol was doing, drawn behind the line */}
          {placed.map((e, i) => (
            <g key={`${e.peptideId}-${e.date}-${i}`} data-testid="overlay-mark"
              data-compound={e.peptideId} data-kind={e.kind} data-date={e.date} data-x={e.x.toFixed(2)}>
              <line x1={e.x} y1={PLOT.top} x2={e.x} y2={PLOT.bottom}
                stroke="var(--info)" strokeWidth="1" strokeDasharray="2 3" opacity="0.8" />
              <text x={e.x + 2} y={PLOT.top + 8} fontSize="8" fontWeight="700"
                fill="var(--info)">{e.kind === 'start' ? '▲' : e.kind === 'stop' ? '■' : '◆'}</text>
            </g>
          ))}

          {/* the line itself */}
          <polyline fill="none" stroke="var(--text)" strokeWidth="2" strokeLinejoin="round"
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
        </g>

        {shown.map((p) => {
          const st = statusOf(p.value, range)
          const i = shown.indexOf(p)
          return (
            <g key={p.date} data-testid="graph-point" data-date={p.date} data-status={st} data-x={p.x.toFixed(2)}>
              <circle cx={p.x} cy={p.y} r="3.5" fill={st === 'in' ? 'var(--text)' : 'var(--warn)'}
                stroke="var(--surface-solid)" strokeWidth="1.5" />
              {keep.has(i) && (
                <text x={p.x} y={p.y - 7} fontSize="9" fontWeight="800" data-testid="point-label"
                  textAnchor={p.x < PLOT.left + 14 ? 'start' : p.x > PLOT.right - 14 ? 'end' : 'middle'}
                  fill={st === 'in' ? 'var(--text-2)' : 'var(--warn)'} className="tabular-nums">
                  {p.value}
                </text>
              )}
            </g>
          )
        })}

        {[0, 0.5, 1].map((f) => (
          <text key={f} x={PLOT.left + f * (PLOT.right - PLOT.left)} y={CH.h - 8} fontSize="9" fontWeight="700"
            textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fill="var(--text-3)" className="tabular-nums"
            data-testid={f === 0 ? 'x-from' : f === 1 ? 'x-to' : undefined}>
            {xText(view.x0 + f * spanDays)}
          </text>
        ))}
      </svg>

      <p className="mt-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>
        Pinch to zoom · drag to pan · double-tap to reset
        {shown.length < pts.length ? ` · ${shown.length} of ${pts.length} results in view` : ''}
      </p>

      {/* which compounds to draw behind it */}
      {overlayable.length > 0 && (
        <div className="mt-2" data-testid="overlay-toggles">
          <p className="t-caption mb-1.5" style={{ color: 'var(--text-3)' }}>Overlay my compounds</p>
          <div className="flex flex-wrap gap-1.5">
            {overlayable.map((c) => (
              <button key={c.id} data-testid="overlay-toggle" data-on={overlay.has(c.id) ? 'true' : 'false'}
                onClick={() => onToggleOverlay(c.id)}
                className="flex min-h-[34px] items-center gap-1.5 rounded-full px-2.5 text-xs font-bold"
                style={overlay.has(c.id)
                  ? { background: 'color-mix(in srgb, var(--info) 22%, transparent)', color: 'var(--info)' }
                  : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {overlay.has(c.id) && <Check size={11} />} {c.name}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
            ▲ started · ◆ dose changed · ■ stopped. Lines mark when, not why — two things happening near
            each other is not one causing the other.
          </p>
          {offscreen.length > 0 && (
            <p className="mt-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }} data-testid="overlay-offscreen">
              {offscreen.map((c) => c.name).join(', ')}: nothing started, stopped or changed in this view.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
