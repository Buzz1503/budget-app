// Body-composition metrics + series builders for trends and the Outcome Engine.
import { parseISO } from 'date-fns'
import { cycleInfo, currentRung, daysBetween, addDaysStr } from './schedule'
import { toMg } from './calc'

// Rules that apply to every measurement — shown once, not repeated per field.
export const MEASURE_RULES = [
  'Measure at the same time of day every time.',
  'Same tape tension — snug against the skin, not compressing it.',
  'Muscle relaxed, never flexed.',
  'For any girth, read the tape at the end of a normal exhale.',
]

// Limb measurements are only repeatable if you return to the identical spot, so
// the distance up the limb is set once and saved. Defaults are examples — the
// number that matters is whichever one the user actually uses.
export const REF_DISTANCES = {
  arm: {
    id: 'arm', label: 'Upper arm reference', default: 18, unit: 'cm',
    from: 'up from the elbow crease',
    help: 'Pick a distance up from the elbow crease and keep it forever — that is the spot you measure every time.',
  },
  thigh: {
    id: 'thigh', label: 'Thigh reference', default: 15, unit: 'cm',
    from: 'above the top of the kneecap',
    help: 'Pick a distance above the top of the kneecap and keep it forever, so it is the identical spot each time.',
  },
}

export const DEFAULT_BODY_REFS = { arm: REF_DISTANCES.arm.default, thigh: REF_DISTANCES.thigh.default }

/** The saved reference distance rendered as the phrase shown next to the field. */
export function refPhrase(refs, refKey) {
  const meta = REF_DISTANCES[refKey]
  if (!meta) return null
  const value = refs?.[refKey] ?? meta.default
  return `${value} ${meta.unit} ${meta.from}`
}

// better: direction that counts as progress (down = smaller is better).
// how: exactly where and how to take the reading, so two readings are comparable.
// side: 'L'/'R' — left and right are stored separately and never averaged.
// refKey: this measurement depends on a saved fixed reference distance.
// guide: which schematic illustration to draw beside it.
export const METRICS = [
  {
    key: 'weight', label: 'Weight', unit: 'kg', better: 'down', color: 'var(--lime)', roll: true,
    guide: 'weight',
    how: 'Morning, after the bathroom, before eating or drinking.',
  },
  { key: 'bodyFat', label: 'Body fat', unit: '%', better: 'down', color: 'var(--amber)', how: 'From a scan or a body-composition scale — same device and same conditions each time.' },
  { key: 'visceralFat', label: 'Visceral fat', unit: '', better: 'down', color: 'var(--coral)', how: 'Scan or scale reading — same device each time.' },
  { key: 'muscleMass', label: 'Muscle mass', unit: 'kg', better: 'up', color: 'var(--violet)', how: 'Scan or scale reading — same device each time.' },
  {
    key: 'neck', label: 'Neck', unit: 'cm', better: 'down', color: 'var(--indigo)', guide: 'neck',
    how: "Around the neck just below the Adam's apple, tape level.",
  },
  {
    key: 'chest', label: 'Chest', unit: 'cm', better: 'up', color: 'var(--indigo)', guide: 'chest',
    how: 'Around the fullest part at nipple level, arms relaxed, end of a normal exhale.',
  },
  {
    key: 'waist', label: 'Waist', unit: 'cm', better: 'down', color: 'var(--indigo)', guide: 'waist',
    how: 'Tape horizontal around the belly button (navel) the whole way round, relaxed, end of a normal exhale.',
  },
  {
    key: 'hips', label: 'Hips', unit: 'cm', better: 'down', color: 'var(--indigo)', guide: 'hips',
    how: 'Around the widest part of the buttocks, feet together, tape horizontal.',
  },

  {
    key: 'armL', label: 'Upper arm — left', short: 'Left', unit: 'cm', better: 'up', color: 'var(--violet)',
    group: 'arm', side: 'L', refKey: 'arm', guide: 'arm',
    how: 'Arm relaxed at your side; measure at your saved distance up from the elbow crease. Always the same arm position.',
  },
  {
    key: 'armR', label: 'Upper arm — right', short: 'Right', unit: 'cm', better: 'up', color: 'var(--violet)',
    group: 'arm', side: 'R', refKey: 'arm', guide: 'arm',
    how: 'Arm relaxed at your side; measure at your saved distance up from the elbow crease. Always the same arm position.',
  },
  {
    key: 'forearmL', label: 'Forearm — left', short: 'Left', unit: 'cm', better: 'up', color: 'var(--violet)',
    group: 'forearm', side: 'L', guide: 'forearm',
    how: 'Widest part below the elbow, arm relaxed.',
  },
  {
    key: 'forearmR', label: 'Forearm — right', short: 'Right', unit: 'cm', better: 'up', color: 'var(--violet)',
    group: 'forearm', side: 'R', guide: 'forearm',
    how: 'Widest part below the elbow, arm relaxed.',
  },
  {
    key: 'thighL', label: 'Thigh — left', short: 'Left', unit: 'cm', better: 'up', color: 'var(--violet)',
    group: 'thigh', side: 'L', refKey: 'thigh', guide: 'thigh',
    how: 'Standing, weight even on both feet; measure at your saved distance above the top of the kneecap.',
  },
  {
    key: 'thighR', label: 'Thigh — right', short: 'Right', unit: 'cm', better: 'up', color: 'var(--violet)',
    group: 'thigh', side: 'R', refKey: 'thigh', guide: 'thigh',
    how: 'Standing, weight even on both feet; measure at your saved distance above the top of the kneecap.',
  },
  {
    key: 'calfL', label: 'Calf — left', short: 'Left', unit: 'cm', better: 'up', color: 'var(--violet)',
    group: 'calf', side: 'L', guide: 'calf',
    how: 'Widest part, standing.',
  },
  {
    key: 'calfR', label: 'Calf — right', short: 'Right', unit: 'cm', better: 'up', color: 'var(--violet)',
    group: 'calf', side: 'R', guide: 'calf',
    how: 'Widest part, standing.',
  },
]
export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]))

