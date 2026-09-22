import { runwayFor, durationWords, sealedMg, sealedCount, openVialRemainingMg, cycleDutyFraction } from './stock'
import { anecdotalDose, doseWords, NO_DOSE_REASON } from './anecdotalDose'
import { referenceFor } from './reference'
import { frequencyFrom, cycleFrom } from './wizardDefaults'
import { dosesPerWeek, addDaysStr } from './schedule'
import { toMg } from './calc'
import { drawsPerWeek } from './drawdown'

/**
 * How long everything on the shelf lasts — including the things you are not
 * taking yet.
 *
 * A vial you own but have no protocol for has no burn rate, so the Stock room
 * used to leave it blank. But "how long would this last me" has an answer for
 * it too: the anecdotal dose the reference states for that compound, at the
 * frequency it states, discounted for any cycle it describes. That is an
 * estimate against somebody else's numbers rather than a measurement against
 * yours, so it is labelled as one and never quietly mixed in with the real
 * figures.
 *
 * The order is: your protocol if you have one, the anecdote if you do not, and
 * an honest blank if the anecdote has no figure either. Nothing is invented to
 * fill the third case — a compound the reference declines to dose is a compound
 * this app declines to dose.
 */

const FREQ_WORDS = {
  daily: 'daily', nightly: 'nightly', weekly: 'weekly',
  '2xweek': '2×/week', '3xweek': '3×/week', '5on2off': '5 on / 2 off',
}

/** The anecdotal burn rate for a compound nobody has built a protocol for. */
export function anecdotalWeeklyMg(compoundId, vials = []) {
  const a = anecdotalDose(compoundId)
  if (!a.dose) return { perWeekMg: 0, a }

  const ref = referenceFor(compoundId)
  // A seeded compound carries the app's own frequency and cycle; anything else
  // is read from the reference's own words about how often it is taken.
  const frequency = a.fromSeed ? a.frequency : frequencyFrom(ref)
  const cycle = a.fromSeed
    ? { cycleOnDays: a.cycleOnDays, cycleOffDays: a.cycleOffDays }
    : cycleFrom(ref)

  const perDoseMg = toMg(a.dose, a.unit)
  const raw = dosesPerWeek(frequency) * perDoseMg
  // Someone else drawing on the same vials shortens it here too.
  const shared = vials
    .filter((v) => v.peptideId === compoundId)
    .flatMap((v) => v.drawProfiles || [])
    .reduce((s, d) => s + (d.doseMg > 0 ? d.doseMg * drawsPerWeek(d) : 0), 0)

  return {
    perWeekMg: raw * cycleDutyFraction(cycle) + shared,
    perDoseMg,
    frequency,
    cycle,
    a,
  }
}

/**
 * One duration for one row of the Stock room, whatever is or isn't known about it.
 *
 * `basis` is the whole point of the return value: 'protocol' means this is
 * your burn rate, 'anecdotal' means it is the reference's, and 'none' means
 * there isn't one. A screen that showed all three the same way would be
 * claiming to know three different things equally well.
 */
export function stockRunway({
  peptideId, peptide, tState, openVial, vials = [], doseLogs = [], todayStr, leadDays = 30,
}) {
  const id = peptideId || peptide?.id
  const shelfMg = sealedMg(vials, id)
  const openMg = peptide ? openVialRemainingMg(peptide, openVial, doseLogs) : 0
  const totalMg = shelfMg + openMg
  const vialCount = sealedCount(vials, id)

  // Your own protocol, whenever there is one with a dose in it.
  const own = peptide ? runwayFor(peptide, tState, openVial, vials, doseLogs, todayStr, leadDays) : null
  if (own && own.perWeekMg > 0) {
    return {
      ...own,
      basis: 'protocol',
      words: durationWords(own.days),
      freqWords: FREQ_WORDS[peptide.frequency] || peptide.frequency,
      note: 'From your protocol',
    }
  }

  const est = anecdotalWeeklyMg(id, vials)
  if (!(est.perWeekMg > 0)) {
    return {
      basis: 'none',
      days: Infinity,
      words: null,
      totalMg: Math.round(totalMg * 100) / 100,
      vials: vialCount,
      out: totalMg <= 1e-9,
      low: false,
      reason: est.a.reason,
      note: NO_DOSE_REASON[est.a.reason] || NO_DOSE_REASON.unstated,
    }
  }

  const days = Math.floor((totalMg / est.perWeekMg) * 7)
  const runOutDate = todayStr ? addDaysStr(todayStr, days) : null

  return {
    basis: 'anecdotal',
    days,
    words: durationWords(days),
    runOutDate,
    // No restock-by date on an estimate: a date is a commitment, and this is a
    // guess at somebody else's dose.
    restockByDate: null,
    totalMg: Math.round(totalMg * 100) / 100,
    perWeekMg: Math.round(est.perWeekMg * 1000) / 1000,
    vials: vialCount,
    out: totalMg <= 1e-9,
    low: days <= leadDays,
    doseWords: doseWords(est.a),
    freqWords: FREQ_WORDS[est.frequency] || est.frequency,
    fromSeed: !!est.a.fromSeed,
    note: `At the reference dose, ${doseWords(est.a)} ${FREQ_WORDS[est.frequency] || est.frequency}`,
  }
}
