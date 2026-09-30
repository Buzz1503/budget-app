/**
 * When to ask, and never asking twice for the same thing.
 *
 * The schedule tightens where the information is and loosens where it is not:
 * dense in the first three days because that is when a reaction declares
 * itself, then thinning out because a mark still there on day nine will still
 * be there on day sixteen.
 *
 * The rule that matters most here is the one about lateness. A check-in done
 * at midnight for an 8 pm window is stored at midnight, and the score is worked
 * out from when it was actually done. A missed window produces no badge of its
 * own and never stacks — there is one badge saying something is due, or there
 * is nothing. Guilt is not a feature.
 */

export const DEFAULT_WINDOWS = { morning: '07:00', evening: '20:00' }
export const QUICK_CHECK_MINUTES = 30
const DENSE_HOURS = 72
const DAILY_UNTIL_DAY = 7

function at(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00`).toISOString()
}
function dayOf(iso) {
  return String(iso).slice(0, 10)
}
function plusDays(iso, n) {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toISOString()
}
function hours(aIso, bIso) {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / 3600000
}

/**
 * Every window this reaction is owed, up to `nowIso`.
 *
 * Generated rather than stored, so changing the window times moves the whole
 * schedule at once and an old reaction does not keep asking at 7 am after the
 * user has moved their morning to nine.
 */
export function dueWindows(reaction, { windows = DEFAULT_WINDOWS, nowIso } = {}) {
  if (!reaction?.injectedAt || !nowIso) return []
  const out = []
  const inj = reaction.injectedAt

  // the thirty-minute look
  const quick = new Date(new Date(inj).getTime() + QUICK_CHECK_MINUTES * 60000).toISOString()
  if (quick <= nowIso) out.push({ id: `${reaction.id}:quick`, kind: 'quick', dueAt: quick })

  // morning and evening for three days, then evening only to day seven, then weekly
  let cursor = inj
  for (let i = 0; i < 60; i++) {
    const day = dayOf(cursor)
    const since = hours(inj, `${day}T23:59:59.000Z`)
    const slots = since <= DENSE_HOURS ? ['morning', 'evening'] : ['evening']
    for (const slot of slots) {
      const dueAt = at(day, windows[slot] || DEFAULT_WINDOWS[slot])
      if (dueAt <= inj) continue
      if (dueAt > nowIso) continue
      const elapsedDays = Math.floor(hours(inj, dueAt) / 24)
      if (elapsedDays > DAILY_UNTIL_DAY && elapsedDays % 7 !== 0) continue
      out.push({ id: `${reaction.id}:${day}:${slot}`, kind: slot, dueAt })
    }
    cursor = plusDays(cursor, 1)
    if (cursor > nowIso) break
  }
  return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt))
}

/**
 * What is actually outstanding right now.
 *
 * One entry per reaction, never one per missed window — the whole point is that
 * somebody away for a weekend comes back to a single card per site, not six.
 * The window it reports is the oldest unanswered one, so the card can say how
 * long it has been waiting without pretending the others are separate jobs.
 */
export function outstanding(reaction, checkins = [], opts = {}) {
  if (!reaction || reaction.status === 'resolved') return null
  const mine = checkins.filter((c) => c.reactionId === reaction.id && c.completedAt)
  const answered = new Set(mine.map((c) => c.windowId).filter(Boolean))
  const windows = dueWindows(reaction, opts).filter((w) => !answered.has(w.id))
  if (!windows.length) return null
  // if anything was answered after the oldest outstanding window opened, that
  // window has effectively been covered — a late check-in answers the backlog
  const lastAnswer = mine.map((c) => c.completedAt).sort().at(-1)
  const live = lastAnswer ? windows.filter((w) => w.dueAt > lastAnswer) : windows
  if (!live.length) return null
  return { reactionId: reaction.id, window: live[0], missed: live.length - 1 }
}

/** Every reaction with something outstanding, oldest first. */
export function checkinsDue({ reactions = [], checkins = [], windows, nowIso } = {}) {
  return reactions
    .map((rx) => {
      const o = outstanding(rx, checkins, { windows, nowIso })
      return o ? { ...o, reaction: rx } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.window.dueAt.localeCompare(b.window.dueAt))
}

/**
 * Two clear looks in a row close it.
 *
 * One is not enough: a reaction that has faded by morning and is back by
 * evening was never gone, and closing on the first clear check would keep
 * reopening it. Two consecutive is the cheapest rule that does not do that.
 */
export function shouldResolve(checkins = []) {
  const done = checkins
    .filter((c) => c.completedAt)
    .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)))
  if (done.length < 2) return false
  return !done.at(-1).present && !done.at(-2).present
}

/** "18 hours since the shot" — what a swipe card says under the site name. */
export function sinceWords(injectedAt, nowIso) {
  const h = hours(injectedAt, nowIso)
  if (!isFinite(h)) return ''
  if (h < 1) return 'just now'
  if (h < 48) return `${Math.round(h)} h since the shot`
  return `day ${Math.floor(h / 24)}`
}

/**
 * How much bigger it got since last time, as a percentage of traced area.
 *
 * Computed rather than asked, because nobody can eyeball "20% larger" and an
 * answer nobody can give accurately is worse than no answer.
 */
export function spreadPct(areaMm2, prevAreaMm2) {
  if (!(areaMm2 > 0) || !(prevAreaMm2 > 0)) return null
  return Math.round(((areaMm2 - prevAreaMm2) / prevAreaMm2) * 100)
}

export function spreadWords(pct) {
  if (pct == null) return null
  if (pct > 10) return `${pct}% larger than last time`
  if (pct < -10) return `${Math.abs(pct)}% smaller than last time`
  return 'about the same as last time'
}
