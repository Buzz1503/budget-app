// The apnea screen. A screen, not a diagnosis: a home sleep study arranged
// through your GP is how sleep apnea is confirmed.
//
// STOP-BANG is a validated eight-question screen (Snoring, Tired, Observed
// breathing stops, Pressure, BMI over 35, Age over 50, Neck over 40 cm, male
// Gender). Each item is filled from your own data where it can be, shows
// where the answer came from, and can be set by hand.

import type { MorningCheck } from './logging'

export const APNEA_LABEL = 'Screen, not a diagnosis. A home sleep study arranged through your GP is how sleep apnea is confirmed.'
export const AIRWAY_NOTE = 'Alcohol and sedative medicines can relax airway muscles, which matters if apnea is present.'
export const TESTOSTERONE_NOTE = 'Testosterone therapy can worsen sleep apnea in some people.'
export const SPO2_NOTE = 'Apple Watch measures blood oxygen every so often, not continuously, so dips between readings are missed.'

export type ItemKey = 'snoring' | 'tired' | 'observed' | 'pressure' | 'bmi' | 'age' | 'neck' | 'male'

export interface StopBangItem {
  key: ItemKey
  label: string
  answer: boolean | null
  /** where the answer came from, in plain words */
  source: string
  overridden: boolean
}

export const ITEMS: Array<{ key: ItemKey; label: string }> = [
  { key: 'snoring', label: 'Snoring' },
  { key: 'tired', label: 'Tired during the day' },
  { key: 'observed', label: 'Breathing stops seen by someone' },
  { key: 'pressure', label: 'High blood pressure' },
  { key: 'bmi', label: 'BMI over 35' },
  { key: 'age', label: 'Age over 50' },
  { key: 'neck', label: 'Neck over 40 cm' },
  { key: 'male', label: 'Male' },
]

export const APNEA = {
  snoringNightMin: 10, // a recorded night counts as a snoring night from 10 minutes
  snoringShare: 0.3, // snoring on more than 30% of recorded nights
  tiredScore: 2, // rested 2 or less
  tiredShare: 0.5, // on more than half of the last 14 answered mornings
  tiredMornings: 14,
  tiredMinAnswers: 5,
  bpSys: 140,
  bpDia: 90,
  bpDays: 30,
  bmi: 35,
  age: 50,
  neckCm: 40,
  signalDays: 30,
  raiseShare: 0.25, // elevated breathing or SpO2 dips on more than 25% of nights raise the likelihood
}

