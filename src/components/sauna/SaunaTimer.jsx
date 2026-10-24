import { useEffect, useState } from 'react'
import { Square, X } from 'lucide-react'
import { useReducedMotion, motion } from 'framer-motion'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import { Stepper } from './SaunaLogSheet'
import { usualFor, timerState, clockWords, roundMarkers, sessionFromTimer } from '../../sauna/sauna'
import { scheduleSaunaAlert, cancelSaunaAlert } from './notify'

const toLocal = (ms) => {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return { date: `${y}-${m}-${day}`, minutes: d.getHours() * 60 + d.getMinutes() }
}

/** Choose a target length and temperature, then start. */
export function StartTimerSheet({ open, onClose }) {
  const sessions = useStore((s) => s.saunaSessions)
  const settings = useStore((s) => s.saunaSettings)
  const setSaunaSettings = useStore((s) => s.setSaunaSettings)
  const startSaunaTimer = useStore((s) => s.startSaunaTimer)
  const [f, setF] = useState(null)
  useEffect(() => {
    if (open) { const u = usualFor(sessions, settings); setF({ targetMin: u.lengthMin, tempC: u.tempC, rounds: 1 }) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !f) return null
  const start = () => {
    const now = Date.now()
    startSaunaTimer({ ...f, now })
    // one alert at the target time; permission is asked only the first time
    void scheduleSaunaAlert({ at: now + f.targetMin * 60000, targetMin: f.targetMin, asked: settings.notifyAsked, markAsked: () => setSaunaSettings({ notifyAsked: true }) })
    onClose?.()
  }
  return (
    <Modal open onClose={onClose} title="Start a timer">
      <div className="space-y-4" data-testid="sauna-timer-sheet">
        <Stepper label="Target length" unit="min" value={f.targetMin} onChange={(v) => setF({ ...f, targetMin: v })} min={1} max={120} testid="timer-length" />
        <Stepper label="Temperature" unit="C" value={f.tempC} onChange={(v) => setF({ ...f, tempC: v })} min={30} max={120} testid="timer-temp" />
        <Stepper label="Rounds" value={f.rounds} onChange={(v) => setF({ ...f, rounds: v })} min={1} max={6} testid="timer-rounds" />
        <button onClick={start} className="btn-primary w-full rounded-full py-3 text-base font-black" data-testid="timer-start">Start</button>
      </div>
    </Modal>
  )
}

/**
 * The running timer: elapsed time from the stored start (right after the app
 * was closed or the phone locked), a ring to the target with round markers,
 * and Stop, which opens the log prefilled.
 */
export function RunningTimer({ onStop }) {
  const timer = useStore((s) => s.saunaTimer)
  const clearSaunaTimer = useStore((s) => s.clearSaunaTimer)
  const reduce = useReducedMotion()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!timer) return null
  const st = timerState(timer, now)
  const size = 200
  const stroke = 12
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const stop = () => {
    void cancelSaunaAlert()
    const prefill = sessionFromTimer(timer, Date.now(), toLocal)
    clearSaunaTimer()
    onStop?.(prefill)
  }
  const discard = () => { void cancelSaunaAlert(); clearSaunaTimer() }
  return (
    <section className="card p-5 text-center" data-testid="sauna-running">
      <div className="flex items-center">
        <p className="t-caption flex-1 text-left" style={{ color: 'var(--text-3)' }}>Timer · {timer.targetMin} min at {timer.tempC} C</p>
        <button onClick={discard} aria-label="Discard timer" className="p-1" style={{ color: 'var(--text-3)' }} data-testid="timer-discard"><X size={16} /></button>
      </div>
      <div className="relative mx-auto mt-3" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunk)" strokeWidth={stroke} />
          <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--series-sauna)" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} transform={`rotate(-90 ${size / 2} ${size / 2})`}
            animate={{ strokeDashoffset: c * (1 - st.fraction) }} transition={{ duration: reduce ? 0 : 0.6, ease: 'linear' }} />
          {roundMarkers(timer.rounds).map((f) => {
            const a = 2 * Math.PI * f - Math.PI / 2
            return <line key={f} x1={size / 2 + (r - 10) * Math.cos(a)} y1={size / 2 + (r - 10) * Math.sin(a)} x2={size / 2 + (r + 10) * Math.cos(a)} y2={size / 2 + (r + 10) * Math.sin(a)} stroke="var(--text)" strokeWidth="2" data-testid="round-marker" />
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-5xl font-black tabular-nums" data-testid="timer-elapsed">{clockWords(st.elapsedMs)}</p>
          <p className="mt-1 text-xs font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>{st.done ? 'Target reached' : `of ${timer.targetMin}:00`}</p>
        </div>
      </div>
      <button onClick={stop} className="btn-primary mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3 text-base font-black" data-testid="timer-stop">
        <Square size={16} /> Stop and log
      </button>
    </section>
  )
}

export { toLocal }
