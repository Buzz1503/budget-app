import { useMemo, useState } from 'react'
import { ChevronLeft, HeartPulse, Layers, CalendarRange, GitCompareArrows, ListChecks, Repeat, Database } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import { AnswerLine, DeltaChip, InfoButton, StatusDot } from '../ui/Glance'
import TrendChart from '../charts/TrendChart'
import useChartEvents from '../charts/useChartEvents'
import { SyncLine } from './HealthSettings'
import useSleepLab from './useSleepLab'
import useHeart from './useHeart'
import SwitchScreen from './SwitchScreen'
import { HeartSummaryText } from './HeartSummary'
import { ridgeWithCI } from '../../sleep/analysis/stats'
import {
  changeWindows, sinceDose, sinceDoseAnswer, isWeekly, contextLine, adjustedPeriods, switchCandidates, historyCoverage,
  inRanges, HEART_INFO, HEART, shortDate, rhrVsReference,
} from '../../health/heart'

const soft = { color: 'var(--text-2)' }
const muted = { color: 'var(--text-3)' }
const day = (d) => format(parseISO(d), 'd MMM yyyy')
const TONE = { better: 'var(--good)', worse: 'var(--warn)', same: 'var(--text-2)' }
const toneFor = (diff, dir, status) => (status !== 'Clear' && status !== 'Possible') || diff == null || !dir ? 'same' : (diff > 0) === (dir === 'up') ? 'better' : 'worse'
const fmt = (v, dp) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(dp))

function Section({ icon: Icon, title, info, children, testid }) {
  return (
    <section className="space-y-2" data-testid={testid}>
      <div className="flex items-center gap-2 px-1">
        {Icon && <Icon size={18} style={soft} aria-hidden="true" />}
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</h2>
        {info && <InfoButton title={title}>{info}</InfoButton>}
      </div>
      {children}
    </section>
  )
}

/** Body › Heart: resting heart rate first, then sleep and heart rate by compound and dose. */
export default function HeartView({ onBack }) {
  const h = useHeart()
  const [view, setView] = useState(null) // { switchId } | 'reference'
  const [metric, setMetric] = useState('rhr')
  const [adjusted, setAdjusted] = useState(false)
  if (view?.switchId) return <SwitchScreen switchId={view.switchId} onBack={() => setView(null)} />
  const t = h.today
  const todayRhr = h.lookups.rhr.get(t) ?? [...h.lookups.rhr.entries()].sort((a, b) => a[0].localeCompare(b[0])).at(-1)?.[1] ?? null
  const vs = rhrVsReference(todayRhr, h.table.ref.rhr?.mean)
  const answer = vs.answer
  return (
    <div className="space-y-6" data-testid="heart-view">
      {onBack && (
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1.5 text-sm font-bold" style={soft} data-testid="heart-back"><ChevronLeft size={16} /> Back</button>
          <h1 className="min-w-0 flex-1 truncate text-right text-[17px] font-semibold">Heart</h1>
        </div>
      )}
      <SyncLine />

      <section className="card p-5" data-testid="heart-hero">
        <div className="flex items-center gap-2">
          <p className="t-caption min-w-0 flex-1" style={muted}>Resting heart rate</p>
          <InfoButton title="About resting heart rate"><p>{HEART_INFO}</p></InfoButton>
        </div>
        <div className="mt-1 flex items-baseline gap-3">
          <p className="font-black tabular-nums leading-none" style={{ fontSize: 56 }} data-testid="heart-rhr">{todayRhr != null ? Math.round(todayRhr) : '–'}<span className="ml-1 text-lg font-bold" style={muted}>bpm</span></p>
          {vs.chip && <DeltaChip text={vs.chip} tone={vs.tone} />}
        </div>
        <AnswerLine className="mt-3" testid="heart-answer">{answer}</AnswerLine>
        <HeartSummaryText heart={h} />
        <button onClick={() => setView('reference')} className="mt-3 block text-left text-[13px] font-medium tabular-nums underline decoration-dotted underline-offset-4" style={muted} data-testid="heart-reference">
          {h.reference ? `Good sleep period ${day(h.reference.from)} to ${day(h.reference.to)}${h.referenceIsDefault ? ' (the 8 weeks before Retatrutide)' : ''}. Change` : 'Set your good sleep period'}
        </button>
      </section>

      <SwitchOffers h={h} onOpen={(id) => setView({ switchId: id })} />
      <LongView h={h} />
      <ByDose h={h} metric={metric} setMetric={setMetric} adjusted={adjusted} setAdjusted={setAdjusted} />
      <AroundChanges h={h} />
      <SinceDose h={h} />
      <OtherChanges h={h} />
      <Coverage h={h} />
      <ReferenceSheet open={view === 'reference'} onClose={() => setView(null)} h={h} />
    </div>
  )
}

