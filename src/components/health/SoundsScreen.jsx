import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import LongList from '../ui/LongList'
import TrendChart from '../charts/TrendChart'
import { clockFromNoon } from '../../health/engine/sleep'
import { clockOf } from '../../health/engine/sleepView'
import { soundsNight } from '../../sleep/sounds'
import {
  soundsLine, sessionRows, snoreDensity, burstAt, trendPoints, shortRuns, minutesWords, levelWords,
  gapReasonText, startedByText, startMessage, logRows,
} from '../../sleep/soundsView'
import { tz } from './useHealthModel'
import { Hypnogram, W } from './SleepCharts'
import { BackHeader } from './SleepAnalysis'
import { Switch } from './HealthSettings'
import { AutomationGuide } from './SleepLabSettings'

const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }
const L = 44
const R = 8
const native = () => import('../../native/sleepRuntime')
const CHANGED = 'pepito-sounds-changed'
const isNative = () => typeof __NATIVE__ !== 'undefined' && __NATIVE__

const clock = (ms) => clockOf(clockFromNoon(ms, tz))
const dayShort = (ms) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** Whether Sleep sounds is listening now, from the iPhone; refreshed when the screen opens and every minute. */
export function useSoundsLive(enabled) {
  const [status, setStatus] = useState(null)
  useEffect(() => {
    if (!isNative()) return undefined
    let live = true
    const read = () => native().then((n) => n.soundsStatus()).then((r) => { if (live) setStatus(r) })
    void read()
    const id = setInterval(read, 60000)
    // a start or stop from any screen refreshes every reader
    window.addEventListener(CHANGED, read)
    return () => { live = false; clearInterval(id); window.removeEventListener(CHANGED, read) }
  }, [enabled])
  return status
}

/**
 * Start and stop in the foreground, the reliable way. Turns Sleep sounds on, and keeps what the
 * phone answered (started, blocked, no permission, audio error) to show under the button.
 */
export function useSoundsControl(live, refresh) {
  const set = useStore((s) => s.setSleepSettings)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    setBusy(true)
    const n = await native()
    if (live?.running) {
      await n.stopSounds()
      setMessage(null)
    } else {
      set({ sleepSounds: true, soundsOnSince: new Date().toISOString().slice(0, 10) })
      const r = await n.startSounds('app')
      setMessage({ ok: r.result === 'started' || r.result === 'alreadyRunning', text: startMessage(r.result, r.error) })
    }
    await refresh?.()
    window.dispatchEvent(new Event(CHANGED))
    setBusy(false)
  }
  return { toggle, message, busy }
}

/** The sounds numbers for one night, from the sessions filed under it and (when it has arrived) the Watch's sleep. */
export function useNightSounds(model, date) {
  const sessions = useStore((s) => s.nightExtras[date]?.sounds)
  return useMemo(() => {
    if (!sessions?.length) return { sessions: [], n: null }
    const night = model?.nightBy?.get(date)
    return { sessions, n: soundsNight(sessions, night ? { start: night.start, end: night.end, asleepMin: night.asleepMin } : null) }
  }, [sessions, model, date])
}

