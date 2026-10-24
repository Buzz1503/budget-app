import { useEffect, useState } from 'react'
import { Moon } from 'lucide-react'
import useStore from '../../store/useStore'
import { useNativeFeed } from '../../native/feed'
import { Switch } from './HealthSettings'

const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }

/** The native calls, loaded only in the iPhone app. */
const native = () => import('../../native/sleepRuntime')

function Action({ onClick, children, testid, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testid}
      className="min-h-[36px] rounded-full px-3 text-xs font-black disabled:opacity-50" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
      {children}
    </button>
  )
}

/**
 * More › Health › Sleep: the Watch's overnight movement, Sleep sounds on the
 * iPhone, late phone use from Screen Time, and a bedroom sensor. Everything
 * stays on the phone.
 */
export default function SleepLabSettings() {
  const ss = useStore((s) => s.sleepSettings)
  const set = useStore((s) => s.setSleepSettings)
  const bedtime = useNativeFeed((s) => s.plannedBedtime)
  const wake = useNativeFeed((s) => s.usualWake)
  const [sounds, setSounds] = useState(null)
  const [screen, setScreen] = useState(null)
  const isNative = typeof __NATIVE__ !== 'undefined' && __NATIVE__

  const refresh = async () => {
    if (!isNative) return
    const n = await native()
    const so = await n.soundsStatus()
    const sc = await n.screenTimeStatus()
    setSounds(so)
    setScreen(sc)
    // automatic answers replace the manual toggles in the evening sheet
    set({ screenTimeOn: !!(sc.authorized && sc.picked), roomSensor: !!so.roomSensor })
  }
  useEffect(() => { void refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSounds = async () => {
    const n = await native()
    if (sounds?.running) await n.stopSounds()
    else await n.startSounds()
    await refresh()
  }
  const allowScreenTime = async () => { const n = await native(); await n.requestScreenTime(); await refresh() }
  const pickApps = async () => {
    const n = await native()
    const r = await n.pickLateUseApps()
    if (r.picked && bedtime && wake) await n.scheduleLateUse(bedtime, wake)
    await refresh()
  }

  return (
    <div className="card p-4" data-testid="sleep-lab-settings">
      <p className="t-label flex items-center gap-1.5"><Moon size={15} style={soft} /> Sleep</p>
      <div className="rows">
        <Switch on={ss.restlessness !== false} onChange={(v) => set({ restlessness: v })} testId="sleep-restlessness"
          label="Movement from Apple Watch" hint="Records wrist movement overnight and sends only a summary. Uses a little more Watch battery." />
        <div className="py-2.5" data-testid="sleep-sounds-settings">
          <Switch on={!!ss.sleepSounds} onChange={(v) => set({ sleepSounds: v })} testId="sleep-sounds"
            label="Sleep sounds on iPhone" hint="Snoring, coughing and sleep talking, from Apple's on-device sound recognition. Keeps the time and kind of sound only. No audio is saved." />
          {ss.sleepSounds && (
            <div className="mt-1 space-y-2">
              <p className="text-xs font-medium" style={soft}>Phone on the nightstand and charging. Audio you are listening to keeps playing as it is. A partner's snoring can be picked up too.</p>
              {isNative && (
                <div className="flex items-center gap-2">
                  <Action onClick={toggleSounds} testid="sleep-sounds-toggle">{sounds?.running ? 'Stop now' : 'Start now'}</Action>
                  <span className="text-xs font-medium tabular-nums" style={muted} data-testid="sleep-sounds-status">
                    {sounds?.running ? 'Listening' : sounds?.microphone === 'denied' ? 'Microphone access is off in Settings' : 'Not running'}
                  </span>
                </div>
              )}
              {sounds?.roomSensor && <p className="text-xs font-medium" style={muted} data-testid="sleep-room-sensor">A HomeKit temperature sensor is read every 5 minutes while it runs.</p>}
            </div>
          )}
        </div>
        <div className="py-2.5" data-testid="late-use-settings">
          <p className="text-sm font-semibold">Late phone use</p>
          <p className="t-caption" style={muted}>
            Minutes of iPhone use after your planned bedtime, from Screen Time. In the app picker choose All apps and categories, then leave out {(ss.sleepAudioApps || ['YouTube']).join(', ')} so falling asleep to audio is not counted.
          </p>
          {isNative && screen && (
            screen.available === false ? (
              <p className="mt-1 text-xs font-medium" style={muted} data-testid="late-use-unavailable">Screen Time is not part of this build. Screen in bed stays in the evening sheet.</p>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!screen.authorized && <Action onClick={allowScreenTime} testid="late-use-allow">Allow Screen Time</Action>}
                {screen.authorized && <Action onClick={pickApps} testid="late-use-pick">{screen.picked ? 'Change apps' : 'Choose apps'}</Action>}
                <span className="text-xs font-medium" style={muted} data-testid="late-use-status">
                  {!screen.authorized ? 'Not allowed yet' : !screen.picked ? 'No apps chosen' : `From ${bedtime || 'bedtime'} to ${wake || 'wake'}`}
                </span>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
