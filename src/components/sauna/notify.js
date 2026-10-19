// One local notification at the end of a sauna timer, so the Watch buzzes
// while the phone is locked outside. iPhone app only; the web build has no
// notification and the timer simply shows the time.
//
// Permission is asked the first time a timer starts and never again: after a
// "Don't allow", the timer still works, just without the alert.

const ID = 4242

export async function scheduleSaunaAlert({ at, targetMin, asked, markAsked }) {
  if (!__NATIVE__) return false
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && !asked) {
      markAsked?.()
      perm = await LocalNotifications.requestPermissions()
    }
    if (perm.display !== 'granted') return false
    await LocalNotifications.cancel({ notifications: [{ id: ID }] })
    await LocalNotifications.schedule({
      notifications: [{ id: ID, title: 'Sauna', body: `${targetMin} min is up.`, schedule: { at: new Date(at), allowWhileIdle: true } }],
    })
    return true
  } catch {
    return false
  }
}

export async function cancelSaunaAlert() {
  if (!__NATIVE__) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [{ id: ID }] })
  } catch { /* nothing scheduled */ }
}
