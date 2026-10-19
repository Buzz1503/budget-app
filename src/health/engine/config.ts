// Every number the Health engines use, in one place.
//
// Changing a threshold here changes it everywhere it is used, and nowhere else
// hides its own copy. The values follow the stage 2 brief; the few calls made
// where the brief left room are noted beside them.

export const BASELINE = {
  windowDays: 28,          // trailing window, today excluded
  minDays: 14,             // valid days needed before a baseline is used
  postEventMinDays: 10,    // after a protocol event: post-event-only data once this many days exist
  madScale: 1.4826,        // MAD -> SD for normally distributed data
  zClip: 3,
  floors: {                // sigma never smaller than this
    hrv: 0.05,             // ln(ms)
    rhr: 1.5,              // bpm
    sleep: 0.4,            // hours asleep
    resp: 0.4,             // breaths/min
    temp: 0.15,            // °C
  },
} as const

export const READINESS = {
  weights: { hrv: 0.40, rhr: 0.25, sleep: 0.25, resp: 0.05, temp: 0.05 },
  center: 60,
  scale: 22,
  bands: [
    { id: 'low', label: 'Low', max: 33 },
    { id: 'moderate', label: 'Moderate', max: 66 },
    { id: 'high', label: 'High', max: 100 },
  ],
} as const

export const SLEEP = {
  defaultNeedH: 8,
  weights: { duration: 0.55, consistency: 0.20, restorative: 0.15, efficiency: 0.10 },
  consistencyNights: 7,
  consistencyMinNights: 3,  // call: fewer nights than this and consistency is left out
  consistencyZeroSdMin: 90, // SD at which consistency scores 0
  restorativeTarget: 0.40,  // deep + REM share of time asleep
  efficiencyFull: 0.90,
  efficiencyZero: 0.70,
  debtNights: 7,
} as const

export const TRAINING = {
  zoneFloors: [0.5, 0.6, 0.7, 0.8, 0.9], // fraction of max HR where zones 1–5 begin
  zoneWeights: [1, 2, 3, 4, 5],           // Edwards TRIMP
  maxSampleGapSec: 120,                   // a longer gap between HR samples is not counted as time in a zone
  acuteDays: 7,
  chronicDays: 28,
  lowerBelow: 0.8,
  higherAbove: 1.3,
  dedupeOverlap: 0.5,                     // share of the shorter session
  maxHRFallback: 190,
  hrrWeeks: 12,
} as const

export const PROTOCOL = {
  glp1NoteDays: 14,
} as const

export const COMPARE = {
  minPerGroup: 7,
  windowDays: 14,
  minPerSide: 7,
  caveat: 'Other compounds taken on these days are not separated out.',
} as const

export const PLANNER = {
  debtDivisor: 4,
  debtCapMin: 60,
  highLoadBumpMin: 15,
  efficiencyMin: 0.85,
  efficiencyMax: 0.95,
  efficiencyDefault: 0.90,
  lookbackNights: 14,
} as const

export const BODY = {
  maDays: 7,
  weeklyChangeWeeks: 4,
} as const

export const PHASES = {
  mergeDays: 7,            // changes this close together are one boundary (and one chart pin)
  bodyMinDays: 14,         // a body trend needs this long a phase
  bodyMinReadings: 4,      // and this many readings in it
  dailyMinDays: 10,        // a daily average needs this many days with data
  steadyPerWeek: 0.05,     // slower than this (per week) reads as "steady"
  clearX: 2,               // change of at least 2 × normal wobble: clear
  possibleX: 1,            // at least 1 × wobble: possible
  wobbleDays: 90,          // wobble is measured over the last 90 days
  wobbleMinPoints: 10,
  wobbleMaDays: 7,         // around each value's trailing 7-day average
  // when there are fewer than 10 points. Readiness and waist were not in the
  // brief's list; 8 points and 1 cm are calls made here.
  wobbleFallback: {
    weight: 0.6, fatMass: 0.6, leanMass: 0.8, bodyFat: 0.8, waist: 1, visceralFatLevel: 1,
    rhr: 2, hrv: 6, sleep: 0.5, deepSleep: 15, sleepScore: 8, readiness: 8,
  },
  combinedNote: 'These changes started together. This shows their combined effect and cannot be split by compound.',
  overlapDays: 14,         // another compound changing within this many days of a start shares its effects
  cleanWindowDays: 14,     // a dose change with nothing else within 14 days either side: 14 days before vs after
  beforeMaxDays: 90,       // "since starting": the period before is as long as the period on, at most 90 days
  beforeMinDays: 28,       // and at least 28
} as const

// Compounds whose effects are tracked by default, besides those flagged as
// affecting the recovery baseline (GLP-1 class, testosterone esters).
export const TRACK_DEFAULT = /(tesamorelin|\bhgh\b|somatropin|growth hormone|cjc[\s-]?1295|\bcjc\b|ipamorelin|aod[\s-]?9604|\baod\b|mots[\s-]?c|cagrilintide|\bcagri)/i
