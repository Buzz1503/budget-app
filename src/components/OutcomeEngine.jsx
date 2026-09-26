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
import { tenureFor } from '../lib/tenure'

const OUTCOME_OPTIONS = [
  { key: 'subjective', label: 'Wellbeing (symptoms)', unit: '', color: 'var(--good)' },
  ...METRICS.filter((m) => ['weight', 'visceralFat', 'muscleMass', 'bodyFat', 'waist'].includes(m.key)),
]

export default function OutcomeEngine() {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const measurements = useStore((s) => s.measurements)
  const symptomLogs = useStore((s) => s.symptomLogs)
  const doseEvents = useStore((s) => s.doseEvents)
  const runs = useStore((s) => s.runs)
  const t = todayStr()

  // An outcome read against "weeks on compound" is a different question from
  // one read against the calendar, and it is the one people are actually asking.
  const [axis, setAxis] = useState('weeks')

  const [peptideId, setPeptideId] = useState(peptides[0]?.id)
  const [metricKey, setMetricKey] = useState('subjective')
  const peptide = peptides.find((p) => p.id === peptideId) || peptides[0]
  const outcome = OUTCOME_OPTIONS.find((o) => o.key === metricKey) || OUTCOME_OPTIONS[0]

  const { data, events, hasOutcome, tenure, since } = useMemo(() => {
    if (!peptide) return { data: [], events: [], hasOutcome: false, tenure: null, since: null }
    // range: as far back as the compound goes (capped to 120d) → today. Tenure,
    // not the schedule anchor, so a backdated start widens the window.
    const ten = tenureFor(peptide, { runs, todayStr: t })
    const since = peptide.startedOn || peptide.startDate
    const span = Math.min(120, Math.max(28, daysBetween(since, t)))
    const from = addDaysStr(t, -span)
    const doseSeries = peptideDoseSeries(peptide, titration[peptide.id], from, t, { doseEvents })
    const maxDose = Math.max(1, ...doseSeries.map((d) => d.dose))

    let outSeries
    if (metricKey === 'subjective') outSeries = subjectiveSeries(symptomLogs)
    else {
      const raw = metricSeries(measurements, metricKey)
      outSeries = metricKey === 'weight' ? rollingAverage(raw, 7) : raw
    }
    const outByDate = Object.fromEntries(outSeries.filter((p) => p.date >= from).map((p) => [p.date, p.value]))

    const data = doseSeries.map((d) => {
      const weeksOn = daysBetween(since, d.date) / 7
      return {
        date: d.date,
        label: format(parseISO(d.date), 'd MMM'),
        // negative weeks would mean "before you were on it" — left blank rather
        // than drawn as week zero
        weekLabel: weeksOn >= 0 ? `wk ${Math.floor(weeksOn)}` : '',
        dose: d.dose,
        doseNorm: (d.dose / maxDose) * 100,
        outcome: outByDate[d.date] ?? null,
      }
    })
    const events = peptideEvents(peptide, titration[peptide.id], from, t, { doseEvents })
    return { data, events, hasOutcome: Object.keys(outByDate).length > 0, tenure: ten, since }
  }, [peptide, titration, measurements, symptomLogs, doseEvents, runs, metricKey, t])

  if (!peptide) return null

  // A weeks-on axis needs weeks. Under a fortnight every point lands on "wk 0",
  // which stacks the whole series into one column and looks like a bug, so the
  // offer is simply not made until there is a run to read against.
  const weeksUsable = since ? daysBetween(since, t) >= 14 : false
  const axisNow = weeksUsable ? axis : 'date'
  // On the weeks axis the days before the compound started are not week
  // anything — they are dropped rather than crowded onto week zero.
  const chartData = axisNow === 'weeks' ? data.filter((d) => d.weekLabel) : data

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Peptide</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {peptides.map((p) => (
            <button key={p.id} onClick={() => setPeptideId(p.id)}
              className="shrink-0 rounded-full px-3 py-2 text-xs font-bold"
              style={peptideId === p.id
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {p.name}
            </button>
          ))}
        </div>

        <p className="mb-2 mt-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Against</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {OUTCOME_OPTIONS.map((o) => (
            <button key={o.key} onClick={() => setMetricKey(o.key)}
              className="shrink-0 rounded-full px-3 py-2 text-xs font-bold"
              style={metricKey === o.key
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-3">
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold">{peptide.name} × {outcome.label}</p>
            {tenure && (
              <p className="text-xs font-semibold tabular-nums" data-testid="outcome-tenure" style={{ color: 'var(--text-2)' }}>
                {tenure.running ? `${tenure.currentWords} on it` : `${tenure.lifetimeWords} lifetime`}
              </p>
            )}
          </div>
          {weeksUsable && (
            <div className="flex shrink-0 gap-1" data-testid="outcome-axis">
              {[['weeks', 'Weeks on'], ['date', 'Date']].map(([id, label]) => (
                <button key={id} onClick={() => setAxis(id)} data-testid={`axis-${id}`}
                  className="rounded-full px-2.5 py-1 text-xs font-black"
                  style={axisNow === id
                    ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                    : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {!hasOutcome ? (
          <p className="py-8 text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            {metricKey === 'subjective'
              ? 'No symptom check-ins yet — log some in Symptoms to overlay wellbeing here.'
              : `No ${outcome.label.toLowerCase()} entries yet — add measurements to overlay them.`}
          </p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 6, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="oe-dose" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--text)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--text)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <XAxis dataKey={axisNow === 'weeks' ? 'weekLabel' : 'label'} tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
                <YAxis yAxisId="out" tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="dose" orientation="right" hide domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-2)' }}
                  formatter={(v, name) => {
                    if (name === 'doseNorm') return [null, null]
                    return [v, outcome.label]
                  }}
                />
                <Area yAxisId="dose" type="stepAfter" dataKey="doseNorm" name="doseNorm" stroke="var(--text)" strokeWidth={1.5} fill="url(#oe-dose)" isAnimationActive={false} />
                <Line yAxisId="out" type="monotone" dataKey="outcome" stroke={outcome.color} strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls isAnimationActive={true} />
                {events.map((e, i) => (
                  <ReferenceLine key={i} yAxisId="out"
                    x={axisNow === 'weeks'
                      ? (chartData.find((d) => d.date === e.date)?.weekLabel || format(parseISO(e.date), 'd MMM'))
                      : format(parseISO(e.date), 'd MMM')}
                    stroke={e.kind === 'step-up' ? 'var(--text)' : e.kind === 'cycle-start' ? 'var(--good)' : 'var(--warn)'}
                    strokeDasharray="3 3"
                    label={{ value: e.label, fontSize: 8, fill: 'var(--text-2)', position: 'insideTopLeft' }} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
          <span className="flex items-center gap-1"><span className="h-2 w-4 rounded" style={{ background: outcome.color }} /> {outcome.label}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-4 rounded" style={{ background: 'var(--text)' }} /> {peptide.name} dose / cycle</span>
        </div>
        <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
          Dashed lines mark cycle on/off and every dose change that was recorded. Reading it against weeks on
          compound lines this run up with any other; reading it against the date lines it up with the rest of
          your life. Overlaps are observations from your own logs, not medical conclusions.
        </p>
      </div>
    </div>
  )
}
