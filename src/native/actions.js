// The pending-actions queue: what a widget, a notification, Siri or the Watch
// asked for while the app was not running.
//
// Native code only ever appends to the queue (and updates the snapshot so its
// own surface shows the tick straight away). The app drains the queue on
// launch, on resume and when the plugin says something arrived, and applies
// each action here, through the same store actions an in-app tap uses, so stock,
// titration, tenure and cycles move exactly as they would from Home.
//
// applyPendingActions is pure: it turns actions into store operations and says
// which were applied and which were set aside and why. The store runs the
// operations (useStore.applyNativeActions).

export const ACTION_TYPES = ['logDose', 'logSlot', 'skipDose', 'snoozeDose', 'pushDose', 'startSauna', 'stopSauna', 'saunaCompleted', 'vialChange', 'snoozeOrder',
  // the Sleep Lab: an as-needed item, the evening factors and the morning check
  'logAsNeeded', 'eveningNothing', 'eveningLog', 'morningCheck', 'restlessness',
  // what the Watch reports about itself: a Pepito complication on the face, its battery
  'watchStatus',
  // the rating step after a Watch session
  'saunaRating']
/** How many applied action ids are remembered, so a replayed queue changes nothing. */
export const REMEMBER_IDS = 500

const pad = (n) => String(n).padStart(2, '0')
const dateOf = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * @param state    the store's state
 * @param actions  [{ id, type, at, source, payload }] in queue order
 * @param opts.dueOn (peptide, date) => boolean; injected so this file has no store imports
 * @returns {{ ops: object[], applied: string[], ignored: Array<{ id, reason }>, processedIds: string[] }}
 */
