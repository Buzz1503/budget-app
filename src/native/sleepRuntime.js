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
const localHour = (ms) => new Date(ms).getHours()

/** Move finished Sleep sounds nights and late phone use into the store. */
export async function collectSleepData() {
  try {
    const { sessions: all = [] } = await PepitoSleep.finishedSounds()
    // a session still listening stays on the phone until it has finished
    const sessions = all.filter((s) => !s.open)
    if (sessions.length) {
      useStore.getState().addSoundSessions(sessions, (s) => sessionNight(s, localDate, localHour))
      await PepitoSleep.acknowledgeSounds({ ids: sessions.map((s) => s.id) })
    }
  } catch { /* no plugin */ }
  try {
    const { entries = [] } = await PepitoSleep.soundsStartLog()
    useStore.getState().addSoundsLog(entries.map((e) => ({ ...e, error: e.error ?? null })))
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
/** Start in the foreground, the reliable way. Resolves with the exact result and the iOS error text. */
export async function startSounds(by = 'app') {
  try {
    const r = await PepitoSleep.startSounds({ by })
    await collectSleepData()
    return r
  } catch (e) { return { running: false, result: 'audioError', error: String(e?.message || e || '') } }
}
export async function stopSounds() {
  try { const r = await PepitoSleep.stopSounds({ reason: 'app' }); await collectSleepData(); return r } catch { return { running: false } }
}
/** Listen for one minute and say what was heard. Nothing is kept. */
export async function testSounds() {
  try { return await PepitoSleep.testSounds() } catch { return { ran: false, reason: 'unavailable' } }
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

/**
 * The bedtime safety net: a notification 10 minutes after planned bedtime on the next
 * 7 nights ("Sleep sounds is not listening yet"), cleared by the phone once listening starts.
 */
export async function syncSoundsCheck() {
  const ss = useStore.getState().sleepSettings || {}
  try { await PepitoSleep.scheduleSoundsCheck({ enabled: !!ss.sleepSounds && !!ss.lastBedtime, bedtime: ss.lastBedtime || '22:30' }) } catch { /* no plugin */ }
}

/** A tap on a "start it" notification: start now, in the foreground. */
export async function startIfAsked() {
  try {
    const { pending } = await PepitoSleep.takePendingStart()
    if (pending) await startSounds('notification')
  } catch { /* no plugin */ }
}

let started = false
export function startSleepRuntime(addListener) {
  if (started) return
  started = true
  void collectSleepData()
  void refreshSleepStatus()
  void startIfAsked()
  void syncSoundsCheck()
  let last = ''
  useStore.subscribe((s) => {
    const key = `${s.sleepSettings?.sleepSounds}|${s.sleepSettings?.lastBedtime}`
    if (key !== last) { last = key; void syncSoundsCheck() }
  })
  addListener?.('appActive', () => { void startIfAsked(); void collectSleepData(); void refreshSleepStatus(); void syncSoundsCheck() })
  void import('./runtime').then(({ listen }) => listen(PepitoSleep, 'PepitoSleep', 'sleepSoundsChanged', () => { void collectSleepData() }))
}
