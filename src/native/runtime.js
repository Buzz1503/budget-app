// The native sync loop, iPhone app only (loaded from src/native.js).
//
//   store change  -> buildSnapshot -> PepitoBridge.writeSnapshot (debounced)
//   launch, resume, plugin "queueChanged" -> drain the queue -> apply each action
//   once through the store -> acknowledge -> write the snapshot again
//
// Nothing with health values goes to the console or the network: errors are
// swallowed quietly and the next change tries again.
import { Capacitor, registerPlugin } from '@capacitor/core'
import useStore from '../store/useStore'
import { buildSnapshot } from './snapshot'
import { loadMatrix, LIB_TO_COMPOUND } from '../lib/mixMatrix'
import { isDue } from '../lib/due'
import { useNativeFeed } from './feed'

export const PepitoBridge = registerPlugin('PepitoBridge')

/**
 * Listen to a native plugin's event, only where the plugin exists. Capacitor's
 * addListener leaves a rejected promise behind for a missing plugin (in a
 * browser), which no catch here can reach, so the check comes first.
 */
export function listen(plugin, name, event, fn) {
  try {
    if (!Capacitor.isPluginAvailable(name)) return Promise.resolve(null)
    return plugin.addListener(event, fn).catch(() => null)
  } catch {
    return Promise.resolve(null)
  }
}
const bridgeOn = (event, fn) => listen(PepitoBridge, 'PepitoBridge', event, fn)

const DEBOUNCE_MS = 400
let timer = null
let matrix = null
let draining = false
let started = false

async function verdictOf() {
  if (!matrix) {
    try { matrix = await loadMatrix() } catch { matrix = false }
  }
  if (!matrix) return null
  return (a, b) => matrix.lookup(LIB_TO_COMPOUND[a] || a, LIB_TO_COMPOUND[b] || b)?.verdict || null
}

/** Build and write the snapshot now. */
export async function writeSnapshotNow() {
  clearTimeout(timer)
  timer = null
  const state = useStore.getState()
  const feed = useNativeFeed.getState()
  const snap = buildSnapshot(state, {
    now: new Date(),
    verdictOf: await verdictOf(),
    readiness: feed.readiness,
    lastNight: feed.lastNight,
    maxHR: feed.maxHR,
    bedtime: feed.plannedBedtime,
    wake: feed.usualWake,
  })
  try { await PepitoBridge.writeSnapshot({ json: JSON.stringify(snap) }) } catch { /* the next change writes again */ }
  for (const fn of afterWrite) {
    try { await fn(state, snap) } catch { /* a listener never blocks the snapshot */ }
  }
  return snap
}

const afterWrite = new Set()
/** Run after every snapshot write (the notification schedule hangs off this). */
export function onSnapshotWritten(fn) {
  afterWrite.add(fn)
  return () => afterWrite.delete(fn)
}

export function scheduleSnapshot() {
  clearTimeout(timer)
  timer = setTimeout(() => { void writeSnapshotNow() }, DEBOUNCE_MS)
}

/** Apply everything queued, once, then acknowledge it and refresh the snapshot. */
export async function drainQueue() {
  if (draining) return null
  draining = true
  try {
    const { actions = [] } = await PepitoBridge.readQueue()
    if (!actions.length) return null
    const result = useStore.getState().applyNativeActions(actions, {
      dueOn: (p, date) => isDue(p, date, { pushes: useStore.getState().pushes }),
    })
    for (const fn of afterApply) {
      try { await fn(result) } catch { /* follow-ups are best effort */ }
    }
    await PepitoBridge.acknowledge({ ids: actions.map((a) => a.id) })
    await writeSnapshotNow()
    return result
  } catch {
    return null
  } finally {
    draining = false
  }
}

const afterApply = new Set()
/** Run after a batch of queued actions is applied (e.g. heart rate for a phone-only sauna). */
export function onActionsApplied(fn) {
  afterApply.add(fn)
  return () => afterApply.delete(fn)
}

/**
 * The parts of the store any surface shows; a toast or a sheet opening is not
 * a reason to write. Body entries and reports are in, so an import refreshes
 * the snapshot for widgets and the Watch straight away.
 */
export const snapshotWatched = (s) => [s.peptides, s.titration, s.doseLogs, s.pushes, s.pauses, s.skips, s.supplements, s.supplementLogs,
  s.saunaSessions, s.saunaSettings, s.saunaTimer, s.notificationSettings, s.watchSettings, s.healthSettings, s.openVials, s.vials, s.sharedDraws, s.reactions,
  s.asNeededItems, s.asNeededLogs, s.sleepSettings, s.habitLogs, s.eveningDetails, s.morningChecks, s.measurements, s.withingsReports, s.bodyStart]

/** Start once, from startNative(). */
export async function startNativeSync() {
  if (started) return
  started = true
  const watched = snapshotWatched
  let last = watched(useStore.getState())
  useStore.subscribe((s) => {
    const now = watched(s)
    if (now.some((v, i) => v !== last[i])) { last = now; scheduleSnapshot() }
  })
  useNativeFeed.subscribe(() => scheduleSnapshot())

  try {
    await bridgeOn('queueChanged', () => { void drainQueue() })
    await bridgeOn('appActive', () => { void drainQueue().then((r) => { if (!r) scheduleSnapshot() }) })
    await bridgeOn('appBackground', () => { void writeSnapshotNow() })
  } catch { /* no plugin: nothing to sync */ }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void drainQueue()
  })

  // notification schedule rebuilt after every snapshot write; the screen a notification tap asked for
  const { startNotifications } = await import('./notifyRuntime')
  startNotifications()
  // heart rate from Health for sauna sessions timed on the iPhone alone
  const { startSaunaHR } = await import('./saunaHR')
  startSaunaHR()
  // Sleep Lab: finished Sleep sounds nights and Screen Time's late phone use
  const { startSleepRuntime } = await import('./sleepRuntime')
  startSleepRuntime(bridgeOn)
  // the daily backup to Documents/Backups, the last 14 kept
  const { startBackups } = await import('./backupRuntime')
  startBackups(bridgeOn)
  try {
    await bridgeOn('openRoute', ({ route }) => { if (route) useNativeFeed.getState().setHealth({ route }) })
    const { route } = await PepitoBridge.takeRoute()
    if (route) useNativeFeed.getState().setHealth({ route })
  } catch { /* nothing to open */ }

  await drainQueue()
  await writeSnapshotNow()
  // midnight: the snapshot carries three days, but "today" in it should move on too
  setInterval(() => { scheduleSnapshot() }, 15 * 60 * 1000)
}
