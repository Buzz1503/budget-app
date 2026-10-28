import { useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronDown, ChevronRight, Plus, Scale, Flag } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import NumberField from '../ui/NumberField'
import { CountIn, Stagger, StaggerItem } from '../ui/Motion'
import Sparkline from '../charts/Sparkline'
import BodyChart from '../charts/BodyChart'
import useChartEvents from '../charts/useChartEvents'
import { useBodyInput, useBodyStart, sinceWords } from '../../lib/useBody'
import { dailySeries, familySeries, seriesByFamily, pickFamily, scaleWeeklyRate, getLatestMeasurement, FAMILY_FIELDS } from '../../body/bodySeries'
import { compareSinceStart } from '../../body/startPoint'
import { dexaScans, resolveSource } from '../../body/sources'
import { SCAN_METRICS } from '../../body/scanFields'
import { WITHINGS_METRICS } from '../../body/import/withings'
import Modal from '../ui/Modal'
import {
  evoltScans, ffmi, heightFor, projectGoal, latestScanMeta, seriesForMetric, lastScanStory, sinceStartStory, scanToScan,
} from '../../body/composition'
import SegmentMap from './SegmentMap'
import ScanCompare from './ScanCompare'
import MetricSheet from './MetricSheet'
import { AnswerLine, DeltaChip, InfoButton, StatRow } from '../ui/Glance'
import { deltaText } from '../../lib/glance'

const GOOD = 'var(--accent)'
const BAD = 'var(--amber)'
const shortD = (d) => format(parseISO(d), 'd MMM')
const toneFor = (delta, better) => (delta == null || Math.abs(delta) < 0.05 || !better ? 'var(--text-2)' : (better === 'down' ? delta < 0 : delta > 0) ? GOOD : BAD)
const toneWord = (delta, better) => (delta == null || Math.abs(delta) < 0.05 || !better ? 'same' : (better === 'down' ? delta < 0 : delta > 0) ? 'better' : 'worse')
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

/**
 * Without any Evolt scan: the headline weight (newest Scale reading) against the
 * starting weight. The weekly rate uses Scale readings only, so it is always one device.
 */
function Hero({ onLog, onOpenStart }) {
  const input = useBodyInput()
  const start = useBodyStart()
  const t = todayStr()
  const w = compareSinceStart('weight', start, input, t)
  const rate = useMemo(() => scaleWeeklyRate(input, t), [input, t])
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
        {rate != null ? `${signed(rate, 2)} kg a week over the last 4 weeks` : 'Weekly rate needs 2 Scale weigh-ins a week or more apart'}
      </p>
      <p className="mt-3 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
        {shortD(w.latest.date)}, {w.latest.sourceLabel}
        {start ? <> · <button onClick={onOpenStart} className="underline decoration-dotted underline-offset-2" data-testid="edit-start">starting point {format(parseISO(start.date), 'd MMM yyyy')}</button></> : null}
      </p>
    </section>
  )
}

// ------------------------------------------------- the two boxes at the top

const TONE = { good: GOOD, bad: BAD, flat: 'var(--text-2)' }

const CHIP_TONE = { good: 'better', bad: 'worse', flat: 'same' }

/** Each change as a stat row: label, before → now, a chip coloured by whether it moved the better way. */
function StoryLines({ lines, testid }) {
  return (
    <div className="rows mt-2" data-testid={testid}>
      {lines.map((l) => (
        <div key={l.key} className="flex items-center gap-3 py-2.5" data-testid={`${testid}-${l.key}`} data-tone={l.tone} aria-label={l.text}>
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{l.label || l.text}</span>
          {l.from != null && (
            <span className="shrink-0 whitespace-nowrap text-[17px] font-semibold tabular-nums">
              <span style={{ color: 'var(--text-2)' }}>{l.from.toFixed(1)}</span>
              <span className="mx-1" style={{ color: 'var(--text-3)' }}>→</span>{l.to.toFixed(1)}
              <span className="ml-0.5 text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{l.unit}</span>
            </span>
          )}
          {l.delta != null && <DeltaChip text={deltaText(l.delta, l.unit === '%' ? 'pts' : l.unit, 1)} tone={CHIP_TONE[l.tone]} />}
        </div>
      ))}
    </div>
  )
}

