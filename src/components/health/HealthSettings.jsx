import SleepLabSettings from './SleepLabSettings'
import { SleepSetupSection } from './SleepSetup'
import { useEffect, useMemo, useState } from 'react'
import { HeartPulse, RefreshCw, Trash2, Plus } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../../store/useStore'
import { sourceRows, stagesWords } from '../../sleep/sources'
import { useHealth } from '../../health/state'
import { progressLine } from '../../health/sync'
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
        {progressLine(progress) || 'Reading Apple Health'}{progress?.total ? ` · ${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : ''}
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
  const sleepSource = useStore((s) => s.healthSettings.sleepSource ?? null)
  const [busy, setBusy] = useState(false)

  const go = async () => {
    setBusy(true)
    setHealthSettings({ connected: true })
    await connect({ priority, sleepSource })
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

/**
 * More › Health › Sleep source: every source Apple Health returned sleep from,
 * with its nights in the last 30 days and the stages it gives. One is used for
 * every night; a night only another source has is shown as Other source and
 * kept out of baselines and the Sleep Lab.
 */
function SleepSource() {
  const priority = useStore((s) => s.healthSettings.sleepPriority)
  const chosen = useStore((s) => s.healthSettings.sleepSource ?? null)
  const setHealthSettings = useStore((s) => s.setHealthSettings)
  const sync = useHealth((s) => s.sync)
  const syncing = useHealth((s) => s.syncing)
  const nights = useHealth((s) => s.data.nights)
  const rows = useMemo(() => sourceRows(nights || [], todayStr()), [nights])
  const pick = (name) => {
    if (name === chosen) return
    setHealthSettings({ sleepSource: name })
    // nights are built when Health is read, so read again to apply the choice
    void sync({ priority, sleepSource: name, full: true })
  }
  const Radio = ({ name, title, sub }) => (
    <button type="button" role="radio" aria-checked={chosen === name} onClick={() => pick(name)} disabled={syncing}
      className="flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-60" data-testid="sleep-source-row" data-source={name ?? 'default'}>
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ border: `2px solid ${chosen === name ? 'var(--accent)' : 'var(--border)'}` }}>
        {chosen === name && <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--accent)' }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        {sub && <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>{sub}</span>}
      </span>
    </button>
  )
  return (
    <div className="card p-4" data-testid="health-sleep-source">
      <p className="t-label">Sleep source</p>
      <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>
        Every sleep number uses this one source. A night it missed uses the next source with data, marked Other source and left out of your baselines and the Sleep Lab.
      </p>
      <div className="mt-2 rows" role="radiogroup" aria-label="Sleep source">
        <Radio name={null} title="Apple Watch (default)" sub="Any Apple Watch that wrote sleep to Health" />
        {rows.map((r) => (
          <Radio key={r.name} name={r.name} title={r.name}
            sub={`${r.nights} ${r.nights === 1 ? 'night' : 'nights'} in the last 30 days · ${stagesWords(r.stages)}`} />
        ))}
      </div>
      {!rows.length && <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }} data-testid="sleep-source-none">No sleep in Apple Health in the last 30 days yet.</p>}
      {syncing && <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>Reading Health again</p>}
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


/** Where the overnight outside temperature is read for (Open-Meteo, no account). */
function WeatherPlace() {
  const w = useStore((s) => s.weatherSettings)
  const set = useStore((s) => s.setWeatherSettings)
  const count = useStore((s) => Object.keys(s.weatherNights || {}).length)
  const num = (v) => { const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? x : null }
  return (
    <div className="card p-4" data-testid="weather-place">
      <p className="t-label">Outside temperature</p>
      <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>The overnight temperature where you sleep, from Open-Meteo, as a factor in Sleep Lab. Only this position and the dates go out. {count} nights stored.</p>
      <label className="mt-3 flex items-center gap-3 text-sm font-bold">
        <input type="checkbox" checked={w?.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} data-testid="weather-enabled" />
        Read the overnight temperature
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Latitude
          <input inputMode="decimal" defaultValue={w?.lat ?? ''} onBlur={(e) => { const v = num(e.target.value); if (v != null && Math.abs(v) <= 90 && v !== w?.lat) set({ lat: v, place: null }) }}
            className="mt-1 w-full rounded-[10px] px-3 py-2 text-sm tabular-nums" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }} data-testid="weather-lat" />
        </label>
        <label className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Longitude
          <input inputMode="decimal" defaultValue={w?.lon ?? ''} onBlur={(e) => { const v = num(e.target.value); if (v != null && Math.abs(v) <= 180 && v !== w?.lon) set({ lon: v, place: null }) }}
            className="mt-1 w-full rounded-[10px] px-3 py-2 text-sm tabular-nums" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }} data-testid="weather-lon" />
        </label>
      </div>
      {w?.place && <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-3)' }}>{w.place}</p>}
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
  const sleepSource = useStore((s) => s.healthSettings.sleepSource ?? null)

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
            <button onClick={() => sync({ priority, sleepSource, full: true })} disabled={syncing} data-testid="health-resync"
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
          <SleepSetupSection />
          <SleepLabSettings />
          <Numbers />
          <WeatherPlace />
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
