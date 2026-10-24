import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import Modal from '../ui/Modal'
import useStore from '../../store/useStore'
import { describeBackup } from '../../lib/backup'
import { lastBackupWords, dateOfBackup, sizeWords, KEEP_BACKUPS } from '../../lib/autoBackup'
import { listBackups, runBackup, readBackup, restoreBackup } from '../../native/backupRuntime'

const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }
const btn = { background: 'var(--surface-sunk)', color: 'var(--text)' }

/**
 * Automatic backups (iPhone app): one a day in the Files app under
 * On My iPhone › Pepito+ › Backups, the last 14 kept. Back up now, and a
 * restore from any of them.
 */
export default function BackupsCard() {
  const [files, setFiles] = useState(null)
  const [busy, setBusy] = useState(null)
  const [pick, setPick] = useState(false)
  const [pending, setPending] = useState(null) // { name, bundle }
  const [error, setError] = useState(null)
  const showToast = useStore((s) => s.showToast)
  const refresh = async () => setFiles(await listBackups())
  useEffect(() => { void refresh() }, [])

  const now = async () => {
    setBusy('save')
    const r = await runBackup({ force: true })
    setBusy(null)
    showToast(r.saved ? 'Backed up' : 'The backup could not be saved')
    await refresh()
  }
  const choose = async (name) => {
    setError(null)
    try { setPending({ name, bundle: await readBackup(name) }) } catch (e) { setError(e.message) }
  }
  const restore = async () => {
    setBusy('restore')
    try {
      await restoreBackup(pending.bundle)
      window.location.reload()
    } catch (e) {
      setError(`Restore failed: ${e.message}`)
      setBusy(null)
    }
  }
  const list = (files || []).filter((f) => dateOfBackup(f.name)).sort((a, b) => b.name.localeCompare(a.name))
  const info = pending ? describeBackup(pending.bundle) : null
  return (
    <section className="card p-4" data-testid="backups">
      <p className="t-label">Automatic backups</p>
      <p className="text-sm font-bold tabular-nums" data-testid="backups-last">{files ? lastBackupWords(files) : 'Checking…'}</p>
      <p className="text-xs font-medium" style={muted}>Once a day when you open the app, the last {KEEP_BACKUPS} kept. In the Files app under On My iPhone › Pepito+ › Backups. Health data is not included; it is read again from Apple Health.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={now} disabled={!!busy} className="btn-primary rounded-full py-2.5 text-sm font-black disabled:opacity-60" data-testid="backups-now">{busy === 'save' ? 'Backing up…' : 'Back up now'}</button>
        <button type="button" onClick={() => setPick(true)} disabled={!list.length || !!busy} className="rounded-full py-2.5 text-sm font-black disabled:opacity-50" style={btn} data-testid="backups-restore">Restore</button>
      </div>
      {error && <p className="mt-2 text-xs font-bold" style={{ color: 'var(--danger)' }}>{error}</p>}
      <Modal open={pick && !pending} onClose={() => setPick(false)} title="Restore a backup">
        <div className="rows" data-testid="backups-list">
          {list.map((f) => (
            <button key={f.name} type="button" onClick={() => choose(f.name)} className="flex w-full items-center gap-3 py-3 text-left" data-testid="backups-item">
              <span className="flex-1 text-sm font-bold tabular-nums">{format(parseISO(dateOfBackup(f.name)), 'EEE d MMM yyyy')}</span>
              <span className="text-xs font-medium tabular-nums" style={muted}>{sizeWords(f.size)}</span>
            </button>
          ))}
        </div>
      </Modal>
      <Modal open={!!pending} onClose={() => setPending(null)} title="Replace everything with this backup?">
        {info && (
          <div className="space-y-3" data-testid="backups-confirm">
            <p className="text-sm font-medium" style={soft}>
              From {format(parseISO(dateOfBackup(pending.name)), 'd MMM yyyy')}: {info.peptides} compounds, {info.doseLogs} doses, {info.measurements} measurements, {info.blobs} photos and files. What is in the app now is replaced.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={restore} disabled={busy === 'restore'} className="btn-primary rounded-full py-2.5 text-sm font-black" data-testid="backups-confirm-restore">{busy === 'restore' ? 'Restoring…' : 'Restore'}</button>
              <button type="button" onClick={() => setPending(null)} className="rounded-full py-2.5 text-sm font-black" style={btn}>Cancel</button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}
