// Living injection-site rotation: heat, wear, reactions, a planned path, and a
// health score.
//
// The site map used to answer one question — "which spot is furthest from my
// recent shots". That's the right answer for today and the wrong answer over
// months: a site can look rested on recency while quietly carrying more
// cumulative punctures than anywhere else, which is exactly how lipohypertrophy
// starts. So three separate clocks run here:
//
//   heat      — hours-to-days. Just used → cools back to fresh over its rest days.
//   wear      — weeks-to-months. How much total traffic this site has taken.
//   reactions — until cleared. A lump or soreness parks a site regardless of both.
//
// Everything is a pure function of the dose log + the reaction log, so the map
// is correct the moment it opens with nothing to keep in sync.
import { daysBetween, addDaysStr } from './schedule'
import { sitesForRoute, SITE_BY_ID, ALL_SITES } from './sites'

// Days for a site to go from just-used back to fully fresh. Muscle takes an oil
// depot longer to clear than fat takes an aqueous peptide, so IM rests longer.
export const REST_DAYS = { SubQ: 7, IM: 14 }

export function restDaysFor(route) {
  return REST_DAYS[route === 'IM' ? 'IM' : 'SubQ']
}

// Cumulative wear is counted over a rolling window — a puncture from four
// months ago has healed and shouldn't hold a site hostage forever.
export const WEAR_WINDOW = 90
// Above this multiple of the pool's fair share, a site is carrying more than its
// turn and gets an extended rest even when its recency looks fine.
export const WEAR_OVERUSE_RATIO = 1.8
// A quieter band below the cut-off, so a spot can be flagged while it is still
// usable rather than only once it has already been parked. This matters most in
// a narrowed zone: with several compounds sharing eight thigh sites instead of
// sixteen, wear accumulates roughly twice as fast and a silent threshold would
// be crossed before the warning was any use.
export const WEAR_WARN_RATIO = 1.35
export const WEAR_MIN_USES = 4 // below this there isn't enough history to judge

/** Which half of the body a site is on — drives side-alternation in the path. */
export function sideOf(site) {
  if (!site) return null
  if (site.x < 50) return 'L'
  if (site.x > 50) return 'R'
  return 'C'
}

// ---------- heat ----------

/**
 * How "hot" a site is: 1 the moment it's used, easing to 0 across its rest days.
 * Continuous rather than banded, because the map animates this value — the
 * cooling is the thing the user watches between opens.
 */
export function heatOf(siteId, doseLogs, todayStr, route) {
  const d = daysSinceUse(siteId, doseLogs, todayStr)
  if (d == null) return 0
  const rest = restDaysFor(route)
  if (d >= rest) return 0
  // ease-out: the first day cools fastest, the tail lingers — which matches how
  // a site actually feels, and makes the last stretch visibly "nearly there".
  const linear = 1 - d / rest
  return Math.round(linear * linear * 1000) / 1000
}

export function daysSinceUse(siteId, doseLogs, todayStr) {
  let latest = null
  for (const l of doseLogs) {
    if (l.siteId !== siteId || !l.date) continue
    if (!latest || l.date > latest) latest = l.date
  }
  return latest == null ? null : Math.max(0, daysBetween(latest, todayStr))
}

/** Every use of one site, newest first — the site's "story". */
export function siteHistory(siteId, doseLogs, peptides = []) {
  const nameOf = Object.fromEntries(peptides.map((p) => [p.id, p.name]))
  return doseLogs
    .filter((l) => l.siteId === siteId)
    .map((l) => ({
      id: l.id, date: l.date, loggedAt: l.loggedAt,
      peptideId: l.peptideId, name: nameOf[l.peptideId] || l.peptideId,
      coDrawId: l.coDrawId || null,
    }))
    .sort((a, b) => String(b.loggedAt || b.date).localeCompare(String(a.loggedAt || a.date)))
}

// ---------- wear ----------

/** Uses of each site in the pool over the wear window. */
export function wearCounts(doseLogs, todayStr, route, zone = 'all') {
  const pool = new Set(sitesForRoute(route, zone).map((s) => s.id))
  const from = addDaysStr(todayStr, -WEAR_WINDOW)
  const counts = {}
  for (const s of pool) counts[s] = 0
  for (const l of doseLogs) {
    if (!l.siteId || !pool.has(l.siteId) || !l.date) continue
    if (l.date < from || l.date > todayStr) continue
    counts[l.siteId] += 1
  }
  return counts
}

