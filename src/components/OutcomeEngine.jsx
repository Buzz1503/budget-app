import { useMemo, useState } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import {
  METRICS, METRIC_BY_KEY, metricSeries, rollingAverage, subjectiveSeries,
  peptideDoseSeries, peptideEvents,
} from '../lib/metrics'
import { addDaysStr, daysBetween } from '../lib/schedule'
import { formatDose } from '../lib/calc'

const OUTCOME_OPTIONS = [
  { key: 'subjective', label: 'Wellbeing (symptoms)', unit: '', color: 'var(--lime)' },
  ...METRICS.filter((m) => ['weight', 'visceralFat', 'muscleMass', 'bodyFat', 'waist'].includes(m.key)),
]

export default function OutcomeEngine() {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const measurements = useStore((s) => s.measurements)
  const symptomLogs = useStore((s) => s.symptomLogs)
  const t = todayStr()

  const [peptideId, setPeptideId] = useState(peptides[0]?.id)
  const [metricKey, setMetricKey] = useState('subjective')
  const peptide = peptides.find((p) => p.id === peptideId) || peptides[0]
  const outcome = OUTCOME_OPTIONS.find((o) => o.key === metricKey) || OUTCOME_OPTIONS[0]

  const { data, events, hasOutcome } = useMemo(() => {
    if (!peptide) return { data: [], events: [], hasOutcome: false }
    // range: peptide start (capped to 120d) → today
    const span = Math.min(120, Math.max(28, daysBetween(peptide.startDate, t)))
    const from = addDaysStr(t, -span)
    const doseSeries = peptideDoseSeries(peptide, titration[peptide.id], from, t)
    const maxDose = Math.max(1, ...doseSeries.map((d) => d.dose))

    let outSeries
    if (metricKey === 'subjective') outSeries = subjectiveSeries(symptomLogs)
    else {
      const raw = metricSeries(measurements, metricKey)
      outSeries = metricKey === 'weight' ? rollingAverage(raw, 7) : raw
    }
    const outByDate = Object.fromEntries(outSeries.filter((p) => p.date >= from).map((p) => [p.date, p.value]))

    const data = doseSeries.map((d) => ({
      date: d.date,
      label: format(parseISO(d.date), 'd MMM'),
      dose: d.dose,
      doseNorm: (d.dose / maxDose) * 100,
      outcome: outByDate[d.date] ?? null,
    }))
    const events = peptideEvents(peptide, titration[peptide.id], from, t)
    return { data, events, hasOutcome: Object.keys(outByDate).length > 0 }
  }, [peptide, titration, measurements, symptomLogs, metricKey, t])

  if (!peptide) return null

  return (
    <div className="space-y-2.5">
      <div className="card p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Peptide</p>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {peptides.map((p) => (
            <button key={p.id} onClick={() => setPeptideId(p.id)}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
              style={peptideId === p.id
                ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {p.name}
            </button>
          ))}
        </div>

        <p className="mb-2 mt-3 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Against</p>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {OUTCOME_OPTIONS.map((o) => (
            <button key={o.key} onClick={() => setMetricKey(o.key)}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
              style={metricKey === o.key
                ? { backgroundImage: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#fff' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-3">
        <p className="mb-1 text-sm font-bold">{peptide.name} × {outcome.label}</p>
        {!hasOutcome ? (
          <p className="py-8 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            {metricKey === 'subjective'
              ? 'No symptom check-ins yet — log some in Symptoms to overlay wellbeing here.'
              : `No ${outcome.label.toLowerCase()} entries yet — add measurements to overlay them.`}
          </p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="oe-dose" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--violet)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--violet)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
                <YAxis yAxisId="out" tick={{ fontSize: 9, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="dose" orientation="right" hide domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: 'var(--muted)' }}
                  formatter={(v, name) => {
                    if (name === 'doseNorm') return [null, null]
                    return [v, outcome.label]
                  }}
                />
                <Area yAxisId="dose" type="stepAfter" dataKey="doseNorm" name="doseNorm" stroke="var(--violet)" strokeWidth={1.5} fill="url(#oe-dose)" isAnimationActive={false} />
                <Line yAxisId="out" type="monotone" dataKey="outcome" stroke={outcome.color} strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls isAnimationActive={true} />
                {events.map((e, i) => (
                  <ReferenceLine key={i} yAxisId="out" x={format(parseISO(e.date), 'd MMM')}
                    stroke={e.kind === 'step-up' ? 'var(--violet)' : e.kind === 'cycle-start' ? 'var(--lime)' : 'var(--amber)'}
                    strokeDasharray="3 3"
                    label={{ value: e.label, fontSize: 8, fill: 'var(--muted)', position: 'insideTopLeft' }} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-bold" style={{ color: 'var(--muted)' }}>
          <span className="flex items-center gap-1"><span className="h-2 w-4 rounded" style={{ background: outcome.color }} /> {outcome.label}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-4 rounded" style={{ background: 'var(--violet)' }} /> {peptide.name} dose / cycle</span>
        </div>
        <p className="mt-2 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
          Dashed lines mark cycle on/off and titration step-ups. Overlaps are observations from your own logs, not medical conclusions.
        </p>
      </div>
    </div>
  )
}