// ------------------------------------------------------------- reference

function ReferenceSheet({ open, onClose, h }) {
  const set = useStore((s) => s.setHeartSettings)
  const [from, setFrom] = useState(h.reference?.from || '')
  const [to, setTo] = useState(h.reference?.to || '')
  const ok = from && to && from <= to
  return (
    <Modal open={open} onClose={onClose} title="Good sleep period">
      <div className="space-y-3" data-testid="reference-sheet">
        <p className="text-sm font-medium" style={soft}>Pick dates when you slept well. Resting heart rate, sleeping heart rate and the rest are set against this period.</p>
        <label className="flex items-center gap-3"><span className="w-12 text-sm font-semibold" style={soft}>From</span><input type="date" className="input flex-1" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="reference-from" /></label>
        <label className="flex items-center gap-3"><span className="w-12 text-sm font-semibold" style={soft}>To</span><input type="date" className="input flex-1" value={to} onChange={(e) => setTo(e.target.value)} data-testid="reference-to" /></label>
        <button disabled={!ok} onClick={() => { set({ reference: { from, to } }); onClose() }} className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-40" data-testid="reference-save">Save</button>
        <button onClick={() => { set({ reference: null }); onClose() }} className="w-full rounded-full py-2.5 text-sm font-bold" style={{ background: 'var(--surface-sunk)' }} data-testid="reference-default">Use the 8 weeks before Retatrutide</button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------- long view

const LONG_RANGES = ['Start', '1Y', '6M', '90D', '30D']

function LongView({ h }) {
  const events = useChartEvents()
  const rhr = useMemo(() => [...h.lookups.rhr.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)), [h])
  const sleep = useMemo(() => [...h.lookups.sleepHR.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)), [h])
  const bands = useMemo(() => h.periods.filter((p) => p.compoundId).flatMap((p) => p.ranges.map(([from, to]) => ({ from, to, label: p.dose != null ? `${p.dose} ${p.unit || ''}`.trim() : p.name, tone: p.colour }))), [h])
  const focus = useMemo(() => [...new Set(h.periods.filter((p) => p.compoundId).map((p) => p.compoundId))], [h])
  return (
    <Section icon={HeartPulse} title="Resting and sleeping heart rate" testid="heart-long"
      info={<p>Resting heart rate is Apple's daily value. Sleeping heart rate is the average of 5-minute averages while asleep, from your chosen sleep source. The shaded bands are your dose periods; the lane under the dates shows each compound's dose.</p>}>
      <TrendChart metric="rhr" chartType="heart-long" title="Resting heart rate" question="Is my resting heart rate going down?" unit="bpm" dp={0}
        series={rhr} events={events} defaultRange="1Y"
        second={sleep.length ? { label: 'Sleeping HR', series: sleep } : null} periods={bands} defaultLanes={focus} testid="heart-long-chart"
        ranges={LONG_RANGES} sinceDate={h.periods[0]?.ranges[0]?.[0] ?? null} />
    </Section>
  )
}

// ------------------------------------------------------------- by dose