/**
 * Wear per site relative to the pool's fair share. 1.0 means "exactly its turn";
 * above WEAR_OVERUSE_RATIO means it's been carrying the stack.
 */
export function wearProfile(doseLogs, todayStr, route, zone = 'all') {
  const counts = wearCounts(doseLogs, todayStr, route, zone)
  const ids = Object.keys(counts)
  const total = ids.reduce((s, id) => s + counts[id], 0)
  const fairShare = ids.length ? total / ids.length : 0
  const out = {}
  for (const id of ids) {
    const uses = counts[id]
    const ratio = fairShare > 0 ? uses / fairShare : 0
    const overworn = uses >= WEAR_MIN_USES && ratio >= WEAR_OVERUSE_RATIO
    out[id] = {
      uses,
      ratio: Math.round(ratio * 100) / 100,
      overworn,
      // heading that way, but still fair game today
      nearing: !overworn && uses >= WEAR_MIN_USES && ratio >= WEAR_WARN_RATIO,
    }
  }
  return { sites: out, total, fairShare: Math.round(fairShare * 100) / 100 }
}

// ---------- reactions ----------

export const REACTION_KINDS = [
  { id: 'bruise', label: 'Bruise', icon: '🟣', restDays: 7 },
  { id: 'lump', label: 'Lump / hard spot', icon: '🔴', restDays: 21 },
  { id: 'sting', label: 'Stung going in', icon: '⚡', restDays: 3 },
  { id: 'bleed', label: 'Bled', icon: '🩸', restDays: 3 },
  { id: 'pain', label: 'Sore afterwards', icon: '😣', restDays: 7 },
]
export const REACTION_BY_ID = Object.fromEntries(REACTION_KINDS.map((r) => [r.id, r]))

/**
 * A site is resting while it has an uncleared reaction. A lump parks it for
 * three weeks; a bleed for three days. The user can clear it early — it's their
 * body — but nothing auto-clears a lump on a timer alone, because the point is
 * that they look at it again before using it.
 */
export function reactionState(siteId, reactions = {}, todayStr) {
  const list = (reactions[siteId] || []).filter((r) => !r.cleared)
  if (!list.length) return { resting: false, active: null, until: null, history: reactions[siteId] || [] }
  // the one that parks it longest wins
  let worst = null
  for (const r of list) {
    const meta = REACTION_BY_ID[r.kind]
    const until = addDaysStr(r.date, meta?.restDays ?? 7)
    if (!worst || until > worst.until) worst = { ...r, until, meta }
  }
  return {
    resting: true,
    active: worst,
    until: worst.until,
    // daysBetween(a, b) counts forward from a to b, so this is days remaining
    daysLeft: Math.max(0, daysBetween(todayStr, worst.until)),
    history: reactions[siteId] || [],
  }
}

/** Sites that keep reacting — worth a quiet heads-up rather than silence. */
export function repeatReactors(reactions = {}, todayStr, minCount = 3) {
  const from = addDaysStr(todayStr, -WEAR_WINDOW)
  const out = []
  for (const [siteId, list] of Object.entries(reactions)) {
    const recent = (list || []).filter((r) => r.date >= from)
    if (recent.length >= minCount) {
      out.push({ siteId, count: recent.length, site: SITE_BY_ID[siteId] })
    }
  }
  return out.sort((a, b) => b.count - a.count)
}

// ---------- combined site state ----------

export const SITE_STATUS = {
  fresh: { label: 'Fresh', tone: 'var(--lime)', words: 'never used — fully rested' },
  rested: { label: 'Rested', tone: 'var(--lime)', words: 'well rested' },
  cooling: { label: 'Cooling', tone: 'var(--amber)', words: 'still cooling down' },
  hot: { label: 'Hot', tone: 'var(--coral)', words: 'just used — let it heal' },
  resting: { label: 'Resting', tone: 'var(--rose)', words: 'reacting — leave it alone' },
  overworn: { label: 'Over-used', tone: 'var(--violet)', words: 'taken more than its turn — extended rest' },
}

/**
 * Everything the map and the pickers need about one site, from all three clocks.
 * `usable` is the single answer to "may I send them here" — both the suggestion
 * and the path route around anything that isn't.
 */
