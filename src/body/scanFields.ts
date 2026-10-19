// Everything a body-composition scan can hold, as first-class fields.
//
// Each scan value is its own field on the entry, charted and compared like any
// other, and never folded into a look-alike: a scan's skeletal muscle mass is
// not the app's "muscle mass" (a scale reading), and a scan's visceral fat
// level is not the app's "visceral fat" rating. A scan also carries its
// device, time, an estimated flag with a note, a status and a reference range
// per metric as printed on the scan, its balance verdicts, and the device's
// own nutrition recommendations (shown only in the scan's detail view).

export const SCAN_DEVICES = ['Evolt 360', 'DEXA', 'InBody', 'Other']

export interface ScanMetric {
  key: string
  label: string
  unit: string
  group: 'Composition' | 'Fat distribution' | 'Water' | 'Energy' | 'Scores' | 'Index' | 'Segmental'
  /** key in pepito-scan-import/v1 */
  importKey?: string
  /** which way is progress, for colouring changes: down, up, or neither */
  better?: 'down' | 'up' | null
  dp: number
}

export const SEGMENTS = [
  { key: 'leftArm', label: 'Left arm', importKey: 'left_arm' },
  { key: 'rightArm', label: 'Right arm', importKey: 'right_arm' },
  { key: 'torso', label: 'Torso', importKey: 'torso' },
  { key: 'leftLeg', label: 'Left leg', importKey: 'left_leg' },
  { key: 'rightLeg', label: 'Right leg', importKey: 'right_leg' },
] as const

export const SCAN_METRICS: ScanMetric[] = [
  { key: 'weight', label: 'Weight', unit: 'kg', group: 'Composition', importKey: 'weight_kg', better: 'down', dp: 1 },
  { key: 'bodyFat', label: 'Body fat', unit: '%', group: 'Composition', importKey: 'body_fat_pct', better: 'down', dp: 1 },
  { key: 'fatMass', label: 'Fat mass', unit: 'kg', group: 'Composition', importKey: 'fat_mass_kg', better: 'down', dp: 1 },
  { key: 'leanMass', label: 'Lean body mass', unit: 'kg', group: 'Composition', importKey: 'lean_body_mass_kg', better: 'up', dp: 1 },
  { key: 'skeletalMuscleMass', label: 'Skeletal muscle mass', unit: 'kg', group: 'Composition', importKey: 'skeletal_muscle_mass_kg', better: 'up', dp: 1 },
  { key: 'protein', label: 'Protein', unit: 'kg', group: 'Composition', importKey: 'protein_kg', better: 'up', dp: 1 },
  { key: 'mineral', label: 'Mineral', unit: 'kg', group: 'Composition', importKey: 'mineral_kg', better: null, dp: 1 },
  { key: 'subcutaneousFatMass', label: 'Subcutaneous fat', unit: 'kg', group: 'Fat distribution', importKey: 'subcutaneous_fat_kg', better: 'down', dp: 1 },
  { key: 'subcutaneousFatPct', label: 'Subcutaneous fat', unit: '%', group: 'Fat distribution', importKey: 'subcutaneous_fat_pct', better: 'down', dp: 1 },
  { key: 'visceralFatMass', label: 'Visceral fat', unit: 'kg', group: 'Fat distribution', importKey: 'visceral_fat_kg', better: 'down', dp: 1 },
  { key: 'visceralFatPct', label: 'Visceral fat', unit: '%', group: 'Fat distribution', importKey: 'visceral_fat_pct', better: 'down', dp: 1 },
  { key: 'visceralFatArea', label: 'Visceral fat area', unit: 'cm²', group: 'Fat distribution', importKey: 'visceral_fat_area_cm2', better: 'down', dp: 0 },
  { key: 'visceralFatLevel', label: 'Visceral fat level', unit: '', group: 'Fat distribution', importKey: 'visceral_fat_level', better: 'down', dp: 0 },
  { key: 'abdominalCircumference', label: 'Abdominal circumference', unit: 'cm', group: 'Fat distribution', importKey: 'abdominal_circumference_cm', better: 'down', dp: 1 },
  { key: 'waistHipRatio', label: 'Waist to hip ratio', unit: '', group: 'Fat distribution', importKey: 'waist_hip_ratio', better: 'down', dp: 2 },
  { key: 'totalBodyWater', label: 'Total body water', unit: 'kg', group: 'Water', importKey: 'total_body_water_kg', better: null, dp: 1 },
  { key: 'icf', label: 'Intracellular fluid', unit: 'kg', group: 'Water', importKey: 'icf_kg', better: null, dp: 1 },
  { key: 'icfPct', label: 'Intracellular fluid', unit: '%', group: 'Water', importKey: 'icf_pct', better: null, dp: 0 },
  { key: 'ecf', label: 'Extracellular fluid', unit: 'kg', group: 'Water', importKey: 'ecf_kg', better: null, dp: 1 },
  { key: 'ecfPct', label: 'Extracellular fluid', unit: '%', group: 'Water', importKey: 'ecf_pct', better: null, dp: 0 },
  { key: 'bmr', label: 'BMR', unit: 'kcal', group: 'Energy', importKey: 'bmr_kcal', better: null, dp: 0 },
  { key: 'tee', label: 'TEE', unit: 'kcal', group: 'Energy', importKey: 'tee_kcal', better: null, dp: 0 },
  { key: 'bioAge', label: 'Bio age', unit: '', group: 'Scores', importKey: 'bio_age', better: 'down', dp: 0 },
  { key: 'bwiScore', label: 'BWI score', unit: '', group: 'Scores', importKey: 'bwi_score', better: 'up', dp: 1 },
  ...SEGMENTS.flatMap((s) => [
    { key: `${s.key}Lean`, label: `${s.label}, lean`, unit: 'kg', group: 'Segmental' as const, better: 'up' as const, dp: 2 },
    { key: `${s.key}Fat`, label: `${s.label}, fat`, unit: 'kg', group: 'Segmental' as const, better: 'down' as const, dp: 2 },
  ]),
]
export const SCAN_METRIC_BY_KEY: Record<string, ScanMetric> = Object.fromEntries(SCAN_METRICS.map((m) => [m.key, m]))

