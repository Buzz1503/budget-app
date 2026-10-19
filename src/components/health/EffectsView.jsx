import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { Stagger, StaggerItem } from '../ui/Motion'
import { compoundEffects, trackedForEffects, FAMILY_NAME } from '../../health/engine/compoundEffects'
import { METRIC_INFO, BODY_METRICS } from '../../health/engine/phases'
import { COMPARE } from '../../health/engine/config'
import { dailySeries, seriesByFamily } from '../../body/bodySeries'
import { evoltScans } from '../../body/composition'
import { laneFor } from '../../body/lanes'
import { useBodyInput } from '../../lib/useBody'
import { useCompounds } from '../../lib/useCompounds'
import TrendChart from '../charts/TrendChart'
import useHealthModel from './useHealthModel'

const pretty = (d) => format(parseISO(d), 'd MMM yyyy')
const short = (d) => format(parseISO(d), 'd MMM')

/** Every series the Effects pages read, as dated values. */
export function useEffectInput() {
  const input = useBodyInput()
  const connected = useStore((s) => s.healthSettings.connected)
  const model = useHealthModel()
  return useMemo(() => {
    const pick = (field) => dailySeries(field, input).map((p) => ({ date: p.date, value: p.value }))
    const abdominal = pick('abdominalCircumference')
    const tape = pick('waist')
    const series = {
      weight: pick('weight'),
      // waist: the Evolt abdominal circumference when there is one, else the tape waist (never mixed)
      waist: abdominal.length >= tape.length ? abdominal : tape,
      visceralFatLevel: pick('visceralFatLevel'),
    }
    const fam = (field) => Object.fromEntries(Object.entries(seriesByFamily(field, input)).map(([k, v]) => [k, v.map((p) => ({ date: p.date, value: p.value }))]))
    const families = { bodyFat: fam('bodyFat'), fatMass: fam('fatMass'), leanMass: fam('leanMass') }
    if (connected && model.hasData) {
      const fromMap = (m) => [...m.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date))
      series.rhr = fromMap(model.series.rhr)
      series.hrv = fromMap(model.series.hrv)
      series.sleep = fromMap(model.series.sleep)
      const nights = [...model.nightBy.values()].sort((a, b) => a.date.localeCompare(b.date))
      series.deepSleep = nights.filter((n) => n.hasStages).map((n) => ({ date: n.date, value: n.deepMin }))
      series.sleepScore = nights.map((n) => ({ date: n.date, value: model.sleepScore(n.date)?.score })).filter((p) => p.value != null)
      const days = [...new Set([...model.series.hrv.keys(), ...model.series.rhr.keys()])].sort()
      series.readiness = days.map((d) => ({ date: d, value: model.readiness(d).score })).filter((p) => p.value != null)
    }
    return { series, families }
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

function EffectRows({ rows, onOpen }) {
  return (
    <div className="rows">
      {rows.map((r) => (
        <button key={r.metric} onClick={() => onOpen?.(r)} className="flex w-full items-start gap-2 py-2.5 text-left" data-testid="effect-row" data-metric={r.metric}>
          <span className="min-w-0 flex-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>
            {r.text}.{r.family ? <span style={{ color: 'var(--text-3)' }}> {FAMILY_NAME[r.family] ? `From ${FAMILY_NAME[r.family]}.` : ''}</span> : null}
          </span>
          <LabelChip label={r.label} />
        </button>
      ))}
    </div>
  )
}

/** A small step line of the dose across the time on the compound. */
function DoseStrip({ compound, from, to }) {
  const lane = laneFor(compound.points, compound.runs, from, to)
  if (!lane.segments.length) return null
  const W = 320
  const H = 40
  const d0 = Date.parse(`${from}T00:00:00Z`)
  const d1 = Date.parse(`${to}T00:00:00Z`)
  const x = (d) => 4 + ((Date.parse(`${d}T00:00:00Z`) - d0) / Math.max(1, d1 - d0)) * (W - 8)
  const y = (v) => H - 6 - (lane.maxDose ? (v / lane.maxDose) * (H - 18) : 0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" aria-label="Dose over time" data-testid="dose-strip">
      {lane.segments.map((s, i) => <line key={i} x1={x(s.from)} x2={x(s.to)} y1={y(s.dose)} y2={y(s.dose)} stroke="var(--text)" strokeWidth="2" />)}
      {lane.changes.map((c) => <text key={c.date} x={Math.min(W - 30, x(c.date))} y="9" fontSize="8" fontWeight="700" fill="var(--text-2)">{c.label}</text>)}
    </svg>
  )
}

function ScanDeltas({ start, end }) {
  const measurements = useStore((s) => s.measurements)
  const scans = evoltScans(measurements)
  const before = [...scans].reverse().find((s) => s.date < start)
  const during = scans.filter((s) => s.date >= start && s.date <= end)
  if (!before && !during.length) return null
  const d = (s, k) => (before && typeof s[k] === 'number' && typeof before[k] === 'number' ? s[k] - before[k] : null)
  const sg = (v) => (v == null ? '' : ` (${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)})`)
  return (
    <section className="card p-4" data-testid="effects-scans">
      <h3 className="text-sm font-black">Evolt scans</h3>
      <div className="mt-2 rows">
        {before && (
          <p className="py-2 text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            <b style={{ color: 'var(--text)' }}>{pretty(before.date)}</b>, before starting · {before.weight} kg · fat {before.fatMass} kg · lean {before.leanMass} kg
          </p>
        )}
        {during.map((s) => (
          <p key={s.id} className="py-2 text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="effects-scan">
            <b style={{ color: 'var(--text)' }}>{pretty(s.date)}</b> · {s.weight} kg{sg(d(s, 'weight'))} · fat {s.fatMass} kg{sg(d(s, 'fatMass'))} · lean {s.leanMass} kg{sg(d(s, 'leanMass'))}
          </p>
        ))}
      </div>
      {before && during.length > 0 && <p className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Changes in brackets are against the last scan before starting.</p>}
    </section>
  )
}

/** One compound's page: since starting, overlaps, clean windows, scans. */
export function CompoundEffectsDetail({ compound, fx, input, onBack }) {
  const [open, setOpen] = useState(null)
  const t = todayStr()
  const current = laneFor(compound.points, compound.runs, fx.run.start, fx.run.end).segments.at(-1)
  const lastChange = [...compound.points].filter((p) => ['start', 'restart', 'prior', 'step-up', 'override'].includes(p.kind) && p.date <= t).sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  const atDose = lastChange ? Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${lastChange.date}T00:00:00Z`)) / 86400000) : null
  const info = open ? METRIC_INFO[open.metric] : null
  const series = open ? (open.family ? input.families[open.metric]?.[open.family] : input.series[open.metric]) || [] : []

  return (
    <div className="space-y-4" data-testid="compound-effects">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold" style={{ color: 'var(--text-2)' }} data-testid="effects-back"><ChevronLeft size={16} /> All compounds</button>
      )}
      <section className="card p-5">
        <h2 className="text-2xl font-black tracking-tight">{compound.name}</h2>
        <p className="mt-1 text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
          {pretty(fx.run.start)} to {fx.run.ongoing ? 'now' : pretty(fx.run.end)} · {fx.on.days} {fx.on.days === 1 ? 'day' : 'days'}
        </p>
        {current && (
          <p className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            {fx.run.ongoing ? 'Now' : 'Last'} {current.dose}{current.unit ? ` ${current.unit}` : ''}{atDose != null && fx.run.ongoing ? (atDose === 0 ? ', from today' : `, ${atDose} day${atDose === 1 ? '' : 's'} at this dose`) : ''}
          </p>
        )}
        <DoseStrip compound={compound} from={fx.run.start} to={fx.run.end} />
      </section>

      {fx.overlapText && (
        <section className="rounded-[14px] p-4" style={{ background: 'var(--surface-sunk)' }} data-testid="effects-overlap">
          <p className="text-sm font-bold leading-snug">{fx.overlapText}</p>
          <div className="mt-2 space-y-0.5">
            {fx.overlaps.map((o, i) => (
              <p key={i} className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>{o.name}: {o.kind === 'start' ? 'started' : o.kind === 'stop' ? 'stopped' : 'dose changed'} {pretty(o.date)}</p>
            ))}
          </div>
        </section>
      )}

      <section className="card px-4 pb-2 pt-4" data-testid="effects-since">
        <h3 className="text-base font-black">Since starting</h3>
        <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          {pretty(fx.before.from)} to {pretty(fx.before.to)} against time on it. Each change is judged against how much that number usually moves.
        </p>
        <EffectRows rows={fx.rows} onOpen={setOpen} />
      </section>

      <section className="card px-4 pb-2 pt-4" data-testid="effects-clean">
        <h3 className="text-base font-black">Clean windows</h3>
        {fx.clean.length === 0 ? (
          <p className="py-2 text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="effects-no-clean">No clean windows yet. Every change so far overlapped with another compound.</p>
        ) : (
          <>
            <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Dose changes with no other compound changing within 14 days either side: the only reads that belong to {compound.name} alone.</p>
            {fx.clean.map((w) => (
              <div key={w.date} className="mt-3" data-testid="clean-window">
                <p className="text-sm font-bold tabular-nums">{w.event.kind === 'stop' ? 'Stopped' : `To ${w.event.dose}`}, {pretty(w.date)}</p>
                <p className="text-[11px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>{short(w.before.from)} to {short(w.before.to)} against {short(w.after.from)} to {short(w.after.to)}</p>
                <EffectRows rows={w.rows} />
              </div>
            ))}
          </>
        )}
      </section>

      <ScanDeltas start={fx.run.start} end={fx.run.end} />
      <p className="px-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{COMPARE.caveat} Descriptive only, not medical advice.</p>

      <Modal open={!!open} onClose={() => setOpen(null)} title={info?.label || ''} wide>
        {open && (
          <TrendChart metric={open.metric} chartType={`effects-${open.metric}`} title={info.label} unit={info.unit}
            dp={info.dp === 0 ? 0 : 1} series={series} window={{ from: fx.before.from, to: fx.on.to }}
            events={[{ date: fx.run.start, text: `Started ${compound.name}` }]}
            note={open.family ? `From ${FAMILY_NAME[open.family] || open.family}.` : BODY_METRICS.includes(open.metric) ? 'Weekly trend before and on the compound.' : null} />
        )}
      </Modal>
    </div>
  )
}

/**
 * Body › Effects: the tracked compounds, each with its clearest change since
 * starting. Tapping one opens its page.
 */
export default function EffectsView() {
  const compounds = useCompounds()
  const input = useEffectInput()
  const t = todayStr()
  const [openId, setOpenId] = useState(null)
  const list = useMemo(() => trackedForEffects(compounds)
    .map((c) => ({ c, fx: compoundEffects(c, compounds, input, t) }))
    .sort((a, b) => (b.fx?.run.start || '').localeCompare(a.fx?.run.start || '')), [compounds, input, t])

  const picked = list.find((x) => x.c.id === openId)
  if (picked?.fx) return <CompoundEffectsDetail compound={picked.c} fx={picked.fx} input={input} onBack={() => setOpenId(null)} />

  if (!list.length) {
    return (
      <div className="card p-5" data-testid="effects-empty">
        <p className="text-base font-black">No compounds are tracked yet</p>
        <p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-2)' }}>Turn on Track effects for a compound in More › Health.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="effects-view">
      <p className="px-1 text-sm font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
        For each compound, the time before it against the time on it. Shared changes are called out; descriptive only.
      </p>
      <Stagger className="card rows overflow-hidden">
        {list.map(({ c, fx }) => {
          const dose = fx ? laneFor(c.points, c.runs, fx.run.start, fx.run.end).segments.at(-1) : null
          return (
            <StaggerItem key={c.id} as="button" onClick={() => fx && setOpenId(c.id)} disabled={!fx}
              className="flex w-full items-center gap-3 p-4 text-left" data-testid="effects-compound" data-compound={c.id}>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-black">{c.name}</span>
                <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {fx ? `${pretty(fx.run.start)} to ${fx.run.ongoing ? 'now' : pretty(fx.run.end)}${dose ? ` · ${dose.dose}${dose.unit ? ` ${dose.unit}` : ''}` : ''}` : 'Not started yet'}
                </span>
                {fx?.headline && (
                  <span className="mt-1 block text-xs font-medium" style={{ color: 'var(--text-2)' }} data-testid="effects-headline">{METRIC_INFO[fx.headline.metric].label}</span>
                )}
              </span>
              {fx && <LabelChip label={fx.headline ? fx.headline.label : 'Too early'} />}
              {fx && <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--text-3)' }} />}
            </StaggerItem>
          )
        })}
      </Stagger>
    </div>
  )
}
