import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import {
  hrSummary, thatNight, nextMorning, hoursToBed, fluidEstimate, coolDownDrop, NO_HR_LINE,
} from '../../sauna/analytics'
import { ratingWords } from './SaunaRatingSheet'
import { addDays } from '../../health/tz'
import useStore, { todayStr } from '../../store/useStore'
import { useSaunaHealth } from './saunaHealthContext'
import { hrAtMinute10, minute10Row } from '../../sauna/insights'
import { StatRow } from '../ui/Glance'

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
  const W = 320
  const H = 150
  const L = 36
  const T = 22
  const B = 22
  const bpms = series.map((p) => p[1])
  const lo = Math.floor(Math.min(...bpms) - 5)
  const hi = Math.ceil(Math.max(...bpms) + 5)
  const t0 = series[0][0]
  const t1 = series.at(-1)[0] || 1
  const x = (sec) => L + ((sec - t0) / Math.max(1, t1 - t0)) * (W - L - 6)
  const y = (b) => T + (1 - (b - lo) / (hi - lo)) * (H - T - B)
  const pts = series.map(([s, b]) => `${x(s).toFixed(1)},${y(b).toFixed(1)}`).join(' ')
  const mins = Math.round((t1 - t0) / 60)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Heart rate across the session" data-testid="sauna-hr-line">
      <text x={2} y={12} fontSize="11.5" fontWeight="700" fill="var(--text-3)" data-testid="axis-unit">bpm</text>
      {[lo, hi].map((v) => <text key={v} x={L - 5} y={y(v) + 4} fontSize="12" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{v}</text>)}
      <line x1={L} x2={W - 6} y1={H - B} y2={H - B} stroke="var(--border)" />
      <polyline points={pts} fill="none" stroke="var(--series-sauna)" strokeWidth="2" strokeLinejoin="round" />
      <text x={L} y={H - 5} fontSize="12" fill="var(--text-3)">0 min</text>
      <text x={W - 6} y={H - 5} fontSize="12" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{mins} min</text>
    </svg>
  )
}

function Block({ title, children, testid }) {
  return (
    <div data-testid={testid}>
      <p className="mb-1 text-[15px] font-semibold">{title}</p>
      {children}
    </div>
  )
}

const COMPARE_METRIC = { sleepScore: 'sleepScore', deepSleep: 'deepSleep', sleepingHR: 'sleepingHR', wristTemp: 'wristTemp', restless: 'restless', hrv: 'hrv', rhr: 'rhr', readiness: 'readiness' }

/**
 * Waiting for that night or the next morning: "Available tomorrow" only before the morning
 * after; on the morning itself it fills in once the Watch's data has synced.
 */
function pendingWords(sessionDate, what) {
  const wake = addDays(sessionDate, 1)
  if (wake > todayStr()) return 'Available tomorrow'
  return what === 'night' ? "Fills in once last night's sleep has synced from your Watch." : 'Fills in once this morning has synced from your Watch.'
}

