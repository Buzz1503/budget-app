// What the screens read: the Health cache held in memory, and the sync status.
//
// Not persisted through the app store, on purpose — the cache lives in its own
// IndexedDB database and is rebuilt from Apple Health whenever it is missing.

import { create } from 'zustand'
import type { HealthSnapshot } from './cache'
import { loadAll, clearAll } from './cache'
import type { SyncProgress } from './sync'
import { syncHealth } from './sync'
import type { SourceClass } from './types'
import { makeTz } from './tz'
import { createBridge, healthDb, healthRuntime } from './runtime'

const EMPTY: HealthSnapshot = {
  daily: [], nights: [], workouts: [],
  meta: { lastSyncAt: null, backfillDone: false, characteristics: {} },
}

export interface HealthState {
  available: boolean
  loaded: boolean
  syncing: boolean
  progress: SyncProgress | null
  failed: boolean
  data: HealthSnapshot
  load: () => Promise<void>
  connect: (opts: { priority?: SourceClass[] }) => Promise<boolean>
  sync: (opts: { priority?: SourceClass[]; full?: boolean }) => Promise<void>
  resetCache: () => Promise<void>
}

export const useHealth = create<HealthState>((set, get) => ({
  available: healthRuntime(),
  loaded: false,
  syncing: false,
  progress: null,
  failed: false,
  data: EMPTY,

  async load() {
    if (!get().available) return
    try {
      set({ data: await loadAll(healthDb()), loaded: true })
    } catch {
      set({ loaded: true, failed: true })
    }
  },

  async connect({ priority }) {
    const bridge = await createBridge(makeTz())
    if (!bridge) return false
    const ok = await bridge.requestAuthorization()
    if (ok) await get().sync({ priority, full: true })
    return ok
  },

  async sync({ priority, full = false }) {
    if (!get().available || get().syncing) return
    set({ syncing: true, failed: false, progress: null })
    try {
      const bridge = await createBridge(makeTz())
      if (!bridge) return
      await syncHealth({
        bridge, db: healthDb(), tz: makeTz(), priority, full,
        onProgress: (progress) => set({ progress }),
      })
      set({ data: await loadAll(healthDb()), loaded: true })
    } catch {
      set({ failed: true })
    } finally {
      set({ syncing: false, progress: null })
    }
  },

  async resetCache() {
    await clearAll(healthDb())
    set({ data: EMPTY })
  },
}))

/**
 * Sync on launch and whenever the app comes back to the foreground. Returns a
 * function that stops listening.
 */
export function startAutoSync(getPriority: () => SourceClass[] | undefined): () => void {
  const run = () => { void useHealth.getState().sync({ priority: getPriority() }) }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  void useHealth.getState().load().then(run)
  document.addEventListener('visibilitychange', onVisible)
  return () => document.removeEventListener('visibilitychange', onVisible)
}
