import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Ruler, Images, PersonStanding, LineChart as LineChartIcon, Plus, FileText, Trash2, Play,
  Info, Pencil,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import {
  METRICS, METRIC_BY_KEY, ALL_METRIC_BY_KEY, PRIMARY_FIELDS, EXTRA_GROUPS,
  MEASURE_RULES, REF_DISTANCES, refPhrase, legacyMetricsPresent,
  metricSeries, rollingAverage, latest, delta,
} from '../lib/metrics'
import { extractPdfText, parseScanText } from '../lib/scanParse'
import Modal from './ui/Modal'
import NumberField from './ui/NumberField'
import BodyModel from './BodyModel'
import MeasureGuide from './MeasureGuide'
import PhotosSection from './PhotosSection'
import OutcomeEngine from './OutcomeEngine'

const SECTIONS = [
  { id: 'stats', label: 'Stats', icon: Ruler },
  { id: 'trends', label: 'Trends', icon: LineChartIcon },
  { id: 'model', label: 'Model', icon: PersonStanding },
  { id: 'photos', label: 'Photos', icon: Images },
  { id: 'outcome', label: 'Outcomes', icon: LineChartIcon },
]

export default function BodyTab() {
  const [section, setSection] = useState('stats')
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-black tracking-tight">Body & Outcomes</h1>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {SECTIONS.map((s) => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className="flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-bold"
            style={section === s.id
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            <s.icon size={13} /> {s.label}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={section} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {section === 'stats' && <StatsSection />}
          {section === 'trends' && <TrendsSection />}
          {section === 'model' && <ModelSection />}
          {section === 'photos' && <PhotosSection />}
          {section === 'outcome' && <OutcomeEngine />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ---------- Stats: quick entry + latest values ----------
function StatsSection() {
  const measurements = useStore((s) => s.measurements)
  const deleteMeasurement = useStore((s) => s.deleteMeasurement)
  const [adding, setAdding] = useState(false)

  const recent = [...measurements].reverse().slice(0, 6)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {['weight', 'bodyFat', 'visceralFat', 'muscleMass'].map((k) => {
          const m = METRIC_BY_KEY[k]
          const val = latest(measurements, k)
          const d = delta(measurements, k)
          const good = d != null && (m.better === 'down' ? d < 0 : d > 0)
          return (
            <div key={k} className="card p-3">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>{m.label}</p>
              <p className="text-2xl font-black tabular-nums">{val != null ? val : '—'}<span className="ml-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>{m.unit}</span></p>
              {d != null && (
                <p className="text-xs font-bold" style={{ color: good ? 'var(--good)' : 'var(--danger)' }}>
                  {d > 0 ? '▲' : '▼'} {Math.abs(d)} {m.unit} since start
                </p>
              )}
            </div>
          )
        })}
      </div>

      <button onClick={() => setAdding(true)} className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black">
        <Plus size={16} /> Log measurement
      </button>

      <MeasuringRules />
      <ReferenceDistances />

      {recent.length > 0 && (
        <div className="card p-3">
          <p className="mb-2 text-sm font-bold">Recent entries</p>
          <div className="space-y-2">
            {recent.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-xs font-semibold">
                <span className="w-14 shrink-0" style={{ color: 'var(--text-2)' }}>{format(parseISO(m.date), 'd MMM')}</span>
                <span className="flex-1 truncate leading-tight">
                  {m.weight != null && `${m.weight}kg `}
                  {m.bodyFat != null && `· ${m.bodyFat}% BF `}
                  {m.source === 'scan' && '· 📄 scan'}
                </span>
                <button className="font-bold" style={{ color: 'var(--danger)' }} onClick={() => deleteMeasurement(m.id)}>del</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <AddMeasurement open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

// The rules that apply to every reading — stated once, where they can't be
// missed, instead of repeated under every field.
function MeasuringRules() {
  return (
    <div className="card p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold">
        <Info size={15} style={{ color: 'var(--text-2)' }} /> How to measure — every time
      </p>
      <ul className="space-y-1">
        {MEASURE_RULES.map((r) => (
          <li key={r} className="flex gap-2 text-xs font-semibold leading-relaxed" style={{ color: 'var(--text-2)' }}>
            <span style={{ color: 'var(--text-2)' }}>•</span><span>{r}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
        Consistency beats precision. A tape 1 cm off but 1 cm off every time still shows the trend correctly;
        a tape in a different place each time shows nothing.
      </p>
    </div>
  )
}

/** Set-once, saved-forever distances so a limb is measured at the identical spot. */
function ReferenceDistances({ compact }) {
  const bodyRefs = useStore((s) => s.bodyRefs)
  const setBodyRef = useStore((s) => s.setBodyRef)

  return (
    <div className={compact ? 'rounded-[14px] p-3' : 'card p-4'} style={compact ? { background: 'var(--surface-sunk)' } : undefined}>
      <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text)' }}>
        <Pencil size={12} /> My saved reference distances
      </p>
      <div className="space-y-3">
        {Object.values(REF_DISTANCES).map((r) => (
          <div key={r.id}>
            <label className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-xs font-bold">{r.label}</span>
              <NumberField step="0.5" min={0}
                aria-label={`${r.label} in ${r.unit}`}
                className="!w-20 !py-2 text-center"
                value={bodyRefs?.[r.id] ?? r.default}
                onChange={(n) => setBodyRef(r.id, n ?? r.default)} />
              <span className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>{r.unit}</span>
            </label>
            <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--good)' }}>
              Measure at {refPhrase(bodyRefs, r.id)}.
            </p>
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>{r.help}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// One measurement (or one left/right pair) with its illustration and its exact
// instruction sitting right beside the inputs.
function MeasureField({ group, form, onSet, bodyRefs }) {
  const keys = group.keys
  const lead = METRIC_BY_KEY[keys[0]]
  const pair = keys.length > 1
  const ref = lead.refKey ? refPhrase(bodyRefs, lead.refKey) : null

  return (
    <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
      <div className="flex items-start gap-2">
        {lead.guide && <MeasureGuide id={lead.guide} size={54} />}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black">{group.label} <span style={{ color: 'var(--text-2)' }}>({lead.unit})</span></p>
          <p className="mt-1 text-xs font-semibold leading-relaxed" style={{ color: 'var(--text-2)' }}>{lead.how}</p>
          {ref && (
            <p className="mt-1 text-xs font-black" style={{ color: 'var(--good)' }}>
              Your saved spot: {ref}
            </p>
          )}
        </div>
      </div>
      <div className={`mt-2 grid gap-2 ${pair ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {keys.map((k) => {
          const m = METRIC_BY_KEY[k]
          return (
            <label key={k} className="block">
              {pair && (
                <span className="mb-1 block text-xs font-black uppercase tracking-wide"
                  style={{ color: m.side === 'L' ? 'var(--info)' : 'var(--text)' }}>
                  {m.side === 'L' ? 'Left' : 'Right'}
                </span>
              )}
              <NumberField className="!py-2 text-center"
                aria-label={`${m.label} in ${m.unit}`}
                allowEmpty min={0}
                value={form[k]}
                onChange={(n) => onSet(k, n)} />
            </label>
          )
        })}
      </div>
      {pair && (
        <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
          Left and right are stored separately — they're never averaged together.
        </p>
      )}
    </div>
  )
}

function AddMeasurement({ open, onClose }) {
  const addMeasurement = useStore((s) => s.addMeasurement)
  const bodyRefs = useStore((s) => s.bodyRefs)
  const [form, setForm] = useState({ date: todayStr() })
  const [showExtra, setShowExtra] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanNote, setScanNote] = useState(null)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const field = (k) => {
    const m = METRIC_BY_KEY[k]
    return (
      <label key={k} className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>{m.label} {m.unit && `(${m.unit})`}</span>
        <NumberField allowEmpty min={0} value={form[k]} onChange={(n) => set(k, n)} aria-label={`${m.label}${m.unit ? ` in ${m.unit}` : ''}`} />
        {m.how && <span className="mt-1 block text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>{m.how}</span>}
      </label>
    )
  }

  const onScan = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setScanBusy(true); setScanNote(null)
    try {
      const text = await extractPdfText(file)
      const parsed = parseScanText(text)
      const keys = Object.keys(parsed)
      if (keys.length === 0) {
        setScanNote({ ok: false, msg: "Couldn't read values automatically — enter them manually below." })
      } else {
        setForm((f) => ({ ...f, ...parsed, source: 'scan' }))
        setScanNote({ ok: true, msg: `Pre-filled ${keys.length} field${keys.length > 1 ? 's' : ''} from the PDF — review & confirm before saving.` })
      }
    } catch (err) {
      setScanNote({ ok: false, msg: `PDF import failed: ${err.message}. Enter manually.` })
    } finally {
      setScanBusy(false)
    }
  }

  const submit = () => {
    const hasAny = METRICS.some((m) => form[m.key] != null)
    if (!hasAny) return
    addMeasurement({ ...form, source: form.source || 'manual' })
    setForm({ date: todayStr() }); setScanNote(null); setShowExtra(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Log measurement" wide>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Date</span>
          <input type="date" className="input" value={form.date} onChange={(e) => e.target.value && set('date', e.target.value)} />
        </label>

        {/* scan import */}
        <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
          <label className="flex cursor-pointer items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-bold"><FileText size={14} style={{ color: 'var(--text-2)' }} /> Import DEXA / InBody PDF</span>
            <span className="rounded-[10px] px-3 py-2 text-xs font-black" style={{ background: 'var(--surface)', color: 'var(--info)' }}>{scanBusy ? 'Reading…' : 'Choose PDF'}</span>
            <input type="file" accept="application/pdf" className="hidden" onChange={onScan} disabled={scanBusy} />
          </label>
          {scanNote && <p className="mt-2 text-xs font-semibold" style={{ color: scanNote.ok ? 'var(--good)' : 'var(--warn)' }}>{scanNote.msg}</p>}
          <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>Formats vary — imported values pre-fill for you to confirm, never auto-saved.</p>
        </div>

        <div className="rounded-[14px] p-3" style={{ background: 'color-mix(in srgb, var(--info) 10%, var(--surface-sunk))' }}>
          <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
            <Info size={12} /> Every reading
          </p>
          <ul className="space-y-1">
            {MEASURE_RULES.map((r) => (
              <li key={r} className="flex gap-2 text-xs font-semibold leading-snug" style={{ color: 'var(--text-2)' }}>
                <span style={{ color: 'var(--text-2)' }}>•</span><span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-3">{PRIMARY_FIELDS.map(field)}</div>

        <button onClick={() => setShowExtra(!showExtra)} className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>
          {showExtra ? '− Hide' : '+ More'} measurements (neck, chest, hips, arms, forearms, thighs, calves)
        </button>
        {showExtra && (
          <div className="space-y-3">
            <ReferenceDistances compact />
            {EXTRA_GROUPS.map((g) => (
              <MeasureField key={g.id} group={g} form={form} onSet={set} bodyRefs={bodyRefs} />
            ))}
          </div>
        )}

        <button onClick={submit} className="btn-primary w-full rounded-full py-3 text-sm font-black">Save measurement</button>
      </div>
    </Modal>
  )
}

// ---------- Trends ----------
function TrendsSection() {
  const measurements = useStore((s) => s.measurements)
  const [key, setKey] = useState('weight')
  // Pre-split arm/thigh readings are still real data, so they stay chartable —
  // they just aren't offered for new entries.
  const bodyRefs = useStore((s) => s.bodyRefs)
  const chips = useMemo(() => [...METRICS, ...legacyMetricsPresent(measurements)], [measurements])
  const m = ALL_METRIC_BY_KEY[key] || METRIC_BY_KEY.weight

  const { data, hasData } = useMemo(() => {
    const raw = metricSeries(measurements, key)
    if (raw.length === 0) return { data: [], hasData: false }
    const roll = key === 'weight' ? rollingAverage(raw, 7) : null
    const rollByDate = roll ? Object.fromEntries(roll.map((p) => [p.date, p.value])) : {}
    return {
      hasData: true,
      data: raw.map((p) => ({ label: format(parseISO(p.date), 'd MMM'), value: p.value, roll: rollByDate[p.date] ?? null })),
    }
  }, [measurements, key])

  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {chips.map((mm) => (
          <button key={mm.key} onClick={() => setKey(mm.key)}
            className="shrink-0 rounded-full px-3 py-2 text-xs font-bold"
            style={key === mm.key
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            {mm.label}
          </button>
        ))}
      </div>
      <div className="card p-3">
        <p className="text-sm font-bold">{m.label} {m.unit && `(${m.unit})`}{key === 'weight' && <span className="ml-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>· 7-day avg</span>}</p>
        {m.how && (
          <p className="mb-2 mt-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>
            {m.how}
            {m.refKey && <span className="font-black" style={{ color: 'var(--good)' }}> ({refPhrase(bodyRefs, m.refKey)})</span>}
          </p>
        )}
        {!m.how && <div className="mb-2" />}
        {!hasData ? (
          <p className="py-10 text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>No {m.label.toLowerCase()} entries yet — log a measurement to see the trend.</p>
        ) : (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={26} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} domain={['dataMin - 1', 'dataMax + 1']} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} labelStyle={{ color: 'var(--text-2)' }} />
                <Line type="monotone" dataKey="value" name={m.label} stroke={m.color} strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive />
                {key === 'weight' && <Line type="monotone" dataKey="roll" name="7-day avg" stroke="var(--info)" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Interactive body model ----------
function ModelSection() {
  const measurements = useStore((s) => s.measurements)
  const bfSeries = useMemo(() => metricSeries(measurements, 'bodyFat'), [measurements])
  const waistSeries = useMemo(() => metricSeries(measurements, 'waist'), [measurements])
  const [idx, setIdx] = useState(Math.max(0, bfSeries.length - 1))

  // fall back to waist-derived estimate if no body-fat entries
  const points = bfSeries.length ? bfSeries : waistSeries.map((w) => ({ date: w.date, value: Math.min(40, Math.max(12, (w.value - 60) * 0.6 + 18)) }))
  const clampedIdx = Math.min(idx, Math.max(0, points.length - 1))
  const cur = points[clampedIdx]
  const bf = cur ? cur.value : 25

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="flex items-center justify-center rounded-[14px] py-3" style={{ background: 'radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--text) 16%, transparent), transparent 70%)' }}>
          <BodyModel bf={bf} muscle={0.5} size={180} />
        </div>
        {cur ? (
          <>
            <p className="text-center text-sm font-black">{format(parseISO(cur.date), 'd MMM yyyy')} · {bf}% body fat</p>
            {points.length > 1 && (
              <div className="mt-3">
                <div className="flex items-center gap-2">
                  <Play size={14} style={{ color: 'var(--text)' }} />
                  <input type="range" min="0" max={points.length - 1} value={clampedIdx} onChange={(e) => setIdx(+e.target.value)} className="w-full" style={{ accentColor: 'var(--text)' }} />
                </div>
                <div className="mt-1 flex justify-between text-xs font-bold" style={{ color: 'var(--text-2)' }}>
                  <span>{format(parseISO(points[0].date), 'd MMM')}</span>
                  <span>scrub your recomposition</span>
                  <span>{format(parseISO(points[points.length - 1].date), 'd MMM')}</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Log body-fat % (or waist) to drive your model.</p>
        )}
      </div>
      <p className="px-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
        A metric-driven stylized silhouette, <span className="font-bold" style={{ color: 'var(--text)' }}>not a photoreal morph of you</span>. For real before/after, use Progress Photos.
      </p>
    </div>
  )
}
