import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import { haptic } from '../../lib/feedback'
import { hypnogramRows, durationWords } from '../../health/engine/sleepView'
import { hhmm } from '../../health/engine/planner'
import {
  momentAt, restlessBands, soundLane, SOUND_LANE_WORDS, whatHappened, nightSummary, NIGHT, STAGE_WORD,
  STAGE_COLOR, stageTotals, smoothPath, hrLow, crosshairCells, nightLegend, NIGHT_LAYOUT,
} from '../../sleep/nightView'
import { NightGesture, GESTURE, isZoomed, overviewBox, overviewDrag, nightTicks, tickPlace } from '../../sleep/nightGestures'
import { W, STAGE_LABEL } from './SleepCharts'
import { NO_RECORDING_LINE } from '../../sleep/prompts'
import { ChartLegend } from '../charts/TrendChart'

const MIN = 60000
const L = 84 // the stage and lane names with their totals or units
const R = 10
const FS = 12.5
const TIP = 'night-gestures'
const TICK_W = 36 // a "05:00" label at 12.5 pt
const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }

const LANE_INFO = {
  stages: 'Sleep stages, estimated by your Apple Watch from movement and heart rate. One row each: Awake at the top, then REM, Core and Deep.',
  move: 'Movement from your Apple Watch: taller bars mean more movement in that minute. Shaded stretches are restless periods, 5 minutes with 30 seconds or more of movement. The Watch sends a night once it has read it, usually when the Pepito Watch app next runs.',
  sound: 'Snoring, coughs and talking heard by Sleep sounds on your iPhone. Only the time and kind of sound are kept, never audio.',
  hr: 'Heart rate from your Apple Watch while you slept. The dot marks the lowest reading of the night.',
  spo2: 'Blood oxygen readings from your Apple Watch. A reading under 90% is shown in amber.',
}
const LANE_NAME = { move: ['Move', null], sound: ['Sound', null], hr: ['Heart rate', 'bpm'], spo2: ['SpO2', '%'] }
const INFO_TITLE = { stages: 'Stages', move: 'Move', sound: 'Sound', hr: 'Heart rate', spo2: 'Blood oxygen' }

/**
 * The night in one card: stages as coloured blocks, one row each (Awake, REM,
 * Core, Deep), then Move, Sound, heart rate and blood oxygen on the same clock.
 * Touch follows `NightGesture`: a vertical swipe scrolls the page, a sideways
 * drag shows the crosshair (when zoomed it pans, and a press and hold first
 * gives the crosshair), two fingers pinch the time axis from 30 minutes to the
 * whole night, a double tap resets. While the crosshair is out, a panel above
 * the chart gives that minute in big numbers. Full screen opens only from the
 * expand icon and is the same component, larger. Under the chart: an overview
 * strip while zoomed, the legend and the night's notable moments.
 */
