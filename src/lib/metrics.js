// Body-composition metrics + series builders for trends and the Outcome Engine.
import { parseISO } from 'date-fns'
import { cycleInfo, currentRung, daysBetween, addDaysStr } from './schedule'
import { toMg } from './calc'

// better: direction that counts as progress (down = smaller is better).
export const METRICS = [
  { key: 'weight', label: 'Weight', unit: 'kg', better: 'down', color: 'var(--lime)', roll: true },
  { key: 'bodyFat', label: 'Body fat', unit: '%', better: 'down', color: 'var(--amber)' },
  { key: 'visceralFat', label: 'Visceral fat', unit: '', better: 'down', color: 'var(--coral)' },
  { key: 'muscleMass', label: 'Muscle mass', unit: 'kg', better: 'up', color: 'var(--violet)' },
  { key: 'waist', label: 'Waist', unit: 'cm', better: 'down', color: 'var(--indigo)' },
  { key: 'hips', label: 'Hips', unit: 'cm', better: 'down', color: 'var(--indigo)' },
  { key: 'chest', label: 'Chest', unit: 'cm', better: 'up', color: 'var(--indigo)' },
  { key: 'arms', label: 'Arms', unit: 'cm', better: 'up', color: 'var(--violet)' },
  { key: 'thighs', label: 'Thighs', unit: 'cm', better: 'up', color: 'var(--violet)' },
  { key: 'neck', label: 'Neck', unit: 'cm', better: 'down', color: 'var(--indigo)' },
]
export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]))

// Primary fields shown in the quick-entry form (rest are optional extras).
export const PRIMARY_FIELDS = ['weight', 'bodyFat', 'visceralFat', 'muscleMass', 'waist']
export const EXTRA_FIELDS = ['hips', 'chest', 'arms', 'thighs', 'neck']

// Sorted, deduped-by-date series of a single metric.
export function metricSeries(measurements, key) {
  return measurements
    .filter((m) => m[key] != null && m[key] !== '')
    .map((m) => ({ date: m.date, value: +m[key] }))
    .filter((p) => !Number.isNaN(p.value))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// N-day trailing rolling average over a dated series.
export function rollingAverage(series, windowDays = 7) {
  return series.map((pt, i) => {
    const cutoff = addDaysStr(pt.date, -(windowDays - 1))
    const win = series.filter((p, j) => j <= i && p.date >= cutoff)
    const avg = win.reduce((s, p) => s + p.value, 0) / win.length
    return { date: pt.date, value: Math.round(avg * 100) / 100 }
  })
}

export function latest(measurements, key) {
  const s = metricSeries(measurements, key)
  return s.length ? s[s.length - 1].value : null
}

export function delta(measurements, key) {
  const s = metricSeries(measurements, key)
  if (s.length < 2) return null
  return Math.round((s[s.length - 1].value - s[0].value) * 100) / 100
}

// Subjective wellbeing score per symptom-log day: +1 per positive tag,
// −severityRank per negative tag. Reuses existing Symptoms data.
const SEV = { mild: 1, moderate: 2, strong: 3 }
export function subjectiveSeries(symptomLogs) {
  return symptomLogs
    .map((l) => {
      let score = 0
      for (const t of l.tags || []) score += t.polarity === 'pos' ? 1 : -(SEV[t.severity] || 1)
      return { date: l.date, value: score }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

// A peptide's delivered dose (in its ladder unit) across a date range; 0 when
// off-cycle. Uses the *current* confirmed rung (we don't store rung history).
export function peptideDoseSeries(peptide, tState, fromStr, toStr) {
  const n = Math.max(1, daysBetween(fromStr, toStr) + 1)
  const { dose } = currentRung(peptide, tState)
  const out = []
  for (let i = 0; i < n; i++) {
    const date = addDaysStr(fromStr, i)
    const c = cycleInfo(peptide, date)
    out.push({ date, dose: c.isOn ? dose : 0, isOn: c.isOn })
  }
  return out
}

// Cycle on/off transitions + the current titration step marker, as annotations.
export function peptideEvents(peptide, tState, fromStr, toStr) {
  const events = []
  const n = Math.max(1, daysBetween(fromStr, toStr) + 1)
  let prevOn = null
  for (let i = 0; i < n; i++) {
    const date = addDaysStr(fromStr, i)
    const on = cycleInfo(peptide, date).isOn
    if (prevOn !== null && on !== prevOn) {
      events.push({ date, kind: on ? 'cycle-start' : 'cycle-stop', label: on ? 'Cycle on' : 'Cycle off' })
    }
    prevOn = on
  }
  if (tState?.levelStartDate && tState.level > 0 && tState.levelStartDate >= fromStr && tState.levelStartDate <= toStr) {
    events.push({ date: tState.levelStartDate, kind: 'step-up', label: `Lvl ${tState.level + 1}` })
  }
  return events
}

// Convenience: overall body-comp date range from measurements (fallback today).
export function measurementRange(measurements, todayStr) {
  if (!measurements.length) return { from: addDaysStr(todayStr, -28), to: todayStr }
  const dates = measurements.map((m) => m.date).sort()
  return { from: dates[0], to: todayStr }
}
