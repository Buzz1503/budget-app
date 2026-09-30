import { addDaysStr, daysBetween } from './schedule'

/**
 * Changing one thing at a time, and refusing to pretend otherwise.
 *
 * The reason people never work out what is causing a reaction is that they
 * change three things at once and then reason about the result. Every step here
 * locks a set of variables and asks for a number of injections that respect the
 * locks; an injection that breaks one is kept in the history — it happened —
 * but excluded from that step's arithmetic and labelled so, because a result
 * computed over a broken lock is worse than no result.
 */

export const STEP_TYPES = {
  baseline: {
    id: 'baseline',
    name: 'Baseline',
    what: 'Inject as normal and log everything',
    why: 'Measures the starting reaction rate and score, so every later step has something to be compared against',
    days: 7,
    requiredN: 5,
    locks: [],
    reads: (r) => `Baseline: ${r.positive} of ${r.n} injections reacted${r.meanRs != null ? `, average score ${r.meanRs}` : ''}.`,
  },
  split: {
    id: 'split',
    name: 'Split syringes',
    what: 'Every compound gets its own syringe and its own site',
    why: 'While two compounds share a syringe, a reaction cannot name either of them',
    days: 7,
    requiredN: 6,
    locks: ['sharedSyringe'],
    reads: (r) => `Split syringes: ${r.positive} of ${r.n} reacted with nothing sharing a needle.`,
  },
  sides: {
    id: 'sides',
    name: 'Side assignment',
    what: 'Each suspect keeps to its own side of the body',
    why: 'A reaction on one side then points at one compound without any further reasoning',
    days: 10,
    requiredN: 6,
    locks: ['side'],
    reads: (r) => `Side split: ${r.positive} of ${r.n} reacted. ${r.bySide || ''}`.trim(),
  },
  control: {
    id: 'control',
    name: 'Water-only control',
    what: 'The diluent alone, same volume, needle, prep and technique, at a clean site',
    why: 'A control shot. Everything the same except no peptide. If this reacts, the cause is the water, needle, swab or technique, not the peptide',
    days: 7,
    requiredN: 3,
    locks: ['needle', 'prep', 'technique'],
    reads: (r) => (r.positive === 0
      ? `Control shots: 0 of ${r.n} reacted. The water and technique are not the cause.`
      : `Control shots: ${r.positive} of ${r.n} reacted. The water, needle, swab or technique is involved.`),
  },
  pause: {
    id: 'pause',
    name: 'Pause both suspects',
    what: 'Stop both suspects for 14 days, keep everything else going',
    why: 'If reactions carry on at other sites, neither suspect is the cause',
    days: 14,
    requiredN: 0,
    locks: ['suspectsOff'],
    reads: (r) => (r.positive === 0
      ? 'Nothing reacted with both suspects stopped. They remain the prime suspects.'
      : `${r.positive} reactions happened with both suspects stopped — something else is involved.`),
  },
  reintroA: {
    id: 'reintroA',
    name: 'Reintroduce the first suspect',
    what: 'One suspect alone, the other still stopped',
    why: 'Whatever happens now belongs to one compound',
    days: 7,
    requiredN: 4,
    locks: ['singleSuspect'],
    reads: (r) => `First suspect alone: ${r.positive} of ${r.n} reacted.`,
  },
  reintroB: {
    id: 'reintroB',
    name: 'Reintroduce the second suspect',
    what: 'The other suspect alone',
    why: 'The same question, asked of the other one',
    days: 7,
    requiredN: 4,
    locks: ['singleSuspect'],
    reads: (r) => `Second suspect alone: ${r.positive} of ${r.n} reacted.`,
  },
  dilution: {
    id: 'dilution',
    name: 'Dilution test',
    what: 'Same dose, double the diluent, or split across two points 3 cm apart',
    why: 'A drop in score means the concentration is doing it, not the molecule',
    days: 7,
    requiredN: 4,
    locks: ['compound', 'dose'],
    reads: (r) => `Diluted: average score ${r.meanRs ?? '—'} against ${r.baselineRs ?? '—'} before.`,
  },
  diluent: {
    id: 'diluent',
    name: 'Diluent swap',
    what: 'Bacteriostatic water to sterile water for the culprit',
    why: 'Separates the peptide from the preservative it is dissolved in',
    days: 7,
    requiredN: 4,
    locks: ['compound', 'diluent'],
    reads: (r) => `On sterile water: ${r.positive} of ${r.n} reacted.`,
  },
  batch: {
    id: 'batch',
    name: 'Batch test',
    what: 'Same compound, a different vial, lot or vendor',
    why: 'Separates "this compound irritates me" from "this vial is the problem"',
    days: 7,
    requiredN: 4,
    locks: ['compound'],
    reads: (r) => `Different batch: ${r.positive} of ${r.n} reacted.`,
  },
  technique: {
    id: 'technique',
    name: 'Technique tweaks',
    what: 'One change at a time: needle length, slow push, warmed syringe, pinch, dried swab, antihistamine',
    why: 'Any of these can cause a mark that looks exactly like a reaction to the drug',
    days: 14,
    requiredN: 6,
    locks: ['compound'],
    reads: (r) => `Technique: ${r.positive} of ${r.n} reacted.`,
  },
}

