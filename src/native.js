// Everything the native (Capacitor) shell needs from the page, in one place.
//
// This file is only ever loaded by the native build — main.jsx reaches it
// through `if (__NATIVE__)`, a compile-time constant — so none of it, and none
// of the Capacitor packages, is in the GitHub Pages bundle.
import { SplashScreen } from '@capacitor/splash-screen'
import { Keyboard } from '@capacitor/keyboard'
import { setNativeKeyboard } from './lib/viewport'
import { startNativeSync } from './native/runtime'

// How long the launch image takes to fade out. Short: the app is ready the
// moment it has drawn once, and a launch image that lingers reads as a hang.
const SPLASH_FADE_MS = 250

/**
 * Called once, straight after the first render.
 *
 * The launch image is held (launchAutoHide is off in capacitor.config.json)
 * until the page has painted, so there is never a blank web view between the
 * two, and then fades out. The keyboard events feed the same "is the keyboard
 * up" signal the web build derives from the visual viewport, which the native
 * resize mode no longer shrinks relative to the window.
 */
export async function startNative() {
  // two frames: the first render has been committed and painted
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  try { await SplashScreen.hide({ fadeOutDuration: SPLASH_FADE_MS }) } catch { /* already gone */ }

  try {
    await Keyboard.addListener('keyboardWillShow', (info) => setNativeKeyboard({ open: true, height: info?.keyboardHeight || 0 }))
    await Keyboard.addListener('keyboardWillHide', () => setNativeKeyboard({ open: false, height: 0 }))
  } catch { /* no keyboard plugin: the web fallback in viewport.js still works */ }

  // the snapshot for widgets, notifications, Siri and the Watch, and the queue of what they asked for
  void startNativeSync()
}
