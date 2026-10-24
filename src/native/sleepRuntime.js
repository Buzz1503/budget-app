// The Sleep Lab's native glue, iPhone app only: collects finished Sleep sounds
// nights and Screen Time's late phone use into the store, and lets the
// screens start and stop Sleep sounds. Nothing goes to the console or the
// network; a failure is "no data".
import { registerPlugin } from '@capacitor/core'
import useStore from '../store/useStore'
import { sessionNight } from '../sleep/sounds'

export const PepitoSleep = registerPlugin('PepitoSleep')

const localDate = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Move finished Sleep sounds nights and late phone use into the store. */
export async function collectSleepData() {
  try {
    const { sessions = [] } = await PepitoSleep.finishedSounds()
    if (sessions.length) {
      useStore.getState().addSoundSessions(sessions, (s) => sessionNight(s, localDate))
      await PepitoSleep.acknowledgeSounds({ ids: sessions.map((s) => s.id) })
    }
  } catch { /* no plugin */ }
  try {
    const { nights = {} } = await PepitoSleep.lateUse()
    if (Object.keys(nights).length) useStore.getState().setLateUse(nights)
  } catch { /* no plugin */ }
}

/**
 * What the setup checklist and the evening sheet need to know: Screen Time
 * allowed and apps chosen, and a HomeKit sensor to read.
 */
export async function refreshSleepStatus() {
  const so = await soundsStatus()
  const sc = await screenTimeStatus()
  const ss = useStore.getState().sleepSettings || {}
  const patch = { screenTimeOn: !!(sc.authorized && sc.picked), screenTimeAvailable: sc.available !== false, roomSensor: !!so.roomSensor }
  if (Object.keys(patch).some((k) => ss[k] !== patch[k])) useStore.getState().setSleepSettings(patch)
}

export async function soundsStatus() {
  try { return await PepitoSleep.soundsStatus() } catch { return { running: false, unavailable: true } }
}
export async function startSounds() {
  try { return await PepitoSleep.startSounds({ by: 'app' }) } catch { return { running: false } }
}
export async function stopSounds() {
  try { const r = await PepitoSleep.stopSounds({ reason: 'app' }); await collectSleepData(); return r } catch { return { running: false } }
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
  void import('./runtime').then(({ listen }) => listen(PepitoSleep, 'PepitoSleep', 'sleepSoundsChanged', () => { void collectSleepData() }))
}
