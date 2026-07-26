// "Right Now" phase engine — maps cycle position + titration level to a felt
// phase and an anecdotal, non-promissory narrative of what a peptide is doing.
import { cycleInfo, currentRung, daysBetween } from './schedule'

export const PHASES = {
  Loading: { label: 'Loading', color: 'var(--amber)', order: 0, blurb: 'Building tissue levels' },
  Building: { label: 'Building', color: 'var(--indigo)', order: 1, blurb: 'Effects ramping up' },
  Peak: { label: 'Peak', color: 'var(--lime)', order: 2, blurb: 'Strongest effect window' },
  Maintenance: { label: 'Maintenance', color: 'var(--violet)', order: 3, blurb: 'Holding steady' },
  Off: { label: 'Off cycle', color: 'var(--muted)', order: 4, blurb: 'Resting / washout' },
}
export const PHASE_ORDER = ['Loading', 'Building', 'Peak', 'Maintenance']

// Editable, anecdotal — NOT clinical promises. Phase-aware effect copy per peptide.
export const NARRATIVES = {
  retatrutide: {
    tagline: 'Appetite & glucose control', tempo: 'cumulative',
    Loading: 'Low starting rung — appetite effect is mild while your body adjusts and side-effects settle.',
    Building: 'Appetite suppression is climbing week over week; each titration rung deepens the effect.',
    Peak: 'Strongest appetite and glucose control — cravings blunted, satiety high.',
    Maintenance: 'Effect is holding at your current rung; steady appetite control.',
    off: 'Not currently dosing — appetite gradually returns to baseline.',
  },
  selank: {
    tagline: 'Calm, anxiolytic focus', tempo: 'per-dose',
    Loading: 'Acts per dose — expect a calm, clear headspace within an hour of injecting.',
    Building: 'Per-dose calm continues; some report a smoother baseline mood across the week.',
    Peak: 'Reliable daily calm and focus — this is the steady middle of your run.',
    Maintenance: 'Consistent anxiolytic effect; winding toward the cycle break.',
    off: 'Off cycle — the per-dose calm effect is not active today.',
  },
  semax: {
    tagline: 'Cognitive drive / BDNF', tempo: 'cumulative',
    Loading: 'Early days — a subtle lift in focus per dose; the cumulative BDNF effect is just starting.',
    Building: 'Cognitive drive builds over 2–3 weeks — sharper focus and verbal fluency for many.',
    Peak: 'Peak nootropic window — motivation and mental stamina at their strongest.',
    Maintenance: 'Cognitive benefits holding steady near the end of the block.',
    off: 'Off cycle — cognitive effects taper back toward baseline.',
  },
  kpv: {
    tagline: 'Anti-inflammatory / gut barrier', tempo: 'cumulative',
    Loading: 'Anti-inflammatory action begins; gut-barrier support builds over the first 1–2 weeks.',
    Building: 'Systemic inflammation easing for many; gut comfort improving.',
    Peak: 'Strongest anti-inflammatory window — calmest gut and skin.',
    Maintenance: 'Benefits holding; approaching the cycle break.',
    off: 'Off cycle — anti-inflammatory support paused.',
  },
  ss31: {
    tagline: 'Mitochondrial ROS reduction', tempo: 'cumulative',
    Loading: 'Mitochondrial support ramping; cellular-energy effects are cumulative, not instant.',
    Building: 'Many report steadier energy and recovery as mitochondrial ROS drops week over week.',
    Peak: 'Peak cellular-energy window — best endurance and recovery.',
    Maintenance: 'Energy benefits holding steady toward the rest phase.',
    off: 'Off cycle — mitochondrial support in washout.',
  },
  dsip: {
    tagline: 'Deep-sleep support', tempo: 'per-dose',
    Loading: 'Acts per dose the night you inject — deeper sleep onset within 30–60 min for many.',
    Building: 'Nightly deep-sleep support continues; short courses work best.',
    Peak: 'Reliable deep-sleep window — this is the heart of a short DSIP course.',
    Maintenance: 'Deep-sleep effect holding; wrap the short course soon.',
    off: 'Off cycle — no DSIP tonight; a washout keeps it effective.',
  },
  motsc: {
    tagline: 'AMPK / exercise-mimetic', tempo: 'per-dose',
    Loading: 'Fat-oxidation and endurance window opens per dose — best taken pre-cardio.',
    Building: 'Daily AMPK activation; many notice improved endurance and fat use.',
    Peak: 'Peak exercise-mimetic effect — strongest endurance and fat-oxidation window.',
    Maintenance: 'Metabolic benefits steady heading into the break.',
    off: 'Off cycle — the exercise-mimetic effect is paused.',
  },
  bpc157: {
    tagline: 'Tendon / gut / soft-tissue repair', tempo: 'cumulative',
    Loading: 'Repair signaling begins; tissue and gut benefits ramp over the coming weeks.',
    Building: 'Soft-tissue and gut repair building — many notice reduced nagging pain.',
    Peak: 'Peak repair window — best soft-tissue and gut recovery.',
    Maintenance: 'Repair benefits holding steady near the end of the block.',
    off: 'Off cycle — repair signaling tapering.',
  },
  ghkcu: {
    tagline: 'Skin / collagen remodeling', tempo: 'cumulative',
    Loading: 'Early remodeling phase — collagen effects take weeks; escalation is planned at day 15.',
    Building: 'Skin remodeling accelerating (post day-15 escalation) — firmness and tone improving for many.',
    Peak: 'Peak collagen-remodeling window — best skin quality changes.',
    Maintenance: 'Skin benefits consolidating toward the rest phase.',
    off: 'Off cycle — collagen remodeling in a rest window.',
  },
  nad: {
    tagline: 'NAD⁺ repletion / cellular energy', tempo: 'cumulative',
    Loading: 'Low rung eases the classic NAD⁺ flush/side-effects; repletion is just starting.',
    Building: 'NAD⁺ stores building; many report clearer energy as the dose climbs.',
    Peak: 'Peak cellular-energy window — strongest NAD⁺ repletion effect.',
    Maintenance: 'Energy benefits holding at your titrated dose.',
    off: 'Not dosing today — NAD⁺ between scheduled doses.',
  },
  tesamorelin: {
    tagline: 'GH / IGF-1 → visceral fat', tempo: 'cumulative',
    Loading: 'GH pulse support begins; visceral-fat effects are a multi-week process.',
    Building: 'IGF-1 climbing; body-composition changes build steadily over weeks.',
    Peak: 'Peak GH/IGF-1 window — strongest visceral-fat reduction phase.',
    Maintenance: 'Benefits holding steady before the cycle break.',
    off: 'Off cycle — GH support in washout.',
  },
}

