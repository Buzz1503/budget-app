import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import Switch from './Switch'

// More › Apple Watch: whether the Watch app is installed, when it last heard
// from the iPhone, a test message, and whether a sauna counts toward the Move
// ring.

async function bridge() {
  if (!__NATIVE__) return null
  try { return (await import('../../native/runtime')).PepitoBridge } catch { return null }
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
    const b = await bridge()
    if (!b) { setStatus({ supported: false }); return }
    try { setStatus(await b.watchStatus()) } catch { setStatus({ supported: false }) }
  }
  useEffect(() => { void refresh() }, [])

  const sendTest = async () => {
    const b = await bridge()
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

      <section>
        <h2 className="t-caption mb-2 px-1" style={{ color: 'var(--text-3)' }}>Sauna</h2>
        <div className="card rows px-4">
          <Switch on={!!watch.countSaunaTowardMove} onChange={(v) => setWatch({ countSaunaTowardMove: v })}
            label="Count sauna toward Move ring" hint="Off: the Watch saves the session and its heart rate, without active energy." testId="watch-move-ring" />
        </div>
      </section>
    </div>
  )
}