export function siteState(siteId, { doseLogs = [], reactions = {}, todayStr, route, zone = 'all', wear = null }) {
  const days = daysSinceUse(siteId, doseLogs, todayStr)
  const heat = heatOf(siteId, doseLogs, todayStr, route)
  const w = (wear || wearProfile(doseLogs, todayStr, route, zone)).sites[siteId] || { uses: 0, ratio: 0, overworn: false, nearing: false }
  const reaction = reactionState(siteId, reactions, todayStr)

  let status
  if (reaction.resting) status = 'resting'
  else if (w.overworn) status = 'overworn'
  else if (days == null) status = 'fresh'
  else if (heat > 0.55) status = 'hot'
  else if (heat > 0) status = 'cooling'
  else status = 'rested'

  return {
    siteId,
    site: SITE_BY_ID[siteId],
    days,
    heat,
    uses: w.uses,
    wearRatio: w.ratio,
    overworn: w.overworn,
    nearingOveruse: !!w.nearing,
    resting: reaction.resting,
    reaction,
    status,
    // a merely-warm site is still allowed if nothing better exists; a reacting
    // or over-worn one is not
    usable: !reaction.resting && !w.overworn,
    preferred: !reaction.resting && !w.overworn && heat === 0,
  }
}

export function allSiteStates(ctx) {
  const zone = ctx.zone || 'all'
  const wear = wearProfile(ctx.doseLogs || [], ctx.todayStr, ctx.route, zone)
  const out = {}
  for (const s of sitesForRoute(ctx.route, zone)) out[s.id] = siteState(s.id, { ...ctx, zone, wear })
  return out
}

// ---------- the path ----------

/**
 * A stable, even rotation order across a pool.
 *
 * Deliberately independent of the dose log: "follow the path" is only
 * followable if the sequence doesn't reshuffle under you every time you log.
 * The order is derived from geometry alone — alternate side on every step, and
 * move to a different region wherever possible — so it maximises the distance
 * between reuses of anything adjacent.
 */
export function rotationPath(route, excluded = [], zone = 'all') {
  const skip = new Set(excluded)
  const pool = sitesForRoute(route, zone).filter((s) => !skip.has(s.id))
  if (pool.length <= 1) return pool.map((s) => s.id)

  const remaining = [...pool]
  // start on the left, in the first region — deterministic, so the same stack
  // always gets the same path
  const seq = []
  let prev = null
  let prevPrev = null

  while (remaining.length) {
    // Adjacency is a hard constraint, not a preference: going straight from a
    // spot to the one next door wastes the whole point of alternating. Only if
    // literally nothing non-adjacent is left do we allow it.
    const neighbours = new Set(prev?.neighbors || [])
    const eligible = remaining.filter((s) => !neighbours.has(s.id))
    const pool = eligible.length ? eligible : remaining

    let bestSite = pool[0]
    let bestScore = -Infinity
    pool.forEach((s, i) => {
      let score = 0
      if (prev) {
        if (sideOf(s) !== sideOf(prev)) score += 4 // alternate sides first
        if (s.region !== prev.region) score += 2 // then move region
      } else {
        // opening move: leftmost, topmost, for a stable starting point
        score += (50 - s.x) / 100 + (100 - s.y) / 1000
      }
      if (prevPrev && s.region !== prevPrev.region) score += 0.5
      // tie-break by map order so the result is fully deterministic
      score -= i * 1e-4
      if (score > bestScore) { bestScore = score; bestSite = s }
    })
    const chosen = bestSite
    remaining.splice(remaining.indexOf(chosen), 1)
    seq.push(chosen.id)
    prevPrev = prev
    prev = chosen
  }
  return seq
}

/** The excluded set for a pool right now: reacting or over-worn sites. */
export function excludedSites(ctx) {
  const states = allSiteStates(ctx)
  return Object.values(states).filter((s) => !s.usable).map((s) => s.siteId)
}

/**
 * The next spot on the path.
 *
 * Position comes from history, not a stored counter: find the last site used in
 * this pool, take the one after it in the sequence. That auto-advances on every
 * log, survives a reload, and self-heals if the path changes because a site
 * started resting.
 */