function Forest({ rows, metric, refStat, adjustedValues }) {
  const vals = rows.flatMap((r) => { const s = r.cells[metric.key].stat; return s ? [s.lo, s.hi] : [] }).concat(refStat ? [refStat.lo, refStat.hi] : [])
    .concat(Object.values(adjustedValues || {}).flatMap((v) => [v.adj]))
  if (!vals.length) return <p className="text-sm font-medium" style={soft}>No nights with {metric.label.toLowerCase()} in these periods yet.</p>
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = (hi - lo) * 0.1 || 1
  const x = (v) => `${((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100}%`
  return (
    <div className="rows" data-testid="heart-forest">
      {rows.map((r) => {
        const c = r.cells[metric.key]
        const s = c.stat
        const tone = toneFor(c.diff, metric.dir, c.status)
        const a = adjustedValues?.[r.period.key]
        return (
          <div key={r.period.key} className="py-2.5" data-testid={`forest-${r.period.key}`} data-status={c.status}>
            <div className="flex items-baseline gap-2">
              <p className="min-w-0 flex-1 truncate text-[15px] font-medium">{r.period.label}</p>
              <p className="text-[15px] font-semibold tabular-nums">{s ? fmt(s.mean, metric.dp) : '–'}{a ? <span className="ml-1 text-[13px]" style={soft}>adj {fmt(a.adj, metric.dp)}</span> : null}</p>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="relative h-4 min-w-0 flex-1">
                <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2" style={{ background: 'var(--surface-sunk)' }} />
                {refStat && <span className="absolute top-0 h-4" style={{ left: x(refStat.lo), width: `calc(${x(refStat.hi)} - ${x(refStat.lo)})`, background: 'var(--text)', opacity: 0.1, borderRadius: 4 }} />}
                {s && <span className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ left: x(s.lo), width: `calc(${x(s.hi)} - ${x(s.lo)})`, background: TONE[tone], opacity: 0.6 }} data-testid="forest-ci" />}
                {s && <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: x(s.mean), background: TONE[tone] }} />}
                {a && <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ left: x(a.adj), borderColor: 'var(--text)' }} data-testid="forest-adjusted" />}
              </span>
              <span className="w-[86px] shrink-0 text-right"><StatusDot label={c.status} /></span>
            </div>
            <p className="text-[13px] font-medium tabular-nums" style={muted}>{s ? `${s.n} ${metric.key === 'rhr' ? 'days' : 'nights'}, 95% range ${fmt(s.lo, metric.dp)} to ${fmt(s.hi, metric.dp)}` : 'No data'}</p>
          </div>
        )
      })}
    </div>
  )
}

/** The Sleep Lab's features, as the confounders the adjusted comparison controls for. */
function useAdjusted(h, metric, on) {
  const lab = useSleepLab()
  return useMemo(() => {
    if (!on || !h.periods.length) return null
    const ids = (re) => Object.entries(lab.names.asNeeded || {}).filter(([, n]) => re.test(n)).map(([id]) => `asNeeded:${id}`)
    const sed = ids(/temazepam|diazepam|restavit/i)
    const dex = [...ids(/dex/i), ...Object.entries(lab.names.compounds || {}).filter(([, n]) => /dex/i.test(n)).map(([id]) => `dose:${id}`)]
    const rows = []
    for (const [date, y] of h.lookups[metric.key]) {
      const f = lab.featureBy.get(date)
      if (!f) continue
      const p = h.periods.find((x) => inRanges(date, x.ranges))
      if (!p) continue
      const b = f.binary
      rows.push({ date, period: p.key, y, conf: [b.sauna, b['habit:alcohol'], sed.some((k) => b[k]), dex.some((k) => b[k]), b.lateMeal, b.weekend].map((v) => (v ? 1 : 0)) })
    }
    let seed = 7
    return adjustedPeriods(rows, h.periods.map((p) => p.key), (X, y) => ridgeWithCI(X, y, seed++, { resamples: 120 }))
  }, [h, metric, on, lab])
}

