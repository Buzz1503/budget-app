import { useEffect, useState } from 'react'
import { HeartPulse, RefreshCw } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore from '../../store/useStore'
import { useHealth } from '../../health/state'

/** What is read, and why — said before the system sheet asks. */
const READS = [
  { what: 'Sleep, with stages', why: 'Sleep score, debt and the sleep planner' },
  { what: 'Resting heart rate, HRV, respiratory rate, wrist temperature', why: 'Readiness against your own baseline' },
  { what: 'Workouts and heart rate during them', why: 'Training load and heart rate zones' },
  { what: 'Steps, active energy, VO2 max, cardio recovery, daylight', why: 'Training and fitness trends' },
  { what: 'Weight, body fat, lean mass, blood pressure', why: 'Body composition next to your protocol' },
  { what: 'Protein, energy and water, if you log them', why: 'One line on the Training screen' },
  { what: 'Date of birth and sex', why: 'Estimated max heart rate and VO2 max age norms' },
]

export function SyncLine() {
  const syncing = useHealth((s) => s.syncing)
  const progress = useHealth((s) => s.progress)
  const lastSyncAt = useHealth((s) => s.data.meta.lastSyncAt)
  if (syncing) {
    return (
      <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="health-sync-progress">
        Reading Apple Health{progress?.total ? ` · ${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : '…'}
      </p>
    )
  }
  return (
    <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }} data-testid="health-last-sync">
      {lastSyncAt ? `Last read ${format(parseISO(lastSyncAt), 'd MMM, HH:mm')}` : 'Not read yet'}
    </p>
  )
}

/** First run: a plain explanation, then the system sheet. */
function Connect() {
  const connect = useHealth((s) => s.connect)
  const setHealthSettings = useStore((s) => s.setHealthSettings)
  const priority = useStore((s) => s.healthSettings.sleepPriority)
  const [busy, setBusy] = useState(false)

  const go = async () => {
    setBusy(true)
    setHealthSettings({ connected: true })
    await connect({ priority })
    setBusy(false)
  }

  return (
    <div className="space-y-4" data-testid="health-connect">
      <div className="card p-4">
        <p className="t-label">Pepito+ reads from Apple Health</p>
        <p className="mt-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>
          It only reads. Nothing is written to Health, and nothing leaves your phone.
        </p>
        <div className="mt-3 rows">
          {READS.map((r) => (
            <div key={r.what} className="py-2">
              <p className="text-sm font-bold leading-snug">{r.what}</p>
              <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{r.why}</p>
            </div>
          ))}
        </div>
      </div>
      <p className="px-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>
        Next, iOS asks which of these to allow. You can change it any time in Settings › Health › Data Access &amp; Devices › Pepito+.
      </p>
      <button onClick={go} disabled={busy} data-testid="health-connect-button"
        className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-50">
        {busy ? 'Connecting…' : 'Connect Apple Health'}
      </button>
    </div>
  )
}

export default function HealthSettings() {
  const available = useHealth((s) => s.available)
  const loaded = useHealth((s) => s.loaded)
  const load = useHealth((s) => s.load)
  const sync = useHealth((s) => s.sync)
  const syncing = useHealth((s) => s.syncing)
  const data = useHealth((s) => s.data)
  const connected = useStore((s) => s.healthSettings.connected)
  const priority = useStore((s) => s.healthSettings.sleepPriority)

  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  if (!available) {
    return (
      <div className="card p-4" data-testid="health-unavailable">
        <p className="text-sm font-bold">Apple Health isn’t available here</p>
        <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>Health data is read in the iPhone app only.</p>
      </div>
    )
  }

  const empty = loaded && !syncing && data.daily.length === 0 && data.nights.length === 0 && data.workouts.length === 0

  return (
    <div className="space-y-4" data-testid="health-settings">
      <h1 className="t-display flex items-center gap-2"><HeartPulse size={24} style={{ color: 'var(--text-2)' }} /> Health</h1>
      {!connected ? <Connect /> : (
        <div className="card p-4" data-testid="health-status">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="t-label">Apple Health</p>
              <SyncLine />
            </div>
            <button onClick={() => sync({ priority, full: true })} disabled={syncing} data-testid="health-resync"
              className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-black disabled:opacity-50"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
              <RefreshCw size={13} /> Re-sync last 365 days
            </button>
          </div>
          {empty && (
            <p className="mt-3 text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }} data-testid="health-empty">
              No data yet. Check Settings › Health › Data Access &amp; Devices › Pepito+.
            </p>
          )}
          {!empty && loaded && (
            <p className="mt-2 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="health-counts">
              {data.nights.length} nights · {data.workouts.length} workouts · {data.daily.length} days
            </p>
          )}
        </div>
      )}
    </div>
  )
}
