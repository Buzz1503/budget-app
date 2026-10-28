import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import Switch from './Switch'

// More › Apple Watch: whether the Watch app is installed, when it last heard
// from the iPhone, a test message, and whether a sauna counts toward the Move
// ring.

// The plugin is wrapped in an object: returned bare from an async function it
// would be taken for a promise (Capacitor's proxy answers to .then), and the
// await would never settle.
async function bridge() {
  if (!__NATIVE__) return { b: null }
  try { return { b: (await import('../../native/runtime')).PepitoBridge } } catch { return { b: null } }
}

const when = (iso) => {
  if (!iso) return 'Not yet'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Not yet' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export default function WatchScreen() {
  const watch = useStore((s) => s.watchSettings)
  const setWatch = useStore((s) => s.setWatchSettings)
  const [status, setStatus] = useState(null)
  const [test, setTest] = useState(null)

  const refresh = async () => {
    const { b } = await bridge()
    if (!b) { setStatus({ supported: false }); return }
    try { setStatus(await b.watchStatus()) } catch { setStatus({ supported: false }) }
  }
  useEffect(() => { void refresh() }, [])

  const sendTest = async () => {
    const { b } = await bridge()
    if (!b) return
    setTest('Sending')
    try {
      const r = await b.sendTestToWatch()
      setTest(r.delivered ? r.detail : `Not sent: ${r.detail}`)
    } catch { setTest('Not sent') }
    void refresh()
  }

  const installed = status?.installed
  const line = !status ? 'Checking' : !status.supported ? 'Not available on this device'
    : !status.paired ? 'No Apple Watch paired' : installed ? 'Installed' : 'Not installed yet'

  return (
    <div className="space-y-6" data-testid="watch-screen">
      <section>
        <h2 className="t-caption mb-2 px-1" style={{ color: 'var(--text-3)' }}>Status</h2>
        <div className="card rows px-4">
          <div className="flex min-h-[44px] items-center justify-between py-2.5">
            <span className="text-sm font-semibold">Pepito+ on Apple Watch</span>
            <span className="text-sm font-medium" style={{ color: installed ? 'var(--good)' : 'var(--text-2)' }} data-testid="watch-installed">{line}</span>
          </div>
          <div className="flex min-h-[44px] items-center justify-between py-2.5">
            <span className="text-sm font-semibold">Last sync</span>
            <span className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="watch-last-sync">{when(status?.lastSync)}</span>
          </div>
          <div className="py-3">
            <button type="button" onClick={sendTest} disabled={!installed} data-testid="watch-send-test"
              className="min-h-[44px] w-full rounded-full text-sm font-bold"
              style={{ background: 'var(--surface-sunk)', color: installed ? 'var(--text)' : 'var(--text-3)' }}>
              Send test
            </button>
            {test && <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-2)' }} data-testid="watch-test-result">{test}</p>}
          </div>
        </div>
        {!installed && status?.paired && (
          <p className="mt-2 px-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            Open the Watch app on your iPhone, scroll to Available Apps and tap Install next to Pepito+.
          </p>
        )}
      </section>

      <BedtimeShortcut />

      <section>
        <h2 className="t-caption mb-2 px-1" style={{ color: 'var(--text-3)' }}>Sauna</h2>
        <div className="card rows px-4">
          <Switch on={!!watch.countSaunaTowardMove} onChange={(v) => setWatch({ countSaunaTowardMove: v })}
            label="Count sauna toward Move ring" hint="Off: the Watch saves the session and its heart rate, without active energy." testId="watch-move-ring" />
          <Switch on={watch.coolDown !== false} onChange={(v) => setWatch({ coolDown: v })}
            label="Cool down" hint="After Stop, the Watch keeps reading heart rate for 5 minutes and saves it with the session." testId="watch-cool-down" />
        </div>
      </section>
    </div>
  )
}

const STEPS = [
  'On your iPhone, open Shortcuts and tap + to make a new shortcut. Name it Pepito Sleep.',
  'Add the action Set Focus, choose Sleep, turn it On.',
  'Add the action Start sleep from Pepito+ (it runs on your Apple Watch).',
  'In the Shortcuts app on your Apple Watch, the shortcut appears on its own. To put it on the face: touch and hold the face, Edit, Complications, Shortcuts, Pepito Sleep.',
  'Optional, for the morning: Shortcuts, Automation, When Sleep Focus turns off, run I\'m up from Pepito+.',
]

/**
 * The bedtime shortcut: one tap on the Watch face turns on Sleep Focus and starts sleep mode.
 * Focus syncs to the iPhone, where the Sleep Focus automation starts Sleep sounds.
 */
function BedtimeShortcut() {
  return (
    <section data-testid="bedtime-shortcut">
      <h2 className="t-caption mb-2 px-1" style={{ color: 'var(--text-3)' }}>Bedtime shortcut</h2>
      <div className="card space-y-3 p-4">
        <p className="text-[17px] font-semibold">One tap at bedtime</p>
        <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
          Pepito+ cannot turn on a Focus itself; a Shortcut can, then start sleep mode.
        </p>
        <ol className="space-y-2.5">
          {STEPS.map((t, i) => (
            <li key={i} className="flex gap-3 text-sm font-medium" data-testid="bedtime-step">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums" style={{ background: 'var(--surface-sunk)' }}>{i + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
        <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
          <p className="text-[15px] font-semibold">The simple way</p>
          <p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-2)' }}>
            Turn on Sleep Focus in Control Centre, then tap the Pepito sleep complication on your face.
          </p>
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="bedtime-battery">
          Battery: Apple asks for 30% or more at bedtime for sleep tracking. Pepito+ adds almost nothing overnight: no workout, no live sensors, the screen redraws once a minute at most.
        </p>
        <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
          Sleep sounds keeps using the iPhone's own microphone. AirPods, YouTube and other audio are never paused, lowered or moved.
        </p>
      </div>
    </section>
  )
}
