import { daysBetween, addDaysStr, cycleInfo, cyclePhase, currentRung, dosesPerWeek } from './schedule'
import { toMg } from './calc'

/**
 * How long you have been on something, and what the dose has done meanwhile.
 *
 * Tenure is deliberately not derived from the logs. A log says you recorded a
 * dose; it does not say when you started, and the two are different facts for
 * anyone who ran a compound for months before installing this. `startedOn` is
 * the answer, it can be set into the past, and nothing about it fabricates a
 * dose, moves stock or shifts adherence — adherence stays a measure of what was
 * actually recorded, and says so.
 */

/** "4 months, 12 days" — plain units, no decimals to argue with. */
export function durationWords(days) {
  if (days == null || !isFinite(days) || days < 0) return null
  if (days === 0) return 'today'
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 62) {
    const w = Math.floor(days / 7)
    const d = days % 7
    return d ? `${w} week${w === 1 ? '' : 's'}, ${d} day${d === 1 ? '' : 's'}` : `${w} weeks`
  }
  if (days < 365) {
    const months = Math.floor(days / 30.44)
    const rem = days - Math.round(months * 30.44)
    return rem > 0 ? `${months} months, ${rem} day${rem === 1 ? '' : 's'}` : `${months} months`
  }
  // a year is 365 days here, not 365.25 — nobody's first anniversary should
  // read "11 months, 30 days"
  const years = Math.floor(days / 365)
  const remMonths = Math.floor((days - years * 365) / 30.44)
  return remMonths > 0
    ? `${years} year${years === 1 ? '' : 's'}, ${remMonths} month${remMonths === 1 ? '' : 's'}`
    : `${years} year${years === 1 ? '' : 's'}`
}

/** Inclusive day count between two dates, never negative. */
function span(from, to) {
  if (!from || !to) return 0
  return Math.max(0, daysBetween(from, to))
}

/** Runs for one compound, oldest first, with an implied open run if none exist. */
export function runsFor(peptide, runs = {}) {
  const mine = runs?.[peptide?.id]
  if (mine?.length) return [...mine].sort((a, b) => a.startedOn.localeCompare(b.startedOn))
  if (!peptide?.startedOn) return []
  return [{ id: `run-${peptide.id}`, startedOn: peptide.startedOn, endedOn: null }]
}

/**
 * Time on a compound: this run, and across every run there has been.
 *
 * Current run and lifetime are reported separately because they answer
 * different questions — "how long have I been on this stretch" and "how much of
 * my life has this compound been part of" — and a single number would be the
 * wrong answer to one of them.
 */
export function tenureFor(peptide, { runs = {}, todayStr } = {}) {
  const list = runsFor(peptide, runs)
  if (!list.length || !todayStr) return null

  const closed = list.filter((r) => r.endedOn)
  const open = list.find((r) => !r.endedOn) || null

  const runDays = (r) => span(r.startedOn, r.endedOn || todayStr)
  const lifetimeDays = list.reduce((n, r) => n + runDays(r), 0)
  const currentDays = open ? runDays(open) : 0
  const longestRunDays = list.reduce((n, r) => Math.max(n, runDays(r)), 0)

  return {
    startedOn: list[0].startedOn,
    running: !!open,
    runs: list,
    runCount: list.length,
    closedCount: closed.length,
    currentDays,
    currentWords: open ? durationWords(currentDays) : null,
    lifetimeDays,
    lifetimeWords: durationWords(lifetimeDays),
    longestRunDays,
    longestRunWords: durationWords(longestRunDays),
    // "current run: 6 weeks · lifetime: 9 months across 2 runs"
    summary: list.length > 1
      ? `current run: ${durationWords(currentDays)} · lifetime: ${durationWords(lifetimeDays)} across ${list.length} runs`
      : durationWords(lifetimeDays),
  }
}

/**
 * How much of the recent past was actually on-cycle.
 *
 * A compound on 6-on/2-off has been "on" for nine months and taken for seven of
 * them, and the second figure is the one that matters when reading an outcome
 * against it.
 */
