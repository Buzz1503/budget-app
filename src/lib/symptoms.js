// Symptom tag palette + pattern helpers. Observations, never diagnoses.
import { parseISO, differenceInCalendarDays } from 'date-fns'

export const SYMPTOM_TAGS = [
  // negatives
  { id: 'nausea', label: 'Nausea', polarity: 'neg', icon: '🤢' },
  { id: 'headache', label: 'Headache', polarity: 'neg', icon: '🤕' },
  { id: 'injection-site', label: 'Injection-site reaction', polarity: 'neg', icon: '💉' },
  { id: 'fatigue', label: 'Fatigue', polarity: 'neg', icon: '🥱' },
  { id: 'flushing', label: 'Flushing', polarity: 'neg', icon: '🥵' },
  { id: 'low-appetite', label: 'Low appetite', polarity: 'neg', icon: '🍽️' },
  { id: 'lightheaded', label: 'Lightheaded', polarity: 'neg', icon: '💫' },
  { id: 'bloating', label: 'Bloating / GI', polarity: 'neg', icon: '🎈' },
  // positives
  { id: 'great-energy', label: 'Great energy', polarity: 'pos', icon: '⚡' },
  { id: 'better-sleep', label: 'Better sleep', polarity: 'pos', icon: '😴' },
  { id: 'mood-lift', label: 'Mood lift', polarity: 'pos', icon: '😄' },
  { id: 'less-joint-pain', label: 'Less joint pain', polarity: 'pos', icon: '🦵' },
  { id: 'good-pumps', label: 'Good pumps', polarity: 'pos', icon: '💪' },
  { id: 'sharp-focus', label: 'Sharp focus', polarity: 'pos', icon: '🎯' },
  { id: 'calm', label: 'Calm', polarity: 'pos', icon: '🧘' },
  { id: 'appetite-control', label: 'Appetite control', polarity: 'pos', icon: '🥗' },
]

export const TAG_BY_ID = Object.fromEntries(SYMPTOM_TAGS.map((t) => [t.id, t]))

export const INJECTION_SITES = [
  { id: 'abdomen-l', label: 'Abdomen L' },
  { id: 'abdomen-r', label: 'Abdomen R' },
  { id: 'thigh-l', label: 'Thigh L' },
  { id: 'thigh-r', label: 'Thigh R' },
  { id: 'arm-l', label: 'Upper arm L' },
  { id: 'arm-r', label: 'Upper arm R' },
]

export const SEVERITY = ['mild', 'moderate', 'strong']

// Surface simple co-occurrence observations (peptide ↔ negative symptom).
export function findPatterns(logs) {
  const counts = {} // key: `${peptideId}|${tagId}` → count
  const negTotals = {}
  for (const log of logs) {
    const negs = (log.tags || []).filter((t) => t.polarity === 'neg')
    for (const t of negs) {
      negTotals[t.id] = (negTotals[t.id] || 0) + 1
      for (const ap of log.activePeptides || []) {
        const k = `${ap.id}|${t.id}`
        counts[k] = (counts[k] || 0) + 1
      }
    }
  }
  const out = []
  for (const [k, n] of Object.entries(counts)) {
    if (n < 2) continue
    const [pid, tid] = k.split('|')
    out.push({ peptideId: pid, tagId: tid, count: n })
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 4)
}

export function daysAgo(dateStr, todayStr) {
  return differenceInCalendarDays(parseISO(todayStr), parseISO(dateStr))
}
