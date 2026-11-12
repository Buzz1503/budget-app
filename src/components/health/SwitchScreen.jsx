import { useMemo, useState } from 'react'
import { ChevronLeft, FileText, Trash2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore from '../../store/useStore'
import { AnswerLine, InfoButton, StatusDot } from '../ui/Glance'
import useHeart from './useHeart'
import { evoltScans } from '../../body/composition'
import {
  switchWindows, switchCompare, switchAnswer, slopePerWeek, contextLine, inRanges, HEART, NO_EQUIVALENCE,
} from '../../health/heart'

const soft = { color: 'var(--text-2)' }
const muted = { color: 'var(--text-3)' }
const day = (d) => format(parseISO(d), 'd MMM yyyy')
const TONE = { better: 'var(--good)', worse: 'var(--warn)', same: 'var(--text-2)' }

const SWITCH_METRICS = [
  { key: 'rhr', label: 'Resting HR', unit: 'bpm', dp: 0, dir: 'down' },
  { key: 'sleepHR', label: 'Sleeping HR', unit: 'bpm', dp: 0, dir: 'down' },
  { key: 'timeToLow', label: 'Time to lowest HR', unit: 'min', dp: 0, dir: 'down' },
  { key: 'wakeUps', label: 'Wake-ups', unit: 'a night', dp: 1, dir: 'down' },
  { key: 'awakeMin', label: 'Awake', unit: 'min', dp: 0, dir: 'down' },
  { key: 'deep', label: 'Deep sleep', unit: 'min', dp: 0, dir: 'up' },
  { key: 'hrv', label: 'HRV', unit: 'ms', dp: 0, dir: 'up' },
  { key: 'readiness', label: 'Readiness', unit: '', dp: 0, dir: 'up' },
  { key: 'score', label: 'Sleep score', unit: '', dp: 0, dir: 'up' },
]

/** Before and after dots on one axis, the arrow green the better way and amber the other. */
function DotPlot({ row }) {
  const b = row.before?.mean
  const a = row.after?.mean
  if (b == null && a == null) return <span className="h-4 min-w-0 flex-1" />
  const vals = [row.before?.lo, row.before?.hi, row.after?.lo, row.after?.hi].filter((v) => v != null && Number.isFinite(v))
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = (hi - lo) * 0.15 || 1
  const x = (v) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100
  return (
    <svg viewBox="0 0 100 16" preserveAspectRatio="none" className="h-4 min-w-0 flex-1" aria-hidden="true">
      <line x1="0" x2="100" y1="8" y2="8" stroke="var(--surface-sunk)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {b != null && a != null && <line x1={x(b)} x2={x(a)} y1="8" y2="8" stroke={TONE[row.tone]} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      {b != null && <circle cx={x(b)} cy="8" r="3.2" fill="var(--text-3)" />}
      {a != null && <circle cx={x(a)} cy="8" r="3.6" fill={TONE[row.tone]} />}
    </svg>
  )
}

export default function SwitchScreen({ switchId, onBack }) {
  const h = useHeart()
  const sw = useStore((s) => (s.switches || []).find((x) => x.id === switchId))
  const transition = useStore((s) => s.heartSettings?.transitionDays ?? HEART.transitionDays)
  const setHeart = useStore((s) => s.setHeartSettings)
  const removeSwitch = useStore((s) => s.removeSwitch)
  const measurements = useStore((s) => s.measurements)
  const reactions = useStore((s) => s.reactions)
  const injectionRecords = useStore((s) => s.injectionRecords)
  const saunaSessions = useStore((s) => s.saunaSessions)
  const habitLogs = useStore((s) => s.habitLogs)
  const asNeededLogs = useStore((s) => s.asNeededLogs)
  const showToast = useStore((s) => s.showToast)
  const [busy, setBusy] = useState(false)

  const data = useMemo(() => {
    if (!sw) return null
    const w = switchWindows(sw, h.compounds, h.today, transition)
    // readiness and sleep score, by date, for the two sides
    const readiness = new Map()
    const score = new Map()
    for (const d of h.model.nightBy.keys()) {
      if (!inRanges(d, [w.old, w.new])) continue
      const r = h.model.readiness(d)
      if (r.status === 'ok') readiness.set(d, r.score)
      const s = h.model.sleepScore(d)?.score
      if (s != null) score.set(d, s)
    }
    const lookups = { ...h.lookups, readiness, score }
    const cmp = switchCompare(w, lookups, SWITCH_METRICS)
    const weights = measurements.filter((m) => typeof m.weight === 'number' && !m.hiddenFromCharts && m.source !== 'scan').map((m) => ({ date: m.date, value: m.weight }))
    const inW = (pts, r) => pts.filter((p) => p.date >= r[0] && p.date <= r[1])
    const scans = evoltScans(measurements).filter((m) => typeof m.fatMass === 'number').map((m) => ({ date: m.date, value: m.fatMass }))
    const body = {
      weight: { before: slopePerWeek(inW(weights, w.old)), after: slopePerWeek(inW(weights, w.new)) },
      fat: { before: slopePerWeek(inW(scans, w.old)), after: slopePerWeek(inW(scans, w.new)) },
      reactions: (() => {
        const dateOf = (r) => r.date || (typeof r.timestamp === 'number' ? new Date(r.timestamp).toISOString().slice(0, 10) : String(r.timestamp || r.at || '').slice(0, 10))
        const recDate = new Map((injectionRecords || []).map((r) => [r.id, dateOf(r)]))
        const dates = (reactions || []).map((x) => recDate.get(x.injectionRecordId)).filter(Boolean)
        return { before: dates.filter((d) => d >= w.old[0] && d <= w.old[1]).length, after: dates.filter((d) => d >= w.new[0] && d <= w.new[1]).length }
      })(),
    }
    const toName = h.compounds.find((c) => c.id === sw.to)?.name || 'the new compound'
    const fromName = h.compounds.find((c) => c.id === sw.from)?.name || 'the old compound'
    const answer = switchAnswer(toName.toLowerCase(), cmp.rows, body.weight)
    const doseRows = h.table.rows.filter((r) => r.period.compoundId === sw.from || r.period.compoundId === sw.to)
    // everything else that changed across the two sides, without the two compounds themselves
    const events = h.compounds.filter((c) => c.id !== sw.from && c.id !== sw.to).flatMap((c) => c.points.filter((p) => ['start', 'restart', 'step-up', 'override', 'stop'].includes(p.kind)).map((p) => ({ date: p.date, compoundId: c.id, name: c.name, kind: p.kind === 'stop' ? 'stop' : p.kind === 'start' || p.kind === 'restart' ? 'start' : 'change', dose: p.to != null ? `${p.to} ${p.unit || ''}`.trim() : null })))
    const alcohol = Object.entries(habitLogs || {}).filter(([, v]) => v?.alcohol).map(([d]) => d)
    const sedatives = (asNeededLogs || []).filter((l) => /temazepam|diazepam|restavit/i.test(l.name || '')).map((l) => ({ date: String(l.at || '').slice(0, 10), name: l.name }))
    const overlap = contextLine({ key: 'both', label: '', compoundId: null, name: null, dose: null, unit: null, ranges: [w.old, w.new], colour: -1 }, { events, sauna: (saunaSessions || []).map((s) => s.date), alcohol, sedatives, weights: [] })
      .replace('Also in this period', 'Also across the two sides')
    return { w, cmp, body, answer, toName, fromName, doseRows, overlap }
  }, [sw, h, transition, measurements, reactions, injectionRecords, saunaSessions, habitLogs, asNeededLogs])

  if (!sw || !data) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold" style={soft}><ChevronLeft size={16} /> Heart</button>
        <p className="card p-4 text-sm font-medium" style={soft}>This switch is no longer recorded.</p>
      </div>
    )
  }
  const { w, cmp, body, answer } = data
  const pdf = async () => {
    setBusy(true)
    try {
      const [{ heartReportPdf }, { deliverPdf, reportName }] = await Promise.all([import('../../lib/pdf/reports'), import('../../lib/pdf/deliver')])
      const bytes = heartReportPdf(heartReportData(h, data, sw, measurements))
      await deliverPdf(reportName('heart-summary', h.today), bytes)
    } catch (err) {
      const { logError } = await import('../../lib/errorLog')
      logError(err, { kind: 'report', where: 'heart summary' })
      showToast('The summary could not be made')
    }
    setBusy(false)
  }
  const perWeek = (v) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} kg`)
  return (
    <div className="space-y-6" data-testid="switch-screen">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="flex items-center gap-1 rounded-full px-2 py-1.5 text-sm font-bold" style={soft} data-testid="switch-back"><ChevronLeft size={16} /> Heart</button>
        <h1 className="min-w-0 flex-1 truncate text-right text-[17px] font-semibold">{data.fromName} to {data.toName}</h1>
      </div>

      <section className="card p-5" data-testid="switch-answer-card">
        <AnswerLine testid="switch-answer">{answer}</AnswerLine>
        <p className="mt-2 text-sm font-medium tabular-nums" style={soft} data-testid="switch-counts">
          Before: {day(w.old[0])} to {day(w.old[1])}{w.oldDose ? ` at ${w.oldDose}` : ''}, {cmp.nBefore} nights. After: from {day(w.new[0])}, {cmp.nAfter} nights.
        </p>
        {cmp.early && <p className="mt-1 flex items-center gap-2 text-sm font-medium" style={soft} data-testid="switch-early"><StatusDot label="Early" /> Until each side has {HEART.switchEarlyNights} nights.</p>}
        {w.inTransition && <p className="mt-1 text-sm font-medium" style={soft}>Still in the transition window until {day(w.new[0])}.</p>}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[13px] font-medium" style={muted}>Transition left out</span>
          {HEART.transitionOptions.map((n) => (
            <button key={n} onClick={() => setHeart({ transitionDays: n })} aria-pressed={transition === n} data-testid={`transition-${n}`}
              className="min-h-[30px] rounded-full px-2.5 text-xs font-bold tabular-nums" style={transition === n ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)' }}>{n} d</button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <h2 className="min-w-0 flex-1 text-[17px] font-semibold">Before and after</h2>
          <InfoButton title="Before and after"><p>Before: the last 4 weeks of {data.fromName} at its final dose. After: {data.toName} once the transition window is over. Grey dot before, coloured dot after: green the better way, amber the other. Associations, not causes.</p></InfoButton>
        </div>
        <div className="card rows px-4 py-1" data-testid="switch-rows">
          {cmp.rows.map((r) => (
            <div key={r.key} className="flex items-center gap-3 py-2.5" data-testid={`switch-row-${r.key}`} data-tone={r.tone}>
              <span className="w-[112px] shrink-0 text-[15px] font-medium">{r.label}</span>
              <DotPlot row={r} />
              <span className="w-[96px] shrink-0 text-right text-[15px] font-semibold tabular-nums">
                {r.before ? r.before.mean.toFixed(r.dp) : '–'}<span style={muted}> → </span><span style={{ color: TONE[r.tone] }}>{r.after ? r.after.mean.toFixed(r.dp) : '–'}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-[17px] font-semibold">Body</h2>
        <div className="card rows px-4 py-1" data-testid="switch-body">
          <div className="flex items-baseline gap-2 py-2.5"><span className="min-w-0 flex-1 text-[15px] font-medium">Weight a week</span><span className="text-[15px] font-semibold tabular-nums">{perWeek(body.weight.before)} → {perWeek(body.weight.after)}</span></div>
          <div className="flex items-baseline gap-2 py-2.5"><span className="min-w-0 flex-1 text-[15px] font-medium">Fat mass a week (Evolt)</span><span className="text-[15px] font-semibold tabular-nums">{perWeek(body.fat.before)} → {perWeek(body.fat.after)}</span></div>
          <div className="flex items-baseline gap-2 py-2.5"><span className="min-w-0 flex-1 text-[15px] font-medium">Injection reactions logged</span><span className="text-[15px] font-semibold tabular-nums">{body.reactions.before} → {body.reactions.after}</span></div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-[17px] font-semibold">Each compound by dose</h2>
        <p className="px-1 text-[13px] font-medium" style={muted} data-testid="switch-no-equivalence">{NO_EQUIVALENCE}</p>
        <div className="card rows px-4 py-1" data-testid="switch-dose-rows">
          {data.doseRows.map((r) => (
            <div key={r.period.key} className="py-2.5">
              <p className="text-[15px] font-medium">{r.period.label}</p>
              <p className="text-[13px] font-medium tabular-nums" style={soft}>
                {['rhr', 'sleepHR', 'wakeUps'].map((k) => {
                  const s = r.cells[k].stat
                  const m = h.metrics.find((x) => x.key === k)
                  return `${m.label} ${s ? s.mean.toFixed(m.dp) : '–'}${s ? ` (${s.n})` : ''}`
                }).join(' · ')}
              </p>
            </div>
          ))}
        </div>
        <p className="px-1 text-[13px] font-medium" style={soft} data-testid="switch-overlap">{data.overlap}</p>
      </section>

      <div className="flex gap-2">
        <button onClick={pdf} disabled={busy} className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-black disabled:opacity-60" style={{ background: 'var(--surface-sunk)' }} data-testid="switch-pdf">
          <FileText size={15} /> {busy ? 'Making' : 'Doctor summary (PDF)'}
        </button>
        <button onClick={() => { removeSwitch(sw.id); onBack() }} aria-label="Stop tracking this switch" className="flex min-h-[44px] w-12 items-center justify-center rounded-full" style={{ background: 'var(--surface-sunk)' }} data-testid="switch-remove"><Trash2 size={16} /></button>
      </div>
    </div>
  )
}

/** The plain numbers for the doctor summary: every period by compound and dose, with dates and n, and the switch. */
export function heartReportData(h, data, sw, measurements) {
  const weights = measurements.filter((m) => typeof m.weight === 'number' && !m.hiddenFromCharts && m.source !== 'scan').map((m) => ({ date: m.date, value: m.weight }))
  const pick = (s) => (s ? { mean: s.mean, lo: s.lo, hi: s.hi, n: s.n } : null)
  return {
    generatedOn: h.today,
    reference: h.reference,
    periods: h.table.rows.map((r) => ({
      label: r.period.label,
      ranges: r.period.ranges,
      rhr: pick(r.cells.rhr.stat), sleepHR: pick(r.cells.sleepHR.stat), wakeUps: pick(r.cells.wakeUps.stat),
      weightPerWeek: slopePerWeek(weights.filter((w) => inRanges(w.date, r.period.ranges))),
    })),
    switch: data ? {
      from: data.fromName, to: data.toName, date: sw.date, answer: data.answer, early: data.cmp.early, nBefore: data.cmp.nBefore, nAfter: data.cmp.nAfter,
      old: data.w.old, new: data.w.new, overlap: data.overlap,
      rows: data.cmp.rows.map((r) => ({ label: r.label, unit: r.unit, dp: r.dp, before: pick(r.before), after: pick(r.after) })),
      weight: data.body.weight, fat: data.body.fat, reactions: data.body.reactions,
    } : null,
  }
}
