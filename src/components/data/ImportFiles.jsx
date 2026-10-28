import { useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Upload, ChevronRight, X } from 'lucide-react'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import NumberField from '../ui/NumberField'
import { AnswerLine, Support } from '../ui/Glance'
import { useBodyInput } from '../../lib/useBody'
import { readImportFiles, ACCEPT } from '../../lib/importFiles'
import { importPayload, importCounts, importButton, summaryWords, recheckEvolt, STATUS_WORD } from '../../body/import/plan'

const day = (d) => (d ? format(parseISO(d), 'd MMM yyyy') : null)

const STATUS_STYLE = {
  new: { dot: 'var(--good)', ring: null },
  duplicate: { dot: 'var(--text-3)', ring: null },
  check: { dot: 'var(--warn)', ring: null },
  unknown: { dot: 'transparent', ring: 'var(--text-3)' },
}

function StatusWord({ status }) {
  const s = STATUS_STYLE[status]
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold" style={{ color: status === 'new' ? 'var(--text)' : 'var(--text-2)' }} data-testid="import-status" data-status={status}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: s.dot, boxShadow: s.ring ? `inset 0 0 0 1.5px ${s.ring}` : undefined }} />
      {STATUS_WORD[status]}
    </span>
  )
}

/**
 * More › Data › Import, and "+" on Body › Composition › All scans. One drop
 * zone for any mix of files: Evolt 360 PDFs, a Withings export (zip or CSV),
 * a Withings Medical Report, the scan JSON. Every file is listed with what it
 * is and a status before anything is saved; repeats are skipped by default,
 * a scan that fails its checks opens an edit sheet, and nothing on record is
 * ever replaced.
 */
