import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { dateRange } from '../../health/tz'
import { groupSplit, beforeAfter, journalImpact, directionWords } from '../../health/engine/compare'
import { doseChanges } from '../../health/engine/overlay'
import { COMPARE } from '../../health/engine/config'
import { round } from '../../health/engine/stats'
import { useCompounds } from './useHealthModel'

const TABS = [['timing', 'Dose timing'], ['before', 'Before & after'], ['habits', 'Habits']]

// Presets: the questions people tend to ask of these two compounds.
const PRESETS = [
  { match: /dsip/i, label: 'DSIP and sleep', outcomes: ['deepRem', 'sleepTotal'] },
  { match: /mots/i, label: 'MOTS-c and workouts', outcomes: ['workoutAvgHR'] },
]

const fmtV = (v, dp) => (v == null ? '–' : round(v, dp))

function Pill({ on, onClick, children, testid }) {
  return (
    <button onClick={onClick} aria-pressed={on} data-testid={testid} data-on={on ? 'true' : 'false'}
      className="min-h-[32px] rounded-full px-3 text-xs font-bold"
      style={on ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
      {children}
    </button>
  )
}

function Caveat() {
  return <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }} data-testid="compare-caveat">{COMPARE.caveat} Descriptive only, not medical advice.</p>
}

/** Two rows of dots, one per day, so the spread is visible next to the means. */
function DotPlot({ dots }) {
  const all = [...dots.with, ...dots.without].map((d) => d[1])
  if (!all.length) return null
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const x = (v) => 8 + ((v - lo) / (hi - lo || 1)) * 284
  return (
    <svg viewBox="0 0 300 44" className="mt-2 w-full" aria-hidden="true" data-testid="compare-dots">
      {dots.with.map(([d, v]) => <circle key={`w${d}`} cx={x(v)} cy="12" r="3" fill="var(--text)" opacity="0.7" />)}
      {dots.without.map(([d, v]) => <circle key={`o${d}`} cx={x(v)} cy="32" r="3" fill="var(--text-3)" opacity="0.7" />)}
    </svg>
  )
}

function SplitResult({ title, split, outcome, withLabel, withoutLabel, testid }) {
  return (
    <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid={testid}>
      <p className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>{title}</p>
      {split.enough ? (
        <>
          <p className="mt-1 text-sm font-black" data-testid="compare-direction">
            {directionWords(split.diff)} {withLabel}: {split.diff > 0 ? '+' : ''}{fmtV(split.diff, outcome.dp)} {outcome.unit}
          </p>
          <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            {withLabel} {fmtV(split.with.mean, outcome.dp)} (n={split.with.n}) · {withoutLabel} {fmtV(split.without.mean, outcome.dp)} (n={split.without.n})
          </p>
          <DotPlot dots={split.dots} />
          <p className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Top row: {withLabel}. Bottom row: {withoutLabel}.</p>
        </>
      ) : (
        <p className="mt-1 text-sm font-bold" data-testid="compare-needs">
          Needs {split.needsMore} more days <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>({split.with.n} with, {split.without.n} without; {COMPARE.minPerGroup} each)</span>
        </p>
      )}
    </div>
  )
}

