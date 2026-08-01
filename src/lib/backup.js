// Full backup: structured state (localStorage/Zustand) AND every IndexedDB blob
// (progress photos, imported scans) in one downloadable file. The plain JSON
// export omits blobs — this does not, which is the whole point.
import { getBlob, putBlob, allBlobKeys } from './blobStore'

export const BACKUP_FORMAT = 'peptide-command-center/backup'
export const BACKUP_VERSION = 1
export const STORE_KEY = 'peptide-command-center'

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result)
      resolve(s.slice(s.indexOf(',') + 1)) // strip the data: prefix
    }
    r.onerror = () => reject(new Error('blob read failed'))
    r.readAsDataURL(blob)
  })
}

export function base64ToBlob(b64, type = 'application/octet-stream') {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

// Build the bundle. onProgress(done, total) reports blob encoding progress.
export async function buildBackup(onProgress) {
  let state = null
  try { state = localStorage.getItem(STORE_KEY) } catch { /* unavailable */ }

  const keys = await allBlobKeys()
  const blobs = {}
  let done = 0
  for (const key of keys) {
    const blob = await getBlob(key)
    if (blob) {
      blobs[String(key)] = { type: blob.type || 'application/octet-stream', data: await blobToBase64(blob) }
    }
    onProgress?.(++done, keys.length)
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appState: state ? JSON.parse(state) : null,
    blobs,
    counts: { blobs: Object.keys(blobs).length },
  }
}

export function validateBackup(bundle) {
  if (!bundle || typeof bundle !== 'object') return 'Not a valid backup file.'
  if (bundle.format !== BACKUP_FORMAT) return 'This file is not a Pepito + backup.'
  if (!bundle.appState) return 'Backup contains no app data.'
  if (bundle.version > BACKUP_VERSION) return 'Backup was made by a newer version of the app.'
  return null
}

// Summary shown in the restore confirmation, so the user knows what they're
// about to overwrite their data with.
export function describeBackup(bundle) {
  const s = bundle?.appState?.state || {}
  return {
    createdAt: bundle?.createdAt,
    peptides: s.peptides?.length ?? 0,
    doseLogs: s.doseLogs?.length ?? 0,
    measurements: s.measurements?.length ?? 0,
    symptomLogs: s.symptomLogs?.length ?? 0,
    photos: s.photos?.length ?? 0,
    blobs: Object.keys(bundle?.blobs || {}).length,
  }
}

// Overwrites localStorage + IndexedDB. Caller must confirm first.
export async function restoreBackup(bundle, onProgress) {
  const problem = validateBackup(bundle)
  if (problem) throw new Error(problem)

  const entries = Object.entries(bundle.blobs || {})
  let done = 0
  for (const [key, rec] of entries) {
    try { await putBlob(key, base64ToBlob(rec.data, rec.type)) } catch { /* skip a bad blob */ }
    onProgress?.(++done, entries.length)
  }

  localStorage.setItem(STORE_KEY, JSON.stringify(bundle.appState))
  return describeBackup(bundle)
}

export function backupFilename(date = new Date()) {
  const d = date.toISOString().slice(0, 10)
  return `peptide-command-center-backup-${d}.json`
}

// ---- nudge ----
export const NUDGE_DAYS = 7
export const NUDGE_ENTRIES = 20

// Prompt if it's been a week, or 20+ new entries since the last backup.
// A never-backed-up user is nudged only once they actually have data.
export function backupNudge({ lastBackupAt, lastBackupEntryCount = 0, entryCount = 0, now = new Date() }) {
  if (entryCount === 0) return null
  const newEntries = Math.max(0, entryCount - lastBackupEntryCount)
  if (!lastBackupAt) {
    return newEntries >= 1
      ? { reason: 'never', text: "You've never backed up — one tap saves everything, including photos." }
      : null
  }
  const days = Math.floor((now - new Date(lastBackupAt)) / 86400000)
  if (days >= NUDGE_DAYS) {
    return { reason: 'stale', days, text: `Last backup was ${days} days ago — back up to protect your data.` }
  }
  if (newEntries >= NUDGE_ENTRIES) {
    return { reason: 'entries', newEntries, text: `${newEntries} new entries since your last backup.` }
  }
  return null
}

// Everything the nudge counts as "an entry".
export function countEntries(state) {
  return (state.doseLogs?.length || 0) + (state.measurements?.length || 0)
    + (state.symptomLogs?.length || 0) + (state.photos?.length || 0)
}