// Single-value arm/thigh fields from before the left/right split. They are never
// offered for new entries — a single old number can't be split into two sides
// without inventing one — but old readings stay visible in Trends.
export const LEGACY_METRICS = [
  { key: 'arms', label: 'Arms (before L/R split)', unit: 'cm', better: 'up', color: 'var(--muted)', legacy: true },
  { key: 'thighs', label: 'Thighs (before L/R split)', unit: 'cm', better: 'up', color: 'var(--muted)', legacy: true },
]
export const ALL_METRIC_BY_KEY = {
  ...METRIC_BY_KEY,
  ...Object.fromEntries(LEGACY_METRICS.map((m) => [m.key, m])),
}

export function legacyMetricsPresent(measurements) {
  return LEGACY_METRICS.filter((m) => measurements.some((x) => x[m.key] != null && x[m.key] !== ''))
}

// Primary fields shown in the quick-entry form (rest are optional extras).
export const PRIMARY_FIELDS = ['weight', 'bodyFat', 'visceralFat', 'muscleMass', 'waist']

// Extras, grouped so a left/right pair sits on one row under one instruction.
export const EXTRA_GROUPS = [
  { id: 'neck', label: 'Neck', keys: ['neck'] },
  { id: 'chest', label: 'Chest', keys: ['chest'] },
  { id: 'hips', label: 'Hips', keys: ['hips'] },
  { id: 'arm', label: 'Upper arm', keys: ['armL', 'armR'] },
  { id: 'forearm', label: 'Forearm', keys: ['forearmL', 'forearmR'] },
  { id: 'thigh', label: 'Thigh', keys: ['thighL', 'thighR'] },
  { id: 'calf', label: 'Calf', keys: ['calfL', 'calfR'] },
]
export const EXTRA_FIELDS = EXTRA_GROUPS.flatMap((g) => g.keys)

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