export function nextOnPath(ctx) {
  const zone = ctx.zone || 'all'
  const excluded = excludedSites(ctx)
  const seq = rotationPath(ctx.route, excluded, zone)
  if (!seq.length) {
    // everything is parked — fall back to the least-bad option rather than
    // refusing to answer, and say so at the call site
    const all = rotationPath(ctx.route, [], zone)
    return { siteId: all[0] || null, seq: all, index: 0, allParked: true }
  }
  const pool = new Set(seq)
  let last = null
  let lastStamp = ''
  for (const l of ctx.doseLogs || []) {
    if (!l.siteId) continue
    // a shot placed outside this zone says nothing about where this compound is
    // up to in its own rotation
    if (!pool.has(l.siteId)) continue
    const stamp = String(l.loggedAt || l.date || '')
    if (stamp > lastStamp) { lastStamp = stamp; last = l.siteId }
  }
  const at = last && pool.has(last) ? seq.indexOf(last) : -1
  const index = (at + 1) % seq.length
  return { siteId: seq[index], seq, index, allParked: false }
}

/** The next few stops, for the "what's coming" preview. */
export function pathPreview(ctx, count = 3) {
  const { seq, index } = nextOnPath(ctx)
  return Array.from({ length: Math.min(count, seq.length) }, (_, i) => seq[(index + i) % seq.length])
}

// ---------- suggestion (single-spot mode) ----------

/**
 * The best single spot: coolest first, then least-worn, avoiding anything
 * parked. Same exclusions as the path, so the two modes never disagree about
 * what's off-limits.
 */
export function suggestBest(ctx) {
  const states = allSiteStates(ctx)
  const usable = Object.values(states).filter((s) => s.usable)
  const pool = usable.length ? usable : Object.values(states)
  let best = pool[0]
  for (const s of pool) {
    if (!best) { best = s; continue }
    // never used beats everything; then coolest; then least-worn
    const key = (x) => [x.days == null ? 1 : 0, -x.heat, -x.wearRatio, x.days == null ? 0 : x.days]
    const a = key(s), b = key(best)
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue
      if (a[i] > b[i]) best = s
      break
    }
  }
  return best?.siteId || null
}

/** Plain-language reason the suggestion is the suggestion. */
export function suggestReason(siteId, ctx) {
  const st = siteState(siteId, ctx)
  if (st.days == null) return "you've never used this one — fully rested"
  if (st.heat === 0) return `fully healed — ${st.days} days rested`
  return `the coolest spot available — ${st.days} days rested`
}

// ---------- rotation health ----------

export const HEALTH_GRADES = [
  { min: 90, label: 'Excellent', tone: 'var(--lime)' },
  { min: 75, label: 'Good', tone: 'var(--lime)' },
  { min: 55, label: 'Fair', tone: 'var(--amber)' },
  { min: 0, label: 'Needs work', tone: 'var(--coral)' },
]

export function gradeFor(score) {
  return HEALTH_GRADES.find((g) => score >= g.min) || HEALTH_GRADES.at(-1)
}

/**
 * How well the rotation is actually going, from three things that matter:
 * spread (are you using the whole map), rest (how healed sites were when used),
 * and balance (are you favouring one side).
 *
 * Returns null below a handful of logged injections — a score off two shots
 * would be noise dressed as feedback.
 */
