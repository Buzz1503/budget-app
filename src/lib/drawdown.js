import { dosesPerWeek } from './schedule'
import { toMg } from './calc'
import { currentRung } from './schedule'

/**
 * One vial, more than one person drawing from it.
 *
 * "How many doses are left" only has an answer when there is one dose size.
 * Share a vial with someone on a different dose and the question splits in two:
 * how many are left for each of them, and — the one that actually decides when
 * to reorder — how long the vial lasts with both of them drawing on it.
 *
 * Both are reported, and they are not reconciled into a single number, because
 * a single number would be wrong for at least one of the two people.
 */

export const FREQUENCIES = [
  { id: 'daily', label: 'Every day', perWeek: 7 },
  { id: '6xweek', label: '6×/week', perWeek: 6 },
  { id: '5xweek', label: '5×/week', perWeek: 5 },
  { id: '4xweek', label: '4×/week', perWeek: 4 },
  { id: '3xweek', label: '3×/week', perWeek: 3 },
  { id: '2xweek', label: '2×/week', perWeek: 2 },
  { id: 'weekly', label: 'Once a week', perWeek: 1 },
]

const PER_WEEK = Object.fromEntries(FREQUENCIES.map((f) => [f.id, f.perWeek]))

/** Draws a week, from a named frequency or an explicit custom number. */
export function drawsPerWeek(profile) {
  if (profile?.frequency === 'custom') {
    const n = Number(profile.perWeek)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return PER_WEEK[profile?.frequency] ?? dosesPerWeek(profile?.frequency) ?? 0
}

/**
 * The profile that stands for the owner when none have been set up.
 *
 * Defaulting to the stack's own dose and frequency is what keeps a vial nobody
 * shares behaving exactly as it did before profiles existed — one profile, one
 * dose size, the same doses-left it always showed.
 */
export function ownerProfile(peptide, tState) {
  if (!peptide?.ladder) return null
  const { dose } = currentRung(peptide, tState)
  return {
    id: 'owner',
    label: 'Me',
    doseMg: toMg(dose, peptide.ladder.unit),
    frequency: peptide.frequency,
    owner: true,
  }
}

/** Every profile drawing on a vial, the owner's included. */
export function profilesFor(vial, peptide, tState) {
  const owner = ownerProfile(peptide, tState)
  const extra = (vial?.drawProfiles || []).filter((p) => p && p.doseMg > 0)
  return [owner, ...extra].filter(Boolean)
}

/**
 * How the vial in front of you is being drawn down.
 *
 * `remainingMg` is the single number every profile eats into, because there is
 * one vial. Per-profile doses-left answers "how many more can I get out of
 * this", combined days answers "when do I reorder", and those are different
 * questions with different answers whenever the doses differ.
 */
export function drawdown(vial, peptide, tState, remainingMg) {
  const mg = Math.max(0, Number(remainingMg) || 0)
  const profiles = profilesFor(vial, peptide, tState)

  const rows = profiles.map((p) => {
    const perWeek = drawsPerWeek(p)
    return {
      ...p,
      perWeek,
      mgPerDay: p.doseMg > 0 && perWeek > 0 ? (p.doseMg * perWeek) / 7 : 0,
      // what is left for this person if nobody else touched it — the honest
      // answer to "how many more can I get", not a share of a split
      dosesLeft: p.doseMg > 0 ? Math.floor(mg / p.doseMg) : null,
    }
  })

  const combinedMgPerDay = rows.reduce((s, r) => s + r.mgPerDay, 0)
  const days = combinedMgPerDay > 0 ? Math.floor(mg / combinedMgPerDay) : Infinity

  return {
    remainingMg: Math.round(mg * 1e6) / 1e6,
    profiles: rows,
    shared: rows.length > 1,
    combinedMgPerDay: Math.round(combinedMgPerDay * 1e6) / 1e6,
    days,
    // the sum of what everyone draws in a week, for the restock maths
    combinedMgPerWeek: Math.round(combinedMgPerDay * 7 * 1e6) / 1e6,
  }
}

/** "~9 days", "~3 weeks", "empty" — the combined figure in words. */
export function emptiesInWords(d) {
  if (!d || d.remainingMg <= 1e-9) return 'empty'
  if (!isFinite(d.days)) return 'no draw set'
  if (d.days < 14) return `~${d.days} day${d.days === 1 ? '' : 's'}`
  if (d.days < 60) return `~${Math.round(d.days / 7)} weeks`
  return `~${Math.round(d.days / 30)} months`
}
