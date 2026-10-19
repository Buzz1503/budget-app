import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Upload, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore from '../store/useStore'
import Modal from './ui/Modal'
import { parseScanImport, planScanImport, planCounts, SCAN_SCHEMA } from '../body/scanImport'

const MAX_BYTES = 5 * 1024 * 1024

/**
 * More › Data › Import scans. The same shape as the Bloods import: choose a
 * file, check it in a preview that says what will happen to each scan, and
 * nothing is saved until confirmed. A scan already on record (same date, time
 * and device) is merged or skipped, your choice; an untimed copy of the same
 * scan is replaced by the timed one.
 */
export default function ImportScans() {
  const measurements = useStore((s) => s.measurements)
  const importScans = useStore((s) => s.importScans)
  const showToast = useStore((s) => s.showToast)
  const inputRef = useRef(null)
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(null)
  const [mode, setMode] = useState('skip')

  const plan = useMemo(() => (pending ? planScanImport(measurements, pending.entries, mode) : null), [pending, measurements, mode])
  const counts = plan ? planCounts(plan) : null
  const scansOnRecord = measurements.filter((m) => m.source === 'scan' && !m.estimated).length

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) { setError({ name: file.name, text: 'This file is far larger than a scan export. Check it is the right one.' }); return }
    let json
    try { json = JSON.parse(await file.text()) } catch { setError({ name: file.name, text: 'The file is not valid JSON.' }); return }
    const parsed = parseScanImport(json)
    if (parsed.errors.length && !parsed.entries.length) { setError({ name: file.name, text: parsed.errors.join(' ') }); return }
    setMode('skip')
    setPending({ name: file.name, ...parsed })
  }

  const confirm = () => {
    const restore = importScans(plan)
    const c = planCounts(plan)
    setPending(null)
    showToast(`Imported ${c.written} scan${c.written === 1 ? '' : 's'}`, restore)
  }

  const tagFor = (entry) => {
    if (plan.replace.some((r) => r.entry === entry)) return 'Replaces untimed copy'
    if (plan.duplicates.some((d) => d.entry === entry)) return mode === 'merge' ? 'Duplicate, merged' : 'Duplicate, skipped'
    return 'New'
  }

  return (
    <div className="space-y-4" data-testid="import-scans">
      <h1 className="t-display">Import scans</h1>
      <p className="text-sm font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
        Add body-composition scans from a JSON file ({SCAN_SCHEMA}). You will see every scan before anything is saved.
      </p>
      <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>{scansOnRecord} scan{scansOnRecord === 1 ? '' : 's'} on record now.</p>
      <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" data-testid="import-scans-input" onChange={onFile} />
      <button onClick={() => inputRef.current?.click()} data-testid="import-scans-choose"
        className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black">
        <Upload size={15} /> Choose a file
      </button>

      <Modal open={!!error} onClose={() => setError(null)} title="This file can't be imported">
        <div className="space-y-3" data-testid="import-scans-error">
          <p className="truncate text-xs font-bold" style={{ color: 'var(--text-3)' }}>{error?.name}</p>
          <p className="text-sm font-medium leading-relaxed">{error?.text}</p>
          <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Nothing was imported.</p>
        </div>
      </Modal>

      {pending && plan && createPortal(
        <div data-testid="import-scans-preview" className="fixed inset-0 z-[60] flex flex-col"
          style={{ background: 'var(--bg)', height: '100dvh', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="shrink-0 px-4 pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-black tracking-tight">Check before importing</h2>
                <p className="truncate text-xs font-medium" style={{ color: 'var(--text-3)' }}>{pending.name}</p>
              </div>
              <button onClick={() => setPending(null)} aria-label="Cancel the import" className="shrink-0 rounded-full p-2" style={{ background: 'var(--surface-sunk)' }}><X size={16} /></button>
            </div>
            <div className="mt-2 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
              <p className="text-sm font-black tabular-nums" data-testid="import-scans-counts">
                {pending.entries.length} scans in the file · {counts.new} new · {counts.replaced} replace an untimed copy · {counts.duplicates} already on record
              </p>
              <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
                {counts.written} will be saved{pending.errors.length ? ` · ${pending.errors.length} could not be read` : ''}. Nothing has been saved yet.
              </p>
            </div>
            {counts.duplicates > 0 && (
              <div className="mt-2 flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }} role="group" aria-label="Scans already on record">
                {[['skip', 'Skip duplicates'], ['merge', 'Merge duplicates']].map(([k, label]) => (
                  <button key={k} onClick={() => setMode(k)} aria-pressed={mode === k} data-testid={`import-scans-mode-${k}`}
                    className="min-h-[34px] flex-1 rounded-full text-xs font-bold"
                    style={mode === k ? { background: 'var(--surface2)', color: 'var(--text)' } : { color: 'var(--text-3)' }}>{label}</button>
                ))}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {[...pending.errors, ...pending.warnings].length > 0 && (
              <div className="mb-3 rounded-[10px] p-2.5 text-xs font-medium" style={{ background: 'color-mix(in srgb, var(--warn) 10%, transparent)', color: 'var(--text-2)' }} data-testid="import-scans-warnings">
                {[...pending.errors, ...pending.warnings].map((w) => <p key={w}>{w}</p>)}
              </div>
            )}
            <div className="card rows px-3">
              {pending.entries.map((e) => (
                <div key={e.id} className="flex items-baseline gap-2 py-2.5 text-xs tabular-nums" data-testid="import-scans-row">
                  <span className="w-[92px] shrink-0 font-bold">{format(parseISO(e.date), 'd MMM yyyy')}</span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-2)' }}>{e.time || 'no time'} · {e.device} · {e.weight} kg{e.bodyFat != null ? ` · ${e.bodyFat}%` : ''}</span>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>{tagFor(e)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="shrink-0 space-y-2 px-4 pb-3">
            <button onClick={confirm} disabled={!counts.written} data-testid="import-scans-commit" className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-40">
              Import {counts.written} scan{counts.written === 1 ? '' : 's'}
            </button>
            <button onClick={() => setPending(null)} className="w-full rounded-full py-2 text-sm font-bold" style={{ color: 'var(--text-2)' }}>Cancel</button>
          </div>
        </div>, document.body)}
    </div>
  )
}
