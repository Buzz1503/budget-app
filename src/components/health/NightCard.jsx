import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import { haptic } from '../../lib/feedback'
import { hypnogramRows } from '../../health/engine/sleepView'
import { hhmm } from '../../health/engine/planner'
import {
  momentAt, restlessBands, hrRange, soundLane, SOUND_LANE_WORDS, whatHappened, nightSummary, NIGHT, STAGE_WORD,
} from '../../sleep/nightView'
import { NightGesture, GESTURE, isZoomed, overviewBox, overviewDrag, nightTicks, tickPlace } from '../../sleep/nightGestures'
import { W, STAGE_OPACITY, STAGE_LABEL } from './SleepCharts'
import { NO_RECORDING_LINE } from '../../sleep/prompts'
import { ChartLegend } from '../charts/TrendChart'
import { nightLegend, NIGHT_LAYOUT } from '../../sleep/nightView'

const MIN = 60000
const L = 82 // room for the lane names with their units ("HR bpm", "SpO2 %") and the (i)
const R = 8
const FS = 12.5
const SLEEP = 'var(--series-sleep)'
const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }

const LANE_INFO = {
  stages: 'Sleep stages, estimated by your Apple Watch from movement and heart rate. Awake at the top, deep sleep at the bottom.',
  move: 'Movement from your Apple Watch: each bar is how much of that minute you moved. Shaded stretches are restless periods, 5 minutes with 30 seconds or more of movement.',
  sound: 'Snoring, coughs and talking heard by Sleep sounds on your iPhone. Only the time and kind of sound are kept, never audio.',
  hr: 'Heart rate from your Apple Watch while you slept, with the lowest and highest of the night at the edge.',
  spo2: 'Blood oxygen readings from your Apple Watch. A reading under 90% is shown in colour.',
}

const TIP = 'night-gestures'
const TICK_W = 36 // a "05:00" label at 12.5 pt

/**
 * The night in one card: stages, then Move, Sound, heart rate and blood oxygen
 * on the same time axis. Touch follows `NightGesture`: a vertical swipe scrolls
 * the page, a sideways drag shows the crosshair (when zoomed it pans, and a
 * press and hold first gives the crosshair), two fingers pinch the time axis
 * from 30 minutes to the whole night, a double tap resets. Full screen opens
 * only from the expand icon and is the same component, larger. Under the
 * chart, an overview strip while zoomed, one summary line and the night's
 * notable moments; tapping one moves the line there.
 */
