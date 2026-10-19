import { useMemo } from 'react'
import useStore from '../../store/useStore'
import { saunaVsNone, saunaSplits, weeklyPattern, SAUNA_CAVEAT } from '../../sauna/saunaEffects'
import useSaunaInput from './useSaunaInput'

const TONE = { 'Clear change': 'var(--text)', 'Possible change': 'var(--text-2)', 'Within normal fluctuation': 'var(--text-3)', 'Too early': 'var(--text-3)' }

function Verdict({ label }) {
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--surface-sunk)', color: TONE[label] }} data-testid="sauna-verdict" data-label={label}>{label}</span>
  )
}

function Rows({ rows, testid }) {
  return (
    <div className="rows" data-testid={testid}>
      {rows.map((r) => (
        <div key={r.key} className="py-2.5" data-testid="sauna-effect-row" data-metric={r.key}>
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-sm font-medium" style={{ color: 'var(--text-2)' }}>{r.text}</p>
            <Verdict label={r.verdict} />
          </div>
          <p className="mt-0.5 text-[11px] font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>
            n {r.split.with.n} vs {r.split.without.n}
            {r.split.with.mean != null && r.split.without.mean != null ? ` · ${Number(r.split.with.mean.toFixed(1))} against ${Number(r.split.without.mean.toFixed(1))}${r.unit ? ` ${r.unit}` : ''}` : ''}
          </p>
        </div>
      ))}
    </div>
  )
}

/** Weekly sessions (x) against that week's average (y), one dot per week. */
function WeekDots({ points, keyName, label, line }) {
  const pts = points.filter((p) => p[keyName] != null)
  const W = 300
  const H = 120
  const L = 30
  if (pts.length < 2) return null
  const xs = pts.map((p) => p.count)
  const ys = pts.map((p) => p[keyName])
  const x0 = Math.min(...xs); const x1 = Math.max(...xs, x0 + 1)
  const y0 = Math.min(...ys); const y1 = Math.max(...ys, y0 + 1)
  const x = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - 8)
  const y = (v) => 8 + (1 - (v - y0) / (y1 - y0)) * (H - 28)
  return (
    <div data-testid={`sauna-weekly-${keyName}`}>
      <p className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>{label}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${label} against sessions that week`}>
        <line x1={L} x2={W - 8} y1={H - 20} y2={H - 20} stroke="var(--border)" />
        {pts.map((p) => <circle key={p.week} cx={x(p.count)} cy={y(p[keyName])} r="4" fill="var(--series-sauna)" opacity="0.8" />)}
        <text x={L - 4} y={y(y1) + 3} fontSize="9" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{Math.round(y1)}</text>
        <text x={L - 4} y={y(y0) + 3} fontSize="9" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{Math.round(y0)}</text>
        <text x={L} y={H - 6} fontSize="9" fill="var(--text-3)">{x0} a week</text>
        <text x={W - 8} y={H - 6} fontSize="9" textAnchor="end" fill="var(--text-3)">{x1} a week</text>
      </svg>
      <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{line.text}</p>
    </div>
  )
}

/**
 * Sauna treated like a compound: sauna days against days without, length and
 * timing splits, and weeks with more sessions. Used in the Sauna tab and in
 * Body > Effects.
 */
export default function SaunaEffectsView() {
  const sessions = useStore((s) => s.saunaSessions)
  const connected = useStore((s) => s.healthSettings.connected)
  const { input } = useSaunaInput()
  const fx = useMemo(() => (connected && sessions.length ? {
    rows: saunaVsNone(input), splits: saunaSplits(input), weekly: weeklyPattern(input),
  } : null), [input, connected, sessions.length])
  if (!connected) return <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>Connect Apple Health in More › Health to compare sauna days with sleep and recovery.</p>
  if (!fx) return <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="sauna-effects-empty">Log a few sessions to start comparing.</p>
  return (
    <div className="space-y-4" data-testid="sauna-effects">
      <section className="card px-4 pb-2 pt-4">
        <p className="t-label">Sauna days against days without</p>
        <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>That night, and the next morning. Needs 7 days in each group.</p>
        <Rows rows={fx.rows} testid="sauna-vs-none" />
      </section>
      <section className="card px-4 pb-2 pt-4" data-testid="sauna-splits">
        <p className="t-label">By length</p>
        {fx.splits.length.map((b) => (
          <div key={b.bucket} className="mt-2">
            <p className="text-xs font-bold" style={{ color: 'var(--text-3)' }}>Sessions {b.words}</p>
            <Rows rows={b.rows} />
          </div>
        ))}
        <p className="t-label mt-3">By timing</p>
        <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Ending within 3 h of bedtime, against earlier sessions.</p>
        <Rows rows={fx.splits.timing} testid="sauna-timing" />
      </section>
      <section className="card space-y-4 p-4" data-testid="sauna-weekly">
        <p className="t-label">Longer term, week by week</p>
        <WeekDots points={fx.weekly.points} keyName="rhr" label="Average resting heart rate" line={fx.weekly.rhr} />
        <WeekDots points={fx.weekly.points} keyName="hrv" label="Average HRV" line={fx.weekly.hrv} />
        {fx.weekly.points.filter((p) => p.rhr != null).length < 2 && <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{fx.weekly.rhr.text}</p>}
      </section>
      <p className="px-1 text-[11px] font-medium" style={{ color: 'var(--text-3)' }} data-testid="sauna-caveat">Higher or lower on days with, not because of. {SAUNA_CAVEAT}</p>
    </div>
  )
}