export function onVsOff(peptide, { todayStr, weeks = 20 } = {}) {
  if (!peptide?.startedOn || !todayStr) return null
  const onDays = peptide.cycleOnDays || 0
  const offDays = peptide.cycleOffDays || 0
  if (!onDays || !offDays) return { cycled: false, weeks, onWeeks: null, words: 'not cycled — continuous' }

  const windowDays = weeks * 7
  const from = addDaysStr(todayStr, -(windowDays - 1))
  // The cycle is only knowable from the day the schedule was configured. Before
  // that the compound was being taken — tenure says so — but on what rhythm is
  // not something the app has any record of, and counting those days as "off"
  // would be an invention.
  const known = [from, peptide.startDate, peptide.startedOn].filter(Boolean).sort().at(-1)
  let on = 0
  let counted = 0
  for (let d = known; d <= todayStr; d = addDaysStr(d, 1)) {
    counted += 1
    if (cycleInfo(peptide, d).isOn) on += 1
  }
  // Under a fortnight there is nothing to divide into weeks yet.
  if (counted < 14) return { cycled: true, tooNew: true, weeks: 0, onDays: on, onWeeks: 0, words: null }
  const onWeeks = Math.round(on / 7)
  const countedWeeks = Math.max(1, Math.round(counted / 7))
  return {
    cycled: true,
    tooNew: false,
    weeks: countedWeeks,
    onDays: on,
    onWeeks,
    words: `on ${onWeeks} of the last ${countedWeeks} weeks`,
  }
}

/** Where the cycle is now, and the date it next flips. */
export function cyclePosition(peptide, todayStr) {
  if (!peptide || !todayStr) return null
  const ph = cyclePhase(peptide, todayStr)
  if (ph.phase === 'ongoing') return { cycled: false, words: 'not cycled', nextChange: null }
  if (ph.phase === 'before') return { cycled: true, words: 'not started yet', nextChange: peptide.startDate }
  const nextChange = ph.phase === 'on' ? ph.restsOn : ph.backOn
  return {
    cycled: true,
    phase: ph.phase,
    cycleNumber: ph.cycleNumber,
    dayOfPhase: ph.dayOfPhase,
    phaseLength: ph.phaseLength,
    daysLeft: ph.daysLeft,
    nextChange,
    words: ph.phase === 'on'
      ? `cycle ${ph.cycleNumber}, day ${ph.dayOfPhase} of ${ph.phaseLength} on`
      : `cycle ${ph.cycleNumber}, day ${ph.dayOfPhase} of ${ph.phaseLength} off`,
  }
}

// ------------------------------------------------------------ the timeline

const EVENT_LABEL = {
  start: 'Started',
  'step-up': 'Stepped up',
  hold: 'Held',
  override: 'Dose set by hand',
  route: 'Route changed',
  stop: 'Stopped',
  restart: 'Restarted',
}

/**
 * Everything that has happened to this compound's dose, in order.
 *
 * `priorDoseHistory` comes first and is marked `estimated`, because it was
 * typed in from memory rather than recorded at the time. Nothing downstream is
 * allowed to forget that distinction.
 */
