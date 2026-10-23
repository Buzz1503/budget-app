import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import {
  hrSummary, thatNight, nextMorning, hoursToBed, fluidEstimate, watchHot, WATCH_HOT_LINE, coolDownDrop,
} from '../../sauna/analytics'
import { addDays } from '../../health/tz'
import { useSaunaHealth } from './saunaHealthContext'

const ZONE_SHADE = [0.2, 0.4, 0.6, 0.8, 1]

const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }

/** Minutes in zones 1 to 5 as one bar, darker for higher zones, with the minutes under it. */
export function ZoneBar({ zones }) {
  const total = zones.reduce((s, z) => s + z, 0)
  if (!total) return null
  return (
    <div data-testid="sauna-zones">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {zones.map((z, i) => (z > 0
          ? <div key={i} style={{ width: `${(z / total) * 100}%`, background: 'var(--series-sauna)', opacity: ZONE_SHADE[i] }} />
          : null))}
      </div>
      <div className="mt-1 grid grid-cols-5 text-[11px] font-bold tabular-nums" style={muted}>
        {zones.map((z, i) => <span key={i}>Z{i + 1} {Math.round(z)} m</span>)}
      </div>
    </div>
  )
}

/** Heart rate across the session, a plain line. */
function HRLine({ series }) {
  const W = 300
  const H = 64
  const bpms = series.map((p) => p[1])
  const lo = Math.min(...bpms) - 5
  const hi = Math.max(...bpms) + 5
  const t0 = series[0][0]
  const t1 = series.at(-1)[0] || 1
  const pts = series.map(([s, b]) => `${(((s - t0) / Math.max(1, t1 - t0)) * W).toFixed(1)},${(H - ((b - lo) / (hi - lo)) * H).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Heart rate across the session" data-testid="sauna-hr-line">
      <polyline points={pts} fill="none" stroke="var(--series-sauna)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

function Block({ title, children, testid }) {
  return (
    <div data-testid={testid}>
      <p className="t-caption mb-1" style={muted}>{title}</p>
      {children}
    </div>
  )
}

function CompareRows({ result, pendingText, testid }) {
  if (result.status === 'pending') return <p className="text-sm font-medium" style={soft} data-testid={`${testid}-pending`}>{pendingText}</p>
  if (result.status === 'none') return <p className="text-sm font-medium" style={soft}>Nothing recorded</p>
  return (
    <div className="space-y-1" data-testid={testid}>
      {result.rows.map((r) => (
        <p key={r.key} className="flex justify-between gap-3 text-sm font-medium tabular-nums" data-metric={r.key}>
          <span style={soft}>{r.label}</span>
          <span className="text-right" style={{ color: 'var(--text)' }}>{r.text}</span>
        </p>
      ))}
    </div>
  )
}

/**
 * Everything about one session: what was logged; heart rate if the Watch
 * recorded it (average, peak, zones, the climb over the first 10 minutes);
 * that night against the 28 nights before, the next morning against the 28
 * days before; the time to bed; the fluid estimate; and the cool-down.
 */
export default function SessionDetail({ session, full = false }) {
  const ctx = useSaunaHealth()
  const d = useMemo(() => {
    const series = ctx.seriesFor(session)
    const hr = hrSummary(series, ctx.maxHR)
    const h = ctx.h
    const night = h ? thatNight(session, h) : null
    const morning = h ? nextMorning(session, h) : null
    const nightRow = h ? h.night(addDays(session.date, 1)) : null
    return {
      series,
      hr,
      night,
      morning,
      toBed: hoursToBed(session, nightRow, ctx.toMs),
      fluid: fluidEstimate(session, h ? h.weighIns : null, ctx.toMs),
      cool: coolDownDrop(session.coolDown),
      hot: watchHot(session, !!series),
    }
  }, [session, ctx])
  return (
    <div className="space-y-4" data-testid="sauna-session-detail">
      <div>
        <p className="text-3xl font-black tabular-nums">{session.lengthMin} min<span className="ml-2 text-lg font-bold" style={muted}>at {session.tempC} C</span></p>
        <p className="mt-1 text-sm font-medium tabular-nums" style={soft}>
          {format(parseISO(session.date), 'EEE d MMM')} · {session.start} · {session.type}
          {session.rounds > 1 ? ` · ${session.rounds} rounds` : ''}{session.coldMin != null ? ` · ${session.coldMin} min cold after` : ''}
        </p>
      </div>

      {d.hr && (
        <Block title="Heart rate" testid="sauna-hr">
          <p className="text-sm font-bold tabular-nums">{d.hr.avg} bpm average, {d.hr.peak} peak</p>
          {full && <div className="mt-2"><HRLine series={d.series} /></div>}
          <div className="mt-2"><ZoneBar zones={d.hr.zones} /></div>
          {d.hr.climb != null && (
            <p className="mt-2 text-sm font-medium tabular-nums" style={soft} data-testid="sauna-climb">
              Heart rate climb: {d.hr.climb} bpm per minute over the first 10 min
            </p>
          )}
          {full && <p className="mt-1 text-[11px] font-medium" style={muted}>Zones from your max heart rate ({ctx.maxHR} bpm).</p>}
        </Block>
      )}
      {d.hot && <p className="text-xs font-medium" style={muted} data-testid="sauna-watch-hot">{WATCH_HOT_LINE}</p>}

      {d.cool && (
        <Block title="Cool down" testid="sauna-cool-down">
          <p className="text-sm font-medium tabular-nums" style={soft}>
            {d.cool.drop2 != null ? `${d.cool.drop2} bpm lower after 2 min` : 'No reading at 2 min'}
            {d.cool.drop5 != null ? `, ${d.cool.drop5} bpm lower after 5 min` : ''}
          </p>
        </Block>
      )}

      {d.night && (
        <Block title="That night, against your usual" testid="sauna-that-night">
          <CompareRows result={d.night} pendingText="Available tomorrow" testid="sauna-night-rows" />
        </Block>
      )}
      {d.morning && (
        <Block title="Next morning, against your usual" testid="sauna-next-morning">
          <CompareRows result={d.morning} pendingText="Available tomorrow" testid="sauna-morning-rows" />
        </Block>
      )}
      {d.toBed != null && (
        <p className="text-sm font-medium tabular-nums" style={soft} data-testid="sauna-to-bed">
          {d.toBed >= 0 ? `Ended ${d.toBed} h before bedtime` : 'Ended after bedtime'}
        </p>
      )}
      {d.fluid && (
        <div data-testid="sauna-fluid">
          <p className="text-sm font-bold tabular-nums">Fluid loss {d.fluid.litres} L <span className="font-medium" style={muted}>estimate</span></p>
          <p className="text-xs font-medium tabular-nums" style={muted}>
            {d.fluid.from === 'manual' ? 'From the weights you entered' : 'From scale weigh-ins'}: {d.fluid.beforeKg} kg before, {d.fluid.afterKg} kg after
          </p>
        </div>
      )}
      {full && session.notes && <p className="text-sm font-medium" style={soft}>{session.notes}</p>}
    </div>
  )
}