export const DEFAULT_STEP_ORDER = [
  'baseline', 'split', 'sides', 'control', 'pause',
  'reintroA', 'reintroB', 'dilution', 'diluent', 'batch', 'technique',
]

export const LOCK_WORDS = {
  sharedSyringe: 'one compound per syringe',
  side: 'each suspect on its own side',
  needle: 'same needle',
  prep: 'same skin prep',
  technique: 'same technique',
  suspectsOff: 'both suspects stopped',
  singleSuspect: 'one suspect only',
  compound: 'same compound',
  dose: 'same dose',
  diluent: 'sterile water',
}

/** A fresh investigation with the default plan. */
export function newInvestigation({ name = 'Injection site reactions', suspects = [], startDate, order = DEFAULT_STEP_ORDER } = {}) {
  const id = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
  return {
    investigation: {
      id, name, suspects: [...suspects], startDate, status: 'running',
      pausedRanges: [], verdict: null, confidence: null, currentStepId: null,
    },
    steps: order.map((type, i) => ({
      id: `${id}-s${i}`,
      investigationId: id,
      order: i,
      type,
      lockedVars: STEP_TYPES[type]?.locks || [],
      requiredN: STEP_TYPES[type]?.requiredN ?? 0,
      startDate: i === 0 ? startDate : null,
      endDate: null,
      result: null,
      status: i === 0 ? 'running' : 'pending',
    })),
  }
}

export function currentStep(steps = []) {
  return steps.find((s) => s.status === 'running')
    || steps.find((s) => s.status === 'pending')
    || null
}

/**
 * Does this injection respect the step's locks?
 *
 * Returns the locks it broke rather than a bare boolean, so the warning at
 * logging time can say which one and the history can say why a shot was left
 * out of a result.
 */
export function brokenLocks(record, step, ctx = {}) {
  if (!step) return []
  const { sideAssignment = {}, suspects = [], allowedZonesFor = null } = ctx
  const broken = []
  for (const lock of step.lockedVars || []) {
    if (lock === 'sharedSyringe' && record.sharedSyringe) broken.push(lock)
    if (lock === 'side') {
      for (const cid of record.compoundIds || []) {
        if (!sideAssignment[cid]) continue
        const allowed = allowedZonesFor ? allowedZonesFor(cid) : null
        if (allowed && record.zoneId && !allowed.includes(record.zoneId)) { broken.push(lock); break }
      }
    }
    if (lock === 'suspectsOff' && (record.compoundIds || []).some((c) => suspects.includes(c))) broken.push(lock)
    if (lock === 'singleSuspect' && (record.compoundIds || []).filter((c) => suspects.includes(c)).length > 1) broken.push(lock)
    if (lock === 'diluent' && record.diluent && record.diluent !== 'sterile') broken.push(lock)
  }
  return [...new Set(broken)]
}

