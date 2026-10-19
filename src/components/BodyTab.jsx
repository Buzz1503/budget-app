import { useEffect, useMemo, useState, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Ruler, Images, PersonStanding, LineChart as LineChartIcon, Plus, FileText, Trash2, Play,
  Info, Pencil,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import {
  METRICS, METRIC_BY_KEY, ALL_METRIC_BY_KEY, PRIMARY_FIELDS, EXTRA_GROUPS,
  MEASURE_RULES, REF_DISTANCES, refPhrase, legacyMetricsPresent,
} from '../lib/metrics'
import {
  useLatestMeasurement, useBodyInput, seriesFor, latestCaption, BODY_FIELDS,
  useBodyStart, useStartValue, sinceStart, sinceWords, useSinceStart,
} from '../lib/useBody'
import StartPointSheet from './StartPointSheet'
import { SCAN_FIELDS, SCAN_FIELD_BY_KEY, SCAN_DEVICES, groupedScanFields } from '../body/scanFields'
import TrendChart from './charts/TrendChart'
import ProgressChart from './charts/ProgressChart'
import useChartEvents from './charts/useChartEvents'
import { extractPdfText, parseScanText } from '../lib/scanParse'
import Modal from './ui/Modal'
import NumberField from './ui/NumberField'
import PickerField from './ui/PickerField'
import BodyModel from './BodyModel'
import MeasureGuide from './MeasureGuide'
import PhotosSection from './PhotosSection'
import OutcomeEngine from './OutcomeEngine'
import { useHealthLink } from '../lib/healthLink'
import { HEALTH_BUILD, BodyHealthView, MeasurementsHealth, EffectsView } from '../health/ui'

const SECTIONS = [
  { id: 'stats', label: 'Stats', icon: Ruler },
  { id: 'trends', label: 'Trends', icon: LineChartIcon },
  { id: 'model', label: 'Model', icon: PersonStanding },
  { id: 'photos', label: 'Photos', icon: Images },
  { id: 'outcome', label: 'Outcomes', icon: LineChartIcon },
]

const SEGMENTS = [
  { id: 'composition', label: 'Composition' },
  { id: 'effects', label: 'Effects' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'training', label: 'Training' },
]

// Composition | Effects | Recovery | Training. Only in the native app once
// Apple Health is there; on the web the Body tab is Composition alone. Sleep
// has its own tab.
function HealthSegments({ value, onChange }) {
  return (
    <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }} role="tablist" data-testid="body-segments">
      {SEGMENTS.map((s) => (
        <button key={s.id} role="tab" aria-selected={value === s.id} onClick={() => onChange(s.id)} data-testid={`body-seg-${s.id}`}
          className="min-h-[34px] flex-1 rounded-full text-xs font-bold"
          style={value === s.id ? { background: 'var(--surface2)', color: 'var(--text)' } : { color: 'var(--text-3)' }}>
          {s.label}
        </button>
      ))}
    </div>
  )
}