export default function NightCard({ night, overnight, restless, soundSessions, soundsOn, events = [], noRecording = false, tz, full = false, onClose = null }) {
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
  const bands = useMemo(() => restlessBands(restless), [restless])
  const range = hrRange(overnight?.hr)
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
  const laneDef = (key, label) => ({ key, label, h: full ? NIGHT_LAYOUT.fullLaneH : NIGHT_LAYOUT.cardLaneH[key] })
  if (restless?.series?.length || noRecording) lanes.push(laneDef('move', 'Move'))
  if (soundsOn || soundSessions?.length) lanes.push(laneDef('sound', 'Sound'))
  if (overnight?.hr?.length > 2) lanes.push(laneDef('hr', 'HR bpm'))
  if (overnight?.spo2?.length) lanes.push(laneDef('spo2', 'SpO2 %'))
  const lanesH = lanes.reduce((a, l) => a + l.h, 0)
  const stagesH = full
    ? Math.max(NIGHT_LAYOUT.fullStagesMin, (box?.h || 0) - lanesH - 34)
    : rows.length * NIGHT_LAYOUT.cardRowH
  const rowH = rows.length ? stagesH / rows.length : NIGHT_LAYOUT.cardRowH
  let y0 = 4 + stagesH + 6
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
      if (fx.kind === 'cross' || fx.kind === 'win') { if (!tipSeen) markCoachSeen(TIP) }
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
    setCursor(t)
  }

  // the overview strip: drag the highlighted window
  const ovRef = useRef(null)
  const ovDrag = useRef(null)
  const zoomed = isZoomed(win, night)
  const onOvDown = (e) => {
    const r = ovRef.current.getBoundingClientRect()
    ovDrag.current = { x: e.clientX, win: { from, to }, width: r.width }
    try { ovRef.current.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
  }
  const onOvMove = (e) => {
    const d = ovDrag.current
    if (d) setWin(overviewDrag(d.win, e.clientX - d.x, d.width, night))
  }
  const onOvUp = () => { ovDrag.current = null }

  const m = cursor != null ? momentAt(data, cursor) : null
  const stageY = (row) => 4 + rows.indexOf(row) * rowH + rowH / 2
  let path = ''
  steps.forEach((s, i) => { path += `${i ? 'L' : 'M'}${x(s.start).toFixed(1)},${stageY(s.row).toFixed(1)} H${x(s.end).toFixed(1)} ` })
  const inView = (s, e) => e > from && s < to
  const clipX = (t) => x(Math.min(to, Math.max(from, t)))

  const InfoDot = ({ k, y }) => (
    <g onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => { e.stopPropagation(); setInfo(k) }} style={{ cursor: 'pointer' }} data-testid={`lane-info-${k}`} role="button" aria-label={`About ${k}`}>
      <circle cx={8} cy={y} r="7" fill="var(--surface-sunk)" stroke="var(--border)" />
      <text x={8} y={y + 3.5} fontSize="10" fontWeight="800" textAnchor="middle" fill="var(--text-2)">i</text>
    </g>
  )

  const card = (
    <div className={full ? 'flex min-h-0 flex-1 flex-col overflow-y-auto' : ''} data-testid={full ? 'night-full' : 'night-card'}>
      <p className="text-[17px] font-semibold" data-testid="night-question">What happened through the night?</p>
      {summary && <p className="mb-2 text-[15px] font-semibold tabular-nums" data-testid="night-summary">{summary}</p>}
      <div className="flex items-start gap-2">
        <div className="min-h-[40px] min-w-0 flex-1 text-sm font-medium tabular-nums" style={soft} data-testid="night-panel">
          {m ? (
            <>
              <p className="font-black" style={{ color: 'var(--text)' }} data-testid="cross-time">{clock(m.t)} · {m.stage ? STAGE_WORD[m.stage] : 'Not asleep'}</p>
              <p data-testid="cross-lanes">
                {[m.movement && `Movement ${m.movement.toLowerCase()}`, m.hr != null && `Heart rate ${Math.round(m.hr)}`, m.spo2 != null && `SpO2 ${m.spo2}%`, m.sound, m.event].filter(Boolean).join(' · ') || 'Nothing else recorded here'}
              </p>
            </>
          ) : (
            !tipSeen && <p data-testid="night-tip">Pinch to zoom. Drag sideways for any minute.</p>
          )}
        </div>
        {full ? (
          <button onClick={onClose} className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--surface-sunk)' }} data-testid="night-full-close"><X size={14} /> Close</button>
        ) : (
          <button onClick={() => setFull(true)} aria-label="Open the night full screen" className="shrink-0 rounded-full p-1.5" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="night-expand"><Maximize2 size={13} /></button>
        )}
      </div>
      {!steps.length && <p className="text-xs font-medium" style={muted} data-testid="hypnogram-empty">Stage detail arrives with the next sync.</p>}
      <div ref={full ? boxRef : undefined} className={full ? 'mt-1 shrink-0' : ''} style={full ? { height: 'max(420px, calc(100dvh - 230px))' } : undefined} data-testid="night-plot">
      <svg ref={svgRef} viewBox={`0 0 ${Wn} ${H}`} className="mt-1 w-full select-none" role="img" aria-label="The night: stages, movement, sounds, heart rate and blood oxygen on one time axis"
        style={{ touchAction: 'pan-y' }} data-testid="hypnogram" data-stages-h={Math.round(stagesH)} data-lane-h={lanes.map((l) => l.h).join(',')}
        data-from={Math.round(from)} data-to={Math.round(to)}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
        <defs><clipPath id={clipId}><rect x={L} y="0" width={Wn - L - R} height={H} /></clipPath></defs>
        {/* stages */}
        {rows.map((r) => (
          <g key={r}>
            <line x1={L} x2={Wn - R} y1={stageY(r)} y2={stageY(r)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 6} y={stageY(r) + 4} fontSize={FS} fontWeight="700" textAnchor="end" fill="var(--text-3)">{STAGE_LABEL[r]}</text>
          </g>
        ))}
        {rows.length > 0 && <InfoDot k="stages" y={stageY(rows[0])} />}
        <g clipPath={`url(#${clipId})`}>
          {steps.map((s) => inView(s.start, s.end) && (
            <rect key={s.start} x={x(s.start)} y={stageY(s.row) - rowH / 2 + 3} width={Math.max(1, x(s.end) - x(s.start))} height={rowH - 6} rx="3"
              fill={SLEEP} opacity={STAGE_OPACITY[s.row]} data-testid={`hypno-seg-${s.row}`} />
          ))}
          <path d={path} fill="none" stroke="var(--text-2)" strokeWidth="1.2" strokeLinejoin="round" pointerEvents="none" />
        </g>

        {/* lanes */}
        {lanes.map((l) => {
          const top = laneTop[l.key]
          const mid = top + l.h / 2
          return (
            <g key={l.key} data-testid={`strip-${l.key}`}>
              <line x1={L} x2={Wn - R} y1={top + l.h - 1} y2={top + l.h - 1} stroke="var(--border)" strokeWidth="1" />
              <text x={L - 6} y={mid + 4} fontSize={FS} fontWeight="700" textAnchor="end" fill="var(--text-3)" data-testid="lane-label">{l.label}</text>
              <InfoDot k={l.key} y={mid} />
              <g clipPath={`url(#${clipId})`}>
                {l.key === 'move' && (
                  <>
                    {bands.filter((b) => inView(b.s, b.e)).map((b) => (
                      <g key={b.s} data-testid="restless-band">
                        <rect x={clipX(b.s)} y={top + 1} width={Math.max(2, clipX(b.e) - clipX(b.s))} height={l.h - 3} fill="var(--amber)" opacity="0.14" />
                        {clipX(b.e) - clipX(b.s) > 150 && <text x={clipX(b.s) + 3} y={top + 13} fontSize={FS - 1.5} fontWeight="700" fill="var(--text-2)">Restless {clock(b.s)} to {clock(b.e)}</text>}
                      </g>
                    ))}
                    {(restless?.series || []).map((v, i) => {
                      const t = restless.start + i * MIN
                      if (v <= 0 || t < from || t > to) return null
                      const h = Math.max(1, Math.min(1, v) * (l.h - 6))
                      return <rect key={i} x={x(t)} y={top + l.h - 3 - h} width={Math.max(1, x(t + MIN) - x(t))} height={h} fill={SLEEP} opacity="0.85" data-testid="move-bar" />
                    })}
                    {!restless?.series?.length && noRecording && <text x={L + 4} y={mid + 3} fontSize={FS - 1} fontWeight="600" fill="var(--text-3)" data-testid="strip-no-move">Not recorded</text>}
                  </>
                )}
                {l.key === 'sound' && (
                  lane === 'heard' ? [
                    ...(soundSessions || []).flatMap((s) => s.gaps || []).filter((g) => inView(g.s, g.e)).map((g, i) => (
                      <rect key={`g${i}`} x={clipX(g.s)} y={top + 3} width={Math.max(1.5, clipX(g.e) - clipX(g.s))} height={l.h - 7} fill="var(--text-3)" opacity="0.25" data-testid="strip-gap"><title>No audio captured</title></rect>
                    )),
                    ...(soundSessions || []).flatMap((s) => s.events).filter((e) => inView(e.s, e.e)).map((e, i) => (
                      e.label === 'snoring'
                        ? <rect key={i} x={clipX(e.s)} y={top + 6} width={Math.max(1.5, clipX(e.e) - clipX(e.s))} height={l.h - 12} rx="1.5" fill="var(--text-2)" data-testid="strip-snore" />
                        : <circle key={i} cx={x(e.s)} cy={mid} r="2.5" fill="none" stroke="var(--text-2)" strokeWidth="1.2"><title>{e.label === 'cough' ? 'Cough' : 'Talking'}</title></circle>
                    )),
                  ] : <text x={L + 4} y={mid + 4} fontSize={FS - 1} fontWeight="600" fill="var(--text-3)" data-testid={`sound-${lane}`}>{SOUND_LANE_WORDS[lane]}</text>
                )}
                {l.key === 'hr' && range && (() => {
                  const lo = range.low - 2
                  const hi = range.high + 2
                  const pts = overnight.hr.map(([mm, b]) => `${x(night.start + mm * MIN).toFixed(1)},${(top + l.h - 4 - ((b - lo) / (hi - lo || 1)) * (l.h - 8)).toFixed(1)}`).join(' ')
                  return <polyline points={pts} fill="none" stroke="var(--text-2)" strokeWidth="1.2" strokeLinejoin="round" />
                })()}
                {l.key === 'spo2' && overnight.spo2.map(([mm, p], i) => {
                  const t = night.start + mm * MIN
                  if (t < from || t > to) return null
                  return <circle key={i} cx={x(t)} cy={mid} r="2.5" fill={p < NIGHT.spo2Low ? 'var(--warn)' : 'var(--text-3)'} data-testid="spo2-dot" data-low={p < NIGHT.spo2Low ? 'true' : 'false'}><title>{`${p}%`}</title></circle>
                })}
              </g>
            </g>
          )
        })}

        {nightTicks({ from, to }, (t) => tz.hourOf(t) * 60).map((tk) => {
          const p = tickPlace(x(tk.t), TICK_W, L, Wn - R)
          return <text key={tk.t} x={p.x} y={H - 5} fontSize={FS} fontWeight="600" textAnchor={p.anchor} fill="var(--text-3)" className="tabular-nums" data-testid="night-tick">{tk.label}</text>
        })}
        {cursor != null && (
          <line x1={x(cursor)} x2={x(cursor)} y1={2} y2={H - 18} stroke="var(--text)" strokeWidth="1" opacity="0.8" pointerEvents="none" data-testid="night-crosshair" />
        )}
      </svg>
      </div>
      {zoomed && (() => {
        const ow = Wn - L - R
        const b = overviewBox({ from, to }, night, ow)
        const ox = (t) => L + ((t - night.start) / (night.end - night.start || 1)) * ow
        return (
          <svg ref={ovRef} viewBox={`0 0 ${Wn} 24`} className="mt-1 w-full select-none" style={{ touchAction: 'none' }} data-testid="night-overview"
            data-x={Math.round(b.x)} data-w={Math.round(b.w)} onPointerDown={onOvDown} onPointerMove={onOvMove} onPointerUp={onOvUp} onPointerCancel={onOvUp}
            role="slider" aria-label="Where the zoomed window sits in the night" aria-valuetext={`${clock(from)} to ${clock(to)}`}>
            {steps.map((s) => <rect key={s.start} x={ox(s.start)} y={6 + rows.indexOf(s.row) * (12 / Math.max(1, rows.length))} width={Math.max(0.5, ox(s.end) - ox(s.start))} height={12 / Math.max(1, rows.length)} fill={SLEEP} opacity={STAGE_OPACITY[s.row]} />)}
            <rect x={L + b.x} y="1" width={b.w} height="22" rx="5" fill="var(--text)" fillOpacity="0.1" stroke="var(--text-2)" strokeWidth="1.2" data-testid="night-overview-window" />
            <text x={L - 6} y="16" fontSize="11" fontWeight="600" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{clock(from)}</text>
          </svg>
        )
      })()}
      {range && (
        <p className="mt-1 text-sm font-medium tabular-nums" style={soft} data-testid="hr-range">Heart rate asleep: low {range.low}, high {range.high} bpm</p>
      )}
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
      <Modal open={!!info} onClose={() => setInfo(null)} title={info === 'stages' ? 'Stages' : info === 'hr' ? 'Heart rate' : info === 'spo2' ? 'Blood oxygen' : info === 'move' ? 'Move' : 'Sound'}>
        <p className="text-sm font-medium" style={soft} data-testid="lane-info">{info ? LANE_INFO[info] : ''}</p>
      </Modal>
    </div>
  )

  if (full) return card
  return (
    <>
      {card}
      {isFull && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[70] flex flex-col p-4" style={{ background: 'var(--bg)', paddingTop: 'max(16px, env(safe-area-inset-top))', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          role="dialog" aria-modal="true" aria-label="The night, full screen" data-testid="night-fullscreen">
          <NightCard night={night} overnight={overnight} restless={restless} soundSessions={soundSessions} soundsOn={soundsOn} events={events} noRecording={noRecording} tz={tz} full onClose={() => setFull(false)} />
        </div>,
        document.body,
      )}
    </>
  )
}
