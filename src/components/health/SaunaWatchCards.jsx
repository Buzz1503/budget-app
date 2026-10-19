import { useMemo, useState } from 'react'
import useStore, { todayStr } from '../../store/useStore'
import { addDays } from '../../health/tz'
import { saunaCandidates, hhmmOf } from '../../sauna/sauna'
import SaunaLogSheet from '../sauna/SaunaLogSheet'
import useHealthModel, { tz } from './useHealthModel'

const clock12 = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase()

/**
 * "Was this a sauna?" for Apple Watch workouts of type Other, or named Sauna,
 * from the last 14 days that are not linked yet. Confirm opens the log with
 * everything but the temperature filled in; Dismiss hides it. Never created
 * without a tap.
 */
export default function SaunaWatchCards() {
  const connected = useStore((s) => s.healthSettings.connected)
  const sessions = useStore((s) => s.saunaSessions)
  const dismissed = useStore((s) => s.saunaDismissed)
  const dismiss = useStore((s) => s.dismissSaunaWorkout)
  const model = useHealthModel()
  const [confirming, setConfirming] = useState(null)
  const t = todayStr()
  const list = useMemo(() => saunaCandidates(
    model.sessions.filter((w) => w.date >= addDays(t, -13)).map((w) => ({ id: w.id, type: w.type, title: w.title, start: w.start, end: w.end, date: w.date, durationMin: w.durationMin })),
    sessions, dismissed,
  ), [model, sessions, dismissed, t])
  if (!connected || !list.length) return null
  const prefill = (w) => ({ date: w.date, start: hhmmOf(tz.hourOf(w.start) * 60), lengthMin: Math.max(1, Math.round(w.durationMin)), source: 'watch', workoutId: w.id })
  return (
    <div className="space-y-2" data-testid="sauna-watch-cards">
      {list.slice(0, 1).map((w) => (
        <section key={w.id} className="card p-4" data-testid="sauna-watch-card">
          <p className="t-label">Was this a sauna?</p>
          <p className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            {w.date === t ? '' : w.date === addDays(t, -1) ? 'Yesterday, ' : `${new Date(`${w.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, `}
            {clock12(w.start)}, {Math.round(w.durationMin)} min · Apple Watch
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setConfirming(w)} className="btn-primary flex-1 rounded-full py-2.5 text-sm font-black" data-testid="sauna-watch-confirm">Confirm</button>
            <button onClick={() => dismiss(w.id)} className="flex-1 rounded-full py-2.5 text-sm font-black" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="sauna-watch-dismiss">Dismiss</button>
          </div>
          {list.length > 1 && <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-3)' }} data-testid="sauna-watch-more">{list.length - 1} more from Apple Watch after this one.</p>}
        </section>
      ))}
      <SaunaLogSheet open={!!confirming} tempOnly prefill={confirming ? prefill(confirming) : null} onClose={() => setConfirming(null)} />
    </div>
  )
}
