import SleepLabSettings from './SleepLabSettings'
import { useEffect, useState } from 'react'
import { HeartPulse, RefreshCw, ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore from '../../store/useStore'
import { useHealth } from '../../health/state'
import NumberField from '../ui/NumberField'
import PickerField from '../ui/PickerField'
import { affectsBaseline } from '../../health/engine/protocol'
import { tracksEffects } from '../../health/engine/phases'
import { validWakeTarget } from '../../health/engine/planner'
import { useCompounds } from './useHealthModel'

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
        {progress?.phase === 'history' ? 'Reading older Apple Health history' : 'Reading Apple Health'}{progress?.total ? ` · ${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : '…'}
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

const SOURCE_LABEL = { watch: 'Apple Watch', withings: 'Withings', phone: 'iPhone', other: 'Other apps' }

/** The same switch as Settings › Site map. */
export function Switch({ on, onChange, label, hint, testId }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="t-caption block" style={{ color: 'var(--text-3)' }}>{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} data-testid={testId} data-on={on ? 'true' : 'false'}
        onClick={() => onChange(!on)} className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{ background: on ? 'var(--good)' : 'var(--surface-sunk)', border: `1px solid ${on ? 'transparent' : 'var(--border)'}` }}>
        <span className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all"
          style={{ left: on ? 'calc(100% - 22px)' : '2px', background: on ? 'var(--accent-fg)' : 'var(--text-3)' }} />
      </button>
    </div>
  )
}

function SleepSource() {
  const priority = useStore((s) => s.healthSettings.sleepPriority)
  const setHealthSettings = useStore((s) => s.setHealthSettings)
  const sync = useHealth((s) => s.sync)
  const move = (i, by) => {
    const next = [...priority]
    const [x] = next.splice(i, 1)
    next.splice(i + by, 0, x)
    setHealthSettings({ sleepPriority: next })
    // nights are built when Health is read, so read again to apply the order
    void sync({ priority: next, full: true })
  }
  return (
    <div className="card p-4" data-testid="health-sleep-priority">
      <p className="t-label">Sleep source</p>
      <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>When two sources record the same night, the higher one is used. One source per night.</p>
      <div className="mt-2 rows">
        {priority.map((k, i) => (
          <div key={k} className="flex items-center gap-2 py-2" data-testid="sleep-priority-row" data-source={k}>
            <span className="w-5 text-xs font-black tabular-nums" style={{ color: 'var(--text-3)' }}>{i + 1}</span>
            <span className="min-w-0 flex-1 text-sm font-semibold">{SOURCE_LABEL[k] || k}</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${SOURCE_LABEL[k]} up`} data-testid={`sleep-up-${k}`} className="rounded-full p-1.5 disabled:opacity-30"><ChevronUp size={16} /></button>
            <button onClick={() => move(i, 1)} disabled={i === priority.length - 1} aria-label={`Move ${SOURCE_LABEL[k]} down`} className="rounded-full p-1.5 disabled:opacity-30"><ChevronDown size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Numbers() {
  const hs = useStore((s) => s.healthSettings)
  const setHealthSettings = useStore((s) => s.setHealthSettings)
  return (
    <div className="card space-y-3 p-4" data-testid="health-numbers">
      <label className="block">
        <span className="t-label">Sleep need (hours)</span>
        <NumberField value={hs.sleepNeedH} min={4} max={12} onChange={(v) => setHealthSettings({ sleepNeedH: v || 8 })} className="input mt-1" data-testid="health-sleep-need" aria-label="Sleep need in hours" />
      </label>
      <label className="block">
        <span className="t-label">Max heart rate (bpm)</span>
        <NumberField value={hs.maxHR ?? ''} allowEmpty emptyValue={null} integer min={0} max={240} onChange={(v) => setHealthSettings({ maxHR: v || null })} className="input mt-1" data-testid="health-max-hr" aria-label="Max heart rate" placeholder="Estimated from age" />
        <span className="mt-1 block text-xs font-medium" style={{ color: 'var(--text-3)' }}>Leave empty to use 208 − 0.7 × age.</span>
      </label>
      <div className="min-w-0">
        <span className="t-label mb-1 block">Target wake time</span>
        <PickerField kind="time" label="Target wake time" value={validWakeTarget(hs.wakeTarget) ? hs.wakeTarget : null} fallback="07:00"
          min="03:00" max="12:00" validate={(v) => (validWakeTarget(v) ? null : 'Choose a time between 03:00 and 12:00.')}
          emptyText="Auto (your usual wake time)" clearText="Reset to auto" testid="health-wake-target"
          onChange={(v) => setHealthSettings({ wakeTarget: v && validWakeTarget(v) ? v : null })} />
        <span className="mt-1 block text-xs font-medium" style={{ color: 'var(--text-3)' }}>Between 03:00 and 12:00. Auto uses the middle of your wake times over the last 14 nights.</span>
      </div>
    </div>
  )
}

function BaselineCompounds() {
  const compounds = useCompounds()
  const setAffects = useStore((s) => s.setAffectsRecoveryBaseline)
  if (!compounds.length) return null
  return (
    <div className="card p-4" data-testid="health-baseline-compounds">
      <p className="t-label">Compounds that affect baselines</p>
      <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>
        When one of these starts, stops or changes dose, readiness keeps the baseline from before until 10 days of new data exist. On by default for GLP-1 class compounds and testosterone esters.
      </p>
      <div className="mt-1 rows">
        {compounds.map((c) => (
          <Switch key={c.id} label={c.name} on={affectsBaseline(c)} onChange={(on) => setAffects(c.id, on)} testId={`baseline-${c.id}`} />
        ))}
      </div>
    </div>
  )
}

/** A name you can clear and retype; it is saved when you leave the field. */
function HabitRow({ habit: h, onRename, onRemove }) {
  const [draft, setDraft] = useState(h.name)
  return (
    <div className="flex items-center gap-2" data-testid="habit-row">
      <input className="input min-w-0 flex-1" value={draft} aria-label={`Habit name ${h.name}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim()) onRename(h.id, draft); else setDraft(h.name) }} />
      <button onClick={() => onRemove(h.id)} aria-label={`Remove ${h.name}`} data-testid={`habit-remove-${h.id}`} className="rounded-full p-2" style={{ color: 'var(--text-3)' }}><Trash2 size={15} /></button>
    </div>
  )
}

function TrackEffects() {
  const compounds = useCompounds()
  const setTrack = useStore((s) => s.setTrackEffects)
  if (!compounds.length) return null
  return (
    <div className="card p-4" data-testid="health-track-effects">
      <p className="t-label">Track effects</p>
      <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>
        Starts, stops and dose changes of these compounds mark the phases in Body › Effects and the pins on charts. Supplements are not tracked.
      </p>
      <div className="mt-1 rows">
        {compounds.map((c) => (
          <Switch key={c.id} label={c.name} on={tracksEffects(c)} onChange={(on) => setTrack(c.id, on)} testId={`track-${c.id}`} />
        ))}
      </div>
    </div>
  )
}

function Habits() {
  const habits = useStore((s) => s.habits)
  const addHabit = useStore((s) => s.addHabit)
  const renameHabit = useStore((s) => s.renameHabit)
  const removeHabit = useStore((s) => s.removeHabit)
  const [name, setName] = useState('')
  const add = () => { if (name.trim()) { addHabit(name.trim()); setName('') } }
  return (
    <div className="card p-4" data-testid="health-habits">
      <p className="t-label">Evening factors</p>
      <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>Yes or no for an evening, from the evening sheet or the day sheet. Removing one removes its answers.</p>
      <div className="mt-2 space-y-2">
        {habits.filter((h) => !h.hidden).map((h) => <HabitRow key={h.id} habit={h} onRename={renameHabit} onRemove={removeHabit} />)}
        <div className="flex items-center gap-2">
          <input className="input min-w-0 flex-1" value={name} placeholder="Add a habit" aria-label="New habit" data-testid="habit-new"
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
          <button onClick={add} aria-label="Add habit" data-testid="habit-add" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}><Plus size={15} /></button>
        </div>
      </div>
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
      {connected && (
        <>
          <SleepSource />
          <SleepLabSettings />
          <Numbers />
          <BaselineCompounds />
        </>
      )}
      <TrackEffects />
      <Habits />
      <p className="px-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>
        Health data stays on this phone and is not part of the backup file. Settings, check-ins and habits are.
      </p>
    </div>
  )
}
