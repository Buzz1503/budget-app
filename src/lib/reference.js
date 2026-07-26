// Pre-loaded peptide reference: evidence tier, dosing text, mechanism, effects,
// safety and monitoring. Keyed by the same compound ids as the mix matrix, so a
// peptide added from the list is enriched automatically.
//
// This is a STARTING REFERENCE, not authority. Everything stays editable, and
// "established" (evidence) is never merged with "reported" (community).
import ref from '../data/peptide_dosing_reference.json'

export const EVIDENCE_TIERS = ref.evidence_tiers
export const FIELD_NOTES = ref.field_notes
export const REFERENCE_COMPOUNDS = ref.compounds

const BY_ID = new Map(ref.compounds.map((c) => [c.id, c]))

export function referenceFor(idOrPeptide) {
  const id = typeof idOrPeptide === 'string' ? idOrPeptide : idOrPeptide?.id
  if (!id) return null
  return BY_ID.get(id) || null
}

// TX = deliberately excluded from dosing. Never pre-fill a dose for these.
export function isExcludedTier(tier) {
  return tier === 'TX'
}

export const TIER_META = {
  T1: { label: 'T1', tone: 'var(--lime)', short: 'Licensed medicine' },
  T2: { label: 'T2', tone: '#7bd94b', short: 'Human RCT data' },
  T3: { label: 'T3', tone: 'var(--amber)', short: 'Limited human data' },
  T4: { label: 'T4', tone: '#ff8a1a', short: 'Animal data only' },
  T5: { label: 'T5', tone: 'var(--coral)', short: 'Essentially no data' },
  TX: { label: 'TX', tone: 'var(--rose)', short: 'Dosing withheld' },
}

export function tierMeta(tier) {
  return TIER_META[tier] || { label: tier || '—', tone: 'var(--muted)', short: 'Unknown tier' }
}

// Confidence strings in the source range from a bare word to a whole sentence.
// Take the leading word for the chip, keep the full text as the explanation.
export function confidenceParts(confidence) {
  if (!confidence) return { word: null, detail: null }
  const trimmed = String(confidence).trim()
  const m = trimmed.match(/^([a-z-]+(?:\s[a-z]+)?)(?:\s*[-–—,;]\s*(.*))?$/i)
  if (!m) return { word: trimmed, detail: null }
  const word = m[1].trim()
  const detail = (m[2] || '').trim()
  // if the "word" is really a sentence, fall back to a generic chip
  if (word.split(/\s+/).length > 2) return { word: null, detail: trimmed }
  return { word, detail: detail || (trimmed !== word ? trimmed : null) }
}

const CONF_TONE = {
  high: 'var(--lime)', medium: 'var(--amber)', 'low-medium': 'var(--amber)',
  low: 'var(--coral)', none: 'var(--rose)', excluded: 'var(--rose)',
}
export function confidenceTone(word) {
  return CONF_TONE[String(word || '').toLowerCase()] || 'var(--muted)'
}

// The descriptive protocol text a newly added peptide inherits. Structured
// numeric fields (ladder, recon) are deliberately NOT derived — the user sets
// those. TX compounds get no dose text at all.
export function protocolTextFrom(reference) {
  if (!reference) return null
  if (isExcludedTier(reference.tier)) {
    return { doseText: '', frequencyText: '', cycleText: '', excluded: true }
  }
  return {
    doseText: reference.dose || '',
    frequencyText: reference.frequency || '',
    cycleText: reference.cycle || '',
    excluded: false,
  }
}

// Reference fields attached to a library peptide. Kept under `ref*` names so
// they can never collide with the user's own protocol values.
export function referenceAttachment(reference) {
  if (!reference) return {}
  return {
    tier: reference.tier,
    confidence: reference.confidence,
    mechanism: reference.mechanism,
    humanData: reference.human_data,
    established: reference.established || [],
    reported: reference.reported || [],
    safety: reference.safety || [],
    monitor: reference.monitor || [],
  }
}

// Enrich an existing library peptide WITHOUT touching anything the user set.
// Only fills reference metadata + descriptive text that is currently empty.
export function enrichPeptide(peptide) {
  const r = referenceFor(peptide)
  if (!r) return null
  const patch = { reference: referenceAttachment(r) }
  const text = protocolTextFrom(r)
  if (text && !text.excluded) {
    if (!peptide.doseText) patch.doseText = text.doseText
    if (!peptide.frequencyText) patch.frequencyText = text.frequencyText
    if (!peptide.cycleText) patch.cycleText = text.cycleText
  }
  return patch
}
