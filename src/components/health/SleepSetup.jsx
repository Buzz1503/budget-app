import { useMemo } from 'react'
import { Check, Circle, Minus } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { addDays } from '../../health/tz'
import { setupChecklist } from '../../sleep/setup'
import useHealthModel from './useHealthModel'

const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }

/** The checklist's inputs, read from Health, the store and what the Watch last reported. */
export function useSleepSetup(model) {
  const nightExtras = useStore((s) => s.nightExtras)
  const ss = useStore((s) => s.sleepSettings)
  const watch = useStore((s) => s.nativeState?.watch)
  const t = todayStr()
  return useMemo(() => {
    const from = addDays(t, -14)
    const nights = [...(model?.nightBy?.values() || [])].filter((n) => n.date > from)
    const sounds = Object.values(nightExtras || {}).flatMap((x) => x?.sounds || [])
    return setupChecklist({
      sleepNights: nights.length,
      spo2Nights: nights.filter((n) => n.overnight?.spo2?.length).length,
      breathingNights: nights.filter((n) => n.overnight?.breathing != null).length,
      complication: watch?.complication ?? null,
      soundsAuto: sounds.some((x) => x.startedBy === 'shortcut'),
      screenTime: ss.screenTimeAvailable === false ? null : !!ss.screenTimeOn,
      roomSensor: ss.roomSensor ?? null,
      watchBattery: watch?.battery ?? null,
    })
  }, [model, nightExtras, ss, watch, t])
}

function Tick({ done }) {
  if (done === null) return <Minus size={16} style={muted} aria-hidden="true" />
  return done
    ? <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: 'var(--accent)' }}><Check size={13} strokeWidth={3} style={{ color: 'var(--accent-fg)' }} /></span>
    : <Circle size={18} style={muted} aria-hidden="true" />
}

function List({ items, compact }) {
  return (
    <div className="rows">
      {items.filter((i) => !compact || i.done !== true).map((i) => (
        <div key={i.key} className="flex items-start gap-3 py-2.5" data-testid={`setup-${i.key}`} data-done={String(i.done)}>
          <span className="mt-0.5 shrink-0" aria-label={i.done ? 'Done' : i.done === false ? 'Not yet' : 'Information'}><Tick done={i.done} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">{i.label}{i.optional ? <span className="ml-1 text-xs font-medium" style={muted}>Optional</span> : null}</span>
            {(!compact || i.done !== true) && <span className="block text-xs font-medium" style={soft}>{i.how}</span>}
            {i.note && <span className="block text-[11px] font-medium tabular-nums" style={muted}>{i.note}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

/** More › Health › Sleep setup: every item, ticked from the data where it can be. */
export function SleepSetupSection() {
  const model = useHealthModel()
  const r = useSleepSetup(model)
  return (
    <div className="card p-4" data-testid="sleep-setup">
      <div className="flex items-baseline gap-2">
        <p className="t-label flex-1">Sleep setup</p>
        <p className="text-xs font-bold tabular-nums" style={muted} data-testid="sleep-setup-count">{r.done} of {r.of}</p>
      </div>
      <p className="text-xs font-medium" style={muted}>Set once, then everything records by itself.</p>
      <List items={r.items} />
    </div>
  )
}

/** The Sleep tab's one-time card: what is left to set up, until it is all done or hidden. */
export default function SleepSetupCard({ model }) {
  const r = useSleepSetup(model)
  const hidden = useStore((s) => s.sleepSettings.setupCardDismissed)
  const set = useStore((s) => s.setSleepSettings)
  if (r.complete || hidden) return null
  return (
    <section className="card p-4" data-testid="sleep-setup-card">
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 text-base font-black">Sleep setup</h2>
        <span className="text-xs font-bold tabular-nums" style={muted}>{r.done} of {r.of} done</span>
      </div>
      <List items={r.items.filter((i) => !i.optional && i.done === false)} compact />
      <button type="button" onClick={() => set({ setupCardDismissed: true })} className="mt-2 text-xs font-bold" style={muted} data-testid="sleep-setup-hide">
        Hide. It stays in More › Health.
      </button>
    </section>
  )
}