export interface StopBangInput {
  /** recorded Sleep sounds nights, newest last: snoring minutes and whether the phone moved a lot */
  soundNights: Array<{ date: string; snoringMin: number; lowConfidence: boolean }>
  morning: Array<{ date: string } & MorningCheck>
  /** blood pressure readings in the last 30 days */
  bp: Array<{ sys: number; dia: number }>
  weightKg: number | null
  heightCm: number | null
  age: number | null
  neckCm: number | null
  sex: string | null
  overrides: Partial<Record<ItemKey, boolean>>
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** Each item with its answer and source; an override wins and says so. */
export function stopBang(input: StopBangInput): { items: StopBangItem[]; score: number; known: number; band: 'low' | 'intermediate' | 'high' } {
  const auto: Record<ItemKey, { answer: boolean | null; source: string }> = {} as never

  // Snoring: Sleep sounds (phone in the bed left out) or a partner's report
  const nights = input.soundNights.filter((n) => !n.lowConfidence)
  const snoringNights = nights.filter((n) => n.snoringMin >= APNEA.snoringNightMin).length
  const partner = input.morning.filter((m) => m.partner && m.partner !== 'notAsked')
  const partnerSnore = partner.filter((m) => m.partner === 'snoring' || m.partner === 'stopped').length
  if (nights.length && snoringNights / nights.length > APNEA.snoringShare) auto.snoring = { answer: true, source: `Sleep sounds: snoring on ${snoringNights} of ${nights.length} recorded nights (${pct(snoringNights / nights.length)})` }
  else if (partner.length && partnerSnore / partner.length > APNEA.snoringShare) auto.snoring = { answer: true, source: `Partner noticed snoring on ${partnerSnore} of ${partner.length} mornings` }
  else if (nights.length) auto.snoring = { answer: false, source: `Sleep sounds: snoring on ${snoringNights} of ${nights.length} recorded nights (${pct(snoringNights / nights.length)})` }
  else if (partner.length) auto.snoring = { answer: false, source: `Partner noticed snoring on ${partnerSnore} of ${partner.length} mornings` }
  else auto.snoring = { answer: null, source: 'No Sleep sounds nights or partner answers yet' }

  // Tired: rested 2 or less on more than half of the last 14 answered mornings
  const answered = input.morning.filter((m) => m.rested != null).slice(-APNEA.tiredMornings)
  const low = answered.filter((m) => (m.rested as number) <= APNEA.tiredScore).length
  auto.tired = answered.length >= APNEA.tiredMinAnswers
    ? { answer: low / answered.length > APNEA.tiredShare, source: `Morning check: rested 2 or less on ${low} of the last ${answered.length} answered mornings` }
    : { answer: null, source: `Morning check: ${answered.length} answered mornings, ${APNEA.tiredMinAnswers} needed` }

  // Observed: a partner saw breathing stop or gasping
  const stopped = partner.filter((m) => m.partner === 'stopped').length
  auto.observed = stopped ? { answer: true, source: `Partner noticed breathing stop or gasping on ${stopped} morning${stopped === 1 ? '' : 's'}` }
    : partner.length ? { answer: false, source: `No breathing stops in ${partner.length} partner answers` }
      : { answer: null, source: 'No partner answers yet' }

  // Pressure: the 30-day average at or above 140/90
  if (input.bp.length) {
    const sys = input.bp.reduce((s, r) => s + r.sys, 0) / input.bp.length
    const dia = input.bp.reduce((s, r) => s + r.dia, 0) / input.bp.length
    auto.pressure = { answer: sys >= APNEA.bpSys || dia >= APNEA.bpDia, source: `Blood pressure 30-day average ${Math.round(sys)}/${Math.round(dia)} (${input.bp.length} readings)` }
  } else auto.pressure = { answer: null, source: 'No blood pressure readings in 30 days' }

  // BMI from weight and height
  if (input.weightKg && input.heightCm) {
    const bmi = input.weightKg / (input.heightCm / 100) ** 2
    auto.bmi = { answer: bmi > APNEA.bmi, source: `BMI ${bmi.toFixed(1)} from ${input.weightKg} kg and ${input.heightCm} cm` }
  } else auto.bmi = { answer: null, source: input.weightKg ? 'Height not set' : 'No weight' }

  auto.age = input.age != null ? { answer: input.age > APNEA.age, source: `Age ${input.age}, from Health` } : { answer: null, source: 'Date of birth not in Health' }
  auto.neck = input.neckCm != null ? { answer: input.neckCm > APNEA.neckCm, source: `Neck ${input.neckCm} cm, from your tape measurements` } : { answer: null, source: 'No neck measurement' }
  auto.male = input.sex ? { answer: input.sex === 'male', source: 'From Health' } : { answer: null, source: 'Not in Health' }

  const items = ITEMS.map(({ key, label }) => {
    const o = input.overrides[key]
    return o != null
      ? { key, label, answer: o, source: `Set by you (${auto[key].source.charAt(0).toLowerCase()}${auto[key].source.slice(1)})`, overridden: true }
      : { key, label, answer: auto[key].answer, source: auto[key].source, overridden: false }
  })
  const score = items.filter((i) => i.answer === true).length
  return { items, score, known: items.filter((i) => i.answer != null).length, band: score <= 2 ? 'low' : score <= 4 ? 'intermediate' : 'high' }
}

export type Likelihood = 'Low' | 'Moderate' | 'High'
const LEVELS: Likelihood[] = ['Low', 'Moderate', 'High']

/**
 * The overall likelihood: from the STOP-BANG band, raised one level when
 * Apple's breathing disturbances are elevated on more than 25% of nights or
 * SpO2 dips occur on more than 25% of nights. The reasons, in plain words.
 */
export function likelihood(band: 'low' | 'intermediate' | 'high', signals: { elevatedNights: number; breathingNights: number; dipNights: number; spo2Nights: number }) {
  const base = band === 'low' ? 0 : band === 'intermediate' ? 1 : 2
  const reasons = [`STOP-BANG score is in the ${band} band`]
  let raise = false
  if (signals.breathingNights && signals.elevatedNights / signals.breathingNights > APNEA.raiseShare) {
    raise = true
    reasons.push(`Apple's breathing disturbances were elevated on ${signals.elevatedNights} of ${signals.breathingNights} nights`)
  }
  if (signals.spo2Nights && signals.dipNights / signals.spo2Nights > APNEA.raiseShare) {
    raise = true
    reasons.push(`Blood oxygen dipped 3 points or more on ${signals.dipNights} of ${signals.spo2Nights} nights`)
  }
  return { level: LEVELS[Math.min(2, base + (raise ? 1 : 0))], raised: raise, reasons }
}

export interface NightSignal {
  date: string
  breathing: number | null
  elevated: boolean | null
  spo2: { readings: number; lowest: number | null; pctBelow90: number | null; dips: number } | null
  snoringMin: number | null
  lowConfidence: boolean
  awakenings: number | null
  morning: MorningCheck | null
}

/** The overnight signals panel over the last 30 nights. */
export function signals(nights: NightSignal[]) {
  const withB = nights.filter((n) => n.breathing != null)
  const withE = nights.filter((n) => n.elevated != null)
  const withS = nights.filter((n) => n.spo2 && n.spo2.readings > 0)
  const allReadings = withS.reduce((t, n) => t + (n.spo2?.readings || 0), 0)
  const below = withS.reduce((t, n) => t + ((n.spo2?.pctBelow90 || 0) / 100) * (n.spo2?.readings || 0), 0)
  const snore = nights.filter((n) => n.snoringMin != null && !n.lowConfidence)
  const aw = nights.filter((n) => n.awakenings != null)
  const m = nights.map((n) => n.morning).filter((x): x is MorningCheck => !!x)
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)
  return {
    breathing: withB.map((n) => ({ date: n.date, value: n.breathing as number })),
    breathingNights: withE.length,
    elevatedNights: withE.filter((n) => n.elevated).length,
    spo2Nights: withS.length,
    spo2Lowest: withS.length ? Math.min(...withS.map((n) => n.spo2!.lowest as number)) : null,
    spo2PctBelow90: allReadings ? Math.round((below / allReadings) * 1000) / 10 : null,
    dipNights: withS.filter((n) => (n.spo2?.dips || 0) > 0).length,
    snoringMinAvg: mean(snore.map((n) => n.snoringMin as number)),
    snoringNights: snore.length,
    awakeningsAvg: mean(aw.map((n) => n.awakenings as number)),
    headacheMornings: m.filter((x) => x.headache === true).length,
    dryMouthMornings: m.filter((x) => x.dryMouth === true).length,
    peeAvg: mean(m.filter((x) => x.pee != null).map((x) => x.pee as number)),
    mornings: m.length,
  }
}
