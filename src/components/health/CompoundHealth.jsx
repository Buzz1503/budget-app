import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { todayStr } from '../../store/useStore'
import { addDays, dateRange } from '../../health/tz'
import { metricLookups } from '../../health/engine/model'
import { sinceStart, beforeAfter } from '../../health/engine/compare'
import { doseChanges } from '../../health/engine/overlay'
import { COMPARE } from '../../health/engine/config'
import { round } from '../../health/engine/stats'
import useHealthModel, { useCompounds } from './useHealthModel'

const fmtV = (v, dp) => (v == null ? '—' : Number(round(v, dp)))

/** One row: before, after, the difference, each side's n — or what is missing. */
function CompareRow({ metric, res }) {
  return (
    <div className="flex items-baseline gap-2 py-1.5 text-xs tabular-nums" data-testid="compound-health-row" data-metric={metric.key}>
      <span className="min-w-0 flex-1 font-bold">{metric.label}</span>
      {res.enough ? (
        <span className="font-medium" style={{ color: 'var(--text-2)' }}>
          {fmtV(res.before.mean, metric.dp)} → <b style={{ color: 'var(--text)' }}>{fmtV(res.after.mean, metric.dp)}</b> {metric.unit}
          <span style={{ color: 'var(--text-3)' }}> (n={res.before.n}/{res.after.n})</span>
        </span>
      ) : (
        <span className="font-medium" style={{ color: 'var(--text-3)' }}>Needs {res.needsMore} more days</span>
      )}
    </div>
  )
}

/** A metric's line with the dose drawn as a step line behind it. */
function MiniDoseChart({ metric, from, to, points }) {
  const days = dateRange(from, to)
  const vals = days.map((d) => ({ d, v: metric.fn(d) })).filter((p) => p.v != null)
  if (vals.length < 2) return null
  const W = 300
  const H = 64
  const x = (d) => 4 + (days.indexOf(d) / Math.max(1, days.length - 1)) * (W - 8)
  const lo = Math.min(...vals.map((p) => p.v))
  const hi = Math.max(...vals.map((p) => p.v))
  const y = (v) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 14)
  // dose step line on its own scale
  const doses = points.filter((p) => p.to != null || p.kind === 'stop').sort((a, b) => a.date.localeCompare(b.date))
  const dHi = Math.max(1, ...doses.map((p) => p.to || 0))
  const dy = (v) => H - 6 - (v / dHi) * (H - 14)
  let step = ''
  let cur = 0
  for (const d of days) {
    const hit = doses.filter((p) => p.date === d).at(-1)
    if (hit) cur = hit.kind === 'stop' ? 0 : hit.to
    step += `${step ? ' ' : ''}${x(d).toFixed(1)},${dy(cur).toFixed(1)}`
  }
  return (
    <div data-testid="compound-mini-chart" data-metric={metric.key}>
      <p className="text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>{metric.label}{metric.unit ? ` (${metric.unit})` : ''}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden="true">
        <polyline points={step} fill="none" stroke="var(--text-3)" strokeWidth="1" strokeDasharray="3 2" />
        <polyline points={vals.map((p) => `${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} fill="none" stroke="var(--text)" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/**
 * A compound's Health view, inside History › compound: the 14 days before it
 * was started against the latest 14 days on it, every dose change with its own
 * before and after, and small charts with the dose as a step line.
 */
export default function CompoundHealth({ peptideId }) {
  const model = useHealthModel()
  const compounds = useCompounds()
  const t = todayStr()
  const [openChange, setOpenChange] = useState(null)
  const c = compounds.find((x) => x.id === peptideId)
  const metrics = useMemo(() => metricLookups(model), [model])

  if (!c || !model.hasData) return null
  const starts = [...c.points.filter((p) => p.kind === 'start' || p.kind === 'prior').map((p) => p.date), ...c.runs.map((r) => r.startedOn)].sort()
  const start = starts[0]
  if (!start) return null
  const open = c.runs.some((r) => !r.endedOn)
  const lastEnd = c.runs.map((r) => r.endedOn).filter(Boolean).sort().at(-1)
  const end = open || !lastEnd ? t : lastEnd
  const changes = doseChanges([c], start, t).filter((e) => e.date > start || e.kind !== 'start')
  const chartFrom = addDays(start, -14)
  const shown = metrics.filter((m) => ['rhr', 'hrv', 'readiness', 'weight'].includes(m.key))

  return (
    <div className="card p-3" data-testid="compound-health">
      <p className="t-caption" style={{ color: 'var(--text-2)' }}>Health, before and on {c.name}</p>
      <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
        14 days before {format(parseISO(start), 'd MMM yyyy')} against the latest 14 days{open ? '' : ' on it'}. Needs {COMPARE.minPerSide} days each side.
      </p>
      <div className="mt-1 rows">
        {metrics.map((m) => <CompareRow key={m.key} metric={m} res={sinceStart(start, end, m.fn)} />)}
      </div>

      {changes.length > 0 && (
        <div className="mt-3" data-testid="compound-health-changes">
          <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Dose changes</p>
          {changes.map((e) => {
            const key = `${e.date}-${e.kind}`
            return (
              <div key={key} className="py-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 font-bold tabular-nums">{format(parseISO(e.date), 'd MMM yyyy')} · {e.label}</span>
                  <button onClick={() => setOpenChange(openChange === key ? null : key)} data-testid="compound-change-compare" aria-expanded={openChange === key}
                    className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                    Before & after
                  </button>
                </div>
                {openChange === key && (
                  <div className="mt-1 rounded-[10px] px-2" style={{ background: 'var(--surface-sunk)' }}>
                    {metrics.map((m) => <CompareRow key={m.key} metric={m} res={beforeAfter(e.date, m.fn)} />)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {shown.map((m) => <MiniDoseChart key={m.key} metric={m} from={chartFrom} to={end} points={c.points} />)}
        <p className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Solid line: the metric. Dashed: the dose.</p>
      </div>
      <p className="mt-2 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{COMPARE.caveat}</p>
    </div>
  )
}
