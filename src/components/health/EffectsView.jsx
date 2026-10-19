import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { phaseViews, METRIC_INFO, describeChanges, tracksEffects } from '../../health/engine/phases'
import { dailySeries } from '../../body/bodySeries'
import { useBodyInput, useBodyStart } from '../../lib/useBody'
import { getStartValue } from '../../body/startPoint'
import { useCompounds } from '../../lib/useCompounds'
import TrendChart from '../charts/TrendChart'
import useHealthModel from './useHealthModel'

const BODY_KEYS = ['weight', 'fatMass', 'leanMass', 'bodyFat', 'waist']
const pretty = (d) => format(parseISO(d), 'd MMM yyyy')

/** Every metric the Effects view reads, as dated values. */
function useEffectSeries() {
  const input = useBodyInput()
  const connected = useStore((s) => s.healthSettings.connected)
  const model = useHealthModel()
  return useMemo(() => {
    const out = {}
    for (const k of BODY_KEYS) {
      const s = dailySeries(k, input)
      if (s.length) out[k] = s.map((p) => ({ date: p.date, value: p.value, source: p.source, sourceLabel: p.sourceLabel }))
    }
    if (connected && model.hasData) {
      const fromMap = (m) => [...m.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date))
      if (model.series.rhr.size) out.rhr = fromMap(model.series.rhr)
      if (model.series.hrv.size) out.hrv = fromMap(model.series.hrv)
      if (model.series.sleep.size) out.sleep = fromMap(model.series.sleep)
      const days = [...new Set([...model.series.hrv.keys(), ...model.series.rhr.keys()])].sort()
      const ready = days.map((d) => ({ date: d, value: model.readiness(d).score })).filter((p) => p.value != null)
      if (ready.length) out.readiness = ready
    }
    return out
  }, [input, connected, model])
}

function LabelChip({ label }) {
  const clear = label === 'Clear change'
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" data-testid="effect-label" data-label={label}
      style={clear ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
      {label}
    </span>
  )
}

export function PhaseCard({ phase, onOpen }) {
  return (
    <div className="card p-4" data-testid="phase-card" data-from={phase.from}>
      <p className="text-sm font-black leading-snug" data-testid="phase-title">{phase.title}</p>
      <p className="mt-0.5 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
        {pretty(phase.from)} to {phase.to === todayStr() ? 'today' : pretty(phase.to)} · {phase.days} {phase.days === 1 ? 'day' : 'days'}
      </p>
      {phase.combinedNote && (
        <p className="mt-2 rounded-[10px] p-2 text-xs font-medium leading-snug" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="phase-combined">
          {phase.combinedNote}
        </p>
      )}
      <div className="mt-2 rows">
        {phase.rows.length === 0 && <p className="py-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>No readings in this phase.</p>}
        {phase.rows.map((r) => (
          <button key={r.metric} onClick={() => onOpen(r.metric)} className="flex w-full items-start gap-2 py-2.5 text-left" data-testid="phase-row" data-metric={r.metric}>
            <span className="min-w-0 flex-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>{r.text}.</span>
            <LabelChip label={r.label} />
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Body › Measurements › Effects: the stretches between protocol changes,
 * newest first, and how each metric moved compared with the stretch before.
 * With `compoundId`, only the phases where that compound changed.
 */
export default function EffectsView({ compoundId = null, compact = false }) {
  const compounds = useCompounds()
  const series = useEffectSeries()
  const t = todayStr()
  const [open, setOpen] = useState(null)
  const bodyStart = useBodyStart()
  const bodyInput = useBodyInput()
  const views = useMemo(() => phaseViews({ compounds, series, today: t }), [compounds, series, t])
  const shown = compoundId ? views.filter((v) => v.events.some((e) => e.compoundId === compoundId)) : views
  const tracked = compounds.filter(tracksEffects)

  const openPhase = open ? views.find((v) => v.from === open.from) : null
  const prev = openPhase ? views.find((v) => v.index === openPhase.index - 1) : null
  const info = open ? METRIC_INFO[open.metric] : null
  const pins = openPhase ? openPhase.events.map((e) => ({ date: e.date, text: describeChanges([e]) })) : []

  if (!compact && !tracked.length) {
    return (
      <div className="card p-4" data-testid="effects-empty">
        <p className="text-sm font-bold">No compounds are tracked yet</p>
        <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>Turn on Track effects for a compound in More › Health.</p>
      </div>
    )
  }
  if (!Object.keys(series).length) {
    return compact ? null : (
      <div className="card p-4" data-testid="effects-empty">
        <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No body or Health readings yet. Phases appear once there is something to compare.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="effects-view">
      {!compact && (
        <p className="px-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>
          Each phase runs from one protocol change to the next. Each row compares it with the phase before, against how much that number usually moves day to day. Descriptive only, not medical advice.
        </p>
      )}
      {shown.map((p) => <PhaseCard key={p.from} phase={p} onOpen={(metric) => setOpen({ from: p.from, metric })} />)}
      {compact && shown.length === 0 && <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>No phases start with this compound yet.</p>}

      <Modal open={!!openPhase} onClose={() => setOpen(null)} title={info?.label || ''} wide>
        {openPhase && (
          <div className="space-y-2" data-testid="effects-chart">
            <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
              {prev ? `${pretty(prev.from)} to ${openPhase.to === t ? 'today' : pretty(openPhase.to)}: the phase before and this one.` : 'This phase.'}
            </p>
            <TrendChart metric={open.metric} chartType={`effects-${open.metric}`} title={info.label} unit={info.unit}
              dp={info.dp === 0 ? 0 : 1} series={series[open.metric] || []} events={pins}
              window={{ from: prev ? prev.from : openPhase.from, to: openPhase.to }}
              startLine={BODY_KEYS.includes(open.metric) ? getStartValue(open.metric, bodyStart, bodyInput) : null} />
          </div>
        )}
      </Modal>
    </div>
  )
}