export function doseTimeline(peptide, { doseEvents = [], doseLogs = [], skips = [], runs = {}, titration = {}, todayStr } = {}) {
  if (!peptide) return { points: [], bands: [], segments: [] }

  const points = []

  for (const e of (peptide.priorDoseHistory || [])) {
    points.push({
      id: e.id || `prior-${e.fromDate}`,
      date: e.fromDate,
      kind: 'prior',
      label: 'Before logging',
      to: e.dose,
      unit: e.unit,
      frequency: e.frequency,
      estimated: true,
      detail: 'Entered manually, before logging',
    })
  }

  for (const e of doseEvents.filter((x) => x.peptideId === peptide.id)) {
    points.push({
      id: e.id,
      date: e.date,
      kind: e.kind,
      label: EVENT_LABEL[e.kind] || e.kind,
      from: e.from ?? null,
      to: e.to ?? null,
      unit: e.unit || peptide.ladder?.unit,
      note: e.note || null,
      estimated: false,
      detail: e.kind === 'step-up' && e.from != null
        ? `${e.from} → ${e.to} ${e.unit || ''}`.trim()
        : e.kind === 'hold'
          ? `Held at ${e.to} ${e.unit || ''}`.trim()
          : e.kind === 'route'
            ? `Switched to ${e.note}`
            : null,
    })
  }

  // Runs bracket the line; a restart is a point people look for.
  for (const r of runsFor(peptide, runs)) {
    if (r.endedOn) {
      points.push({
        id: `${r.id}-end`, date: r.endedOn, kind: 'stop', label: 'Stopped',
        estimated: false, detail: r.reason === 'removed' ? 'Taken off the protocol' : null,
      })
    }
  }

  // A gap in logging is a fact about the record, not about the dose — marked
  // so a flat stretch on the line is not mistaken for a flat stretch of dosing.
  const mine = doseLogs.filter((l) => l.peptideId === peptide.id).sort((a, b) => a.date.localeCompare(b.date))
  for (let i = 1; i < mine.length; i++) {
    const gap = daysBetween(mine[i - 1].date, mine[i].date)
    if (gap >= 21) {
      points.push({
        id: `gap-${mine[i].id}`, date: mine[i - 1].date, kind: 'gap', label: 'Logging gap',
        estimated: false, detail: `${gap} days with nothing logged`,
      })
    }
  }

  for (const k of skips.filter((x) => x.peptideId === peptide.id)) {
    points.push({
      id: k.id, date: k.date, kind: 'skip', label: 'Skipped',
      estimated: false, detail: k.reason || null,
    })
  }

  points.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'prior' ? -1 : 1))

  // Cycle on/off bands behind the line.
  const bands = []
  const onDays = peptide.cycleOnDays || 0
  const offDays = peptide.cycleOffDays || 0
  // Bands start where the cycle starts being knowable, not where the line does:
  // a backdated start reaches back past any record of which weeks were on.
  const earliest = points[0]?.date || peptide.startedOn
  const from = [earliest, peptide.startDate].filter(Boolean).sort().at(-1)
  if (onDays && offDays && from && todayStr) {
    let cursor = from
    let guard = 0
    while (cursor <= todayStr && guard++ < 400) {
      const on = cycleInfo(peptide, cursor).isOn
      let end = cursor
      while (end <= todayStr && cycleInfo(peptide, end).isOn === on) end = addDaysStr(end, 1)
      bands.push({ from: cursor, to: addDaysStr(end, -1), on })
      cursor = end
    }
  }

  // Flat dose segments, for drawing the line itself.
  const segments = []
  let current = null
  for (const pt of points) {
    if (pt.to == null) continue
    if (current) current.to = pt.date
    current = { from: pt.date, to: todayStr, dose: pt.to, unit: pt.unit, estimated: pt.estimated }
    segments.push(current)
  }

  return { points, bands, segments }
}

// ---------------------------------------------------------------- exposure

/**
 * Everything taken, and how much of it is a guess.
 *
 * Logged doses are counted exactly. A `priorDoseHistory` segment is multiplied
 * out from its stated dose and frequency, which is arithmetic on a memory — so
 * it is returned separately and never quietly folded into the total.
 */
