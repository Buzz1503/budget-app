import { Suspense, useState } from 'react'
import { Info, Plus, Timer, Settings2 } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { CountIn, FillRing, Stagger, StaggerItem } from '../ui/Motion'
import { weekSummary } from '../../sauna/sauna'
import { typicalLine, todayLine } from '../../sauna/analytics'
import { useSaunaHealth } from './saunaHealthContext'
import SaunaRatingSheet from './SaunaRatingSheet'
import { HEALTH_BUILD, SaunaWatchCards, SaunaHealthProvider } from '../../health/ui'
import SaunaLogSheet, { Stepper } from './SaunaLogSheet'
import { StartTimerSheet, RunningTimer } from './SaunaTimer'
import { Consistency, HistoryList } from './SaunaHistory'
import { LastSessionCard, HeatAdaptationCard, CoolDownCard, PatternsCard, LongerTermCard } from './SaunaSections'
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
  const typical = typicalLine(sessions)
  const today = todayLine(useSaunaHealth().h)
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
          <p className="mt-3 text-sm font-bold tabular-nums" data-testid="sauna-typical">{typical || 'No sessions yet'}</p>
        </div>
      </div>
      {today && <p className="mt-3 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="sauna-today-line">{today}</p>}
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
        <p>Long-running Finnish studies tracked people doing 4 to 7 sessions a week.</p>
        <p>Each session is read against your own usual: that night against the 28 nights before, the next morning against the 28 days before.</p>
        <p>Patterns and the longer term only use days from your first session on.</p>
      </div>
    </Modal>
  )
}

function SettingsSheet({ open, onClose }) {
  const settings = useStore((s) => s.saunaSettings)
  const set = useStore((s) => s.setSaunaSettings)
  const coolDown = useStore((s) => s.watchSettings?.coolDown !== false)
  const setWatch = useStore((s) => s.setWatchSettings)
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
        {__NATIVE__ && (
          <label className="flex items-start gap-3 text-sm font-bold">
            <input type="checkbox" checked={coolDown} onChange={(e) => setWatch({ coolDown: e.target.checked })} className="mt-1" data-testid="sauna-cool-down-setting" />
            <span>Cool down on Apple Watch<span className="block text-xs font-medium" style={{ color: 'var(--text-3)' }}>After Stop, keep reading heart rate for 5 minutes and save it with the session.</span></span>
          </label>
        )}
      </div>
    </Modal>
  )
}

/** The Sauna tab, top to bottom: this week, the last session, heat adaptation, cool-down, consistency, patterns, the longer term and history. */
export default function SaunaTab() {
  const timer = useStore((s) => s.saunaTimer)
  const [log, setLog] = useState(null) // { prefill } or { editId }
  const [timerOpen, setTimerOpen] = useState(false)
  const [info, setInfo] = useState(false)
  const [settings, setSettings] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [rating, setRating] = useState(null)
  const body = (
    <>
      <Stagger className="space-y-6">
        <StaggerItem>
          {timer ? <RunningTimer onStop={(prefill) => setLog({ prefill })} /> : <Hero onLog={() => setLog({})} onTimer={() => setTimerOpen(true)} />}
        </StaggerItem>
        {HEALTH_BUILD && <StaggerItem><Suspense fallback={null}><SaunaWatchCards /></Suspense></StaggerItem>}
        <StaggerItem className="space-y-2">
          <SectionTitle>Last session</SectionTitle>
          <LastSessionCard onOpen={setViewing} />
        </StaggerItem>
        {HEALTH_BUILD && (
          <StaggerItem className="space-y-2">
            <SectionTitle sub="Watch sessions at a similar temperature">Heat adaptation</SectionTitle>
            <HeatAdaptationCard />
          </StaggerItem>
        )}
        {HEALTH_BUILD && (
          <StaggerItem className="space-y-2">
            <SectionTitle sub="Heart rate after leaving the sauna">Cool-down recovery</SectionTitle>
            <CoolDownCard />
          </StaggerItem>
        )}
        <StaggerItem className="space-y-2">
          <SectionTitle sub="Last 12 weeks; darker is more heat minutes">Consistency</SectionTitle>
          <Consistency />
        </StaggerItem>
        {HEALTH_BUILD && (
          <StaggerItem className="space-y-2">
            <SectionTitle sub="That night and the next morning, from your first session on">Patterns</SectionTitle>
            <PatternsCard />
          </StaggerItem>
        )}
        {HEALTH_BUILD && (
          <StaggerItem className="space-y-2">
            <SectionTitle sub="Week by week from your first session">Longer term</SectionTitle>
            <LongerTermCard />
          </StaggerItem>
        )}
        <StaggerItem className="space-y-2">
          <SectionTitle>History</SectionTitle>
          <HistoryList onOpen={setViewing} />
        </StaggerItem>
      </Stagger>
      {viewing && <SaunaSessionSheet id={viewing} onClose={() => setViewing(null)} onEdit={(id) => { setViewing(null); setLog({ editId: id }) }} />}
    </>
  )
  return (
    <div data-testid="sauna-tab">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-black tracking-tight">Sauna</h1>
        <button onClick={() => setInfo(true)} aria-label="About sauna" className="p-1.5" style={{ color: 'var(--text-3)' }} data-testid="sauna-info-open"><Info size={18} /></button>
        <button onClick={() => setSettings(true)} aria-label="Sauna settings" className="p-1.5" style={{ color: 'var(--text-3)' }} data-testid="sauna-settings-open"><Settings2 size={18} /></button>
      </div>
      {HEALTH_BUILD ? <Suspense fallback={body}><SaunaHealthProvider>{body}</SaunaHealthProvider></Suspense> : body}
      <SaunaLogSheet open={!!log} prefill={log?.prefill} editId={log?.editId} onClose={() => setLog(null)}
        onSaved={(saved) => { if (!log?.editId && saved?.id) setRating(saved.id) }} />
      {rating && <SaunaRatingSheet id={rating} onClose={() => setRating(null)} />}
      <StartTimerSheet open={timerOpen} onClose={() => setTimerOpen(false)} />
      <InfoSheet open={info} onClose={() => setInfo(false)} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    </div>
  )
}
