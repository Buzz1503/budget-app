/**
 * A two-or-three letter code and a colour for every compound.
 *
 * A pin on the map is 18 px across. There is no room on it for "Retatrutide",
 * and no room beside it for a legend entry per shot, so each compound gets a
 * code short enough to sit under a pin and a colour distinct enough to be read
 * without one. Both are stored on the peptide so the user can change them: an
 * auto-generated code is a starting point, not a decision.
 */

/**
 * Eight hues that stay apart on a dark background.
 *
 * Chosen for separation in both hue and lightness, so they remain
 * distinguishable to the most common forms of colour blindness — the codes are
 * there precisely because colour alone is never enough.
 */
export const SITE_COLOURS = [
  { id: 'cyan', hex: '#38BDF8', label: 'Cyan' },
  { id: 'lime', hex: '#A3E635', label: 'Lime' },
  { id: 'amber', hex: '#FBBF24', label: 'Amber' },
  { id: 'rose', hex: '#FB7185', label: 'Rose' },
  { id: 'violet', hex: '#A78BFA', label: 'Violet' },
  { id: 'teal', hex: '#2DD4BF', label: 'Teal' },
  { id: 'orange', hex: '#FB923C', label: 'Orange' },
  { id: 'pink', hex: '#F472B6', label: 'Pink' },
]
export const COLOUR_BY_ID = Object.fromEntries(SITE_COLOURS.map((c) => [c.id, c]))

export function colourHex(peptide) {
  return COLOUR_BY_ID[peptide?.colour]?.hex || SITE_COLOURS[0].hex
}

/**
 * A code from a name, before anybody has picked one.
 *
 * Hyphenated and mixed-case names are where the obvious approach falls over:
 * "GHK-Cu" wants GHK, not GHK-, and "MOTS-c" wants MOT rather than MOTSC. So
 * the leading run of letters and digits is taken first, and only a name too
 * short for that falls back to squashing the whole thing.
 */
export function autoCode(name = '') {
  const clean = String(name).trim()
  if (!clean) return '?'
  const first = clean.match(/[A-Za-z0-9]+/)?.[0] || clean
  const base = first.length >= 3 ? first.slice(0, 3) : clean.replace(/[^A-Za-z0-9]/g, '').slice(0, 3)
  return (base || '?').toUpperCase()
}

/**
 * Codes for a whole library, kept unique.
 *
 * Two compounds resolving to the same three letters is the normal case, not the
 * edge case — a map with two pins both reading "GLY" is worse than useless. The
 * clash is broken by walking the rest of the name for a letter that has not
 * been used yet, and only then by numbering.
 */
export function assignCodes(peptides = []) {
  const taken = new Set()
  const out = {}
  // anything the user has already chosen wins, and is claimed first
  for (const p of peptides) {
    const explicit = String(p.code || '').trim().toUpperCase()
    if (explicit && !taken.has(explicit)) { taken.add(explicit); out[p.id] = explicit }
  }
  for (const p of peptides) {
    if (out[p.id]) continue
    let code = autoCode(p.name)
    if (taken.has(code)) {
      const letters = String(p.name).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      let found = null
      for (let i = 2; i < letters.length; i++) {
        const cand = (code.slice(0, 2) + letters[i]).toUpperCase()
        if (!taken.has(cand)) { found = cand; break }
      }
      code = found || nextNumbered(code, taken)
    }
    taken.add(code)
    out[p.id] = code
  }
  return out
}

function nextNumbered(code, taken) {
  const stem = code.slice(0, 2)
  for (let n = 2; n < 10; n++) {
    const cand = `${stem}${n}`
    if (!taken.has(cand)) return cand
  }
  return code
}

/** Colours dealt round the palette so neighbours in the list differ. */
export function assignColours(peptides = []) {
  const out = {}
  const used = new Set()
  for (const p of peptides) {
    if (p.colour && COLOUR_BY_ID[p.colour] && !used.has(p.colour)) {
      out[p.id] = p.colour
      used.add(p.colour)
    }
  }
  let i = 0
  for (const p of peptides) {
    if (out[p.id]) continue
    // the palette is smaller than a big library, so it wraps rather than
    // running out — a repeat far down the list beats no colour at all
    while (used.has(SITE_COLOURS[i % SITE_COLOURS.length].id) && used.size < SITE_COLOURS.length) i++
    const colour = SITE_COLOURS[i % SITE_COLOURS.length].id
    out[p.id] = colour
    used.add(colour)
    i++
  }
  return out
}

/** Fill in code and colour for a library that has neither. Nothing else moves. */
export function withIdentity(peptides = []) {
  const codes = assignCodes(peptides)
  const colours = assignColours(peptides)
  return peptides.map((p) => ({ ...p, code: p.code || codes[p.id], colour: p.colour || colours[p.id] }))
}