export function cumulativeExposure(peptide, { doseLogs = [], todayStr, usdPerVial = null, fx = 1 } = {}) {
  if (!peptide) return null
  const mine = doseLogs.filter((l) => l.peptideId === peptide.id)
  const loggedMg = mine.reduce((n, l) => n + toMg(l.doseValue, l.unit), 0)
  const injections = mine.filter((l) => l.route !== 'Nasal').length
  const sprays = mine.filter((l) => l.route === 'Nasal').length

  // the manual segments, each running until the next one starts
  const prior = [...(peptide.priorDoseHistory || [])].sort((a, b) => a.fromDate.localeCompare(b.fromDate))
  let estimatedMg = 0
  let estimatedDoses = 0
  for (let i = 0; i < prior.length; i++) {
    const e = prior[i]
    const until = prior[i + 1]?.fromDate || peptide.startedOn || todayStr
    const days = span(e.fromDate, until)
    const perWeek = dosesPerWeek(e.frequency)
    const doses = (days / 7) * perWeek
    estimatedDoses += doses
    estimatedMg += doses * toMg(e.dose, e.unit)
  }

  const vialMg = peptide.recon?.vialMg || 0
  const audPerVial = usdPerVial != null ? usdPerVial * fx : null
  const spend = audPerVial != null && vialMg > 0 ? (loggedMg / vialMg) * audPerVial : null

  return {
    loggedMg: Math.round(loggedMg * 1e4) / 1e4,
    estimatedMg: Math.round(estimatedMg * 1e4) / 1e4,
    totalMg: Math.round((loggedMg + estimatedMg) * 1e4) / 1e4,
    hasEstimate: estimatedMg > 0,
    unit: peptide.ladder?.unit || 'mg',
    injections,
    sprays,
    doses: mine.length,
    estimatedDoses: Math.round(estimatedDoses),
    avgDoseMg: mine.length ? Math.round((loggedMg / mine.length) * 1e4) / 1e4 : null,
    spend,
  }
}

// -------------------------------------------------- milestones + reassess

export const MILESTONES = [
  { days: 28, label: '4 weeks' },
  { days: 56, label: '8 weeks' },
  { days: 84, label: '12 weeks' },
  { days: 183, label: '6 months' },
  { days: 365, label: '1 year' },
]

/** The markers passed, and the next one coming. */
export function milestonesFor(days) {
  if (days == null) return { passed: [], next: null }
  const passed = MILESTONES.filter((m) => days >= m.days)
  const next = MILESTONES.find((m) => days < m.days) || null
  return {
    passed,
    next: next ? { ...next, inDays: next.days - days } : null,
    // exactly on one today — worth a quiet marker rather than a banner
    today: MILESTONES.find((m) => m.days === days) || null,
  }
}

/**
 * A neutral prompt to look at something again.
 *
 * Deliberately a question, never an instruction: this app has no idea whether
 * a compound should continue, and the one thing it can usefully do is notice
 * that a decision has not been revisited in a long time.
 */
export function reassessPrompt(peptide, { tenure, titration = {}, todayStr } = {}) {
  if (!peptide || !tenure?.running) return null
  const { level, maxLevel } = currentRung(peptide, titration[peptide.id])
  const days = tenure.currentDays

  if (level >= maxLevel && maxLevel > 0) {
    const atTop = titration[peptide.id]?.levelStartDate
    const atTopDays = atTop && todayStr ? span(atTop, todayStr) : null
    if (atTopDays != null && atTopDays >= 84) {
      return {
        kind: 'ceiling',
        text: `At the top of the ladder for ${durationWords(atTopDays)}. Worth a look at whether this is still the right dose?`,
      }
    }
  }

  const cycleLen = (peptide.cycleOnDays || 0) + (peptide.cycleOffDays || 0)
  if (cycleLen > 0 && days > cycleLen * 3) {
    return {
      kind: 'long-cycle',
      text: `Running ${durationWords(days)} — past three full cycles. Time to reassess?`,
    }
  }

  if (!cycleLen && days >= 365) {
    return { kind: 'long-run', text: `A year on this one. Time to reassess?` }
  }
  return null
}

/** Everything a Protocol row needs in one call. */
export function protocolTenure(peptide, { runs, titration, todayStr } = {}) {
  const tenure = tenureFor(peptide, { runs, todayStr })
  return {
    tenure,
    cycle: cyclePosition(peptide, todayStr),
    onOff: onVsOff(peptide, { todayStr }),
    milestones: milestonesFor(tenure?.currentDays),
    reassess: reassessPrompt(peptide, { tenure, titration, todayStr }),
  }
}
