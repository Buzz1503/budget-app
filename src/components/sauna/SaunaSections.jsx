import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronRight } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import {
  coolDownDrop, coolDownTrend, patterns, longerTerm, fit, ratingRows, fluidEstimate,
} from '../../sauna/analytics'
import { SAUNA_CAVEAT } from '../../sauna/saunaEffects'
import { beforeVsSince, compoundCaveat, withinSauna, heatAdaptation10, hrAtMinute10 } from '../../sauna/insights'
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

/**
 * Values in order with a least-squares trend line, first and last date under
 * it. The y axis comes from the data, padded so a flat run is not a cliff.
 */
export function DotTrend({ points, unit, label, testid }) {
  const W = 300
  const H = 110
  const L = 30
  const R = 8
  const T = 8
  const B = 22
  const ys = points.map((p) => p.value)
  const pad = Math.max(2, (Math.max(...ys) - Math.min(...ys)) * 0.15)
  const lo = Math.floor(Math.min(...ys) - pad)
  const hi = Math.ceil(Math.max(...ys) + pad)
  const n = points.length
  const x = (i) => L + (n === 1 ? 0.5 : i / (n - 1)) * (W - L - R)
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const f = fit(points.map((_, i) => i), ys)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label} data-testid={testid}>
      <text x={L - 6} y={y(hi) + 3} fontSize="9" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{hi}</text>
      <text x={L - 6} y={y(lo) + 3} fontSize="9" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{lo}</text>
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--border)" />
      {f && <line x1={x(0)} x2={x(n - 1)} y1={y(f.intercept)} y2={y(f.intercept + f.slope * (n - 1))} stroke="var(--text-2)" strokeWidth="1.5" strokeDasharray="4 3" data-testid="trend-line" />}
      {points.map((p, i) => <circle key={`${p.date}-${i}`} cx={x(i)} cy={y(p.value)} r="3.5" fill="var(--series-sauna)"><title>{`${format(parseISO(p.date), 'd MMM')}: ${Math.round(p.value)} ${unit}`}</title></circle>)}
      <text x={L} y={H - 6} fontSize="9" fill="var(--text-3)">{format(parseISO(points[0].date), 'd MMM')}</text>
      <text x={W - R} y={H - 6} fontSize="9" textAnchor="end" fill="var(--text-3)">{format(parseISO(points[n - 1].date), 'd MMM')}</text>
    </svg>
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

/**
 * 3. Is your body getting used to the heat? Heart rate at minute 10 of each Watch session at
 * the temperature used most, oldest on the left, with one verdict. Average heart rate rises
 * with longer sessions, so minute 10 compares like with like. Average and peak stay in the
 * session detail.
 */
export function HeatAdaptationCard() {
  const sessions = useStore((s) => s.saunaSessions)
  const ctx = useSaunaHealth()
  const r = useMemo(() => heatAdaptation10(sessions.map((s) => ({
    id: s.id, date: s.date, start: s.start, tempC: s.tempC, lengthMin: s.lengthMin, hr10: hrAtMinute10(ctx?.seriesFor(s)),
  }))), [sessions, ctx])
  return (
    <section className="card p-4" data-testid="sauna-adaptation" data-status={r.status}>
      {r.status === 'early' ? <Locked text={r.verdict} testid="sauna-adaptation-locked" /> : (
        <>
          <p className="text-sm font-bold" data-testid="sauna-adaptation-text">{r.verdict}</p>
          <p className="mb-2 text-xs font-medium" style={muted}>Heart rate at minute 10 of each session at {r.band.label}, oldest on the left. Lower means your body is coping with the heat more easily.</p>
          <DotTrend points={r.points} unit="bpm" label={`Heart rate at minute 10 of each session at ${r.band.label}`} testid="sauna-adaptation-chart" />
          {r.context && <p className="mt-2 text-xs font-medium" style={soft} data-testid="sauna-adaptation-context">{r.context}</p>}
        </>
      )}
    </section>
  )
}

