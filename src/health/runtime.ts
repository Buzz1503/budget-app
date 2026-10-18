// Is there Health on this device, and how to reach it.
//
// HEALTH_BUILD is decided at build time: true for the native (iOS) build, and
// for a dev build started with VITE_DEMO_HEALTH=1. In the GitHub Pages build it
// is false, so every Health screen and this whole folder are compiled out.

import { Capacitor, registerPlugin } from '@capacitor/core'
import type { HealthBridge } from './bridge'
import { nativeBridge } from './bridge'
import type { Tz } from './tz'
import { HealthDB, HEALTH_DB_NAME } from './cache'

export const DEMO: boolean = import.meta.env.DEV && import.meta.env.VITE_DEMO_HEALTH === '1'
export const HEALTH_BUILD: boolean = __NATIVE__ || DEMO

/** True when Health can actually be read here: the iOS app, or the dev demo. */
export function healthRuntime(): boolean {
  if (!HEALTH_BUILD) return false
  if (DEMO) return true
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export async function createBridge(tz: Tz): Promise<HealthBridge | null> {
  if (DEMO) {
    const { demoBridge } = await import('./demo')
    return demoBridge({ now: Date.now(), tz })
  }
  if (!healthRuntime()) return null
  const { Health } = await import('@capgo/capacitor-health')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const own = registerPlugin<any>('PepitoHealth')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return nativeBridge({ capgo: Health as any, own, tz })
}

let db: HealthDB | null = null
export function healthDb(): HealthDB {
  if (!db) db = new HealthDB(DEMO ? `${HEALTH_DB_NAME}-demo` : HEALTH_DB_NAME)
  return db
}
