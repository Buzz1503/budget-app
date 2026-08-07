// Which compound in the stack might be behind a symptom.
//
// This is a ranking, not a diagnosis. It answers "given what I'm running and
// when I started it, which of these is the most likely suspect" — and it says
// out loud that on a multi-compound stack more than one thing can contribute.
//
// Scoring is timing-first on purpose. The single most informative fact about a
// new symptom is what changed recently: a compound started or stepped up in the
// last few weeks is a better suspect than one you've cruised on for months,
// even if the older one has stronger published evidence for that effect.
import DATA from '../data/peptide_side_effects.json'
import { addDaysStr, daysBetween, cycleInfo } from './schedule'

export const SIDE_EFFECT_NOTE = DATA.note
export const SYMPTOM_META = DATA.symptoms
export const EFFECT_COMPOUNDS = DATA.compounds

// Library peptide id → side-effect compound id. The compound ids in this data
// set were chosen to match the mix-matrix ids, so almost everything maps to
// itself; only the app's own oil injectable needs an alias.
export const LIB_TO_EFFECT = { 'testosterone-e': 'teste' }

export function effectIdFor(peptideId) {
  const id = LIB_TO_EFFECT[peptideId] || peptideId
  return EFFECT_COMPOUNDS[id] ? id : null
}

export function compoundEffects(peptideId) {
  const id = effectIdFor(peptideId)
  return id ? EFFECT_COMPOUNDS[id] : null
}

// Evidence tiers mirror the dosing reference: T1 is a well-established effect,
// T5 is one person on a forum.
export const TIER_WEIGHT = { T1: 1, T2: 0.85, T3: 0.65, T4: 0.45, T5: 0.3 }
export const TIER_WORDS = {
  T1: 'Well established', T2: 'Good evidence', T3: 'Mixed evidence',
  T4: 'Mostly reported', T5: 'Anecdotal only',
}

export function tierWeight(tier) {
  return TIER_WEIGHT[tier] ?? 0.4
}

// A small icon per symptom so the chips read at a glance. Purely decorative —
// the plain-language label from the data is what carries the meaning.
const ICONS = {
  nausea: '🤢', vomiting: '🤮', diarrhea: '🚽', constipation: '🧱', appetite_loss: '🍽️',
  fatigue: '🥱', flushing: '🥵', inj_reaction: '💉', inj_pain: '💉', skin_staining: '🎨',
  water_retention: '💧', edema: '🦶', joint_pain: '🦵', high_glucose: '🍬', tingling: '⚡',
  numbness: '🖐️', raised_hr: '💓', head_rush: '💫', headache: '🤕', mole_change: '🔎',
  freckling: '🟤', priapism: '🍆', bp_change: '🩸', acne: '🧴', hair_loss: '💇',
  body_hair: '🧔', gyno: '🎈', testicular_atrophy: '🥜', low_fertility: '🧬', high_hct: '🩸',
  mood_swings: '🌪️', aggression: '😠', anxiety: '😰', low_mood: '🌧️', sleep_apnea: '😮‍💨',
  night_sweats: '💦', insomnia: '👀', grogginess: '🌫️', nasal_irritation: '👃',
  chest_tightness: '🫁', estradiol_up: '📈', copper_load: '🟠', head_pressure: '🧠',
  energy_up: '⚡', clarity: '🎯', endurance: '🏃', reduced_anxiety: '🧘', better_sleep: '😴',
  recovery: '🔧', less_joint_pain: '🦵', gut_relief: '🌿', skin_quality: '✨', hair_quality: '💇',
  fat_loss: '📉', visceral_fat: '🫃', appetite_suppression: '🥗', satiety: '🍽️',
  muscle_strength: '💪', libido_up: '🔥', mood_up: '😄', immune: '🛡️', tanning: '🏖️',
  warmth: '🔥', wellbeing: '🌤️', verbal: '🗣️', metabolic: '🔄',
}

export function symptomIcon(id) {
  return ICONS[id] || '•'
}

export function symptomLabel(id) {
  return SYMPTOM_META[id]?.label || id
}

/**
 * Categories, so 66 symptoms read as ten short lists instead of one wall.
 * Every symptom belongs to exactly one; `other` catches anything unmapped so a
 * future data addition can never silently vanish from the UI.
 */
