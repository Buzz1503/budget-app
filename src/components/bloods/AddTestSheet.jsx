import { useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, Plus, Trash2, Search, AlertTriangle, FileText } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import { prettyDate } from '../../lib/schedule'
import { putBlob, deleteBlob, blobUrl } from '../../lib/blobStore'
import {
  allMarkers, PANEL_ORDER, rangeOf, fmtRange, validateValue, panelsWithData,
} from '../../lib/bloods'

/**
 * A test, entered or corrected.
 *
 * Any subset of markers: a panel that did not measure something leaves it
 * blank, and blank means absent rather than zero. That distinction is the whole
 * reason this sheet does not present a form of seventy zeroes — a zero is a
 * result, and inventing seventy of them would put a false point on every graph
 * in the tab.
 */
export default function AddTestSheet({ open, onClose, testId = null }) {
  const bloods = useStore((s) => s.bloods)
  const addBloodTest = useStore((s) => s.addBloodTest)
  const updateBloodTest = useStore((s) => s.updateBloodTest)
  const removeBloodTest = useStore((s) => s.removeBloodTest)
  const addCustomMarker = useStore((s) => s.addCustomMarker)
  const setBloodAttachment = useStore((s) => s.setBloodAttachment)
  const showToast = useStore((s) => s.showToast)
  const t = todayStr()

  const existing = testId ? (bloods?.tests || []).find((x) => x.id === testId) : null
  const custom = bloods?.customMarkers || []
  const overrides = bloods?.rangeOverrides || {}

  const [date, setDate] = useState(existing?.date || t)
  const [lab, setLab] = useState(existing?.lab || '')
  const [ref, setRef] = useState(existing?.ref || '')
  const [notes, setNotes] = useState(existing?.notes || '')
  const [values, setValues] = useState(() => {
    const v = {}
    for (const [k, n] of Object.entries(existing?.values || {})) v[k] = String(n)
    return v
  })
  const [query, setQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newMarker, setNewMarker] = useState(null)
  const [attachUrl, setAttachUrl] = useState(null)
  const fileRef = useRef(null)

  // The sheet stays mounted between openings, so its fields would otherwise
  // still hold whatever the last test put there — or, opened on a test for the
  // first time, today's date and nothing else. Reload from the record each time
  // it opens rather than once at mount.
  useEffect(() => {
    if (!open) return
    setDate(existing?.date || t)
    setLab(existing?.lab || '')
    setRef(existing?.ref || '')
    setNotes(existing?.notes || '')
    const v = {}
    for (const [k, n] of Object.entries(existing?.values || {})) v[k] = String(n)
    setValues(v)
    setQuery('')
    setConfirmDelete(false)
    setNewMarker(null)
  }, [open, testId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true
    if (existing?.attachment?.blobKey) {
      blobUrl(existing.attachment.blobKey).then((u) => { if (alive) setAttachUrl(u) })
    } else setAttachUrl(null)
    return () => { alive = false }
  }, [existing?.attachment?.blobKey])

  const markers = useMemo(() => allMarkers(custom), [custom])
  const panels = useMemo(() => {
    const withData = panelsWithData({ tests: bloods?.tests || [], custom })
    return [...new Set([...withData, ...PANEL_ORDER])]
  }, [bloods?.tests, custom])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return markers
    return markers.filter((m) => m.name.toLowerCase().includes(q) || m.panel.toLowerCase().includes(q))
  }, [markers, query])

  if (!open) return null

  const filled = Object.entries(values).filter(([, v]) => String(v).trim() !== '')

  const save = () => {
    if (!date) return
    if (existing) {
      const clean = {}
      for (const [k, v] of filled) {
        const n = Number(v)
        if (isFinite(n)) clean[k] = n
      }
      updateBloodTest(existing.id, { date, lab, ref, notes, values: clean })
      showToast('Test updated')
    } else {
      const id = addBloodTest({ date, lab, ref, notes, values: Object.fromEntries(filled) })
      if (id) showToast(`${filled.length} result${filled.length === 1 ? '' : 's'} saved for ${prettyDate(date)}`)
    }
    onClose()
  }

  const attach = async (file) => {
    if (!file || !existing) return
    const key = `blood-${existing.id}`
    const ok = await putBlob(key, file)
    if (!ok) { showToast('Could not store that file on this device'); return }
    setBloodAttachment(existing.id, {
      blobKey: key, name: file.name, type: file.type, size: file.size,
      addedAt: new Date().toISOString(),
    })
    showToast(`${file.name} attached`)
  }

  const detach = async () => {
    if (!existing?.attachment) return
    await deleteBlob(existing.attachment.blobKey)
    setBloodAttachment(existing.id, null)
    setAttachUrl(null)
  }

  return (
    <Modal open onClose={onClose} wide
      title={existing ? `Test · ${prettyDate(existing.date)}` : 'Add a test'}
      pinned={(
        <label className="flex items-center gap-2 rounded-[14px] px-3" style={{ background: 'var(--surface-sunk)' }}>
          <Search size={14} style={{ color: 'var(--text-3)' }} />
          <input className="min-h-[42px] flex-1 bg-transparent text-sm font-medium outline-none"
            placeholder="Find a marker…" value={query} aria-label="Find a marker"
            data-testid="marker-search" onChange={(e) => setQuery(e.target.value)} />
          {filled.length > 0 && (
            <span className="shrink-0 text-xs font-black tabular-nums" style={{ color: 'var(--good)' }}>
              {filled.length}
            </span>
          )}
        </label>
      )}>
      <div className="space-y-3" data-testid="add-test-sheet">
        {confirmDelete ? (
          <div className="space-y-3" data-testid="confirm-delete-test">
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
              Every result recorded on <span className="font-black" style={{ color: 'var(--text)' }}>
                {prettyDate(existing.date)}</span> is removed, and the graphs lose those points. Any attached
              report goes with it.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-full py-3 text-xs font-black"
                style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Keep it</button>
              <button onClick={async () => { await detach(); removeBloodTest(existing.id); showToast('Test deleted'); onClose() }}
                data-testid="confirm-delete-test-yes" className="flex-1 rounded-full py-3 text-xs font-black"
                style={{ background: 'color-mix(in srgb, var(--danger) 22%, transparent)', color: 'var(--danger)' }}>
                Delete it
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>Date</span>
                <input type="date" className="input" value={date} max={t} aria-label="Test date"
                  data-testid="test-date" onChange={(e) => e.target.value && setDate(e.target.value)} />
              </label>
              <label className="min-w-0 flex-1">
                <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>Lab</span>
                <input className="input" value={lab} aria-label="Lab" data-testid="test-lab"
                  placeholder="SNP" onChange={(e) => setLab(e.target.value)} />
              </label>
            </div>

            <label className="block">
              <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>Notes (optional)</span>
              <input className="input" value={notes} aria-label="Test notes"
                placeholder="Fasting, morning collection…" onChange={(e) => setNotes(e.target.value)} />
            </label>

            {/* the report itself */}
            {existing && (
              <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
                <p className="t-caption" style={{ color: 'var(--text-2)' }}>The report</p>
                {existing.attachment ? (
                  <div className="mt-1.5 flex items-center gap-2" data-testid="attachment">
                    <FileText size={14} className="shrink-0" style={{ color: 'var(--text-3)' }} />
                    <span className="min-w-0 flex-1 truncate text-xs font-bold">{existing.attachment.name}</span>
                    {attachUrl && (
                      <a href={attachUrl} target="_blank" rel="noreferrer" data-testid="attachment-open"
                        className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-black"
                        style={{ background: 'var(--surface)', color: 'var(--info)' }}>Open</a>
                    )}
                    <button onClick={detach} aria-label="Remove the attached report" data-testid="attachment-remove"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                      style={{ background: 'var(--surface)', color: 'var(--danger)' }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => fileRef.current?.click()} data-testid="attach-report"
                      className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-xs font-black"
                      style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                      <Paperclip size={13} /> Attach the PDF or a photo
                    </button>
                    <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden"
                      aria-label="Report file"
                      onChange={(e) => { attach(e.target.files?.[0]); e.target.value = '' }} />
                  </>
                )}
                <p className="mt-1.5 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  Kept on this device and swept into your backup with everything else.
                </p>
              </div>
            )}

            {/* markers */}
            <p className="px-1 t-caption" style={{ color: 'var(--text-2)' }}>
              Fill in what was measured — leave the rest blank
            </p>

            <div className="space-y-3" data-testid="marker-inputs">
              {panels.map((panel) => {
                const rows = shown.filter((m) => m.panel === panel)
                if (!rows.length) return null
                return (
                  <div key={panel}>
                    <p className="mb-1 px-1 text-xs font-black" style={{ color: 'var(--text-3)' }}>{panel}</p>
                    <div className="card rows overflow-hidden">
                      {rows.map((m) => (
                        <MarkerInput key={m.name} marker={m} overrides={overrides}
                          value={values[m.name] ?? ''}
                          onChange={(v) => setValues((prev) => ({ ...prev, [m.name]: v }))} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* a marker the catalogue does not carry */}
            {newMarker ? (
              <div className="card space-y-2 p-3" data-testid="custom-marker-form">
                <p className="t-caption" style={{ color: 'var(--text-2)' }}>New marker</p>
                <input className="input" placeholder="Name" aria-label="Marker name" data-testid="custom-name"
                  value={newMarker.name} onChange={(e) => setNewMarker({ ...newMarker, name: e.target.value })} />
                <div className="flex gap-2">
                  <input className="input" placeholder="Unit" aria-label="Marker unit" data-testid="custom-unit"
                    value={newMarker.unit} onChange={(e) => setNewMarker({ ...newMarker, unit: e.target.value })} />
                  <select className="input" aria-label="Marker panel" value={newMarker.panel}
                    onChange={(e) => setNewMarker({ ...newMarker, panel: e.target.value })}>
                    {PANEL_ORDER.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <input className="input" placeholder="Low" inputMode="decimal" aria-label="Reference low"
                    value={newMarker.refLow} onChange={(e) => setNewMarker({ ...newMarker, refLow: e.target.value })} />
                  <input className="input" placeholder="High" inputMode="decimal" aria-label="Reference high"
                    value={newMarker.refHigh} onChange={(e) => setNewMarker({ ...newMarker, refHigh: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setNewMarker(null)} className="flex-1 rounded-full py-2.5 text-xs font-black"
                    style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Cancel</button>
                  <button data-testid="custom-save" className="btn-primary flex-1 rounded-full py-2.5 text-xs font-black"
                    onClick={() => {
                      const added = addCustomMarker({
                        name: newMarker.name, panel: newMarker.panel, unit: newMarker.unit,
                        refLow: newMarker.refLow === '' ? null : Number(newMarker.refLow),
                        refHigh: newMarker.refHigh === '' ? null : Number(newMarker.refHigh),
                      })
                      if (!added) { showToast('That marker already exists'); return }
                      setNewMarker(null)
                      setQuery(added)
                    }}>
                    Add it
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setNewMarker({ name: query.trim(), panel: 'Chemistry', unit: '', refLow: '', refHigh: '' })}
                data-testid="add-custom-marker"
                className="flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-xs font-black"
                style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                <Plus size={13} /> Add a marker that isn't listed
              </button>
            )}

            <div className="flex gap-2">
              {/* every test is deletable, seeded ones included — they are the
                  user's own past results, not fixtures the app owns */}
              {existing && (
                <button onClick={() => setConfirmDelete(true)} data-testid="delete-test"
                  aria-label="Delete this test"
                  className="rounded-full px-3 py-3 text-xs font-black"
                  style={{ background: 'var(--surface-sunk)', color: 'var(--danger)' }}>
                  <Trash2 size={13} />
                </button>
              )}
              <button onClick={onClose} className="flex-1 rounded-full py-3 text-xs font-black"
                style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Cancel</button>
              <button onClick={save} disabled={!date || (!existing && filled.length === 0)}
                data-testid="save-test"
                className="btn-primary flex-1 rounded-full py-3 text-xs font-black disabled:opacity-40">
                {existing ? 'Save' : `Save ${filled.length || ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

/** One marker's field, with the interval beside it and a warning, never a block. */
function MarkerInput({ marker, value, onChange, overrides }) {
  const range = rangeOf(marker, overrides)
  const check = validateValue(marker, value, overrides)
  const tone = check.error ? 'var(--danger)'
    : check.status === 'high' || check.status === 'low' ? 'var(--warn)' : 'var(--text)'
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold">{marker.name}</span>
          <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
            {fmtRange(range, marker.unit)}
          </span>
        </span>
        <input className="input !w-24 text-right tabular-nums" inputMode="decimal" value={value}
          aria-label={marker.name} data-testid="marker-input" data-marker={marker.name}
          style={{ color: tone }} onChange={(e) => onChange(e.target.value)} />
      </div>
      {(check.error || check.warn) && (
        <p className="mt-1 flex items-start gap-1.5 text-xs font-medium leading-relaxed"
          data-testid="marker-warning" style={{ color: check.error ? 'var(--danger)' : 'var(--warn)' }}>
          <AlertTriangle size={11} className="mt-px shrink-0" />
          {check.error || check.warn}
        </p>
      )}
    </div>
  )
}
