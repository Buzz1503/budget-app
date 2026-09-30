import { addDaysStr, daysBetween } from './schedule'

/**
 * Turning a reaction into one number, and being clear about what the number is.
 *
 * The Reaction Score is not a severity grade and it is not a diagnosis. It is a
 * way of comparing one injection against another on a single axis, so that
 * "MOTS-c reacts worse than GHK-Cu" can be a measurement rather than an
 * impression. Every part of it is arithmetic on something that was actually
 * recorded, and tapping the score shows the working, because a number nobody
 * can check is a number nobody should trust.
 */

// ------------------------------------------------------------------- score

/** Redness band, in millimetres of the widest measurement. */
export function rednessPoints(mm) {
  if (!(mm > 0)) return 0
  if (mm <= 10) return 1
  if (mm <= 25) return 2
  if (mm <= 50) return 3
  return 4
}

/** Itch contributes up to two points, proportionally. */
export function itchPoints(itch) {
  if (!(itch > 0)) return 0
  return Math.min(2, (itch / 10) * 2)
}

/** How long it went on for, in whole days. */
export function durationPoints(hours) {
  if (hours == null || !isFinite(hours)) return 0
  if (hours < 24) return 0
  if (hours <= 72) return 1
  return 2
}

export const RS_POSITIVE = 2

/**
 * The worst it got in the first 72 hours, plus how long it lasted.
 *
 * The worst check-in rather than the latest, because a reaction that peaked at
 * 40 mm and had faded by the time anyone looked again was still a 40 mm
 * reaction. Seventy-two hours because that is the window in which a delayed
 * reaction has either shown itself or has not.
 */
export function worstCheckin(checkins = [], injectedAt) {
  const within = checkins.filter((c) => {
    if (!c.completedAt) return false
    if (!injectedAt) return true
    return hoursBetween(injectedAt, c.completedAt) <= 72
  })
  const pool = within.length ? within : checkins.filter((c) => c.completedAt)
  if (!pool.length) return null
  return pool.reduce((worst, c) => (severity(c) > severity(worst) ? c : worst))
}

/** A rough ordering used only to pick the worst check-in, never shown. */
function severity(c) {
  if (!c) return -1
  return (c.diameterMm || 0) + (c.itch || 0) * 3 + (c.welt ? 12 : 0) + (c.lump ? 12 : 0)
}

export function hoursBetween(aIso, bIso) {
  if (!aIso || !bIso) return null
  const a = new Date(aIso).getTime()
  const b = new Date(bIso).getTime()
  if (!isFinite(a) || !isFinite(b)) return null
  return (b - a) / 3600000
}

/**
 * The score, and the working behind it.
 *
 * Returns the parts as well as the total so the breakdown sheet reads off the
 * same arithmetic the number came from, rather than recomputing it and
 * eventually disagreeing.
 */
export function reactionScore(reaction, checkins = []) {
  const mine = checkins
    .filter((c) => c.reactionId === reaction?.id && c.completedAt)
    .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)))
  const worst = worstCheckin(mine, reaction?.injectedAt)

  const anyPresent = mine.some((c) => c.present)
  const firstAt = mine.find((c) => c.present)?.completedAt || null
  const lastPresent = [...mine].reverse().find((c) => c.present)?.completedAt || null
  const endAt = reaction?.resolvedAt || lastPresent
  const hours = firstAt && endAt ? hoursBetween(firstAt, endAt) : (anyPresent ? 0 : null)

  const parts = {
    redness: { points: rednessPoints(worst?.diameterMm), detail: worst?.diameterMm ? `${Math.round(worst.diameterMm)} mm across` : 'no redness recorded' },
    itch: { points: itchPoints(worst?.itch), detail: worst?.itch ? `itch ${worst.itch} of 10` : 'no itch' },
    welt: { points: worst?.welt ? 1 : 0, detail: worst?.welt ? 'raised welt' : 'no welt' },
    lump: { points: worst?.lump ? 1 : 0, detail: worst?.lump ? 'hard lump under the skin' : 'no lump' },
    duration: { points: durationPoints(hours), detail: hours == null ? 'never present' : hours < 24 ? 'gone within a day' : hours <= 72 ? 'one to three days' : 'more than three days' },
  }
  const raw = Object.values(parts).reduce((n, p) => n + p.points, 0)
  const score = Math.min(10, Math.round(raw * 10) / 10)

  return {
    score,
    positive: score >= RS_POSITIVE,
    parts,
    worstCheckinId: worst?.id || null,
    durationHours: hours,
    checkinCount: mine.length,
  }
}

// ------------------------------------------------------------ onset labels

export const ONSET = {
  fast: {
    id: 'fast',
    label: 'Fast',
    words: "Usually direct skin irritation from the compound's concentration, not a true allergy",
  },
  delayed: {
    id: 'delayed',
    label: 'Delayed',
    words: 'Can point to a genuine sensitivity to the compound, the preservative, or an impurity',
  },
  persistent: {
    id: 'persistent',
    label: 'Persistent',
    words: 'Worth showing a GP if it keeps happening',
  },
}

/**
 * What shape the reaction had, said without claiming to know why.
 *
 * These are descriptions of timing, not verdicts. The wording on each one says
 * what that timing *can* mean and stops there — the app is not qualified to go
 * further and a label that sounded like a diagnosis would be read as one.
 */
