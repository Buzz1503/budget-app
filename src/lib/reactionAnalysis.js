/**
 * Ranking the suspects, and saying how sure it is.
 *
 * Everything here is a comparison of rates between groups of injections that
 * differ in one named way. That is the only kind of claim this data can support
 * and the only kind made. There is no model, no scoring heuristic dressed up as
 * insight, and no verdict that is not accompanied by the numbers it came from —
 * "reacted 5 of 6 times on the right, 0 of 4 on the left" is the finding, and
 * "GHK-Cu" is a reading of it that the user is shown the working for.
 *
 * The confidence badge exists because the honest answer, most of the time, is
 * "not yet". A feature that produced a confident verdict from three injections
 * would be worse than useless: it would be believed.
 */

// ------------------------------------------------------------ the variables

/**
 * Every axis worth comparing along.
 *
 * `valuesOf` returns the value(s) an injection had for that axis. Returning
 * several is normal — a syringe with two compounds in it belongs to both
 * compounds' groups, which is exactly why a shared syringe cannot separate
 * them and why the confounding detector below has something to find.
 */
export const FACTORS = [
  { id: 'compound', label: 'Compound', kind: 'suspect', valuesOf: (r) => r.compoundIds || [] },
  { id: 'component', label: 'Blend component', kind: 'suspect', valuesOf: (r) => r.componentIds || [] },
  { id: 'diluent', label: 'Diluent', kind: 'variable', valuesOf: (r) => (r.diluent ? [r.diluent] : []) },
  { id: 'vial', label: 'Vial', kind: 'variable', valuesOf: (r) => (r.vialId ? [r.vialId] : []) },
  { id: 'batch', label: 'Batch or lot', kind: 'variable', valuesOf: (r) => (r.batch ? [r.batch] : []) },
  { id: 'vendor', label: 'Vendor', kind: 'variable', valuesOf: (r) => (r.vendor ? [r.vendor] : []) },
  { id: 'needleGauge', label: 'Needle gauge', kind: 'technique', valuesOf: (r) => (r.needleGauge ? [String(r.needleGauge)] : []) },
  { id: 'needleLength', label: 'Needle length', kind: 'technique', valuesOf: (r) => (r.needleLength ? [String(r.needleLength)] : []) },
  { id: 'angle', label: 'Angle', kind: 'technique', valuesOf: (r) => (r.angle ? [String(r.angle)] : []) },
  { id: 'pinched', label: 'Skin pinched', kind: 'technique', valuesOf: (r) => (r.pinched == null ? [] : [r.pinched ? 'yes' : 'no']) },
  { id: 'speed', label: 'Injection speed', kind: 'technique', valuesOf: (r) => (r.speed ? [r.speed] : []) },
  { id: 'temperature', label: 'Syringe temperature', kind: 'technique', valuesOf: (r) => (r.temperature ? [r.temperature] : []) },
  { id: 'swabDried', label: 'Swab fully dried', kind: 'technique', valuesOf: (r) => (r.skinPrep === 'none' ? ['no swab'] : r.swabDried == null ? [] : [r.swabDried ? 'yes' : 'no']) },
  { id: 'antihistamine', label: 'Pre-antihistamine', kind: 'technique', valuesOf: (r) => [r.antihistamine ? 'yes' : 'no'] },
  { id: 'zone', label: 'Site', kind: 'variable', valuesOf: (r) => (r.zoneId ? [r.zoneId] : []) },
  { id: 'side', label: 'Side', kind: 'variable', valuesOf: (r) => (r.side ? [r.side] : []) },
  { id: 'sharedSyringe', label: 'Shared syringe', kind: 'technique', valuesOf: (r) => [r.sharedSyringe ? 'yes' : 'no'] },
]

export const FACTOR_BY_ID = Object.fromEntries(FACTORS.map((f) => [f.id, f]))

// ------------------------------------------------------------------ groups

/**
 * n, reaction rate and average score for every value of one factor.
 *
 * Confounded injections are counted and reported but never scored: they are
 * the reason a group can look thin, and hiding them would make the confidence
 * badge look better than the evidence is.
 */
