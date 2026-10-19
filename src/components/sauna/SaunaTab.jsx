import { Suspense, useState } from 'react'
import { Info, Plus, Timer, Settings2 } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { CountIn, FillRing, Stagger, StaggerItem } from '../ui/Motion'
import { weekSummary, lastSessionLine } from '../../sauna/sauna'
import { HEALTH_BUILD, SaunaWatchCards, SaunaEffectsView } from '../../health/ui'
import SaunaLogSheet, { Stepper } from './SaunaLogSheet'
import { StartTimerSheet, RunningTimer } from './SaunaTimer'
import SaunaHistory from './SaunaHistory'
import SaunaSessionSheet from './SaunaSessionSheet'

function SectionTitle({ children, sub }) {
  return (
    <div className="px-1">
      <h2 className="text-base font-black">{children}</h2>
      {sub && <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

function Hero({ onLog, onTimer }) {
  const sessions = useStore((s) => s.saunaSessions)
  const target = useStore((s) => s.saunaSettings.weeklyTarget)
  const t = todayStr()
  const week = weekSummary(sessions, t, target)
  const last = lastSessionLine(sessions, t)
  return (
    <section className="card p-5" data-testid="sauna-hero">
      <div className="flex items-center gap-5">
        <div className="relative shrink-0" data-testid="sauna-week-ring" data-count={week.count}>
          <FillRing value={week.count} max={Math.max(1, target)} size={112} stroke={9} color="var(--series-sauna)" />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-3xl font-black tabular-nums leading-none"><CountIn value={week.count} /></p>
            <p className="mt-1 text-[11px] font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>of {target} this week</p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-3xl font-black tabular-nums leading-tight" data-testid="sauna-heat-min">{week.heatMin}<span className="ml-1 text-sm font-bold" style={{ color: 'var(--text-3)' }}>min</span></p>
          <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>heat this week</p>
          <p className="mt-3 text-sm font-bold tabular-nums" data-testid="sauna-last">{last || 'No sessions yet'}</p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button onClick={onLog} className="btn-primary flex items-center justify-center gap-2 rounded-full py-3 text-base font-black" data-testid="sauna-log"><Plus size={18} /> Log session</button>
        <button onClick={onTimer} className="flex items-center justify-center gap-2 rounded-full py-3 text-base font-black" style={{ background: 'var(--surface2)', color: 'var(--text)' }} data-testid="sauna-timer"><Timer size={18} /> Start timer</button>
      </div>
    </section>
  )
}

function InfoSheet({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="About sauna">
      <div className="space-y-2 text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="sauna-info">
        <p>Apple advises not wearing Apple Watch above 55 C.</p>
        <p>Leave your iPhone outside the sauna. iPhones are rated to 35 C.</p>
        <p>Drink fluids before and after.</p>
        <p>Long-running Finnish studies tracked people doing 4 to 7 sessions a week.</p>
        <p>Sauna can lower next-morning HRV for a night, so this app shows your own pattern instead of assuming one.</p>
      </div>
    </Modal>
  )
}

function SettingsSheet({ open, onClose }) {
  const settings = useStore((s) => s.saunaSettings)
  const set = useStore((s) => s.setSaunaSettings)
  if (!open) return null
  return (
    <Modal open onClose={onClose} title="Sauna settings">
      <div className="space-y-4" data-testid="sauna-settings">
        <Stepper label="Weekly target" value={settings.weeklyTarget} onChange={(v) => set({ weeklyTarget: v })} min={1} max={14} testid="sauna-target" />
        <Stepper label="Usual length" unit="min" value={settings.usualLengthMin ?? 20} onChange={(v) => set({ usualLengthMin: v })} min={1} max={120} testid="sauna-usual-length" />
        <Stepper label="Usual temperature" unit="C" value={settings.usualTempC ?? 60} onChange={(v) => set({ usualTempC: v })} min={30} max={120} testid="sauna-usual-temp" />
        <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Until you set them, the usual length and temperature come from your last 10 sessions.</p>
        <label className="flex items-center gap-3 text-sm font-bold">
          <input type="checkbox" checked={settings.showOnHome !== false} onChange={(e) => set({ showOnHome: e.target.checked })} data-testid="sauna-show-home" />
          Show sauna on Home
        </label>
      </div>
    </Modal>
  )
}

/** The Sauna tab: this week, logging and the timer, Watch suggestions, history and how sauna days compare. */
export default function SaunaTab() {
  const timer = useStore((s) => s.saunaTimer)
  const [log, setLog] = useState(null) // { prefill } or { editId }
  const [timerOpen, setTimerOpen] = useState(false)
  const [info, setInfo] = useState(false)
  const [settings, setSettings] = useState(false)
  const [viewing, setViewing] = useState(null)
  return (
    <div data-testid="sauna-tab">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-black tracking-tight">Sauna</h1>
        <button onClick={() => setInfo(true)} aria-label="About sauna" className="p-1.5" style={{ color: 'var(--text-3)' }} data-testid="sauna-info-open"><Info size={18} /></button>
        <button onClick={() => setSettings(true)} aria-label="Sauna settings" className="p-1.5" style={{ color: 'var(--text-3)' }} data-testid="sauna-settings-open"><Settings2 size={18} /></button>
      </div>
      <Stagger className="space-y-6">
        <StaggerItem>
          {timer ? <RunningTimer onStop={(prefill) => setLog({ prefill })} /> : <Hero onLog={() => setLog({})} onTimer={() => setTimerOpen(true)} />}
        </StaggerItem>
        {HEALTH_BUILD && <StaggerItem><Suspense fallback={null}><SaunaWatchCards /></Suspense></StaggerItem>}
        <StaggerItem className="space-y-2">
          <SectionTitle sub="Last 12 weeks; darker is more heat minutes">History</SectionTitle>
          <SaunaHistory onOpen={setViewing} />
        </StaggerItem>
        {HEALTH_BUILD && (
          <StaggerItem className="space-y-2">
            <SectionTitle sub="Sauna treated like a compound: sauna days against days without">Effects</SectionTitle>
            <Suspense fallback={null}><SaunaEffectsView /></Suspense>
          </StaggerItem>
        )}
      </Stagger>
      <SaunaLogSheet open={!!log} prefill={log?.prefill} editId={log?.editId} onClose={() => setLog(null)} />
      <StartTimerSheet open={timerOpen} onClose={() => setTimerOpen(false)} />
      {viewing && <SaunaSessionSheet id={viewing} onClose={() => setViewing(null)} onEdit={(id) => { setViewing(null); setLog({ editId: id }) }} />}
      <InfoSheet open={info} onClose={() => setInfo(false)} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    </div>
  )
}
