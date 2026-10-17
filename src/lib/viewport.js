import { useEffect, useState } from 'react'

// The iOS keyboard draws a suggestion/accessory strip above itself that the
// visual viewport does not always subtract — most reliably in a standalone PWA,
// which is how this app is installed. Reserving its height costs one row of a
// list; not reserving it hides the row the user was reaching for.
export const ACCESSORY_BAR = 44

// Below this a viewport change is a URL bar collapsing or a rotation, not a
// keyboard. Every phone keyboard is far taller than 120px.
const KEYBOARD_MIN = 120

// In the native (Capacitor) shell the Keyboard plugin resizes the web view
// itself, so the window is already the part above the keyboard: innerHeight and
// the visual viewport shrink together and their difference — how the web build
// knows a keyboard is up — is always zero. The plugin's events say it instead.
let nativeKb = { open: false, height: 0 }
const nativeListeners = new Set()

export function setNativeKeyboard(next) {
  nativeKb = { open: !!next.open, height: next.height || 0 }
  nativeListeners.forEach((fn) => fn())
}

/**
 * The viewport, as numbers. Pure: everything it reads is passed in.
 * `native` selects the Capacitor path described above.
 */
export function viewportState({ native = false, kb = nativeKb, innerHeight = 800, vv = null } = {}) {
  if (native) {
    return { height: innerHeight, offsetTop: 0, keyboard: kb.height, keyboardOpen: kb.open, native: true }
  }
  const height = vv ? vv.height : innerHeight
  const keyboard = Math.max(0, innerHeight - height)
  return {
    height,
    offsetTop: vv ? vv.offsetTop : 0,
    keyboard,
    keyboardOpen: keyboard > KEYBOARD_MIN,
    native: false,
  }
}

function read() {
  if (typeof window === 'undefined') {
    return { height: 800, offsetTop: 0, keyboard: 0, keyboardOpen: false, native: false }
  }
  return viewportState({
    native: __NATIVE__, innerHeight: window.innerHeight, vv: window.visualViewport,
  })
}

/**
 * The part of the window you can actually see.
 *
 * A phone's on-screen keyboard does not resize the layout viewport, so `100vh`,
 * `100dvh` and `window.innerHeight` all keep describing a window whose bottom
 * half is now behind the keyboard. A sheet sized against any of them puts its
 * own search field, results and Save button somewhere the user cannot reach.
 * `visualViewport` is the one measurement that shrinks when the keyboard opens,
 * so it is the one worth sizing against.
 */
export function useVisualViewport() {
  const [vp, setVp] = useState(read)

  useEffect(() => {
    const vv = window.visualViewport
    // The keyboard animates in. A single reading taken at the start of that
    // animation describes a viewport that no longer exists by the end of it,
    // so settle on the value after the transition as well as during it.
    let settle
    const onChange = () => {
      setVp(read())
      clearTimeout(settle)
      settle = setTimeout(() => setVp(read()), 260)
    }
    nativeListeners.add(onChange)
    vv?.addEventListener('resize', onChange)
    vv?.addEventListener('scroll', onChange)
    window.addEventListener('resize', onChange)
    window.addEventListener('orientationchange', onChange)
    onChange()
    return () => {
      clearTimeout(settle)
      nativeListeners.delete(onChange)
      vv?.removeEventListener('resize', onChange)
      vv?.removeEventListener('scroll', onChange)
      window.removeEventListener('resize', onChange)
      window.removeEventListener('orientationchange', onChange)
    }
  }, [])

  return vp
}

/**
 * How tall a bottom sheet may be, given what the keyboard has left of the
 * window. With the keyboard down this keeps the old proportion, so a sheet
 * still reads as a sheet rather than a full-screen takeover.
 */
export function sheetMaxHeight(vp) {
  // Native: the web view already ends where the keyboard (accessory strip
  // included) begins, so there is no strip to reserve a row for.
  const gutter = vp.keyboardOpen ? (vp.native ? 12 : ACCESSORY_BAR) : Math.round(vp.height * 0.12)
  return Math.max(200, Math.round(vp.height - gutter))
}

/**
 * Bring a field the user just focused back into view.
 *
 * Called after the keyboard has finished animating, because scrolling against
 * a viewport that is still shrinking lands in the wrong place. `block: 'nearest'`
 * moves the minimum needed — a field already visible does not jump.
 */
export function scrollFocusedIntoView(el) {
  if (!el || typeof el.scrollIntoView !== 'function') return
  try {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  } catch {
    el.scrollIntoView(false)
  }
}

const FIELD = 'input, textarea, select, [contenteditable="true"]'

/**
 * Keep whatever is focused inside `ref` clear of the keyboard.
 *
 * Attaches to focusin rather than to each field, so a sheet that grows new
 * inputs — a picker that turns into a form, a wizard that changes step — is
 * covered without every one of them having to remember to opt in.
 */
export function useKeyboardSafeFocus(ref, active = true) {
  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return
    let timer
    const onFocusIn = (e) => {
      const el = e.target
      if (!el || !el.matches?.(FIELD)) return
      clearTimeout(timer)
      // long enough for the keyboard animation and the viewport resize that
      // follows it; scrolling before then aims at a viewport that is still moving
      timer = setTimeout(() => scrollFocusedIntoView(el), 320)
    }
    node.addEventListener('focusin', onFocusIn)
    return () => {
      clearTimeout(timer)
      node.removeEventListener('focusin', onFocusIn)
    }
  }, [ref, active])
}
