// One-line, no-jargon explanations for the terms this app throws at you.
// Every entry has to be readable by someone who has never injected anything.
export const GLOSSARY = {
  subq: {
    term: 'SubQ',
    plain: 'Subcutaneous — into the fat just under the skin, not into muscle. A short, very fine needle; barely felt.',
  },
  im: {
    term: 'IM',
    plain: 'Intramuscular — into the muscle itself. Needs a longer needle than a SubQ shot.',
  },
  codraw: {
    term: 'co-draw',
    plain: 'Drawing two or more compounds into one syringe so you take one injection instead of several.',
  },
  titration: {
    term: 'titration',
    plain: 'Starting low and stepping the dose up over weeks, so you find out how you tolerate it before going higher.',
  },
  units: {
    term: 'units',
    plain: 'The marks on an insulin syringe. 100 units = 1 mL, so 20 units is 0.2 mL — draw to that line.',
  },
  reconstitute: {
    term: 'reconstitute',
    plain: 'Adding bacteriostatic water to a vial of powder to turn it into a liquid you can draw.',
  },
  rotation: {
    term: 'rotation',
    plain: 'Using a different spot each time so no single patch of skin gets lumpy or scarred.',
  },
  cycle: {
    term: 'cycle',
    plain: 'A stretch of days on the compound followed by a stretch off it, then repeat.',
  },
  premixed: {
    term: 'pre-mixed',
    plain: 'The vial already contains liquid at a stated strength (mg per mL) — nothing to mix.',
  },
}

export function glossaryFor(key) {
  return GLOSSARY[key] || null
}
