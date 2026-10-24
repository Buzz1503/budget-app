// The daily backup on the iPhone: made the first time the app opens or comes
// forward each day (iOS does not run the app's web code on a timer), written
// to Documents/Backups, the last 14 kept. Also the doctor reports' files.
import { registerPlugin } from '@capacitor/core'
import { buildBackup, restoreBackup, validateBackup } from '../lib/backup'
import { backupPlan, backupName, BACKUP_FOLDER } from '../lib/autoBackup'
import { logError } from '../lib/errorLog'
import { todayStr } from '../store/useStore'

export const PepitoFiles = registerPlugin('PepitoFiles')

export async function listBackups() {
  try { return (await PepitoFiles.list({ folder: BACKUP_FOLDER }))?.files || [] } catch { return [] }
}

let running = false
/** Today's backup if it is still to make (or now, with `force`), then prune to 14. */
export async function runBackup({ force = false } = {}) {
  if (running) return { saved: false }
  running = true
  try {
    const today = todayStr()
    const plan = backupPlan(await listBackups(), today)
    let saved = false
    if (plan.due || force) {
      const bundle = await buildBackup()
      const r = await PepitoFiles.write({ folder: BACKUP_FOLDER, name: backupName(today), text: JSON.stringify(bundle) })
      saved = !!r?.saved
      if (!saved) logError('The backup could not be written', { kind: 'backup', where: 'daily backup' })
    }
    for (const name of plan.remove) await PepitoFiles.remove({ folder: BACKUP_FOLDER, name }).catch(() => {})
    return { saved }
  } catch (err) {
    logError(err, { kind: 'backup', where: 'daily backup' })
    return { saved: false }
  } finally {
    running = false
  }
}

/** A backup file, read and checked, for the restore confirmation. */
export async function readBackup(name) {
  const r = await PepitoFiles.read({ folder: BACKUP_FOLDER, name })
  if (!r?.text) throw new Error('That backup could not be read.')
  const bundle = JSON.parse(r.text)
  const problem = validateBackup(bundle)
  if (problem) throw new Error(problem)
  return bundle
}

export { restoreBackup }

/** A doctor report: written to Documents/Reports, then the share sheet. */
export async function shareReport(name, base64) {
  const w = await PepitoFiles.write({ folder: 'Reports', name, base64 })
  if (!w?.saved) return false
  return !!(await PepitoFiles.share({ folder: 'Reports', name }))?.shared
}

let started = false
export function startBackups(addListener) {
  if (started) return
  started = true
  // after the app has settled, so the first paint is not slowed
  setTimeout(() => { void runBackup() }, 8000)
  addListener?.('appActive', () => { void runBackup() })
}