/** Fields only a scan has (charted, compared, never mapped to a look-alike). */
export const SCAN_ONLY_KEYS = SCAN_METRICS.filter((m) => !['weight', 'bodyFat'].includes(m.key)).map((m) => m.key)

/** Kept for the entry sheet's number fields: the main scan-only measurements. */
export const SCAN_FIELDS = SCAN_METRICS.filter((m) => ['fatMass', 'leanMass', 'skeletalMuscleMass', 'visceralFatLevel', 'visceralFatMass', 'visceralFatArea', 'subcutaneousFatMass'].includes(m.key))
export const SCAN_FIELD_BY_KEY = Object.fromEntries(SCAN_FIELDS.map((f) => [f.key, f]))

export const DETAIL_GROUPS = ['Composition', 'Fat distribution', 'Water', 'Energy', 'Scores', 'Segmental'] as const

export interface DetailRow { key: string; label: string; unit: string; value: number; status: string | null; range: [number, number] | null; dp: number }

/** A scan's values for its detail view, grouped, empty groups left out. */
export function groupedScanFields(entry: Record<string, unknown>): Array<{ group: string; rows: DetailRow[] }> {
  const status = (entry.status || {}) as Record<string, string>
  const ranges = (entry.ranges || {}) as Record<string, [number, number]>
  return DETAIL_GROUPS.map((group) => ({
    group,
    rows: SCAN_METRICS.filter((m) => m.group === group && typeof entry[m.key] === 'number')
      .map((m) => ({ key: m.key, label: m.label, unit: m.unit, value: entry[m.key] as number, status: status[m.key] || null, range: ranges[m.key] || null, dp: m.dp })),
  })).filter((g) => g.rows.length)
}

// ------------------------------------------------- the Evolt starting point

export const EVOLT_START_ID = 'm-evolt-2025-01-13-start'
/** The untimed copy of the 13 Jan 2025 scan added before the history was imported. */
export const EVOLT_ORIGINAL_ID = 'm-evolt-2025-01-13-original'

const SEGMENTAL_13_JAN = {
  leftArmLean: 3.65, leftArmFat: 2.58, rightArmLean: 3.72, rightArmFat: 2.32,
  torsoLean: 28.86, torsoFat: 21.84, leftLegLean: 8.83, leftLegFat: 5.78,
  rightLegLean: 8.98, rightLegFat: 5.49,
}

/**
 * The 13 Jan 2025 Evolt scan adjusted to the 105.6 kg starting weight. Used
 * only as the starting point: it stays off the charts, which show the real
 * 102.6 kg scan from that morning.
 */
export const EVOLT_START_SCAN = {
  id: EVOLT_START_ID,
  date: '2025-01-13',
  source: 'scan',
  device: 'Evolt 360',
  label: 'Start (adjusted to 105.6 kg)',
  estimated: true,
  estimateNote: 'Evolt scan at 102.6 kg adjusted to starting weight 105.6 kg. Extra 3.0 kg split 79% fat, 21% lean (Forbes model). Lean-based values scaled with lean, fat-based with fat, BMR by 370 + 21.6 x lean.',
  hiddenFromCharts: true,
  weight: 105.6,
  bodyFat: 38.3,
  fatMass: 40.4,
  leanMass: 65.2,
  skeletalMuscleMass: 35.6,
  totalBodyWater: 47.0,
  protein: 12.4,
  mineral: 5.9,
  icf: 31.4,
  ecf: 15.6,
  subcutaneousFatMass: 32.6,
  visceralFatMass: 7.8,
  visceralFatArea: 197,
  visceralFatLevel: 16,
  abdominalCircumference: 116.6,
  waistHipRatio: 1.02,
  bmr: 1779,
  tee: 2740,
  bioAge: 41,
  bwiScore: 5.4,
  heightCm: 170,
  ageAtScan: 34,
  ...SEGMENTAL_13_JAN,
}
