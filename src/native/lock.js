// The Face ID lock's one decision: should coming back to the app ask again?
// Pure, so the grace periods (immediately, 1, 5, 15 min) are tested.

/** Locked on launch when the lock is on; on return once the grace period has passed. */
export function shouldLock({ enabled, graceSec = 0, backgroundedAt = null, now = Date.now(), launch = false }) {
  if (!enabled) return false
  if (launch || backgroundedAt == null) return true
  return now - backgroundedAt >= graceSec * 1000
}