export default function BodyTab({ goTo }) {
  const [section, setSection] = useState('stats')
  const available = useHealthLink((s) => s.available)
  const segment = useHealthLink((s) => s.bodySegment)
  const setSegment = useHealthLink((s) => s.setBodySegment)
  const showHealth = HEALTH_BUILD && available
  if (showHealth && segment !== 'composition') {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-black tracking-tight">Body</h1>
        <HealthSegments value={segment} onChange={setSegment} />
        <Suspense fallback={null}>
          {segment === 'effects' ? <EffectsView /> : <BodyHealthView segment={segment} goTo={goTo} />}
        </Suspense>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-black tracking-tight">Body</h1>
      {showHealth && <HealthSegments value="composition" onChange={setSegment} />}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {SECTIONS.map((s) => (
          <button key={s.id} onClick={() => setSection(s.id)} data-testid={`body-section-${s.id}`}
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
          {section === 'stats' && showHealth && <Suspense fallback={null}><MeasurementsHealth /></Suspense>}
          {section === 'trends' && <TrendsSection />}
          {section === 'model' && <ModelSection />}
          {section === 'photos' && <PhotosSection />}
          {section === 'outcome' && <OutcomeEngine />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// One body value: the newest reading from any source, where it came from, and
// how far it has moved since the starting point. Tapping the change opens the
// starting point.
function LatestTile({ field, onStart }) {
  const m = METRIC_BY_KEY[field]
  const merged = useLatestMeasurement(field)
  // body fat (and fat and lean mass) compare one device family with itself
  const { start, latest, delta: d, family } = useSinceStart(field)
  const l = family ? latest : merged
  const good = d != null && (m.better === 'down' ? d < 0 : d > 0)
  return (
    <div className="card p-3" data-testid={`tile-${field}`}>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>{m.label}</p>
      <p className="text-2xl font-black tabular-nums">{l ? Number(l.value.toFixed(1)) : '–'}<span className="ml-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>{m.unit}</span></p>
      {l && (
        <p className="text-[11px] font-medium tabular-nums" data-testid={`tile-${field}-source`} data-stale={merged?.stale ? 'true' : 'false'}
          style={{ color: 'var(--text-3)' }}>
          <span style={merged?.stale && !family ? { color: 'color-mix(in srgb, var(--warn) 70%, var(--text-3))' } : undefined}>{format(parseISO(l.date), 'd MMM')}</span>, {l.sourceLabel}
        </p>
      )}
      {d != null && (
        <button onClick={onStart} data-testid={`tile-${field}-delta`} className="block text-left text-xs font-bold tabular-nums" style={{ color: good ? 'var(--good)' : d === 0 ? 'var(--text-2)' : 'var(--danger)' }}>
          {d > 0 ? '▲' : d < 0 ? '▼' : ''} {Math.abs(Number(d.toFixed(1)))} {m.unit} {sinceWords(start)}
        </button>
      )}
    </div>
  )
}

/** The starting point in one row, with the way to change it. */
function StartRow({ onOpen }) {
  const start = useBodyStart()
  const set = useStore((s) => s.bodyStart)
  return (
    <button onClick={onOpen} className="card flex w-full items-center gap-3 p-3 text-left" data-testid="edit-start">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">Edit starting point</span>
        <span className="block truncate text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
          {start ? `${format(parseISO(start.date), 'd MMM yyyy')}${start.label ? `, ${start.label}` : ''}${set ? '' : ' (default)'}` : 'Not set yet'}
        </span>
      </span>
      <Pencil size={14} style={{ color: 'var(--text-3)' }} />
    </button>
  )
}

// ---------- Stats: quick entry + latest values ----------
function StatsSection() {
  const measurements = useStore((s) => s.measurements)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)

  const [startOpen, setStartOpen] = useState(false)
  const recent = [...measurements].reverse().slice(0, 6)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {['weight', 'bodyFat', 'visceralFat', 'muscleMass'].map((k) => <LatestTile key={k} field={k} onStart={() => setStartOpen(true)} />)}
      </div>
      <StartRow onOpen={() => setStartOpen(true)} />

      <button onClick={() => setAdding(true)} className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black">
        <Plus size={16} /> Log measurement
      </button>

      <MeasuringRules />
      <ReferenceDistances />

      {recent.length > 0 && (
        <div className="card p-3">
          <p className="mb-2 text-sm font-bold">Recent entries</p>
          <p className="mb-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>Tap an entry to correct it.</p>
          <div className="space-y-2">
            {recent.map((m) => (
              <button
                key={m.id}
                data-testid={`entry-${m.id}`}
                onClick={() => setEditing(m.id)}
                className="flex w-full items-center gap-2 text-left text-xs font-semibold"
              >
                <span className="w-14 shrink-0" style={{ color: 'var(--text-2)' }}>{format(parseISO(m.date), 'd MMM')}</span>
                <span className="flex-1 truncate leading-tight">
                  {m.weight != null && `${m.weight}kg `}
                  {m.bodyFat != null && `· ${m.bodyFat}% BF `}
                  {m.source === 'scan' && `· ${m.device || 'scan'}`}
                  {m.label && <span style={{ color: 'var(--text-3)' }}> · {m.label}</span>}
                  {m.editedAt && (
                    <span data-testid={`edited-${m.id}`} className="ml-1 font-black" style={{ color: 'var(--text-3)' }}>· Edited</span>
                  )}
                </span>
                <Pencil size={13} style={{ color: 'var(--text-3)' }} />
              </button>
            ))}
          </div>
        </div>
      )}

      <MeasurementSheet open={adding} onClose={() => setAdding(false)} />
      <MeasurementSheet open={!!editing} onClose={() => setEditing(null)} entryId={editing} />
      <StartPointSheet open={startOpen} onClose={() => setStartOpen(false)} onViewEntry={setEditing} />
    </div>
  )
}

// A scan's own details: the device, whether the values are estimated, whether
// it is drawn on charts, the scan-only fields (kept apart from muscle mass and
// visceral fat) and everything else it reported, grouped.
function ScanDetails({ form, set }) {
  const isScan = form.source === 'scan'
  const groups = groupedScanFields(form)
  return (
    <div className="space-y-3 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="scan-details">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold">Body composition scan</span>
        <input type="checkbox" checked={isScan} onChange={(e) => set('source', e.target.checked ? 'scan' : 'manual')} data-testid="entry-is-scan" className="h-5 w-5" />
      </label>
      {isScan && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-2)' }}>Device</span>
              <select className="input" value={form.device || ''} onChange={(e) => set('device', e.target.value || null)} data-testid="entry-device" aria-label="Scan device">
                <option value="">Not set</option>
                {SCAN_DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-2)' }}>Label</span>
              <input className="input" value={form.label || ''} onChange={(e) => set('label', e.target.value)} data-testid="entry-label" aria-label="Label" />
            </label>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs font-bold">Values are estimated</span>
            <input type="checkbox" checked={!!form.estimated} onChange={(e) => set('estimated', e.target.checked)} data-testid="entry-estimated" className="h-5 w-5" />
          </label>
          {form.estimated && (
            <textarea className="input min-h-16 text-xs" value={form.estimateNote || ''} onChange={(e) => set('estimateNote', e.target.value)}
              placeholder="How the values were estimated" data-testid="entry-estimate-note" aria-label="Estimate note" />
          )}
          <label className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-xs font-bold">Show on charts</span>
              <span className="block text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Off keeps it on record without a second point on the day.</span>
            </span>
            <input type="checkbox" checked={!form.hiddenFromCharts} onChange={(e) => set('hiddenFromCharts', !e.target.checked)} data-testid="entry-on-charts" className="h-5 w-5" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {SCAN_FIELDS.map((f) => (
              <label key={f.key} className="block min-w-0">
                <span className="mb-1 block text-xs font-bold" style={{ color: 'var(--text-2)' }}>{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
                <NumberField allowEmpty min={0} value={form[f.key]} onChange={(n) => set(f.key, n)} aria-label={f.label} data-testid={`entry-${f.key}`} />
              </label>
            ))}
          </div>
          {(form.heightCm || form.ageAtScan) && (
            <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
              {[form.heightCm && `Height ${form.heightCm} cm`, form.ageAtScan && `age at scan ${form.ageAtScan}`].filter(Boolean).join(', ')}
            </p>
          )}
          {form.time && <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>Scanned at {form.time}</p>}
          {groups.map((g) => (
            <div key={g.group} data-testid={`extras-${g.group}`}>
              <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>{g.group}</p>
              <div className="rows">
                {g.rows.map((r) => (
                  <div key={r.key} className="flex items-baseline gap-2 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 font-medium" style={{ color: 'var(--text-2)' }}>
                      {r.label}{r.range ? <span style={{ color: 'var(--text-3)' }}> · range {r.range[0]} to {r.range[1]}</span> : null}
                    </span>
                    {r.status && <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--surface2)', color: 'var(--text-2)' }}>{r.status}</span>}
                    <span className="font-bold tabular-nums">{Number(r.value.toFixed(r.dp))}{r.unit ? ` ${r.unit}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {form.balance && (
            <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }} data-testid="scan-balance">
              Balance: upper and lower {String(form.balance.upperLower || 'not given').toLowerCase()}, left and right {String(form.balance.leftRight || 'not given').toLowerCase()}
            </p>
          )}
          {form.recommendations && (
            <div data-testid="scan-recommendations">
              <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>{form.device || 'Device'} recommendations</p>
              <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
                {[['caloriesKcal', 'Calories', 'kcal'], ['proteinG', 'Protein', 'g'], ['carbsG', 'Carbs', 'g'], ['fatG', 'Fat', 'g']]
                  .filter(([k]) => form.recommendations[k]).map(([k, label, unit]) => `${label} ${form.recommendations[k][0]} to ${form.recommendations[k][1]} ${unit}`).join(' · ')}
              </p>
              <p className="mt-0.5 text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>As printed on the scan, not advice from this app.</p>
            </div>
          )}
        </>
      )}
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

/**
 * One sheet for logging and for correcting.
 *
 * Add and edit are the same component on purpose: the brief asks for the edit
 * to use "the same validation as new-entry", and the only way to guarantee two
 * forms validate identically is for there to be one form.
 */
function MeasurementSheet({ open, onClose, entryId = null }) {
  const addMeasurement = useStore((s) => s.addMeasurement)
  const updateMeasurement = useStore((s) => s.updateMeasurement)
  const deleteMeasurement = useStore((s) => s.deleteMeasurement)
  const restoreMeasurement = useStore((s) => s.restoreMeasurement)
  const showToast = useStore((s) => s.showToast)
  const measurements = useStore((s) => s.measurements)
  const photos = useStore((s) => s.photos)
  const bodyRefs = useStore((s) => s.bodyRefs)
  const editing = entryId ? measurements.find((m) => m.id === entryId) : null

  const [form, setForm] = useState({ date: todayStr() })
  const [showExtra, setShowExtra] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanNote, setScanNote] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // the sheet is filled from the entry each time it opens, so reopening after a
  // cancel shows what is stored rather than what was abandoned
  useEffect(() => {
    if (!open) return
    setForm(editing ? { ...editing } : { date: todayStr() })
    setConfirmDelete(false)
    setScanNote(null)
    setShowExtra(editing ? EXTRA_GROUPS.some((g) => g.keys.some((k) => editing[k] != null)) : false)
  }, [open, entryId]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const hasAny = METRICS.some((m) => form[m.key] != null) || SCAN_FIELDS.some((f) => form[f.key] != null)

  const submit = () => {
    if (!hasAny) return
    if (editing) {
      // the pre-edit copy is captured before the write, so Undo puts back
      // exactly what was there rather than an approximation of it
      const before = { ...editing }
      updateMeasurement(editing.id, form)
      showToast('Measurement updated', () => restoreMeasurement(before))
    } else {
      addMeasurement({ ...form, source: form.source || 'manual' })
      setForm({ date: todayStr() })
      setScanNote(null)
      setShowExtra(false)
    }
    onClose()
  }

  const remove = () => {
    const before = { ...editing }
    deleteMeasurement(editing.id)
    showToast('Measurement deleted', () => restoreMeasurement(before))
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit measurement' : 'Log measurement'} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Date</span>
            <input type="date" className="input" data-testid="entry-date" value={form.date} onChange={(e) => e.target.value && set('date', e.target.value)} />
          </label>
          <div className="block min-w-0">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Time</span>
            <PickerField kind="time" label="Time" value={form.time || null} fallback="08:00" emptyText="No time"
              clearText="Clear time" testid="entry-time" onChange={(v) => set('time', v || '')} />
          </div>
        </div>

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

        <ScanDetails form={form} set={set} />

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

        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Notes</span>
          <textarea
            className="input min-h-16"
            data-testid="entry-note"
            value={form.note || ''}
            onChange={(e) => set('note', e.target.value)}
            placeholder="Anything worth remembering about this reading"
          />
        </label>

        <LinkedPhoto photos={photos} date={form.date} value={form.photoId || null} onPick={(id) => set('photoId', id)} />

        <button
          onClick={submit}
          disabled={!hasAny}
          data-testid="entry-save"
          className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-40"
        >
          {editing ? 'Save changes' : 'Save measurement'}
        </button>
        {!hasAny && (
          <p className="text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            Fill in at least one value.
          </p>
        )}
        <button onClick={onClose} data-testid="entry-cancel" className="w-full rounded-full py-2 text-sm font-bold" style={{ color: 'var(--text-2)' }}>
          Cancel
        </button>

        {editing && (
          <div className="pt-1">
            {confirmDelete ? (
              <div className="space-y-2 text-center">
                <p className="text-xs font-bold" style={{ color: 'var(--danger)' }}>Delete this entry?</p>
                <div className="flex gap-2">
                  <button data-testid="entry-delete-confirm" onClick={remove} className="flex-1 rounded-full py-2 text-sm font-extrabold" style={{ background: 'var(--danger)', color: 'var(--accent-fg)' }}>
                    Yes, delete
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-full py-2 text-sm font-extrabold" style={{ background: 'var(--surface-sunk)' }}>
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button
                data-testid="entry-delete"
                onClick={() => setConfirmDelete(true)}
                className="flex w-full items-center justify-center gap-2 rounded-full py-2 text-sm font-bold"
                style={{ background: 'var(--surface-sunk)', color: 'var(--danger)' }}
              >
                <Trash2 size={14} /> Delete entry
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** The progress photo this reading belongs with. Same day first, then the rest. */
function LinkedPhoto({ photos, date, value, onPick }) {
  const sorted = useMemo(() => [...photos].sort((a, b) => (
    (b.date === date ? 1 : 0) - (a.date === date ? 1 : 0) || b.date.localeCompare(a.date)
  )).slice(0, 12), [photos, date])

  if (!photos.length) return null
  return (
    <div>
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Linked photo</span>
      <div className="flex gap-2 overflow-x-auto pb-1" data-testid="entry-photo-picker">
        <button
          onClick={() => onPick(null)}
          className="chip shrink-0"
          style={!value ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' } : undefined}
        >
          None
        </button>
        {sorted.map((p) => (
          <button
            key={p.id}
            data-testid={`entry-photo-${p.id}`}
            onClick={() => onPick(p.id)}
            className="chip shrink-0"
            style={value === p.id ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'transparent' } : undefined}
          >
            {format(parseISO(p.date), 'd MMM')} {p.pose}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- Trends ----------
function TrendsSection() {
  const measurements = useStore((s) => s.measurements)
  const bodyInput = useBodyInput()
  const events = useChartEvents()
  const [key, setKey] = useState('weight')
  // Pre-split arm/thigh readings are still real data, so they stay chartable;
  // they just aren't offered for new entries.
  const bodyRefs = useStore((s) => s.bodyRefs)
  // scan-only fields get a chip once a scan has them (fat and lean mass also come from scales)
  const chips = useMemo(() => [
    ...METRICS,
    ...SCAN_FIELDS.filter((f) => seriesFor(f.key, bodyInput).length > 0),
    ...legacyMetricsPresent(measurements),
  ], [measurements, bodyInput])
  const m = ALL_METRIC_BY_KEY[key] || SCAN_FIELD_BY_KEY[key] || METRIC_BY_KEY.weight
  const [editing, setEditing] = useState(null)
  const series = useMemo(() => seriesFor(key, bodyInput), [key, bodyInput])
  const startValue = useStartValue(key)
  const latest = useLatestMeasurement(BODY_FIELDS.has(key) ? key : 'weight')
  const latestHere = BODY_FIELDS.has(key) ? latest : null
  // a point that is one day's manual entry opens the same edit sheet the list does
  const editDate = (date) => {
    const hit = [...measurements].reverse().find((x) => x.date === date && x[key] != null)
    if (hit) setEditing(hit.id)
  }

  return (
    <div className="space-y-3">
      <ProgressChart />
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {chips.map((mm) => (
          <button key={mm.key} onClick={() => setKey(mm.key)} data-testid={`trend-chip-${mm.key}`}
            className="shrink-0 rounded-full px-3 py-2 text-xs font-bold"
            style={key === mm.key
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            {mm.label}
          </button>
        ))}
      </div>
      {m.how && (
        <p className="px-1 text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>
          {m.how}
          {m.refKey && <span className="font-black" style={{ color: 'var(--good)' }}> ({refPhrase(bodyRefs, m.refKey)})</span>}
        </p>
      )}
      {series.length === 0 ? (
        <div className="card p-4">
          <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>No {m.label.toLowerCase()} entries yet. Log a measurement to see the trend.</p>
        </div>
      ) : (
        <TrendChart key={key} metric={key} chartType={`body-${key}`} title={m.label} unit={m.unit}
          dp={m.unit === 'kg' || m.unit === '%' || m.unit === 'cm' ? 1 : 0} series={series} events={events}
          current={latestHere ? latestHere.value : null} currentCaption={latestHere ? latestCaption(latestHere) : null}
          startLine={startValue} onEditDate={editDate} testid="trends-chart" />
      )}
      <MeasurementSheet open={!!editing} onClose={() => setEditing(null)} entryId={editing} />
    </div>
  )
}

// ---------- Interactive body model ----------
function ModelSection() {
  const bodyInput = useBodyInput()
  const bfSeries = useMemo(() => seriesFor('bodyFat', bodyInput), [bodyInput])
  const waistSeries = useMemo(() => seriesFor('waist', bodyInput), [bodyInput])
  const start = useBodyStart()
  const bfStart = useStartValue('bodyFat')
  const [idx, setIdx] = useState(Number.MAX_SAFE_INTEGER)

  // fall back to waist-derived estimate if no body-fat entries; the scrubber
  // runs from the starting point, not from the oldest reading on record
  const all = bfSeries.length ? bfSeries : waistSeries.map((w) => ({ date: w.date, value: Math.min(40, Math.max(12, (w.value - 60) * 0.6 + 18)) }))
  const fromStart = start ? all.filter((p) => p.date >= start.date) : all
  const points = fromStart.length ? fromStart : all
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
            {bfSeries.length > 0 && sinceStart(bf, bfStart) != null && (
              <p className="text-center text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="model-since">
                {(() => { const d = sinceStart(bf, bfStart); return `${d > 0 ? 'up' : d < 0 ? 'down' : 'no change,'} ${Math.abs(d).toFixed(1)} points ${sinceWords(bfStart)}` })()}
              </p>
            )}
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
