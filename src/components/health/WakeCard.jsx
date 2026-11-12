import { useMemo, useState } from 'react'
import { AlarmClock } from 'lucide-react'
import useStore from '../../store/useStore'
import { AnswerLine, InfoButton } from '../ui/Glance'
import { addDays } from '../../health/tz'
import { tz } from './useHealthModel'
import { wakeDetails, wakeLine, byHour, stageShare, hrCurve, backToSleep, reasonCounts, clock12, WAKE_ACCURACY } from '../../sleep/wakeDetail'

const soft = { color: 'var(--text-2)' }
const muted = { color: 'var(--text-3)' }
const STAGE_FILL = { rem: 'var(--stage-rem)', core: 'var(--stage-core)', deep: 'var(--stage-deep)' }
const STAGE_WORD = { rem: 'REM', core: 'Core', deep: 'Deep' }

/** Every counted night's wake-ups in detail, by date (nights with stages, the chosen source, not excluded). */
export function useWakeNights(model) {
  const excluded = useStore((s) => s.excludedNights)
  return useMemo(() => {
    const out = new Map()
    for (const n of model.nightBy.values()) {
      if (n.fallback || !n.hasStages || excluded?.[n.date]) continue
      // overnight heart rate is stored as [minutes from the night's start, bpm]
      const hr = (n.overnight?.hr || []).map(([m, v]) => [n.start + m * 60000, v])
      out.set(n.date, { night: n, details: wakeDetails(n.segments, hr), hr })
    }
    return out
  }, [model, excluded])
}

function SmallTitle({ children }) {
  return <p className="text-[15px] font-semibold">{children}</p>
}