function CompareRows({ result, pendingText, testid }) {
  if (result.status === 'pending') return <p className="text-sm font-medium" style={soft} data-testid={`${testid}-pending`}>{pendingText}</p>
  if (result.status === 'none') return <p className="text-sm font-medium" style={soft}>Nothing recorded</p>
  return (
    <div className="rows" data-testid={testid}>
      {result.rows.map((r) => (
        <div key={r.key} data-metric={r.key} aria-label={`${r.label}: ${r.text}`}>
          <StatRow label={r.label} value={r.value == null ? 'No reading' : Math.round(r.value * (r.unit === 'C' ? 10 : 1)) / (r.unit === 'C' ? 10 : 1)} unit={r.value == null ? undefined : r.unit}
            sub={r.base != null ? `Usual ${r.unit === 'C' ? Math.round(r.base * 10) / 10 : Math.round(r.base)}` : null}
            metric={COMPARE_METRIC[r.key]} delta={r.diff} deltaDp={r.unit === 'C' ? 1 : 0} />
        </div>
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
export default function SessionDetail({ session, full = false, onRate = null }) {
  const ctx = useSaunaHealth()
  const sessions = useStore((s) => s.saunaSessions)
  // minute 10 of this session against your usual at the same temperature
  const m10 = useMemo(() => minute10Row(sessions.map((x) => ({
    id: x.id, date: x.date, start: x.start, tempC: x.tempC, lengthMin: x.lengthMin, hr10: hrAtMinute10(ctx.seriesFor(x)),
  })), session.id), [sessions, session.id, ctx])
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
        {ratingWords(session) && <p className="mt-1 text-sm font-bold tabular-nums" data-testid="sauna-rating-line">{ratingWords(session)}</p>}
        {onRate && (
          <button type="button" onClick={onRate} className="mt-1 text-xs font-bold" style={soft} data-testid="sauna-rate-open">
            {session.rating ? 'Change rating' : 'Rate this session'}
          </button>
        )}
      </div>

      {d.hr && (
        <Block title="Heart rate" testid="sauna-hr">
          <p className="text-sm font-bold tabular-nums">{d.hr.avg} bpm average, {d.hr.peak} peak</p>
          {full && <div className="mt-2"><HRLine series={d.series} /></div>}
          <div className="mt-2"><ZoneBar zones={d.hr.zones} /></div>
          {m10 && (
            <p className="mt-2 text-sm font-medium tabular-nums" style={soft} data-testid="sauna-minute10">
              Heart rate at 10 min: <b style={{ color: 'var(--text)' }}>{m10.hr10}</b> bpm{m10.usual != null ? <>, your usual at {m10.centre} C is <b style={{ color: 'var(--text)' }}>{m10.usual}</b></> : ''}
            </p>
          )}
          {d.hr.climb != null && (
            <p className="mt-1 text-sm font-medium tabular-nums" style={soft} data-testid="sauna-climb">
              Heart rate climb: {d.hr.climb} bpm per minute over the first 10 min
            </p>
          )}
          {full && <p className="mt-1 text-[11px] font-medium" style={muted}>Zones from your max heart rate ({ctx.maxHR} bpm).</p>}
        </Block>
      )}

      {!d.hr && session.hrAround && (
        <Block title="Heart rate" testid="sauna-hr-fallback">
          <p className="text-sm font-bold">{NO_HR_LINE}</p>
          <p className="mt-1 text-sm font-medium tabular-nums" style={soft}>
            {[
              session.hrAround.before != null ? `${session.hrAround.before} bpm in the 10 min before` : null,
              session.hrAround.after != null ? `${session.hrAround.after} bpm in the 10 min after` : null,
              session.hrAround.at30 != null ? `${session.hrAround.at30} bpm 30 min after` : null,
            ].filter(Boolean).join(', ')}
          </p>
        </Block>
      )}

      {d.cool && (
        <Block title="Cool down" testid="sauna-cool-down">
          {d.cool.drop2 != null
            ? <p className="text-[15px] font-semibold tabular-nums">Heart rate dropped {d.cool.drop2} bpm in 2 min{d.cool.drop5 != null ? <span className="font-medium" style={soft}>, {d.cool.drop5} in 5</span> : ''}</p>
            : <p className="text-sm font-medium" style={soft}>No reading at 2 min</p>}
        </Block>
      )}

      {d.night && (
        <Block title="That night, against your usual" testid="sauna-that-night">
          <CompareRows result={d.night} pendingText={pendingWords(session.date, 'night')} testid="sauna-night-rows" />
        </Block>
      )}
      {d.morning && (
        <Block title="Next morning, against your usual" testid="sauna-next-morning">
          <CompareRows result={d.morning} pendingText={pendingWords(session.date, 'morning')} testid="sauna-morning-rows" />
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