/**
 * Box 1, the hero: the latest Evolt scan's weight and what changed since the
 * scan before it, all from one device on one day. A newer Withings weigh-in is
 * one muted line; tapping it opens the weight chart on Scale.
 */
function ScanBox({ onLog, onShowScale }) {
  const measurements = useStore((s) => s.measurements)
  const input = useBodyInput()
  const story = useMemo(() => lastScanStory(measurements), [measurements])
  const scale = useMemo(() => familySeries('weight', input, 'scale').at(-1) || null, [input])
  if (!story) return null
  const newer = scale && scale.date > story.latest.date ? scale : null
  return (
    <section className="card p-5" data-testid="scan-box">
      <div className="flex items-center gap-2">
        <Scale size={18} style={{ color: 'var(--text-2)' }} aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[17px] font-semibold">Since your last scan</p>
        <button onClick={onLog} aria-label="Log a tape measurement" className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="composition-log">
          <Plus size={13} /> Tape
        </button>
      </div>
      <p className="mt-1 font-black tabular-nums leading-none" style={{ fontSize: 56 }} data-testid="hero-weight">
        <CountIn value={story.latest.weight} decimals={1} /><span className="ml-1 text-lg font-bold" style={{ color: 'var(--text-3)' }}>kg</span>
      </p>
      <p className="mt-2 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="hero-source">{format(parseISO(story.latest.date), 'd MMM yyyy')}, {story.latest.device}</p>
      {story.change ? (
        <>
          <p className="mt-3 text-[17px] font-semibold tabular-nums" style={{ color: TONE[story.change.tone] }} data-testid="scan-change">{story.change.text}</p>
          <StoryLines lines={story.lines} testid="scan-lines" />
        </>
      ) : (
        <p className="mt-3 text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="scan-single">Your next scan will show what changed.</p>
      )}
      {newer && (
        <button onClick={onShowScale} className="mt-3 block text-left text-xs font-medium tabular-nums underline decoration-dotted underline-offset-2" style={{ color: 'var(--text-3)' }} data-testid="scan-scale-note">
          {newer.sourceLabel || 'Scale'} {newer.value.toFixed(1)} kg on {shortD(newer.date)}
        </button>
      )}
    </section>
  )
}

