import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Activity, Layers, Scan } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { Stagger, StaggerItem } from '../ui/Motion'
import { trackedForEffects, FAMILY_NAME } from '../../health/engine/compoundEffects'
import useComputed from '../../lib/compute/useComputed'
import { METRIC_INFO, BODY_METRICS } from '../../health/engine/phases'
import { COMPARE, PHASES } from '../../health/engine/config'
import { dailySeries, seriesByFamily } from '../../body/bodySeries'
import { evoltScans } from '../../body/composition'
import { laneFor } from '../../body/lanes'
import { useBodyInput } from '../../lib/useBody'
import { useCompounds } from '../../lib/useCompounds'
import TrendChart from '../charts/TrendChart'
import useHealthModel from './useHealthModel'
import SaunaEffectsView from './SaunaEffectsView'
import { AnswerLine, DeltaChip, InfoButton, ProgressRow, SectionTitle, StatusDot, StatusLegend } from '../ui/Glance'
import { toneFor } from '../../lib/glance'

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

const famWord = (r) => (r.family && FAMILY_NAME[r.family] ? `, ${FAMILY_NAME[r.family]}` : '')
const sig = (v, dp) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Number(v.toFixed(dp)))}`

/** The answer a compound's page leads with: its clearest change, in words. */
export function effectAnswer(row) {
  if (!row || row.label === 'Too early' || !row.now?.ok) return 'Too early to say.'
  const info = METRIC_INFO[row.metric]
  if (row.kind === 'body') {
    const v = row.now.value
    if (Math.abs(v) < PHASES.steadyPerWeek) return `${info.label} is steady.`
    return `${info.label} is ${v > 0 ? 'rising' : 'falling'} ${Math.abs(Number(v.toFixed(2)))} ${info.rateUnit} a week.`
  }
  if (!row.before?.ok) return `${info.label} averages ${Number(row.now.value.toFixed(info.dp))}${info.unit ? ` ${info.unit}` : ''}.`
  const d = Number((row.now.value - row.before.value).toFixed(info.dp))
  if (d === 0) return `${info.label} is about the same as before.`
  return `${info.label} is ${d > 0 ? 'up' : 'down'} ${Math.abs(d)}${info.unit ? ` ${info.unit}` : ''} on before.`
}

/** One stat row per measure; everything too early collapses into one progress row. */
function EffectRows({ rows, onOpen, daysOn }) {
  const ready = rows.filter((r) => r.label !== 'Too early' && r.now?.ok)
  const early = rows.length - ready.length
  return (
    <div className="rows">
      {ready.map((r) => {
        const info = METRIC_INFO[r.metric]
        const body = r.kind === 'body'
        const before = r.before?.ok ? r.before.value : null
        const now = r.now.value
        // body rows read as a weekly rate; daily rows as before → now
        const value = body
          ? <>{sig(now, 2)}<span className="ml-0.5 text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{info.rateUnit}/wk</span></>
          : <>{before != null && <><span style={{ color: 'var(--text-2)' }}>{Number(before.toFixed(info.dp))}</span><span className="mx-1" style={{ color: 'var(--text-3)' }}>→</span></>}{Number(now.toFixed(info.dp))}{info.unit && <span className="ml-0.5 text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{info.unit}</span>}</>
        const delta = body ? now : before != null ? now - before : null
        return (
          <button key={`${r.metric}-${r.family || ''}`} onClick={() => onOpen?.(r)} className="flex w-full items-center gap-3 py-3 text-left" data-testid="effect-row" data-metric={r.metric}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{info.label}<span style={{ color: 'var(--text-3)' }}>{famWord(r)}</span></span>
              <span className="mt-0.5 block" data-testid="effect-label" data-label={r.label}><StatusDot label={r.label} /></span>
            </span>
            <span className="shrink-0 whitespace-nowrap text-[17px] font-semibold tabular-nums">{value}</span>
            {delta != null && !body && <DeltaChip metric={r.metric} delta={delta} dp={info.dp} />}
            {body && <span className="h-2 w-2 shrink-0 rounded-full" aria-hidden="true" style={{ background: toneFor(r.metric, now, PHASES.steadyPerWeek) === 'better' ? 'var(--good)' : toneFor(r.metric, now, PHASES.steadyPerWeek) === 'worse' ? 'var(--warn)' : 'var(--text-3)' }} />}
          </button>
        )
      })}
      {early > 0 && (
        <ProgressRow testid="effects-early"
          text={`${early} ${early === 1 ? 'measure unlocks' : 'measures unlock'} with more days on it${daysOn != null ? ` · ${Math.min(daysOn, PHASES.dailyMinDays)} of ${PHASES.dailyMinDays}` : ''}`}
          have={daysOn ?? 0} need={daysOn != null ? PHASES.dailyMinDays : 0} />
      )}
    </div>
  )
}

const LEGEND = (
  <>
    <p>For each compound, the weeks before it against the time on it. Each change is judged against how much that number usually moves.</p>
    <StatusLegend />
    <p>Green means the move is the better way for that measure, amber the other way. {COMPARE.caveat} Descriptive only, not medical advice.</p>
  </>
)

/** A small step line of the dose across the time on the compound. */
function DoseStrip({ compound, from, to }) {
  const lane = laneFor(compound.points, compound.runs, from, to)
  if (!lane.segments.length) return null
  const W = 320
  const H = 64
  const d0 = Date.parse(`${from}T00:00:00Z`)
  const d1 = Date.parse(`${to}T00:00:00Z`)
  const x = (d) => 4 + ((Date.parse(`${d}T00:00:00Z`) - d0) / Math.max(1, d1 - d0)) * (W - 8)
  const y = (v) => H - 22 - (lane.maxDose ? (v / lane.maxDose) * (H - 40) : 0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" aria-label="Dose over time" data-testid="dose-strip">
      {lane.segments.map((s, i) => <line key={i} x1={x(s.from)} x2={x(s.to)} y1={y(s.dose)} y2={y(s.dose)} stroke="var(--text)" strokeWidth="2" />)}
      {lane.changes.map((c) => <text key={c.date} x={Math.min(W - 40, x(c.date))} y="12" fontSize="12" fontWeight="700" fill="var(--text-2)">{c.label}</text>)}
      <text x={4} y={H - 4} fontSize="12" fontWeight="600" fill="var(--text-3)">{short(from)}</text>
      <text x={W - 4} y={H - 4} fontSize="12" fontWeight="600" textAnchor="end" fill="var(--text-3)">{short(to)}</text>
    </svg>
  )
}

function ScanDeltas({ start, end }) {
  const measurements = useStore((s) => s.measurements)
  const scans = evoltScans(measurements)
  const before = [...scans].reverse().find((s) => s.date < start)
  const during = scans.filter((s) => s.date >= start && s.date <= end)
  const last = during.at(-1)
  if (!before || !last) return null
  const row = (label, k, metric) => (typeof last[k] === 'number' && typeof before[k] === 'number' ? (
    <div className="flex items-center gap-3 py-3" data-testid="effects-scan">
      <span className="min-w-0 flex-1 text-[15px] font-medium">{label}</span>
      <span className="whitespace-nowrap text-[17px] font-semibold tabular-nums"><span style={{ color: 'var(--text-2)' }}>{before[k]}</span><span className="mx-1" style={{ color: 'var(--text-3)' }}>→</span>{last[k]}<span className="ml-0.5 text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>kg</span></span>
      <DeltaChip metric={metric} delta={last[k] - before[k]} unit="kg" dp={1} />
    </div>
  ) : null)
  return (
    <section className="card px-4 pt-3" data-testid="effects-scans">
      <SectionTitle icon={Scan} title="Evolt scans" />
      <p className="mt-1 text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>{short(before.date)}, before starting, to {short(last.date)}</p>
      <div className="rows">
        {row('Weight', 'weight', 'weight')}
        {row('Fat mass', 'fatMass', 'fatMass')}
        {row('Lean mass', 'leanMass', 'leanMass')}
      </div>
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
        <AnswerLine className="mt-3" testid="effects-answer">{effectAnswer(fx.headline)}</AnswerLine>
        {fx.overlapText && <p className="mt-1 text-sm font-medium leading-snug" style={{ color: 'var(--text-2)' }} data-testid="effects-overlap">{fx.overlapText}</p>}
        <DoseStrip compound={compound} from={fx.run.start} to={fx.run.end} />
      </section>

      <section className="card px-4 pb-1 pt-3" data-testid="effects-since">
        <SectionTitle icon={Activity} title="Since starting" infoTitle="Since starting" info={<>
          <p>{pretty(fx.before.from)} to {pretty(fx.before.to)} against the time on it.</p>
          {fx.overlaps.length > 0 && <div className="space-y-0.5">{fx.overlaps.map((o, i) => (
            <p key={i} className="tabular-nums">{o.name}: {o.cycle ? (o.kind === 'start' ? 'back on cycle' : 'off cycle') : o.kind === 'start' ? 'started' : o.kind === 'stop' ? 'stopped' : 'dose changed'} {pretty(o.date)}</p>
          ))}</div>}
          {LEGEND}
        </>} />
        <EffectRows rows={fx.rows} onOpen={setOpen} daysOn={fx.on.days} />
      </section>

      {fx.clean.length > 0 ? (
        <section className="card px-4 pb-1 pt-3" data-testid="effects-clean">
          <SectionTitle icon={Layers} title="Clean windows" infoTitle="Clean windows"
            info={<p>Dose changes with no other compound changing within 14 days either side: the only reads that belong to {compound.name} alone.</p>} />
          {fx.clean.map((w) => (
            <div key={w.date} className="mt-2" data-testid="clean-window">
              <p className="text-[15px] font-semibold tabular-nums">{w.event.kind === 'stop' ? 'Stopped' : `To ${w.event.dose}`}, {short(w.date)}</p>
              <EffectRows rows={w.rows} />
            </div>
          ))}
        </section>
      ) : (
        <div className="card px-4 py-1" data-testid="effects-clean">
          <ProgressRow testid="effects-no-clean" text="Clean windows: none yet, every change overlapped another compound" have={0} need={0} />
        </div>
      )}

      <ScanDeltas start={fx.run.start} end={fx.run.end} />

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
  const saunaCount = useStore((s) => s.saunaSessions.length)
  // worked out in the compute worker and cached by its input: the last list shows at once
  const job = useMemo(() => ({ compounds, input, today: t }), [compounds, input, t])
  const { result, updating } = useComputed('compoundEffects', job)
  const list = useMemo(() => {
    const byId = new Map(compounds.map((c) => [c.id, c]))
    return (result || []).map((x) => ({ c: byId.get(x.id), fx: x.fx })).filter((x) => x.c)
  }, [result, compounds])

  const picked = list.find((x) => x.c.id === openId)
  if (picked?.fx) return <CompoundEffectsDetail compound={picked.c} fx={picked.fx} input={input} onBack={() => setOpenId(null)} />
  if (openId === 'sauna') {
    return (
      <div className="space-y-4" data-testid="effects-sauna">
        <button onClick={() => setOpenId(null)} className="flex items-center gap-1 text-sm font-bold" style={{ color: 'var(--text-2)' }} data-testid="effects-back"><ChevronLeft size={16} /> All</button>
        <h2 className="text-2xl font-black tracking-tight">Sauna</h2>
        <SaunaEffectsView />
      </div>
    )
  }

  if (!result && trackedForEffects(compounds).length) {
    return <div className="card p-5" data-testid="effects-loading"><p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>Working out the effects…</p></div>
  }
  if (!list.length && !saunaCount) {
    return (
      <div className="card p-5" data-testid="effects-empty">
        <p className="text-base font-black">No compounds are tracked yet</p>
        <p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-2)' }}>Turn on Track effects for a compound in More › Health.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="effects-view">
      <div className="flex items-center gap-2 px-1">
        <p className="min-w-0 flex-1 text-sm font-medium" style={{ color: 'var(--text-2)' }}>
          {updating ? <span data-testid="effects-updating">Updating</span> : 'Before against since starting'}
        </p>
        <InfoButton title="How Effects works" testid="effects-legend">{LEGEND}</InfoButton>
      </div>
      <Stagger className="card rows overflow-hidden">
        {saunaCount > 0 && (
          <StaggerItem as="button" onClick={() => setOpenId('sauna')} className="flex w-full items-center gap-3 p-4 text-left" data-testid="effects-compound" data-compound="sauna">
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-semibold">Sauna</span>
              <span className="block text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>{saunaCount} session{saunaCount === 1 ? '' : 's'}</span>
            </span>
            <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--text-3)' }} />
          </StaggerItem>
        )}
        {list.map(({ c, fx }) => {
          const dose = fx ? laneFor(c.points, c.runs, fx.run.start, fx.run.end).segments.at(-1) : null
          return (
            <StaggerItem key={c.id} as="button" onClick={() => fx && setOpenId(c.id)} disabled={!fx}
              className="flex w-full items-center gap-3 p-4 text-left" data-testid="effects-compound" data-compound={c.id}>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold">{c.name}</span>
                <span className="block truncate text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid={fx?.headline ? 'effects-headline' : undefined}>
                  {fx?.headline && fx.headline.label !== 'Too early' ? effectAnswer(fx.headline) : fx ? `Since ${short(fx.run.start)}${dose ? ` · ${dose.dose}${dose.unit ? ` ${dose.unit}` : ''}` : ''}` : 'Not started yet'}
                </span>
              </span>
              {fx && <span data-testid="effect-label" data-label={fx.headline ? fx.headline.label : 'Too early'}><StatusDot label={fx.headline ? fx.headline.label : 'Too early'} /></span>}
              {fx && <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--text-3)' }} />}
            </StaggerItem>
          )
        })}
      </Stagger>
    </div>
  )
}
