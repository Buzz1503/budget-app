// Automatic local backups (iPhone app): one a day to the app's Documents
// folder, the last 14 kept, visible in the Files app. The same bundle as the
// manual backup (src/lib/backup.js): the store and photos and scans, never the
// Health cache, which is read again from Apple Health. A stopgap until iCloud.
import { format } from 'date-fns'

export const KEEP_BACKUPS = 14
export const BACKUP_FOLDER = 'Backups'
const NAME = /^Pepito-backup-(\d{4}-\d{2}-\d{2})\.json$/

export const backupName = (date) => `Pepito-backup-${date}.json`
export const dateOfBackup = (name) => NAME.exec(name)?.[1] ?? null

/**
 * What to do now: whether today's backup is still to make, and which files to
 * remove so 14 are left (oldest first; files that are not backups are left alone).
 */
export function backupPlan(files, today, keep = KEEP_BACKUPS) {
  const ours = files.filter((f) => dateOfBackup(f.name)).sort((a, b) => dateOfBackup(b.name).localeCompare(dateOfBackup(a.name)))
  const due = !ours.some((f) => dateOfBackup(f.name) === today)
  const room = due ? keep - 1 : keep
  return { due, remove: ours.slice(Math.max(0, room)).map((f) => f.name) }
}

/** The newest backup, for the list and "Last backup". */
export function newestBackup(files) {
  return files.filter((f) => dateOfBackup(f.name)).sort((a, b) => (b.modified || 0) - (a.modified || 0))[0] || null
}

/** "Last backup: today 3:00 am", "Last backup: yesterday 9:14 pm", "Last backup: 12 Oct 8:00 am". */
export function lastBackupWords(files, now = new Date()) {
  const f = newestBackup(files)
  if (!f) return 'No backup yet'
  const at = new Date(f.modified)
  const day = format(at, 'yyyy-MM-dd')
  const today = format(now, 'yyyy-MM-dd')
  const y = new Date(now); y.setDate(y.getDate() - 1)
  const when = day === today ? 'today' : day === format(y, 'yyyy-MM-dd') ? 'yesterday' : format(at, 'd MMM')
  return `Last backup: ${when} ${format(at, 'h:mm a').toLowerCase()}`
}

/** "2.4 MB", "820 KB". */
export function sizeWords(bytes) {
  if (!(bytes > 0)) return '0 KB'
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
