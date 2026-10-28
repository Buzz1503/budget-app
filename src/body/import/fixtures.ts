// Synthetic text fixtures for the import tests: laid out like the reports
// (columns by position), invented numbers matching the brief's 26 Oct 2026
// values. Not real PDFs. Tests that need the real files read
// test-fixtures/private/ and skip when it is empty.

import { linesFromText, type PdfLine } from './pdfLines'

const W = 28
/** Cells padded to fixed columns, so x positions line up like the report's. */
export const cols = (...cells: string[]) => cells.map((c) => c.padEnd(W)).join('').trimEnd()

export const EVOLT_26_OCT_PAGE1 = [
  'EVOLT 360 BODY COMPOSITION ANALYSIS',
  cols('', '', '', '26-10-2026 12:41'),
  '170 cm 92.5 kg 36 Male',
  cols('1. LEAN BODY MASS', '2. SKELETAL MUSCLE MASS', '3. PROTEIN', '4. MINERAL', '5. TOTAL BODY WATER'),
  cols('kg', 'kg', 'kg', 'kg', 'kg'),
  cols('66.5 / High [47.3 - 57.8]', '36.7 / High [26.4 - 32.3]', '13.3 / High [9.5 - 11.7]', '5.3 / High [3.2 - 4.0]', '47.9 / High [34.5 - 42.2]'),
  cols('6. BODY FAT MASS', '7. BODY FAT PERCENTAGE', '8. VISCERAL FAT AREA', '9. BMI', '10. BODY WATER INDEX'),
  cols('kg', '%', 'cm2', '', ''),
  cols('26.0 / High [8.9 - 13.3]', '28.1 / High [15.0 - 20.0]', '129 / High [50.0 - 100.0]', '32.0 / High [18.5 - 25.0]', '6.6 / Normal [5.0 - 10.0]'),
  cols('11. VISCERAL FAT LEVEL'),
  '',
  cols('13 / Over Range [1 - 9]'),
  // the ICF value sits a row above its label, the ECF value a row below
  cols('31.8 kg (66%)', '', '', 'BIO AGE 39'),
  cols('ICF', 'ECF', 'BMR', 'TEE'),
  cols('', '16.1 kg (34%)', '1806 kcal', '2781 kcal'),
  cols('SUBCUTANEOUS FAT', 'VISCERAL FAT MASS', 'ABDOMINAL CIRCUMFERENCE'),
  cols('21.9 kg (23.7%)', '4.1 kg (4.4%)', '101.4 cm'),
  // segmental: 11 numbers with the waist to hip ratio mixed in after the torso
  cols('LEFT ARM', '', 'RIGHT ARM'),
  cols('3.89 kg', '', '3.96 kg'),
  cols('1.57 kg', '', '1.37 kg'),
  cols('', 'TORSO'),
  cols('', '29.78 kg'),
  cols('', '15.39 kg', 'WAIST HIP RATIO 0.93'),
  cols('', '', '0.75 - 0.90'),
  cols('LEFT LEG', '', 'RIGHT LEG'),
  cols('8.95 kg', '', '9.06 kg'),
  cols('3.95 kg', '', '3.72 kg'),
  cols('UPPER - LOWER Balanced', '', 'LEFT - RIGHT Balanced'),
].join('\n')

export const EVOLT_26_OCT_NUTRITION = [
  'YOUR NUTRITION',
  'DAILY CALORIES',
  '2206 - 2306 kcal',
  cols('PROTEIN', 'CARBS', 'FAT'),
  cols('165g - 173g (30%)', '193g - 202g (35%)', '86g - 90g (35%)'),
].join('\n')

export const evolt26Oct = (): PdfLine[] => [...linesFromText(EVOLT_26_OCT_PAGE1, 1), ...linesFromText('Your results explained\nSome text', 2), ...linesFromText(EVOLT_26_OCT_NUTRITION, 3)]

/** The 26 Oct 2026 values from the brief, in the scan entry's keys. */
export const EVOLT_26_OCT_EXPECTED = {
  date: '2026-10-26', time: '12:41', weight: 92.5, leanMass: 66.5, fatMass: 26.0, bodyFat: 28.1, skeletalMuscleMass: 36.7,
  protein: 13.3, mineral: 5.3, totalBodyWater: 47.9, icf: 31.8, ecf: 16.1, subcutaneousFatMass: 21.9, subcutaneousFatPct: 23.7,
  visceralFatMass: 4.1, visceralFatPct: 4.4, visceralFatArea: 129, visceralFatLevel: 13, bmr: 1806, tee: 2781, bioAge: 39,
  bwiScore: 6.6, abdominalCircumference: 101.4, waistHipRatio: 0.93,
  leftArmLean: 3.89, leftArmFat: 1.57, rightArmLean: 3.96, rightArmFat: 1.37, torsoLean: 29.78, torsoFat: 15.39,
  leftLegLean: 8.95, leftLegFat: 3.95, rightLegLean: 9.06, rightLegFat: 3.72,
}

export const WITHINGS_REPORT_TEXT = [
  'Withings Medical Report',
  'Health report',
  'Overview 24 May - 24 Jun 2026',
  cols('Weight', '', 'BMI'),
  cols('93.9 kg', '-1.0 kg', '33'),
  cols('36 weigh-ins'),
  cols('Fat mass', 'Muscle mass', 'Bone mass'),
  cols('30.4 %', '63.0 kg', '3.3 kg'),
  cols('Lean mass', 'Water mass', 'Visceral fat'),
  cols('66.3 kg', '45.9 kg', '4.8'),
  cols('Basal metabolic rate', 'Metabolic age'),
  cols('1959 kcal', '39 years'),
  'Heart rate',
  cols('Awake average', 'Asleep average'),
  cols('70 bpm', '58 bpm'),
  'Sleep',
  cols('Weekdays', 'Weekends', 'Sleep efficiency'),
  cols('6h35', '6h29', '91 %'),
  cols('Snoring', '0 min over 14 nights'),
].join('\n')