/** Wake-ups by clock hour, 9 pm to 7 am. */
function HourBars({ bins }) {
  const max = Math.max(1, ...bins.map((b) => b.count))
  return (
    <div>
      <div className="mt-3 flex items-end gap-1" style={{ height: 84 }} data-testid="wake-hours">
        {bins.map((b) => (
          <div key={b.hour} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${b.count} at ${b.label}`}>
            <span className="text-[10px] font-semibold tabular-nums" style={muted}>{b.count || ''}</span>
            <span className="w-full rounded-t-[4px]" style={{ height: `${Math.max(2, (b.count / max) * 56)}px`, background: b.count ? 'var(--series-sleep)' : 'var(--surface-sunk)' }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {bins.map((b, i) => <span key={b.hour} className="min-w-0 flex-1 text-center text-[10px] font-semibold" style={muted}>{i % 2 === 0 ? b.label : ''}</span>)}
      </div>
      <p className="mt-1 text-[11px] font-medium" style={muted}>Wake-ups per clock hour</p>
    </div>
  )
}

/** One stacked bar of the stage before each wake-up, with your usual share of sleep marked. */
function StageBar({ r }) {
  let accU = 0
  return (
    <div className="mt-3" data-testid="wake-stage">
      <div className="relative flex h-4 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunk)' }}>
        {['rem', 'core', 'deep'].map((k) => {
          return <span key={k} style={{ width: `${r.wake[k] * 100}%`, background: STAGE_FILL[k] }} />
        })}
      </div>
      <div className="relative h-2">
        {['rem', 'core'].map((k) => {
          accU += r.usual[k] * 100
          return <span key={k} className="absolute top-0 h-2 w-[2px]" style={{ left: `${accU}%`, background: 'var(--text-3)' }} data-testid="wake-stage-usual" />
        })}
      </div>
      <div className="mt-1 flex gap-3">
        {['rem', 'core', 'deep'].map((k) => (
          <span key={k} className="flex items-center gap-1 text-[12px] font-semibold tabular-nums" style={soft}>
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: STAGE_FILL[k] }} />{STAGE_WORD[k]} {Math.round(r.wake[k] * 100)}%
            <span style={muted}>(usual {Math.round(r.usual[k] * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Average heart rate from 10 minutes before to 10 after waking, the wake moment marked. */
function HrCurve({ points }) {
  const vals = points.map((p) => p.bpm).filter((v) => v != null)
  if (vals.length < 3) return null
  const lo = Math.floor(Math.min(...vals) - 1)
  const hi = Math.ceil(Math.max(...vals) + 1)
  const W = 300
  const H = 110
  const L = 30
  const B = 20
  const x = (m) => L + ((m + 10) / 20) * (W - L - 6)
  const y = (v) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - B - 6)
  const path = points.filter((p) => p.bpm != null).map((p, i) => `${i ? 'L' : 'M'}${x(p.min).toFixed(1)},${y(p.bpm).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Average heart rate around waking" data-testid="wake-hr-curve">
      <line x1={x(0)} x2={x(0)} y1={4} y2={H - B} stroke="var(--text-3)" strokeDasharray="3 3" />
      <text x={x(0)} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--text-3)">wake</text>
      <text x={x(-10)} y={H - 4} textAnchor="start" fontSize="10" fill="var(--text-3)">−10 min</text>
      <text x={x(10)} y={H - 4} textAnchor="end" fontSize="10" fill="var(--text-3)">+10 min</text>
      <text x={2} y={y(hi) + 4} fontSize="10" fill="var(--text-3)">{hi}</text>
      <text x={2} y={y(lo)} fontSize="10" fill="var(--text-3)">{lo}</text>
      <text x={2} y={H - B + 12} fontSize="9" fill="var(--text-3)">bpm</text>
      <path d={path} fill="none" stroke="var(--series-hr, var(--series-sleep))" strokeWidth="2" />
    </svg>
  )
}

/**
 * Sleep › Last night: the night's wake-ups, then when you wake, which stage
 * you wake from, heart rate around waking and the time back to sleep, for the
 * last 30 or 90 nights or one compound's dose period.
 */
export default function WakeCard({ model, heart, date }) {
  const nights = useWakeNights(model)
  const reasons = useStore((s) => s.wakeReasons)
  const [scope, setScope] = useState('30')
  const tonight = nights.get(date)
  const scopes = useMemo(() => [
    { id: '30', label: '30 nights' },
    { id: '90', label: '90 nights' },
    ...(heart?.periods || []).map((p) => ({ id: `p:${p.key}`, label: p.label, ranges: p.ranges })),
  ], [heart])
  const chosen = scopes.find((s) => s.id === scope) || scopes[0]
  const inScope = useMemo(() => {
    const list = []
    for (const [d, v] of nights) {
      const ok = chosen.ranges ? chosen.ranges.some(([a, b]) => d >= a && d <= b) : d > addDays(date, -Number(chosen.id)) && d <= date
      if (ok) list.push(v)
    }
    return list
  }, [nights, chosen, date])
  const ref = useMemo(() => {
    const r = heart?.reference
    return r ? [...nights].filter(([d]) => d >= r.from && d <= r.to).flatMap(([, v]) => v.details) : []
  }, [nights, heart])
  const all = inScope.flatMap((v) => v.details)
  const hours = byHour(all, tz)
  const usual = inScope.reduce((u, v) => ({ rem: u.rem + (v.night.remMin || 0), core: u.core + (v.night.coreMin || 0), deep: u.deep + (v.night.deepMin || 0) }), { rem: 0, core: 0, deep: 0 })
  const stages = stageShare(all, usual)
  const curve = hrCurve(inScope)
  const back = backToSleep(all, ref)
  const why = reasonCounts(reasons, chosen.ranges || [[addDays(date, -Number(chosen.id) + 1), date]])
  const tagged = reasons?.[date]
  const clock = (ms) => clock12(ms, tz)
  if (!tonight && !all.length) return null
  return (
    <section className="space-y-2" data-testid="wake-card">
      <div className="flex items-center gap-2 px-1">
        <AlarmClock size={18} style={soft} aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold">Wake-ups</h2>
        <InfoButton title="Wake-ups"><p>A wake-up is an awake stretch of 2 minutes or more after falling asleep and before the final wake. The same rule is used everywhere in the app.</p><p>{WAKE_ACCURACY}</p></InfoButton>
      </div>
      <div className="card p-4">
        {tonight ? (
          tonight.details.length ? (
            <ul className="space-y-1.5" data-testid="wake-list">
              {tonight.details.map((d) => <li key={d.at} className="text-[15px] font-medium tabular-nums" data-testid="wake-row">{wakeLine(d, clock)}</li>)}
            </ul>
          ) : <p className="text-[15px] font-medium" data-testid="wake-none">No wake-ups of 2 minutes or more.</p>
        ) : <p className="text-sm font-medium" style={soft}>No stages for this night, so wake-ups are not counted.</p>}
        {tagged && !tagged.skipped && tagged.tags.length > 0 && <p className="mt-2 text-[13px] font-medium" style={soft} data-testid="wake-reasons">Why you woke: {tagged.tags.join(', ')}</p>}
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Which nights">
        {scopes.map((s) => (
          <button key={s.id} onClick={() => setScope(s.id)} aria-pressed={s.id === chosen.id} data-testid={`wake-scope-${s.id}`}
            className="min-h-[32px] shrink-0 rounded-full px-3 text-xs font-bold"
            style={s.id === chosen.id ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)' }}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="px-1 text-[13px] font-medium tabular-nums" style={muted}>{all.length} wake-ups over {inScope.length} nights{chosen.ranges ? ` on ${chosen.label}` : ''}</p>

      <div className="card p-4" data-testid="wake-when">
        <SmallTitle>When do I wake?</SmallTitle>
        <AnswerLine className="mt-1" testid="wake-when-answer">{hours.answer}</AnswerLine>
        <HourBars bins={hours.bins} />
      </div>
      <div className="card p-4" data-testid="wake-stages">
        <SmallTitle>What stage do I wake from?</SmallTitle>
        <AnswerLine className="mt-1" testid="wake-stage-answer">{stages.answer}</AnswerLine>
        {stages.n > 0 && <StageBar r={stages} />}
      </div>
      <div className="card p-4" data-testid="wake-hr">
        <SmallTitle>What does my heart rate do around waking?</SmallTitle>
        <AnswerLine className="mt-1" testid="wake-hr-answer">{curve.answer}</AnswerLine>
        <HrCurve points={curve.points} />
      </div>
      <div className="card p-4" data-testid="wake-back">
        <SmallTitle>How quickly do I get back to sleep?</SmallTitle>
        <AnswerLine className="mt-1" testid="wake-back-answer">{back.answer}</AnswerLine>
      </div>
      {why.tagged > 0 && (
        <div className="card p-4" data-testid="wake-why">
          <SmallTitle>Why I woke</SmallTitle>
          <ul className="mt-1 space-y-1">
            {why.counts.slice(0, 5).map((c) => (
              <li key={c.tag} className="text-[15px] font-medium tabular-nums">{c.tag} on {c.count} of {why.tagged} tagged nights{chosen.ranges ? ` on ${chosen.label}` : ''}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
