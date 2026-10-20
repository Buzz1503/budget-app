// What the Health screens know that the snapshot needs: today's readiness and
// the max heart rate the zones use. Filled by NativeHealthFeed (a lazy Health
// component), read by the snapshot builder. Not persisted: it is rebuilt from
// the Health cache every launch.
import { create } from 'zustand'

export const useNativeFeed = create((set) => ({
  readiness: null,
  maxHR: null,
  setHealth: (patch) => set(patch),
}))