function OutcomePicker({ outcomes, value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input w-full" data-testid="compare-outcome" aria-label="Outcome">
      {outcomes.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  )
}

function DoseTiming({ model, compounds }) {
  const doseLogs = useStore((s) => s.doseLogs)
  const habits = useStore((s) => s.habits).filter((h) => !h.hidden)
  const habitLogs = useStore((s) => s.habitLogs)
  const t = todayStr()
  const [picked, setPicked] = useState(() => (compounds[0] ? [`c:${compounds[0].id}`] : habits[0] ? [`h:${habits[0].id}`] : []))
  const [outcomeKeys, setOutcomeKeys] = useState(['hrv'])

  const doseDays = useMemo(() => {
    const m = new Map()
    for (const l of doseLogs) {
      if (!m.has(l.peptideId)) m.set(l.peptideId, new Set())
      m.get(l.peptideId).add(l.date)
    }
    return m
  }, [doseLogs])
  const start = model.firstDate || t
  const allDays = useMemo(() => dateRange(start, t), [start, t])

  const toggle = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))
  const presets = PRESETS.map((p) => ({ ...p, compound: compounds.find((c) => p.match.test(c.name)) })).filter((p) => p.compound)

  const results = []
  for (const key of picked) {
    const [kind, id] = key.split(':')
    let label, inGroup, days
    if (kind === 'c') {
      const c = compounds.find((x) => x.id === id)
      if (!c) continue
      const dates = doseDays.get(id) || new Set()
      const first = [...dates].sort()[0]
      label = c.name
      // only days from the first dose on; before that the question does not apply
      days = first ? allDays.filter((d) => d >= first) : []
      inGroup = (d) => dates.has(d)
    } else {
      const h = habits.find((x) => x.id === id)
      if (!h) continue
      label = h.name
      days = allDays
      inGroup = (d) => {
        const log = habitLogs[d]
        if (!log || !Object.keys(log).length) return null
        return log[id] === true
      }
    }
    for (const ok of outcomeKeys) {
      const outcome = model.outcomes.find((o) => o.key === ok)
      if (!outcome) continue
      results.push({ key: `${key}-${ok}`, label, outcome, split: groupSplit(days, inGroup, outcome.fn) })
    }
  }

  return (
    <div className="space-y-3" data-testid="compare-timing">
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <Pill key={p.label} testid="compare-preset" on={false}
              onClick={() => { setPicked([`c:${p.compound.id}`]); setOutcomeKeys(p.outcomes) }}>
              {p.label}
            </Pill>
          ))}
        </div>
      )}
      <div>
        <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Split days by</p>
        <div className="flex flex-wrap gap-1.5">
          {compounds.map((c) => <Pill key={c.id} testid="compare-split-compound" on={picked.includes(`c:${c.id}`)} onClick={() => toggle(`c:${c.id}`)}>{c.name} dose</Pill>)}
          {habits.map((h) => <Pill key={h.id} testid="compare-split-habit" on={picked.includes(`h:${h.id}`)} onClick={() => toggle(`h:${h.id}`)}>{h.name}</Pill>)}
        </div>
      </div>
      <div>
        <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Outcome</p>
        <OutcomePicker outcomes={model.outcomes} value={outcomeKeys[0]} onChange={(k) => setOutcomeKeys([k])} />
      </div>
      {results.length === 0 && <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Pick something to split days by.</p>}
      {results.map((r) => (
        <SplitResult key={r.key} testid="compare-result" title={`${r.outcome.label}, ${r.label}`} split={r.split} outcome={r.outcome}
          withLabel={r.label.endsWith('dose') ? r.label : `${r.label}`} withoutLabel="other days" />
      ))}
      <Caveat />
    </div>
  )
}

function BeforeAfterView({ model, compounds }) {
  const t = todayStr()
  const events = useMemo(() => doseChanges(compounds, '0000-01-01', t).reverse(), [compounds, t])
  const [eventKey, setEventKey] = useState(events[0] ? `${events[0].compoundId}|${events[0].date}` : '')
  const [outcomeKey, setOutcomeKey] = useState('rhr')
  const ev = events.find((e) => `${e.compoundId}|${e.date}` === eventKey)
  const outcome = model.outcomes.find((o) => o.key === outcomeKey) || model.outcomes[0]
  if (!events.length) return <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }} data-testid="compare-before-empty">No starts, stops or dose changes logged yet.</p>
  // morning and night outcomes are keyed by the day before, so compare by the
  // date the outcome belongs to: a day's "next morning" falls on the next day
  const res = ev ? beforeAfter(ev.date, outcome.fn) : null
  return (
    <div className="space-y-3" data-testid="compare-before">
      <select value={eventKey} onChange={(e) => setEventKey(e.target.value)} className="input w-full" data-testid="compare-event" aria-label="Event">
        {events.map((e) => (
          <option key={`${e.compoundId}|${e.date}`} value={`${e.compoundId}|${e.date}`}>
            {format(parseISO(e.date), 'd MMM yyyy')} · {compounds.find((c) => c.id === e.compoundId)?.name}: {e.kind === 'stop' ? 'stopped' : e.label.split(' ').slice(1).join(' ') || e.kind}
          </option>
        ))}
      </select>
      <OutcomePicker outcomes={model.outcomes} value={outcome.key} onChange={setOutcomeKey} />
      {res && <BeforeAfterResult res={res} outcome={outcome} />}
      <Caveat />
    </div>
  )
}