export default function NightCard({ night, overnight, restless, soundSessions, soundsOn, events = [], moveLane = 'none', tz, full = false, onClose = null }) {
  const noRecording = moveLane === 'missing'
  const moveWaiting = moveLane === 'waiting'
  const [win, setWinNow] = useState(null)
  const [cursor, setCursor] = useState(null)
  const [isFull, setFull] = useState(false)
  const [info, setInfo] = useState(null)
  const haptics = useStore((s) => s.settings?.haptics)
  const tipSeen = useStore((s) => !!s.coachMarks?.[TIP])
  const markCoachSeen = useStore((s) => s.markCoachSeen)
  const svgRef = useRef(null)
  const gesture = useRef(new NightGesture())
  const holdTimer = useRef(null)
  const lastStage = useRef(null)
  const lastLimit = useRef(null)
  const frame = useRef(0)
  const nextWin = useRef(null)
  // windows from a pinch or a pan land once a frame
  const setWin = (w) => {
    nextWin.current = w
    if (frame.current) return
    frame.current = window.requestAnimationFrame(() => { frame.current = 0; setWinNow(nextWin.current) })
  }
  useEffect(() => () => { window.cancelAnimationFrame(frame.current); clearTimeout(holdTimer.current) }, [])
  const clipId = `night-plot-${useId().replace(/:/g, '')}`

  const clock = (ms) => hhmm(tz.hourOf(ms) * 60)
  const data = useMemo(() => ({ night, overnight, restless, sounds: soundSessions || [], events }), [night, overnight, restless, soundSessions, events])
  const { rows, steps } = useMemo(() => hypnogramRows(night), [night])
  const totals = useMemo(() => stageTotals(steps), [steps])
  const bands = useMemo(() => restlessBands(restless), [restless])
  const low = hrLow(overnight?.hr, night.start)
  const lane = soundLane(soundSessions)
  const list = useMemo(() => whatHappened(data, clock), [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const summary = nightSummary(data)

  // full screen: measured, so the chart fills the width and most of the height in either orientation
  const boxRef = useRef(null)
  const [box, setBox] = useState(null)
  useEffect(() => {
    if (!full || !boxRef.current || typeof window.ResizeObserver === 'undefined') return
    const ro = new window.ResizeObserver(([e]) => setBox({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [full])
  const Wn = full && box?.w ? Math.max(320, box.w) : W

  const from = win?.from ?? night.start
  const to = win?.to ?? night.end
  const x = (t) => L + ((t - from) / (to - from || 1)) * (Wn - L - R)

  // the layout: stage rows, then each lane that has something to say
  const lanes = []
  const tight = full && (box?.h || 999) < NIGHT_LAYOUT.tightBelow
  const laneDef = (key) => ({ key, h: full ? (tight ? NIGHT_LAYOUT.fullLaneTight : NIGHT_LAYOUT.fullLaneH) : NIGHT_LAYOUT.cardLaneH[key] })
  if (restless?.series?.length || noRecording || moveWaiting) lanes.push(laneDef('move'))
  if (soundsOn || soundSessions?.length) lanes.push(laneDef('sound'))
  if (overnight?.hr?.length > 2) lanes.push(laneDef('hr'))
  if (overnight?.spo2?.length) lanes.push(laneDef('spo2'))
  const lanesH = lanes.reduce((a, l) => a + l.h, 0)
  const stagesH = full ? Math.max(tight ? NIGHT_LAYOUT.fullStagesTight : NIGHT_LAYOUT.fullStagesMin, (box?.h || 0) - lanesH - 40) : NIGHT_LAYOUT.cardStagesH
  const rowH = stagesH / Math.max(1, rows.length)
  const TOP = 4
  let y0 = TOP + stagesH + 8
  const laneTop = {}
  for (const l of lanes) { laneTop[l.key] = y0; y0 += l.h }
  const H = y0 + 22

  // ---- touch: see NightGesture
  const ctx = () => {
    const r = svgRef.current.getBoundingClientRect()
    const k = (r.width || 1) / Wn
    return { win: { from, to }, night, left: r.left + L * k, width: (Wn - L - R) * k }
  }
  const buzz = (kind) => { if (haptics) haptic(kind === 'limit' ? 8 : 4) }
  const moveTo = (t) => {
    const c = Math.min(to, Math.max(from, t))
    const st = momentAt(data, c).stage
    if (lastStage.current && st !== lastStage.current) buzz('stage')
    lastStage.current = st
    setCursor(c)
  }
  const apply = (effects, e) => {
    for (const fx of effects) {
      if (fx.kind === 'capture') { try { svgRef.current.setPointerCapture(e.pointerId) } catch { /* not capturable */ } }
      else if (fx.kind === 'cross') moveTo(fx.t)
      else if (fx.kind === 'endCross') { setCursor(null); lastStage.current = null }
      else if (fx.kind === 'holding') buzz('stage')
      else if (fx.kind === 'reset') setWinNow(null)
      else if (fx.kind === 'win') {
        if (fx.limit && fx.limit !== lastLimit.current) buzz('limit')
        lastLimit.current = fx.limit
        setWin(isZoomed(fx.win, night) ? fx.win : null)
      }
      if ((fx.kind === 'cross' || fx.kind === 'win') && !tipSeen) markCoachSeen(TIP)
    }
  }
  const onDown = (e) => {
    const c = ctx()
    apply(gesture.current.down(e.pointerId, e.clientX, e.clientY, e.timeStamp, c), e)
    clearTimeout(holdTimer.current)
    if (isZoomed(c.win, night)) {
      const t0 = e.timeStamp
      holdTimer.current = setTimeout(() => apply(gesture.current.hold(t0 + GESTURE.holdMs, ctx()), e), GESTURE.holdMs)
    }
  }
  const onMove = (e) => apply(gesture.current.move(e.pointerId, e.clientX, e.clientY, e.timeStamp, ctx()), e)
  const onUp = (e) => { clearTimeout(holdTimer.current); lastLimit.current = null; apply(gesture.current.up(e.pointerId, e.clientX, e.clientY, e.timeStamp), e) }
  const onCancel = (e) => { clearTimeout(holdTimer.current); apply(gesture.current.cancel(e.pointerId), e) }

  // the page must not scroll or zoom while the chart owns the touch, and never pinch-zoom here
  useEffect(() => {
    const el = svgRef.current
    if (!el) return undefined
    const stop = (ev) => { if (ev.cancelable) ev.preventDefault() }
    const onTouchMove = (ev) => { if (gesture.current.owns || ev.touches.length > 1) stop(ev) }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('gesturestart', stop, { passive: false })
    el.addEventListener('gesturechange', stop, { passive: false })
    return () => {
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('gesturestart', stop)
      el.removeEventListener('gesturechange', stop)
    }
  }, [])

  const jump = (t) => {
    if (t < from || t > to) {
      const span = to - from
      const f = Math.min(night.end - span, Math.max(night.start, t - span / 2))
      setWinNow({ from: f, to: f + span })
    }
    setCursor((c) => (c === t ? null : t))
  }

  // the overview strip: drag the highlighted window
  const ovRef = useRef(null)
  const ovDrag = useRef(null)
  const zoomed = isZoomed(win, night)
  const onOvDown = (e) => {
    const r = ovRef.current.getBoundingClientRect()
    ovDrag.current = { x: e.clientX, win: { from, to }, width: r.width * ((Wn - L - R) / Wn) }
    try { ovRef.current.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
  }
  const onOvMove = (e) => {
    const d = ovDrag.current
    if (d) setWin(overviewDrag(d.win, e.clientX - d.x, d.width, night))
  }
  const onOvUp = () => { ovDrag.current = null }

  const m = cursor != null ? momentAt(data, cursor) : null
  const rowTop = (row) => TOP + rows.indexOf(row) * rowH
  const rowMid = (row) => rowTop(row) + rowH / 2
  const inView = (s, e) => e > from && s < to
  const clipX = (t) => x(Math.min(to, Math.max(from, t)))
  const blockH = Math.max(6, Math.min(rowH - 10, full ? 28 : 22))

  const InfoDot = ({ k, y }) => (
    <g onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => { e.stopPropagation(); setInfo(k) }} style={{ cursor: 'pointer' }} data-testid={`lane-info-${k}`} role="button" aria-label={`About ${INFO_TITLE[k]}`}>
      <circle cx={8} cy={y} r="7" fill="var(--surface-sunk)" stroke="var(--border)" />
      <text x={8} y={y + 3.5} fontSize="10" fontWeight="800" textAnchor="middle" fill="var(--text-2)">i</text>
    </g>
  )

  // the name and, under it, a total or a unit
  const Name = ({ y, name, sub, testid }) => (
    <g data-testid={testid}>
      <text x={L - 8} y={sub ? y - 1 : y + 4} fontSize={FS} fontWeight="700" textAnchor="end" fill="var(--text-2)">{name}</text>
      {sub && <text x={L - 8} y={y + 13} fontSize={FS - 1} fontWeight="600" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{sub}</text>}
    </g>
  )

  const crossCells = m ? crosshairCells(m) : []

  const card = (
    <div className={full ? 'flex min-h-0 flex-1 flex-col overflow-y-auto' : ''} data-testid={full ? 'night-full' : 'night-card'}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[17px] font-semibold" data-testid="night-question">What happened through the night?</p>
        {full ? (
          <button onClick={onClose} className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--surface-sunk)' }} data-testid="night-full-close"><X size={14} /> Close</button>
        ) : (
          <button onClick={() => setFull(true)} aria-label="Open the night full screen" className="flex shrink-0 items-center justify-center rounded-full" style={{ width: 30, height: 30, background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="night-expand"><Maximize2 size={14} /></button>
        )}
      </div>

      {/* one slot above the chart: the summary, or the crosshair panel while dragging */}
      <div className="mt-1 h-[84px] overflow-hidden" data-testid="night-panel">
        {m ? (
          <div data-testid="cross-panel">
            <div className="flex items-baseline gap-3">
              <span className="text-[26px] font-extrabold leading-none tabular-nums" data-testid="cross-time">{clock(m.t)}</span>
              <span className="inline-flex items-center gap-1.5 text-[17px] font-semibold" data-testid="cross-stage">
                {m.stage && <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: STAGE_COLOR[m.stage] }} />}
                {m.stage ? STAGE_WORD[m.stage] : 'Not asleep'}
              </span>
            </div>
            <div className="mt-2 flex gap-x-5 overflow-hidden" data-testid="cross-lanes">
              {crossCells.length ? crossCells.slice(0, 4).map((c) => (
                <span key={c.key} className="flex shrink-0 flex-col" data-testid={`cross-${c.key}`}>
                  <span className="text-[12px] font-semibold" style={muted}>{c.label}</span>
                  <span className="whitespace-nowrap text-[17px] font-bold tabular-nums">{c.value}{c.unit && <span className="ml-0.5 text-[12px] font-semibold" style={muted}>{c.unit}</span>}</span>
                </span>
              )) : <span className="text-sm font-medium" style={muted}>Nothing else recorded here</span>}
            </div>
          </div>
        ) : (
          <>
            {summary && <p className="line-clamp-2 text-[15px] font-semibold leading-snug tabular-nums" data-testid="night-summary">{summary}</p>}
            {!tipSeen && steps.length > 0 && <p className="mt-1 text-sm font-medium" style={soft} data-testid="night-tip">Pinch to zoom. Drag sideways for any minute.</p>}
          </>
        )}
      </div>

      {!steps.length && <p className="text-xs font-medium" style={muted} data-testid="hypnogram-empty">Stage detail arrives with the next sync.</p>}
      <div ref={full ? boxRef : undefined} className={full ? 'mt-1 shrink-0' : ''} style={full ? { height: 'max(300px, calc(100dvh - 210px))' } : undefined} data-testid="night-plot">
        <svg ref={svgRef} viewBox={`0 0 ${Wn} ${H}`} className="w-full select-none" role="img" aria-label="The night: stages, movement, sounds, heart rate and blood oxygen on one time axis"
          style={{ touchAction: 'pan-y', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }} data-testid="hypnogram" data-stages-h={Math.round(stagesH)} data-lane-h={lanes.map((l) => l.h).join(',')}
          data-from={Math.round(from)} data-to={Math.round(to)}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
          <defs><clipPath id={clipId}><rect x={L} y="0" width={Wn - L - R} height={H} /></clipPath></defs>

          {/* stages: one row each, a rounded block per stretch, faint connectors between them */}
          {rows.map((r) => (
            <g key={r}>
              <rect x={L} y={rowTop(r) + 2} width={Wn - L - R} height={rowH - 4} rx="6" fill="var(--surface-sunk)" opacity="0.35" />
              <Name y={rowMid(r)} name={STAGE_LABEL[r]} sub={totals[r] != null ? durationWords(totals[r]) : '0 m'} testid={`stage-label-${r}`} />
            </g>
          ))}
          {rows.length > 0 && <InfoDot k="stages" y={rowMid(rows[0])} />}
          <g clipPath={`url(#${clipId})`}>
            {steps.map((s, i) => {
              const prev = steps[i - 1]
              if (!prev || prev.row === s.row || Math.abs(prev.end - s.start) > MIN || !inView(s.start - MIN, s.start + MIN)) return null
              const y1 = rowMid(prev.row)
              const y2 = rowMid(s.row)
              return <line key={`c${s.start}`} x1={x(s.start)} x2={x(s.start)} y1={Math.min(y1, y2) + blockH / 2} y2={Math.max(y1, y2) - blockH / 2} stroke={STAGE_COLOR[s.row]} strokeOpacity="0.35" strokeWidth="1.5" data-testid="stage-connector" />
            })}
            {steps.map((s) => inView(s.start, s.end) && (
              <rect key={s.start} x={x(s.start)} y={rowMid(s.row) - blockH / 2} width={Math.max(1.5, x(s.end) - x(s.start))} height={blockH}
                rx={Math.min(5, blockH / 2, Math.max(0.5, (x(s.end) - x(s.start)) / 2))} fill={STAGE_COLOR[s.row]} data-testid={`hypno-seg-${s.row}`} />
            ))}
          </g>

          {/* lanes, on the same clock */}
          {lanes.map((l) => {
            const top = laneTop[l.key]
            const mid = top + l.h / 2
            const [name, unit] = LANE_NAME[l.key]
            return (
              <g key={l.key} data-testid={`strip-${l.key}`}>
                <line x1={L} x2={Wn - R} y1={top} y2={top} stroke="var(--border)" strokeWidth="1" />
                <Name y={mid} name={name} sub={unit} testid="lane-label" />
                <InfoDot k={l.key} y={mid} />
                <g clipPath={`url(#${clipId})`}>
                  {l.key === 'move' && (
                    <>
                      {bands.filter((b) => inView(b.s, b.e)).map((b) => (
                        <rect key={b.s} x={clipX(b.s)} y={top + 2} width={Math.max(2, clipX(b.e) - clipX(b.s))} height={l.h - 4} rx="3" fill="var(--amber)" opacity="0.16" data-testid="restless-band" />
                      ))}
                      {(restless?.series || []).map((v, i) => {
                        const t = restless.start + i * MIN
                        if (v <= 0 || t < from - MIN || t > to) return null
                        const h = Math.max(1.5, Math.min(1, v) * (l.h - 8))
                        const w = Math.max(1, x(t + MIN) - x(t) - (to - from < 3 * 3600000 ? 1 : 0))
                        return <rect key={i} x={x(t)} y={top + l.h - 3 - h} width={w} height={h} rx={Math.min(1.5, w / 2)} fill="var(--text-2)" opacity="0.8" data-testid="move-bar" />
                      })}
                      {!restless?.series?.length && noRecording && <text x={L + 6} y={mid + 4} fontSize={FS - 0.5} fontWeight="600" fill="var(--text-3)" data-testid="strip-no-move">Not recorded</text>}
                      {!restless?.series?.length && moveWaiting && <text x={L + 6} y={mid + 4} fontSize={FS - 0.5} fontWeight="600" fill="var(--text-3)" data-testid="strip-move-waiting">Waiting for your Watch</text>}
                    </>
                  )}
                  {l.key === 'sound' && (
                    lane === 'heard' ? [
                      ...(soundSessions || []).flatMap((s) => s.gaps || []).filter((g) => inView(g.s, g.e)).map((g, i) => (
                        <rect key={`g${i}`} x={clipX(g.s)} y={top + 4} width={Math.max(1.5, clipX(g.e) - clipX(g.s))} height={l.h - 8} rx="2" fill="var(--text-3)" opacity="0.2" data-testid="strip-gap"><title>No audio captured</title></rect>
                      )),
                      ...(soundSessions || []).flatMap((s) => s.events).filter((e) => inView(e.s, e.e)).map((e, i) => (
                        e.label === 'snoring'
                          ? <rect key={i} x={clipX(e.s)} y={mid - 7} width={Math.max(2, clipX(e.e) - clipX(e.s))} height={14} rx="3" fill="var(--text-2)" data-testid="strip-snore" />
                          : <circle key={i} cx={x(e.s)} cy={mid} r="3" fill="none" stroke="var(--text-2)" strokeWidth="1.4"><title>{e.label === 'cough' ? 'Cough' : 'Talking'}</title></circle>
                      )),
                    ] : <text x={L + 6} y={mid + 4} fontSize={FS - 0.5} fontWeight="600" fill="var(--text-3)" data-testid={`sound-${lane}`}>{SOUND_LANE_WORDS[lane]}</text>
                  )}
                  {l.key === 'hr' && low && (() => {
                    const vals = overnight.hr.map((p) => p[1])
                    const lo = Math.min(...vals) - 2
                    const hi = Math.max(...vals) + 2
                    const yOf = (b) => top + l.h - 6 - ((b - lo) / (hi - lo || 1)) * (l.h - 12)
                    const pts = overnight.hr.map(([mm, b]) => [x(night.start + mm * MIN), yOf(b)])
                    const lx = x(low.t)
                    const showLow = low.t >= from && low.t <= to
                    return (
                      <>
                        <path d={smoothPath(pts)} fill="none" stroke="var(--text-2)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" data-testid="hr-line" />
                        {showLow && (
                          <g data-testid="hr-low">
                            <circle cx={lx} cy={yOf(low.bpm)} r="3.5" fill="var(--text)" />
                            <text x={lx + (lx > Wn - R - 30 ? -7 : 7)} y={yOf(low.bpm) + 1} fontSize={FS - 1} fontWeight="700" textAnchor={lx > Wn - R - 30 ? 'end' : 'start'} fill="var(--text)" stroke="var(--bg)" strokeWidth="3" paintOrder="stroke" className="tabular-nums">{low.bpm}</text>
                          </g>
                        )}
                      </>
                    )
                  })()}
                  {l.key === 'spo2' && overnight.spo2.map(([mm, p], i) => {
                    const t = night.start + mm * MIN
                    if (t < from || t > to) return null
                    return <circle key={i} cx={x(t)} cy={mid} r="3" fill={p < NIGHT.spo2Low ? 'var(--warn)' : 'var(--text-3)'} data-testid="spo2-dot" data-low={p < NIGHT.spo2Low ? 'true' : 'false'}><title>{`${p}%`}</title></circle>
                  })}
                </g>
              </g>
            )
          })}

          {nightTicks({ from, to }, (t) => tz.hourOf(t) * 60, Wn - L - R).map((tk) => {
            const p = tickPlace(x(tk.t), TICK_W, L, Wn - R)
            return <text key={tk.t} x={p.x} y={H - 5} fontSize={FS} fontWeight="600" textAnchor={p.anchor} fill="var(--text-3)" className="tabular-nums" data-testid="night-tick">{tk.label}</text>
          })}
          {cursor != null && (
            <g pointerEvents="none">
              <line x1={x(cursor)} x2={x(cursor)} y1={2} y2={H - 20} stroke="var(--text)" strokeWidth="1.2" opacity="0.85" data-testid="night-crosshair" />
              {m?.stage && <circle cx={x(cursor)} cy={rowMid(rows.includes(m.stage) ? m.stage : (rows.includes('core') ? 'core' : rows[0]))} r="5" fill={STAGE_COLOR[m.stage]} stroke="var(--bg)" strokeWidth="2" />}
            </g>
          )}
        </svg>
      </div>

      {zoomed && (() => {
        const ow = Wn - L - R
        const b = overviewBox({ from, to }, night, ow)
        const ox = (t) => L + ((t - night.start) / (night.end - night.start || 1)) * ow
        return (
          <svg ref={ovRef} viewBox={`0 0 ${Wn} 26`} className="mt-1 w-full select-none" style={{ touchAction: 'none' }} data-testid="night-overview"
            data-x={Math.round(b.x)} data-w={Math.round(b.w)} onPointerDown={onOvDown} onPointerMove={onOvMove} onPointerUp={onOvUp} onPointerCancel={onOvUp}
            role="slider" aria-label="Where the zoomed window sits in the night" aria-valuetext={`${clock(from)} to ${clock(to)}`}>
            {steps.map((s) => <rect key={s.start} x={ox(s.start)} y={7 + rows.indexOf(s.row) * (12 / Math.max(1, rows.length))} width={Math.max(0.5, ox(s.end) - ox(s.start))} height={12 / Math.max(1, rows.length)} fill={STAGE_COLOR[s.row]} />)}
            <rect x={L + b.x} y="1" width={b.w} height="24" rx="6" fill="var(--text)" fillOpacity="0.1" stroke="var(--text-2)" strokeWidth="1.4" data-testid="night-overview-window" />
            <text x={L - 8} y="17" fontSize="11.5" fontWeight="600" textAnchor="end" fill="var(--text-3)" className="tabular-nums" data-testid="night-window">{clock(from)} to {clock(to)}</text>
          </svg>
        )
      })()}

      <ChartLegend items={nightLegend({ restless: bands.length > 0, snoring: lane === 'heard' && (soundSessions || []).some((s) => s.events.some((e) => e.label === 'snoring')), other: lane === 'heard' && (soundSessions || []).some((s) => s.events.some((e) => e.label !== 'snoring')), gaps: (soundSessions || []).some((s) => s.gaps?.length), spo2Low: (overnight?.spo2 || []).some(([, p]) => p < NIGHT.spo2Low) })} />
      {noRecording && !lanes.some((l) => l.key === 'move') && <p className="text-[11px] font-medium" style={muted} data-testid="strip-no-move">{NO_RECORDING_LINE}</p>}
      {list.length > 0 && (
        <div className="mt-3" data-testid="what-happened">
          <p className="text-[15px] font-semibold">What happened</p>
          <div className="mt-1 space-y-0.5">
            {list.map((h) => (
              <button key={`${h.kind}${h.t}`} type="button" onClick={() => jump(h.t)} className="block w-full rounded-[10px] px-2 py-1.5 text-left text-sm font-medium tabular-nums"
                style={cursor === h.t ? { background: 'var(--surface-sunk)', color: 'var(--text)' } : soft} data-testid="happened-row" data-kind={h.kind}>
                {h.text}
              </button>
            ))}
          </div>
        </div>
      )}
      <Modal open={!!info} onClose={() => setInfo(null)} title={INFO_TITLE[info] || ''}>
        <p className="text-sm font-medium" style={soft} data-testid="lane-info">{info ? LANE_INFO[info] : ''}</p>
      </Modal>
    </div>
  )

  if (full) return card
  return (
    <>
      {card}
      {isFull && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[70] flex flex-col p-4" style={{ background: 'var(--bg)', paddingTop: 'max(16px, env(safe-area-inset-top))', paddingBottom: 'max(16px, env(safe-area-inset-bottom))', paddingLeft: 'max(16px, env(safe-area-inset-left))', paddingRight: 'max(16px, env(safe-area-inset-right))' }}
          role="dialog" aria-modal="true" aria-label="The night, full screen" data-testid="night-fullscreen">
          <NightCard night={night} overnight={overnight} restless={restless} soundSessions={soundSessions} soundsOn={soundsOn} events={events} moveLane={moveLane} tz={tz} full onClose={() => setFull(false)} />
        </div>,
        document.body,
      )}
    </>
  )
}
