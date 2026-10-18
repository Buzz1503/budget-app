// The few things the always-present screens (Body, Calendar) need to know about
// Health, without importing any of it. The native build's HealthBoot fills this
// in; on the web it stays empty and nothing reads Health at all.
import { create } from 'zustand'

export const useHealthLink = create((set) => ({
  /** True once the native app has found Apple Health on this device. */
  available: false,
  /** Dates (YYYY-MM-DD) with at least one workout, for the calendar marker. */
  workoutDates: new Set(),
  /** The Body tab's segment: measurements | recovery | sleep | training. */
  bodySegment: 'measurements',
  setBodySegment: (bodySegment) => set({ bodySegment }),
  setWorkoutDates: (workoutDates) => set({ workoutDates }),
}))
