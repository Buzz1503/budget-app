import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronRight } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import {
  coolDownDrop, coolDownTrend, patterns, longerTerm, fit, ratingRows, fluidEstimate,
} from '../../sauna/analytics'
import { SAUNA_CAVEAT, recoveryStat, aroundAnswer } from '../../sauna/saunaEffects'
import { beforeVsSince, compoundCaveat, withinSauna, beforeSinceDots, beforeSinceAnswer, recoveryAround } from '../../sauna/insights'
import { TONE_COLOR } from '../../lib/glance'
import { AnswerLine, DeltaChip, InfoButton, ProgressRow, StatRow, StatusDot, StatusLegend } from '../ui/Glance'
import { ChartLegend } from '../charts/TrendChart'
import useChartEvents from '../charts/useChartEvents'
import { useSaunaHealth } from './saunaHealthContext'
import SessionDetail from './SessionDetail'

const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }
const newestFirst = (a, b) => (b.date + b.start).localeCompare(a.date + a.start)

/** A locked section: one plain progress line, nothing else. */
function Locked({ text, testid }) {
  return <p className="text-sm font-medium" style={soft} data-testid={testid} data-locked="true">{text}</p>
}

const SAUNA_COLOR = 'var(--series-sauna)'

/**
 * Values in order with a least-squares trend line, first and last date under
 * it. The y axis comes from the data, padded so a flat run is not a cliff.
 */
export function DotTrend({ points, unit, label, testid, better = null }) {
  const W = 320
  const H = 170
  const L = 36
  const R = 8
  const T = 24
  const B = 24
  const ys = points.map((p) => p.value)
  const pad = Math.max(2, (Math.max(...ys) - Math.min(...ys)) * 0.15)
  const lo = Math.floor(Math.min(...ys) - pad)
  const hi = Math.ceil(Math.max(...ys) + pad)
  const n = points.length
  const x = (i) => L + (n === 1 ? 0.5 : i / (n - 1)) * (W - L - R)
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const f = fit(points.map((_, i) => i), ys)
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label} data-testid={testid}>
        <text x={2} y={12} fontSize="11.5" fontWeight="700" fill="var(--text-3)" data-testid="axis-unit">{unit}</text>
        {better && <text x={W - R} y={12} fontSize="11.5" fontWeight="700" textAnchor="end" fill="var(--text-3)">{better === 'up' ? '↑ better' : '↓ better'}</text>}
        <text x={L - 6} y={y(hi) + 4} fontSize="12" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{hi}</text>
        <text x={L - 6} y={y(lo) + 4} fontSize="12" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{lo}</text>
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--border)" />
        {f && <line x1={x(0)} x2={x(n - 1)} y1={y(f.intercept)} y2={y(f.intercept + f.slope * (n - 1))} stroke="var(--text-2)" strokeWidth="1.5" strokeDasharray="4 3" data-testid="trend-line" />}
        {points.map((p, i) => <circle key={`${p.date}-${i}`} cx={x(i)} cy={y(p.value)} r="4" fill={SAUNA_COLOR}><title>{`${format(parseISO(p.date), 'd MMM')}: ${Math.round(p.value)} ${unit}`}</title></circle>)}
        <text x={L} y={H - 6} fontSize="12" fill="var(--text-3)">{format(parseISO(points[0].date), 'd MMM')}</text>
        <text x={W - R} y={H - 6} fontSize="12" textAnchor="end" fill="var(--text-3)">{format(parseISO(points[n - 1].date), 'd MMM')}</text>
      </svg>
      <ChartLegend items={[{ key: 's', label: 'Session', kind: 'dot', color: SAUNA_COLOR }, ...(f ? [{ key: 't', label: 'trend', kind: 'trend', color: 'var(--text-2)' }] : [])]} />
    </>
  )
}

/** 2. The last session, with its detail; tap for the full sheet. */
export function LastSessionCard({ onOpen }) {
  const sessions = useStore((s) => s.saunaSessions)
  const last = useMemo(() => [...sessions].sort(newestFirst)[0], [sessions])
  if (!last) return <p className="px-1 text-sm font-medium" style={soft} data-testid="sauna-last-empty">Your last session shows here once you log one.</p>
  return (
    <section className="card p-4" data-testid="sauna-last-card">
      <button onClick={() => onOpen(last.id)} className="mb-2 flex w-full items-center gap-2 text-left" data-testid="sauna-last-open">
        <span className="flex-1" />
        <span className="text-xs font-bold" style={soft}>Details</span>
        <ChevronRight size={14} style={muted} />
      </button>
      <SessionDetail session={last} />
    </section>
  )
}