export function applyPendingActions(state, actions = [], { dueOn = null } = {}) {
  const seen = new Set(state.nativeState?.processedActionIds || [])
  const peptides = new Map((state.peptides || []).map((p) => [p.id, p]))
  const supplements = new Map((state.supplements || []).map((s) => [s.id, s]))
  // working copies so two actions in one batch see each other
  const logged = new Set((state.doseLogs || []).map((l) => `${l.date}|${l.peptideId}`))
  const taken = new Set((state.supplementLogs || []).map((l) => `${l.date}|${l.supplementId}`))
  const skipped = new Set((state.skips || []).map((k) => `${k.date}|${k.kind}|${k.kind === 'peptide' ? k.peptideId : k.supplementId}`))
  const linkedWorkouts = new Set((state.saunaSessions || []).map((s) => s.workoutId).filter(Boolean))
  let timer = state.saunaTimer || null
  const asNeeded = new Map((state.asNeededItems || []).map((i) => [i.id, i]))
  // an evening said before noon is the evening before (a 1 am answer is about last night)
  const eveningOf = (iso) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    if (d.getHours() < 12) d.setDate(d.getDate() - 1)
    return dateOf(d.toISOString())
  }

  const ops = []
  const applied = []
  const ignored = []
  const set = (a, reason) => ignored.push({ id: a.id, reason })

  const sorted = [...actions].filter((a) => a && a.id).sort((a, b) => String(a.at).localeCompare(String(b.at)))
  for (const a of sorted) {
    if (seen.has(a.id)) { set(a, 'duplicate'); continue }
    seen.add(a.id)
    const p = a.payload || {}
    const date = p.date || dateOf(a.at)
    switch (a.type) {
      case 'logDose': {
        const kind = p.kind || 'peptide'
        const refs = Array.isArray(p.refIds) && p.refIds.length ? p.refIds : [p.refId]
        if (kind === 'supplement') {
          const id = refs[0]
          if (!supplements.has(id)) { set(a, 'missing'); break }
          if (taken.has(`${date}|${id}`)) { set(a, 'already'); break }
          taken.add(`${date}|${id}`)
          ops.push({ op: 'takeSupplement', supplementId: id, date, at: a.at })
          applied.push(a.id)
          break
        }
        const live = refs.filter((id) => peptides.has(id) && !logged.has(`${date}|${id}`))
        if (!live.length) { set(a, refs.every((id) => !peptides.has(id)) ? 'missing' : 'already'); break }
        for (const id of live) logged.add(`${date}|${id}`)
        // a group logs as one draw, exactly like accepting it on Home
        ops.push(live.length > 1 || p.group
          ? { op: 'logCoDraw', peptideIds: live, date, at: a.at }
          : { op: 'logDose', peptideId: live[0], date, at: a.at })
        applied.push(a.id)
        break
      }
      case 'logSlot': {
        // "Log my doses": everything still due in the slot when the action was made
        const due = (p.refIds || []).filter((id) => peptides.has(id) && !logged.has(`${date}|${id}`) && (!dueOn || dueOn(peptides.get(id), date)))
        const supps = (p.supplementIds || []).filter((id) => supplements.has(id) && !taken.has(`${date}|${id}`))
        if (!due.length && !supps.length) { set(a, 'already'); break }
        for (const id of due) { logged.add(`${date}|${id}`); ops.push({ op: 'logDose', peptideId: id, date, at: a.at }) }
        for (const id of supps) { taken.add(`${date}|${id}`); ops.push({ op: 'takeSupplement', supplementId: id, date, at: a.at }) }
        applied.push(a.id)
        break
      }
      case 'skipDose': {
        const kind = p.kind || 'peptide'
        const refs = Array.isArray(p.refIds) && p.refIds.length ? p.refIds : [p.refId]
        const known = kind === 'supplement' ? supplements : peptides
        const live = refs.filter((id) => known.has(id) && !skipped.has(`${date}|${kind}|${id}`)
          && !(kind === 'peptide' ? logged : taken).has(`${date}|${id}`))
        if (!live.length) { set(a, refs.every((id) => !known.has(id)) ? 'missing' : 'already'); break }
        for (const id of live) {
          skipped.add(`${date}|${kind}|${id}`)
          ops.push(kind === 'supplement' ? { op: 'skipSupplement', supplementId: id, date } : { op: 'skipDose', peptideId: id, date })
        }
        applied.push(a.id)
        break
      }
      case 'pushDose': {
        const refs = Array.isArray(p.refIds) && p.refIds.length ? p.refIds : [p.refId]
        const live = refs.filter((id) => peptides.has(id) && !logged.has(`${date}|${id}`) && !skipped.has(`${date}|peptide|${id}`))
        if (!live.length) { set(a, refs.every((id) => !peptides.has(id)) ? 'missing' : 'already'); break }
        for (const id of live) ops.push({ op: 'pushDose', peptideId: id, date })
        applied.push(a.id)
        break
      }
      case 'vialChange': {
        // the answer to "Start a new one?": from a notification or from the Watch
        const id = p.refId || p.peptideId
        if (!peptides.has(id)) { set(a, 'missing'); break }
        const answer = ['still', 'notyet'].includes(p.answer) ? p.answer : 'yes'
        ops.push({ op: 'vialChange', peptideId: id, answer, kind: p.kind === 'expired' ? 'expired' : 'change' })
        applied.push(a.id)
        break
      }
      case 'snoozeOrder': {
        const id = p.refId || p.peptideId
        if (!peptides.has(id)) { set(a, 'missing'); break }
        ops.push({ op: 'snoozeOrder', peptideId: id })
        applied.push(a.id)
        break
      }
      case 'snoozeDose':
        // the reminder itself was scheduled natively; nothing in the store changes
        applied.push(a.id)
        break
      case 'startSauna': {
        if (timer) { set(a, 'already'); break }
        timer = { startedAt: p.startedAt ?? Date.parse(a.at), targetMin: p.targetMin, tempC: p.tempC, rounds: p.rounds || 1, source: a.source }
        ops.push({ op: 'startSauna', ...timer })
        applied.push(a.id)
        break
      }
      case 'stopSauna': {
        if (!timer) { set(a, 'not-running'); break }
        ops.push({ op: 'stopSauna', timer, stoppedAt: p.stoppedAt ?? Date.parse(a.at), needsReview: !!p.autoEnded })
        timer = null
        applied.push(a.id)
        break
      }
      case 'saunaCompleted': {
        if (p.workoutId && linkedWorkouts.has(p.workoutId)) { set(a, 'already'); break }
        if (p.workoutId) linkedWorkouts.add(p.workoutId)
        ops.push({ op: 'saunaFromWatch', summary: p, clearsTimer: !!timer })
        timer = null
        applied.push(a.id)
        break
      }
      case 'logAsNeeded': {
        const item = asNeeded.get(p.refId)
        const amount = Number(p.amount)
        if (!item) { set(a, 'missing'); break }
        if (!(amount > 0)) { set(a, 'invalid'); break }
        ops.push({ op: 'logAsNeeded', itemId: item.id, amount, unit: p.unit || item.units?.[0], at: p.takenAt || a.at, source: a.source === 'notification' ? 'notification' : 'watch' })
        applied.push(a.id)
        break
      }
      case 'eveningNothing': {
        const d = p.date || eveningOf(a.at)
        if (!d) { set(a, 'invalid'); break }
        ops.push({ op: 'eveningNothing', date: d })
        applied.push(a.id)
        break
      }
      case 'eveningLog': {
        const d = p.date || eveningOf(a.at)
        if (!d) { set(a, 'invalid'); break }
        ops.push({ op: 'eveningLog', date: d, drinks: p.drinks ?? null, factors: Array.isArray(p.factors) ? p.factors : [] })
        applied.push(a.id)
        break
      }
      case 'restlessness': {
        const r = p.restless
        if (!r || !p.date || !Array.isArray(r.series)) { set(a, 'invalid'); break }
        ops.push({ op: 'restless', date: p.date, summary: r })
        applied.push(a.id)
        break
      }
      case 'morningCheck': {
        const d = p.date || dateOf(a.at)
        const patch = {}
        if (p.rested != null) patch.rested = p.rested
        if (p.dreams != null) patch.dreams = p.dreams
        if (!Object.keys(patch).length) { set(a, 'invalid'); break }
        ops.push({ op: 'morningCheck', date: d, patch })
        applied.push(a.id)
        break
      }
      case 'saunaRating': {
        if (!p.start && !p.workoutId) { set(a, 'invalid'); break }
        ops.push({
          op: 'saunaRating', start: p.start ?? null, workoutId: p.workoutId ?? null,
          rating: { feel: p.feel ?? null, lightheaded: !!p.lightheaded, headache: !!p.headache, cramps: !!p.cramps, electrolytes: p.electrolytes ?? null, waterMl: p.waterMl ?? null },
        })
        applied.push(a.id)
        break
      }
      case 'sleepMode': {
        const at = Number(p.start)
        if (!['lightsOut', 'up'].includes(p.kind) || !Number.isFinite(at)) { set(a, 'invalid'); break }
        ops.push({ op: 'sleepMode', kind: p.kind, at })
        applied.push(a.id)
        break
      }
      case 'watchStatus': {
        const battery = Number(p.battery)
        ops.push({
          op: 'watchStatus',
          complication: typeof p.complication === 'boolean' ? p.complication : null,
          battery: Number.isFinite(battery) && battery >= 0 && battery <= 1 ? battery : null,
          // the movement recording: when a window was last asked for, by what, what the last read found
          motionAt: Number.isFinite(Number(p.start)) && p.start != null ? Number(p.start) : null,
          motionBy: typeof p.kind === 'string' ? p.kind : null,
          motionResult: typeof p.answer === 'string' ? p.answer : null,
          at: a.at,
        })
        applied.push(a.id)
        break
      }
      default:
        set(a, 'unknown')
    }
  }
  const processedIds = [...seen].slice(-REMEMBER_IDS)
  return { ops, applied, ignored, processedIds }
}
