import { useMemo, useState } from 'react'
import { ChevronLeft, Info } from 'lucide-react'
import Modal from '../ui/Modal'
import { OUTCOME_BY_KEY, factorName } from '../../sleep/analysis/dataset'
import { ANALYSIS } from '../../sleep/analysis/engine'
import { clockOf } from '../../health/engine/sleepView'
import useSleepAnalysis from './useSleepAnalysis'

const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }

export function BackHeader({ title, onBack, sub, info }) {
  return (
    <div className="space-y-1">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold" style={soft} data-testid="lab-back"><ChevronLeft size={16} /> Sleep</button>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-2xl font-black tracking-tight">{title}</h2>
        {info && <button onClick={info} aria-label={`About ${title}`} className="p-1.5" style={muted} data-testid="lab-info"><Info size={18} /></button>}
      </div>
      {sub && <p className="text-xs font-medium" style={muted}>{sub}</p>}
    </div>
  )
}

export function Updating({ on }) {
  return on ? <p className="text-[11px] font-medium" style={muted} data-testid="lab-updating">Updating</p> : null
}

function Chip({ label }) {
  const clear = label === 'Clear'
  return <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--surface-sunk)', color: clear ? 'var(--text)' : 'var(--text-3)' }} data-label={label}>{label}</span>
}

