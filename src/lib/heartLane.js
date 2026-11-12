// Resting heart rate for the "Heart" lane any chart can show. Filled by the
// iPhone app's Health code (HeartLaneFeed); empty on the web, where no Health
// code ships, so the option simply does not appear there.
import { create } from 'zustand'

export const useHeartLane = create(() => ({ points: [] }))