/** Box 2: since the starting point, the same wording, the start's own values against the latest scan. */
function StartBox({ onOpenStart }) {
  const measurements = useStore((s) => s.measurements)
  const start = useBodyStart()
  const story = useMemo(() => sinceStartStory(measurements, start), [measurements, start])
  if (!start) return null
  if (!story) {
    return (
      <section className="card p-5" data-testid="start-box">
        <p className="t-caption" style={{ color: 'var(--text-3)' }}>Since you started</p>
        <p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="start-empty">
          Starting point {format(parseISO(start.date), 'd MMM yyyy')}. A weight at the start, or a scan after it, shows what changed.
        </p>
        <button onClick={onOpenStart} className="mt-2 text-xs font-bold underline decoration-dotted underline-offset-2" style={{ color: 'var(--text-2)' }} data-testid="edit-start">Change the starting point</button>
      </section>
    )
  }
  return (
    <section className="card p-5" data-testid="start-box">
      <div className="flex items-center gap-2">
        <Flag size={18} style={{ color: 'var(--text-2)' }} aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[17px] font-semibold">Since you started</p>
        <InfoButton title="Starting point">
          <p>The starting point is {format(parseISO(story.startDate), 'd MMM yyyy')}. Each change is the latest Evolt scan against it.</p>
          {story.estimated && <p>The start is an estimate based on {story.startWeight.toFixed(1)} kg.</p>}
          <p>Green means it moved the better way (fat down, muscle and lean up), amber the other way.</p>
        </InfoButton>
      </div>
      <button onClick={onOpenStart} className="mt-2 block text-left text-[17px] font-semibold leading-snug tabular-nums" style={{ color: TONE[story.lead.tone] }} data-testid="hero-since">
        {story.lead.text.replace(/\s*\(.*\)$/, '')}
      </button>
      <StoryLines lines={story.lines} testid="start-lines" />
      <p className="mt-2 text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="start-note">
        {story.estimated ? 'Estimated start. ' : ''}
        <button onClick={onOpenStart} className="underline decoration-dotted underline-offset-2" data-testid="edit-start">Change the starting point</button>
      </p>
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
      <span className="truncate text-[15px] font-medium" style={{ color: 'var(--text-2)' }}>{label}</span>
      <span className="mt-1 flex items-end justify-between gap-2">
        <span className="text-[26px] font-extrabold tabular-nums leading-none">
          {latest ? <CountIn value={latest.value} decimals={def.dp} /> : '–'}
          {def.unit && <span className="ml-0.5 text-xs font-bold" style={{ color: 'var(--text-3)' }}>{def.unit}</span>}
        </span>
        <Sparkline values={series.slice(-12).map((p) => p.value)} width={52} height={18} />
      </span>
      {delta != null && (
        <span className="mt-2 flex min-w-0 items-center gap-1.5" data-testid={`key-tile-${def.key}-delta`} aria-label={`${signed(delta, def.dp)}${def.unit === '%' ? ' pts' : def.unit ? ` ${def.unit}` : ''} ${sinceWords(start)}`}>
          <DeltaChip text={deltaText(delta, def.unit === '%' ? 'pts' : def.unit, def.dp)} tone={toneWord(delta, def.better)} />
        </span>
      )}
      {latest && <span className="mt-1 truncate text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>{shortD(latest.date)}, {latest.sourceLabel}</span>}
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
        {delta != null && <span className="mt-0.5 block" aria-label={`${signed(delta, m.dp)} ${sinceWords(start)}`}><DeltaChip text={deltaText(delta, m.unit === '%' ? 'pts' : m.unit, m.dp)} tone={toneWord(delta, m.better)} /></span>}
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
        <span className="block truncate text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>Lean mass for your height</span>
        {delta != null && <span className="mt-0.5 block" aria-label={`${signed(delta, 1)} ${sinceWords(start)}`}><DeltaChip text={deltaText(delta, '', 1)} tone={toneWord(delta, 'up')} /></span>}
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
        <span className="min-w-0 flex-1 text-[17px] font-semibold">All metrics</span>
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
          <WithingsGroup onOpen={onOpen} />
          <p className="mt-2 text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>Status words are Evolt's own, from your latest scan. Chips: change since your start.</p>
        </div>
      )}
    </section>
  )
}

/** Withings-only values from an account export, never mixed with a scan's, and the Withings reports. */
function WithingsGroup({ onOpen }) {
  const measurements = useStore((s) => s.measurements)
  const reports = useStore((s) => s.withingsReports || [])
  const has = useMemo(() => WITHINGS_METRICS.some((m) => measurements.some((x) => typeof x[m.key] === 'number')), [measurements])
  if (!has && !reports.length) return null
  return (
    <div className="mt-2" data-testid="metric-group-Withings">
      <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Withings</p>
      <div className="rows">
        {WITHINGS_METRICS.map((m) => <MetricRow key={m.key} m={m} onOpen={onOpen} />)}
      </div>
      {reports.length > 0 && <WithingsReports reports={reports} />}
    </div>
  )
}

const periodWords = (r) => `${format(parseISO(r.from), 'd MMM')} to ${format(parseISO(r.to), 'd MMM yyyy')}`
const hm = (min) => (min == null ? null : `${Math.floor(min / 60)} h ${min % 60} m`)

