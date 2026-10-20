import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, FileText, Plus, Trash2 } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import NumberField from '../ui/NumberField'
import PickerField from '../ui/PickerField'
import ScanCompare from './ScanCompare'
import { dexaScans } from '../../body/sources'
import { extractPdfText, parseScanText } from '../../lib/scanParse'

const FIELDS = [
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'bodyFat', label: 'Body fat', unit: '%' },
  { key: 'fatMass', label: 'Fat mass', unit: 'kg' },
  { key: 'leanMass', label: 'Lean mass', unit: 'kg' },
  { key: 'visceralFatMass', label: 'Visceral fat', unit: 'kg' },
  { key: 'visceralFatArea', label: 'Visceral fat area', unit: 'cm²' },
]
const r1 = (v) => Number(Number(v).toFixed(1))
const sign = (d, dp = 1) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(dp)}`

/** Add a DEXA scan, or correct or remove one. A PDF can pre-fill it; nothing is saved until you press Save. */
function DexaForm({ open, onClose, editId }) {
  const measurements = useStore((s) => s.measurements)
  const addMeasurement = useStore((s) => s.addMeasurement)
  const updateMeasurement = useStore((s) => s.updateMeasurement)
  const deleteMeasurement = useStore((s) => s.deleteMeasurement)
  const restoreMeasurement = useStore((s) => s.restoreMeasurement)
  const showToast = useStore((s) => s.showToast)
  const editing = editId ? measurements.find((m) => m.id === editId) : null
  const [form, setForm] = useState({ date: todayStr() })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(editing ? { ...editing } : { date: todayStr() })
    setNote(null)
    setConfirm(false)
  }, [open, editId]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const hasAny = FIELDS.some((f) => form[f.key] != null)

  const onPdf = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setNote(null)
    try {
      const parsed = parseScanText(await extractPdfText(file))
      const keys = Object.keys(parsed)
      if (!keys.length) setNote({ ok: false, msg: "Couldn't read values automatically. Enter them below." })
      else {
        setForm((f) => ({ ...f, ...parsed }))
        setNote({ ok: true, msg: `Pre-filled ${keys.length} field${keys.length > 1 ? 's' : ''} from the PDF. Check them, then save.` })
      }
    } catch (err) {
      setNote({ ok: false, msg: `PDF import failed: ${err.message}. Enter the values below.` })
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    if (!hasAny) return
    const entry = { ...form, source: 'scan', device: 'DEXA', family: 'dexa', originalSource: editing?.originalSource || 'scan' }
    if (editing) {
      const before = { ...editing }
      updateMeasurement(editing.id, entry)
      showToast('DEXA scan updated', () => restoreMeasurement(before))
    } else addMeasurement(entry)
    onClose()
  }
  const remove = () => {
    const before = { ...editing }
    deleteMeasurement(editing.id)
    showToast('DEXA scan deleted', () => restoreMeasurement(before))
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit DEXA scan' : 'Add DEXA scan'} wide>
      <div className="space-y-3" data-testid="dexa-form">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Date</span>
            <input type="date" className="input" data-testid="dexa-date" value={form.date} max={todayStr()} onChange={(e) => e.target.value && set('date', e.target.value)} />
          </label>
          <div className="block min-w-0">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Time</span>
            <PickerField kind="time" label="Time" value={form.time || null} fallback="09:00" emptyText="No time" clearText="Clear time" testid="dexa-time" onChange={(v) => set('time', v || '')} />
          </div>
        </div>
        <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
          <label className="flex cursor-pointer items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-bold"><FileText size={14} style={{ color: 'var(--text-2)' }} /> Read a DEXA PDF</span>
            <span className="rounded-[10px] px-3 py-2 text-xs font-black" style={{ background: 'var(--surface)', color: 'var(--info)' }}>{busy ? 'Reading…' : 'Choose PDF'}</span>
            <input type="file" accept="application/pdf" className="hidden" onChange={onPdf} disabled={busy} data-testid="dexa-pdf" />
          </label>
          {note && <p className="mt-2 text-xs font-semibold" style={{ color: note.ok ? 'var(--good)' : 'var(--warn)' }}>{note.msg}</p>}
          <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>Formats vary, so values only pre-fill. Nothing is saved until you press Save.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="block min-w-0">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>{f.label} ({f.unit})</span>
              <NumberField allowEmpty min={0} value={form[f.key]} onChange={(n) => set(f.key, n)} aria-label={`${f.label} in ${f.unit}`} data-testid={`dexa-${f.key}`} />
            </label>
          ))}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>Notes</span>
          <textarea className="input min-h-16" value={form.note || ''} onChange={(e) => set('note', e.target.value)} data-testid="dexa-note" placeholder="Where it was done, anything worth remembering" />
        </label>
        <button onClick={save} disabled={!hasAny} data-testid="dexa-save" className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-40">
          {editing ? 'Save changes' : 'Save DEXA scan'}
        </button>
        {!hasAny && <p className="text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Fill in at least one value.</p>}
        {editing && (confirm ? (
          <div className="flex gap-2">
            <button onClick={remove} data-testid="dexa-delete-confirm" className="flex-1 rounded-full py-2 text-sm font-extrabold" style={{ background: 'var(--danger)', color: 'var(--accent-fg)' }}>Yes, delete</button>
            <button onClick={() => setConfirm(false)} className="flex-1 rounded-full py-2 text-sm font-extrabold" style={{ background: 'var(--surface-sunk)' }}>Keep it</button>
          </div>
        ) : (
          <button onClick={() => setConfirm(true)} data-testid="dexa-delete" className="flex w-full items-center justify-center gap-2 rounded-full py-2 text-sm font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--danger)' }}>
            <Trash2 size={14} /> Delete scan
          </button>
        ))}
      </div>
    </Modal>
  )
}

/**
 * DEXA scans on their own page. They are compared with each other only and
 * never drawn on a chart or averaged with scale or Evolt readings.
 */
export default function DexaPage({ onBack }) {
  const measurements = useStore((s) => s.measurements)
  const [form, setForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const scans = useMemo(() => dexaScans(measurements), [measurements])
  const newest = [...scans].reverse()

  return (
    <div className="space-y-4" data-testid="dexa-page">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold" style={{ color: 'var(--text-2)' }} data-testid="dexa-back"><ChevronLeft size={16} /> Body</button>
      <div>
        <h1 className="text-2xl font-black tracking-tight">DEXA scans</h1>
        <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>Compared with other DEXA scans only. They never appear on a chart and are not mixed with your scale or Evolt readings.</p>
      </div>
      <button onClick={() => { setEditId(null); setForm(true) }} className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black" data-testid="dexa-add">
        <Plus size={16} /> Add DEXA scan
      </button>
      {newest.length === 0 ? (
        <div className="card p-5" data-testid="dexa-empty">
          <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No DEXA scans yet. Add one to keep it here.</p>
        </div>
      ) : (
        <section className="card rows overflow-hidden" data-testid="dexa-list">
          {newest.map((s, i) => {
            const prev = newest[i + 1]
            const d = (k) => (prev && typeof s[k] === 'number' && typeof prev[k] === 'number' ? s[k] - prev[k] : null)
            const dw = d('weight')
            const dbf = d('bodyFat')
            return (
              <button key={s.id} onClick={() => { setEditId(s.id); setForm(true) }} className="flex w-full items-center gap-3 px-4 py-3 text-left" data-testid="dexa-row" data-id={s.id}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-black tabular-nums">{format(parseISO(s.date), 'd MMM yyyy')}</span>
                  <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
                    {[typeof s.weight === 'number' && `${r1(s.weight)} kg`, typeof s.bodyFat === 'number' && `${r1(s.bodyFat)}% body fat`, typeof s.leanMass === 'number' && `lean ${r1(s.leanMass)} kg`].filter(Boolean).join(' · ')}
                  </span>
                  {(dw != null || dbf != null) && (
                    <span className="block text-[11px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="dexa-change">
                      Since the DEXA scan before: {[dw != null && `${sign(dw)} kg`, dbf != null && `${sign(dbf)} points body fat`].filter(Boolean).join(', ')}
                    </span>
                  )}
                </span>
                <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
              </button>
            )
          })}
        </section>
      )}
      <ScanCompare scans={scans} />
      <DexaForm open={form} editId={editId} onClose={() => setForm(false)} />
    </div>
  )
}
