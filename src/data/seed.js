// Seed data — editable anecdotal starting points, not medical advice.
import { format } from 'date-fns'
import { referenceUsdPerVial } from '../lib/cost'

const wk = (n) => n * 7

// Default reconstitution volume. 2 mL on everything is the point: one habit,
// one number to remember, and the concentration falls out of the vial size.
// Every peptide's BAC water stays editable per-compound.
export const DEFAULT_BAC_ML = 2


// What each seeded peptide's BAC volume used to be. A stored value matching
// this was never edited by the user, so it can safely move to the new default;
// anything else is a deliberate choice and is left exactly as it is.
export const LEGACY_BAC_ML = {
  retatrutide: 4, selank: 2, semax: 2, kpv: 2, ss31: 5, dsip: 2,
  motsc: 2, bpc157: 2, ghkcu: 2, nad: 5, tesamorelin: 2,
}

// frequency: daily | nightly | weekly | 2xweek | 3xweek | 5on2off
// intranasalCapable: can be switched to a nasal spray (same prep and strength)
export function seedPeptides(todayStr) {
  const start = todayStr || format(new Date(), 'yyyy-MM-dd')
  // startDate anchors the schedule; startedOn is tenure. They are the same day
  // for a protocol built today, and the second one is the one the user can move
  // backwards when they were already on something before installing this.
  const p = (o) => ({ route: 'SubQ', startDate: start, startedOn: start, ...o })
  return [
    p({ id: 'retatrutide', name: 'Retatrutide', frequency: 'weekly', timing: 'Consistent day each week', slot: 'AM',
      cycleOnDays: 0, cycleOffDays: 0,
      ladder: { floor: 0.5, step: 0.5, intervalWeeks: 4, ceiling: 2, unit: 'mg' },
      recon: { vialMg: 20, bacMl: DEFAULT_BAC_ML, expiryDays: 28 } }),
    p({ id: 'selank', name: 'Selank', intranasalCapable: true, frequency: 'daily', timing: 'Flexible',
      cycleOnDays: wk(8), cycleOffDays: wk(8),
      ladder: { floor: 250, step: 50, intervalWeeks: 1, ceiling: 500, unit: 'mcg' },
      recon: { vialMg: 10, bacMl: DEFAULT_BAC_ML, expiryDays: 28 } }),
    p({ id: 'semax', name: 'Semax', intranasalCapable: true, frequency: 'daily', timing: 'Morning',
      cycleOnDays: wk(6), cycleOffDays: wk(2),
      ladder: { floor: 300, step: 150, intervalWeeks: 1, ceiling: 1000, unit: 'mcg' },
      recon: { vialMg: 10, bacMl: DEFAULT_BAC_ML, expiryDays: 28 } }),
    p({ id: 'kpv', name: 'KPV', frequency: '5on2off', timing: 'AM, empty stomach',
      cycleOnDays: wk(8), cycleOffDays: wk(2),
      ladder: { floor: 100, step: 100, intervalWeeks: 1, ceiling: 500, unit: 'mcg' },
      recon: { vialMg: 10, bacMl: DEFAULT_BAC_ML, expiryDays: 30 } }),
    p({ id: 'ss31', name: 'SS-31', frequency: 'daily', timing: 'Morning',
      cycleOnDays: wk(4), cycleOffDays: wk(4),
      ladder: { floor: 2.5, step: 2.5, intervalWeeks: 2, ceiling: 10, unit: 'mg' },
      recon: { vialMg: 50, bacMl: DEFAULT_BAC_ML, expiryDays: 14 } }),
    p({ id: 'dsip', name: 'DSIP', frequency: 'nightly', timing: '30–60 min pre-bed',
      cycleOnDays: wk(4), cycleOffDays: wk(2),
      ladder: { floor: 100, step: 100, intervalWeeks: 1, ceiling: 300, unit: 'mcg' },
      recon: { vialMg: 5, bacMl: DEFAULT_BAC_ML, expiryDays: 21 } }),
    p({ id: 'motsc', name: 'MOTS-c', frequency: 'daily', timing: 'AM / pre-cardio',
      cycleOnDays: wk(8), cycleOffDays: wk(4),
      ladder: { floor: 1, step: 0.2, intervalWeeks: 1, ceiling: 1.4, unit: 'mg' },
      recon: { vialMg: 40, bacMl: DEFAULT_BAC_ML, expiryDays: 14 } }),
    p({ id: 'bpc157', name: 'BPC-157', frequency: 'daily', timing: 'Flexible',
      cycleOnDays: wk(6), cycleOffDays: wk(2),
      ladder: { floor: 250, step: 250, intervalWeeks: 2, ceiling: 500, unit: 'mcg' },
      recon: { vialMg: 5, bacMl: DEFAULT_BAC_ML, expiryDays: 28 } }),
    p({ id: 'ghkcu', name: 'GHK-Cu', frequency: 'daily', timing: 'Before bed',
      cycleOnDays: 30, cycleOffDays: 30,
      ladder: { floor: 1, step: 1, intervalWeeks: 2, ceiling: 2, unit: 'mg' },
      recon: { vialMg: 50, bacMl: DEFAULT_BAC_ML, expiryDays: 28 } }),
    p({ id: 'nad', name: 'NAD+', frequency: '3xweek', timing: 'Morning',
      cycleOnDays: 0, cycleOffDays: 0,
      ladder: { floor: 20, step: 25, intervalWeeks: 1, ceiling: 100, unit: 'mg' },
      recon: { vialMg: 500, bacMl: DEFAULT_BAC_ML, expiryDays: 14 } }),
    p({ id: 'tesamorelin', name: 'Tesamorelin', frequency: 'daily', timing: 'Fasted AM or bedtime', slot: 'AM',
      cycleOnDays: wk(8), cycleOffDays: wk(4),
      ladder: { floor: 1, step: 1, intervalWeeks: 2, ceiling: 2, unit: 'mg' },
      recon: { vialMg: 10, bacMl: DEFAULT_BAC_ML, expiryDays: 7 } }),
    testosteroneEnanthate(start),
  ]
}