export function phaseFor(peptide, tState, dateStr) {
  const cyc = cycleInfo(peptide, dateStr)
  if (cyc.beforeStart) return { phase: 'Off', pct: 0, onDay: 0, onDays: cyc.onDays, cyc }
  if (!cyc.isOn) return { phase: 'Off', pct: 1, onDay: 0, onDays: cyc.onDays, cyc }

  // ongoing peptides: gauge by weeks elapsed + titration completeness
  let f, onDay, onDays
  if (cyc.ongoing) {
    onDay = cyc.cycleDay
    onDays = 0
    const weeks = daysBetween(peptide.startDate, dateStr) / 7
    const { level, maxLevel } = currentRung(peptide, tState)
    const titr = maxLevel > 0 ? level / maxLevel : 1
    // blend calendar weeks (cap ~8) with titration progress
    f = Math.min(1, 0.5 * Math.min(weeks / 8, 1) + 0.5 * titr)
  } else {
    onDay = cyc.onDay ?? cyc.cycleDay
    onDays = cyc.onDays
    f = onDays > 0 ? onDay / onDays : 0
  }

  let phase
  if (f < 0.15) phase = 'Loading'
  else if (f < 0.45) phase = 'Building'
  else if (f < 0.8) phase = 'Peak'
  else phase = 'Maintenance'

  return { phase, pct: f, onDay, onDays, cyc, ongoing: cyc.ongoing }
}

// Human "next" line: when does the next phase begin?
export function nextPhaseText(info) {
  if (info.phase === 'Off') return null
  const order = PHASE_ORDER.indexOf(info.phase)
  if (order < 0 || order >= PHASE_ORDER.length - 1) {
    return info.ongoing ? 'Holding at a steady effect' : 'Nearing the cycle break'
  }
  const nextPhase = PHASE_ORDER[order + 1]
  if (info.ongoing || !info.onDays) return `Next: ${nextPhase.toLowerCase()} effects as you continue`
  const thresholds = { Loading: 0.15, Building: 0.45, Peak: 0.8 }
  const nextDay = Math.ceil(thresholds[info.phase] * info.onDays)
  const week = Math.max(1, Math.ceil(nextDay / 7))
  return `Next: ${nextPhase.toLowerCase()} effects ~week ${week}`
}

export function narrativeFor(peptide, info) {
  const n = NARRATIVES[peptide.id]
  if (!n) return { tagline: peptide.timing || 'Active', text: info.phase === 'Off' ? 'Resting off cycle.' : 'Active this cycle.', tempo: '' }
  const text = info.phase === 'Off' ? n.off : n[info.phase]
  return { tagline: n.tagline, text, tempo: n.tempo }
}
