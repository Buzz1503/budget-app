import useStore from '../../store/useStore'
import Switch from './Switch'

// More › Face ID lock. Widgets, notifications and the Watch keep working while
// the app is locked; only opening the app asks for Face ID.

export const GRACE_OPTIONS = [
  { sec: 0, label: 'Immediately' },
  { sec: 60, label: 'After 1 min' },
  { sec: 300, label: 'After 5 min' },
  { sec: 900, label: 'After 15 min' },
]

export default function LockSettingsScreen() {
  const sec = useStore((s) => s.securitySettings)
  const set = useStore((s) => s.setSecuritySettings)
  return (
    <div className="space-y-6" data-testid="lock-screen-settings">
      <div className="card rows px-4">
        <Switch on={!!sec.faceIdLock} onChange={(v) => set({ faceIdLock: v })} label="Lock with Face ID"
          hint="Your passcode works if Face ID does not." testId="lock-toggle" />
        {sec.faceIdLock && (
          <div className="py-3">
            <p className="t-caption mb-2" style={{ color: 'var(--text-3)' }}>Ask again</p>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Ask again">
              {GRACE_OPTIONS.map((o) => (
                <button key={o.sec} type="button" onClick={() => set({ graceSec: o.sec })} aria-pressed={sec.graceSec === o.sec}
                  data-testid={`lock-grace-${o.sec}`} className="min-h-[44px] rounded-full px-3 text-xs font-bold"
                  style={sec.graceSec === o.sec ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)', border: '1px solid transparent' }}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="px-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
        Widgets, notifications and your Apple Watch keep working while the app is locked.
      </p>
    </div>
  )
}