function ByDose({ h, metric: key, setMetric, adjusted, setAdjusted }) {
  const metric = h.metrics.find((m) => m.key === key)
  const adj = useAdjusted(h, metric, adjusted)
  if (!h.periods.length) {
    return (
      <Section icon={Layers} title="By dose level" testid="heart-by-dose">
        <p className="card p-4 text-sm font-medium" style={soft}>Add Retatrutide or another GLP-1 class compound to your protocol to compare by dose.</p>
      </Section>
    )
  }
  const rows = h.table.rows
  const clear = rows.filter((r) => r.cells[key].status === 'Clear' && r.period.compoundId)
  const answer = clear.length
    ? `${metric.label} differs from your good sleep period at ${clear.map((r) => r.period.label).join(', ')}.`
    : `${metric.label} is not clearly different from your good sleep period at any dose yet.`
  return (
    <Section icon={Layers} title="By dose level" testid="heart-by-dose"
      info={<><p>Each row is a period: before the first GLP-1 class compound, then each compound at each dose. The dot is the average, the bar its 95% range, the shaded band your good sleep period.</p><p>Clear: the range stays clear of your good sleep average. Possible: the average is more than half your usual spread away. Normal: inside it. Early: under 7 nights. Associations, not causes.</p></>}>
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {h.metrics.map((m) => (
          <button key={m.key} onClick={() => setMetric(m.key)} aria-pressed={key === m.key} data-testid={`heart-metric-${m.key}`}
            className="min-h-[32px] rounded-full px-3 text-xs font-bold" style={key === m.key ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)' }}>{m.label}</button>
        ))}
      </div>
      <div className="card px-4 py-2">
        <AnswerLine className="py-1" testid="heart-dose-answer">{answer}</AnswerLine>
        <Forest rows={rows} metric={metric} refStat={h.table.ref[key]} adjustedValues={adj && !adj.locked ? adj.values : null} />
        <label className="mt-1 flex items-center gap-2 py-2 text-sm font-medium" style={soft}>
          <input type="checkbox" checked={adjusted} onChange={(e) => setAdjusted(e.target.checked)} data-testid="heart-adjusted" />
          Adjusted for things you log
        </label>
        {adjusted && adj?.locked && <p className="pb-2 text-[13px] font-medium" style={muted} data-testid="heart-adjusted-locked">Needs {HEART.adjustedFrom} nights with your evening logged. You have {adj.have}.</p>}
        {adjusted && adj && !adj.locked && <p className="pb-2 text-[13px] font-medium" style={muted}>Hollow dots: adjusted for sauna, alcohol, sedatives (temazepam, diazepam, Restavit), dexamphetamine, late meals and weekend, {adj.n} nights. Raw numbers stay as they are.</p>}
      </div>
    </Section>
  )
}

// ----------------------------------------------------- around dose changes

const MINI = [{ key: 'rhr', label: 'Resting HR', dp: 0, dir: 'down' }, { key: 'sleepHR', label: 'Sleeping HR', dp: 0, dir: 'down' }, { key: 'wakeUps', label: 'Wake-ups', dp: 1, dir: 'down' }]

