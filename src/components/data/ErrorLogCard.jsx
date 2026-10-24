import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { readErrors, clearErrors, errorReport, onErrorsChanged } from '../../lib/errorLog'
import useStore from '../../store/useStore'

const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }
const btn = { background: 'var(--surface-sunk)', color: 'var(--text)' }

/** The local error log: what went wrong and where, to copy or export. Never sent anywhere by the app. */
export default function ErrorLogCard() {
  const [list, setList] = useState(() => readErrors())
  const [open, setOpen] = useState(false)
  const showToast = useStore((s) => s.showToast)
  useEffect(() => onErrorsChanged(setList), [])
  const report = () => errorReport(list, { version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null, device: navigator.userAgent })
  const copy = async () => {
    try { await navigator.clipboard.writeText(report()); showToast('Error log copied') } catch { showToast('Could not copy') }
  }
  const exportFile = async () => {
    const name = `Pepito-error-log-${new Date().toISOString().slice(0, 10)}.txt`
    if (__NATIVE__) {
      const { PepitoFiles } = await import('../../native/backupRuntime')
      const w = await PepitoFiles.write({ folder: 'Reports', name, text: report() }).catch(() => null)
      if (w?.saved) await PepitoFiles.share({ folder: 'Reports', name }).catch(() => {})
      return
    }
    const url = URL.createObjectURL(new Blob([report()], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }
  return (
    <section className="card p-4" data-testid="error-log">
      <div className="flex items-baseline gap-2">
        <p className="t-label flex-1">Error log</p>
        <p className="text-xs font-bold tabular-nums" style={muted} data-testid="error-log-count">{list.length} {list.length === 1 ? 'entry' : 'entries'}</p>
      </div>
      <p className="text-xs font-medium" style={muted}>Errors and failed syncs, kept on this device. Copy or export it to send to the developer; it holds what failed and where, not your data.</p>
      {list.length === 0 ? <p className="mt-2 text-sm font-medium" style={soft} data-testid="error-log-empty">Nothing has gone wrong.</p> : (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => setOpen((v) => !v)} className="min-h-[36px] rounded-full px-3 text-xs font-black" style={btn} data-testid="error-log-toggle">{open ? 'Hide' : 'Show'}</button>
            <button type="button" onClick={copy} className="min-h-[36px] rounded-full px-3 text-xs font-black" style={btn} data-testid="error-log-copy">Copy</button>
            <button type="button" onClick={exportFile} className="min-h-[36px] rounded-full px-3 text-xs font-black" style={btn} data-testid="error-log-export">Export</button>
            <button type="button" onClick={() => clearErrors()} className="min-h-[36px] rounded-full px-3 text-xs font-black" style={{ ...btn, color: 'var(--text-2)' }} data-testid="error-log-clear">Clear</button>
          </div>
          {open && (
            <div className="rows mt-2" data-testid="error-log-list">
              {[...list].reverse().slice(0, 50).map((e, i) => (
                <div key={`${e.at}-${i}`} className="py-2">
                  <p className="text-xs font-bold tabular-nums">{format(parseISO(e.at), 'd MMM HH:mm')} · {e.kind}{e.where ? ` · ${e.where}` : ''}{e.count > 1 ? ` · ${e.count} times` : ''}</p>
                  <p className="break-words text-xs font-medium" style={soft}>{e.message}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
