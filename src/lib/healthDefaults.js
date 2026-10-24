import { EVENING_FACTORS } from '../sleep/logging'
// Defaults for the Health journal, kept outside the Health folder because the
// app store (which runs on the web too) needs them.

// The evening factors since the Sleep Lab (v26). Caffeine after 2pm, Late meal
// and Cold plunge were defaults before it; saves that have them keep them hidden.
export const DEFAULT_HABITS = EVENING_FACTORS.map(({ id, name }) => ({ id, name }))

export const CHECKIN_ITEMS = [
  { key: 'energy', label: 'Energy' },
  { key: 'mood', label: 'Mood' },
  { key: 'appetite', label: 'Appetite' },
  { key: 'drive', label: 'Drive' },
]
