import { useMemo, useRef } from 'react'
import { Printer, Download } from 'lucide-react'
import { format } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import { buildSummaryHtml } from '../lib/summaryDoc'

/**
 * The shareable summary, shown here rather than thrown into a new tab.
 *
 * It used to call window.open, which on a phone means a tab with no chrome, no
 * back gesture and no way out short of force-quitting the app. The document
 * itself is unchanged — it is still one self-contained page of HTML, still
 * printable, still saveable — it is just framed now, with a Close where a Close
 * belongs.
 *
 * The frame is sandboxed: the document is generated from the user's own data
 * and runs no script of its own, and an iframe that cannot reach back into the
 * app is the correct amount of trust for a page whose whole job is to be
 * printed.
 */
export default function SummarySheet({ open, onClose, from, to, summary }) {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const doseEvents = useStore((s) => s.doseEvents)
  const measurements = useStore((s) => s.measurements)
  const runs = useStore((s) => s.runs)
  const reactions = useStore((s) => s.reactions)
  const injectionRecords = useStore((s) => s.injectionRecords)
  const frame = useRef(null)

  const html = useMemo(() => {
    if (!open) return ''
    return buildSummaryHtml({
      peptides, titration, doseLogs, doseEvents, measurements, summary, from, to, runs, reactions, injectionRecords,
      // the sheet supplies the print action, so the document needs no script of
      // its own and the frame can stay sandboxed without one
      framed: true,
    })
  }, [open, peptides, titration, doseLogs, doseEvents, measurements, summary, from, to, runs, reactions, injectionRecords])

  const print = () => {
    const win = frame.current?.contentWindow
    if (!win) return
    win.focus()
    win.print()
  }

  const download = () => {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pepito-summary-${todayStr()}.html`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <Modal open={open} onClose={onClose} title="Shareable summary" wide
      pinned={(
        <div className="flex gap-2" data-testid="summary-actions">
          <button onClick={print} data-testid="summary-print"
            className="btn-primary flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-full text-xs font-black">
            <Printer size={14} /> Print / save as PDF
          </button>
          <button onClick={download} data-testid="summary-download"
            className="flex min-h-[40px] items-center justify-center gap-2 rounded-full px-4 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            <Download size={13} /> File
          </button>
        </div>
      )}>
      <div className="space-y-2" data-testid="summary-sheet">
        {/* The document is white and typeset for paper; it is shown on its own
            ground rather than restyled, because what is on screen here should be
            what comes out of the printer. */}
        <div className="overflow-hidden rounded-[14px]" style={{ background: '#fff' }}>
          <iframe ref={frame} title="Protocol summary" srcDoc={html} sandbox="allow-same-origin"
            data-testid="summary-frame" className="block w-full" style={{ height: '58vh', border: 0 }} />
        </div>
        <p className="px-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Personal tracking record, not medical advice. Close with the ✕ above — nothing here leaves your
          device unless you save or print it yourself.
        </p>
      </div>
    </Modal>
  )
}
