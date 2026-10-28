import { useMemo, useState } from 'react'
import { format, parseISO, startOfMonth, endOfMonth, addMonths, getDay } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { hypnogramRows, clockOf, durationWords, scoreBand } from '../../health/engine/sleepView'
import { hhmm, parseHhmm } from '../../health/engine/planner'
import { HEALTH_BANDS } from './bands'

const SLEEP = 'var(--series-sleep)'
export const W = 340
const MIN = 60000

// one hue, deeper stages stronger
export const STAGE_OPACITY = { deep: 1, core: 0.62, asleep: 0.62, rem: 0.4, awake: 0.18 }
export const STAGE_LABEL = { awake: 'Awake', rem: 'REM', core: 'Core', deep: 'Deep', asleep: 'Asleep' }

/** Hour ticks across a night: every hour for a short one, every two otherwise. */
function hourTicks(start, end, tz) {
  const out = []
  const first = start + (60 - ((tz.hourOf(start) * 60) % 60)) * MIN
  const step = end - start > 6 * 3600000 ? 2 : 1
  for (let t = first; t <= end; t += 3600000) {
    const h = Math.round(tz.hourOf(t))
    if (h % step === 0) out.push({ t, label: hhmm(h * 60) })
  }
  return out
}

/**
 * The night stage by stage: Awake at the top, Deep at the bottom, a stepped
 * line through them and the clock along the bottom. Tapping a stretch says
 * what it was and how long.
 */
export function Hypnogram({ night, tz }) {
  const [picked, setPicked] = useState(null)
  const reduce = useReducedMotion()
  const { rows, steps } = useMemo(() => hypnogramRows(night), [night])
  if (!steps.length) {
    return <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }} data-testid="hypnogram-empty">Stage detail arrives with the next sync.</p>
  }
  const L = 54
  const R = 8
  const rowH = 30
  const top = 4
  const H = top + rows.length * rowH + 22
  const x = (t) => L + ((t - night.start) / (night.end - night.start || 1)) * (W - L - R)
  const y = (row) => top + rows.indexOf(row) * rowH + rowH / 2
  let path = ''
  steps.forEach((s, i) => {
    path += `${i ? 'L' : 'M'}${x(s.start).toFixed(1)},${y(s.row).toFixed(1)} H${x(s.end).toFixed(1)} `
  })
  const sel = picked != null ? steps[picked] : null
  const clock = (ms) => hhmm(tz.hourOf(ms) * 60)
  return (
    <div data-testid="hypnogram">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Sleep stages through the night">
        {rows.map((r) => (
          <g key={r}>
            <line x1={L} x2={W - R} y1={y(r)} y2={y(r)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 6} y={y(r) + 3} fontSize="12.5" fontWeight="700" textAnchor="end" fill="var(--text-3)">{STAGE_LABEL[r]}</text>
          </g>
        ))}
        {steps.map((s, i) => (
          <rect key={s.start} x={x(s.start)} y={y(s.row) - rowH / 2 + 3} width={Math.max(1, x(s.end) - x(s.start))} height={rowH - 6} rx="3"
            fill={SLEEP} opacity={picked === i ? Math.min(1, STAGE_OPACITY[s.row] + 0.25) : STAGE_OPACITY[s.row]}
            onClick={() => setPicked(picked === i ? null : i)} style={{ cursor: 'pointer' }} data-testid={`hypno-seg-${s.row}`} />
        ))}
        <motion.path d={path} fill="none" stroke="var(--text-2)" strokeWidth="1.2" strokeLinejoin="round" pointerEvents="none"
          initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduce ? 0 : 0.6, ease: 'easeOut' }} />
        {hourTicks(night.start, night.end, tz).map((tk) => (
          <text key={tk.t} x={x(tk.t)} y={H - 4} fontSize="12.5" fontWeight="600" textAnchor="middle" fill="var(--text-3)" className="tabular-nums">{tk.label}</text>
        ))}
      </svg>
      <p className="mt-1 min-h-[18px] text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="hypno-detail">
        {sel ? `${STAGE_LABEL[sel.row]} · ${clock(sel.start)} to ${clock(sel.end)} · ${durationWords((sel.end - sel.start) / MIN)}` : 'Tap a stretch for its times.'}
      </p>
    </div>
  )
}

/**
 * Bed to wake for each night as a floating bar, oldest on the left, with the
 * planner's target bedtime as a faint band.
 */
