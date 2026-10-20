import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import NumberField from '../ui/NumberField'
import { CountIn, Stagger, StaggerItem } from '../ui/Motion'
import Sparkline from '../charts/Sparkline'
import BodyChart, { useChartSource } from '../charts/BodyChart'
import useChartEvents from '../charts/useChartEvents'
import { useBodyInput, useBodyStart, sinceWords } from '../../lib/useBody'
import { dailySeries, familySeries, seriesByFamily, pickFamily, weeklyChange, FAMILY_FIELDS } from '../../body/bodySeries'
import { compareSinceStart } from '../../body/startPoint'
import { dexaScans, resolveSource } from '../../body/sources'
import { SCAN_METRICS } from '../../body/scanFields'
import {
  lossSplit, evoltScans, ffmi, heightFor, projectGoal, weeklyBars, latestScanMeta, seriesForMetric,
} from '../../body/composition'
import SegmentMap from './SegmentMap'
import ScanCompare from './ScanCompare'
import MetricSheet from './MetricSheet'

const GOOD = 'var(--accent)'
const BAD = 'var(--amber)'
const shortD = (d) => format(parseISO(d), 'd MMM')
const toneFor = (delta, better) => (delta == null || Math.abs(delta) < 0.05 || !better ? 'var(--text-2)' : (better === 'down' ? delta < 0 : delta > 0) ? GOOD : BAD)
const signed = (v, dp) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}`

function SectionTitle({ children, sub }) {
  return (
    <div className="px-1">
      <h2 className="text-base font-black">{children}</h2>
      {sub && <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- hero

/** Weight from the same source the weight chart shows (Scale unless you chose Evolt), against the starting weight. */
function Hero({ onLog, onOpenStart }) {
  const input = useBodyInput()
  const start = useBodyStart()
  const t = todayStr()
  const families = useMemo(() => seriesByFamily('weight', input), [input])
  const [family] = useChartSource('weight', Object.keys(families))
  const w = compareSinceStart('weight', start, input, t, { family })
  const rate = weeklyChange(family ? families[family] : [])
  if (!w.latest) {
    return (
      <section className="card p-5" data-testid="composition-hero">
        <p className="t-caption" style={{ color: 'var(--text-3)' }}>Weight</p>
        <p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-2)' }}>No weigh-ins yet. Connect Apple Health for your Withings scale, or import an Evolt scan.</p>
        <button onClick={onLog} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}><Plus size={16} /> Log tape measurement</button>
      </section>
    )
  }
  return (
    <section className="card p-5" data-testid="composition-hero">
      <div className="flex items-start gap-3">
        <p className="t-caption min-w-0 flex-1" style={{ color: 'var(--text-3)' }}>Weight</p>
        <button onClick={onLog} aria-label="Log a tape measurement" className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="composition-log">
          <Plus size={13} /> Tape
        </button>
      </div>
      <p className="mt-1 font-black tabular-nums leading-none" style={{ fontSize: 56 }} data-testid="hero-weight">
        <CountIn value={w.latest.value} decimals={1} /><span className="ml-1 text-lg font-bold" style={{ color: 'var(--text-3)' }}>kg</span>
      </p>
      {w.delta != null && (
        <button onClick={onOpenStart} className="mt-3 block text-left text-base font-black tabular-nums" style={{ color: toneFor(w.delta, 'down') }} data-testid="hero-since">
          {w.delta < 0 ? 'Down' : w.delta > 0 ? 'Up' : 'No change'} {Math.abs(w.delta).toFixed(1)} kg {sinceWords(w.start)}
        </button>
      )}
      <p className="mt-1 text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="hero-rate">
        {rate != null ? `${signed(rate, 2)} kg a week over the last 4 weeks` : 'Weekly rate needs 4 weigh-ins across 2 weeks'}
      </p>
      <p className="mt-3 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
        {shortD(w.latest.date)}, {w.latest.sourceLabel}
        {start ? <> · <button onClick={onOpenStart} className="underline decoration-dotted underline-offset-2" data-testid="edit-start">starting point {format(parseISO(start.date), 'd MMM yyyy')}</button></> : null}
      </p>
    </section>
  )
}

// ---------------------------------------------------------- what you lost

function SplitBar({ fat, lean }) {
  const f = Math.abs(fat)
  const l = Math.abs(lean)
  const total = f + l || 1
  return (
    <div className="mt-3" aria-hidden="true">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-sunk)' }}>
        <span style={{ width: `${(f / total) * 100}%`, background: 'var(--series-fat)' }} />
        <span style={{ width: `${(l / total) * 100}%`, background: 'var(--series-lean)' }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>
        <span>Fat {f.toFixed(1)} kg</span><span>Lean {l.toFixed(1)} kg</span>
      </div>
    </div>
  )
}

function LostCard() {
  const measurements = useStore((s) => s.measurements)
  const start = useBodyStart()
  if (!start) return null
  const real = lossSplit(measurements, start.date)
  const startEntry = measurements.find((m) => m.id === start.entryId && m.estimated)
  const est = startEntry ? lossSplit(measurements, start.date, startEntry) : null
  if (!real && !est) return null
  return (
    <section className="card p-5" data-testid="lost-card">
      <p className="t-caption" style={{ color: 'var(--text-3)' }}>What changed, Evolt to Evolt</p>
      {real && (
        <>
          <p className="mt-2 text-xl font-black leading-snug" data-testid="lost-line">{real.lines[0]}</p>
          {real.lines.slice(1).map((l) => <p key={l} className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>{l}</p>)}
          {Math.sign(real.fat) === Math.sign(real.lean) && real.fat !== 0 && <SplitBar fat={real.fat} lean={real.lean} />}
          <p className="mt-2 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
            Scans of {format(parseISO(real.from.date), 'd MMM yyyy')} ({real.from.weight} kg) and {format(parseISO(real.to.date), 'd MMM yyyy')} ({real.to.weight} kg).
          </p>
        </>
      )}
      {est && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }} data-testid="lost-estimate">
          <p className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>Against the adjusted start ({est.from.weight} kg, estimate)</p>
          <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>{est.lines.join(' ')}</p>
        </div>
      )}
    </section>
  )
}

// ------------------------------------------------------------- key tiles

const KEY_TILES = [
  { key: 'bodyFat', label: 'Body fat', unit: '%', dp: 1, better: 'down' },
  { key: 'fatMass', label: 'Fat mass', unit: 'kg', dp: 1, better: 'down' },
  { key: 'leanMass', label: 'Lean mass', unit: 'kg', dp: 1, better: 'up' },
  { key: 'skeletalMuscleMass', label: 'Skeletal muscle', unit: 'kg', dp: 1, better: 'up' },
  { key: 'visceralFatLevel', label: 'Visceral fat level', unit: '', dp: 0, better: 'down' },
  { key: 'waist', label: 'Waist', unit: 'cm', dp: 1, better: 'down' },
]

/** Waist: the latest of the Evolt abdominal circumference and a tape-measured waist; each compared only with itself. */
function waistField(input) {
  const a = dailySeries('abdominalCircumference', input).at(-1)
  const w = dailySeries('waist', input).at(-1)
  if (!a) return 'waist'
  if (!w) return 'abdominalCircumference'
  return a.date >= w.date ? 'abdominalCircumference' : 'waist'
}

/** A metric's latest value and change since the start, from the source its chart shows. */
function useMetricRow(field) {
  const input = useBodyInput()
  const start = useBodyStart()
  const saved = useStore((s) => s.chartSources?.[field])
  const t = todayStr()
  return useMemo(() => {
    const family = FAMILY_FIELDS.has(field) ? resolveSource(field, Object.keys(seriesByFamily(field, input)), saved) : null
    const cmp = compareSinceStart(field, start, input, t, { family })
    const series = seriesForMetric(field, input, cmp.family)
    return { ...cmp, series }
  }, [field, input, start, t, saved])
}

function KeyTile({ def, onOpen }) {
  const input = useBodyInput()
  const field = def.key === 'waist' ? waistField(input) : def.key
  const { latest, delta, start, series } = useMetricRow(field)
  const label = def.key === 'waist' && field === 'abdominalCircumference' ? 'Waist (abdominal)' : def.label
  return (
    <StaggerItem as="button" onClick={() => onOpen({ key: field, label, unit: def.unit, dp: def.dp })} className="card flex min-w-0 flex-col p-4 text-left" data-testid={`key-tile-${def.key}`}>
      <span className="t-caption truncate" style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className="mt-1 flex items-end justify-between gap-2">
        <span className="text-2xl font-black tabular-nums leading-none">
          {latest ? <CountIn value={latest.value} decimals={def.dp} /> : '–'}
          {def.unit && <span className="ml-0.5 text-xs font-bold" style={{ color: 'var(--text-3)' }}>{def.unit}</span>}
        </span>
        <Sparkline values={series.slice(-12).map((p) => p.value)} width={52} height={18} />
      </span>
      {latest && <span className="mt-2 truncate text-[11px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>{shortD(latest.date)}, {latest.sourceLabel}</span>}
      {delta != null && (
        <span className="text-xs font-bold leading-snug tabular-nums" style={{ color: toneFor(delta, def.better) }} data-testid={`key-tile-${def.key}-delta`}>
          {signed(delta, def.dp)}{def.unit === '%' ? ' pts' : def.unit ? ` ${def.unit}` : ''} {sinceWords(start)}
        </span>
      )}
    </StaggerItem>
  )
}

// ------------------------------------------------------------ all metrics

const STATUS_WORDS = new Set(['High', 'Optimal', 'Under', 'Over Range', 'Low', 'Normal'])

function MetricRow({ m, onOpen }) {
  const { latest, delta, start, series } = useMetricRow(m.key)
  const measurements = useStore((s) => s.measurements)
  const meta = latestScanMeta(measurements, m.key)
  if (!latest) return null
  return (
    <button onClick={() => onOpen(m)} className="flex w-full items-center gap-2 py-2.5 text-left" data-testid={`metric-row-${m.key}`}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{m.label}{m.unit ? <span style={{ color: 'var(--text-3)' }}> ({m.unit})</span> : null}</span>
        {delta != null && <span className="block text-[11px] font-medium tabular-nums" style={{ color: toneFor(delta, m.better) }}>{signed(delta, m.dp)} {sinceWords(start)}</span>}
      </span>
      {meta.status && STATUS_WORDS.has(meta.status) && (
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="metric-status">{meta.status}</span>
      )}
      <Sparkline values={series.slice(-12).map((p) => p.value)} width={44} height={16} />
      <span className="w-[58px] shrink-0 text-right text-sm font-black tabular-nums">{latest.value.toFixed(m.dp)}</span>
    </button>
  )
}

function FfmiRow({ onOpen }) {
  const measurements = useStore((s) => s.measurements)
  const heightSetting = useStore((s) => s.bodyProfile?.heightCm)
  const start = useBodyStart()
  const height = heightFor(heightSetting, measurements)
  const series = evoltScans(measurements).filter((s) => typeof s.leanMass === 'number').map((s) => ({ date: s.date, value: ffmi(s.leanMass, height), source: 'scan', sourceLabel: s.device }))
  const latest = series.at(-1)
  if (!latest) return null
  const startLean = start?.values?.leanMass
  const startF = startLean != null ? ffmi(startLean, height) : series.find((p) => p.date >= (start?.date || ''))?.value ?? null
  const delta = startF != null ? Math.round((latest.value - startF) * 10) / 10 : null
  const def = { key: 'ffmi', label: 'FFMI', unit: '', dp: 1, better: 'up', series,
    definition: `Fat-free mass index: lean mass in kg divided by height in metres squared (height ${height} cm). Evolt scans only.` }
  return (
    <button onClick={() => onOpen(def)} className="flex w-full items-center gap-2 py-2.5 text-left" data-testid="metric-row-ffmi">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">FFMI</span>
        <span className="block text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Lean mass for your height (lean kg ÷ height m²)</span>
        {delta != null && <span className="block text-[11px] font-medium tabular-nums" style={{ color: toneFor(delta, 'up') }}>{signed(delta, 1)} {sinceWords(start)}</span>}
      </span>
      <Sparkline values={series.slice(-12).map((p) => p.value)} width={44} height={16} />
      <span className="w-[58px] shrink-0 text-right text-sm font-black tabular-nums">{latest.value.toFixed(1)}</span>
    </button>
  )
}

const ALL_GROUPS = ['Composition', 'Fat distribution', 'Water', 'Energy', 'Scores']

function AllMetrics({ onOpen }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="card px-4" data-testid="all-metrics">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 py-4 text-left" data-testid="all-metrics-toggle">
        <span className="min-w-0 flex-1 text-base font-black">All metrics</span>
        <span className="text-xs font-bold" style={{ color: 'var(--text-3)' }}>{open ? 'Hide' : 'Show'}</span>
        {open ? <ChevronDown size={16} style={{ color: 'var(--text-3)' }} /> : <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />}
      </button>
      {open && (
        <div className="pb-3">
          {ALL_GROUPS.map((g) => (
            <div key={g} className="mb-2" data-testid={`metric-group-${g}`}>
              <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>{g}</p>
              <div className="rows">
                {SCAN_METRICS.filter((m) => m.group === g).map((m) => <MetricRow key={m.key} m={m} onOpen={onOpen} />)}
              </div>
            </div>
          ))}
          <div data-testid="metric-group-Index">
            <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Index</p>
            <FfmiRow onOpen={onOpen} />
          </div>
          <p className="mt-2 text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Status chips are Evolt's own, as printed on your latest scan.</p>
        </div>
      )}
    </section>
  )
}

// ------------------------------------------------------- goal and projection

function GoalCard() {
  const goals = useStore((s) => s.bodyGoals || {})
  const setBodyGoal = useStore((s) => s.setBodyGoal)
  const profile = useStore((s) => s.bodyProfile || {})
  const setBodyProfile = useStore((s) => s.setBodyProfile)
  const input = useBodyInput()
  const [edit, setEdit] = useState(false)
  const t = todayStr()
  const weight = projectGoal(dailySeries('weight', input), goals.weight, t)
  const from = format(new Date(Date.parse(`${t}T00:00:00Z`) - 27 * 86400000), 'yyyy-MM-dd')
  const fam = pickFamily('bodyFat', input, from, t)
  const bf = fam ? projectGoal(familySeries('bodyFat', input, fam), goals.bodyFat, t, { unit: 'points' }) : null
  return (
    <section className="card p-5" data-testid="goal-card">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-base font-black">Goal</h2>
        <button onClick={() => setEdit((v) => !v)} className="text-xs font-bold" style={{ color: 'var(--text-2)' }} data-testid="goal-edit">{edit ? 'Done' : 'Set goals'}</button>
      </div>
      {edit && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[['Goal weight (kg)', goals.weight, (v) => setBodyGoal('weight', v), 'goal-weight'],
            ['Goal body fat (%)', goals.bodyFat, (v) => setBodyGoal('bodyFat', v), 'goal-bodyfat'],
            ['Height (cm)', profile.heightCm, (v) => setBodyProfile({ heightCm: v || null }), 'goal-height']].map(([l, v, on, id]) => (
            <label key={id} className="block min-w-0">
              <span className="mb-1 block text-[11px] font-bold" style={{ color: 'var(--text-2)' }}>{l}</span>
              <NumberField allowEmpty emptyValue={null} min={0} value={v ?? ''} onChange={on} aria-label={l} data-testid={id} />
            </label>
          ))}
        </div>
      )}
      {!goals.weight && !goals.bodyFat && !edit && <p className="mt-2 text-sm font-medium" style={{ color: 'var(--text-2)' }}>Set a goal weight or body fat to see when you might get there at your current pace.</p>}
      {weight && (
        <div className="mt-3" data-testid="goal-weight-line">
          <p className="text-sm font-bold">{goals.weight} kg</p>
          <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>{weight.words}</p>
        </div>
      )}
      {bf && (
        <div className="mt-3" data-testid="goal-bodyfat-line">
          <p className="text-sm font-bold">{goals.bodyFat}% body fat <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>({fam === 'evolt' ? 'Evolt' : fam === 'scale' ? 'Scale' : fam})</span></p>
          <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>{bf.words}</p>
        </div>
      )}
      {(weight || bf) && <p className="mt-2 text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Estimate from a straight line through the last 28 days. Not a prediction.</p>}
    </section>
  )
}

// ------------------------------------------------------------------ charts

const WEEK_W = 340
const WEEK_PAD = { l: 8, r: 8, t: 22, b: 22 }
const WEEK_H = 150

/**
 * Weekly change: one bar per week for the last 12, from a zero line, the value
 * on each bar, the week's start date under it. Down in the accent, up in amber.
 * A week with fewer than 2 weigh-ins is an empty slot with a dash.
 */
function WeeklyBars({ series }) {
  const t = todayStr()
  const bars = weeklyBars(series, t)
  if (bars.every((b) => b.mean == null)) return null
  const max = Math.max(0.3, ...bars.map((b) => Math.abs(b.change || 0)))
  const mid = WEEK_PAD.t + (WEEK_H - WEEK_PAD.t - WEEK_PAD.b) / 2
  const half = (WEEK_H - WEEK_PAD.t - WEEK_PAD.b) / 2 - 12
  const slot = (WEEK_W - WEEK_PAD.l - WEEK_PAD.r) / bars.length
  return (
    <div className="card p-3" data-testid="weekly-bars">
      <p className="t-caption" style={{ color: 'var(--text-2)' }}>Weekly change, last 12 weeks</p>
      <svg viewBox={`0 0 ${WEEK_W} ${WEEK_H}`} className="mt-2 w-full" role="img" aria-label="Change in average weight from each week to the week before">
        <line x1={WEEK_PAD.l} x2={WEEK_W - WEEK_PAD.r} y1={mid} y2={mid} stroke="var(--text-3)" strokeWidth="1" data-testid="weekly-zero" />
        {bars.map((b, i) => {
          const cx = WEEK_PAD.l + i * slot + slot / 2
          const label = format(parseISO(b.weekStart), 'd MMM')
          if (b.change == null) {
            return (
              <g key={b.weekStart} data-testid="weekly-empty" data-week={b.weekStart}>
                <text x={cx} y={mid + 3} fontSize="10" fontWeight="700" textAnchor="middle" fill="var(--text-3)">–</text>
                <text x={cx} y={WEEK_H - 8} fontSize="7" fontWeight="600" textAnchor="middle" fill="var(--text-3)" className="tabular-nums">{label}</text>
              </g>
            )
          }
          const h = Math.max(1.5, (Math.abs(b.change) / max) * half)
          const down = b.change < 0
          const text = `${b.change > 0 ? '+' : b.change < 0 ? '−' : ''}${Math.abs(b.change).toFixed(1)}`
          return (
            <g key={b.weekStart} data-testid="weekly-bar" data-change={b.change} data-week={b.weekStart}>
              <rect x={cx - slot * 0.32} width={slot * 0.64} y={down ? mid : mid - h} height={h} rx="3" fill={down ? GOOD : BAD} />
              <text x={cx} y={down ? mid + h + 9 : mid - h - 3} fontSize="8" fontWeight="700" textAnchor="middle" fill="var(--text-2)" className="tabular-nums">{text}</text>
              <text x={cx} y={WEEK_H - 8} fontSize="7" fontWeight="600" textAnchor="middle" fill="var(--text-3)" className="tabular-nums">{label}</text>
            </g>
          )
        })}
      </svg>
      <p className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Each bar is a week's average weight against the week before, in kg. Down in the accent, up in amber. A dash means fewer than 2 weigh-ins that week.</p>
    </div>
  )
}

const FAMILY_METRICS = [
  { key: 'bodyFat', label: 'Body fat', unit: '%', dp: 1 },
  { key: 'fatMass', label: 'Fat mass', unit: 'kg', dp: 1 },
  { key: 'leanMass', label: 'Lean mass', unit: 'kg', dp: 1 },
]

function Charts() {
  const input = useBodyInput()
  const events = useChartEvents()
  const [fm, setFm] = useState('bodyFat')
  const weightFamilies = useMemo(() => seriesByFamily('weight', input), [input])
  const [wf] = useChartSource('weight', Object.keys(weightFamilies))
  const def = FAMILY_METRICS.find((m) => m.key === fm)
  const anyComposition = Object.keys(seriesByFamily(fm, input)).length > 0
  return (
    <div className="space-y-3">
      <BodyChart metric="weight" chartType="composition-weight" title="Weight" unit="kg" dp={1} events={events} testid="composition-weight-chart" />
      <WeeklyBars series={wf ? weightFamilies[wf] : []} />
      <div className="flex gap-1.5" role="group" aria-label="Metric">
        {FAMILY_METRICS.map((m) => (
          <button key={m.key} onClick={() => setFm(m.key)} aria-pressed={fm === m.key} data-testid={`family-metric-${m.key}`}
            className="min-h-[32px] rounded-full px-3 text-xs font-bold"
            style={fm === m.key ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)', border: '1px solid transparent' }}>
            {m.label}
          </button>
        ))}
      </div>
      {anyComposition && <BodyChart key={fm} metric={fm} chartType={`composition-${fm}`} title={def.label} unit={def.unit} dp={def.dp} events={events} testid={`family-chart-${fm}`} />}
    </div>
  )
}

/** A row to the DEXA page: how many scans, the latest. DEXA is never charted. */
function DexaRow({ onOpen }) {
  const measurements = useStore((s) => s.measurements)
  const scans = useMemo(() => dexaScans(measurements), [measurements])
  const last = scans.at(-1)
  return (
    <button onClick={onOpen} className="card flex w-full items-center gap-3 p-4 text-left" data-testid="dexa-row">
      <span className="min-w-0 flex-1">
        <span className="block text-base font-black">DEXA scans</span>
        <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
          {scans.length ? `${scans.length} scan${scans.length === 1 ? '' : 's'} · latest ${format(parseISO(last.date), 'd MMM yyyy')}` : 'None yet. Add one, compared only with other DEXA scans.'}
        </span>
      </span>
      <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
    </button>
  )
}

// ------------------------------------------------------------------- view

/** Body › Composition: one story, top to bottom. */
export default function CompositionView({ onLog, onOpenStart, onOpenDexa }) {
  const measurements = useStore((s) => s.measurements)
  const [metric, setMetric] = useState(null)
  const scans = useMemo(() => measurements.filter((m) => m.source === 'scan' && /evolt/i.test(m.device || '')), [measurements])
  const hasFamily = useBodyInput()
  const anyComposition = FAMILY_FIELDS.size && (hasFamily.measurements?.length || hasFamily.health?.length)
  return (
    <div className="space-y-4" data-testid="composition-view">
      <Hero onLog={onLog} onOpenStart={onOpenStart} />
      <LostCard />
      {anyComposition ? (
        <Stagger className="grid grid-cols-2 gap-3" data-testid="key-tiles">
          {KEY_TILES.map((d) => <KeyTile key={d.key} def={d} onOpen={setMetric} />)}
        </Stagger>
      ) : null}
      <AllMetrics onOpen={setMetric} />
      <SegmentMap measurements={measurements} />
      <ScanCompare scans={scans} />
      <DexaRow onOpen={onOpenDexa} />
      <GoalCard />
      <SectionTitle sub="Tap a tile or a row above for any one metric.">Trends</SectionTitle>
      <Charts />
      <MetricSheet metric={metric} onClose={() => setMetric(null)} />
    </div>
  )
}