/** 4. Cool-down recovery: the heart rate drop 2 and 5 minutes after leaving. */
export function CoolDownCard() {
  const sessions = useStore((s) => s.saunaSessions)
  const coolDownOn = useStore((s) => s.watchSettings?.coolDown !== false)
  const r = useMemo(() => {
    const drops = sessions.map((s) => ({ s, d: coolDownDrop(s.coolDown) })).filter((x) => x.d)
    const latest = drops.sort((a, b) => newestFirst(a.s, b.s))[0] || null
    return { latest, trend: coolDownTrend(drops.map((x) => ({ date: x.s.date, drop2: x.d.drop2 }))) }
  }, [sessions])
  return (
    <section className="card space-y-2 p-4" data-testid="sauna-cool-down-card">
      {r.latest ? (
        <p className="text-sm font-bold tabular-nums" data-testid="sauna-cool-down-latest">
          Last time: {r.latest.d.drop2 != null ? `${r.latest.d.drop2} bpm lower after 2 min` : 'no reading at 2 min'}
          {r.latest.d.drop5 != null ? `, ${r.latest.d.drop5} after 5 min` : ''}
        </p>
      ) : (
        <p className="text-sm font-medium" style={soft} data-testid="sauna-cool-down-none">
          {coolDownOn
            ? 'After Stop on Apple Watch, Cool down keeps reading your heart rate for 5 minutes. The drop shows here.'
            : 'Cool down is off in More › Apple Watch.'}
        </p>
      )}
      {r.trend.locked
        ? (r.latest ? <Locked text={r.trend.text} testid="sauna-cool-down-locked" /> : null)
        : (
          <>
            <p className="text-sm font-medium" style={soft} data-testid="sauna-cool-down-trend">{r.trend.text}</p>
            <DotTrend points={r.trend.points} unit="bpm" label="Heart rate drop 2 minutes after leaving, per session" testid="sauna-cool-down-chart" />
          </>
        )}
    </section>
  )
}

const LABEL_TONE = { 'Clear change': 'var(--text)', 'Possible change': 'var(--text-2)', 'Within normal fluctuation': 'var(--text-3)' }

