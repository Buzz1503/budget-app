// Real chemistry engine. Lazy-loads the ~2 MB pre-resolved pair matrix and
// serves order-independent verdict lookups. Scope: physicochemical single-syringe
// compatibility only — NOT dosing, timing, or pharmacology.

// Library peptide id → compound id in the matrix.
export const LIB_TO_COMPOUND = {
  retatrutide: 'retatrutide', selank: 'selank', semax: 'semax', kpv: 'kpv',
  ss31: 'ss31', dsip: 'dsip', motsc: 'motsc', bpc157: 'bpc157',
  ghkcu: 'ghkcu', nad: 'nad', tesamorelin: 'tesamorelin',
}

// Manufacturing-evidence blends — gold "Proven blend" seal.
export const PROVEN_BLENDS = new Set([
  key('cagrilintide', 'semaglutide'),
  key('cjc1295_nodac', 'ipamorelin'),
  key('bpc157', 'tb500'),
  key('selank', 'semax'),
])
// Single-vial proven products (their own compound id).
export const PROVEN_PRODUCTS = new Set(['glow', 'klow'])

export function key(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join('|')
}

export const VERDICT_META = {
  MIX: { label: 'Safe to mix', short: 'Mix', tone: 'lime', icon: 'Check' },
  CAUTION: { label: 'Mix with caution', short: 'Caution', tone: 'amber', icon: 'ShieldAlert' },
  DONT_MIX: { label: "Don't mix", short: "Don't", tone: 'coral', icon: 'X' },
  NEVER: { label: 'Never co-administer', short: 'Never', tone: 'rose', icon: 'Ban' },
}

// Reason code → reaction-chamber animation flavor + a short teaching caption.
const REASON_FX = {
  R00: { fx: 'blend', teach: 'Clean merge — compatible vehicles, charge and residues.' },
  R01: { fx: 'gel', teach: 'Opposite charges complex into a stringy gel (coacervate).' },
  R02: { fx: 'precipitate', teach: 'pH/vehicle clash — one component drops out of solution.' },
  R03: { fx: 'copperOxidise', teach: 'Copper oxidises the partner — colour shifts, potency lost.' },
  R04: { fx: 'copperReduce', teach: 'Thiol strips the copper — the blue complex decolourises and drops.' },
  R05: { fx: 'clump', teach: 'Disulfide scrambling cross-links and clumps the peptides.' },
  R06: { fx: 'haze', teach: 'An aggregation-prone partner seeds fibrils — cloudy haze.' },
  R07: { fx: 'cosolvent', teach: 'Needs DMSO/organic solvent — crashes on dilution into water.' },
  R08: { fx: 'denature', teach: 'Large/glycosylated protein — excipients shear-denature on mixing.' },
  R09: { fx: 'precipitate', teach: 'Ionic-strength / osmolarity mismatch salts the peptide out.' },
  R10: { fx: 'redox', teach: 'Redox-active cofactor (B12/NAD⁺) degrades its partner.' },
  R11: { fx: 'clump', teach: 'Acidic vehicle rapidly deamidates a GHRH analogue.' },
  R12: { fx: 'haze', teach: 'Surface-active / protease-labile — adsorbs and degrades fast.' },
  R13: { fx: 'forbidden', teach: 'Different route or tissue plane — not a co-administration product.' },
}

export function reasonFx(code) {
  return REASON_FX[code] || { fx: 'react', teach: '' }
}

// ---- lazy singleton loader ----
let _promise = null

export function loadMatrix() {
  if (!_promise) {
    _promise = import('../data/peptide_mix_matrix.json')
      .then((mod) => build(mod.default || mod))
      .catch((e) => { _promise = null; throw e })
  }
  return _promise
}

function build(raw) {
  const index = new Map()
  for (const p of raw.pairs) index.set(key(p.peptide_a_id, p.peptide_b_id), p)
  const compounds = raw.compounds.slice().sort((a, b) => a.name.localeCompare(b.name))
  const byId = new Map(compounds.map((c) => [c.id, c]))
  const classes = raw.classes // { CLASS: description }
  return {
    reasonCodes: raw.reason_codes,
    classes,
    compounds,
    byId,
    scope: raw.scope,
    lookup(idA, idB) {
      if (idA === idB) return null
      return index.get(key(idA, idB)) || null
    },
    isProven(idA, idB) {
      return PROVEN_BLENDS.has(key(idA, idB))
    },
  }
}

// Stable, distinct liquid colour per compound (hashed hue). Copper compounds
// read blue, GLP-1s read teal, etc., but every id gets a consistent tint.
const CLASS_HUE = { COPPER: 205, GLP1: 168, AMYLIN: 150, GHRH: 275, GHRP: 300, MITO: 30, HEALING: 95, NOOTROPIC: 250, SLEEP: 225, MELANOCORTIN: 20, NAD: 320 }
export function compoundColor(compound) {
  if (!compound) return 'hsl(200 60% 55%)'
  let hue = CLASS_HUE[compound.class]
  if (hue == null) {
    let h = 0
    for (const ch of compound.id) h = (h * 31 + ch.charCodeAt(0)) % 360
    hue = h
  }
  return `hsl(${hue} 70% 58%)`
}

export function confidenceFor(idA, idB) {
  if (PROVEN_BLENDS.has(key(idA, idB))) {
    return { level: 'proven', label: 'Proven blend', detail: 'Backed by manufacturing evidence.' }
  }
  return { level: 'model', label: 'Chemistry model', detail: 'Physicochemical prediction — not proof of compatibility.' }
}
