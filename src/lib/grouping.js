// "Combine your shots" planner. Given everything due in one slot, work out the
// fewest syringes that can carry it — every pair inside a syringe must have a
// real MIX or CAUTION verdict from the chemistry matrix.
//
// Deliberately conservative in two places:
//   • a pair with no matrix entry is NOT grouped. The co-draw modal treats
//     missing data as CAUTION so a user-initiated mix still hits the inspection
//     gate, but this engine *proposes* mixes unprompted, so it only proposes
//     what the data actually supports.
//   • CAUTION groups are allowed but flagged; accepting one routes through the
//     co-draw flow, which will not log until visual inspection is confirmed.

export const MAX_GROUP_ML = 1.5
const GROUPABLE = new Set(['MIX', 'CAUTION'])
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
  let caution = false
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const v = verdict(members[i], members[j])
      if (v === 'CAUTION') caution = true
      pairs.push({ a: members[i].name, b: members[j].name, verdict: v })
    }
  }
  return {
    items: members,
    units: members.reduce((s, m) => s + (m.units || 0), 0),
    ml: members.reduce((s, m) => s + (m.ml || 0), 0),
    caution,
    pairs,
    separate: false,
  }
}

// Scores are [groupCount, cautionGroups, -largestGroup] — fewest syringes first,
// then the fewest syringes that need a visual-inspection gate, then the chunkier
// merge so the answer is stable rather than whichever partition came up first.
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

function exhaustive(items, canPair, fits, isCaution) {
  let best = null
  let bestScore = null
  const cur = []

  const walk = (i) => {
    // can never beat a solution that already uses fewer syringes
    if (bestScore && cur.length > bestScore[0]) return
    if (i === items.length) {
      const score = [
        cur.length,
        cur.filter((g) => g.some((m, mi) => g.some((n, ni) => ni > mi && isCaution(m, n)))).length,
        -Math.max(...cur.map((g) => g.length), 0),
      ]
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
  const isCaution = (a, b) => verdict(a, b) === 'CAUTION'
  const fits = (g, it) => g.reduce((s, m) => s + m.ml, 0) + it.ml <= maxMl + EPS

  const raw = poolable.length === 0
    ? []
    : poolable.length > MAX_BRUTE_FORCE
      ? greedy(poolable, canPair, fits)
      : exhaustive(poolable, canPair, fits, isCaution)

  const groups = raw.map((members) => groupSummary(members, verdict))
  const singles = forced.map((it) => ({
    items: [it],
    units: it.units || 0,
    ml: it.ml || 0,
    caution: false,
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
