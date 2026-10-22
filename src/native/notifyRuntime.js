// Hands the notification schedule to iOS. iPhone app only.
//
// After every snapshot write the whole rolling schedule is rebuilt from the
// store and replaces the previous one, so a change to the protocol, a log, a
// skip or a setting is reflected at once. Low-stock alerts are worked out here
// too, remembered in nativeState so each fires once.
import useStore from '../store/useStore'
import { buildSchedule, doseReminderDevices } from './notifySchedule'
import { stockNotices, vialChangeNotice } from './stockNotices'
import { PepitoBridge, onSnapshotWritten, onActionsApplied } from './runtime'
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

// Notices to add to the next rebuild, once (the question after a log that the
// app was not in front for).
let extras = []

const same = (a = {}, b = {}) => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/** Rebuild and hand over the whole schedule, with the stock notices that go with it. */
export async function rebuildSchedule() {
  if ((await permission()) !== 'granted') return 0
  const state = useStore.getState()
  const now = new Date()
  let watchReady
  try { watchReady = !!(await PepitoBridge.watchStatus())?.installed } catch { watchReady = false }
  const planned = buildSchedule(state, { now, verdictOf: await verdictOf(), watchReady })
  // order, fridge-life and count notices go where dose reminders go (Remind me
  // on); the ones that are due at once are added once and left alone
  const onPhone = doseReminderDevices(state.notificationSettings?.remindOn, watchReady).phone
  const stock = stockNotices(state, { now })
  const stockPlanned = stock.notices.filter((n) => n.immediate || onPhone)
  const prevSent = state.nativeState?.ordersSent || {}
  const nextSent = { ...prevSent, ...stock.sent }
  if (!same(prevSent, nextSent)) state.markOrdersSent(stock.sent)
  const asked = extras
  extras = []
  try {
    const r = await PepitoBridge.scheduleNotifications({ json: JSON.stringify([...planned, ...stockPlanned, ...asked]) })
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
  // a log applied while the app was not in front can leave a vial about empty:
  // the question goes out as a notification with its two answers
  onActionsApplied(async () => {
    if (document.visibilityState === 'visible') return
    const fresh = useStore.getState().vialPrompts
    if (!fresh.length) return
    extras = fresh.map((pr) => vialChangeNotice(pr))
    await rebuildSchedule()
  })
  // the Watch app installed or removed moves dose reminders between devices
  void PepitoBridge.addListener('watchChanged', () => { void rebuildSchedule() }).catch(() => {})
}
