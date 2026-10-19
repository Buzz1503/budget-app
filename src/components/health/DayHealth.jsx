import useStore from '../../store/useStore'
import { daySnapshot } from '../../health/engine/snapshot'
import useHealthModel, { useCompounds } from './useHealthModel'
import { HEALTH_BANDS } from './bands'
import { minutesWords } from './atoms'
import { CheckinRows, HabitChips } from './Journal'

const signed = (v, dp = 0) => (v == null ? '' : ` (${v > 0 ? '+' : ''}${Number(v.toFixed(dp))} vs usual)`)

/** The day sheet's Health part: that day's numbers, then its check-in and habits. */
export default function DayHealth({ date }) {
  const connected = useStore((s) => s.healthSettings.connected)
  const checkinEnabled = useStore((s) => s.healthSettings.checkinEnabled)
  const checkins = useStore((s) => s.checkins)
  const habitLogs = useStore((s) => s.habitLogs)
  const habits = useStore((s) => s.habits)
  const doseLogs = useStore((s) => s.doseLogs)
  const compounds = useCompounds()
  const model = useHealthModel()
  const snap = connected && model.hasData ? daySnapshot(model, date, { checkins, habitLogs, habits, doseLogs, compounds }) : null

  return (
    <div className="space-y-3" data-testid="day-health">
      {snap?.hasHealth && (
        <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="day-health-snapshot">
          <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Health</p>
          <div className="space-y-0.5 text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            {snap.readiness.score != null && (
              <p>Readiness <b style={{ color: 'var(--text)' }}>{snap.readiness.score}</b>
                {snap.readiness.band && <span style={{ color: HEALTH_BANDS[snap.readiness.band].tone }}> · {HEALTH_BANDS[snap.readiness.band].label}</span>}</p>
            )}
            {snap.sleep && <p>Slept {minutesWords(snap.sleep.asleepMin)}{snap.sleep.score != null ? ` · score ${snap.sleep.score}` : ''}</p>}
            {snap.rhr.value != null && <p>Resting heart rate {Number(snap.rhr.value.toFixed(1))} bpm{signed(snap.rhr.delta, 1)}</p>}
            {snap.hrv.value != null && <p>HRV {Math.round(snap.hrv.value)} ms{signed(snap.hrv.delta)}</p>}
            {snap.steps != null && <p>{snap.steps.toLocaleString()} steps</p>}
            {snap.workouts.map((w) => (
              <p key={w.id} data-testid="day-workout">{w.title} · {Math.round(w.durationMin)} min{w.avgHR != null ? ` · avg ${w.avgHR} bpm` : ''} · TRIMP {w.trimp}</p>
            ))}
          </div>
        </div>
      )}
      {checkinEnabled && (
        <div className="space-y-2" data-testid="day-journal">
          <p className="t-caption" style={{ color: 'var(--text-3)' }}>Check-in (optional)</p>
          <CheckinRows date={date} />
          <HabitChips date={date} />
        </div>
      )}
    </div>
  )
}
