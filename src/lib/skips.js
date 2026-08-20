// Skipped doses.
//
// A skip is an explicit decision not to take something today — travelling, out
// of stock, feeling rough, whatever. It is deliberately not the same as a miss:
// a miss is an absence of information, a skip is information. So it gets its
// own record rather than being inferred from a gap, and adherence reports it as
// its own category instead of folding it into either "taken" or "missed".
//
// Nothing about a skip touches inventory. Nothing was drawn, so nothing was
// used, so no vial moves.

export const SKIP_REASONS = [
  { id: 'travel', label: 'Travelling' },
  { id: 'stock', label: 'Out of stock' },
  { id: 'unwell', label: 'Feeling off' },
  { id: 'site', label: 'No good site' },
  { id: 'choice', label: 'Chose to skip' },
]
export const REASON_LABEL = Object.fromEntries(SKIP_REASONS.map((r) => [r.id, r.label]))

/** Was this peptide skipped on this date? */
export function isSkipped(skips = [], peptideId, dateStr) {
  return skips.some((k) => k.kind === 'peptide' && k.peptideId === peptideId && k.date === dateStr)
}

/** Was this supplement skipped on this date? */
export function isSupplementSkipped(skips = [], supplementId, dateStr) {
  return skips.some((k) => k.kind === 'supplement' && k.supplementId === supplementId && k.date === dateStr)
}

/** The peptide ids skipped on a date, as a set for cheap lookups in a list. */
export function skippedOn(skips = [], dateStr) {
  return new Set(
    skips.filter((k) => k.kind === 'peptide' && k.date === dateStr).map((k) => k.peptideId)
  )
}

/** The supplement ids skipped on a date. */
export function supplementsSkippedOn(skips = [], dateStr) {
  return new Set(
    skips.filter((k) => k.kind === 'supplement' && k.date === dateStr).map((k) => k.supplementId)
  )
}

/** The skip record itself, when the reason or the time matters. */
export function skipFor(skips = [], peptideId, dateStr) {
  return skips.find((k) => k.kind === 'peptide' && k.peptideId === peptideId && k.date === dateStr) || null
}

/**
 * Adherence with skips separated out.
 *
 * Two rates, because they answer different questions. `pct` is the honest
 * headline: of everything that was scheduled, how much went in. `ofAttempted`
 * sets the skipped ones aside and asks how well the remainder was kept — which
 * is the fairer read of a week you deliberately paused, and the reason a skip
 * should not read as a failure.
 */
export function splitAdherence({ scheduled = 0, taken = 0, skipped = 0 }) {
  const attempted = Math.max(0, scheduled - skipped)
  const missed = Math.max(0, attempted - taken)
  return {
    scheduled,
    taken,
    skipped,
    missed,
    attempted,
    pct: scheduled === 0 ? null : Math.round((taken / scheduled) * 100),
    ofAttempted: attempted === 0 ? null : Math.round((taken / attempted) * 100),
  }
}

/** How a day reads once skips are accounted for. */
export function dayOutcome({ scheduled = 0, taken = 0, skipped = 0, isFuture = false, isToday = false }) {
  if (scheduled === 0) return 'none'
  if (taken === scheduled) return 'all'
  // A day you deliberately cleared is not a lapse, so it never reads as missed.
  if (skipped > 0 && taken + skipped === scheduled) return taken > 0 ? 'partial-skipped' : 'skipped'
  if (isFuture) return 'future'
  if (isToday) return taken === 0 ? 'pending' : 'partial'
  return taken === 0 ? 'missed' : 'partial'
}

/** Skips in a window, newest first, for the history list. */
export function skipsInRange(skips = [], fromStr, toStr) {
  return skips
    .filter((k) => (!fromStr || k.date >= fromStr) && (!toStr || k.date <= toStr))
    .sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date)))
}

/** Count of skips per peptide in a window, for the per-compound rows. */
export function skipCounts(skips = [], fromStr, toStr) {
  const out = {}
  for (const k of skipsInRange(skips, fromStr, toStr)) {
    const key = k.kind === 'supplement' ? k.supplementId : k.peptideId
    if (!key) continue
    out[key] = (out[key] || 0) + 1
  }
  return out
}
