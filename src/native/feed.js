// What the Health screens know that the snapshot needs: today's readiness and
// the max heart rate the zones use. Filled by NativeHealthFeed (a lazy Health
// component), read by the snapshot builder. Not persisted: it is rebuilt from
// the Health cache every launch.
import { create } from 'zustand'

export const useNativeFeed = create((set) => ({
  readiness: null,
  maxHR: null,
  // tonight's planned bedtime and the usual wake time ('HH:MM'), from the sleep planner
  plannedBedtime: null,
  usualWake: null,
  // a screen a notification tap asked for; App opens it and clears it
  route: null,
  // the weekly count was asked for by a notification: the Stock screen opens it and clears this
  openCount: false,
  // the evening prompt's Log: the Sleep tab opens the evening sheet and clears this
  openEvening: false,
  // a "start Sleep sounds" notification was tapped: the Sleep tab opens the Sleep sounds screen
  openSounds: false,
  setHealth: (patch) => set(patch),
}))
