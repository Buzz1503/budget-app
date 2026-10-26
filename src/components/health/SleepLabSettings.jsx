import { useEffect, useState } from 'react'
import { Moon } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { useNativeFeed } from '../../native/feed'
import Modal from '../ui/Modal'
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
  const [guide, setGuide] = useState(false)
  const autoStarted = useStore((s) => Object.values(s.nightExtras || {}).some((x) => (x?.sounds || []).some((ss) => ss.startedBy === 'shortcut')))
  const isNative = typeof __NATIVE__ !== 'undefined' && __NATIVE__

  const refresh = async () => {
    if (!isNative) return
    const n = await native()
    const so = await n.soundsStatus()
    const sc = await n.screenTimeStatus()
    setSounds(so)
    setScreen(sc)
    // automatic answers replace the manual toggles in the evening sheet
    set({ screenTimeOn: !!(sc.authorized && sc.picked), screenTimeAvailable: sc.available !== false, roomSensor: !!so.roomSensor })
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
          <Switch on={!!ss.sleepSounds} onChange={(v) => set(v ? { sleepSounds: true, soundsOnSince: ss.soundsOnSince || todayStr() } : { sleepSounds: false })} testId="sleep-sounds"
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
              <div className="flex items-center gap-2">
                <Action onClick={() => setGuide(true)} testid="sleep-sounds-automatic">Make it automatic</Action>
                <span className="text-xs font-medium" style={muted} data-testid="sleep-sounds-auto-status">{autoStarted ? 'Has started by itself' : 'Not set up yet'}</span>
              </div>
              {sounds?.roomSensor && <p className="text-xs font-medium" style={muted} data-testid="sleep-room-sensor">A HomeKit temperature sensor is read every 5 minutes while it runs.</p>}
            </div>
          )}
        </div>
        <Switch on={ss.eveningPrompt !== false} onChange={(v) => set({ eveningPrompt: v })} testId="sleep-evening-prompt"
          label="Evening prompt" hint="30 minutes before your planned bedtime, unless the evening is already logged. Goes where dose reminders go." />
        <Switch on={ss.morningPrompt !== false} onChange={(v) => set({ morningPrompt: v })} testId="sleep-morning-prompt"
          label="Morning check prompt" hint="30 minutes after your usual wake time. Rested and dreams answer from the notification." />
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
      <Modal open={guide} onClose={() => setGuide(false)} title="Make Sleep sounds automatic">
        <AutomationGuide />
      </Modal>
    </div>
  )
}

const STEPS = {
  focus: {
    label: 'When Sleep Focus turns on',
    start: ['Open the Shortcuts app, then Automation.', 'Tap New Automation (or +), then Sleep.', 'Choose "Is Turning On" and Run Immediately.', 'Add the action Start sleep sounds (Pepito+), then Done.'],
    stop: ['New Automation, Sleep, "Is Turning Off", Run Immediately.', 'Add Stop sleep sounds (Pepito+), then Done.'],
  },
  power: {
    label: 'When iPhone connects to power after 8 pm',
    start: ['Open the Shortcuts app, then Automation.', 'Tap New Automation (or +), then Charger.', 'Choose "Is Connected" and Run Immediately.', 'Add the action Start sleep sounds (Pepito+), then Done.', 'It only starts listening between 8 pm and 4 am.'],
    stop: ['Unplugging after 4 am stops it by itself, and it always stops after 11 hours.'],
  },
}

/** The "Make it automatic" walkthrough: a Personal Automation in Shortcuts set to Run Immediately. */
export function AutomationGuide() {
  const [pick, setPick] = useState('focus')
  const s = STEPS[pick]
  return (
    <div className="space-y-3" data-testid="sounds-guide">
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(STEPS).map(([id, x]) => (
          <button key={id} type="button" onClick={() => setPick(id)} aria-pressed={pick === id} data-testid={`sounds-guide-${id}`}
            className="rounded-[14px] px-3 py-2 text-left text-xs font-bold"
            style={pick === id ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            {x.label}
          </button>
        ))}
      </div>
      <div>
        <p className="t-caption" style={muted}>To start</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm font-medium" style={soft}>{s.start.map((x) => <li key={x}>{x}</li>)}</ol>
      </div>
      <div>
        <p className="t-caption" style={muted}>To stop</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm font-medium" style={soft}>{s.stop.map((x) => <li key={x}>{x}</li>)}</ol>
      </div>
      <p className="text-xs font-medium" style={muted}>Start sleep sounds opens Pepito+ for a moment, then keeps listening with the screen locked. The first automatic start ticks Sleep setup.</p>
    </div>
  )
}
