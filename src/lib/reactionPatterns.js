// Patterns across every injection: by compound, by needle, by part of the body.
//
// Counting, and nothing else. Each row says how many injections, how many
// reacted, and — only when there are enough to mean anything — the rate and how
// long they took to clear. Nothing is ranked as a cause, and nothing is scored:
// a table of counts that the person reads is the whole feature.
//
// Two rules stop the counts from claiming more than they know.
//
// 1. A syringe with two compounds in it cannot say which one irritated the
//    skin. Those injections are counted separately against each compound and
//    labelled as unable to isolate; they never enter a compound's own rate. A
//    blend (KLOW has GHK-Cu in it) is the same problem wearing one label, so a
//    blend's injections are not clean data for any of its components either.
// 2. Below MIN_INJECTIONS checked injections a rate is a coin toss written as a
//    percentage. Under that the row shows the raw counts and says there is not
//    enough data yet.

import { SYMPTOMS } from './reactionCourse'
import { isReaction, peakSeverity, timeToResolve, checksOf } from './reactionCourse'
import { needleKey, needleLabel } from './injectionCapture'
import { GROUPS } from './sitePins'

export const MIN_INJECTIONS = 5

/** Known blends and what is in them. A peptide can also carry its own `blendOf`. */
export const BLENDS = {
  glow: ['ghkcu', 'tb500', 'bpc157'],
  klow: ['bpc157', 'ghkcu', 'tb500', 'kpv'],
  bpc_tb_blend: ['bpc157', 'tb500'],
  selank_semax_blend: ['selank', 'semax'],
}

/** The compounds a blend is made of, or [] if it is not a blend. */
export function componentsOf(peptideId, peptides = []) {
  const p = peptides.find((x) => x.id === peptideId)
  if (Array.isArray(p?.blendOf) && p.blendOf.length) return p.blendOf
  if (BLENDS[peptideId]) return BLENDS[peptideId]
  const name = `${p?.name || ''} ${peptideId}`.toLowerCase()
  if (/\bklow\b/.test(name)) return BLENDS.klow
  if (/\bglow\b/.test(name)) return BLENDS.glow
  return []
}

export const isBlend = (peptideId, peptides) => componentsOf(peptideId, peptides).length > 0

/** More than one compound in the syringe (or on one site at one moment). */
export function isCoDraw(record) {
  return !!record?.coDraw || !!record?.coDrawId
    || (record?.coDrawPeptideIds || []).length > 1 || !!record?.mixed
}

const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Has anyone looked at this injection's site yet? */
const wasChecked = (reaction) => (reaction?.ratings || []).length > 0

/**
 * The numbers for one group of injections.
 *
 * `rows` are `{ record, reaction }`. Below the threshold only the raw counts
 * are returned — the derived figures are left null so nothing downstream can
 * show one by accident.
 */
export function statsFor(rows, min = MIN_INJECTIONS) {
  const checked = rows.filter((r) => wasChecked(r.reaction))
  const reacted = checked.filter((r) => isReaction(r.reaction))
  const base = {
    injections: rows.length,
    checked: checked.length,
    reactions: reacted.length,
  }
  if (checked.length < min) {
    return {
      ...base, status: 'insufficient', rate: null, resolved: null,
      medianDaysToResolve: null, peakSpread: null, symptoms: null,
      words: 'Not enough data yet',
    }
  }
  const times = reacted.map((r) => timeToResolve(r.reaction)).filter((d) => d != null)
  const spread = { mild: 0, moderate: 0, severe: 0 }
  const counts = {}
  for (const { reaction } of reacted) {
    const peak = peakSeverity(reaction)
    if (peak) spread[peak] += 1
    const seen = new Set()
    for (const c of checksOf(reaction)) for (const s of c.symptoms) seen.add(s)
    for (const s of seen) counts[s] = (counts[s] || 0) + 1
  }
  const order = Object.fromEntries(SYMPTOMS.map((s, i) => [s.id, i]))
  const symptoms = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || order[a[0]] - order[b[0]])
    .slice(0, 3)
    .map(([id, n]) => ({ id, label: SYMPTOMS.find((s) => s.id === id).label, reactions: n }))
  return {
    ...base, status: 'ok',
    rate: reacted.length / checked.length,
    resolved: times.length,
    medianDaysToResolve: median(times),
    peakSpread: spread,
    symptoms,
    words: null,
  }
}