export function BeforeAfterResult({ res, outcome, testid = 'compare-before-result' }) {
  return (
    <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid={testid}>
      <p className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>{outcome.label}: 14 days before and after</p>
      {res.enough ? (
        <>
          <p className="mt-1 text-sm font-black tabular-nums">
            {res.diff === 0 ? 'About the same after' : res.diff > 0 ? 'Higher after' : 'Lower after'}: {res.diff > 0 ? '+' : ''}{fmtV(res.diff, outcome.dp)} {outcome.unit}
          </p>
          <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            Before {fmtV(res.before.mean, outcome.dp)} (n={res.before.n}) · After {fmtV(res.after.mean, outcome.dp)} (n={res.after.n})
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm font-bold" data-testid="compare-needs">
          Needs {res.needsMore} more days <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>({res.before.n} before, {res.after.n} after; {COMPARE.minPerSide} each)</span>
        </p>
      )}
    </div>
  )
}

function HabitsView({ model }) {
  const habits = useStore((s) => s.habits).filter((h) => !h.hidden)
  const habitLogs = useStore((s) => s.habitLogs)
  const t = todayStr()
  const keys = ['hrv', 'rhr', 'readiness', 'sleepTotal', 'sleepScore']
  const outs = model.outcomes.filter((o) => keys.includes(o.key))
  const rows = useMemo(() => journalImpact({
    habits, habitLogs, days: dateRange(model.firstDate || t, t),
    outcomes: Object.fromEntries(outs.map((o) => [o.key, o.fn])),
  }), [habits, habitLogs, model, t]) // eslint-disable-line react-hooks/exhaustive-deps
  const journaled = Object.values(habitLogs).filter((l) => Object.keys(l).length).length
  return (
    <div className="space-y-3" data-testid="compare-habits">
      <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        Days you filled in the journal ({journaled}), split by each habit. Ordered by the biggest difference; habits without enough days come last.
      </p>
      {rows.map((r) => (
        <div key={r.habitId} className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="habit-impact">
          <p className="text-sm font-black">{r.name}</p>
          {outs.map((o) => {
            const s = r.outcomes[o.key]
            return (
              <p key={o.key} className="text-xs font-medium tabular-nums" style={{ color: s.enough ? 'var(--text-2)' : 'var(--text-3)' }}>
                {o.label}: {s.enough
                  ? `${directionWords(s.diff).replace('on days with', 'with')} it, ${s.diff > 0 ? '+' : ''}${fmtV(s.diff, o.dp)} ${o.unit} (n=${s.with.n} / ${s.without.n})`
                  : `needs ${s.needsMore} more days`}
              </p>
            )
          })}
        </div>
      ))}
      <Caveat />
    </div>
  )
}

/** Descriptive comparisons. Opened from the bottom of Recovery. */
export default function CompareSheet({ model, onClose }) {
  const [tab, setTab] = useState('timing')
  const compounds = useCompounds()
  return (
    <Modal open onClose={onClose} title="Compare">
      <div className="space-y-3" data-testid="compare-sheet">
        <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }} role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`compare-tab-${k}`}
              className="min-h-[32px] flex-1 rounded-full text-xs font-bold"
              style={tab === k ? { background: 'var(--surface2)', color: 'var(--text)' } : { color: 'var(--text-3)' }}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'timing' && <DoseTiming model={model} compounds={compounds} />}
        {tab === 'before' && <BeforeAfterView model={model} compounds={compounds} />}
        {tab === 'habits' && <HabitsView model={model} />}
      </div>
    </Modal>
  )
}
