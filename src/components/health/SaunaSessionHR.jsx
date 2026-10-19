import { useMemo } from 'react'
import { zoneMinutes } from '../../health/engine/training'
import { minutesOf } from '../../sauna/sauna'
import useHealthModel, { tz } from './useHealthModel'

const ZONE_SHADE = [0.2, 0.4, 0.6, 0.8, 1]

/**
 * Heart rate during a session, when the Watch recorded a workout covering
 * it: average and peak, a small line across the session and minutes in each
 * zone (from the max heart rate setting). Nothing is shown otherwise.
 */
export default function SaunaSessionHR({ session }) {
  const model = useHealthModel()
  const hr = useMemo(() => {
    const a = tz.startOfDay(session.date) + minutesOf(session.start) * 60000
    const b = a + session.lengthMin * 60000
    const w = (session.workoutId && model.sessions.find((x) => x.id === session.workoutId || x.mergedIds?.includes(session.workoutId)))
      || model.sessions.find((x) => x.hrSeries.length && x.start < b && x.end > a)
    if (!w?.hrSeries.length) return null
    // the workout's samples inside the session window, as seconds from its start
    const series = w.hrSeries.map(([sec, bpm]) => [w.start + sec * 1000, bpm]).filter(([t]) => t >= a - 60000 && t <= b + 60000)
      .map(([t, bpm]) => [Math.round((t - a) / 1000), bpm])
    if (series.length < 2) return null
    const bpms = series.map((p) => p[1])
    return { series, avg: Math.round(bpms.reduce((s, x) => s + x, 0) / bpms.length), peak: Math.max(...bpms), zones: zoneMinutes(series, model.maxHR) }
  }, [session, model])
  if (!hr) return null
  const W = 300
  const H = 70
  const lo = Math.min(...hr.series.map((p) => p[1])) - 5
  const hi = hr.peak + 5
  const end = hr.series.at(-1)[0] || 1
  const pts = hr.series.map(([s, b]) => `${((s / end) * W).toFixed(1)},${(H - ((b - lo) / (hi - lo)) * H).toFixed(1)}`).join(' ')
  const total = hr.zones.reduce((s, z) => s + z, 0) || 1
  return (
    <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="sauna-hr">
      <p className="text-sm font-black tabular-nums">Heart rate {hr.avg} bpm average, {hr.peak} peak</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Heart rate across the session">
        <polyline points={pts} fill="none" stroke="var(--series-sauna)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="mt-2 grid grid-cols-5 gap-1" data-testid="sauna-zones">
        {hr.zones.map((z, i) => (
          <div key={i}>
            <div className="h-1.5 rounded-full" style={{ background: 'var(--text)', opacity: ZONE_SHADE[i] * (z / total > 0 ? 1 : 0.2) }} />
            <p className="mt-1 text-[11px] font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>Z{i + 1} {Math.round(z)} m</p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Zones from your max heart rate ({model.maxHR} bpm). Apple advises not wearing the Watch above 55 C.</p>
    </div>
  )
}