/** The one-line warning shown while logging, before anything is saved. */
export function lockWarning(record, step, ctx) {
  const broken = brokenLocks(record, step, ctx)
  if (!broken.length) return null
  const words = broken.map((b) => LOCK_WORDS[b] || b).join(' and ')
  return `This breaks the step's rule that ${words}. It will be kept in your history but left out of this step's result.`
}

/** Injections belonging to a step, split into the ones that count and the ones that do not. */
export function stepRecords(step, { records = [], ...ctx } = {}) {
  const mine = records.filter((r) => r.investigationStepId === step?.id)
  const counted = []
  const confounded = []
  for (const r of mine) {
    if (r.confounded || brokenLocks(r, step, ctx).length) confounded.push(r)
    else counted.push(r)
  }
  return { all: mine, counted, confounded }
}

/**
 * Where a step has got to, and whether it can say anything yet.
 *
 * `ready` is deliberately about injections that *counted*, not injections
 * logged: a week of shots that all broke the lock has produced no evidence and
 * the step should say so rather than advancing on a number.
 */
export function stepProgress(step, ctx = {}) {
  const { counted, confounded, all } = stepRecords(step, ctx)
  const { reactions = [], scoreOf = () => 0, positiveOf = () => false, todayStr } = ctx
  const rx = (r) => reactions.find((x) => x.injectionRecordId === r.id) || null
  const positive = counted.filter((r) => { const x = rx(r); return x && positiveOf(x) }).length
  const scores = counted.map((r) => { const x = rx(r); return x ? scoreOf(x) : 0 })
  const meanRs = scores.length ? Math.round((scores.reduce((n, s) => n + s, 0) / scores.length) * 10) / 10 : null

  const need = step?.requiredN ?? 0
  const days = STEP_TYPES[step?.type]?.days ?? null
  const dayOf = step?.startDate && todayStr ? Math.max(1, daysBetween(step.startDate, todayStr) + 1) : null
  const endsOn = step?.startDate && days ? addDaysStr(step.startDate, days - 1) : null

  return {
    n: counted.length,
    logged: all.length,
    confounded: confounded.length,
    required: need,
    positive,
    rate: counted.length ? positive / counted.length : null,
    meanRs,
    dayOf,
    days,
    endsOn,
    ready: counted.length >= need && (need > 0 || (dayOf != null && days != null && dayOf >= days)),
  }
}

/** The one sentence a finished step says. */
export function stepResult(step, ctx) {
  const p = stepProgress(step, ctx)
  const type = STEP_TYPES[step?.type]
  if (!type) return null
  return {
    text: type.reads({ ...p, baselineRs: ctx.baselineRs ?? null, bySide: ctx.bySide ?? null }),
    ...p,
  }
}

/** "4 more injections until a verdict" — what the countdown ring counts. */
export function remainingForVerdict(step, ctx) {
  const p = stepProgress(step, ctx)
  return Math.max(0, (p.required || 0) - p.n)
}

/** Move to the next step, recording the finished one's result. */
export function advance(steps = [], stepId, resultText) {
  const i = steps.findIndex((s) => s.id === stepId)
  if (i < 0) return steps
  const todayIso = new Date().toISOString().slice(0, 10)
  return steps.map((s, j) => {
    if (j === i) return { ...s, status: 'done', endDate: todayIso, result: resultText || s.result }
    if (j === i + 1) return { ...s, status: 'running', startDate: s.startDate || todayIso }
    return s
  })
}

/** Total days a step has been frozen, so its timer does not run during a break. */
export function pausedDaysIn(investigation, fromStr, toStr) {
  if (!investigation?.pausedRanges?.length || !fromStr || !toStr) return 0
  let n = 0
  for (const r of investigation.pausedRanges) {
    const a = r.from > fromStr ? r.from : fromStr
    const b = (r.to || toStr) < toStr ? (r.to || toStr) : toStr
    if (a <= b) n += daysBetween(a, b) + 1
  }
  return n
}