const withReaction = (records, reactions) => records.map((record) => ({
  record, reaction: reactions.find((x) => x.injectionRecordId === record.id),
}))

/**
 * One row per compound.
 *
 * `clean` is the compound on its own, the only figure that may be read as being
 * about that compound. `coDraw` is every time it shared a syringe: counts only,
 * labelled as unable to isolate. `viaBlends` is the same for each blend that
 * contains it — real injections, real reactions, and none of them evidence about
 * this compound in particular.
 */
export function byPeptide({ records = [], reactions = [], peptides = [] }, min = MIN_INJECTIONS) {
  const rows = withReaction(records, reactions).filter(({ record }) => record.peptideId)
  const ids = [...new Set(rows.map(({ record }) => record.peptideId))]
  const countOnly = (list) => ({
    injections: list.length,
    checked: list.filter((r) => wasChecked(r.reaction)).length,
    reactions: list.filter((r) => wasChecked(r.reaction) && isReaction(r.reaction)).length,
  })
  const componentIds = new Set()
  for (const id of ids) for (const c of componentsOf(id, peptides)) componentIds.add(c)

  const out = []
  for (const id of new Set([...ids, ...componentIds])) {
    const mine = rows.filter(({ record }) => record.peptideId === id)
    const clean = mine.filter(({ record }) => !isCoDraw(record))
    const co = mine.filter(({ record }) => isCoDraw(record))
    const viaBlends = ids
      .filter((b) => b !== id && componentsOf(b, peptides).includes(id))
      .map((b) => ({ blendId: b, ...countOnly(rows.filter(({ record }) => record.peptideId === b)) }))
    if (!mine.length && !viaBlends.length) continue
    out.push({
      peptideId: id,
      isBlend: isBlend(id, peptides),
      components: componentsOf(id, peptides),
      clean: statsFor(clean, min),
      coDraw: co.length ? { ...countOnly(co), unableToIsolate: true } : null,
      viaBlends,
    })
  }
  return out.sort((a, b) => (b.clean.injections + (b.coDraw?.injections || 0)) - (a.clean.injections + (a.coDraw?.injections || 0))
    || a.peptideId.localeCompare(b.peptideId))
}

/** By needle gauge + length. Injections with no needle recorded are counted apart. */
export function byNeedle({ records = [], reactions = [] }, min = MIN_INJECTIONS) {
  const rows = withReaction(records, reactions)
  const groups = new Map()
  let unrecorded = 0
  for (const row of rows) {
    const key = needleKey(row.record.needle)
    if (!key) { unrecorded += 1; continue }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const list = [...groups.entries()].map(([key, list2]) => ({
    key, label: needleLabel(list2[0].record.needle), ...statsFor(list2, min),
  })).sort((a, b) => b.injections - a.injections || a.label.localeCompare(b.label))
  return { rows: list, unrecorded }
}

/** By part of the body: the pin's group. Injections with no site are counted apart. */
export function byRegion({ records = [], reactions = [] }, min = MIN_INJECTIONS) {
  const rows = withReaction(records, reactions)
  let unrecorded = 0
  const list = []
  for (const g of GROUPS) {
    const mine = rows.filter(({ record }) => record.siteGroup === g.id)
    if (mine.length) list.push({ key: g.id, label: g.label, ...statsFor(mine, min) })
  }
  unrecorded = rows.filter(({ record }) => !record.siteGroup).length
  return { rows: list.sort((a, b) => b.injections - a.injections || a.label.localeCompare(b.label)), unrecorded }
}

/** Everything the Patterns screen shows. */
export function patterns(ctx, min = MIN_INJECTIONS) {
  const rows = withReaction(ctx.records || [], ctx.reactions || [])
  return {
    min,
    totals: {
      injections: rows.length,
      checked: rows.filter((r) => wasChecked(r.reaction)).length,
      reactions: rows.filter((r) => wasChecked(r.reaction) && isReaction(r.reaction)).length,
    },
    peptides: byPeptide(ctx, min),
    needles: byNeedle(ctx, min),
    regions: byRegion(ctx, min),
  }
}