export function rotationHealth(ctx, { minLogs = 4, window = 28 } = {}) {
  const { doseLogs = [], todayStr, route, zone = 'all' } = ctx
  const pool = sitesForRoute(route, zone)
  const poolIds = new Set(pool.map((s) => s.id))
  const from = addDaysStr(todayStr, -window)
  const recent = doseLogs
    .filter((l) => l.siteId && poolIds.has(l.siteId) && l.date >= from && l.date <= todayStr)
    .sort((a, b) => String(a.loggedAt || a.date).localeCompare(String(b.loggedAt || b.date)))

  if (recent.length < minLogs) {
    return { ready: false, logs: recent.length, needed: minLogs }
  }

  // spread — distinct sites used vs how many you could have used
  const distinct = new Set(recent.map((l) => l.siteId)).size
  const spread = Math.min(1, distinct / Math.min(pool.length, recent.length))

  // rest — how healed each site was at the moment it was reused
  const rest = restDaysFor(route)
  const seenAt = {}
  let restSum = 0
  let restN = 0
  for (const l of recent) {
    const prev = seenAt[l.siteId]
    if (prev) {
      const gap = daysBetween(prev, l.date)
      restSum += Math.min(1, gap / rest)
      restN += 1
    }
    seenAt[l.siteId] = l.date
  }
  const restScore = restN ? restSum / restN : 1 // no reuse yet = nothing to penalise

  // balance — left vs right
  let left = 0, right = 0
  for (const l of recent) {
    const side = sideOf(SITE_BY_ID[l.siteId])
    if (side === 'L') left += 1
    else if (side === 'R') right += 1
  }
  const sided = left + right
  const skew = sided ? Math.abs(left - right) / sided : 0
  const balance = 1 - skew

  const score = Math.round((spread * 40 + restScore * 40 + balance * 20))
  const grade = gradeFor(score)

  const issues = []
  if (skew > 0.34) {
    issues.push({
      kind: 'balance',
      text: `You're favouring your ${left > right ? 'left' : 'right'} side — ${Math.max(left, right)} of the last ${sided} shots.`,
    })
  }
  if (spread < 0.6) {
    issues.push({
      kind: 'clustering',
      text: `Only ${distinct} spot${distinct === 1 ? '' : 's'} used in ${window} days — spreading wider gives each one longer to heal.`,
    })
  }
  if (restScore < 0.6) {
    issues.push({
      kind: 'rest',
      text: `Sites are coming back around before they've fully healed — aim for ${rest} days between reuses.`,
    })
  }

  return {
    ready: true,
    score,
    grade: grade.label,
    tone: grade.tone,
    spread: Math.round(spread * 100),
    rest: Math.round(restScore * 100),
    balance: Math.round(balance * 100),
    left,
    right,
    distinct,
    logs: recent.length,
    window,
    issues,
    // one line, so the UI has something to say without picking through issues
    nudge: issues[0]?.text || 'Even, well-rested rotation — keep it exactly like this.',
  }
}

/** Front/back face of a site — the map has two views now. */
export function faceOf(site) {
  return site?.face || 'front'
}

export function facesInPool(route) {
  const faces = new Set(sitesForRoute(route).map(faceOf))
  return [...faces]
}

export function sitesOnFace(route, face) {
  return sitesForRoute(route).filter((s) => faceOf(s) === face)
}

export { ALL_SITES }

/**
 * A warning about the pool as a whole, rather than about one spot.
 *
 * A narrowed zone is the case that needs this. Eight thigh sites carrying what
 * sixteen used to carry wear out roughly twice as fast, and the per-site
 * "over-used" flag only fires once a spot is already parked. This fires earlier
 * and talks about the pool: how many spots are still fair game, and how many
 * are heading for a forced rest.
 */
export function zoneLoad(ctx) {
  const zone = ctx.zone || 'all'
  const states = Object.values(allSiteStates(ctx))
  const total = states.length
  const parked = states.filter((s) => !s.usable)
  const nearing = states.filter((s) => s.usable && s.nearingOveruse)
  const usable = total - parked.length

  let level = 'ok'
  if (usable === 0) level = 'critical'
  else if (usable <= 2 || parked.length >= total / 2) level = 'high'
  else if (nearing.length > 0 || parked.length > 0) level = 'watch'

  const thigh = zone === 'thigh'
  let message = null
  if (level === 'critical') {
    message = thigh
      ? 'Every thigh spot is resting or over-used. Give them a few days — or move this compound back to all SubQ sites for one shot.'
      : 'Every spot in the pool is resting or over-used. Give them a few days.'
  } else if (level === 'high') {
    message = `Only ${usable} of ${total} ${thigh ? 'thigh ' : ''}spot${usable === 1 ? '' : 's'} left in rotation — the rest are resting or over-used.`
  } else if (level === 'watch' && nearing.length) {
    message = `${nearing.length} ${thigh ? 'thigh ' : ''}spot${nearing.length === 1 ? ' is' : 's are'} taking more than their share. They'll be rested automatically if it keeps up.`
  } else if (level === 'watch') {
    message = `${parked.length} of ${total} ${thigh ? 'thigh ' : ''}spots are resting — rotation is tighter than usual.`
  }

  return {
    zone, level, total, usable,
    parked: parked.map((s) => s.siteId),
    nearing: nearing.map((s) => s.siteId),
    message,
  }
}
