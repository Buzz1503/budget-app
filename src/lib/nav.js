// Where things live: the segment each tab is showing, so any screen (and a
// notification, widget, Watch or Siri route) can open a tab at the right place.
//
//   Today     readiness and last night, today's log, sauna quick start
//   Sleep     Last night | Heart | Trends            (iPhone app only)
//   Body      Composition | Measurements | Photos
//   Insights  Compounds | Sleep Lab | Sauna          (Sleep Lab and Sauna need Apple Health)
//   More      Sauna log and timer, Protocol, Stock, Calendar, Bloods, Reactions, Data, Settings
import { create } from 'zustand'
import { useHealthLink } from './healthLink'

export const SLEEP_SEGMENTS = [
  { id: 'night', label: 'Last night' },
  { id: 'heart', label: 'Heart' },
  { id: 'trends', label: 'Trends' },
]
export const BODY_SEGMENTS = [
  { id: 'composition', label: 'Composition' },
  { id: 'measurements', label: 'Measurements' },
  { id: 'photos', label: 'Photos' },
]
export const INSIGHTS_SEGMENTS = [
  { id: 'compounds', label: 'Compounds' },
  { id: 'lab', label: 'Sleep Lab', health: true },
  { id: 'sauna', label: 'Sauna', health: true },
]

export const useNav = create((set) => ({
  sleepSegment: 'night',
  insightsSegment: 'compounds',
  /** Inside Insights › Sleep Lab: null for the page, or analysis | restless | apnea | nightmares. */
  labView: null,
  setSleepSegment: (sleepSegment) => set({ sleepSegment }),
  setInsightsSegment: (insightsSegment) => set({ insightsSegment, labView: null }),
  setLabView: (labView) => set({ labView }),
}))

/**
 * Every place a link can point, as [tab, segment]. Old names from earlier
 * versions (Body › Effects, Body › Recovery, the Sauna tab) are kept so deep
 * links from notifications, widgets, the Watch and Siri still land.
 */
export const DESTINATIONS = {
  today: ['today'],
  home: ['today'],
  doses: ['today'],
  readiness: ['readiness'],
  recovery: ['readiness'],
  sleep: ['sleep', 'night'],
  evening: ['sleep', 'night'],
  'last-night': ['sleep', 'night'],
  heart: ['sleep', 'heart'],
  'sleep-trends': ['sleep', 'trends'],
  body: ['body'],
  composition: ['body', 'composition'],
  measurements: ['body', 'measurements'],
  photos: ['body', 'photos'],
  insights: ['insights'],
  effects: ['insights', 'compounds'],
  compounds: ['insights', 'compounds'],
  outcomes: ['insights', 'compounds'],
  'sleep-lab': ['insights', 'lab'],
  lab: ['insights', 'lab'],
  'sauna-insights': ['insights', 'sauna'],
  sauna: ['sauna'],
}

/** Open a destination: sets the tab's segment and returns the screen id to show (null when unknown). */
export function openDestination(id) {
  const d = DESTINATIONS[id]
  if (!d) return null
  const [screen, segment] = d
  if (segment && screen === 'sleep') useNav.getState().setSleepSegment(segment)
  if (segment && screen === 'insights') useNav.getState().setInsightsSegment(segment)
  if (segment && screen === 'body') useHealthLink.getState().setBodySegment(segment)
  return screen
}

/**
 * Every feature and its one home, as the taps from a tab bar button: a tab
 * alone is 0 taps, a segment or a row 1, a row inside a segment 2. Other
 * places only link here. `health` features exist in the iPhone app only.
 */
export const FEATURE_HOMES = [
  { feature: 'Readiness and last night', home: ['today'], taps: 0 },
  { feature: "Today's dose log", home: ['today'], taps: 0 },
  { feature: 'Sauna quick start', home: ['today'], taps: 0 },
  { feature: 'Readiness in detail (HRV, readiness chart)', home: ['today', 'Readiness card'], taps: 1, health: true },
  { feature: 'Why I woke', home: ['today'], taps: 0, health: true },
  { feature: 'Last night', home: ['sleep', 'night'], taps: 0, health: true },
  { feature: 'Wake-ups', home: ['sleep', 'night'], taps: 0, health: true },
  { feature: 'Heart (resting and sleeping HR by dose)', home: ['sleep', 'heart'], taps: 1, health: true },
  { feature: 'Switch comparison', home: ['sleep', 'heart', 'switch row'], taps: 2, health: true },
  { feature: 'Sleep trends', home: ['sleep', 'trends'], taps: 1, health: true },
  { feature: 'Composition and DEXA', home: ['body', 'composition'], taps: 0 },
  { feature: 'Tape measurements', home: ['body', 'measurements'], taps: 1 },
  { feature: 'Progress photos', home: ['body', 'photos'], taps: 1 },
  { feature: 'Per-compound effects', home: ['insights', 'compounds'], taps: 0, health: true },
  { feature: 'Body outcomes by weeks on compound', home: ['insights', 'compounds'], taps: 0 },
  { feature: 'Compare (dose timing, before and after, habits)', home: ['insights', 'compounds', 'Compare'], taps: 1, health: true },
  { feature: 'Good vs bad nights', home: ['insights', 'lab'], taps: 1, health: true },
  { feature: 'Sleep Lab analysis', home: ['insights', 'lab', 'Open Sleep Lab'], taps: 2, health: true },
  { feature: 'Restless nights, apnea screen, nightmares', home: ['insights', 'lab', 'row'], taps: 2, health: true },
  { feature: 'Outlier nights and exclusions', home: ['insights', 'lab'], taps: 1, health: true },
  { feature: 'Sauna effects', home: ['insights', 'sauna'], taps: 1, health: true },
  { feature: 'Sauna log, timer and history', home: ['more', 'sauna'], taps: 1 },
  { feature: 'Calendar', home: ['more', 'calendar'], taps: 1 },
  { feature: 'Reactions', home: ['more', 'reactions'], taps: 1 },
  { feature: 'Bloods', home: ['more', 'bloods'], taps: 1 },
  { feature: 'Stock', home: ['more', 'supplies'], taps: 1 },
  { feature: 'Protocol', home: ['more', 'protocol'], taps: 1 },
  { feature: 'Import', home: ['more', 'scans'], taps: 1 },
  { feature: 'Backups and reports', home: ['more', 'reports'], taps: 1 },
  { feature: 'Settings', home: ['more', 'settings'], taps: 1 },
  { feature: 'Apple Health settings', home: ['more', 'health'], taps: 1, health: true },
]
