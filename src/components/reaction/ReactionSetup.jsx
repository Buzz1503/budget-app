import { useMemo, useState } from 'react'
import { Check, ChevronRight, ChevronLeft } from 'lucide-react'
import useStore from '../../store/useStore'
import { displayName } from '../../lib/naming'
import {
  SIDE_SETS, SIDE_SET_IDS, COINS, DEFAULT_COIN, defaultSideAssignment, ZONE_BY_ID,
} from '../../lib/reactionZones'
import BodyMap from './BodyMap'

/**
 * Three questions, asked once.
 *
 * Everything here has a working default, so the whole thing can be got through
 * by pressing Next three times — but the defaults are the experiment's design,
 * not filler. The side split in particular is the single most useful thing a
 * person can do about this problem and costs nothing, so it is pre-built rather
 * than offered.
 */

const COMPONENTS = {
  klow: ['bpc157', 'ghkcu', 'kpv', 'tb500'],
}

export default function ReactionSetup({ onDone }) {
  const peptides = useStore((s) => s.peptides)
  const saveReactionSetup = useStore((s) => s.saveReactionSetup)
  const [screen, setScreen] = useState(0)

  const suggested = useMemo(() => {
    const want = ['mots', 'ghk', 'klow']
    return peptides.filter((p) => want.some((w) => String(p.id + p.name).toLowerCase().includes(w))).map((p) => p.id)
  }, [peptides])

  const [suspects, setSuspects] = useState(() => new Set(suggested))
  const [assignment, setAssignment] = useState({})
  const [windows, setWindows] = useState({ morning: '07:00', evening: '20:00' })
  const [coin, setCoin] = useState(DEFAULT_COIN)

  // built once the suspects are known, then editable by hand
  const effectiveAssignment = useMemo(() => {
    const auto = defaultSideAssignment([...suspects], (id) => COMPONENTS[id] || [])
    return { ...auto, ...assignment }
  }, [suspects, assignment])

  const toggle = (id) => setSuspects((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const finish = () => {
    saveReactionSetup({
      suspects: [...suspects],
      sideAssignment: effectiveAssignment,
      windowTimes: windows,
      coin,
    })
    onDone?.()
  }

  return (
    <div className="space-y-3" data-testid="reaction-setup" data-screen={screen}>
      <div>
        <h1 className="text-2xl font-black tracking-tight">Reaction Lab</h1>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          Working out what is causing the redness · step {screen + 1} of 3
        </p>
      </div>

      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1 flex-1 rounded-full"
            style={{ background: i <= screen ? 'var(--accent)' : 'var(--surface-sunk)' }} />
        ))}
      </div>

      {screen === 0 && (
        <div className="space-y-3" data-testid="setup-suspects">
          <p className="text-sm font-bold">What do you suspect?</p>
          <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Start with what you think is doing it. Anything else you take is still logged and still
            compared — this only decides what gets the closest look.
          </p>
          <div className="card rows overflow-hidden">
            {peptides.map((p) => {
              const on = suspects.has(p.id)
              const parts = COMPONENTS[p.id] || []
              const hasGhk = parts.some((x) => x.includes('ghk'))
              return (
                <button key={p.id} onClick={() => toggle(p.id)} data-testid="suspect-row"
                  data-compound={p.id} data-on={on ? 'true' : 'false'}
                  className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                    style={on ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--surface-sunk)' }}>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold">{displayName(p)}</span>
                    {parts.length > 0 && (
                      <span className="block text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                        Contains {parts.join(', ')}
                        {hasGhk && <span className="font-black" style={{ color: 'var(--warn)' }}> · includes GHK-Cu</span>}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="px-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
            A blend is investigated as a whole and as its parts, so a reaction to one ingredient does not
            get blamed on the mixture.
          </p>
        </div>
      )}

      {screen === 1 && (
        <div className="space-y-3" data-testid="setup-sides">
          <p className="text-sm font-bold">Give each one its own side</p>
          <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Keep each suspect to its own part of the body and a reaction names it on its own. It is the
            cheapest test there is and it costs you nothing to run.
          </p>
          <div className="card rows overflow-hidden" data-testid="side-assignment">
            {[...suspects].map((id) => {
              const p = peptides.find((x) => x.id === id)
              return (
                <div key={id} className="px-3 py-2.5" data-testid="side-row" data-compound={id}>
                  <p className="text-xs font-bold">{p ? displayName(p) : id}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {SIDE_SET_IDS.filter((s) => s !== 'any').map((setId) => (
                      <button key={setId} data-testid="side-option" data-set={setId}
                        data-on={effectiveAssignment[id] === setId ? 'true' : 'false'}
                        onClick={() => setAssignment((a) => ({ ...a, [id]: setId }))}
                        className="flex min-h-[32px] items-center rounded-full px-2.5 text-xs font-black"
                        style={effectiveAssignment[id] === setId
                          ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                          : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                        {SIDE_SETS[setId].label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
            {suspects.size === 0 && (
              <p className="px-3 py-3 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                No suspects chosen — everything will use the thighs by default.
              </p>
            )}
          </div>

          <div className="card p-3">
            <p className="t-caption mb-1" style={{ color: 'var(--text-2)' }}>How that looks</p>
            <BodyMap view="front" compact statusByZone={{}}
              allowedZoneIds={[...new Set([...suspects].flatMap((id) => SIDE_SETS[effectiveAssignment[id]]?.zones || []))]} />
            <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
              Solid outlines are in use. Everything else stays free for the rest of your protocol.
            </p>
          </div>
        </div>
      )}

      {screen === 2 && (
        <div className="space-y-3" data-testid="setup-routine">
          <p className="text-sm font-bold">When to ask, and what to measure against</p>

          <div className="card space-y-2 p-3">
            <p className="t-caption" style={{ color: 'var(--text-2)' }}>Check-in windows</p>
            <div className="flex gap-2">
              {[['morning', 'Morning'], ['evening', 'Evening']].map(([k, label]) => (
                <label key={k} className="min-w-0 flex-1">
                  <span className="t-caption mb-1 block" style={{ color: 'var(--text-3)' }}>{label}</span>
                  <input type="time" className="input" value={windows[k]} aria-label={`${label} window`}
                    data-testid={`window-${k}`}
                    onChange={(e) => setWindows((w) => ({ ...w, [k]: e.target.value }))} />
                </label>
              ))}
            </div>
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
              A late check-in is recorded at the time you actually did it, and a missed window never
              stacks up a queue of reminders.
            </p>
          </div>

          <div className="card space-y-2 p-3">
            <p className="t-caption" style={{ color: 'var(--text-2)' }}>Calibration coin</p>
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
              A photo has no scale. Put a coin next to the mark and the app can turn pixels into
              millimetres.
            </p>
            <div className="flex flex-wrap gap-1.5" data-testid="coin-options">
              {COINS.map((c) => (
                <button key={c.id} onClick={() => setCoin(c.id)} data-testid="coin-option" data-coin={c.id}
                  data-on={coin === c.id ? 'true' : 'false'}
                  className="flex min-h-[34px] items-center rounded-full px-3 text-xs font-black tabular-nums"
                  style={coin === c.id
                    ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                    : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                  {c.label} · {c.mm} mm
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {screen > 0 && (
          <button onClick={() => setScreen(screen - 1)} data-testid="setup-back"
            className="flex items-center gap-1 rounded-full px-4 py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            <ChevronLeft size={13} /> Back
          </button>
        )}
        {screen < 2 ? (
          <button onClick={() => setScreen(screen + 1)} data-testid="setup-next"
            className="btn-primary flex flex-1 items-center justify-center gap-1 rounded-full py-3 text-xs font-black">
            Next <ChevronRight size={13} />
          </button>
        ) : (
          <button onClick={finish} data-testid="setup-start"
            className="btn-primary flex-1 rounded-full py-3 text-xs font-black">
            Start
          </button>
        )}
      </div>
    </div>
  )
}

export { COMPONENTS }