/** Withings Medical Report summaries: one row per period. Never charted, never the headline weight. */
function WithingsReports({ reports }) {
  const [open, setOpen] = useState(null)
  const list = [...reports].sort((a, b) => b.to.localeCompare(a.to))
  const r = open
  const rows = r ? [
    ['Weight', r.weight, 'kg', r.weightTrend != null ? `${r.weightTrend > 0 ? '+' : ''}${r.weightTrend} kg${r.weighIns ? `, ${r.weighIns} weigh-ins` : ''}` : null],
    ['Body fat', r.bodyFat, '%'], ['Muscle mass', r.muscleMass, 'kg'], ['Bone mass', r.boneMass, 'kg'], ['Water mass', r.waterMass, 'kg'],
    ['Lean mass', r.leanMass, 'kg'], ['Visceral fat', r.visceralFat, ''], ['BMI', r.bmi, ''], ['BMR', r.bmr, 'kcal'], ['Metabolic age', r.metabolicAge, ''],
    ['Heart rate awake, average', r.hrAwake, 'bpm'], ['Heart rate asleep, average', r.hrAsleep, 'bpm'],
    ['Sleep on weekdays', hm(r.sleepWeekdayMin), ''], ['Sleep on weekends', hm(r.sleepWeekendMin), ''], ['Sleep efficiency', r.sleepEfficiency, '%'],
    ['Snoring', r.snoringMin != null ? `${r.snoringMin} min` : null, '', r.snoringNights ? `over ${r.snoringNights} nights` : null],
  ].filter(([, v]) => v != null) : []
  return (
    <div className="mt-2" data-testid="withings-reports">
      <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Withings reports</p>
      <div className="rows">
        {list.map((x) => (
          <StatRow key={x.id} label={periodWords(x)} sub={[x.weight != null ? `${x.weight} kg` : null, x.bodyFat != null ? `${x.bodyFat}% fat` : null].filter(Boolean).join(' · ')} onClick={() => setOpen(x)} testid="withings-report-row" />
        ))}
      </div>
      <Modal open={!!r} onClose={() => setOpen(null)} title="Withings report">
        {r && (
          <div className="pb-2" data-testid="withings-report">
            <p className="text-[17px] font-semibold">{periodWords(r)}</p>
            <p className="mt-1 text-sm font-medium" style={{ color: 'var(--text-2)' }}>Withings report, latest in period. The report does not say on which day each value was measured, so these are never charted.</p>
            <div className="rows mt-2">
              {rows.map(([label, v, unit, sub]) => <StatRow key={label} label={label} value={v} unit={unit} sub={sub} />)}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

/** Every Evolt scan, newest first, with "+" to import more. */
function AllScans({ onImport }) {
  const measurements = useStore((s) => s.measurements)
  const [open, setOpen] = useState(false)
  const list = useMemo(() => evoltScans(measurements).filter((m) => !m.estimated).slice().reverse(), [measurements])
  const last = list[0]
  return (
    <section className="card px-4" data-testid="all-scans">
      <div className="flex items-center gap-2 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left" data-testid="all-scans-toggle">
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold">All scans</span>
            <span className="block truncate text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
              {list.length ? `${list.length} Evolt scan${list.length === 1 ? '' : 's'} · latest ${format(parseISO(last.date), 'd MMM yyyy')}` : 'None yet'}
            </span>
          </span>
          {open ? <ChevronDown size={16} style={{ color: 'var(--text-3)' }} /> : <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />}
        </button>
        {onImport && (
          <button type="button" onClick={onImport} aria-label="Import scans" className="flex shrink-0 items-center justify-center rounded-full" style={{ width: 36, height: 36, background: 'var(--surface-sunk)' }} data-testid="all-scans-import">
            <Plus size={18} />
          </button>
        )}
      </div>
      {open && (
        <div className="rows pb-2">
          {list.map((m) => (
            <div key={m.id} className="flex items-baseline gap-2 py-2.5 text-sm tabular-nums" data-testid="all-scans-row">
              <span className="w-[104px] shrink-0 font-semibold">{format(parseISO(m.date), 'd MMM yyyy')}</span>
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-2)' }}>{m.weight} kg{m.bodyFat != null ? ` · ${m.bodyFat}%` : ''}{m.importNote ? ' · checked by hand' : ''}</span>
            </div>
          ))}
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
  const weight = projectGoal(dailySeries('weight', input), goals.weight, t, { current: getLatestMeasurement('weight', input, t)?.value ?? null })
  const from = format(new Date(Date.parse(`${t}T00:00:00Z`) - 27 * 86400000), 'yyyy-MM-dd')
  const fam = pickFamily('bodyFat', input, from, t)
  const bf = fam ? projectGoal(familySeries('bodyFat', input, fam), goals.bodyFat, t, { unit: 'points' }) : null
  return (
    <section className="card p-5" data-testid="goal-card">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-[17px] font-semibold">Goal</h2>
        {(weight || bf) && <InfoButton title="Goal estimate"><p>An estimate from a straight line through the last 28 days. Not a prediction.</p></InfoButton>}
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
    </section>
  )
}

// ------------------------------------------------------------------ charts

const STEP_GW = 78 // one scan's group, px
const STEP_H = 236
const STEP_PAD = { t: 26, b: 36 }

/**
 * Scan to scan: for every Evolt scan, the change in fat mass and lean mass since
 * the scan before, as two thin bars from a zero line, the value on each bar and
 * the scan date under it. Newest on the right, the last 8 in view, scroll for more.
 */
/** "Last scan: fat down 0.9 kg, lean up 0.3 kg." */
export function stepAnswer(step) {
  if (!step) return null
  const part = (word, v) => (v == null ? null : Math.abs(v) < 0.05 ? `${word} the same` : `${word} ${v < 0 ? 'down' : 'up'} ${Math.abs(v).toFixed(1)} kg`)
  const parts = [part('fat', step.fat), part('lean', step.lean)].filter(Boolean)
  return parts.length ? `Last scan: ${parts.join(', ')}.` : null
}

function ScanSteps() {
  const measurements = useStore((s) => s.measurements)
  const steps = useMemo(() => scanToScan(measurements), [measurements])
  const box = useRef(null)
  useEffect(() => { if (box.current) box.current.scrollLeft = box.current.scrollWidth }, [steps.length])
  if (!steps.length) return null
  const max = Math.max(0.3, ...steps.flatMap((x) => [Math.abs(x.fat || 0), Math.abs(x.lean || 0)]))
  const mid = STEP_PAD.t + (STEP_H - STEP_PAD.t - STEP_PAD.b) / 2
  const half = (STEP_H - STEP_PAD.t - STEP_PAD.b) / 2 - 10
  const width = Math.max(8 * STEP_GW, steps.length * STEP_GW) + 8
  const bar = (v, x, fill, kind, date) => {
    if (v == null) return <text x={x} y={mid + 4} fontSize="12" textAnchor="middle" fill="var(--text-3)">–</text>
    const h = Math.max(1.5, (Math.abs(v) / max) * half)
    const down = v < 0
    const text = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`
    return (
      <g data-testid={`step-${kind}`} data-value={v} data-date={date}>
        <rect x={x - 6} width="12" y={down ? mid : mid - h} height={h} rx="2" fill={fill} />
        <text x={x} y={down ? mid + h + 13 : mid - h - 4} fontSize="11.5" fontWeight="700" textAnchor="middle" fill="var(--text-2)" className="tabular-nums">{text}</text>
      </g>
    )
  }
  return (
    <div className="card p-3" data-testid="scan-steps">
      <p className="text-[17px] font-semibold">What did each scan change?</p>
      <p className="text-[15px] font-semibold tabular-nums" data-testid="scan-steps-answer">{stepAnswer(steps.at(-1))}</p>
      <div ref={box} className="mt-2 overflow-x-auto" data-testid="scan-steps-scroll">
        <svg width={width} height={STEP_H} role="img" aria-label="Fat mass and lean mass change from each Evolt scan to the one before">
          <text x={4} y={14} fontSize="11.5" fontWeight="700" fill="var(--text-3)" data-testid="axis-unit">kg change</text>
          <line x1="0" x2={width} y1={mid} y2={mid} stroke="var(--text-3)" strokeWidth="1" />
          {steps.map((x, i) => {
            const left = width - (steps.length - i) * STEP_GW
            const cx = left + STEP_GW / 2
            return (
              <g key={x.date} data-testid="step-group" data-date={x.date}>
                {bar(x.fat, cx - 16, x.fat != null && x.fat > 0 ? BAD : GOOD, 'fat', x.date)}
                {bar(x.lean, cx + 16, 'var(--series-muscle)', 'lean', x.date)}
                <text x={cx} y={STEP_H - 15} fontSize="12" fontWeight="600" textAnchor="middle" fill="var(--text-3)" className="tabular-nums">{format(parseISO(x.date), 'd MMM')}</text>
                <text x={cx} y={STEP_H - 2} fontSize="11" fontWeight="600" textAnchor="middle" fill="var(--text-3)" className="tabular-nums">{format(parseISO(x.date), 'yyyy')}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-medium" style={{ color: 'var(--text-2)' }} data-testid="chart-legend">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: GOOD }} />Fat mass down</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: BAD }} />Fat mass up</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'var(--series-muscle)' }} />Lean mass (up is good)</span>
      </div>
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
  const def = FAMILY_METRICS.find((m) => m.key === fm)
  const anyComposition = Object.keys(seriesByFamily(fm, input)).length > 0
  return (
    <div className="space-y-3">
      <div id="composition-weight-chart"><BodyChart metric="weight" chartType="composition-weight" title="Weight" unit="kg" dp={1} events={events} testid="composition-weight-chart" /></div>
      <ScanSteps />
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
        <span className="block text-[17px] font-semibold">DEXA scans</span>
        <span className="block text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
          {scans.length ? `${scans.length} scan${scans.length === 1 ? '' : 's'} · latest ${format(parseISO(last.date), 'd MMM yyyy')}` : 'None yet'}
        </span>
      </span>
      <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
    </button>
  )
}

// ------------------------------------------------------------------- view

/** Body › Composition: one story, top to bottom. */
export default function CompositionView({ onLog, onOpenStart, onOpenDexa, onImport }) {
  const measurements = useStore((s) => s.measurements)
  const [metric, setMetric] = useState(null)
  const scans = useMemo(() => measurements.filter((m) => m.source === 'scan' && /evolt/i.test(m.device || '')), [measurements])
  const hasFamily = useBodyInput()
  const hasScans = useMemo(() => evoltScans(measurements).some((m) => typeof m.weight === 'number'), [measurements])
  const setChartSource = useStore((s) => s.setChartSource)
  // the newer Withings line: the weight chart on Scale, scrolled into view
  const showScale = () => {
    setChartSource('weight', 'scale')
    setTimeout(() => document.getElementById('composition-weight-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  const anyComposition = FAMILY_FIELDS.size && (hasFamily.measurements?.length || hasFamily.health?.length)
  return (
    <div className="space-y-4" data-testid="composition-view">
      {hasScans ? (
        <>
          <ScanBox onLog={onLog} onShowScale={showScale} />
          <StartBox onOpenStart={onOpenStart} />
        </>
      ) : <Hero onLog={onLog} onOpenStart={onOpenStart} />}
      {anyComposition ? <p className="-mb-1 px-1 text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>Chips show the change since your start</p> : null}
      {anyComposition ? (
        <Stagger className="grid grid-cols-2 gap-3" data-testid="key-tiles">
          {KEY_TILES.map((d) => <KeyTile key={d.key} def={d} onOpen={setMetric} />)}
        </Stagger>
      ) : null}
      <AllMetrics onOpen={setMetric} />
      <SegmentMap measurements={measurements} />
      <AllScans onImport={onImport} />
      <ScanCompare scans={scans} />
      <DexaRow onOpen={onOpenDexa} />
      <GoalCard />
      <SectionTitle sub="Tap a tile or a row above for any one metric.">Trends</SectionTitle>
      <Charts />
      <MetricSheet metric={metric} onClose={() => setMetric(null)} />
    </div>
  )
}