export function groupsFor(factorId, { records = [], reactions = [], scoreOf, positiveOf, includeConfounded = false } = {}) {
  const f = FACTOR_BY_ID[factorId]
  if (!f) return []
  const rxOf = (r) => reactions.find((x) => x.injectionRecordId === r.id) || null
  const buckets = new Map()

  for (const rec of records) {
    const confounded = !!rec.confounded
    for (const v of f.valuesOf(rec)) {
      if (!buckets.has(v)) buckets.set(v, { value: v, n: 0, positive: 0, scores: [], durations: [], confounded: 0 })
      const b = buckets.get(v)
      if (confounded && !includeConfounded) { b.confounded += 1; continue }
      b.n += 1
      const rx = rxOf(rec)
      if (rx) {
        if (positiveOf(rx)) b.positive += 1
        b.scores.push(scoreOf(rx))
        if (rx.durationHours != null) b.durations.push(rx.durationHours)
      } else {
        b.scores.push(0)
      }
    }
  }

  return [...buckets.values()].map((b) => ({
    ...b,
    rate: b.n ? b.positive / b.n : null,
    meanRs: b.scores.length ? round1(b.scores.reduce((n, s) => n + s, 0) / b.scores.length) : null,
    meanDurationH: b.durations.length ? Math.round(b.durations.reduce((n, s) => n + s, 0) / b.durations.length) : null,
  })).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.n - a.n)
}

const round1 = (n) => Math.round(n * 10) / 10

/** The gap between the best and worst value of a factor — how much it explains. */
export function factorSpread(groups = []) {
  const rated = groups.filter((g) => g.rate != null && g.n > 0)
  if (rated.length < 2) return null
  const rates = rated.map((g) => g.rate)
  return {
    gap: Math.max(...rates) - Math.min(...rates),
    top: rated[0],
    bottom: rated[rated.length - 1],
  }
}

// -------------------------------------------------------------- confidence

export const CONFIDENCE = {
  low: { id: 'low', label: 'Low', words: 'not enough injections yet to separate anything' },
  medium: { id: 'medium', label: 'Medium', words: 'a real difference, but not yet ruled in' },
  high: { id: 'high', label: 'High', words: 'a clear difference, with a control to rule out technique' },
}

/**
 * How much to believe the top of the board.
 *
 * Three gates, all of which have to be passed. The group sizes stop a verdict
 * being read off two injections; the gap stops a coin-flip difference being
 * called a finding; the control requirement stops "the compound" being blamed
 * for something the needle was doing.
 */
export function confidenceFor({ groups = [], confoundedShare = 0, controlDone = false } = {}) {
  const rated = groups.filter((g) => g.rate != null && g.n > 0)
  if (rated.length < 2) return CONFIDENCE.low
  const smallest = Math.min(...rated.map((g) => g.n))
  const gap = Math.max(...rated.map((g) => g.rate)) - Math.min(...rated.map((g) => g.rate))

  if (smallest < 3 || confoundedShare >= 0.3) return CONFIDENCE.low
  if (smallest >= 6 && gap >= 0.5 && controlDone) return CONFIDENCE.high
  if (smallest >= 3 && gap >= 0.4) return CONFIDENCE.medium
  return CONFIDENCE.low
}

// ------------------------------------------------------ confounding detector

/**
 * Two things that have only ever happened together.
 *
 * This is the single most useful thing the engine does, because it is the one
 * failure people cannot see for themselves: if MOTS-c has only ever been in a
 * syringe with GHK-Cu, no amount of data will separate them, and an engine that
 * quietly ranked one above the other would be inventing a distinction its data
 * cannot support. So it says so, and points at the step that fixes it.
 */
export function confounded({ records = [], factorIds = ['compound', 'component', 'vial', 'diluent'] } = {}) {
  const out = []
  const sets = {}
  for (const fid of factorIds) {
    const f = FACTOR_BY_ID[fid]
    if (!f) continue
    for (const rec of records) {
      for (const v of f.valuesOf(rec)) {
        const key = `${fid}:${v}`
        ;(sets[key] ||= new Set()).add(rec.id)
      }
    }
  }
  const keys = Object.keys(sets)
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = sets[keys[i]]
      const b = sets[keys[j]]
      if (a.size < 2 || b.size < 2) continue
      if (a.size !== b.size) continue
      let same = true
      for (const x of a) if (!b.has(x)) { same = false; break }
      if (!same) continue
      const [fa, va] = splitKey(keys[i])
      const [fb, vb] = splitKey(keys[j])
      // Two values of the *same* factor co-occurring is not a degenerate case
      // to skip — it is the main one. Two compounds that have only ever been in
      // the same syringe are values of `compound`, and excluding that pair
      // would blind this to the confound it exists to find.
      out.push({
        a: { factor: fa, value: va },
        b: { factor: fb, value: vb },
        n: a.size,
        sameFactor: fa === fb,
        fix: fixFor(fa, fb),
      })
    }
  }
  return out
}

function splitKey(k) {
  const i = k.indexOf(':')
  return [k.slice(0, i), k.slice(i + 1)]
}