/** Cool-down recovery: one stat row for the last drop, then the trend once there are 5. */
export function CoolDownCard() {
  const sessions = useStore((s) => s.saunaSessions)
  const coolDownOn = useStore((s) => s.watchSettings?.coolDown !== false)
  const r = useMemo(() => {
    const drops = sessions.map((s) => ({ s, d: coolDownDrop(s.coolDown) })).filter((x) => x.d)
    const latest = drops.sort((a, b) => newestFirst(a.s, b.s))[0] || null
    return { latest, trend: coolDownTrend(drops.map((x) => ({ date: x.s.date, drop2: x.d.drop2 }))) }
  }, [sessions])
  return (
    <section className="card px-4 py-2" data-testid="sauna-cool-down-card">
      {r.latest ? (
        <div data-testid="sauna-cool-down-latest">
          <StatRow label={r.latest.d.drop2 != null ? 'Heart rate dropped, 2 min after' : 'No reading at 2 min'} value={r.latest.d.drop2 ?? undefined} unit={r.latest.d.drop2 != null ? 'bpm' : undefined}
            sub={r.latest.d.drop5 != null ? `${r.latest.d.drop5} bpm after 5 min` : null} />
        </div>
      ) : (
        <p className="py-2 text-sm font-medium" style={soft} data-testid="sauna-cool-down-none">
          {coolDownOn
            ? 'After Stop on Apple Watch, Cool down keeps reading your heart rate for 5 minutes. The drop shows here.'
            : 'Cool down is off in More › Apple Watch.'}
        </p>
      )}
      {r.trend.locked
        ? (r.latest ? <ProgressRow testid="sauna-cool-down-locked" text={`Trend unlocks with more cool-downs · ${Math.min(r.trend.have, 5)} of 5`} have={r.trend.have} need={5} /> : null)
        : (
          <div className="pb-2">
            <p className="text-[15px] font-semibold" data-testid="sauna-cool-down-trend">{r.trend.text}</p>
            <DotTrend points={r.trend.points} unit="bpm" better="up" label="Heart rate drop 2 minutes after leaving, per session" testid="sauna-cool-down-chart" />
          </div>
        )}
    </section>
  )
}

const PATTERN_METRIC = { sleepScore: 'sleepScore', deepSleep: 'deepSleep', sleepingHR: 'sleepingHR', hrv: 'hrv', rhr: 'rhr', restlessness: 'restlessness' }