export function Chronogram({ rows, target, bandMin }) {
  if (!rows.length) return <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>No nights in this range yet.</p>
  const L = 50
  const R = 6
  const H = 236
  const top = 22
  const bottom = 22
  const tgt = target != null ? ((parseHhmm(target) ?? 0) - 720 + 1440) % 1440 : null
  const lo = Math.floor((Math.min(...rows.map((r) => r.bed), tgt != null ? tgt - bandMin : Infinity)) / 60) * 60
  const hi = Math.ceil(Math.max(...rows.map((r) => r.wake)) / 60) * 60
  const y = (m) => top + ((m - lo) / (hi - lo || 1)) * (H - top - bottom)
  const bw = (W - L - R) / rows.length
  const ticks = []
  for (let m = lo; m <= hi; m += 120) ticks.push(m)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bed and wake times by night" data-testid="chronogram">
      {ticks.map((m) => (
        <g key={m}>
          <line x1={L} x2={W - R} y1={y(m)} y2={y(m)} stroke="var(--border)" strokeWidth="1" />
          <text x={L - 5} y={y(m) + 3} fontSize="12.5" fontWeight="600" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{clockOf(m)}</text>
        </g>
      ))}
      {tgt != null && (
        <g data-testid="chrono-target">
          <rect x={L} width={W - L - R} y={y(tgt - bandMin)} height={Math.max(1, y(tgt + bandMin) - y(tgt - bandMin))} fill="var(--text)" opacity="0.07" />
          <text x={W - R - 2} y={y(tgt - bandMin) - 3} fontSize="11.5" fontWeight="700" textAnchor="end" fill="var(--text-3)">Target bedtime</text>
        </g>
      )}
      <text x={2} y={12} fontSize="11.5" fontWeight="700" fill="var(--text-3)" data-testid="axis-unit">time</text>
      {rows.map((r, i) => (
        <rect key={r.date} x={L + i * bw + bw * 0.2} width={Math.max(2, bw * 0.6)} y={y(r.bed)} height={Math.max(2, y(r.wake) - y(r.bed))} rx={Math.min(3, bw * 0.3)}
          fill={SLEEP} opacity="0.75" data-testid="chrono-bar" />
      ))}
      <text x={L} y={H - 4} fontSize="12.5" fontWeight="600" fill="var(--text-3)">{format(parseISO(rows[0].date), 'd MMM')}</text>
      <text x={W - R} y={H - 4} fontSize="12.5" fontWeight="600" textAnchor="end" fill="var(--text-3)">{format(parseISO(rows[rows.length - 1].date), 'd MMM')}</text>
    </svg>
  )
}

/** Seven nights against need: the dashed line is need, a missing night has no bar. */
export function DebtBars({ nights, needH }) {
  const H = 180
  const L = 34
  const maxH = Math.max(needH, ...nights.map((n) => n.asleepH || 0)) + 0.5
  const bw = (W - L) / nights.length
  const y = (h) => H - 20 - (h / maxH) * (H - 34)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Hours asleep over the last 7 nights against your need" data-testid="debt-bars">
      {nights.map((n, i) => (
        <g key={n.date}>
          {n.asleepH != null && (
            <rect x={L + i * bw + bw * 0.22} width={bw * 0.56} y={y(n.asleepH)} height={H - 20 - y(n.asleepH)} rx="3" fill={SLEEP} opacity={n.shortH > 0 ? 0.45 : 0.8} data-testid="debt-bar" />
          )}
          <text x={L + i * bw + bw / 2} y={H - 3} fontSize="12.5" fontWeight="600" textAnchor="middle" fill="var(--text-3)">{format(parseISO(n.date), 'EEEEE')}</text>
        </g>
      ))}
      <text x={2} y={12} fontSize="11.5" fontWeight="700" fill="var(--text-3)" data-testid="axis-unit">hours</text>
      {nights.map((n, i) => n.asleepH != null && (
        <text key={`v${n.date}`} x={L + i * bw + bw / 2} y={y(n.asleepH) - 4} fontSize="11.5" fontWeight="700" textAnchor="middle" fill="var(--text-2)" className="tabular-nums">{n.asleepH.toFixed(1)}</text>
      ))}
      <line x1={L} x2={W} y1={y(needH)} y2={y(needH)} stroke="var(--text-2)" strokeDasharray="3 3" />
      <text x={L - 4} y={y(needH) + 3} fontSize="12.5" fontWeight="700" textAnchor="end" fill="var(--text-2)">{needH} h</text>
    </svg>
  )
}

/** A month of nights, each with a dot in its score band; tap one to show it. */
export function NightCalendar({ selected, scoreOf, hasNight, onPick, today }) {
  const [month, setMonth] = useState(() => startOfMonth(parseISO(selected)))
  const first = startOfMonth(month)
  const last = endOfMonth(month)
  const lead = (getDay(first) + 6) % 7 // Monday first
  const days = []
  for (let d = 1; d <= last.getDate(); d++) days.push(format(new Date(first.getFullYear(), first.getMonth(), d), 'yyyy-MM-dd'))
  const canNext = format(addMonths(month, 1), 'yyyy-MM') <= today.slice(0, 7)
  return (
    <div data-testid="sleep-calendar">
      <div className="flex items-center gap-2">
        <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}><ChevronLeft size={16} /></button>
        <p className="flex-1 text-center text-sm font-black">{format(month, 'MMMM yyyy')}</p>
        <button onClick={() => canNext && setMonth(addMonths(month, 1))} disabled={!canNext} aria-label="Next month" className="rounded-full p-2 disabled:opacity-30" style={{ background: 'var(--surface-sunk)' }}><ChevronRight size={16} /></button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <p key={i} className="text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>{d}</p>)}
        {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
        {days.map((d) => {
          const has = hasNight(d)
          const band = has ? scoreBand(scoreOf(d)) : null
          const on = d === selected
          return (
            <button key={d} disabled={!has} onClick={() => onPick(d)} data-testid={`cal-night-${d}`}
              className="flex h-11 flex-col items-center justify-center rounded-[10px] text-sm font-bold tabular-nums disabled:opacity-30"
              style={{ background: on ? 'var(--surface2)' : 'transparent', color: 'var(--text)', border: on ? '1px solid var(--border)' : '1px solid transparent' }}>
              {Number(d.slice(8))}
              <span className="mt-0.5 h-1.5 w-1.5 rounded-full" style={{ background: band ? HEALTH_BANDS[band].tone : 'transparent' }} />
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex justify-center gap-3 text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>
        {['high', 'moderate', 'low'].map((b) => (
          <span key={b} className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: HEALTH_BANDS[b].tone }} />{HEALTH_BANDS[b].label}</span>
        ))}
      </div>
    </div>
  )
}