function fixFor(a, b) {
  const pair = [a, b].sort().join('|')
  if (a === 'compound' && b === 'compound') return { step: 'split', words: 'Give each compound its own syringe and its own site' }
  if (pair.includes('compound') && pair.includes('component')) return { step: 'split', words: 'Split the blend, or give each compound its own syringe' }
  if (pair.includes('vial')) return { step: 'batch', words: 'Run the batch test with a different vial' }
  if (pair.includes('diluent')) return { step: 'diluent', words: 'Run the diluent swap' }
  return { step: 'split', words: 'Give each compound its own syringe and site' }
}

// ------------------------------------------------------------ suspect board

/**
 * The top of the board: who is most likely, and the line of evidence.
 *
 * Likelihood is the reaction rate of that suspect's own injections against the
 * rate of everything else — not a probability, and labelled as a comparison so
 * it cannot be read as one.
 */
export function suspectBoard({ records = [], reactions = [], scoreOf, positiveOf, suspects = [], nameOf = (x) => x, controlDone = false } = {}) {
  const ctx = { records, reactions, scoreOf, positiveOf }
  const compounds = groupsFor('compound', ctx)
  const components = groupsFor('component', ctx)
  const all = [...compounds, ...components]

  const byValue = new Map()
  for (const g of all) {
    const prev = byValue.get(g.value)
    if (!prev || g.n > prev.n) byValue.set(g.value, g)
  }

  const pool = suspects.length
    ? [...byValue.values()].filter((g) => suspects.includes(g.value))
    : [...byValue.values()]
  const considered = pool.length ? pool : [...byValue.values()]

  const confoundedShare = records.length
    ? records.filter((r) => r.confounded).length / records.length
    : 0

  const rows = considered
    .filter((g) => g.n > 0)
    .map((g) => {
      const others = [...byValue.values()].filter((x) => x.value !== g.value && x.n > 0)
      const otherN = others.reduce((n, x) => n + x.n, 0)
      const otherPos = others.reduce((n, x) => n + x.positive, 0)
      const otherRate = otherN ? otherPos / otherN : null
      return {
        id: g.value,
        name: nameOf(g.value),
        n: g.n,
        positive: g.positive,
        rate: g.rate,
        meanRs: g.meanRs,
        meanDurationH: g.meanDurationH,
        confounded: g.confounded,
        lift: otherRate == null ? null : round1((g.rate - otherRate) * 100),
        evidence: `Reacted ${g.positive} of ${g.n} times${otherN ? `, against ${otherPos} of ${otherN} for everything else` : ''}`,
      }
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.n - a.n)

  const sideGroups = groupsFor('side', ctx)
  const confidence = confidenceFor({
    groups: rows.map((r) => ({ rate: r.rate, n: r.n })),
    confoundedShare,
    controlDone,
  })

  const top = rows[0] || null
  return {
    rows,
    top,
    runnerUp: rows[1] || null,
    confidence,
    confoundedShare,
    sideGroups,
    blocked: confounded({ records }),
    verdict: top
      ? `Most likely: ${top.name}`
      : 'Not enough injections logged yet',
  }
}

/** Two things, side by side, on the axes that matter. */
export function compare(factorId, valueA, valueB, ctx) {
  const groups = groupsFor(factorId, ctx)
  const pick = (v) => groups.find((g) => g.value === v) || { value: v, n: 0, positive: 0, rate: null, meanRs: null, meanDurationH: null }
  return { factor: FACTOR_BY_ID[factorId], a: pick(valueA), b: pick(valueB) }
}

/** Every factor, sorted by how much difference it makes — the evidence page. */
export function evidence(ctx) {
  return FACTORS
    .map((f) => {
      const groups = groupsFor(f.id, ctx)
      return { factor: f, groups, spread: factorSpread(groups) }
    })
    .filter((row) => row.groups.length > 0)
    .sort((a, b) => (b.spread?.gap ?? -1) - (a.spread?.gap ?? -1))
}

/** Score over time for one compound, for the trend chart. */
export function trendFor(compoundId, { records = [], reactions = [], scoreOf }) {
  return records
    .filter((r) => (r.compoundIds || []).includes(compoundId) || (r.componentIds || []).includes(compoundId))
    .sort((a, b) => String(a.injectedAt).localeCompare(String(b.injectedAt)))
    .map((r) => {
      const rx = reactions.find((x) => x.injectionRecordId === r.id)
      return { date: String(r.injectedAt).slice(0, 10), score: rx ? scoreOf(rx) : 0, confounded: !!r.confounded }
    })
}
