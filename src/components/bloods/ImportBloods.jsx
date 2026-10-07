import { useRef, useState } from 'react'
import { Upload, Download } from 'lucide-react'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import ImportPreview from './ImportPreview'
import { putBlob } from '../../lib/blobStore'
import { parseImport, summaryWords, exportText, exportFilename } from '../../lib/bloodImport'

const MAX_BYTES = 5 * 1024 * 1024

/**
 * Import results / Export results.
 *
 * Import reads a file, parses it, and opens the preview; nothing reaches the
 * record until the preview is confirmed. A file that cannot be read says why in
 * a sheet and imports none of it. Export writes the record out in the same
 * format, so what comes out can be handed back in.
 */
export default function ImportBloods() {
  const importBloodResults = useStore((s) => s.importBloodResults)
  const setBloodAttachment = useStore((s) => s.setBloodAttachment)
  const showToast = useStore((s) => s.showToast)

  const inputRef = useRef(null)
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(null)

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) {
      setError({ name: file.name, text: `This file is ${(file.size / 1e6).toFixed(1)} MB, far larger than a results file. Check it is the right one.` })
      return
    }
    let text
    try { text = await file.text() } catch { setError({ name: file.name, text: 'The file could not be read.' }); return }
    const parsed = parseImport(text)
    if (!parsed.ok) { setError({ name: file.name, text: parsed.error }); return }
    setPending({ name: file.name, entries: parsed.entries, warnings: parsed.warnings })
  }

  const confirm = async (plan, files) => {
    const { summary, created, restore } = importBloodResults(plan)
    setPending(null)

    // the original reports, filed against the tests that were just written
    const keys = []
    let failed = 0
    for (const { index, testId } of created) {
      const f = files[index]
      if (!f) continue
      const existing = useStore.getState().bloods.tests.find((t) => t.id === testId)
      // a date that already has a report keeps it in storage under its own key,
      // so Undo can put the pointer back to something that still exists
      const key = existing?.attachment ? `blood-${testId}-${Date.now().toString(36)}` : `blood-${testId}`
      const ok = await putBlob(key, f)
      if (!ok) { failed++; continue }
      keys.push(key)
      setBloodAttachment(testId, { blobKey: key, name: f.name, type: f.type, size: f.size, addedAt: new Date().toISOString() })
    }

    let words = summaryWords(summary)
    if (keys.length) words += `. ${keys.length} report${keys.length === 1 ? '' : 's'} attached`
    if (failed) words += `. ${failed} report${failed === 1 ? '' : 's'} could not be stored`
    showToast(words, async () => {
      restore()
      const { deleteBlob } = await import('../../lib/blobStore')
      for (const k of keys) await deleteBlob(k)
    })
  }

  const doExport = () => {
    const { bloods } = useStore.getState()
    if (!bloods?.tests?.length) { showToast('There are no results to export yet'); return }
    try {
      const blob = new Blob([exportText(bloods)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = exportFilename()
      a.click()
      URL.revokeObjectURL(url)
      const n = bloods.tests.length
      showToast(`Exported ${n} test${n === 1 ? '' : 's'}`)
    } catch (err) {
      showToast(`Export failed: ${err.message}`)
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="application/json,.json" className="hidden"
        data-testid="import-results-input" onChange={onFile} />
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => inputRef.current?.click()} data-testid="import-results"
          className="flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-black"
          style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
          <Upload size={15} /> Import results
        </button>
        <button onClick={doExport} data-testid="export-results"
          className="flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-black"
          style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
          <Download size={15} /> Export results
        </button>
      </div>

      <Modal open={!!error} onClose={() => setError(null)} title="This file can't be imported">
        <div className="space-y-3" data-testid="import-error">
          <p className="truncate text-xs font-bold" style={{ color: 'var(--text-3)' }}>{error?.name}</p>
          <p className="text-sm font-medium leading-relaxed" data-testid="import-error-text">{error?.text}</p>
          <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Nothing was imported.</p>
          <button className="btn-primary w-full rounded-full py-3 text-sm font-black"
            onClick={() => { setError(null); inputRef.current?.click() }}>
            Choose another file
          </button>
        </div>
      </Modal>

      {pending && (
        <ImportPreview
          fileName={pending.name}
          entries={pending.entries}
          warnings={pending.warnings}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </>
  )
}