export const CATEGORIES = [
  { id: 'sleep', label: 'Sleep', icon: 'Moon' },
  { id: 'energy', label: 'Energy', icon: 'Zap' },
  { id: 'mood', label: 'Mood', icon: 'Smile' },
  { id: 'cognition', label: 'Cognition', icon: 'Brain' },
  { id: 'skin', label: 'Skin & hair', icon: 'Sparkles' },
  { id: 'gut', label: 'Gut', icon: 'Soup' },
  { id: 'hormonal', label: 'Hormonal', icon: 'Activity' },
  { id: 'cardio', label: 'Cardio & blood', icon: 'HeartPulse' },
  { id: 'injection', label: 'Injection site', icon: 'Syringe' },
  { id: 'other', label: 'Other', icon: 'CircleDot' },
]
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]))

const CATEGORY_OF = {
  // sleep
  insomnia: 'sleep', grogginess: 'sleep', sleep_apnea: 'sleep', night_sweats: 'sleep',
  better_sleep: 'sleep',
  // energy
  fatigue: 'energy', energy_up: 'energy', endurance: 'energy', warmth: 'energy',
  metabolic: 'energy', flushing: 'energy',
  // mood
  mood_swings: 'mood', aggression: 'mood', anxiety: 'mood', low_mood: 'mood',
  reduced_anxiety: 'mood', mood_up: 'mood', wellbeing: 'mood',
  // cognition
  clarity: 'cognition', verbal: 'cognition', headache: 'cognition',
  head_pressure: 'cognition', head_rush: 'cognition',
  // skin & hair
  acne: 'skin', hair_loss: 'skin', body_hair: 'skin', mole_change: 'skin',
  freckling: 'skin', skin_quality: 'skin', hair_quality: 'skin', tanning: 'skin',
  tingling: 'skin', numbness: 'skin',
  // gut
  nausea: 'gut', vomiting: 'gut', diarrhea: 'gut', constipation: 'gut',
  appetite_loss: 'gut', gut_relief: 'gut', appetite_suppression: 'gut', satiety: 'gut',
  // hormonal
  gyno: 'hormonal', testicular_atrophy: 'hormonal', low_fertility: 'hormonal',
  estradiol_up: 'hormonal', libido_up: 'hormonal', priapism: 'hormonal',
  muscle_strength: 'hormonal', fat_loss: 'hormonal', visceral_fat: 'hormonal',
  water_retention: 'hormonal', edema: 'hormonal', high_glucose: 'hormonal',
  // cardio & blood
  raised_hr: 'cardio', bp_change: 'cardio', high_hct: 'cardio',
  chest_tightness: 'cardio', copper_load: 'cardio',
  // injection site
  inj_reaction: 'injection', inj_pain: 'injection', skin_staining: 'injection',
  nasal_irritation: 'injection',
  // other
  joint_pain: 'other', less_joint_pain: 'other', recovery: 'other', immune: 'other',
}

export function categoryOf(symptomId) {
  return CATEGORY_OF[symptomId] || 'other'
}

/**
 * How distinctive a symptom is across the whole data set. Nausea is claimed by
 * half the catalogue and says little; skin staining points at one compound.
 * Computed once, since the data set is static.
 */
const CLAIMED_BY = (() => {
  const counts = {}
  for (const c of Object.values(EFFECT_COMPOUNDS)) {
    for (const s of [...(c.positive || []), ...(c.negative || [])]) {
      counts[s] = (counts[s] || 0) + 1
    }
  }
  return counts
})()

export function distinctiveness(symptomId) {
  const n = CLAIMED_BY[symptomId] || 1
  return 1 / Math.sqrt(n)
}

/**
 * The symptoms worth offering, given what's actually in the stack: the union of
 * every positive and negative effect across the mapped compounds, grouped by
 * type. Showing the full 66-symptom catalogue to someone running five things
 * would bury the handful that could plausibly apply to them.
 */