function PatternRows({ title, rows, group }) {
  if (!rows.length) return null
  return (
    <div data-testid={`sauna-patterns-${group}`}>
      <p className="mt-3 text-sm font-semibold" style={soft}>{title}</p>
      <div className="rows">
        {rows.map((r) => (
          <div key={r.key} data-testid="sauna-pattern-row" data-metric={r.key}>
            <StatRow label={r.name} status={r.label} sub={`${r.nWith} and ${r.nWithout} days`}
              metric={PATTERN_METRIC[r.key]} delta={r.diff} deltaUnit={r.unit} deltaDp={r.dp} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The patterns card for any PatternInput: also used in Body › Effects. */
export function PatternsView({ input }) {
  const r = useMemo(() => patterns(input), [input])
  return (
    <section className="card px-4 pb-2 pt-4" data-testid="sauna-patterns">
      {r.progress ? <div className="pb-2"><Locked text={r.progress} testid="sauna-patterns-locked" /></div> : (
        <>
          <PatternRows title="Sauna nights against nights without" rows={r.nights} group="nights" />
          <PatternRows title="Ending within 3 h of bed against earlier" rows={r.timing} group="timing" />
          <div className="flex items-center gap-1 pb-1 pt-1">
            <span className="text-[13px] font-medium" style={muted}>Higher or lower on days with, not because of</span>
            <InfoButton title="Sauna days against days without"><p data-testid="sauna-caveat">Higher or lower on days with, not because of. {SAUNA_CAVEAT}</p><StatusLegend /></InfoButton>
          </div>
        </>
      )}
    </section>
  )
}

/** How it felt and lightheaded, by length, temperature and fluid band; from 5 rated sessions. */
function RatingRows() {
  const sessions = useStore((s) => s.saunaSessions)
  const ctx = useSaunaHealth()
  const r = useMemo(() => ratingRows(sessions, (x) => fluidEstimate(x, ctx.h ? ctx.h.weighIns : null, ctx.toMs)?.litres ?? null), [sessions, ctx])
  const groups = [['length', 'By length'], ['temp', 'By temperature'], ['fluid', 'By fluid loss']]
  return (
    <section className="card px-4 py-3" data-testid="sauna-rating-rows">
      <p className="t-label">How it felt</p>
      {r.progress ? <Locked text={r.progress} testid="sauna-rating-locked" /> : groups.map(([g, title]) => {
        const rows = r.rows.filter((x) => x.group === g)
        if (!rows.length) return null
        return (
          <div key={g} className="mt-2">
            <p className="t-caption" style={muted}>{title}</p>
            {rows.map((x) => <p key={x.band} className="text-sm font-medium tabular-nums" style={soft} data-testid="sauna-rating-row">{x.text}</p>)}
          </div>
        )
      })}
    </section>
  )
}

const SHORT_NAME = { 'Resting heart rate': 'Resting HR', 'Sleeping heart rate': 'Sleeping HR' }

/** One before-and-after row: grey dot the 4 weeks before, coloured dot since, an arrow between, values at the ends. */
function DotRow({ d }) {
  const lo = Math.min(d.before, d.since)
  const hi = Math.max(d.before, d.since)
  const span = hi - lo
  // positions in % of the track; the values sit outside the two dots
  const pos = (v) => (span === 0 ? 50 : 28 + ((v - lo) / span) * 44)
  const bp = pos(d.before)
  const sp = pos(d.since)
  const color = d.tone === 'same' ? 'var(--text-2)' : TONE_COLOR[d.tone]
  const f = (v) => (d.dp ? v.toFixed(d.dp) : String(Math.round(v)))
  const right = sp >= bp
  const left = Math.min(bp, sp)
  return (
    <div className="flex items-center gap-2 py-2.5" data-testid="sauna-before-row" data-metric={d.key} data-tone={d.tone}
      aria-label={`${d.name}: ${f(d.before)} before, ${f(d.since)} since`}>
      <span className="w-[92px] shrink-0 truncate text-[15px] font-medium">{SHORT_NAME[d.name] || d.name}</span>
      <span className="relative h-7 min-w-0 flex-1" aria-hidden="true">
        <span className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded" style={{ left: `${left}%`, width: `${Math.abs(sp - bp)}%`, background: color }} />
        <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${bp}%`, background: 'var(--text-3)' }} />
        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${sp}%`, background: color }} />
        {Math.abs(sp - bp) > 6 && (
          <span className="absolute top-1/2 -translate-y-1/2 text-[11px] font-black leading-none" style={{ left: `calc(${sp}% ${right ? '- 14px' : '+ 6px'})`, color }}>{right ? '▸' : '◂'}</span>
        )}
        <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[13px] font-semibold tabular-nums"
          style={right ? { right: `calc(${100 - bp}% + 9px)`, color: 'var(--text-3)' } : { left: `calc(${bp}% + 9px)`, color: 'var(--text-3)' }}>{f(d.before)}</span>
        <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[13px] font-bold tabular-nums"
          style={right ? { left: `calc(${sp}% + 10px)`, color } : { right: `calc(${100 - sp}% + 10px)`, color }}>{f(d.since)}</span>
      </span>
      <span className="w-[76px] shrink-0 text-right"><StatusDot status={d.status} /></span>
    </div>
  )
}

/**
 * The hero: what has changed since you started sauna, against the 4 weeks before.
 * One dot row per measure, an answer line above, the compound overlap in one line under.
 */
export function BeforeAfterHero() {
  const ctx = useSaunaHealth()
  const sessions = useStore((s) => s.saunaSessions)
  const events = useChartEvents()
  const t = todayStr()
  const input = ctx?.patternInput
  const r = useMemo(() => (input ? beforeVsSince({ sessions, night: input.night, morning: input.morning, today: t, wobble: input.wobble }) : null), [sessions, input, t])
  const dots = useMemo(() => (r ? beforeSinceDots(r.rows, !!r.early) : []), [r])
  const caveat = useMemo(() => compoundCaveat(sessions, events), [sessions, events])
  if (!input) return null
  return (
    <section className="card px-4 pb-3 pt-4" data-testid="sauna-before-since">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[17px] font-semibold">What's changed since you started sauna</p>
        <InfoButton title="Since you started sauna">
          <p>Each row is the average since your first session against the 4 weeks before it. Grey is before, the coloured dot is since: green when it moved the better way for that measure, amber the other way.</p>
          <p>What went with starting sauna, not what it did. Anything else that changed since then is in both.</p>
          <StatusLegend />
        </InfoButton>
      </div>
      {r.status !== 'ok' ? <Locked text={r.text} testid="sauna-before-locked" /> : (
        <>
          <AnswerLine className="mt-1" testid="sauna-before-answer">{beforeSinceAnswer(dots)}</AnswerLine>
          {caveat && <p className="mt-1 text-sm font-medium" style={soft} data-testid="sauna-before-caveat">{caveat}</p>}
          <div className="rows mt-1">{dots.map((d) => <DotRow key={d.key} d={d} />)}</div>
          <ChartLegend items={[{ key: 'b', label: '4 weeks before', kind: 'dot', color: 'var(--text-3)' }, { key: 's', label: 'Since you started', kind: 'dot', color: 'var(--good)' }]} />
          {r.early && <p className="mt-1 text-[13px] font-medium tabular-nums" style={muted} data-testid="sauna-before-early">{r.early}</p>}
        </>
      )}
    </section>
  )
}

/** The last 8 weeks of morning HRV (or resting heart rate), sauna days as flames under the axis, the day it started. */
export function RecoveryAroundCard() {
  const ctx = useSaunaHealth()
  const sessions = useStore((s) => s.saunaSessions)
  const [key, setKey] = useState('hrv')
  const t = todayStr()
  const input = ctx?.patternInput
  const r = useMemo(() => (input ? recoveryAround(sessions, input.morning, t, key) : null), [sessions, input, t, key])
  const stat = useMemo(() => (input ? recoveryStat(input, key) : null), [input, key])
  if (!r) return null
  const vals = r.points.filter((p) => p.value != null).map((p) => p.value)
  const W = 340
  const H = 236
  const L = 40
  const R = 8
  const T = 28
  const plotB = H - 58
  const lo = vals.length ? Math.floor(Math.min(...vals) - Math.max(1, (Math.max(...vals) - Math.min(...vals)) * 0.12)) : 0
  const hi = vals.length ? Math.ceil(Math.max(...vals) + Math.max(1, (Math.max(...vals) - Math.min(...vals)) * 0.12)) : 1
  const n = r.points.length
  const x = (i) => L + (i / Math.max(1, n - 1)) * (W - L - R)
  const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (plotB - T)
  const segs = []
  let cur = []
  r.points.forEach((p, i) => { if (p.value == null) { if (cur.length) segs.push(cur); cur = [] } else cur.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`) })
  if (cur.length) segs.push(cur)
  const startI = r.started ? r.points.findIndex((p) => p.date === r.started) : -1
  const unit = key === 'hrv' ? 'ms' : 'bpm'
  const mid = Math.floor(n / 2)
  return (
    <section className="card p-4" data-testid="sauna-around">
      <p className="text-[17px] font-semibold">Your recovery around sauna days</p>
      <p className="text-[15px] font-semibold tabular-nums" data-testid="sauna-around-answer">{aroundAnswer(stat, key)}</p>
      <div className="mt-2 flex gap-1.5" role="group" aria-label="Measure">
        {[['hrv', 'HRV'], ['rhr', 'Resting HR']].map(([k, l]) => (
          <button key={k} onClick={() => setKey(k)} aria-pressed={key === k} data-testid={`sauna-around-${k}`}
            className="min-h-[32px] rounded-full px-3 text-xs font-bold"
            style={key === k ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)', border: '1px solid transparent' }}>{l}</button>
        ))}
      </div>
      {vals.length < 2 ? <p className="mt-3 text-sm font-medium" style={soft}>No morning {key === 'hrv' ? 'HRV' : 'resting heart rate'} in the last 8 weeks.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`Morning ${key === 'hrv' ? 'HRV' : 'resting heart rate'} over 8 weeks with sauna days marked`} data-testid="sauna-around-chart">
          <text x={2} y={12} fontSize="11.5" fontWeight="700" fill="var(--text-3)" data-testid="axis-unit">{unit}</text>
          <text x={W - R} y={12} fontSize="11.5" fontWeight="700" textAnchor="end" fill="var(--text-3)">{key === 'hrv' ? '↑ better' : '↓ better'}</text>
          {[lo, Math.round((lo + hi) / 2), hi].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" />
              <text x={L - 5} y={y(v) + 4} fontSize="12" fontWeight="600" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{v}</text>
            </g>
          ))}
          {startI >= 0 && (
            <g data-testid="sauna-started-line">
              <line x1={x(startI)} x2={x(startI)} y1={T - 4} y2={plotB + 22} stroke="var(--text-2)" strokeDasharray="3 3" />
              <text x={Math.min(W - R, x(startI) + 4)} y={T + 8} fontSize="11.5" fontWeight="700" textAnchor={x(startI) > W - 110 ? 'end' : 'start'} fill="var(--text-2)">Started sauna</text>
            </g>
          )}
          {segs.map((sg, i) => (sg.length > 1
            ? <polyline key={i} points={sg.join(' ')} fill="none" stroke="var(--text)" strokeWidth="1.8" strokeLinejoin="round" />
            : <circle key={i} cx={sg[0].split(',')[0]} cy={sg[0].split(',')[1]} r="2.5" fill="var(--text)" />))}
          {r.points.map((p, i) => p.sauna && (
            <path key={p.date} d={`M${x(i)} ${plotB + 8} c3 4 4 8 0 12 c-4 -4 -3 -8 0 -12 z`} fill={SAUNA_COLOR} data-testid="sauna-flame"><title>{`Sauna, ${format(parseISO(p.date), 'd MMM')}`}</title></path>
          ))}
          <line x1={L} x2={W - R} y1={plotB} y2={plotB} stroke="var(--border)" />
          {[0, mid, n - 1].map((i, k) => (
            <text key={i} x={x(i)} y={H - 6} fontSize="12" fontWeight="600" textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'} fill="var(--text-3)">{format(parseISO(r.points[i].date), 'd MMM')}</text>
          ))}
        </svg>
      )}
      <ChartLegend items={[
        { key: 'l', label: key === 'hrv' ? 'Morning HRV' : 'Morning resting HR', kind: 'line', color: 'var(--text)' },
        { key: 'f', label: 'Sauna day', kind: 'flame', color: SAUNA_COLOR },
        ...(startI >= 0 ? [{ key: 's', label: 'Started sauna', kind: 'dashed', color: 'var(--text-2)' }] : []),
      ]} />
      {stat && <p className="mt-1 text-[13px] font-medium tabular-nums" style={muted}>{stat.withN} mornings after sauna, {stat.withoutN} without</p>}
    </section>
  )
}

const WITHIN_METRIC = { sleepScore: 'sleepScore', hrv: 'hrv', rhr: 'rhr' }

/** Two bars for one comparison inside sauna days, n under each. */
function TwoBars({ row, groups }) {
  const max = Math.max(row.a, row.b) || 1
  const f = (v) => Math.round(v)
  const tone = row.diff === 0 ? 'same' : null
  return (
    <div className="py-2.5" data-testid="sauna-within-row">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-medium">{row.name}</p>
        <StatusDot label={row.label} />
        <DeltaChip metric={WITHIN_METRIC[row.key]} delta={row.diff} unit={row.unit} tone={tone || undefined} />
      </div>
      {[[groups[0], row.a, row.nA, true], [groups[1], row.b, row.nB, false]].map(([g, v, nn, first]) => (
        <div key={g} className="mt-1.5 flex items-center gap-2">
          <span className="w-16 shrink-0 text-[13px] font-medium" style={soft}>{g}</span>
          <span className="min-w-0 flex-1">
            <span className="block h-3 rounded-full" style={{ width: `${Math.max(4, (v / max) * 100)}%`, background: first ? SAUNA_COLOR : 'var(--text-3)', opacity: first ? 1 : 0.6 }} />
          </span>
          <span className="w-[68px] shrink-0 whitespace-nowrap text-right text-[13px] font-semibold tabular-nums">{f(v)}{row.unit ? <span className="ml-0.5 font-medium" style={muted}>{row.unit}</span> : null}</span>
          <span className="w-10 shrink-0 whitespace-nowrap text-right text-[13px] font-medium tabular-nums" style={muted}>n {nn}</span>
        </div>
      ))}
    </div>
  )
}

/** Inside sauna days: one progress row until any comparison unlocks, then two bars each. */
function WithinSaunaCard({ input }) {
  const sessions = useStore((s) => s.saunaSessions)
  const splits = useMemo(() => withinSauna(sessions, input), [sessions, input])
  const open = splits.filter((sp) => !sp.locked)
  const locked = splits.filter((sp) => sp.locked)
  const have = Math.max(0, ...locked.map((sp) => sp.have))
  const need = locked[0]?.need ?? 5
  return (
    <section className="card px-4 pb-2 pt-4" data-testid="sauna-within">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[17px] font-semibold">Inside sauna days</p>
        <InfoButton title="Inside sauna days">
          <p>No days off needed: your sessions compared with each other, against that night's sleep and the next morning.</p>
          {locked.map((sp) => <p key={sp.key} data-testid={`sauna-within-${sp.key}-locked`}>{sp.title}: {sp.locked}</p>)}
          <StatusLegend />
        </InfoButton>
      </div>
      {open.map((sp) => (
        <div key={sp.key} className="mt-2" data-testid={`sauna-within-${sp.key}`}>
          <p className="text-sm font-semibold" style={soft}>{sp.title}</p>
          <div className="rows">{sp.rows.map((x) => <TwoBars key={x.key} row={x} groups={sp.groups} />)}</div>
        </div>
      ))}
      {locked.length > 0 && (
        <ProgressRow testid="sauna-within-progress"
          text={`${locked.length} ${locked.length === 1 ? 'comparison unlocks' : 'comparisons unlock'} with more sessions · ${Math.min(have, need)} of ${need}`}
          have={have} need={need} />
      )}
    </section>
  )
}

/** 6. Patterns, from Health: since you started, inside sauna days, then sauna days against days off; then how it felt. */
export function PatternsCard() {
  const ctx = useSaunaHealth()
  if (!ctx?.patternInput) {
    return (
      <div className="space-y-2">
        <p className="px-1 text-sm font-medium" style={soft} data-testid="sauna-patterns-connect">Connect Apple Health in More › Health to compare your nights and mornings.</p>
        <RatingRows />
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <WithinSaunaCard input={ctx.patternInput} />
      <p className="px-1 pt-2 text-[15px] font-semibold">Sauna days against days without</p>
      <PatternsView input={ctx.patternInput} />
      <RatingRows />
    </div>
  )
}

/** Weekly bars, then resting heart rate and HRV week by week on the same time axis. */
function WeeksChart({ weeks, axisMax, hasBP = false }) {
  const W = 300
  const L = 40
  const R = 8
  const n = weeks.length
  const cw = (W - L - R) / n
  const cx = (i) => L + cw * i + cw / 2
  const bars = 70
  const line = 52
  const row = (key, top, label, colour) => {
    const vals = weeks.map((w) => w[key]).filter((v) => v != null)
    if (vals.length < 2) return null
    const lo = Math.floor(Math.min(...vals) - 1)
    const hi = Math.ceil(Math.max(...vals) + 1)
    const y = (v) => top + 4 + (1 - (v - lo) / (hi - lo)) * (line - 8)
    const segs = []
    let cur = []
    weeks.forEach((w, i) => { if (w[key] == null) { if (cur.length) segs.push(cur); cur = [] } else cur.push(`${cx(i).toFixed(1)},${y(w[key]).toFixed(1)}`) })
    if (cur.length) segs.push(cur)
    return (
      <g data-testid={`sauna-weeks-${key}`}>
        <text x={0} y={top + 12} fontSize="12" fontWeight="700" fill="var(--text-3)">{label}</text>
        <text x={L - 4} y={top + 22} fontSize="12" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{hi}</text>
        <text x={L - 4} y={top + line - 2} fontSize="12" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{lo}</text>
        {segs.map((p, i) => (p.length > 1
          ? <polyline key={i} points={p.join(' ')} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" />
          : <circle key={i} cx={p[0].split(',')[0]} cy={p[0].split(',')[1]} r="2" fill={colour} />))}
      </g>
    )
  }
  const H = bars + (hasBP ? 4 : 2) * line + 24
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Sessions each week, with weekly resting heart rate and HRV${hasBP ? ', and blood pressure' : ''}`} data-testid="sauna-weeks-chart">
      <text x={L - 4} y={10} fontSize="12" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{axisMax}</text>
      <text x={L - 4} y={bars} fontSize="12" textAnchor="end" fill="var(--text-3)">0</text>
      {weeks.map((w, i) => {
        const h = (w.count / axisMax) * (bars - 6)
        return <rect key={w.week} x={cx(i) - cw * 0.35} y={bars - h} width={cw * 0.7} height={h} rx="2" fill="var(--series-sauna)" data-testid="sauna-week-bar" data-count={w.count}><title>{`Week of ${format(parseISO(w.week), 'd MMM')}: ${w.count}`}</title></rect>
      })}
      <line x1={L} x2={W - R} y1={bars} y2={bars} stroke="var(--border)" />
      {row('rhr', bars + 4, 'RHR', 'var(--series-weight)')}
      {row('hrv', bars + 4 + line, 'HRV', 'var(--series-sleep)')}
      {hasBP && row('sys', bars + 4 + 2 * line, 'SYS', 'var(--series-muscle)')}
      {hasBP && row('dia', bars + 4 + 3 * line, 'DIA', 'var(--series-lean)')}
      <text x={L} y={H - 4} fontSize="12" fill="var(--text-3)">{format(parseISO(weeks[0].week), 'd MMM')}</text>
      <text x={W - R} y={H - 4} fontSize="12" textAnchor="end" fill="var(--text-3)">This week</text>
    </svg>
  )
}

/** 7. Longer term: weeks from the first session on. */
export function LongerTermCard() {
  const sessions = useStore((s) => s.saunaSessions)
  const target = useStore((s) => s.saunaSettings.weeklyTarget)
  const ctx = useSaunaHealth()
  const t = todayStr()
  const r = useMemo(() => longerTerm({ sessions, morning: ctx.h ? ctx.h.morning : () => ({ hrv: null, rhr: null, readiness: null }) }, t, target), [sessions, ctx, t, target])
  return (
    <section className="card space-y-2 p-4" data-testid="sauna-longer-term">
      {r.locked ? <Locked text={r.text} testid="sauna-longer-locked" /> : (
        <>
          <p className="text-[17px] font-semibold">How do my weeks compare?</p>
          {r.lines[0] && <p className="text-[15px] font-semibold" data-testid="sauna-longer-answer">{r.lines[0]}</p>}
          <WeeksChart weeks={r.weeks} axisMax={r.axisMax} hasBP={r.hasBP} />
          <ChartLegend items={[
            { key: 'bar', label: 'Sessions', kind: 'bar', color: SAUNA_COLOR },
            { key: 'rhr', label: 'Resting HR', kind: 'line', color: 'var(--series-weight)' },
            { key: 'hrv', label: 'HRV', kind: 'line', color: 'var(--series-sleep)' },
            ...(r.hasBP ? [{ key: 'sys', label: 'Systolic', kind: 'line', color: 'var(--series-muscle)' }, { key: 'dia', label: 'Diastolic', kind: 'line', color: 'var(--series-lean)' }] : []),
          ]} />
          {r.lines.slice(1).map((l) => <p key={l} className="text-sm font-medium" style={soft} data-testid="sauna-longer-line">{l}</p>)}
          {!r.lines.length && <ProgressRow text="A comparison unlocks with 4 weeks with sessions and 4 without" have={0} need={0} />}
        </>
      )}
    </section>
  )
}
