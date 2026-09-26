/**
 * What to call a compound when there is not much room.
 *
 * Catalogue names carry their whole composition — "KLOW (BPC-157 + GHK-Cu +
 * TB-500 + KPV)" — which is the right name on a page about the compound and
 * the wrong one in a list, where it truncates to "KLOW (BPC-157 + GHK…" and
 * tells you less than the four letters in front of it would have.
 *
 * An explicit `shortName` always wins. Failing that a short one is derived, and
 * the derivation is deliberately timid: it only drops a trailing parenthetical
 * or an explicit blend spell-out, because anything cleverer starts inventing
 * abbreviations for compounds whose names are already abbreviations.
 */

// "KLOW (BPC-157 + GHK-Cu)" → "KLOW"; "CJC-1295 with DAC" is left alone.
export function autoShortName(name) {
  const full = String(name || '').trim()
  if (!full) return ''
  const withoutParens = full.replace(/\s*\([^)]*\)\s*$/, '').trim()
  // "Selank + Semax blend" says something a single word would lose, so a name
  // that is only a composition keeps it.
  const head = withoutParens.split(/\s+\+\s+/)[0].trim()
  const candidate = head.length >= 3 ? head : withoutParens
  return candidate || full
}

/** The name to print in a list. */
export function displayName(peptide) {
  if (!peptide) return ''
  const explicit = String(peptide.shortName || '').trim()
  if (explicit) return explicit
  return autoShortName(peptide.name)
}

/** True when the short name hides something, so the full one is worth showing. */
export function hasLongerName(peptide) {
  if (!peptide) return false
  return displayName(peptide) !== String(peptide.name || '').trim()
}