/** The Sleep tab's row: one live line, tap for the screen, and the Start button (the reliable way to start). */
export function SoundsRow({ line, onOpen, running = false, onToggle = null, busy = false, message = null }) {
  return (
    <section className="card p-0" data-testid="sounds-card">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 px-4 py-3 text-left" data-testid="sounds-row">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black">Sleep sounds</span>
          <span className="block text-xs font-medium tabular-nums" style={soft} data-testid="sounds-line">{line}</span>
        </span>
        <ChevronRight size={16} style={muted} />
      </button>
      {onToggle && (
        <div className="px-4 pb-3">
          <button type="button" onClick={onToggle} disabled={busy} data-testid="sounds-start"
            className="min-h-[40px] w-full rounded-full px-4 text-sm font-black disabled:opacity-60"
            style={running ? { background: 'var(--surface-sunk)', color: 'var(--text)' } : { background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            {running ? 'Stop Sleep sounds' : 'Start Sleep sounds'}
          </button>
          {message && <p className="mt-2 text-xs font-medium" style={message.ok ? soft : { color: 'var(--text)' }} data-testid="sounds-start-result">{message.text}</p>}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, note, words, testid }) {
  return (
    <div className="space-y-0.5" data-testid={testid}>
      <p className="t-caption" style={muted}>{label}</p>
      <p className="text-lg font-black tabular-nums leading-tight">{value}</p>
      {note && <p className="text-[11px] font-bold tabular-nums" style={muted}>{note}</p>}
      <p className="text-[11px] font-medium" style={soft}>{words}</p>
    </div>
  )
}

function LastNight({ n, label }) {
  if (!n) return null
  const longest = n.longestSnoreMin > 0 ? minutesWords(n.longestSnoreMin) : 'None'
  return (
    <section className="card space-y-4 p-4" data-testid="sounds-last">
      <p className="t-label">{label}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <Stat testid="stat-snoring" label="Snoring" value={n.snoringMin > 0 ? minutesWords(n.snoringMin) : '0 min'} words="Time the phone heard snoring." />
        <Stat testid="stat-share" label="Share of sleep" value={n.snoringPct != null ? `${Math.round(n.snoringPct)}%` : '–'}
          words={n.snoringPct != null ? 'Snoring as a share of the time you were asleep.' : "Shows once this night's sleep has come in from the Watch."} />
        <Stat testid="stat-longest" label="Longest run" value={longest} note={n.longestSnoreAt != null ? `from ${clock(n.longestSnoreAt)}` : null}
          words="Snoring with gaps under a minute counts as one run." />
        <Stat testid="stat-loudest" label="Loudest period" value={n.loudestWindow ? `${n.loudestWindow.db} dB` : '–'}
          note={n.loudestWindow ? `${levelWords(n.loudestWindow.db)}, 10 min from ${clock(n.loudestWindow.s)}` : null}
          words="The 10 minutes with the highest average level." />
        <Stat testid="stat-coughs" label="Coughs" value={n.coughs} words="Coughs the phone recognised." />
        <Stat testid="stat-talking" label="Sleep talking" value={n.talking} words="Speech heard in the room. A partner, a screen or a podcast can count too." />
        <Stat testid="stat-avg" label="Average noise" value={n.avgDb != null ? `${n.avgDb} dB` : '–'}
          words="Measured against the loudest level the microphone takes, so it sits below zero. Closer to zero is louder." />
        <Stat testid="stat-loud" label="Loud noise events" value={n.loudEvents.length}
          words="Minutes 15 dB or more above the room's usual level, joined together." />
      </div>
      {n.lowConfidence && <p className="text-xs font-medium" style={muted} data-testid="sounds-lowconf">The phone moved a lot this night, so the snoring numbers are less reliable.</p>}
      <p className="text-xs font-medium" style={muted}>Audio you were listening to is not counted as noise. A partner's snoring can be picked up too.</p>
    </section>
  )
}

/** Snoring per 10 minutes across the night, on the same axis as the stages above it. Tap a burst for its time and confidence. */
function Timeline({ night, sessions }) {
  const [picked, setPicked] = useState(null)
  const events = useMemo(() => sessions.flatMap((s) => s.events || []), [sessions])
  const gaps = useMemo(() => sessions.flatMap((s) => s.gaps || []), [sessions])
  const levels = useMemo(() => sessions.flatMap((s) => s.levels || []), [sessions])
  const t0 = night ? night.start : Math.min(...sessions.map((s) => s.start))
  const t1 = night ? night.end : Math.max(...sessions.map((s) => s.end))
  const span = t1 - t0 || 1
  const x = (t) => L + ((t - t0) / span) * (W - L - R)
  const bins = useMemo(() => snoreDensity(events, t0, t1), [events, t0, t1])
  const loud = useMemo(() => soundsNight(sessions, null)?.loudEvents.filter((e) => e.e > t0 && e.s < t1) || [], [sessions, t0, t1])
  const runs = useMemo(() => [...events.filter((e) => e.label === 'snoring' && e.e > t0 && e.s < t1)].sort((a, b) => (b.e - b.s) - (a.e - a.s)).slice(0, 5), [events, t0, t1])
  const H = 72
  const hours = []
  for (let t = Math.ceil(t0 / 3600000) * 3600000; t < t1; t += 3 * 3600000) hours.push(t)
  const tap = (ev) => {
    const r = ev.currentTarget.getBoundingClientRect()
    const px = ((ev.clientX - r.left) / r.width) * W
    const ms = t0 + ((px - L) / (W - L - R)) * span
    setPicked(burstAt(events, ms, (14 / (W - L - R)) * span))
  }
  return (
    <section className="card p-4" data-testid="sounds-timeline">
      <p className="t-label">Through the night</p>
      {night && <Hypnogram night={night} tz={tz} />}
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label="Snoring across the night, 10 minutes at a time, with loud moments marked" onClick={tap} data-testid="sounds-density">
        <line x1={L} x2={W - R} y1={52} y2={52} stroke="var(--border)" strokeWidth="1" />
        {gaps.filter((g) => g.e > t0 && g.s < t1).map((g, i) => (
          <rect key={`g${i}`} x={x(Math.max(g.s, t0))} y={6} width={Math.max(1.5, x(Math.min(g.e, t1)) - x(Math.max(g.s, t0)))} height={46} fill="var(--text-3)" opacity="0.2" data-testid="density-gap"><title>No audio captured</title></rect>
        ))}
        {bins.map((b) => (b.min > 0 ? (
          <rect key={b.t} x={x(b.t)} y={52 - (b.min / 10) * 44} width={Math.max(1.5, x(b.t + 600000) - x(b.t) - 1)} height={(b.min / 10) * 44} rx="1.5" fill="var(--text-2)" data-testid="density-bin" />
        ) : null))}
        {loud.map((e, i) => <path key={i} d={`M${x(e.s)} 58 l4 8 h-8 z`} fill="var(--text)" data-testid="loud-mark"><title>{`Loud, ${clock(e.s)}`}</title></path>)}
        {picked && <rect x={x(picked.s) - 1} y={4} width={Math.max(3, x(picked.e) - x(picked.s) + 2)} height={48} fill="none" stroke="var(--text)" strokeWidth="1.2" rx="2" />}
        {hours.map((t) => <text key={t} x={x(t)} y={H - 1} fontSize="9" fontWeight="700" textAnchor="middle" fill="var(--text-3)" className="tabular-nums">{clock(t)}</text>)}
        <text x={L - 6} y={32} fontSize="9" fontWeight="700" textAnchor="end" fill="var(--text-3)">Snoring</text>
        <text x={L - 6} y={64} fontSize="9" fontWeight="700" textAnchor="end" fill="var(--text-3)">Loud</text>
      </svg>
      <p className="mt-1 text-[11px] font-medium" style={muted}>Bar height is the minutes of snoring in each 10 minutes. Triangles are loud moments. Shaded stretches had no audio.</p>
      {picked ? (
        <p className="mt-2 text-sm font-bold tabular-nums" data-testid="burst-detail">
          Snoring {clock(picked.s)} to {clock(picked.e)}, {minutesWords(Math.max(1, Math.round((picked.e - picked.s) / 60000)))}. Confidence {Math.round(picked.c * 100)}%.
        </p>
      ) : (
        <p className="mt-2 text-xs font-medium" style={soft}>{levels.length || events.length ? 'Tap a bar, or pick one of the longest bursts.' : 'Nothing to show for this night.'}</p>
      )}
      {runs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="burst-list">
          {runs.map((e, i) => (
            <button key={i} type="button" onClick={() => setPicked(e)} aria-pressed={picked === e} data-testid="burst-chip"
              className="min-h-[34px] rounded-full px-3 text-xs font-bold tabular-nums"
              style={picked === e ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {clock(e.s)}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function SessionDetail({ session, onClose }) {
  if (!session) return null
  const counts = session.events.reduce((m, e) => ({ ...m, [e.label]: (m[e.label] || 0) + 1 }), {})
  return (
    <div className="space-y-3 text-sm font-medium" style={soft} data-testid="session-detail">
      <p className="tabular-nums">{dayShort(session.start)}, {clock(session.start)} to {clock(session.end)}</p>
      <p>{startedByText(session.startedBy)}.</p>
      <p className="tabular-nums">Saved {session.checkpoints || 0} times along the way, every 5 minutes.</p>
      {session.recovered && <p data-testid="detail-recovered">The app was closed at {clock(session.end)}. Everything up to then is kept.</p>}
      <p className="tabular-nums">Snoring {counts.snoring || 0}, coughs {counts.cough || 0}, talking {counts.speech || 0}.</p>
      <div>
        <p className="t-caption" style={muted}>Gaps</p>
        {(session.gaps || []).length ? (
          <ul className="mt-1 space-y-1" data-testid="detail-gaps">
            {session.gaps.map((g, i) => (
              <li key={i} className="tabular-nums">{clock(g.s)} to {clock(g.e)}, {minutesWords(Math.max(1, Math.round((g.e - g.s) / 60000)))}. {gapReasonText(g.reason)}.</li>
            ))}
          </ul>
        ) : <p className="mt-1">None. It listened the whole time.</p>}
      </div>
      <button type="button" onClick={onClose} className="w-full rounded-full py-2.5 text-sm font-black" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>Close</button>
    </div>
  )
}

function SessionLog({ byNight }) {
  const rows = useMemo(() => sessionRows(byNight), [byNight])
  const attempts = useStore((s) => s.soundsLog)
  const tries = useMemo(() => logRows(attempts || []).slice(0, 30), [attempts])
  const [open, setOpen] = useState(null)
  const session = useMemo(() => Object.values(byNight).flat().find((s) => s.id === open) || null, [byNight, open])
  return (
    <section className="space-y-2" data-testid="sounds-log">
      <h2 className="px-1 text-base font-black">Sessions</h2>
      {rows.length === 0 ? (
        <p className="card p-4 text-sm font-medium" style={soft}>No sessions yet.</p>
      ) : (
        <LongList items={rows} step={20} rowHeight={72} keyOf={(r) => r.id} testid="sounds-log-list" className="card rows p-0"
          renderItem={(r) => (
            <button type="button" onClick={() => setOpen(r.id)} className="flex w-full items-center gap-2 px-4 py-3 text-left" data-testid="session-row">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold tabular-nums">{dayShort(r.start)}, {clock(r.start)} to {clock(r.end)}</span>
                <span className="block text-xs font-medium tabular-nums" style={soft}>
                  {r.reason} · {minutesWords(r.capturedMin)} of audio · {r.events} {r.events === 1 ? 'event' : 'events'}{r.gaps ? ` · ${r.gaps} ${r.gaps === 1 ? 'gap' : 'gaps'}` : ''}
                </span>
              </span>
              <ChevronRight size={16} style={muted} />
            </button>
          )} />
      )}
      <h3 className="px-1 pt-2 text-sm font-black">Start attempts</h3>
      {tries.length === 0 ? (
        <p className="card p-4 text-sm font-medium" style={soft} data-testid="attempts-none">No attempts logged yet. Each start, from the app, a Shortcuts automation or a notification, is listed here with its result.</p>
      ) : (
        <div className="card rows p-0" data-testid="sounds-attempts">
          {tries.map((r) => (
            <div key={r.key} className="px-4 py-3" data-testid="attempt-row" data-ok={String(r.ok)}>
              <p className="text-sm font-bold tabular-nums">{dayShort(r.at)}, {clock(r.at)}</p>
              <p className="text-xs font-medium" style={r.ok ? soft : { color: 'var(--text)' }}>{r.title}</p>
              <p className="text-[11px] font-medium" style={muted}>{r.detail}</p>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!session} onClose={() => setOpen(null)} title="Session">
        <SessionDetail session={session} onClose={() => setOpen(null)} />
      </Modal>
    </section>
  )
}

/** On/off, the Shortcuts walkthrough, a one-minute test, and the plain statement about audio. */
function SetupCheck({ live }) {
  if (!isNative() || !live) return null
  const items = [
    ['Microphone allowed', live.microphone === 'granted', 'Allow it in Settings, Pepito+, Microphone.'],
    ['Background audio on', live.backgroundAudio !== false, 'The app is missing the audio background mode. Reinstall the latest build.'],
    ['Notifications allowed', live.notifications !== false, 'Without them it cannot tell you when it stops or cannot start.'],
  ]
  return (
    <div className="rows" data-testid="sounds-setup-check">
      {items.map(([label, ok, fix]) => (
        <div key={label} className="py-2" data-ok={String(ok)}>
          <p className="text-xs font-bold">{label}: {ok ? 'yes' : 'no'}</p>
          {!ok && <p className="text-[11px] font-medium" style={muted}>{fix}</p>}
        </div>
      ))}
    </div>
  )
}

function SoundsSettings({ live, refresh }) {
  const ss = useStore((s) => s.sleepSettings)
  const set = useStore((s) => s.setSleepSettings)
  const [guide, setGuide] = useState(false)
  const [test, setTest] = useState(null) // null | 'running' | result
  const autoStarted = useStore((s) => Object.values(s.nightExtras || {}).some((x) => (x?.sounds || []).some((q) => q.startedBy === 'shortcut')))
  const runTest = async () => {
    setTest('running')
    const n = await native()
    const r = await n.testSounds()
    setTest(r)
    void refresh()
  }
  const { toggle: toggleNow, message: startNote } = useSoundsControl(live, refresh)
  return (
    <section className="card space-y-1 p-4" data-testid="sounds-settings">
      <p className="t-label">Settings and automation</p>
      <Switch on={!!ss.sleepSounds} onChange={(v) => set(v ? { sleepSounds: true, soundsOnSince: ss.soundsOnSince || new Date().toISOString().slice(0, 10) } : { sleepSounds: false })}
        testId="sounds-switch" label="Sleep sounds" hint="Snoring, coughing and sleep talking, from Apple's on-device sound recognition." />
      <p className="text-xs font-medium" style={soft} data-testid="sounds-no-audio">No audio is ever saved. The phone keeps only the time, the kind of sound and how sure it was, plus one noise level a minute.</p>
      <p className="text-xs font-medium" style={muted}>Phone on the nightstand and charging. Music or a podcast you are listening to keeps playing as it is.</p>
      <SetupCheck live={live} />
      {isNative() ? (
        <div className="space-y-2 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={toggleNow} data-testid="sounds-now" className="min-h-[36px] rounded-full px-3 text-xs font-black" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
              {live?.running ? 'Stop now' : 'Start now'}
            </button>
            <button type="button" onClick={() => setGuide(true)} data-testid="sounds-automatic" className="min-h-[36px] rounded-full px-3 text-xs font-black" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
              Make it automatic
            </button>
            <span className="text-xs font-medium" style={muted} data-testid="sounds-auto-status">{autoStarted ? 'Has started by itself' : 'Not set up yet'}</span>
          </div>
          {startNote && <p className="text-xs font-medium" style={soft} data-testid="sounds-now-result">{startNote.text}</p>}
          <p className="text-xs font-medium" style={muted}>Start from here or the Sleep tab is the most reliable. The automation is a second path: when it cannot start, a notification at bedtime asks you to tap.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={runTest} disabled={test === 'running' || live?.running} data-testid="sounds-test"
              className="min-h-[36px] rounded-full px-3 text-xs font-black disabled:opacity-50" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
              {test === 'running' ? 'Listening for 1 minute' : 'Test for 1 minute'}
            </button>
            {live?.microphone === 'denied' && <span className="text-xs font-medium" style={muted}>Microphone access is off in Settings.</span>}
          </div>
          <TestResult test={test} />
        </div>
      ) : (
        <p className="pt-2 text-xs font-medium" style={muted}>Starting, the automation and the test are in the iPhone app.</p>
      )}
      <Modal open={guide} onClose={() => setGuide(false)} title="Make Sleep sounds automatic"><AutomationGuide /></Modal>
    </section>
  )
}

const LABEL = { snoring: 'snoring', cough: 'coughs', speech: 'talking' }

function TestResult({ test }) {
  if (!test || test === 'running') return null
  if (!test.ran) {
    const why = test.reason === 'running' ? 'Sleep sounds is already listening. Stop it first.'
      : test.reason === 'microphone' ? 'Microphone access is off. Allow it in Settings.' : 'The test could not start. Another app may be using the microphone.'
    return <p className="text-xs font-medium" style={soft} data-testid="test-result">{why}</p>
  }
  const heard = test.heard || []
  return (
    <div className="space-y-0.5 text-xs font-medium tabular-nums" style={soft} data-testid="test-result">
      <p>{heard.length ? `Heard ${heard.map((h) => `${LABEL[h.label] || h.label} ${h.count}`).join(', ')}.` : 'Heard no snoring, coughs or talking.'}</p>
      <p>{test.avgDb != null ? `Level ${levelWords(test.avgDb).toLowerCase()}, average ${test.avgDb} dB, loudest ${test.maxDb} dB.` : 'No level reading.'}</p>
      <p style={muted}>Nothing from this test is kept.</p>
    </div>
  )
}

/** Sleep › Sleep sounds: last night, the timeline, the trend, every session, and the settings. */
export default function SoundsScreen({ lab, date, label, isLast, onBack }) {
  const model = lab.model
  const enabled = useStore((s) => !!s.sleepSettings.sleepSounds)
  const nightExtras = useStore((s) => s.nightExtras)
  const live = useSoundsLive(enabled)
  const { sessions, n } = useNightSounds(model, date)
  const night = model?.nightBy?.get(date) || null
  const byNight = useMemo(() => Object.fromEntries(Object.entries(nightExtras).filter(([, x]) => x?.sounds?.length).map(([d, x]) => [d, x.sounds])), [nightExtras])
  const trend = useMemo(() => {
    const all = Object.entries(byNight).map(([d, list]) => {
      const nn = model?.nightBy?.get(d)
      return { date: d, sounds: soundsNight(list, nn ? { start: nn.start, end: nn.end, asleepMin: nn.asleepMin } : null) }
    })
    return { points: trendPoints(all), short: shortRuns(all) }
  }, [byNight, model])
  const line = soundsLine({ enabled, running: !!live?.running, startedAt: live?.startedAt ?? null, sounds: n, label, isLast, live: isLast, clock })
  const refresh = async () => {
    if (!isNative()) return
    const rt = await native()
    await rt.collectSleepData()
  }
  return (
    <div className="space-y-4" data-testid="lab-sounds">
      <BackHeader title="Sleep sounds" onBack={onBack} sub="Snoring, coughing and sleep talking, heard by the iPhone beside the bed." />
      <section className="card p-4" data-testid="sounds-status">
        <p className="text-sm font-black tabular-nums" data-testid="sounds-status-line">{line}</p>
        {live?.running && live.gapOpen && <p className="mt-1 text-xs font-medium" style={muted}>Paused by another app for now. It listens again as soon as it can.</p>}
      </section>
      {n ? <LastNight n={n} label={label} /> : (
        <p className="card p-4 text-sm font-medium" style={soft} data-testid="sounds-none">
          {enabled ? 'No session for this night. If it should have run, check the automation below.' : 'Sleep sounds is off. Turn it on below.'}
        </p>
      )}
      {n && <Timeline night={night} sessions={sessions} />}
      <section className="space-y-2" data-testid="sounds-trend">
        <TrendChart metric="snoring" chartType="snoringMin" title="Snoring minutes" unit="min" dp={0} series={trend.points} defaultRange="30D" gapDays={1} pinsDefault={false} testid="sounds-chart" />
        <p className="px-1 text-[11px] font-medium" style={muted}>
          Nights the phone did not run are gaps, not zero. A night that ran and heard nothing is 0.{trend.short ? ` ${trend.short} ${trend.short === 1 ? 'night' : 'nights'} that ran under 4 hours ${trend.short === 1 ? 'is' : 'are'} left out.` : ''}
        </p>
      </section>
      <SessionLog byNight={byNight} />
      <SoundsSettings live={live} refresh={refresh} />
    </div>
  )
}
