import type { ISODate } from '../data/records'
import type { DayKind, SessionId } from '../data/types'
import { addDays, weekday } from './dates'

const ROTATION: SessionId[] = ['A', 'B', 'C']

export function nextSession(last: SessionId | null): SessionId {
  if (!last) return 'A'
  const i = ROTATION.indexOf(last)
  return ROTATION[(i + 1) % ROTATION.length] ?? 'A'
}

export interface DayPlan {
  kind: DayKind
  session: SessionId | null
}

/**
 * What a day is: a gym day runs the next session in the A → B → C rotation,
 * the day after a gym day is home rehab, anything else is a rest day.
 */
export function dayPlan(date: ISODate, gymDays: readonly number[], lastSession: SessionId | null): DayPlan {
  if (gymDays.includes(weekday(date))) return { kind: 'gym', session: nextSession(lastSession) }
  if (gymDays.includes(weekday(addDays(date, -1)))) return { kind: 'home', session: null }
  return { kind: 'rest', session: null }
}

/** Gym days must never be back to back (tendons need 48 hours), including Sat → Sun. */
export function backToBackDays(gymDays: readonly number[]): [number, number][] {
  const set = new Set(gymDays)
  return [...set].sort().filter((d) => set.has((d + 1) % 7)).map((d) => [d, (d + 1) % 7])
}
