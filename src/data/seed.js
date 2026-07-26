// Seed data — editable anecdotal starting points, not medical advice.
import { format } from 'date-fns'

const wk = (n) => n * 7

// frequency: daily | nightly | weekly | 3xweek | 5on2off
export function seedPeptides(todayStr) {
  const start = todayStr || format(new Date(), 'yyyy-MM-dd')
  const p = (o) => ({ route: 'SubQ', startDate: start, ...o })
  return [
    p({ id: 'retatrutide', name: 'Retatrutide', frequency: 'weekly', timing: 'Consistent day each week',
      cycleOnDays: 0, cycleOffDays: 0,
      ladder: { floor: 0.5, step: 0.5, intervalWeeks: 4, ceiling: 2, unit: 'mg' },
      recon: { vialMg: 20, bacMl: 4, expiryDays: 28 } }),
    p({ id: 'selank', name: 'Selank', frequency: 'daily', timing: 'Flexible',
      cycleOnDays: wk(8), cycleOffDays: wk(8),
      ladder: { floor: 250, step: 50, intervalWeeks: 1, ceiling: 500, unit: 'mcg' },
      recon: { vialMg: 10, bacMl: 2, expiryDays: 28 } }),
    p({ id: 'semax', name: 'Semax', frequency: 'daily', timing: 'Morning',
      cycleOnDays: wk(6), cycleOffDays: wk(2),
      ladder: { floor: 300, step: 150, intervalWeeks: 1, ceiling: 1000, unit: 'mcg' },
      recon: { vialMg: 10, bacMl: 2, expiryDays: 28 } }),
    p({ id: 'kpv', name: 'KPV', frequency: '5on2off', timing: 'AM, empty stomach',
      cycleOnDays: wk(8), cycleOffDays: wk(2),
      ladder: { floor: 100, step: 100, intervalWeeks: 1, ceiling: 500, unit: 'mcg' },
      recon: { vialMg: 10, bacMl: 2, expiryDays: 30 } }),
    p({ id: 'ss31', name: 'SS-31', frequency: 'daily', timing: 'Morning',
      cycleOnDays: wk(4), cycleOffDays: wk(4),
      ladder: { floor: 2.5, step: 2.5, intervalWeeks: 2, ceiling: 10, unit: 'mg' },
      recon: { vialMg: 50, bacMl: 5, expiryDays: 14 } }),
    p({ id: 'dsip', name: 'DSIP', frequency: 'nightly', timing: '30–60 min pre-bed',
      cycleOnDays: wk(4), cycleOffDays: wk(2),
      ladder: { floor: 100, step: 100, intervalWeeks: 1, ceiling: 300, unit: 'mcg' },
      recon: { vialMg: 5, bacMl: 2, expiryDays: 21 } }),
    p({ id: 'motsc', name: 'MOTS-c', frequency: 'daily', timing: 'AM / pre-cardio',
      cycleOnDays: wk(8), cycleOffDays: wk(4),
      ladder: { floor: 1, step: 0.2, intervalWeeks: 1, ceiling: 1.4, unit: 'mg' },
      recon: { vialMg: 40, bacMl: 2, expiryDays: 14 } }),
    p({ id: 'bpc157', name: 'BPC-157', frequency: 'daily', timing: 'Flexible',
      cycleOnDays: wk(6), cycleOffDays: wk(2),
      ladder: { floor: 250, step: 250, intervalWeeks: 2, ceiling: 500, unit: 'mcg' },
      recon: { vialMg: 5, bacMl: 2, expiryDays: 28 } }),
    p({ id: 'ghkcu', name: 'GHK-Cu', frequency: 'daily', timing: 'Before bed',
      cycleOnDays: 30, cycleOffDays: 30,
      ladder: { floor: 1, step: 1, intervalWeeks: 2, ceiling: 2, unit: 'mg' },
      recon: { vialMg: 50, bacMl: 2, expiryDays: 28 } }),
    p({ id: 'nad', name: 'NAD+', frequency: '3xweek', timing: 'Morning',
      cycleOnDays: 0, cycleOffDays: 0,
      ladder: { floor: 20, step: 25, intervalWeeks: 1, ceiling: 100, unit: 'mg' },
      recon: { vialMg: 500, bacMl: 5, expiryDays: 14 } }),
    p({ id: 'tesamorelin', name: 'Tesamorelin', frequency: 'daily', timing: 'Fasted AM or bedtime',
      cycleOnDays: wk(8), cycleOffDays: wk(4),
      ladder: { floor: 1, step: 1, intervalWeeks: 2, ceiling: 2, unit: 'mg' },
      recon: { vialMg: 10, bacMl: 2, expiryDays: 7 } }),
  ]
}

// Placeholder AUD costs — edit to your real prices.
const SEED_COSTS = {
  retatrutide: 180, selank: 55, semax: 60, kpv: 50, ss31: 150, dsip: 40,
  motsc: 120, bpc157: 45, ghkcu: 60, nad: 90, tesamorelin: 95,
}

export function seedVials(peptides) {
  return peptides.map((p) => ({
    id: `vial-${p.id}`,
    peptideId: p.id,
    vialMg: p.recon.vialMg,
    costAud: SEED_COSTS[p.id] ?? 0,
    vendor: '',
    lot: '',
    qtyPurchased: 2,
    qtyOnHand: 2,
  }))
}

export function seedTitration(peptides, todayStr) {
  const t = {}
  for (const p of peptides) t[p.id] = { level: 0, levelStartDate: todayStr || p.startDate }
  return t
}

// One open vial per peptide, not yet reconstituted (expiry timer starts on reconstitution).
export function seedOpenVials(peptides) {
  const o = {}
  for (const p of peptides) o[p.id] = { remainingMg: p.recon.vialMg, reconstitutedAt: null }
  return o
}

export const SEED_NEEDLE_NOTES = [
  { id: 'syringe', title: 'Syringe & needle', body: 'U-100 insulin syringe (1 unit = 0.01 mL). 29–31 gauge, 4–8 mm length for SubQ. Use a larger draw needle for pulling BAC water if you have one, then switch to a fresh fine needle to inject.' },
  { id: 'sites', title: 'Injection sites', body: 'Abdomen (5 cm away from the navel), front/outer thigh, or back of upper arm. Pinch the skin, insert at 45–90°, inject slowly.' },
  { id: 'rotation', title: 'Rotate sites', body: 'Rotate between sites and within a site — never inject the same spot twice in a row. Keep any single site under ~1.5 mL.' },
  { id: 'hygiene', title: 'Hygiene', body: 'Swab vial tops and skin with an alcohol wipe. One needle, one use — never reuse or share. Sharps go in a proper container.' },
]