export default function ImportFiles() {
  const measurements = useStore((s) => s.measurements)
  const reports = useStore((s) => s.withingsReports)
  const importBody = useStore((s) => s.importBody)
  const showToast = useStore((s) => s.showToast)
  const input = useBodyInput()
  const existing = useMemo(() => ({ measurements, health: input.health || [], reports: reports || [] }), [measurements, input.health, reports])
  const inputRef = useRef(null)
  const [items, setItems] = useState([])
  const [reading, setReading] = useState(0)
  const [over, setOver] = useState(false)
  const [editing, setEditing] = useState(null)
  const [summary, setSummary] = useState(null)

  const take = async (fileList) => {
    const files = [...(fileList || [])]
    if (!files.length) return
    setSummary(null)
    setReading(files.length)
    const rows = await readImportFiles(files, existing)
    setItems((cur) => [...cur.filter((c) => !rows.some((r) => r.key === c.key)), ...rows])
    setReading(0)
  }

  const counts = importCounts(items)
  const toggle = (key) => setItems((cur) => cur.map((i) => (i.key === key && i.status !== 'unknown' && i.status !== 'check' && i.entries.length + (i.report ? 1 : 0) > 0 ? { ...i, include: !i.include } : i)))

  const commit = () => {
    const { added, undo } = importBody(importPayload(items))
    const words = summaryWords(added, counts.skipped)
    setSummary(words)
    setItems([])
    showToast(words, undo)
  }

  return (
    <div className="space-y-4" data-testid="import-files">
      <h1 className="t-display">Import</h1>
      <Support clamp={false}>Evolt reports (PDF), a Withings export (zip or CSV), a Withings Medical Report, or a scan file. Read on this phone, nothing is uploaded.</Support>

      <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" data-testid="import-input"
        onChange={(e) => { const f = e.target.files; void take(f).finally(() => { e.target.value = '' }) }} />
      <button type="button" onClick={() => inputRef.current?.click()} data-testid="import-drop"
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer?.files) }}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-[20px] px-4 py-8 text-center"
        style={{ border: `1.5px dashed ${over ? 'var(--text-2)' : 'var(--text-3)'}`, background: over ? 'var(--surface-sunk)' : 'transparent' }}>
        <Upload size={22} style={{ color: 'var(--text-2)' }} aria-hidden="true" />
        <span className="text-[17px] font-semibold">{reading ? `Reading ${reading} file${reading === 1 ? '' : 's'}` : 'Choose files'}</span>
        <span className="text-sm font-medium" style={{ color: 'var(--text-3)' }}>or drop them here. Several at once is fine.</span>
      </button>

      {summary && !items.length && (
        <section className="card p-4" data-testid="import-summary">
          <AnswerLine>{`${summary}.`}</AnswerLine>
          <Support>Body tiles, charts and your start point use them now.</Support>
        </section>
      )}

      {items.length > 0 && (
        <section className="card px-4" data-testid="import-list">
          <div className="flex items-center gap-2 pt-4">
            <h2 className="min-w-0 flex-1 text-[17px] font-semibold">{items.length} file{items.length === 1 ? '' : 's'}</h2>
            <button type="button" onClick={() => setItems([])} className="text-sm font-semibold" style={{ color: 'var(--text-2)' }} data-testid="import-clear">Clear</button>
          </div>
          <div className="rows">
            {items.map((i) => {
              const nums = [day(i.date), i.weight != null ? `${i.weight} kg` : null, i.bodyFat != null ? `${i.bodyFat}%` : null].filter(Boolean).join(' · ')
              const canToggle = i.status === 'new' || i.status === 'duplicate'
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{i.file}</span>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{i.what}</span>
                      <StatusWord status={i.status} />
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>{nums || ' '}</span>
                      {canToggle && <span className="shrink-0 text-[13px] font-semibold" style={{ color: i.include ? 'var(--text)' : 'var(--text-3)' }}>{i.include ? 'Importing' : 'Skipping'}</span>}
                    </span>
                    {(i.note || i.problems?.[0]) && <span className="line-clamp-2 block text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{i.problems?.[0] || i.note}</span>}
                  </span>
                  {i.status === 'check' && <ChevronRight size={16} style={{ color: 'var(--text-3)' }} className="shrink-0" />}
                </>
              )
              const cls = 'flex w-full items-center gap-3 py-3 text-left'
              if (i.status === 'check') return <button key={i.key} type="button" className={cls} onClick={() => setEditing(i)} data-testid="import-row">{body}</button>
              if (canToggle) return <button key={i.key} type="button" className={cls} onClick={() => toggle(i.key)} aria-pressed={i.include} data-testid="import-row">{body}</button>
              return <div key={i.key} className={cls} data-testid="import-row">{body}</div>
            })}
          </div>
          <div className="space-y-2 pb-4 pt-2">
            <button type="button" onClick={commit} disabled={!counts.add} data-testid="import-commit" className="btn-primary w-full rounded-full py-3 text-[15px] font-semibold disabled:opacity-40">
              {importButton(items)}
            </button>
            <p className="text-center text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>{counts.skipped} skipped. Tap a row to include or skip it.</p>
          </div>
        </section>
      )}

      <CheckSheet item={editing} existing={existing} onClose={() => setEditing(null)}
        onDone={(next) => { setItems((cur) => cur.map((x) => (x.key === next.key ? next : x))); setEditing(null) }} />
    </div>
  )
}

const CHECK_FIELDS = [
  ['weight_kg', 'Weight', 'kg'], ['lean_body_mass_kg', 'Lean body mass', 'kg'], ['fat_mass_kg', 'Fat mass', 'kg'], ['body_fat_pct', 'Body fat', '%'],
  ['total_body_water_kg', 'Total body water', 'kg'], ['icf_kg', 'ICF', 'kg'], ['ecf_kg', 'ECF', 'kg'],
]
const REGIONS = [['left_arm', 'Left arm'], ['right_arm', 'Right arm'], ['torso', 'Torso'], ['left_leg', 'Left leg'], ['right_leg', 'Right leg']]

