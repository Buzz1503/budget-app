// "Combine your shots" planner. Given everything due in one slot, work out the
// fewest syringes that can carry it.
//
// A pair shares a syringe ONLY on a confirmed MIX verdict. CAUTION, DONT_MIX
// and NEVER are all inject-separately here, and so is a pair the matrix has no
// entry for — "no conflict found" is the only thing this engine will act on,
// and anything short of that gets its own shot.

export const MAX_GROUP_ML = 1.5
const GROUPABLE = new Set(['MIX'])
const EPS = 1e-9

// Above this many poolable items the exhaustive search is replaced by a greedy
// first-fit pass. Bell(10) = 115,975 partitions, which is still instant; beyond
// that it stops being worth it and a real stack never gets there anyway.
const MAX_BRUTE_FORCE = 10

function pairVerdicts(items, verdictOf) {
  const cache = new Map()
  const at = (i, j) => (i < j ? `${i}:${j}` : `${j}:${i}`)
  return (a, b) => {
    const k = at(a.index, b.index)
    if (!cache.has(k)) cache.set(k, verdictOf(a.compoundId, b.compoundId) || null)
    return cache.get(k)
  }
}

function groupSummary(members, verdict) {
  const pairs = []
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      pairs.push({ a: members[i].name, b: members[j].name, verdict: verdict(members[i], members[j]) })
    }
  }
  return {
    items: members,
    units: members.reduce((s, m) => s + (m.units || 0), 0),
    ml: members.reduce((s, m) => s + (m.ml || 0), 0),
    pairs,
    separate: false,
  }
}

// Scores are [groupCount, -largestGroup] — fewest syringes first, then the
// chunkier merge so the answer is stable rather than whichever partition
// happened to come up first.
function better(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}

function greedy(items, canPair, fits) {
  const groups = []
  for (const it of items) {
    const target = groups.find((g) => fits(g, it) && g.every((m) => canPair(m, it)))
    if (target) target.push(it)
    else groups.push([it])
  }
  return groups
}

function exhaustive(items, canPair, fits) {
  let best = null
  let bestScore = null
  const cur = []

  const walk = (i) => {
    // can never beat a solution that already uses fewer syringes
    if (bestScore && cur.length > bestScore[0]) return
    if (i === items.length) {
      const score = [cur.length, -Math.max(...cur.map((g) => g.length), 0)]
      if (!bestScore || better(score, bestScore)) {
        bestScore = score
        best = cur.map((g) => [...g])
      }
      return
    }
    const it = items[i]
    for (const g of cur) {
      if (!fits(g, it)) continue
      if (!g.every((m) => canPair(m, it))) continue
      g.push(it)
      walk(i + 1)
      g.pop()
    }
    cur.push([it])
    walk(i + 1)
    cur.pop()
  }

  walk(0)
  return best || []
}

/**
 * @param items  [{ id, compoundId, name, units, ml, separate, separateReason }]
 * @param verdictOf (compoundIdA, compoundIdB) => 'MIX'|'CAUTION'|'DONT_MIX'|'NEVER'|null
 */
export function planShots(items, verdictOf, { maxMl = MAX_GROUP_ML } = {}) {
  const indexed = items.map((it, index) => ({ ...it, index }))

  // Anything flagged always-separate (different vehicle/route), anything with no
  // compound in the matrix, and anything whose volume we can't bound is its own
  // shot and never enters the search.
  const forced = indexed.filter(
    (it) => it.separate || !it.compoundId || !isFinite(it.ml) || it.ml > maxMl + EPS
  )
  const forcedIds = new Set(forced.map((it) => it.id))
  const poolable = indexed
    .filter((it) => !forcedIds.has(it.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  const verdict = pairVerdicts(indexed, verdictOf)
  const canPair = (a, b) => GROUPABLE.has(verdict(a, b))
  const fits = (g, it) => g.reduce((s, m) => s + m.ml, 0) + it.ml <= maxMl + EPS

  const raw = poolable.length === 0
    ? []
    : poolable.length > MAX_BRUTE_FORCE
      ? greedy(poolable, canPair, fits)
      : exhaustive(poolable, canPair, fits)

  const groups = raw.map((members) => groupSummary(members, verdict))
  const singles = forced.map((it) => ({
    items: [it],
    units: it.units || 0,
    ml: it.ml || 0,
    pairs: [],
    separate: !!it.separate,
    separateReason: it.separateReason || null,
  }))

  const all = [...groups, ...singles].sort((a, b) => b.items.length - a.items.length)
  return {
    groups: all,
    shots: all.length,
    before: indexed.length,
    combinable: all.filter((g) => g.items.length > 1).length,
    saved: Math.max(0, indexed.length - all.length),
  }
}

// "3 shots instead of 6 this morning."
export function shotsHeadline(plan, slot) {
  if (!plan || plan.before === 0) return null
  const when = slot === 'PM' ? 'tonight' : 'this morning'
  if (plan.saved <= 0) return `${plan.before} separate shot${plan.before === 1 ? '' : 's'} ${when} — nothing safely combinable`
  return `${plan.shots} shot${plan.shots === 1 ? '' : 's'} instead of ${plan.before} ${when}`
}
