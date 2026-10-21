// Hands the notification schedule to iOS. iPhone app only.
//
// After every snapshot write the whole rolling schedule is rebuilt from the
// store and replaces the previous one, so a change to the protocol, a log, a
// skip or a setting is reflected at once. Low-stock alerts are worked out here
// too, remembered in nativeState so each fires once.
import useStore from '../store/useStore'
import { buildSchedule, stockAlerts } from './notifySchedule'
import { PepitoBridge, onSnapshotWritten } from './runtime'
import { loadMatrix, LIB_TO_COMPOUND } from '../lib/mixMatrix'

let matrix = null
async function verdictOf() {
  if (!matrix) {
    try { matrix = await loadMatrix() } catch { matrix = false }
  }
  if (!matrix) return null
  return (a, b) => matrix.lookup(LIB_TO_COMPOUND[a] || a, LIB_TO_COMPOUND[b] || b)?.verdict || null
}

export async function permission() {
  try { return (await PepitoBridge.notificationPermission()).display } catch { return 'prompt' }
}

/**
 * Ask once. Called the first time the Notifications page opens or a sauna
 * timer starts, never at launch.
 */
export async function ensureNotificationPermission({ asked = useStore.getState().notificationSettings?.permissionAsked, markAsked } = {}) {
  let display = await permission()
  if (display === 'prompt' && !asked) {
    markAsked?.()
    useStore.getState().setNotificationSettings({ permissionAsked: true })
    try { display = (await PepitoBridge.requestNotificationPermission()).display } catch { display = 'denied' }
    if (display === 'granted') await rebuildSchedule()
  }
  return display === 'granted'
}

/** Rebuild and hand over the whole schedule (and any new low-stock alert). */
export async function rebuildSchedule() {
  if ((await permission()) !== 'granted') return 0
  const state = useStore.getState()
  const now = new Date()
  let watchReady
  try { watchReady = !!(await PepitoBridge.watchStatus())?.installed } catch { watchReady = false }
  const planned = buildSchedule(state, { now, verdictOf: await verdictOf(), watchReady })
  const stock = stockAlerts(state, { now, alerted: state.nativeState?.stockAlerted || [] })
  const prev = state.nativeState?.stockAlerted || []
  if (stock.alerted.join('|') !== prev.join('|')) state.setNativeState({ stockAlerted: stock.alerted })
  try {
    const r = await PepitoBridge.scheduleNotifications({ json: JSON.stringify([...planned, ...stock.notify]) })
    return r?.scheduled ?? 0
  } catch {
    return 0
  }
}

let started = false
export function startNotifications() {
  if (started) return
  started = true
  onSnapshotWritten(() => rebuildSchedule())
  // the Watch app installed or removed moves dose reminders between devices
  void PepitoBridge.addListener('watchChanged', () => { void rebuildSchedule() }).catch(() => {})
}
