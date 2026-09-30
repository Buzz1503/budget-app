import { useEffect, useMemo, useState } from 'react'
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
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)

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
                  {m.source === 'scan' && '· scan'}
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

  const hasAny = METRICS.some((m) => form[m.key] != null)

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
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Time</span>
            <input type="time" className="input" data-testid="entry-time" value={form.time || ''} onChange={(e) => set('time', e.target.value)} />
          </label>
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
  const [key, setKey] = useState('weight')
  // Pre-split arm/thigh readings are still real data, so they stay chartable —
  // they just aren't offered for new entries.
  const bodyRefs = useStore((s) => s.bodyRefs)
  const chips = useMemo(() => [...METRICS, ...legacyMetricsPresent(measurements)], [measurements])
  const m = ALL_METRIC_BY_KEY[key] || METRIC_BY_KEY.weight
  const [editing, setEditing] = useState(null)

  const { data, hasData } = useMemo(() => {
    const raw = metricSeries(measurements, key)
    if (raw.length === 0) return { data: [], hasData: false }
    const roll = key === 'weight' ? rollingAverage(raw, 7) : null
    const rollByDate = roll ? Object.fromEntries(roll.map((p) => [p.date, p.value])) : {}
    // the entry id rides along on each point so a tap on the chart can open the
    // same edit sheet the list does — the point and the row are one entry
    const idByDate = Object.fromEntries(measurements.map((x) => [x.date, x.id]))
    return {
      hasData: true,
      data: raw.map((p) => ({
        label: format(parseISO(p.date), 'd MMM'),
        value: p.value,
        roll: rollByDate[p.date] ?? null,
        id: idByDate[p.date] || null,
      })),
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
              <LineChart
                data={data}
                margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
                onClick={(e) => {
                  const id = e?.activePayload?.[0]?.payload?.id
                  if (id) setEditing(id)
                }}
              >
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={26} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} domain={['dataMin - 1', 'dataMax + 1']} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} labelStyle={{ color: 'var(--text-2)' }} />
                <Line type="monotone" dataKey="value" name={m.label} stroke={m.color} strokeWidth={2.5} dot={{ r: 3.5 }} activeDot={{ r: 6 }} isAnimationActive />
                {key === 'weight' && <Line type="monotone" dataKey="roll" name="7-day avg" stroke="var(--info)" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {hasData && (
          <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>Tap a point to correct that entry.</p>
        )}
      </div>
      <MeasurementSheet open={!!editing} onClose={() => setEditing(null)} entryId={editing} />
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
