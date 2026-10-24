// The local error log: errors and failed syncs, kept on this device only (no
// network, never the console) so a problem can be copied and pasted to the
// developer. More › Data › Backups and reports shows and exports it. Entries
// carry what failed and where, never the data being worked on.

export const ERROR_LOG_KEY = 'pepito-error-log'
export const MAX_ERRORS = 200
const MAX_MESSAGE = 300

/** One entry from anything thrown, rejected or reported. */
export function entryFrom(err, context = {}, now = new Date()) {
  const e = err instanceof Error ? err : null
  const message = String(e ? e.message : typeof err === 'string' ? err : (err && err.message) || 'Unknown error').slice(0, MAX_MESSAGE)
  const stack = e?.stack ? e.stack.split('\n').slice(1, 7).map((l) => l.trim()).join('\n') : null
  return {
    at: now.toISOString(),
    kind: context.kind || 'error',
    where: context.where || null,
    name: e?.name || null,
    message,
    stack,
  }
}

/** The list with one more entry; the same error repeating within a minute is counted, not repeated. */
export function addEntry(list, entry, max = MAX_ERRORS) {
  const last = list[list.length - 1]
  if (last && last.message === entry.message && last.where === entry.where && Date.parse(entry.at) - Date.parse(last.at) < 60000) {
    return [...list.slice(0, -1), { ...last, count: (last.count || 1) + 1, at: entry.at }]
  }
  return [...list, entry].slice(-max)
}

export function readErrors() {
  try { return JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || '[]') } catch { return [] }
}

function write(list) {
  try { localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(list)) } catch { /* storage full or blocked: nothing to do */ }
  for (const fn of listeners) { try { fn(list) } catch { /* a listener never breaks logging */ } }
}

const listeners = new Set()
export function onErrorsChanged(fn) { listeners.add(fn); return () => listeners.delete(fn) }

/** Record an error. Never throws. */
export function logError(err, context = {}) {
  try { write(addEntry(readErrors(), entryFrom(err, context))) } catch { /* never throws */ }
}

export function clearErrors() { write([]) }

/** Plain text to paste: the app version and device first, then each entry. */
export function errorReport(list, meta = {}) {
  const head = [`Pepito+ error log`, meta.version ? `Version ${meta.version}` : null, meta.device || null, `${list.length} entries`].filter(Boolean)
  const body = list.map((e) => [`${e.at}${e.count > 1 ? ` (x${e.count})` : ''} ${e.kind}${e.where ? ` in ${e.where}` : ''}`, `${e.name ? `${e.name}: ` : ''}${e.message}`, e.stack].filter(Boolean).join('\n'))
  return `${head.join('\n')}\n\n${body.join('\n\n')}\n`
}

let installed = false
/** Catch what nothing else caught. */
export function installErrorLog() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => logError(e.error || e.message, { kind: 'error', where: e.filename ? e.filename.split('/').pop() : null }))
  window.addEventListener('unhandledrejection', (e) => logError(e.reason, { kind: 'rejection' }))
}