export function onsetLabel(reaction, checkins = []) {
  const mine = checkins
    .filter((c) => c.reactionId === reaction?.id && c.completedAt && c.present)
    .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)))
  if (!mine.length) return null

  const first = mine[0]
  const onsetH = hoursBetween(reaction.injectedAt, first.completedAt)
  const endAt = reaction.resolvedAt || mine.at(-1).completedAt
  const totalH = hoursBetween(reaction.injectedAt, endAt)
  const hadLump = mine.some((c) => c.lump)

  if (hadLump || (totalH != null && totalH >= 24 * 7)) return ONSET.persistent
  if (onsetH != null && onsetH <= 1 && totalH != null && totalH <= 24) return ONSET.fast
  const worst = worstCheckin(mine, reaction.injectedAt)
  const peakH = worst ? hoursBetween(reaction.injectedAt, worst.completedAt) : null
  if ((onsetH != null && onsetH >= 24) || (peakH != null && peakH >= 24 && peakH <= 72)) return ONSET.delayed
  return null
}

/**
 * Is this compound's reaction getting worse each time?
 *
 * Three successive injections with a rising score. Three rather than two
 * because two is a coincidence, and successive rather than "on average"
 * because an average hides the direction, which is the only thing being asked.
 */
export function escalating(scores = []) {
  if (scores.length < 3) return false
  const last3 = scores.slice(-3)
  return last3[0] < last3[1] && last3[1] < last3[2]
}

export function escalationFor(compoundId, { records = [], reactions = [], checkins = [] } = {}) {
  const mine = records
    .filter((r) => (r.compoundIds || []).includes(compoundId))
    .sort((a, b) => String(a.injectedAt).localeCompare(String(b.injectedAt)))
  const scores = mine.map((r) => {
    const rx = reactions.find((x) => x.injectionRecordId === r.id)
    return rx ? reactionScore(rx, checkins).score : 0
  })
  return { escalating: escalating(scores), scores }
}

// ---------------------------------------------------------------- safety

/**
 * When to stop investigating and see somebody.
 *
 * Deliberately blunt, always on, and impossible to switch off. Everything else
 * in this feature is a measurement; this is the one part with an opinion, and
 * it errs towards sending people to a doctor because the cost of a wasted
 * appointment is very much lower than the cost of the alternative.
 */
export const EMERGENCY_FLAGS = ['faceSwelling', 'throatSwelling', 'breathing']
export const URGENT_FLAGS = ['redStreaks', 'pus', 'fever', 'elsewhere']

export function safetyCheck(checkin, prev = null) {
  if (!checkin) return null
  const emergency = EMERGENCY_FLAGS.filter((f) => checkin[f])
  if (emergency.length) {
    return {
      level: 'emergency',
      title: 'Call 000 now',
      reasons: emergency.map((f) => EMERGENCY_WORDS[f]),
    }
  }
  const reasons = []
  for (const f of URGENT_FLAGS) if (checkin[f]) reasons.push(URGENT_WORDS[f])
  if ((checkin.pain || 0) >= 7) reasons.push('pain 7 or more out of 10')
  const growing = prev && checkin.tracedAreaMm2 != null && prev.tracedAreaMm2 != null
    && checkin.tracedAreaMm2 > prev.tracedAreaMm2
  if (growing && checkin.warm) reasons.push('the area is growing and warm to touch')
  if (growing && (checkin.diameterMm || 0) > 50) reasons.push('redness over 50 mm and still spreading')
  if (!reasons.length) return null
  return { level: 'urgent', title: 'See a doctor today', reasons }
}

const EMERGENCY_WORDS = {
  faceSwelling: 'swelling of the lips or face',
  throatSwelling: 'swelling of the throat',
  breathing: 'trouble breathing',
}
const URGENT_WORDS = {
  redStreaks: 'red streaks spreading from the site',
  pus: 'pus',
  fever: 'fever',
  elsewhere: 'symptoms away from the injection site',
}

/** The worst thing standing right now, across every open reaction. */
export function activeSafety({ reactions = [], checkins = [] } = {}) {
  let worst = null
  for (const rx of reactions.filter((r) => r.status !== 'resolved')) {
    const mine = checkins
      .filter((c) => c.reactionId === rx.id && c.completedAt)
      .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)))
    for (let i = 0; i < mine.length; i++) {
      const hit = safetyCheck(mine[i], mine[i - 1])
      if (!hit) continue
      if (!worst || (hit.level === 'emergency' && worst.level !== 'emergency')) {
        worst = { ...hit, reactionId: rx.id, checkinId: mine[i].id }
      }
    }
  }
  return worst
}

// ------------------------------------------------------------------ words

export function rsWords(score) {
  if (score == null) return 'not scored'
  if (score === 0) return 'no reaction'
  if (score < 2) return 'trace'
  if (score < 4) return 'mild'
  if (score < 7) return 'moderate'
  return 'marked'
}

/** "3 days" / "18 hours" — a duration a line has room for. */
export function durationWords(hours) {
  if (hours == null || !isFinite(hours)) return null
  if (hours < 1) return 'under an hour'
  if (hours < 48) return `${Math.round(hours)} hours`
  return `${Math.round(hours / 24)} days`
}

export { addDaysStr, daysBetween }
