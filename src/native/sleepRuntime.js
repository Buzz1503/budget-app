// The Sleep Lab's native glue, iPhone app only: Screen Time's late phone use
// into the store. Nothing goes to the console or the network; a failure is
// "no data". (Sleep sounds and the Watch movement recording were removed: all
// sleep data comes from Apple Health. Their stored nights stay in the store
// and the backup.)
import { registerPlugin } from '@capacitor/core'
import useStore from '../store/useStore'

export const PepitoSleep = registerPlugin('PepitoSleep')

/** Move late phone use into the store. */
export async function collectSleepData() {
  try {
    const { nights = {} } = await PepitoSleep.lateUse()
    if (Object.keys(nights).length) useStore.getState().setLateUse(nights)
  } catch { /* no plugin */ }
}

/** What the setup checklist and the evening sheet need to know: Screen Time allowed and apps chosen. */
export async function refreshSleepStatus() {
  const sc = await screenTimeStatus()
  const ss = useStore.getState().sleepSettings || {}
  const patch = { screenTimeOn: !!(sc.authorized && sc.picked), screenTimeAvailable: sc.available !== false }
  if (Object.keys(patch).some((k) => ss[k] !== patch[k])) useStore.getState().setSleepSettings(patch)
}

export async function screenTimeStatus() {
  try { return await PepitoSleep.screenTimeStatus() } catch { return { available: false } }
}
export async function requestScreenTime() {
  try { return await PepitoSleep.requestScreenTime() } catch { return { authorized: false } }
}
export async function pickLateUseApps() {
  try { return await PepitoSleep.pickLateUseApps() } catch { return { picked: false } }
}
/** Watch phone use each night from planned bedtime to the usual wake time. */
export async function scheduleLateUse(bedtime, wake) {
  try { return await PepitoSleep.scheduleLateUse({ bedtime, wake }) } catch { return { scheduled: false } }
}

let started = false
export function startSleepRuntime(addListener) {
  if (started) return
  started = true
  void collectSleepData()
  void refreshSleepStatus()
  addListener?.('appActive', () => { void collectSleepData(); void refreshSleepStatus() })
}