function AroundChanges({ h }) {
  if (!h.changes.length) return null
  return (
    <Section icon={GitCompareArrows} title="Around each dose change" testid="heart-changes"
      info={<p>For each increase or decrease: the 14 nights before, the 14 after, then weeks 3 to 6 after, to see whether it settles.</p>}>
      <div className="grid grid-cols-1 gap-2">
        {[...h.changes].reverse().map((c) => (
          <div key={`${c.compoundId}${c.date}`} className="card p-3" data-testid="heart-change">
            <p className="text-[15px] font-semibold">{c.name} {c.from} to {c.to}</p>
            <p className="text-[13px] font-medium" style={muted}>{day(c.date)}</p>
            <div className="mt-2 grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-[13px] tabular-nums">
              <span style={muted} />
              <span className="text-right font-semibold" style={muted}>Before</span>
              <span className="text-right font-semibold" style={muted}>After</span>
              <span className="text-right font-semibold" style={muted}>Wk 3 to 6</span>
              {MINI.map((m) => {
                const w = changeWindows(c.date, h.lookups[m.key])
                const tone = (s) => (!w.before || !s ? 'same' : Math.abs(s.mean - w.before.mean) < (m.dp ? 0.2 : 1) ? 'same' : (s.mean > w.before.mean) === (m.dir === 'up') ? 'better' : 'worse')
                return (
                  <FragmentRow key={m.key} label={m.label} cells={[w.before, w.after, w.settle].map((s, i) => ({ text: s ? s.mean.toFixed(m.dp) : '–', tone: i ? tone(s) : 'same', n: s?.n }))} />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function FragmentRow({ label, cells }) {
  return (
    <>
      <span className="font-medium">{label}</span>
      {cells.map((c, i) => <span key={i} className="text-right font-semibold" style={{ color: c.tone === 'same' ? 'var(--text)' : TONE[c.tone] }} title={c.n ? `${c.n} nights` : undefined}>{c.text}</span>)}
    </>
  )
}

// ---------------------------------------------------------- days since dose

function SinceDose({ h }) {
  const doseLogs = useStore((s) => s.doseLogs)
  const [key, setKey] = useState('wakeUps')
  const focus = useMemo(() => {
    const ids = [...new Set(h.periods.filter((p) => p.compoundId).map((p) => p.compoundId))]
    return h.compounds.filter((c) => ids.includes(c.id)).at(-1) || null
  }, [h])
  const r = useMemo(() => {
    if (!focus) return null
    const doses = doseLogs.filter((l) => l.peptideId === focus.id).map((l) => (l.at ? Date.parse(l.at) : Date.parse(`${l.date}T${l.time || '08:00'}:00`))).filter(Number.isFinite)
    return sinceDose({ weekly: isWeekly(focus.frequency), doses, bedtimes: h.bedtimes, lookup: h.lookups[key] })
  }, [focus, doseLogs, h, key])
  if (!focus || !r) return null
  const weekly = isWeekly(focus.frequency)
  const metric = h.metrics.find((m) => m.key === key)
  const max = Math.max(...r.bins.map((b) => b.stat?.mean ?? 0), 1)
  return (
    <Section icon={CalendarRange} title={weekly ? `Days since your ${focus.name} injection` : `Hours since your ${focus.name} dose`} testid="heart-since"
      info={<p>{weekly ? 'Each night counted by the days since your last injection (the evening before the night).' : 'Each night counted by the hours from your last dose to bedtime, in 12-hour steps.'} Shown once every step has at least {HEART.doseBinMin} nights.</p>}>
      <div className="flex gap-1.5">
        {['wakeUps', 'sleepHR', 'rhr'].map((k) => (
          <button key={k} onClick={() => setKey(k)} aria-pressed={key === k} className="min-h-[32px] rounded-full px-3 text-xs font-bold"
            style={key === k ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)' }} data-testid={`since-${k}`}>{h.metrics.find((m) => m.key === k).label}</button>
        ))}
      </div>
      <div className="card p-4">
        <AnswerLine testid="since-answer">{sinceDoseAnswer(`${metric.label} ${key === 'wakeUps' ? 'are' : 'is'}`, r, weekly, metric.dp)}</AnswerLine>
        {r.ok && (
          <div className="mt-3 flex items-end gap-2" style={{ height: 120 }} data-testid="since-bars">
            {r.bins.map((b) => (
              <div key={b.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="text-[12px] font-semibold tabular-nums">{b.stat ? b.stat.mean.toFixed(metric.dp) : '–'}</span>
                <span className="w-full rounded-t-[6px]" style={{ height: `${((b.stat?.mean ?? 0) / max) * 80}px`, background: 'var(--series-sleep)', opacity: 0.8 }} />
                <span className="text-[11px] font-semibold" style={muted}>{weekly ? `D${b.key}` : `${b.key * 12}h`}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

// ------------------------------------------------- other things that changed

function OtherChanges({ h }) {
  const saunaSessions = useStore((s) => s.saunaSessions)
  const habitLogs = useStore((s) => s.habitLogs)
  const eveningDetails = useStore((s) => s.eveningDetails)
  const asNeededLogs = useStore((s) => s.asNeededLogs)
  const measurements = useStore((s) => s.measurements)
  const lines = useMemo(() => {
    const events = []
    for (const c of h.compounds) {
      for (const p of c.points) {
        if (!['start', 'restart', 'step-up', 'override', 'stop'].includes(p.kind)) continue
        events.push({ date: p.date, compoundId: c.id, name: c.name, kind: p.kind === 'stop' ? 'stop' : p.kind === 'start' || p.kind === 'restart' ? 'start' : 'change', dose: p.to != null ? `${p.to} ${p.unit || ''}`.trim() : null })
      }
    }
    const alcohol = [
      ...Object.entries(habitLogs || {}).filter(([, v]) => v?.alcohol).map(([d]) => d),
      ...Object.entries(eveningDetails || {}).filter(([, v]) => (v?.drinks || 0) > 0).map(([d]) => d),
    ]
    const sedatives = (asNeededLogs || []).filter((l) => /temazepam|diazepam|restavit/i.test(l.name || '')).map((l) => ({ date: String(l.at || '').slice(0, 10), name: l.name }))
    const weights = (measurements || []).filter((m) => typeof m.weight === 'number' && !m.hiddenFromCharts).map((m) => ({ date: m.date, value: m.weight }))
    const ctx = { events, sauna: (saunaSessions || []).map((s) => s.date), alcohol, sedatives, weights }
    const refDays = h.reference ? Math.max(1, (Date.parse(h.reference.to) - Date.parse(h.reference.from)) / 86400000 + 1) : null
    const refSauna = h.reference ? Math.round((ctx.sauna.filter((d) => d >= h.reference.from && d <= h.reference.to).length / refDays) * 7 * 10) / 10 : null
    return h.periods.map((p) => ({ p, line: contextLine(p, ctx, { sauna: refSauna }) }))
  }, [h, saunaSessions, habitLogs, eveningDetails, asNeededLogs, measurements])
  if (!lines.length) return null
  return (
    <Section icon={ListChecks} title="Other things that changed" testid="heart-context"
      info={<p>What else was going on in each period, so a difference is not read as coming from one compound alone.</p>}>
      <div className="card rows px-4 py-1">
        {lines.map(({ p, line }) => (
          <div key={p.key} className="py-2.5" data-testid={`context-${p.key}`}>
            <p className="text-[15px] font-medium">{p.label}</p>
            <p className="text-[13px] font-medium" style={soft}>{line}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------- switches

function SwitchOffers({ h, onOpen }) {
  const switches = useStore((s) => s.switches)
  const dismissed = useStore((s) => s.switchDismissed)
  const addSwitch = useStore((s) => s.addSwitch)
  const dismiss = useStore((s) => s.dismissSwitch)
  const offers = useMemo(() => switchCandidates(h.compounds, h.today, switches || [], dismissed || []), [h, switches, dismissed])
  if (!offers.length && !(switches || []).length) return null
  const name = (id) => h.compounds.find((c) => c.id === id)?.name || id
  return (
    <Section icon={Repeat} title="Switches" testid="heart-switches">
      {offers.map((o) => (
        <div key={o.key} className="card p-4" data-testid="switch-offer">
          <p className="text-[15px] font-semibold">Track this as a switch?</p>
          <p className="mt-1 text-sm font-medium" style={soft}>{o.fromName} stopped and {o.toName} started {shortDate(o.date)}. A switch gets its own comparison, with a settling-in window left out.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => { const id = addSwitch({ from: o.from, to: o.to, date: o.date }); if (id) onOpen(id) }} className="btn-primary min-h-[40px] flex-1 rounded-full text-sm font-black" data-testid="switch-track">Track this switch</button>
            <button onClick={() => dismiss(o.key)} className="min-h-[40px] rounded-full px-4 text-sm font-bold" style={{ background: 'var(--surface-sunk)' }} data-testid="switch-dismiss">Not a switch</button>
          </div>
        </div>
      ))}
      {(switches || []).map((s) => (
        <button key={s.id} onClick={() => onOpen(s.id)} className="card flex w-full items-center gap-3 px-4 py-3 text-left" data-testid="switch-row">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{name(s.from)} to {name(s.to)}</span>
            <span className="block text-[13px] font-medium" style={soft}>Switched {day(s.date)}</span>
          </span>
          <span className="text-xs font-bold" style={muted}>Compare</span>
        </button>
      ))}
    </Section>
  )
}

// ---------------------------------------------------------------- coverage

function Coverage({ h }) {
  const c = useMemo(() => historyCoverage(h.model.daily, [...h.model.nightBy.values()]), [h])
  return (
    <Section icon={Database} title="What came through from Apple Health" testid="heart-coverage"
      info={<p>The earliest date found for each kind of data. Apple Watch only records sleep stages from watchOS 9 (late 2022); nights without stages keep their length and heart rate, are marked No stages and are left out of stage comparisons.</p>}>
      <div className="card rows px-4 py-1">
        {c.rows.map((r) => (
          <div key={r.key} className="flex items-baseline gap-2 py-2" data-testid={`coverage-${r.key}`}>
            <span className="min-w-0 flex-1 text-[15px] font-medium">{r.label}</span>
            <span className="text-[13px] font-medium tabular-nums" style={soft}>{r.first ? `from ${day(r.first)}` : 'none yet'}</span>
            <span className="w-16 text-right text-[13px] font-semibold tabular-nums">{r.count}</span>
          </div>
        ))}
        <p className="py-2 text-[13px] font-medium" style={muted} data-testid="coverage-stages">{c.stageNights} of {c.nights} nights have sleep stages.</p>
      </div>
    </Section>
  )
}

