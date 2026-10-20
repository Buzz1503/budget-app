// The notification at the end of a sauna timer, so the Watch buzzes while the
// phone is locked outside. iPhone app only; the web build has no notification
// and the timer simply shows the time.
//
// Since stage 3B the alert itself is part of the native schedule
// (src/native/notifySchedule.js): starting the timer writes it to the store,
// the schedule is rebuilt, and stopping removes it the same way. All this file
// still does is ask for permission, the first time a timer starts and never
// again: after a "Don't allow", the timer still works, just without the alert.

export async function scheduleSaunaAlert({ asked, markAsked }) {
  if (!__NATIVE__) return false
  try {
    const { ensureNotificationPermission } = await import('../../native/notifyRuntime')
    return await ensureNotificationPermission({ asked, markAsked })
  } catch {
    return false
  }
}

/** Nothing to cancel by hand: clearing the timer rebuilds the schedule without it. */
export async function cancelSaunaAlert() {}