function PatternRows({ title, rows, group }) {
  if (!rows.length) return null
  return (
    <div data-testid={`sauna-patterns-${group}`}>
      <p className="t-caption mt-3" style={muted}>{title}</p>
      <div className="rows">
        {rows.map((r) => (
          <div key={r.key} className="py-2.5" data-testid="sauna-pattern-row" data-metric={r.key}>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium" style={soft}>{r.text}</p>
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--surface-sunk)', color: LABEL_TONE[r.label] }} data-label={r.label}>{r.label}</span>
            </div>
            <p className="mt-0.5 text-[11px] font-bold tabular-nums" style={muted}>n {r.nWith} and {r.nWithout}</p>
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
          <PatternRows title="Sessions ending within 3 h of bedtime against earlier ones" rows={r.timing} group="timing" />
          <p className="pb-2 pt-1 text-[11px] font-medium" style={muted} data-testid="sauna-caveat">Higher or lower on days with, not because of. {SAUNA_CAVEAT}</p>
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

/** Since you started sauna against the 4 weeks before, with the compound caveat when one changed then. */
function BeforeSinceCard({ input }) {
  const sessions = useStore((s) => s.saunaSessions)
  const events = useChartEvents()
  const t = todayStr()
  const r = useMemo(() => beforeVsSince({ sessions, night: input.night, morning: input.morning, today: t, wobble: input.wobble }), [sessions, input, t])
  const caveat = useMemo(() => compoundCaveat(sessions, events), [sessions, events])
  return (
    <section className="card px-4 pb-3 pt-4" data-testid="sauna-before-since">
      <div className="flex items-baseline gap-2">
        <p className="t-label flex-1">Since you started sauna, against the 4 weeks before</p>
        {r.early && <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="sauna-before-early">{r.early}</span>}
      </div>
      {r.status !== 'ok' ? <Locked text={r.text} testid="sauna-before-locked" /> : (
        <div className="rows">
          {r.rows.map((x) => (
            <div key={x.key} className="py-2.5" data-testid="sauna-before-row" data-metric={x.key}>
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium tabular-nums" style={soft}>{x.text}</p>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--surface-sunk)', color: LABEL_TONE[x.label] }} data-label={x.label}>{x.label}</span>
              </div>
              <p className="mt-0.5 text-[11px] font-bold tabular-nums" style={muted}>{x.nSince} days since, {x.nBefore} before</p>
            </div>
          ))}
        </div>
      )}
      {caveat && <p className="mt-1 text-xs font-bold" style={{ color: 'var(--text)' }} data-testid="sauna-before-caveat">{caveat}</p>}
      <p className="mt-1 text-[11px] font-medium" style={muted}>What went with starting sauna, not what it did. Anything else that changed since then is in both.</p>
    </section>
  )
}

/** Inside sauna days: evening against earlier, longer against shorter, hotter against cooler. */
function WithinSaunaCard({ input }) {
  const sessions = useStore((s) => s.saunaSessions)
  const splits = useMemo(() => withinSauna(sessions, input), [sessions, input])
  return (
    <section className="card px-4 pb-3 pt-4" data-testid="sauna-within">
      <p className="t-label">Inside sauna days</p>
      <p className="text-xs font-medium" style={muted}>No days off needed: your sessions compared with each other, against that night's sleep and the next morning.</p>
      {splits.map((sp) => (
        <div key={sp.key} className="mt-3" data-testid={`sauna-within-${sp.key}`}>
          <p className="t-caption" style={muted}>{sp.title}</p>
          {sp.locked ? <Locked text={sp.locked} testid={`sauna-within-${sp.key}-locked`} /> : sp.rows.map((x) => (
            <div key={x.key} className="py-1.5" data-testid="sauna-within-row">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium" style={soft}>{x.text}</p>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--surface-sunk)', color: LABEL_TONE[x.label] }} data-label={x.label}>{x.label}</span>
              </div>
              <p className="mt-0.5 text-[11px] font-bold tabular-nums" style={muted}>n {x.nA} and {x.nB}</p>
            </div>
          ))}
        </div>
      ))}
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
      <BeforeSinceCard input={ctx.patternInput} />
      <WithinSaunaCard input={ctx.patternInput} />
      <p className="px-1 pt-2 text-xs font-bold" style={muted}>Sauna days against days without</p>
      <PatternsView input={ctx.patternInput} />
      <RatingRows />
    </div>
  )
}

/** Weekly bars, then resting heart rate and HRV week by week on the same time axis. */
function WeeksChart({ weeks, axisMax, hasBP = false }) {
  const W = 300
  const L = 34
  const R = 8
  const n = weeks.length
  const cw = (W - L - R) / n
  const cx = (i) => L + cw * i + cw / 2
  const bars = 60
  const line = 46
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
        <text x={0} y={top + 10} fontSize="9" fontWeight="700" fill="var(--text-3)">{label}</text>
        <text x={L - 4} y={top + 22} fontSize="9" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{hi}</text>
        <text x={L - 4} y={top + line - 2} fontSize="9" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{lo}</text>
        {segs.map((p, i) => (p.length > 1
          ? <polyline key={i} points={p.join(' ')} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" />
          : <circle key={i} cx={p[0].split(',')[0]} cy={p[0].split(',')[1]} r="2" fill={colour} />))}
      </g>
    )
  }
  const H = bars + (hasBP ? 4 : 2) * line + 24
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Sessions each week, with weekly resting heart rate and HRV${hasBP ? ', and blood pressure' : ''}`} data-testid="sauna-weeks-chart">
      <text x={L - 4} y={10} fontSize="9" textAnchor="end" fill="var(--text-3)" className="tabular-nums">{axisMax}</text>
      <text x={L - 4} y={bars} fontSize="9" textAnchor="end" fill="var(--text-3)">0</text>
      {weeks.map((w, i) => {
        const h = (w.count / axisMax) * (bars - 6)
        return <rect key={w.week} x={cx(i) - cw * 0.35} y={bars - h} width={cw * 0.7} height={h} rx="2" fill="var(--series-sauna)" data-testid="sauna-week-bar" data-count={w.count}><title>{`Week of ${format(parseISO(w.week), 'd MMM')}: ${w.count}`}</title></rect>
      })}
      <line x1={L} x2={W - R} y1={bars} y2={bars} stroke="var(--border)" />
      {row('rhr', bars + 4, 'RHR', 'var(--series-weight)')}
      {row('hrv', bars + 4 + line, 'HRV', 'var(--series-sleep)')}
      {hasBP && row('sys', bars + 4 + 2 * line, 'SYS', 'var(--series-muscle)')}
      {hasBP && row('dia', bars + 4 + 3 * line, 'DIA', 'var(--series-lean)')}
      <text x={L} y={H - 4} fontSize="9" fill="var(--text-3)">{format(parseISO(weeks[0].week), 'd MMM')}</text>
      <text x={W - R} y={H - 4} fontSize="9" textAnchor="end" fill="var(--text-3)">This week</text>
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
          <WeeksChart weeks={r.weeks} axisMax={r.axisMax} hasBP={r.hasBP} />
          {r.lines.map((l) => <p key={l} className="text-sm font-medium" style={soft} data-testid="sauna-longer-line">{l}</p>)}
          {!r.lines.length && <p className="text-xs font-medium" style={muted}>A comparison appears with 4 weeks with sessions and 4 without.</p>}
        </>
      )}
    </section>
  )
}