function Ranked({ title, items, empty, testid, names }) {
  return (
    <section className="card p-4" data-testid={testid}>
      <p className="t-label">{title}</p>
      {items.length ? (
        <ol className="mt-2 space-y-2">
          {items.map((it, i) => (
            <li key={`${it.factor}-${it.outcome}`} className="flex gap-2" data-testid={`${testid}-row`}>
              <span className="text-sm font-black tabular-nums" style={muted}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{factorName(it.factor, names)}</span>
                <span className="block text-xs font-medium" style={soft}>{OUTCOME_BY_KEY[it.outcome].label} {it.short}</span>
                <span className="block text-[11px] font-bold tabular-nums" style={muted}>
                  {it.adjusted ? `After accounting for everything else${it.rawShort ? `. Alone: ${it.rawShort}` : ''} · ${it.n} nights` : `${it.n} nights`}
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : <p className="mt-1 text-sm font-medium" style={soft}>{empty}</p>}
    </section>
  )
}

const TABS = [['factors', 'Factors'], ['dose', 'Dose-response'], ['carry', 'Carry-over'], ['bestworst', 'Best vs worst'], ['week', 'Weekday vs weekend']]

/** One outcome at a time: every factor with enough nights, clear ones first; adjusted beside raw when unlocked. */
function FactorsTab({ r, names }) {
  const outcomes = useMemo(() => r.outcomes.filter((o) => r.factors.comparisons.some((c) => c.outcome === o)), [r])
  const [outcome, setOutcome] = useState(() => (outcomes.includes('sleepScore') ? 'sleepScore' : outcomes[0]))
  const rows = useMemo(() => {
    const a = r.adjusted[outcome]
    return r.factors.comparisons.filter((c) => c.outcome === outcome).map((c) => {
      const adj = a && !a.locked ? a.effects.find((e) => e.factor === c.factor) : null
      return { ...c, shown: adj ? `${adj.short}, after accounting for everything else` : c.short, alone: adj ? adj.rawShort : null, shownLabel: adj ? adj.label : c.label }
    }).sort((x, y) => (x.shownLabel === y.shownLabel ? Math.abs(y.diff) - Math.abs(x.diff) : x.shownLabel === 'Clear' ? -1 : 1))
  }, [r, outcome])
  return (
    <div className="space-y-3" data-testid="lab-factors">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" data-testid="lab-outcomes">
        {outcomes.map((o) => (
          <button key={o} onClick={() => setOutcome(o)} aria-pressed={o === outcome} data-testid={`lab-outcome-${o}`}
            className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={o === outcome ? { background: 'var(--surface2)', color: 'var(--text)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)' }}>
            {OUTCOME_BY_KEY[o].label}
          </button>
        ))}
      </div>
      <section className="card rows p-0">
        {rows.map((c) => (
          <div key={c.factor} className="flex items-start gap-2 px-4 py-3" data-testid="lab-factor" data-factor={c.factor}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{factorName(c.factor, names)}</p>
              <p className="text-xs font-medium" style={soft}>{c.shown}</p>
              <p className="text-[11px] font-bold tabular-nums" style={muted}>{c.alone ? `Alone: ${c.alone} · ` : ''}{c.nWith} nights with, {c.nWithout} without</p>
            </div>
            <Chip label={c.shownLabel} />
          </div>
        ))}
        {!rows.length && <p className="px-4 py-3 text-sm font-medium" style={soft}>Nothing for this outcome yet.</p>}
      </section>
      {r.factors.locked.length > 0 && (
        <p className="px-1 text-xs font-medium" style={muted} data-testid="lab-locked">
          Needs {ANALYSIS.minPerGroup} nights with and without: {r.factors.locked.map((l) => `${factorName(l.factor, names)} (${l.have})`).join(', ')}.
        </p>
      )}
      {r.rankedBy === 'adjusted' && <p className="px-1 text-[11px] font-medium" style={muted}>{r.adjustedNote}</p>}
      {r.factors.chanceNote && <p className="px-1 text-[11px] font-medium" style={muted} data-testid="lab-chance">{r.factors.chanceNote}</p>}
    </div>
  )
}

/** Small dot-and-whisker chart: the outcome's mean in each bin with its interval and n. */
function DoseChart({ d }) {
  const o = OUTCOME_BY_KEY[d.outcome]
  const vals = d.bins.flatMap((b) => (b.ci ? [b.ci.lo, b.ci.hi] : []))
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = Math.max(1, (hi - lo) * 0.15)
  const W = 300
  const H = 110
  const y = (v) => 10 + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 40)
  const cw = (W - 40) / d.bins.length
  return (
    <section className="card p-4" data-testid="lab-dose">
      <p className="text-sm font-black">{d.label}</p>
      <p className="text-xs font-medium" style={muted}>{o.label}{o.unit ? `, ${o.unit}` : ''}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${o.label} by ${d.label}`}>
        {d.bins.map((b, i) => {
          const cx = 40 + cw * i + cw / 2
          return (
            <g key={b.label}>
              {b.ci && <line x1={cx} x2={cx} y1={y(b.ci.lo)} y2={y(b.ci.hi)} stroke="var(--text-3)" strokeWidth="2" />}
              {b.mean != null && <circle cx={cx} cy={y(b.mean)} r="4" fill="var(--series-sleep)" />}
              {b.mean != null && <text x={cx + 7} y={y(b.mean) + 3} fontSize="9" fill="var(--text-2)" className="tabular-nums">{Number(b.mean.toFixed(o.dp))}</text>}
              <text x={cx} y={H - 16} fontSize="9" textAnchor="middle" fill="var(--text-2)">{b.label}</text>
              <text x={cx} y={H - 4} fontSize="9" textAnchor="middle" fill="var(--text-3)" className="tabular-nums">n {b.n}</text>
            </g>
          )
        })}
      </svg>
    </section>
  )
}

function DoseTab({ r }) {
  if (!r.doseResponse.length) return <p className="px-1 text-sm font-medium" style={soft} data-testid="lab-dose-locked">Each chart appears once two bins have {ANALYSIS.minPerBin} nights or more.</p>
  return <div className="space-y-3">{r.doseResponse.map((d) => <DoseChart key={`${d.key}-${d.outcome}`} d={d} />)}</div>
}

function CarryTab({ r }) {
  if (!r.carryOver.length) return <p className="px-1 text-sm font-medium" style={soft} data-testid="lab-carry-locked">The night after appears once there are {ANALYSIS.minPerGroup} nights after each, and {ANALYSIS.minPerGroup} not.</p>
  return (
    <section className="card rows p-0" data-testid="lab-carry">
      {r.carryOver.map((c) => (
        <div key={`${c.factor}-${c.outcome}`} className="flex items-start gap-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium" style={soft}>{c.text}</p>
            <p className="text-[11px] font-bold tabular-nums" style={muted}>{c.nWith} nights after, {c.nWithout} not</p>
          </div>
          <Chip label={c.label} />
        </div>
      ))}
    </section>
  )
}

function BestWorstTab({ r, names }) {
  const b = r.bestWorst
  if (b.locked) return <p className="px-1 text-sm font-medium" style={soft} data-testid="lab-bw-locked">Best and worst nights appear after {b.need} nights with a sleep score (you have {b.have}).</p>
  const pct = (v) => `${Math.round(v * 100)}%`
  return (
    <div className="space-y-3" data-testid="lab-bestworst">
      {b.sentences.map((s) => <p key={s} className="px-1 text-sm font-medium" style={soft}>{s}</p>)}
      <section className="card p-4">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1.5 text-xs tabular-nums">
          <span className="t-caption" style={muted}>Top and bottom {b.k} nights</span><span className="t-caption" style={muted}>Best</span><span className="t-caption" style={muted}>Worst</span><span className="t-caption" style={muted}>All</span>
          {b.table.slice(0, 15).map((t) => [
            <span key={`${t.factor}n`} className="font-medium" style={soft}>{factorName(t.factor, names)}</span>,
            <span key={`${t.factor}b`} className="text-right font-bold">{pct(t.best)}</span>,
            <span key={`${t.factor}w`} className="text-right font-bold">{pct(t.worst)}</span>,
            <span key={`${t.factor}a`} className="text-right font-medium" style={muted}>{pct(t.overall)}</span>,
          ])}
        </div>
      </section>
    </div>
  )
}

function WeekTab({ r }) {
  const w = r.weekday
  const show = (row, v) => (v == null ? 'No data' : row.unit === 'clock' ? clockOf(v) : `${Number(v.toFixed(OUTCOME_BY_KEY[row.key]?.dp ?? 0))}${row.unit && row.unit !== 'clock' ? ` ${row.unit}` : ''}`)
  const diff = (row) => {
    if (row.diff == null) return ''
    const d = Math.round(row.diff * (row.unit === 'clock' ? 1 : 10)) / (row.unit === 'clock' ? 1 : 10)
    return row.unit === 'clock' ? `${d > 0 ? '+' : ''}${d} min` : `${d > 0 ? '+' : ''}${d}`
  }
  return (
    <div className="space-y-3" data-testid="lab-week">
      {w.socialJetlagMin != null && (
        <p className="px-1 text-sm font-medium" style={soft} data-testid="lab-jetlag">
          Social jetlag: the middle of your sleep is {Math.abs(Math.round(w.socialJetlagMin))} min {w.socialJetlagMin >= 0 ? 'later' : 'earlier'} on weekends.
        </p>
      )}
      <section className="card p-4">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1.5 text-xs tabular-nums">
          <span className="t-caption" style={muted}>{w.nWeekday} weekday, {w.nWeekend} weekend nights</span><span className="t-caption" style={muted}>Weekday</span><span className="t-caption" style={muted}>Weekend</span><span className="t-caption" style={muted}>Diff</span>
          {w.rows.map((row) => [
            <span key={`${row.key}l`} className="font-medium" style={soft}>{row.label}</span>,
            <span key={`${row.key}a`} className="text-right font-bold">{show(row, row.weekday)}</span>,
            <span key={`${row.key}b`} className="text-right font-bold">{show(row, row.weekend)}</span>,
            <span key={`${row.key}d`} className="text-right font-medium" style={muted}>{diff(row)}</span>,
          ])}
        </div>
      </section>
    </div>
  )
}

/** Sleep › Analysis: what helps and hurts, then the five ways of looking. */
export default function AnalysisScreen({ lab, onBack }) {
  const { result: r, updating } = useSleepAnalysis(lab)
  const [tab, setTab] = useState('factors')
  const [info, setInfo] = useState(false)
  return (
    <div className="space-y-4" data-testid="lab-analysis">
      <BackHeader title="Analysis" onBack={onBack} info={() => setInfo(true)} sub="Associations in your own nights, not causes. Each result shows its 95% interval and how many nights it rests on." />
      <Updating on={updating} />
      {!r ? <p className="text-sm font-medium" style={soft}>Working through your nights.</p> : (
        <>
          {r.rankedBy === 'simple' && (
            <p className="px-1 text-xs font-medium" style={muted} data-testid="lab-ranked-simple">
              Ranked by simple comparisons until {ANALYSIS.adjustedFrom} nights with logged factors (you have {r.nightsWithFactors}).
            </p>
          )}
          <Ranked title="What helps" items={r.helps} names={lab.names} testid="lab-helps" empty="Nothing clear yet. Rows appear when a difference's interval stays clear of zero." />
          <Ranked title="What hurts" items={r.hurts} names={lab.names} testid="lab-hurts" empty="Nothing clear yet." />
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" data-testid="lab-tabs">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`lab-tab-${id}`}
                className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
                style={tab === id ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>{label}</button>
            ))}
          </div>
          {tab === 'factors' && <FactorsTab r={r} names={lab.names} />}
          {tab === 'dose' && <DoseTab r={r} />}
          {tab === 'carry' && <CarryTab r={r} />}
          {tab === 'bestworst' && <BestWorstTab r={r} names={lab.names} />}
          {tab === 'week' && <WeekTab r={r} />}
        </>
      )}
      <Modal open={info} onClose={() => setInfo(false)} title="How the analysis works">
        <div className="space-y-2 text-sm font-medium" style={soft} data-testid="lab-info-sheet">
          <p>Each factor is compared on nights with it against nights without, once there are {ANALYSIS.minPerGroup} of each. The interval comes from resampling your own nights 1000 times.</p>
          <p>From {ANALYSIS.adjustedFrom} nights, a ridge regression looks at all factors together, with weekends, recent sleep debt and the long-term trend, so overlapping factors are separated as well as the data allows.</p>
          <p>A row is called Clear only when its interval stays on one side of zero. With many rows, some will still look real by chance.</p>
          <p>These are associations in your own data, not causes, and not advice about any medicine.</p>
        </div>
      </Modal>
    </div>
  )
}