/** A scan that failed a check: every value as read, editable, checked again before it can be imported. */
function CheckSheet({ item, existing, onClose, onDone }) {
  const [raw, setRaw] = useState(null)
  const cur = raw && item && raw.__key === item.key ? raw : item ? { ...JSON.parse(JSON.stringify(item.raw || {})), __key: item.key } : null
  const set = (k, v) => setRaw({ ...cur, [k]: v })
  const setSeg = (r, k, v) => setRaw({ ...cur, segmental: { ...(cur.segmental || {}), [r]: { ...(cur.segmental?.[r] || {}), [k]: v } } })
  const clean = () => { const { __key, ...rest } = cur; return rest }
  const again = item && cur ? recheckEvolt(item, clean(), existing) : null
  return (
    <Modal open={!!item} onClose={onClose} title="Needs a check">
      {item && cur && (
        <div className="space-y-4 pb-2" data-testid="import-check">
          <p className="truncate text-[13px] font-medium" style={{ color: 'var(--text-3)' }}>{item.file}</p>
          {again?.problems?.length ? (
            <div className="space-y-1 rounded-[14px] p-3" style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }} data-testid="import-problems">
              {again.problems.map((p) => <p key={p} className="text-sm font-medium" style={{ color: 'var(--text)' }}>{p}</p>)}
            </div>
          ) : <p className="text-sm font-semibold" style={{ color: 'var(--good)' }}>Every check passes now.</p>}
          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0">
              <span className="mb-1 block text-[13px] font-medium" style={{ color: 'var(--text-2)' }}>Date</span>
              <input type="date" value={cur.date || ''} onChange={(e) => set('date', e.target.value)} className="input w-full" data-testid="check-date" />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[13px] font-medium" style={{ color: 'var(--text-2)' }}>Time</span>
              <input type="time" value={cur.time || ''} onChange={(e) => set('time', e.target.value)} className="input w-full" />
            </label>
            {CHECK_FIELDS.map(([k, label, unit]) => (
              <label key={k} className="block min-w-0">
                <span className="mb-1 block text-[13px] font-medium" style={{ color: 'var(--text-2)' }}>{label} ({unit})</span>
                <NumberField allowEmpty emptyValue={null} value={cur[k] ?? ''} onChange={(v) => set(k, v)} aria-label={label} data-testid={`check-${k}`} />
              </label>
            ))}
          </div>
          <div>
            <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Regions, lean and fat (kg)</p>
            {REGIONS.map(([r, label]) => (
              <div key={r} className="grid grid-cols-[1fr_88px_88px] items-center gap-2 py-1">
                <span className="text-sm font-medium">{label}</span>
                <NumberField allowEmpty emptyValue={null} value={cur.segmental?.[r]?.lean_kg ?? ''} onChange={(v) => setSeg(r, 'lean_kg', v)} aria-label={`${label} lean`} />
                <NumberField allowEmpty emptyValue={null} value={cur.segmental?.[r]?.fat_kg ?? ''} onChange={(v) => setSeg(r, 'fat_kg', v)} aria-label={`${label} fat`} />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <button type="button" disabled={!!again?.problems?.length} onClick={() => onDone(again)} className="btn-primary w-full rounded-full py-3 text-[15px] font-semibold disabled:opacity-40" data-testid="check-save">
              Use these values
            </button>
            {again?.problems?.length > 0 && again.entries.length > 0 && (
              <button type="button" onClick={() => onDone(recheckEvolt(item, clean(), existing, true))} className="w-full rounded-full py-2.5 text-sm font-semibold" style={{ color: 'var(--text-2)' }} data-testid="check-keep">
                Import as read anyway
              </button>
            )}
            <button type="button" onClick={onClose} className="flex w-full items-center justify-center gap-1 rounded-full py-2 text-sm font-semibold" style={{ color: 'var(--text-3)' }}>
              <X size={14} /> Leave it out
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
