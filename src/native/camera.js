// The progress photos' native helpers (iPhone app only): camera access, the
// app's page in Settings, and Apple's Vision body pose detection for Auto
// align. On the web every call answers as if nothing were there.
import { registerPlugin } from '@capacitor/core'

const PepitoCamera = registerPlugin('PepitoCamera')
const native = () => typeof __NATIVE__ !== 'undefined' && __NATIVE__

/** 'granted' | 'denied' | 'restricted' | 'prompt' | 'unknown' (web) */
export async function cameraStatus() {
  if (!native()) return 'unknown'
  try { return (await PepitoCamera.status()).camera || 'unknown' } catch { return 'unknown' }
}

export async function openAppSettings() {
  if (!native()) return false
  try { return !!(await PepitoCamera.openSettings()).opened } catch { return false }
}

/** Joint positions (0 to 1, origin top left) in a photo, or null when no one is found. */
export async function detectPose(blob) {
  if (!native()) return null
  try {
    const base64 = await blobToBase64(blob)
    const r = await PepitoCamera.detectPose({ image: base64 })
    return r?.found ? r.points : null
  } catch { return null }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new globalThis.FileReader()
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '')
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

/** A camera that is off for the app: show the message, never open the camera. */
export const cameraBlocked = (status) => status === 'denied' || status === 'restricted'

/**
 * What Take photo does: show the "camera is off" message, open the in-app
 * camera with the last photo over it, or open the iPhone camera.
 */
export function captureRoute({ camera, guideOn, hasPrev, liveFailed }) {
  if (cameraBlocked(camera)) return 'blocked'
  if (guideOn && hasPrev && !liveFailed) return 'live'
  return 'camera'
}
