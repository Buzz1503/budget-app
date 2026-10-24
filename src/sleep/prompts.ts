// The Sleep Lab's prompts, so nothing needs remembering: the evening factors
// 30 minutes before planned bedtime and the morning check 30 minutes after the
// usual wake time. Built here once, for the iPhone's schedule and for the
// snapshot (the Watch plans the same entries, same ids, like stock notices).
// An evening already logged, or a morning already answered, gets no prompt.
//
// Also the quiet checks that follow from "I will forget to turn things on":
// Sleep sounds did not run last night, and a night with no Watch recording.

import { addDays } from '../health/tz'
import { eveningAnswered, morningAnswered } from './logging'
import type { AsNeededItem, AsNeededLog, EveningDetail, MorningCheck } from './logging'

export const PROMPTS = {
  eveningBeforeMin: 30,
  morningAfterMin: 30,
  days: 7,
  /** used until the sleep planner has a bedtime and wake time */
  bedtime: '22:30',
  wake: '07:00',
}

export const SCHEDULE_PREFIX = 'pepito.sched.'
export const SOUNDS_MISSED_LINE = "Sleep sounds didn't run last night. Check the automation."
export const NO_RECORDING_LINE = 'No Watch movement recording for this night.'

export interface Prompt {
  id: string
  kind: 'evening' | 'morning'
  /** the evening's date, or the wake date for the morning check */
  date: string
  title: string
  body: string
  fireAt: string
  category: 'EVENING' | 'MORNING'
  threadId: string
  timeSensitive: false
  payload: { kind: 'evening' | 'morning'; date: string; route: string }
}

const toMin = (hhmm: string) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** A local date plus minutes from its midnight (may run past it) as a Date. */
function localAt(date: string, minutes: number): Date {
  const [y, mo, d] = date.split('-').map(Number)
  return new Date(y, mo - 1, d, 0, minutes, 0, 0)
}

/** The evening an instant belongs to: before noon is the evening before. */
export function eveningOfInstant(iso: string, localDate: (d: Date) => string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  if (d.getHours() < 12) d.setDate(d.getDate() - 1)
  return localDate(d)
}

/**
 * Whether an evening is logged: any factor answered, drinks or a meal time
 * set, or an evening as-needed item (a sedative) taken that evening.
 */
export function eveningLogged(date: string, s: {
  habitLogs?: Record<string, Record<string, boolean>>
  eveningDetails?: Record<string, EveningDetail>
  asNeededLogs?: AsNeededLog[]
  asNeededItems?: AsNeededItem[]
}, localDate: (d: Date) => string): boolean {
  if (eveningAnswered(s.habitLogs?.[date], s.eveningDetails?.[date])) return true
  const pm = new Set((s.asNeededItems || []).filter((i) => i.slot === 'PM').map((i) => i.id))
  return (s.asNeededLogs || []).some((l) => pm.has(l.itemId) && eveningOfInstant(l.at, localDate) === date)
}

/**
 * The evening and morning prompts for the days ahead, from today. Evening on
 * date D fires 30 minutes before the planned bedtime (a bedtime after
 * midnight belongs to D and fires early on D + 1); the morning check for
 * wake date W fires at the usual wake time plus the delay.
 */
export function promptPlan(input: {
  today: string
  now: Date
  bedtime?: string | null
  wake?: string | null
  settings?: { eveningPrompt?: boolean; morningPrompt?: boolean; morningPromptAfterMin?: number }
  eveningDone: (date: string) => boolean
  morningDone: (date: string) => boolean
  days?: number
}): Prompt[] {
  const set = input.settings || {}
  const days = input.days ?? PROMPTS.days
  const bedMin = toMin(input.bedtime || PROMPTS.bedtime)
  // a bedtime before noon is after midnight: the same evening, the next calendar day
  const bedFromMidnight = bedMin < 12 * 60 ? bedMin + 24 * 60 : bedMin
  const wakeMin = toMin(input.wake || PROMPTS.wake)
  const after = set.morningPromptAfterMin ?? PROMPTS.morningAfterMin
  const out: Prompt[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(input.today, i)
    if (set.eveningPrompt !== false && !input.eveningDone(date)) {
      const fire = localAt(date, bedFromMidnight - PROMPTS.eveningBeforeMin)
      if (fire.getTime() > input.now.getTime()) {
        out.push({
          id: `${SCHEDULE_PREFIX}evening.${date}`, kind: 'evening', date,
          title: 'This evening',
          body: 'Anything unusual? Nothing unusual answers all as no, or Log drinks, as-needed items and the rest.',
          fireAt: fire.toISOString(), category: 'EVENING', threadId: 'pepito.sleep', timeSensitive: false,
          payload: { kind: 'evening', date, route: 'evening' },
        })
      }
    }
    if (set.morningPrompt !== false && !input.morningDone(date)) {
      const fire = localAt(date, wakeMin + after)
      if (fire.getTime() > input.now.getTime()) {
        out.push({
          id: `${SCHEDULE_PREFIX}morning.${date}`, kind: 'morning', date,
          title: 'Morning check',
          body: 'How rested do you feel? 1 is not at all, 5 is fully.',
          fireAt: fire.toISOString(), category: 'MORNING', threadId: 'pepito.sleep', timeSensitive: false,
          payload: { kind: 'morning', date, route: 'sleep' },
        })
      }
    }
  }
  return out.sort((a, b) => a.fireAt.localeCompare(b.fireAt))
}

/** The prompts for a store state, with its own done checks. */
export function promptsFor(state: {
  habitLogs?: Record<string, Record<string, boolean>>
  eveningDetails?: Record<string, EveningDetail>
  asNeededLogs?: AsNeededLog[]
  asNeededItems?: AsNeededItem[]
  morningChecks?: Record<string, MorningCheck>
  sleepSettings?: { eveningPrompt?: boolean; morningPrompt?: boolean; morningPromptAfterMin?: number; lastBedtime?: string; lastWake?: string }
}, { today, now, bedtime, wake, localDate }: { today: string; now: Date; bedtime?: string | null; wake?: string | null; localDate: (d: Date) => string }): Prompt[] {
  const ss = state.sleepSettings || {}
  return promptPlan({
    today, now,
    bedtime: bedtime || ss.lastBedtime, wake: wake || ss.lastWake,
    settings: ss,
    eveningDone: (d) => eveningLogged(d, state, localDate),
    morningDone: (d) => morningAnswered(state.morningChecks?.[d]),
  })
}

// ---------------------------------------------------------------- quiet checks

/**
 * "Sleep sounds didn't run last night": Sleep sounds is on, was on before
 * last night, is not running now, and nothing was recorded for this morning.
 */
export function soundsMissed(input: {
  enabled: boolean
  /** the first evening it was on (the setting's date, else the first recorded night) */
  onSince: string | null
  today: string
  running: boolean
  recordedTonight: boolean
}): boolean {
  if (!input.enabled || input.running || input.recordedTonight || !input.onSince) return false
  return input.onSince < input.today
}

/**
 * A night with no Watch movement recording is flagged once recording has
 * worked at least once (nights before the first summary are never flagged)
 * and the night has Health sleep data.
 */
export function recordingMissing(input: { enabled: boolean; date: string; firstRecorded: string | null; hasSleep: boolean; hasRecording: boolean }): boolean {
  if (!input.enabled || !input.hasSleep || input.hasRecording || !input.firstRecorded) return false
  return input.date > input.firstRecorded
}
