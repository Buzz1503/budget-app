import { useId, useMemo, useRef, useState } from 'react'
import { Maximize2, X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import { haptic } from '../../lib/feedback'
import { hypnogramRows, durationWords } from '../../health/engine/sleepView'
import { hhmm } from '../../health/engine/planner'
import {
  momentAt, restlessBands, hrRange, soundLane, SOUND_LANE_WORDS, whatHappened, nightSummary, zoomNight, NIGHT, STAGE_WORD,
} from '../../sleep/nightView'
import { W, STAGE_OPACITY, STAGE_LABEL } from './SleepCharts'
import { NO_RECORDING_LINE } from '../../sleep/prompts'

const MIN = 60000
const L = 50
const R = 8
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

/** Hour ticks for a window: every hour, or every two over 6 hours. */
function ticks(from, to, tz) {
  const out = []
  const first = from + (60 - ((tz.hourOf(from) * 60) % 60)) * MIN
  const step = to - from > 6 * 3600000 ? 2 : 1
  for (let t = first; t <= to; t += 3600000) {
    const h = Math.round(tz.hourOf(t))
    if (h % step === 0 || to - from <= 3 * 3600000) out.push({ t, label: hhmm(h * 60) })
  }
  return out
}

/**
 * The night in one card: stages, then Move, Sound, heart rate and blood oxygen
 * on the same time axis. Press and drag anywhere for one line through every
 * lane and a panel with what each said at that minute (a light tap of haptics
 * on each change of stage). Tap for full screen, where pinching zooms to as
 * little as 30 minutes and dragging with two fingers pans. Under the chart, one
 * summary line and the night's notable moments; tapping one moves the line there.
 */
export default function NightCard({ night, overnight, restless, soundSessions, soundsOn, events = [], noRecording = false, tz, full = false, onClose = null }) {
  const [win, setWin] = useState(null)
  const [cursor, setCursor] = useState(null)
  const [picked, setPicked] = useState(null)
  const [isFull, setFull] = useState(false)
  const [info, setInfo] = useState(null)
  const haptics = useStore((s) => s.settings?.haptics)
  const svgRef = useRef(null)
  const drag = useRef(null)
  const touches = useRef(new Map())
  const pinch = useRef(null)
  const lastStage = useRef(null)
  const clipId = `night-plot-${useId().replace(/:/g, '')}`

  const clock = (ms) => hhmm(tz.hourOf(ms) * 60)
  const data = useMemo(() => ({ night, overnight, restless, sounds: soundSessions || [], events }), [night, overnight, restless, soundSessions, events])
  const { rows, steps } = useMemo(() => hypnogramRows(night), [night])
  const bands = useMemo(() => restlessBands(restless), [restless])
  const range = hrRange(overnight?.hr)
  const lane = soundLane(soundSessions)
  const list = useMemo(() => whatHappened(data, clock), [data]) // eslint-disable-line react-hooks/exhaustive-deps
  const summary = nightSummary(data)

  const from = win?.from ?? night.start
  const to = win?.to ?? night.end
  const x = (t) => L + ((t - from) / (to - from || 1)) * (W - L - R)
  const tAt = (px) => from + ((px - L) / (W - L - R)) * (to - from)

  // the layout: stage rows, then each lane that has something to say
  const rowH = full ? 26 : 20
  const lanes = []
  if (restless?.series?.length || noRecording) lanes.push({ key: 'move', label: 'Move', h: 26 })
  if (soundsOn || soundSessions?.length) lanes.push({ key: 'sound', label: 'Sound', h: 22 })
  if (overnight?.hr?.length > 2) lanes.push({ key: 'hr', label: 'HR', h: 30 })
  if (overnight?.spo2?.length) lanes.push({ key: 'spo2', label: 'SpO2', h: 18 })
  const stagesH = rows.length * rowH
  let y0 = 4 + stagesH + 6
  const laneTop = {}
  for (const l of lanes) { laneTop[l.key] = y0; y0 += l.h }
  const H = y0 + 16

  // ---- crosshair, pinch and pan
  const svgPx = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    return ((e.clientX - r.left) / (r.width || 1)) * W
  }
  const moveTo = (t) => {
    const c = Math.min(to, Math.max(from, t))
    const st = momentAt(data, c).stage
    if (haptics && lastStage.current && st !== lastStage.current) haptic(4)
    lastStage.current = st
    setCursor(c)
  }
  const onDown = (e) => {
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (full && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()]
      const r = svgRef.current.getBoundingClientRect()
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: (a.x + b.x) / 2, win: { from, to }, width: r.width || 1, left: r.left }
      drag.current = null
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
      const at = Math.min(1, Math.max(0, (((p.mid - p.left) / p.width) * W - L) / (W - L - R)))
      const z = zoomNight(p.win, p.dist / dist, at, night)
      const shift = -((mid - p.mid) / p.width) * (z.to - z.from)
      const span = z.to - z.from
      const f = Math.min(night.end - span, Math.max(night.start, z.from + shift))
      setWin({ from: f, to: f + span })
      return
    }
    const d = drag.current
    if (!d) return
    if (!d.on && Math.abs(e.clientX - d.x) > 4) {
      d.on = true
      try { svgRef.current.setPointerCapture(d.id) } catch { /* not capturable */ }
      setPicked(null)
    }
    if (d.on) moveTo(tAt(svgPx(e)))
  }
  const onUp = (e) => {
    touches.current.delete(e?.pointerId)
    if (touches.current.size < 2) pinch.current = null
    const d = drag.current
    drag.current = null
    if (d && !d.on) {
      // a tap: full screen from the card; inside full screen, the line goes where you tapped
      if (!full) setFull(true)
      else moveTo(tAt(svgPx(e)))
    }
  }
  const zoomBy = (factor) => setWin(zoomNight({ from, to }, factor, cursor != null ? (cursor - from) / (to - from || 1) : 0.5, night))
  const panBy = (sign) => {
    const span = to - from
    const f = Math.min(night.end - span, Math.max(night.start, from + sign * span / 3))
    setWin({ from: f, to: f + span })
  }
  const jump = (t) => {
    if (t < from || t > to) {
      const span = to - from
      const f = Math.min(night.end - span, Math.max(night.start, t - span / 2))
      setWin({ from: f, to: f + span })
    }
    setPicked(null)
    setCursor(t)
  }

  const m = cursor != null ? momentAt(data, cursor) : null
  const sel = picked != null ? steps[picked] : null
  const stageY = (row) => 4 + rows.indexOf(row) * rowH + rowH / 2
  let path = ''
  steps.forEach((s, i) => { path += `${i ? 'L' : 'M'}${x(s.start).toFixed(1)},${stageY(s.row).toFixed(1)} H${x(s.end).toFixed(1)} ` })
  const inView = (s, e) => e > from && s < to
  const clipX = (t) => x(Math.min(to, Math.max(from, t)))

  const InfoDot = ({ k, y }) => (
    <g onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => { e.stopPropagation(); setInfo(k) }} style={{ cursor: 'pointer' }} data-testid={`lane-info-${k}`} role="button" aria-label={`About ${k}`}>
      <circle cx={7} cy={y} r="5.5" fill="var(--surface-sunk)" stroke="var(--border)" />
      <text x={7} y={y + 3} fontSize="7.5" fontWeight="800" textAnchor="middle" fill="var(--text-2)">i</text>
    </g>
  )

  const card = (
    <div className={full ? 'flex min-h-0 flex-1 flex-col overflow-y-auto' : ''} data-testid={full ? 'night-full' : 'night-card'}>
      <div className="flex items-start gap-2">
        <div className="min-h-[34px] min-w-0 flex-1 text-xs font-medium tabular-nums" style={soft} data-testid="night-panel">
          {sel ? (
            <p data-testid="hypno-detail">{STAGE_LABEL[sel.row]} · {clock(sel.start)} to {clock(sel.end)} · {durationWords((sel.end - sel.start) / MIN)}</p>
          ) : m ? (
            <>
              <p className="font-black" style={{ color: 'var(--text)' }} data-testid="cross-time">{clock(m.t)} · {m.stage ? STAGE_WORD[m.stage] : 'Not asleep'}</p>
              <p data-testid="cross-lanes">
                {[m.movement && `Movement ${m.movement.toLowerCase()}`, m.hr != null && `Heart rate ${Math.round(m.hr)}`, m.spo2 != null && `SpO2 ${m.spo2}%`, m.sound, m.event].filter(Boolean).join(' · ') || 'Nothing else recorded here'}
              </p>
            </>
          ) : (
            <p data-testid="hypno-detail">{full ? 'Tap or drag for any minute. Pinch to zoom.' : 'Press and drag to read every lane at one moment. Tap to open.'}</p>
          )}
        </div>
        {full ? (
          <button onClick={onClose} className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--surface-sunk)' }} data-testid="night-full-close"><X size={14} /> Close</button>
        ) : (
          <button onClick={() => setFull(true)} aria-label="Open the night full screen" className="shrink-0 rounded-full p-1.5" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="night-expand"><Maximize2 size={13} /></button>
        )}
      </div>
      {full && (
        <div className="mt-2 flex items-center gap-1.5" data-testid="night-zoom">
          <button onClick={() => zoomBy(0.5)} aria-label="Zoom in" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }} data-testid="night-zoom-in"><ZoomIn size={15} /></button>
          <button onClick={() => zoomBy(2)} aria-label="Zoom out" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }} data-testid="night-zoom-out"><ZoomOut size={15} /></button>
          <button onClick={() => panBy(-1)} aria-label="Earlier" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}><ChevronLeft size={15} /></button>
          <button onClick={() => panBy(1)} aria-label="Later" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}><ChevronRight size={15} /></button>
          <span className="ml-1 text-[11px] font-medium tabular-nums" style={muted} data-testid="night-window">{clock(from)} to {clock(to)}</span>
        </div>
      )}
      {!steps.length && <p className="text-xs font-medium" style={muted} data-testid="hypnogram-empty">Stage detail arrives with the next sync.</p>}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full select-none" role="img" aria-label="The night: stages, movement, sounds, heart rate and blood oxygen on one time axis"
        style={{ touchAction: full ? 'none' : 'pan-y' }} data-testid="hypnogram"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <defs><clipPath id={clipId}><rect x={L} y="0" width={W - L - R} height={H} /></clipPath></defs>
        {/* stages */}
        {rows.map((r) => (
          <g key={r}>
            <line x1={L} x2={W - R} y1={stageY(r)} y2={stageY(r)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 6} y={stageY(r) + 3} fontSize="9" fontWeight="700" textAnchor="end" fill="var(--text-3)">{STAGE_LABEL[r]}</text>
          </g>
        ))}
        {rows.length > 0 && <InfoDot k="stages" y={stageY(rows[0])} />}
        <g clipPath={`url(#${clipId})`}>
          {steps.map((s, i) => inView(s.start, s.end) && (
            <rect key={s.start} x={x(s.start)} y={stageY(s.row) - rowH / 2 + 3} width={Math.max(1, x(s.end) - x(s.start))} height={rowH - 6} rx="3"
              fill={SLEEP} opacity={picked === i ? Math.min(1, STAGE_OPACITY[s.row] + 0.25) : STAGE_OPACITY[s.row]}
              onPointerUp={(e) => { if (drag.current?.on) return; e.stopPropagation(); drag.current = null; touches.current.delete(e.pointerId); setCursor(null); setPicked(picked === i ? null : i) }}
              style={{ cursor: 'pointer' }} data-testid={`hypno-seg-${s.row}`} />
          ))}
          <path d={path} fill="none" stroke="var(--text-2)" strokeWidth="1.2" strokeLinejoin="round" pointerEvents="none" />
        </g>

        {/* lanes */}
        {lanes.map((l) => {
          const top = laneTop[l.key]
          const mid = top + l.h / 2
          return (
            <g key={l.key} data-testid={`strip-${l.key}`}>
              <line x1={L} x2={W - R} y1={top + l.h - 1} y2={top + l.h - 1} stroke="var(--border)" strokeWidth="1" />
              <text x={L - 6} y={mid + 3} fontSize="9" fontWeight="700" textAnchor="end" fill="var(--text-3)">{l.label}</text>
              <InfoDot k={l.key} y={mid} />
              <g clipPath={`url(#${clipId})`}>
                {l.key === 'move' && (
                  <>
                    {bands.filter((b) => inView(b.s, b.e)).map((b) => (
                      <g key={b.s} data-testid="restless-band">
                        <rect x={clipX(b.s)} y={top + 1} width={Math.max(2, clipX(b.e) - clipX(b.s))} height={l.h - 3} fill="var(--amber)" opacity="0.14" />
                        {clipX(b.e) - clipX(b.s) > 70 && <text x={clipX(b.s) + 3} y={top + 9} fontSize="7.5" fontWeight="700" fill="var(--text-2)">Restless {clock(b.s)} to {clock(b.e)}</text>}
                      </g>
                    ))}
                    {(restless?.series || []).map((v, i) => {
                      const t = restless.start + i * MIN
                      if (v <= 0 || t < from || t > to) return null
                      const h = Math.max(1, Math.min(1, v) * (l.h - 6))
                      return <rect key={i} x={x(t)} y={top + l.h - 3 - h} width={Math.max(1, x(t + MIN) - x(t))} height={h} fill={SLEEP} opacity="0.85" data-testid="move-bar" />
                    })}
                    {!restless?.series?.length && noRecording && <text x={L + 4} y={mid + 3} fontSize="8" fontWeight="600" fill="var(--text-3)" data-testid="strip-no-move">Not recorded</text>}
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
                  ] : <text x={L + 4} y={mid + 3} fontSize="8" fontWeight="600" fill="var(--text-3)" data-testid={`sound-${lane}`}>{SOUND_LANE_WORDS[lane]}</text>
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
              {l.key === 'hr' && range && <text x={W - R} y={top + 8} fontSize="7.5" fontWeight="700" textAnchor="end" fill="var(--text-3)" className="tabular-nums" data-testid="hr-range">low {range.low}, high {range.high}</text>}
            </g>
          )
        })}

        {ticks(from, to, tz).map((tk) => (
          <text key={tk.t} x={x(tk.t)} y={H - 4} fontSize="9" fontWeight="600" textAnchor="middle" fill="var(--text-3)" className="tabular-nums">{tk.label}</text>
        ))}
        {cursor != null && (
          <line x1={x(cursor)} x2={x(cursor)} y1={2} y2={H - 14} stroke="var(--text)" strokeWidth="1" opacity="0.8" pointerEvents="none" data-testid="night-crosshair" />
        )}
      </svg>
      {summary && <p className="mt-1 text-xs font-bold tabular-nums" style={soft} data-testid="night-summary">{summary}</p>}
      {noRecording && !lanes.some((l) => l.key === 'move') && <p className="text-[11px] font-medium" style={muted} data-testid="strip-no-move">{NO_RECORDING_LINE}</p>}
      {list.length > 0 && (
        <div className="mt-3" data-testid="what-happened">
          <p className="t-caption" style={muted}>What happened</p>
          <div className="mt-1 space-y-0.5">
            {list.map((h) => (
              <button key={`${h.kind}${h.t}`} type="button" onClick={() => jump(h.t)} className="block w-full rounded-[10px] px-2 py-1.5 text-left text-xs font-medium tabular-nums"
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
      {isFull && (
        <div className="fixed inset-0 z-[70] flex flex-col p-4" style={{ background: 'var(--bg)', paddingTop: 'max(16px, env(safe-area-inset-top))', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
          role="dialog" aria-modal="true" aria-label="The night, full screen" data-testid="night-fullscreen">
          <NightCard night={night} overnight={overnight} restless={restless} soundSessions={soundSessions} soundsOn={soundsOn} events={events} noRecording={noRecording} tz={tz} full onClose={() => setFull(false)} />
        </div>
      )}
    </>
  )
}
