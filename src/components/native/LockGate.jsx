import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import useStore from '../../store/useStore'
import { shouldLock } from '../../native/lock'

// Covers the app until Face ID (or the passcode) unlocks it, on launch and on
// return after the grace period. iPhone app only. Widgets, notifications and
// the Watch never pass through here, so they keep working while it is locked.

// The plugin is wrapped in an object: returned bare from an async function it
// would be taken for a promise (Capacitor's proxy answers to .then), and the
// await would never settle.
async function bridge() {
  try { return { b: (await import('../../native/runtime')).PepitoBridge } } catch { return { b: null } }
}

/** App lifecycle events, only where the plugin exists. */
async function lifecycle() {
  try {
    const { PepitoBridge, listen } = await import('../../native/runtime')
    return { on: (event, fn) => listen(PepitoBridge, 'PepitoBridge', event, fn) }
  } catch { return null }
}

export default function LockGate() {
  const sec = useStore((s) => s.securitySettings)
  const [locked, setLocked] = useState(() => shouldLock({ enabled: !!sec.faceIdLock, launch: true }))
  const backgroundedAt = useRef(null)
  const asking = useRef(false)
  const settings = useRef(sec)
  settings.current = sec

  const unlock = async () => {
    if (asking.current) return
    asking.current = true
    const { b } = await bridge()
    try {
      const r = b ? await b.authenticate() : { unlocked: true }
      if (r?.unlocked) setLocked(false)
    } catch { /* stays locked; the button tries again */ }
    asking.current = false
  }

  // the app switcher shows a plain cover while the lock is on
  useEffect(() => {
    void bridge().then(async ({ b }) => { try { await b?.setPrivacyCover({ enabled: !!sec.faceIdLock }) } catch { /* no plugin */ } })
    if (!sec.faceIdLock) setLocked(false)
  }, [sec.faceIdLock])

  useEffect(() => {
    let subs = []
    void lifecycle().then(async (b) => {
      if (!b) return
      subs = [
        await b.on('appBackground', () => { backgroundedAt.current = Date.now() }),
        await b.on('appActive', () => {
          const s = settings.current
          if (shouldLock({ enabled: !!s.faceIdLock, graceSec: s.graceSec, backgroundedAt: backgroundedAt.current })) setLocked(true)
        }),
      ]
    })
    return () => { subs.forEach((h) => h?.remove?.()) }
  }, [])

  useEffect(() => { if (locked) void unlock() }, [locked])

  if (!locked) return null
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 px-8" style={{ background: 'var(--bg)' }}
      data-testid="lock-gate" role="dialog" aria-modal="true" aria-label="Pepito+ is locked">
      <Lock size={32} style={{ color: 'var(--text-2)' }} />
      <p className="t-h2">Pepito+ is locked</p>
      <button type="button" onClick={unlock} className="min-h-[44px] w-full max-w-xs rounded-full text-sm font-bold"
        style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' }} data-testid="lock-unlock">
        Unlock with Face ID
      </button>
    </div>
  )
}