export function stackSymptoms(peptides = []) {
  const pos = new Set()
  const neg = new Set()
  for (const p of peptides) {
    const eff = compoundEffects(p.id)
    if (!eff) continue
    for (const s of eff.positive || []) if (SYMPTOM_META[s]) pos.add(s)
    for (const s of eff.negative || []) if (SYMPTOM_META[s]) neg.add(s)
  }
  const build = (set, polarity) => [...set]
    .map((id) => ({ id, label: symptomLabel(id), icon: symptomIcon(id), polarity }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return { positive: build(pos, 'pos'), negative: build(neg, 'neg') }
}

/** Flat lookup for anything that needs a label/polarity by id. */
export function stackSymptomIndex(peptides = []) {
  const { positive, negative } = stackSymptoms(peptides)
  return Object.fromEntries([...positive, ...negative].map((s) => [s.id, s]))
}

/**
 * The stack's symptoms, bucketed into categories, for one polarity.
 * Empty categories are dropped — an accordion of nothing is worse than no
 * accordion.
 */
export function groupedStackSymptoms(peptides = [], polarity = 'neg') {
  const { positive, negative } = stackSymptoms(peptides)
  const list = polarity === 'pos' ? positive : negative
  const byCat = new Map()
  for (const s of list) {
    const cat = categoryOf(s.id)
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat).push({ ...s, category: cat })
  }
  return CATEGORIES
    .filter((c) => byCat.has(c.id))
    .map((c) => ({ ...c, symptoms: byCat.get(c.id) }))
}

/** Substring match over the plain labels — what the search box filters on. */
export function searchStackSymptoms(peptides = [], query = '') {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const { positive, negative } = stackSymptoms(peptides)
  return [...positive, ...negative]
    .filter((s) => s.label.toLowerCase().includes(q))
    .map((s) => ({ ...s, category: categoryOf(s.id) }))
    .sort((a, b) => {
      // a label that starts with the query is the better match
      const as = a.label.toLowerCase().startsWith(q) ? 0 : 1
      const bs = b.label.toLowerCase().startsWith(q) ? 0 : 1
      return as - bs || a.label.localeCompare(b.label)
    })
}

/**
 * "Likely for you right now": the handful of symptoms most worth offering,
 * ranked by the same timing-weighted scoring the attribution uses — so a
 * compound started or stepped up in the last three weeks pushes its own effects
 * to the top of the list, which is exactly when you want them one tap away.
 */
export function likelyNow(ctx, { limit = 6, polarity = null } = {}) {
  const { peptides = [] } = ctx
  const { positive, negative } = stackSymptoms(peptides)
  const pool = polarity === 'pos' ? positive : polarity === 'neg' ? negative : [...positive, ...negative]

  const scored = pool.map((s) => {
    const result = attributeSymptom(s.id, ctx)
    return { ...s, category: categoryOf(s.id), score: result.top?.score || 0, top: result.top }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit)
}

/** The symptom ids logged most recently, newest first, for one-tap re-logging. */
export function recentlyLogged(symptomLogs = [], { limit = 6, exclude = new Set() } = {}) {
  const seen = []
  const have = new Set()
  const sorted = [...symptomLogs].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  for (const log of sorted) {
    for (const tag of log.tags || []) {
      if (have.has(tag.id) || exclude.has(tag.id)) continue
      have.add(tag.id)
      seen.push({
        id: tag.id,
        label: SYMPTOM_META[tag.id]?.label || tag.label || tag.id,
        polarity: tag.polarity || SYMPTOM_META[tag.id]?.type || 'neg',
        category: categoryOf(tag.id),
        lastDate: log.date,
      })
      if (seen.length >= limit) return seen
    }
  }
  return seen
}

// ---------- scoring ----------

export const RECENCY_WINDOW = 21 // days — "recently started or up-dosed"

// Weights. Recency dominates by design; see the note at the top of the file.
export const WEIGHTS = { recency: 0.5, proximity: 0.25, evidence: 0.25 }

/**
 * When this compound last *changed* — started, or stepped up a rung. Both are
 * the kind of change that brings a new symptom with it.
 */
export function lastChange(peptide, tState) {
  const dates = [peptide.startDate, tState?.levelStartDate].filter(Boolean)
  if (!dates.length) return null
  return dates.sort().at(-1)
}

/** 1.0 the day of a change, tapering to 0 at the edge of the window. */
export function recencyScore(changeDate, todayStr) {
  if (!changeDate) return 0
  const d = daysBetween(changeDate, todayStr)
  if (d < 0) return 0 // hasn't started yet
  if (d >= RECENCY_WINDOW) return 0
  return 1 - d / RECENCY_WINDOW
}

/** How close the last actual dose was to now. Dosed today is the strong case. */
export function proximityScore(peptide, doseLogs, todayStr) {
  let last = null
  for (const l of doseLogs) {
    if (l.peptideId !== peptide.id) continue
    if (l.date > todayStr) continue
    if (!last || l.date > last) last = l.date
  }
  if (!last) {
    // never logged: fall back to whether it's even running right now, so a
    // freshly added compound isn't scored as though it were dormant
    return cycleInfo(peptide, todayStr).isOn ? 0.35 : 0
  }
  const d = daysBetween(last, todayStr)
  if (d <= 0) return 1
  if (d === 1) return 0.75
  if (d <= 3) return 0.5
  if (d <= 7) return 0.3
  if (d <= 14) return 0.15
  return 0.05
}

export const LIKELIHOOD = ['High', 'Medium', 'Low']

/** Relative to the strongest candidate, never absolute — the top is always High. */
export function likelihoodFor(score, topScore) {
  if (topScore <= 0) return 'Low'
  const ratio = score / topScore
  if (ratio >= 0.75) return 'High'
  if (ratio >= 0.45) return 'Medium'
  return 'Low'
}

export const LIKELIHOOD_TONE = { High: 'var(--coral)', Medium: 'var(--amber)', Low: 'var(--muted)' }

/**
 * Rank the stack compounds that list this symptom.
 *
 * @returns {{ symptomId, label, polarity, top, others, candidates, caveat }}
 *   `top` is null when nothing in the stack claims this symptom — which is a
 *   real answer, not a failure: it means none of what you're running is a
 *   known cause.
 */
export function attributeSymptom(symptomId, { peptides = [], titration = {}, doseLogs = [], todayStr }) {
  const meta = SYMPTOM_META[symptomId]
  const polarity = meta?.type || 'neg'
  const distinct = distinctiveness(symptomId)

  const candidates = []
  for (const p of peptides) {
    const eff = compoundEffects(p.id)
    if (!eff) continue
    const listed = [...(eff.positive || []), ...(eff.negative || [])].includes(symptomId)
    if (!listed) continue

    const changed = lastChange(p, titration[p.id])
    const daysSinceChange = changed ? daysBetween(changed, todayStr) : null
    const recency = recencyScore(changed, todayStr)
    const proximity = proximityScore(p, doseLogs, todayStr)
    const evidence = tierWeight(eff.tier) * distinct

    const score = WEIGHTS.recency * recency
      + WEIGHTS.proximity * proximity
      + WEIGHTS.evidence * evidence

    candidates.push({
      peptideId: p.id,
      effectId: effectIdFor(p.id),
      name: p.name,
      tier: eff.tier,
      tierWords: TIER_WORDS[eff.tier] || 'Unrated',
      score: Math.round(score * 1e4) / 1e4,
      recency: Math.round(recency * 100) / 100,
      proximity: Math.round(proximity * 100) / 100,
      evidence: Math.round(evidence * 100) / 100,
      daysSinceChange,
      recentChange: recency > 0,
      reasons: reasonsFor({ daysSinceChange, recency, proximity, tier: eff.tier, distinct }),
    })
  }

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const topScore = candidates[0]?.score || 0
  for (const c of candidates) c.likelihood = likelihoodFor(c.score, topScore)

  return {
    symptomId,
    label: symptomLabel(symptomId),
    icon: symptomIcon(symptomId),
    polarity,
    top: candidates[0] || null,
    others: candidates.slice(1),
    candidates,
    multiple: candidates.length > 1,
  }
}

/** Short, plain reasons for why a candidate ranked where it did. */
export function reasonsFor({ daysSinceChange, recency, proximity, tier, distinct }) {
  const out = []
  if (recency > 0 && daysSinceChange != null) {
    out.push(daysSinceChange === 0
      ? 'started or stepped up today'
      : `started or stepped up ${daysSinceChange} day${daysSinceChange === 1 ? '' : 's'} ago`)
  }
  if (proximity >= 1) out.push('dosed today')
  else if (proximity >= 0.75) out.push('dosed yesterday')
  else if (proximity >= 0.5) out.push('dosed in the last few days')
  else if (proximity > 0 && proximity < 0.3) out.push('not dosed recently')
  out.push(`${tier} · ${(TIER_WORDS[tier] || 'unrated').toLowerCase()}`)
  // "distinctive" has to mean something: at most two compounds in the whole
  // catalogue claim it (1/√2 ≈ 0.71). Fatigue, which half the list claims,
  // doesn't qualify.
  if (distinct >= 0.7) out.push('a distinctive effect for this compound')
  return out
}

export const ATTRIBUTION_CAVEAT =
  'These are candidates, not a diagnosis. On a multi-compound stack more than one thing can contribute — and something outside your stack can too.'

/** Attribute a whole batch of just-selected symptoms in one pass. */
export function attributeAll(symptomIds, ctx) {
  return symptomIds.map((id) => attributeSymptom(id, ctx))
}

/**
 * The compact snapshot stored on a log entry, so the history shows what was
 * true when it was logged rather than re-ranking against a stack that has since
 * changed.
 */
export function attributionSnapshot(result) {
  if (!result?.top) return null
  return {
    top: { peptideId: result.top.peptideId, name: result.top.name, tier: result.top.tier, likelihood: result.top.likelihood },
    others: result.others.slice(0, 4).map((c) => ({
      peptideId: c.peptideId, name: c.name, tier: c.tier, likelihood: c.likelihood,
    })),
  }
}
