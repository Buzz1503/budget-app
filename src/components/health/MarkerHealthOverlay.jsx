import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../../store/useStore'
import { addDays, dateRange } from '../../health/tz'
import { metricLookups } from '../../health/engine/model'
import useHealthModel from './useHealthModel'

const CHOICES = ['weight', 'rhr', 'hrv', 'readiness']
const W = 320
const H = 120
const PAD = { l: 30, r: 30, t: 10, b: 18 }

/**
 * Bloods › marker › Overlay › Health: one health metric drawn on its own axis
 * behind the marker's results, over the span the results cover. Two lines on
 * one chart are two records side by side, not a claim that one moved the other.
 */
export default function MarkerHealthOverlay({ series, unit }) {
  const connected = useStore((s) => s.healthSettings.connected)
  const choice = useStore((s) => s.healthSettings.overlays?.bloodsMarker?.health ?? null)
  const setChartOverlay = useStore((s) => s.setChartOverlay)
  const model = useHealthModel()
  const t = todayStr()
  const metrics = useMemo(() => metricLookups(model).filter((m) => CHOICES.includes(m.key)), [model])
  if (!connected || !model.hasData || !series?.length) return null

  const metric = metrics.find((m) => m.key === choice)
  const from = addDays(series[0].date, -30)
  const to = series.at(-1).date > t ? series.at(-1).date : t
  const days = metric ? dateRange(from, to) : []
  const health = metric ? days.map((d) => ({ d, v: metric.fn(d) })).filter((p) => p.v != null) : []
  const dn = (d) => Date.parse(`${d}T00:00:00Z`)
  const x = (d) => PAD.l + ((dn(d) - dn(from)) / Math.max(1, dn(to) - dn(from))) * (W - PAD.l - PAD.r)
  const scale = (vals) => {
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    return (v) => H - PAD.b - ((v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b)
  }
  const my = scale(series.map((s) => s.value))
  const hy = health.length ? scale(health.map((p) => p.v)) : null

  return (
    <div className="card p-3" data-testid="marker-health-overlay">
      <p className="t-caption" style={{ color: 'var(--text-2)' }}>Overlay › Health</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[{ key: null, label: 'None' }, ...metrics].map((m) => {
          const on = choice === m.key
          return (
            <button key={m.key || 'none'} onClick={() => setChartOverlay('bloodsMarker', { health: m.key })} aria-pressed={on}
              data-testid={`marker-health-${m.key || 'none'}`} className="min-h-[30px] rounded-full px-2.5 text-xs font-bold"
              style={on ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {m.label}
            </button>
          )
        })}
      </div>
      {metric && (
        health.length < 2 ? (
          <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>No {metric.label.toLowerCase()} from Apple Health over these dates.</p>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`Marker with ${metric.label}`} data-testid="marker-health-chart">
              <polyline points={health.map((p) => `${x(p.d).toFixed(1)},${hy(p.v).toFixed(1)}`).join(' ')} fill="none" stroke="var(--text-3)" strokeWidth="1.2" />
              <polyline points={series.map((s) => `${x(s.date).toFixed(1)},${my(s.value).toFixed(1)}`).join(' ')} fill="none" stroke="var(--text)" strokeWidth="2" />
              {series.map((s) => <circle key={s.date} cx={x(s.date)} cy={my(s.value)} r="3" fill="var(--text)" />)}
              <text x={PAD.l} y={H - 4} fontSize="9" fontWeight="700" fill="var(--text-3)">{format(parseISO(from), 'MMM yy')}</text>
              <text x={W - PAD.r} y={H - 4} fontSize="9" fontWeight="700" textAnchor="end" fill="var(--text-3)">{format(parseISO(to), 'MMM yy')}</text>
            </svg>
            <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
              Bold with dots: this marker ({unit}). Thin: {metric.label.toLowerCase()}{metric.unit ? ` (${metric.unit})` : ''}, on its own scale.
            </p>
          </>
        )
      )}
    </div>
  )
}