// Oil-based injectable — not a peptide, and handled differently on purpose:
// pre-mixed (no powder + BAC water), fixed dose (floor === ceiling, so the
// ladder engine has a single rung and never prompts a step-up), ongoing rather
// than cycled, injected SubQ into thigh fat, and never co-drawn with a peptide.
// `recon` carries the vial's label: 2500 mg in 10 mL === 250 mg/mL.
export const TEST_E_ID = 'testosterone-e'

export function testosteroneEnanthate(startDate) {
  return {
    id: TEST_E_ID,
    name: 'Testosterone Enanthate',
    startDate,
    startedOn: startDate,
    frequency: '2xweek',
    scheduleWeekdays: [1, 4], // Mon / Thu — editable
    slot: 'AM',
    timing: 'Mon & Thu',
    // SubQ into thigh fat rather than IM: a small oil volume goes in fine
    // subcutaneously, and it keeps a reaction-prone compound off the belly.
    route: 'SubQ',
   
    vehicle: 'oil',
    preparation: 'premixed',
    alwaysSeparate: true,
    separateReason: 'Oil-based and not in the peptide compatibility matrix — different vehicle and route, so it is always its own shot.',
    cycleOnDays: 0,
    cycleOffDays: 0, // ongoing
    ladder: { floor: 50, step: 0, intervalWeeks: 1, ceiling: 50, unit: 'mg' },
    // 10 mL vial at 250 mg/mL; expiryDays 0 = no reconstitution timer to run
    // NOT reconstituted — this is a 10 mL pre-mixed oil vial at 250 mg/mL, so
    // the 2 mL default does not apply to it.
    recon: { vialMg: 2500, bacMl: 10, expiryDays: 0 },
  }
}

// Placeholder AUD costs — edit to your real prices.
// Seeded vials take their price from the reference table rather than from a
// list of made-up AUD figures. A compound the table does not cover starts
// unpriced, which is the truth about it, and the Stock room asks.
export function seedVials(peptides) {
  return peptides.map((p) => ({
    id: `vial-${p.id}`,
    peptideId: p.id,
    name: p.name,
    vialMg: p.recon.vialMg,
    usdPerVial: referenceUsdPerVial(p),
    vendor: '',
    lot: '',
    drawProfiles: [],
    qtyPurchased: 2,
    qtyOnHand: 2,
    sealedExpiry: '',
    coaKey: null,
    coaMeta: null,
  }))
}

export function seedTitration(peptides, todayStr) {
  const t = {}
  for (const p of peptides) t[p.id] = { level: 0, levelStartDate: todayStr || p.startDate }
  return t
}

/**
 * One open run per peptide, from the day the protocol starts.
 *
 * Runs are never deleted — taking a compound off the protocol closes its run,
 * and adding it back opens a second one, so "I ran this for four months last
 * year" survives the list it was on.
 */
export function seedRuns(peptides, todayStr) {
  const r = {}
  for (const p of peptides) {
    r[p.id] = [{ id: `run-${p.id}`, startedOn: p.startedOn || todayStr || p.startDate, endedOn: null }]
  }
  return r
}

/**
 * The first point on each compound's dose line.
 *
 * Without it the timeline has a start date and no dose to draw at it, which
 * reads as "nothing recorded" for a protocol that plainly has a dose. Every
 * later point — step-up, hold, hand-set dose — is appended as it happens.
 */
export function seedDoseEvents(peptides, todayStr) {
  return peptides.map((p) => ({
    id: `de-seed-${p.id}`,
    peptideId: p.id,
    kind: 'start',
    date: p.startedOn || todayStr || p.startDate,
    at: null,
    to: p.ladder?.floor ?? null,
    unit: p.ladder?.unit ?? null,
  }))
}

// One open vial per peptide, not yet reconstituted (expiry timer starts on reconstitution).
export function seedOpenVials(peptides) {
  const o = {}
  // `activatedAt` is null until a vial is actually put into use — the "doses
  // left" count reads from it, and a vial nobody has opened has drawn nothing.
  for (const p of peptides) {
    o[p.id] = {
      remainingMg: p.recon.vialMg, vialMg: p.recon.vialMg,
      batchId: null, reconstitutedAt: null, activatedAt: null,
    }
  }
  return o
}

