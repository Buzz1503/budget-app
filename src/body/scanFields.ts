// What a body-composition scan can hold beyond the everyday fields.
//
// The first-class scan fields are their own measurements, never folded into
// the app's muscle mass or visceral fat (a scale's "muscle mass" and a scan's
// skeletal muscle mass are different numbers, and so are a scale's visceral
// rating and a scan's visceral fat level). Everything else a scan reports
// lives in `extras`, shown grouped in the entry's detail view.

export const SCAN_DEVICES = ['Evolt 360', 'DEXA', 'InBody', 'Other']

/** Scan-only measurements, charted and compared like any other field. */
export const SCAN_FIELDS = [
  { key: 'fatMass', label: 'Fat mass', unit: 'kg' },
  { key: 'leanMass', label: 'Lean body mass', unit: 'kg' },
  { key: 'skeletalMuscleMass', label: 'Skeletal muscle mass', unit: 'kg' },
  { key: 'visceralFatLevel', label: 'Visceral fat level', unit: '' },
  { key: 'visceralFatMass', label: 'Visceral fat mass', unit: 'kg' },
  { key: 'visceralFatArea', label: 'Visceral fat area', unit: 'cm²' },
  { key: 'subcutaneousFatMass', label: 'Subcutaneous fat mass', unit: 'kg' },
]
export const SCAN_FIELD_BY_KEY = Object.fromEntries(SCAN_FIELDS.map((f) => [f.key, f]))

export const EXTRA_GROUPS = ['Composition', 'Segmental', 'Energy', 'Scores']

/** Known extras, in display order. Unknown keys still show, under Composition. */
export const EXTRA_DEFS = [
  { key: 'totalBodyWater', label: 'Total body water', unit: 'kg', group: 'Composition' },
  { key: 'protein', label: 'Protein', unit: 'kg', group: 'Composition' },
  { key: 'mineral', label: 'Mineral', unit: 'kg', group: 'Composition' },
  { key: 'icf', label: 'Intracellular fluid', unit: 'kg', group: 'Composition' },
  { key: 'ecf', label: 'Extracellular fluid', unit: 'kg', group: 'Composition' },
  { key: 'abdominalCircumference', label: 'Abdominal circumference', unit: 'cm', group: 'Composition' },
  { key: 'waistHipRatio', label: 'Waist to hip ratio', unit: '', group: 'Composition' },
  ...['leftArm', 'rightArm', 'torso', 'leftLeg', 'rightLeg'].flatMap((seg) => {
    const name = ({ leftArm: 'Left arm', rightArm: 'Right arm', torso: 'Torso', leftLeg: 'Left leg', rightLeg: 'Right leg' } as Record<string, string>)[seg]
    return [
      { key: `${seg}Lean`, label: `${name}, lean`, unit: 'kg', group: 'Segmental' },
      { key: `${seg}Fat`, label: `${name}, fat`, unit: 'kg', group: 'Segmental' },
    ]
  }),
  { key: 'bmr', label: 'BMR', unit: 'kcal', group: 'Energy' },
  { key: 'tee', label: 'TEE', unit: 'kcal', group: 'Energy' },
  { key: 'bioAge', label: 'Bio age', unit: '', group: 'Scores' },
  { key: 'bwiScore', label: 'BWI score', unit: '', group: 'Scores' },
]
const EXTRA_BY_KEY: Record<string, { key: string; label: string; unit: string; group: string }> = Object.fromEntries(EXTRA_DEFS.map((d) => [d.key, d]))

/** An entry's extras as [{ group, rows: [{ key, label, unit, value }] }], empty groups left out. */
export interface ExtraRow { key: string; label: string; unit: string; group: string; value: unknown }

export function groupedExtras(extras: Record<string, unknown> | null | undefined = {}): Array<{ group: string; rows: ExtraRow[] }> {
  const rows = Object.entries(extras || {})
    .filter(([, v]) => v != null && v !== '')
    .map(([key, value]) => ({ ...(EXTRA_BY_KEY[key] || { label: key, unit: '', group: 'Composition' }), key, value }))
  const order = (k: string) => { const i = EXTRA_DEFS.findIndex((d) => d.key === k); return i < 0 ? 999 : i }
  return EXTRA_GROUPS
    .map((group) => ({ group, rows: rows.filter((r) => r.group === group).sort((a, b) => order(a.key) - order(b.key)) }))
    .filter((g) => g.rows.length)
}

// ------------------------------------------------- the Evolt starting scan

const SEGMENTAL = {
  leftArmLean: 3.65, leftArmFat: 2.58, rightArmLean: 3.72, rightArmFat: 2.32,
  torsoLean: 28.86, torsoFat: 21.84, leftLegLean: 8.83, leftLegFat: 5.78,
  rightLegLean: 8.98, rightLegFat: 5.49,
}
const AS_SCANNED = { abdominalCircumference: 116.6, waistHipRatio: 1.02, bioAge: 41, bwiScore: 5.4 }

export const EVOLT_START_ID = 'm-evolt-2025-01-13-start'
export const EVOLT_ORIGINAL_ID = 'm-evolt-2025-01-13-original'

/** The 13 Jan 2025 Evolt scan adjusted to the 105.6 kg starting weight. */
export const EVOLT_START_SCAN = {
  id: EVOLT_START_ID,
  date: '2025-01-13',
  source: 'scan',
  device: 'Evolt 360',
  label: 'Start (adjusted to 105.6 kg)',
  estimated: true,
  estimateNote: 'Evolt scan at 102.6 kg on 13 Jan 2025, adjusted to starting weight 105.6 kg. Extra 3.0 kg split 79% fat, 21% lean (Forbes model). Lean-based values scaled with lean mass, fat-based values with fat mass, BMR by Evolt formula 370 + 21.6 x lean mass. Visceral level, waist, segmental, bio age and BWI are as scanned.',
  weight: 105.6,
  bodyFat: 38.3,
  fatMass: 40.4,
  leanMass: 65.2,
  skeletalMuscleMass: 35.6,
  subcutaneousFatMass: 32.6,
  visceralFatMass: 7.8,
  visceralFatArea: 197,
  visceralFatLevel: 16,
  heightCm: 170,
  ageAtScan: 34,
  extras: {
    totalBodyWater: 47.0, protein: 12.4, mineral: 5.9, icf: 31.4, ecf: 15.6,
    ...AS_SCANNED, bmr: 1779, tee: 2740, ...SEGMENTAL,
  },
}

/** The same scan exactly as measured at 102.6 kg: kept on record, not used as the start, off the charts. */
export const EVOLT_ORIGINAL_SCAN = {
  id: EVOLT_ORIGINAL_ID,
  date: '2025-01-13',
  source: 'scan',
  device: 'Evolt 360',
  label: 'Original scan, not used as start',
  hiddenFromCharts: true,
  weight: 102.6,
  bodyFat: 37.0,
  fatMass: 38.0,
  leanMass: 64.6,
  skeletalMuscleMass: 35.3,
  subcutaneousFatMass: 30.7,
  visceralFatMass: 7.3,
  visceralFatArea: 185,
  visceralFatLevel: 16,
  heightCm: 170,
  ageAtScan: 34,
  extras: {
    totalBodyWater: 46.5, protein: 12.3, mineral: 5.8, icf: 31.1, ecf: 15.4,
    ...AS_SCANNED, bmr: 1765, tee: 2718, ...SEGMENTAL,
  },
}
