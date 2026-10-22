import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import PickerField from '../ui/PickerField'
import Switch from './Switch'

// More › Notifications: when the AM and PM reminders come, the follow-up
// nudge, and which kinds are on. Permission is asked the first time this page
// opens (never at launch); after that the switches just change the schedule.

const NUDGE_OPTIONS = [30, 60, 90, 120, 180]
const REMIND_ON = [
  { id: 'watch', label: 'Watch' },
  { id: 'iphone', label: 'iPhone' },
  { id: 'both', label: 'Both' },
]
const REMIND_HINT = {
  watch: 'Dose reminders come from Apple Watch, even away from your iPhone. The iPhone keeps them while the Watch app is not installed.',
  iphone: 'Dose reminders come from your iPhone only.',
  both: 'Dose reminders come from each. Apple Watch shows one of each reminder.',
}

async function runtime() {
  if (!__NATIVE__) return null
  try { return await import('../../native/notifyRuntime') } catch { return null }
}

export default function NotificationsScreen() {
  const ns = useStore((s) => s.notificationSettings)
  const set = useStore((s) => s.setNotificationSettings)
  const [display, setDisplay] = useState(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const rt = await runtime()
      if (!rt) { if (alive) setDisplay('unavailable'); return }
      await rt.ensureNotificationPermission()
      const d = await rt.permission()
      if (alive) setDisplay(d)
    })()
    return () => { alive = false }
  }, [])

  return (
    <div className="space-y-6" data-testid="notifications-screen">
      {display === 'denied' && (
        <p className="card p-4 text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="notifications-denied">
          Notifications are off for Pepito+. Turn them on in the iPhone Settings app, under Notifications, then Pepito+.
        </p>
      )}

      <section>
        <h2 className="t-caption mb-2 px-1" style={{ color: 'var(--text-3)' }}>Dose reminders</h2>
        <div className="card rows px-4">
          <Switch on={ns.doses} onChange={(v) => set({ doses: v })} label="AM and PM reminders" hint="Each one lists what is due, with Log, Skip and Remind in 30 min." testId="notify-doses" />
          <div className="grid grid-cols-2 gap-3 py-3">
            <label className="block min-w-0">
              <span className="t-caption mb-1 block" style={{ color: 'var(--text-3)' }}>AM</span>
              <PickerField kind="time" label="AM reminder" value={ns.amTime} onChange={(v) => v && set({ amTime: v })} clearable={false} fallback="07:00" testid="notify-am" />
            </label>
            <label className="block min-w-0">
              <span className="t-caption mb-1 block" style={{ color: 'var(--text-3)' }}>PM</span>
              <PickerField kind="time" label="PM reminder" value={ns.pmTime} onChange={(v) => v && set({ pmTime: v })} clearable={false} fallback="20:00" testid="notify-pm" />
            </label>
          </div>
          <Switch on={ns.timeSensitive} onChange={(v) => set({ timeSensitive: v })} label="Time sensitive" hint="Reminders get through Focus modes." testId="notify-time-sensitive" />
          <div className="py-3">
            <span className="mb-2 block text-sm font-bold">Remind me on</span>
            <div className="flex gap-2" role="group" aria-label="Remind me on">
              {REMIND_ON.map((o) => {
                const on = (ns.remindOn || 'watch') === o.id
                return (
                  <button key={o.id} type="button" onClick={() => set({ remindOn: o.id })} aria-pressed={on}
                    data-testid={`remind-on-${o.id}`} className="min-h-[44px] flex-1 rounded-full px-3 text-xs font-bold"
                    style={on ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)', border: '1px solid transparent' }}>
                    {o.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-3)' }} data-testid="remind-on-hint">{REMIND_HINT[ns.remindOn || 'watch']}</p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="t-caption mb-2 px-1" style={{ color: 'var(--text-3)' }}>Follow-up</h2>
        <div className="card rows px-4">
          <Switch on={ns.nudges} onChange={(v) => set({ nudges: v })} label="One nudge if something is still unlogged" testId="notify-nudges" />
          <div className="flex flex-wrap gap-2 py-3" role="group" aria-label="Nudge after">
            {NUDGE_OPTIONS.map((m) => (
              <button key={m} type="button" onClick={() => set({ nudgeDelayMin: m })} aria-pressed={ns.nudgeDelayMin === m}
                data-testid={`nudge-${m}`} className="min-h-[44px] rounded-full px-3 text-xs font-bold tabular-nums"
                style={ns.nudgeDelayMin === m ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)', border: '1px solid transparent' }}>
                {m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60} min` : ''}`}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 className="t-caption mb-2 px-1" style={{ color: 'var(--text-3)' }}>Other</h2>
        <div className="card rows px-4">
          <Switch on={ns.restarts !== false} onChange={(v) => set({ restarts: v })} label="Cycle restarts" hint="The evening before a compound comes back on cycle. Follows Remind me on." testId="notify-restarts" />
          <Switch on={ns.reactions} onChange={(v) => set({ reactions: v })} label="Reaction check" hint="Once a day while a reaction is open." testId="notify-reactions" />
          {ns.reactions && (
            <div className="py-3">
              <PickerField kind="time" label="Reaction check time" value={ns.reactionTime} onChange={(v) => v && set({ reactionTime: v })} clearable={false} fallback="19:00" testid="notify-reaction-time" />
            </div>
          )}
          <Switch on={ns.stock} onChange={(v) => set({ stock: v })} label="Order by date" hint="Once on the order by date, and the morning a mixed vial reaches its fridge life. Follows Remind me on." testId="notify-stock" />
          <Switch on={ns.countCheck !== false} onChange={(v) => set({ countCheck: v })} label="Weekly count" hint="Sunday evening, a quick count of the sealed vials. Follows Remind me on." testId="notify-count" />
          {ns.countCheck !== false && (
            <div className="py-3">
              <PickerField kind="time" label="Weekly count time" value={ns.countTime || '18:00'} onChange={(v) => v && set({ countTime: v })} clearable={false} fallback="18:00" testid="notify-count-time" />
            </div>
          )}
          <Switch on={ns.sauna} onChange={(v) => set({ sauna: v })} label="Sauna target" hint="When a running session reaches its target." testId="notify-sauna" />
        </div>
      </section>
    </div>
  )
}
