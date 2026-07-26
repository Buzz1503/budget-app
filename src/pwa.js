// Service-worker registration with a "new version available" prompt.
// Entirely optional: if the SW API is missing or registration fails (e.g. the
// single-file artifact build, or a browser with SW disabled), the app runs
// exactly as before.
import { registerSW } from 'virtual:pwa-register'

export function setupPWA({ onNeedRefresh, onOfflineReady } = {}) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return () => {}
  try {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() { onNeedRefresh?.(() => updateSW(true)) },
      onOfflineReady() { onOfflineReady?.() },
      onRegisterError(err) { console.warn('SW registration failed', err) },
    })
    return updateSW
  } catch (err) {
    console.warn('PWA setup skipped', err)
    return () => {}
  }
}
