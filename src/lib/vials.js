// Vials: what is open, how much is left in it, when to change it, when it goes
// off, when to order the next one. Pure, so every surface (Home, Stock, the
// snapshot, the Watch, the notifications) reads the same answer.
//
// Each compound has at most one OPEN vial; everything else on the shelf is
// SEALED (the batches in `vials`). An open vial is
//
//   { id, peptideId, batchId, vialMg,        total mg when it was opened
//     volumeMl,                              mL it was made up to; null when it was never mixed
//     reconstitutedAt,                       the day it was mixed ('yyyy-MM-dd'), null until it is
//     activatedAt,                           the moment it was opened (ISO): doses logged from here on come out of it
//     lot, vendor,                           the batch it came from
//     adjustments: [{ id, mg, reason, at }], hand corrections, and the one the migration needed
//     expiryAskedOn }                        the day the "thrown out?" question was asked
//
// What is left is never stored. It is the total, less every dose logged since
// it was opened (and every draw someone else took), plus any hand corrections.
// A dose deleted from the log therefore puts the drug back, and changing the
// dose, the titration, the cycle or the frequency changes nothing about the
// vial itself.
import { addDaysStr, daysBetween, projectSchedule } from './schedule'
import { isDue, isCycled, isOnCycle } from './due'
import { isPausedOn } from './pauses'
import { toMg, isNasal, isPremixed, unitsFor, formatDose, round } from './calc'
import { needsProtocolSetup } from './daily'
import { drawsPerWeek } from './drawdown'
import { format, parseISO } from 'date-fns'

export const FRIDGE_DEFAULT_DAYS = 28
export const ORDER_LEAD_DEFAULT_DAYS = 14
/** The open vial says "Use by 14 Nov" from this many days before it goes off. */
export const USE_BY_NOTICE_DAYS = 3
/** The order-by dot on More appears when something must be ordered within this many days. */
export const ORDER_DOT_DAYS = 7
export const SNOOZE_ORDER_DAYS = 3

const EPS = 1e-9
const r6 = (n) => Math.round(n * 1e6) / 1e6
const shortDate = (d) => (d ? format(parseISO(d), 'd MMM') : '')

// ----------------------------------------------------------------- settings

/**
 * Days a mixed vial keeps in the fridge: the compound's own setting (the
 * reconstitution record, where the seeded value for that compound also lives),
 * else the playbook's figure if it states one, else 28. Zero means no clock, as
 * for a pre-mixed oil vial.
 */
export function fridgeLifeDays(peptide) {
  const own = peptide?.recon?.expiryDays
  if (Number.isFinite(own) && own >= 0) return own
  const pb = peptide?.playbook?.fridgeLifeDays
  if (Number.isFinite(pb) && pb >= 0) return pb
  return FRIDGE_DEFAULT_DAYS
}

/** Days a delivery takes, per compound; 14 unless set. */
export function orderLeadDays(peptide) {
  const d = peptide?.orderLeadDays
  return Number.isFinite(d) && d >= 0 ? d : ORDER_LEAD_DEFAULT_DAYS
}

/** A compound whose stock was switched off (the old "not in stock" state). */
export function isUntracked(open) {
  return !!open?.unlinked
}

/** Is there a vial open right now? */
export function hasOpenVial(open) {
  return !!open && !open.finished && !open.unlinked && open.vialMg > 0 && !!open.activatedAt
}

// --------------------------------------------------------------- remaining

const logStamp = (l) => String(l.loggedAt || l.date || '')

/** mg drawn out of this vial since it was opened: the owner's doses and anyone else's. */
export function drawnMg(open, doseLogs = [], sharedDraws = []) {
  if (!open) return 0
  const since = open.activatedAt || ''
  let mg = 0
  for (const l of doseLogs) {
    if (l.peptideId !== open.peptideId || l.movedStock === false) continue
    if (since && logStamp(l) < since) continue
    mg += toMg(l.doseValue, l.unit)
  }
  for (const d of sharedDraws) {
    if (d.peptideId !== open.peptideId) continue
    if (since && String(d.at || d.date || '') < since) continue
    mg += Number(d.doseMg) || 0
  }
  return r6(mg)
}

/** Hand corrections, signed: positive puts drug back, negative takes it out. */
export function adjustedMg(open) {
  return r6((open?.adjustments || []).reduce((n, a) => n + (Number(a.mg) || 0), 0))
}

/**
 * What is left in the open vial: total minus every dose logged since it was
 * opened. Negative means more came out than the label said, which is how an
 * overfilled vial shows itself.
 */
export function remainingMg(open, doseLogs = [], sharedDraws = []) {
  if (!hasOpenVial(open)) return 0
  return r6(open.vialMg - drawnMg(open, doseLogs, sharedDraws) + adjustedMg(open))
}

// ------------------------------------------------------------- next dose

/**
 * The next dose that is owed after `afterStr` (exclusive), with its size in mg:
 * titration steps, cycles, pauses and frequency all taken from the real
 * schedule. Null when nothing is owed within the horizon.
 */
export function nextDose(peptide, tState, { afterStr, pushes = [], pauses = [], horizon = 120 } = {}) {
  if (!peptide || needsProtocolSetup(peptide)) return null
  const from = addDaysStr(afterStr, 1)
  const rows = projectSchedule(peptide, tState, from, horizon, afterStr)
  for (const row of rows) {
    if (isDue(peptide, row.date, { pushes, pauses })) {
      return { date: row.date, mg: toMg(row.dose, peptide.ladder.unit), dose: row.dose }
    }
  }
  return null
}

/** The dose that is owed today or next (today counts), for "doses left". */
export function nextDoseFrom(peptide, tState, { fromStr, pushes = [], pauses = [] } = {}) {
  return nextDose(peptide, tState, { afterStr: addDaysStr(fromStr, -1), pushes, pauses })
}

/**
 * Whole doses left in the open vial, at the size of the next dose. Null where
 * the question has no answer (no open vial, or no dose to measure against).
 */
export function dosesLeft(open, peptide, tState, { doseLogs = [], sharedDraws = [], todayStr, pushes = [], pauses = [] } = {}) {
  if (!hasOpenVial(open) || !peptide) return null
  const next = nextDoseFrom(peptide, tState, { fromStr: todayStr, pushes, pauses })
  const mg = next?.mg ?? (peptide.ladder?.ceiling > 0 ? toMg(peptide.ladder.floor, peptide.ladder.unit) : 0)
  if (!(mg > 0)) return null
  const left = remainingMg(open, doseLogs, sharedDraws)
  return Math.max(0, Math.floor(Math.round((left / mg) * 1e6) / 1e6))
}

/**
 * Should the vial be changed? Asked right after a dose is logged: the vial is
 * about empty once what is left would not cover the next scheduled dose.
 *
 * `noOpen` covers a compound with stock to track but no vial open (a vial just
 * finished by hand, or a fresh install): the question is the same.
 */
export function vialChangeNeeded({ peptide, tState, open, vials = [], doseLogs = [], sharedDraws = [], todayStr, pushes = [], pauses = [] }) {
  if (!peptide || needsProtocolSetup(peptide) || !isTracked(open, vials, peptide.id)) return { needed: false }
  if (!hasOpenVial(open)) {
    // already out: the out-of-stock state is showing, asking again at every log would only nag
    if (isOutOfStock(open, vials, peptide.id)) return { needed: false, out: true }
    return { needed: true, noOpen: true, remainingMg: 0, nextMg: null }
  }
  const left = remainingMg(open, doseLogs, sharedDraws)
  const next = nextDose(peptide, tState, { afterStr: todayStr, pushes, pauses })
  const nextMg = next ? next.mg : null
  const needed = left <= EPS || (nextMg != null && left < nextMg - EPS)
  return { needed, noOpen: false, remainingMg: left, nextMg }
}

/**
 * Would logging a dose of `doseMg` now leave the vial needing a change? The same
 * test as vialChangeNeeded, run ahead of the log so a surface that logs offline
 * (the Watch) can ask the question straight after the tick.
 */
export function vialAskAfter({ peptide, tState, open, doseLogs = [], sharedDraws = [], todayStr, doseMg, pushes = [], pauses = [] }) {
  if (!peptide || !(doseMg > 0) || !hasOpenVial(open)) return false
  const left = remainingMg(open, doseLogs, sharedDraws) - doseMg
  const next = nextDose(peptide, tState, { afterStr: todayStr, pushes, pauses })
  const nextMg = next ? next.mg : null
  return left <= EPS || (nextMg != null && left < nextMg - EPS)
}

// --------------------------------------------------------------- fridge life

/**
 * Where the open vial is in its fridge life: the day it goes off, how many days
 * remain, whether to say "Use by …" yet, and whether today is the day to ask
 * whether it has been thrown out.
 */
export function expiryOf(open, peptide, todayStr) {
  if (!hasOpenVial(open) || !open.reconstitutedAt) return null
  const days = fridgeLifeDays(peptide)
  if (!(days > 0)) return null
  const expiresOn = addDaysStr(open.reconstitutedAt, days)
  const daysLeft = daysBetween(todayStr, expiresOn)
  return {
    expiresOn,
    daysLeft,
    expired: daysLeft <= 0,
    showUseBy: daysLeft <= USE_BY_NOTICE_DAYS,
    useBy: `Use by ${shortDate(expiresOn)}`,
    // asked once, the day it goes off (or the first time the app is open after)
    askNow: daysLeft <= 0 && !open.expiryAskedOn,
  }
}

// ------------------------------------------------------------- batches

/** Sealed batches with something in them, oldest first (the order they were added). */
export function sealedBatches(vials = [], peptideId) {
  return vials
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.peptideId === peptideId && (v.qtyOnHand || 0) > 0)
    .sort((a, b) => String(a.v.addedAt || '').localeCompare(String(b.v.addedAt || '')) || a.i - b.i)
    .map(({ v }) => v)
}

/** The batch the next vial comes from: the oldest one on the shelf. */
export function nextSealedBatch(vials = [], peptideId) {
  return sealedBatches(vials, peptideId)[0] || null
}

export function sealedCountOf(vials = [], peptideId) {
  return vials.filter((v) => v.peptideId === peptideId).reduce((n, v) => n + Math.max(0, v.qtyOnHand || 0), 0)
}

export function sealedMgOf(vials = [], peptideId) {
  return vials.filter((v) => v.peptideId === peptideId).reduce((n, v) => n + Math.max(0, v.qtyOnHand || 0) * (v.vialMg || 0), 0)
}

/**
 * Is stock being counted for this compound at all? A compound that has never
 * had a vial recorded (nothing open, nothing sealed, nothing ever finished) has
 * nothing to count down, so it never raises a prompt or an out-of-stock state.
 */
export function isTracked(open, vials, peptideId) {
  if (isUntracked(open)) return false
  return hasOpenVial(open) || !!open?.finished || sealedCountOf(vials, peptideId) > 0
}

/** A vial was in use, it is finished, and there is nothing sealed to replace it. */
export function isOutOfStock(open, vials, peptideId) {
  if (isUntracked(open)) return false
  return !hasOpenVial(open) && !!open?.finished && sealedCountOf(vials, peptideId) === 0
}

// ------------------------------------------------------------- the recipe

/**
 * What to do with a vial that has just been opened: the water to add and the
 * draw that follows from it. From the compound's own reconstitution data,
 * against the size of the vial that was actually opened.
 */
export function recipeFor(peptide, tState, vialMg, todayStr) {
  if (!peptide) return null
  const next = nextDoseFrom(peptide, tState, { fromStr: todayStr })
  const dose = next?.dose ?? peptide.ladder?.floor ?? 0
  const unit = peptide.ladder?.unit
  if (isPremixed(peptide) || isNasal(peptide)) {
    return { mix: false, text: isNasal(peptide) ? 'Nothing to mix. Prime the bottle before the first spray.' : 'Already mixed. Nothing to add.', dose, unit }
  }
  const bacMl = peptide.recon?.bacMl || 0
  const units = unitsFor({ ...peptide, recon: { ...peptide.recon, vialMg } }, dose)
  const unitsText = units > 0 ? `${round(units, 1)} units = ${formatDose(dose, unit)}` : ''
  return {
    mix: true,
    waterMl: bacMl,
    units: round(units, 1),
    dose,
    unit,
    text: `Add ${bacMl} mL bacteriostatic water.${unitsText ? ` ${unitsText}` : ''}`,
  }
}

// --------------------------------------------------------- changing a vial

/**
 * Finish the open vial and open the next sealed one, oldest batch first.
 * Returns the slices to write, never touching the inputs.
 *
 * @param reason 'empty' | 'expired' | 'manual' | 'open' (opening one when none is open)
 */
export function changeVial({ peptide, open, vials = [], doseLogs = [], sharedDraws = [], reason = 'empty', openNext = true, now = new Date(), todayStr }) {
  const peptideId = peptide.id
  const at = now.toISOString()
  const finishedNow = hasOpenVial(open)
  const left = finishedNow ? remainingMg(open, doseLogs, sharedDraws) : 0
  const finished = finishedNow ? {
    id: `fin-${now.getTime()}-${Math.random().toString(36).slice(2, 5)}`,
    peptideId,
    name: peptide.name || '',
    vialMg: open.vialMg,
    batchId: open.batchId || null,
    lot: open.lot || '',
    volumeMl: open.volumeMl ?? null,
    mixedAt: open.reconstitutedAt || null,
    activatedAt: open.activatedAt,
    finishedAt: at,
    date: todayStr,
    reason,
    remainingMg: left,
    // more came out than the label said: an overfilled vial
    overfillMg: left < -EPS ? r6(-left) : 0,
    // thrown out with drug in it
    wasteMg: reason === 'expired' && left > EPS ? left : 0,
    // finished by hand with some still in it
    leftoverMg: reason !== 'expired' && left > EPS ? left : 0,
  } : null

  const batch = openNext ? nextSealedBatch(vials, peptideId) : null
  if (!batch) {
    return {
      finished,
      open: { peptideId, finished: true, vialMg: null, batchId: null, reconstitutedAt: null, activatedAt: null, adjustments: [] },
      vials,
      opened: false,
      // finishing by hand with a vial on the shelf is not running out
      outOfStock: sealedCountOf(vials, peptideId) === 0,
    }
  }
  const noMix = isPremixed(peptide) || isNasal(peptide)
  const nextOpen = {
    id: `open-${now.getTime()}-${Math.random().toString(36).slice(2, 5)}`,
    peptideId,
    batchId: batch.id,
    vialMg: batch.vialMg,
    volumeMl: noMix ? null : (peptide.recon?.bacMl || null),
    // a vial that needs mixing is not "mixed" until the Mixed button says so
    reconstitutedAt: noMix ? todayStr : null,
    activatedAt: at,
    lot: batch.lot || '',
    vendor: batch.vendor || '',
    adjustments: [],
    expiryAskedOn: null,
    // asked for by the change flow: the recipe and the Mixed button are showing
    needsMixing: !noMix,
  }
  return {
    finished,
    open: nextOpen,
    vials: vials.map((v) => (v.id === batch.id ? { ...v, qtyOnHand: v.qtyOnHand - 1 } : v)),
    opened: true,
    outOfStock: false,
    batch,
    needsMixing: !noMix,
  }
}

/**
 * The old open-vial records carried a stored `remainingMg`. Several older
 * readers (the restock list, the calendar) still take that shape, so this hands
 * them the same records with the figure computed rather than stored.
 */
export function withRemaining(openVials = {}, doseLogs = [], sharedDraws = []) {
  const out = {}
  for (const [id, o] of Object.entries(openVials)) {
    out[id] = { ...o, remainingMg: Math.max(0, remainingMg(o, doseLogs, sharedDraws)) }
  }
  return out
}

/** Waste (mg thrown out) in a calendar year, and how many vials that was. */
export function wasteInYear(finishedVials = [], year) {
  const mine = finishedVials.filter((f) => String(f.date || f.finishedAt || '').startsWith(String(year)) && (f.wasteMg || 0) > 0)
  return { mg: round(mine.reduce((n, f) => n + f.wasteMg, 0), 3), vials: mine.length }
}

/** Finished vials of one compound, newest first, for the vial history. */
export function vialHistory(finishedVials = [], peptideId) {
  return finishedVials
    .filter((f) => f.peptideId === peptideId)
    .sort((a, b) => String(b.finishedAt || b.date).localeCompare(String(a.finishedAt || a.date)))
}

// --------------------------------------------------------------- forecasting

/** What others draw from this compound's vials, mg a day, whatever the schedule. */
export function sharedMgPerDay(vials = [], peptideId) {
  const perWeek = vials
    .filter((v) => v.peptideId === peptideId)
    .flatMap((v) => v.drawProfiles || [])
    .reduce((n, d) => n + (d.doseMg > 0 ? d.doseMg * drawsPerWeek(d) : 0), 0)
  return perWeek / 7
}

/**
 * The day the supply runs out, walked through the real future schedule: each
 * dose on the days it is owed (cycles, pauses, frequency), at the size the
 * titration will have reached by then. Run out means the first owed dose the
 * remaining drug cannot cover.
 */
export function forecastRunOut({ peptide, tState, totalMg, todayStr, pushes = [], pauses = [], sharedPerDay = 0, horizon = 540 }) {
  if (!peptide || needsProtocolSetup(peptide)) return { runOutDate: null, none: true }
  const rows = projectSchedule(peptide, tState, todayStr, horizon, todayStr)
  let left = totalMg
  let covered = 0
  let pausedDays = 0
  let offCycleDays = 0
  const cycled = isCycled(peptide)
  for (const row of rows) {
    const date = row.date
    // someone else's share is drawn every day the protocol is not paused
    if (sharedPerDay > 0) left -= sharedPerDay
    if (!isDue(peptide, date, { pushes, pauses })) {
      // why nothing was owed: a rest, or a pause on a day that would have been on
      if (cycled && !isOnCycle(peptide, date)) offCycleDays += 1
      else if (pauses.length && isPausedOn(pauses, peptide.id, date)) pausedDays += 1
      continue
    }
    const mg = toMg(row.dose, peptide.ladder.unit)
    if (left + EPS < mg) {
      return { runOutDate: date, dosesCovered: covered, consumingDays: covered, pausedDays, offCycleDays, capped: false }
    }
    left -= mg
    covered += 1
  }
  return { runOutDate: null, dosesCovered: covered, consumingDays: covered, pausedDays, offCycleDays, capped: true }
}

/**
 * Everything the Stock screen, the dot and the order notice need for each
 * compound: the open vial, doses left, sealed count, the run-out date and the
 * date to order by (run-out minus the delivery lead time).
 */
export function stockRows({
  peptides = [], titration = {}, vials = [], openVials = {}, doseLogs = [], sharedDraws = [],
  pushes = [], pauses = [], todayStr,
}) {
  const rows = []
  for (const p of peptides) {
    if (p.archived) continue
    const open = openVials[p.id] || null
    const tState = titration[p.id]
    const sealed = sealedCountOf(vials, p.id)
    const untracked = !isTracked(open, vials, p.id)
    const sealedMg = sealedMgOf(vials, p.id)
    const isOpen = hasOpenVial(open)
    const left = isOpen ? remainingMg(open, doseLogs, sharedDraws) : 0
    const setUp = !needsProtocolSetup(p)
    const out = isOutOfStock(open, vials, p.id)
    const lead = orderLeadDays(p)
    let runOutDate = null
    let orderBy = null
    if (setUp && !untracked) {
      if (out) {
        runOutDate = todayStr
      } else {
        const fc = forecastRunOut({
          peptide: p, tState, totalMg: Math.max(0, left) + sealedMg, todayStr, pushes, pauses,
          sharedPerDay: sharedMgPerDay(vials, p.id),
        })
        runOutDate = fc.runOutDate
      }
      orderBy = runOutDate ? addDaysStr(runOutDate, -lead) : null
    }
    rows.push({
      peptideId: p.id,
      name: p.name,
      peptide: p,
      open: isOpen ? open : null,
      openRemainingMg: isOpen ? Math.max(0, left) : 0,
      overfillMg: isOpen && left < -EPS ? -left : 0,
      vialMg: isOpen ? open.vialMg : null,
      dosesLeft: isOpen ? dosesLeft(open, p, tState, { doseLogs, sharedDraws, todayStr, pushes, pauses }) : (untracked ? null : 0),
      sealed,
      sealedMg,
      untracked,
      setUp,
      out: out && setUp,
      runOutDate,
      orderBy,
      orderByDays: orderBy ? daysBetween(todayStr, orderBy) : null,
      leadDays: lead,
      expiry: expiryOf(open, p, todayStr),
      needsMixing: isOpen && !!open.needsMixing && !open.reconstitutedAt,
    })
  }
  // order first what has to be ordered first; out of stock leads; nothing to forecast sinks
  const key = (r) => (r.out ? '0000-00-00' : r.orderBy || '9999-99-99')
  return rows.sort((a, b) => key(a).localeCompare(key(b)) || a.name.localeCompare(b.name))
}

/** The dot on More: something has to be ordered within a week, or is already out. */
export function orderDot(rows) {
  return rows.some((r) => r.setUp && !r.untracked && (r.out || (r.orderByDays != null && r.orderByDays <= ORDER_DOT_DAYS)))
}

/**
 * What Home's bell says about stock: out of stock, and a vial near the end of its
 * fridge life. (The order-by date is a dot on More and a row in Stock, and a
 * notification: not a Home alert.)
 */
export function stockAlertsFor(rows) {
  const out = []
  for (const r of rows) {
    if (!r.setUp || r.untracked) continue
    if (r.out) out.push({ id: `out-${r.peptideId}`, kind: 'stock', text: `${r.name} is out of stock. Order it now.` })
    else if (r.expiry?.expired) out.push({ id: `exp-${r.peptideId}`, kind: 'expired', text: `${r.name} vial is past its fridge life.` })
    else if (r.expiry?.showUseBy) out.push({ id: `exp-${r.peptideId}`, kind: 'expiring', text: `${r.name}: ${r.expiry.useBy}.` })
  }
  return out
}

/** "4 doses left", "1 dose left", "No open vial". */
export function dosesLeftWords(row) {
  if (row.untracked) return 'Not tracked'
  if (!row.open) return row.out ? 'Out of stock' : 'No open vial'
  if (row.dosesLeft == null) return `${round(row.openRemainingMg, 2)} mg left`
  return `${row.dosesLeft} ${row.dosesLeft === 1 ? 'dose' : 'doses'} left`
}

/** "Order Retatrutide by 3 Nov, runs out 17 Nov". */
export function orderWords(row) {
  if (row.out) return `Order ${row.name} now, none left`
  return `Order ${row.name} by ${shortDate(row.orderBy)}, runs out ${shortDate(row.runOutDate)}`
}

// ------------------------------------------------------------ order notices

/**
 * The one notification per order-by date: id, text and when to deliver it.
 *
 * A notice for a date still ahead is scheduled (a calendar trigger, replaced on
 * every rebuild). One whose date has come and not been delivered before is
 * immediate. Either way it is not repeated: `sent` is { peptideId: key } for
 * what was delivered or scheduled (key is the order-by date, or 'out'), and it
 * only comes back through "Remind me in 3 days", which sets `snoozed`
 * ({ peptideId: 'yyyy-MM-dd' }) and delivers once on that day.
 */
export function orderNotices(rows, { sent = {}, snoozed = {}, now = new Date(), time = '09:00' } = {}) {
  const out = []
  const [h, m] = String(time).split(':').map(Number)
  const atDay = (d) => {
    const [y, mo, da] = d.split('-').map(Number)
    return new Date(y, mo - 1, da, h || 0, m || 0, 0, 0)
  }
  for (const r of rows) {
    if (!r.setUp || r.untracked) continue
    const key = r.out ? 'out' : r.orderBy
    if (!key) continue
    const sn = snoozed[r.peptideId]
    let fire
    let immediate = false
    let snooze = false
    if (sn && (r.out || sn >= r.orderBy)) {
      fire = atDay(sn)
      snooze = true
      if (fire.getTime() <= now.getTime()) continue // that reminder has already come
    } else {
      fire = r.out ? now : atDay(r.orderBy)
      if (fire.getTime() <= now.getTime()) {
        if (sent[r.peptideId] === key) continue // delivered earlier
        immediate = true
      }
    }
    out.push({
      id: `${immediate ? 'pepito.stock' : 'pepito.sched'}.order.${r.peptideId}.${snooze ? `snooze.${sn}` : key}`,
      peptideId: r.peptideId,
      name: r.name,
      key,
      orderBy: r.orderBy,
      runOutDate: r.runOutDate,
      title: r.out ? 'Out of stock' : 'Order by date',
      body: orderWords(r),
      fireAt: (immediate ? new Date(now.getTime() + 3000) : fire).toISOString(),
      immediate,
    })
  }
  return out
}

// ------------------------------------------------------------ the count check

/** Expected sealed vials per compound, batch by batch, for the weekly count. */
export function countRows(vials = [], peptides = []) {
  const names = new Map(peptides.map((p) => [p.id, p.name]))
  const by = new Map()
  for (const v of vials) {
    if (!by.has(v.peptideId)) by.set(v.peptideId, { peptideId: v.peptideId, name: names.get(v.peptideId) || v.name || v.peptideId, batches: [] })
    by.get(v.peptideId).batches.push({ id: v.id, vialMg: v.vialMg, vendor: v.vendor || '', lot: v.lot || '', expected: Math.max(0, v.qtyOnHand || 0) })
  }
  return [...by.values()]
    .filter((g) => g.batches.some((b) => b.expected > 0))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Is the weekly count due? From Sunday 6 pm (or the time set) until it is done
 * or skipped. `last` is the date of the last count or skip.
 */
export function countDue({ now = new Date(), last = null, time = '18:00', on = true } = {}) {
  if (!on) return false
  const [h, m] = String(time).split(':').map(Number)
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - d.getDay()) // the Sunday on or before today
  const sunday = format(d, 'yyyy-MM-dd')
  const opens = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0, 0, 0)
  if (now.getTime() < opens.getTime()) return false
  return !last || last < sunday
}

// ------------------------------------------------------------------ migration

/**
 * Move the old stock state onto the open-vial model, without losing anything.
 *
 * For each compound:
 *  - an open vial on record becomes THE open vial. Its total is the vial size it
 *    was opened at, it keeps its batch and lot, its mixed date is the day it was
 *    reconstituted if that is known, otherwise the day of the first dose logged
 *    against it, otherwise today.
 *  - what the screen showed as "left" is kept exactly: where the doses logged
 *    since it was opened do not add up to that figure, the difference becomes
 *    one adjustment with the reason "migration", so nothing moves.
 *  - no open vial on record but sealed ones on the shelf and doses logged: the
 *    newest batch has one vial opened, so there is an open vial to count down.
 *  - a vial marked finished stays finished; one marked "not in stock" stays untracked.
 *  - every sealed batch, finished vial and shared draw is left exactly as it is.
 *
 * @returns { openVials, vials, report }
 */
export function migrateVialModel({ peptides = [], openVials = {}, vials = [], doseLogs = [], todayStr, now = new Date() }) {
  const nextOpen = {}
  let nextVials = vials
  const report = []
  for (const p of peptides) {
    const old = openVials[p.id]
    const mine = doseLogs.filter((l) => l.peptideId === p.id).sort((a, b) => logStamp(a).localeCompare(logStamp(b)))
    const row = { peptideId: p.id, name: p.name, action: '', openedAt: null, mixedAt: null, adjustmentMg: 0 }

    if (old?.unlinked) {
      nextOpen[p.id] = { ...old, peptideId: p.id }
      row.action = 'not tracked, left as it was'
      report.push(row)
      continue
    }
    if (old?.finished) {
      nextOpen[p.id] = { ...old, peptideId: p.id, adjustments: old.adjustments || [] }
      row.action = 'finished, nothing open'
      report.push(row)
      continue
    }

    let base = old
    let fromBatch = null
    // nothing usable on record: no open vial, or one with no size and nothing in it
    if (!old || (!(old.vialMg > 0) && !(old.remainingMg > 0))) {
      // unclear: open one vial from the newest batch, if there is one
      const newest = [...vials].reverse().find((v) => v.peptideId === p.id && (v.qtyOnHand || 0) > 0)
      if (!newest) {
        if (old) nextOpen[p.id] = { ...old, peptideId: p.id, adjustments: old.adjustments || [] }
        row.action = 'nothing open, nothing sealed'
        report.push(row)
        continue
      }
      fromBatch = newest
      nextVials = nextVials.map((v) => (v.id === newest.id ? { ...v, qtyOnHand: v.qtyOnHand - 1 } : v))
      base = { vialMg: newest.vialMg, batchId: newest.id, lot: newest.lot, vendor: newest.vendor, remainingMg: newest.vialMg }
    }

    const vialMg = base.vialMg > 0 ? base.vialMg : p.recon?.vialMg || 0
    const noMix = isPremixed(p) || isNasal(p)
    // the instant it was opened: when it was activated, else the first dose on record
    const openedAt = base.activatedAt || (mine[0] ? logStamp(mine[0]) : now.toISOString())
    const firstAfter = mine.find((l) => logStamp(l) >= openedAt)
    const mixedAt = noMix
      ? (base.reconstitutedAt || openedAt.slice(0, 10))
      : (base.reconstitutedAt || (firstAfter ? firstAfter.date : todayStr))
    const open = {
      id: `open-mig-${p.id}`,
      peptideId: p.id,
      batchId: base.batchId || null,
      vialMg,
      volumeMl: noMix ? null : (p.recon?.bacMl || null),
      reconstitutedAt: mixedAt,
      activatedAt: openedAt,
      lot: base.lot || '',
      vendor: base.vendor || '',
      adjustments: [...(base.adjustments || [])],
      expiryAskedOn: null,
    }
    // keep what the screen showed as "left": the old running figure
    const stored = Number.isFinite(base.remainingMg) ? base.remainingMg : null
    if (stored != null) {
      const computed = remainingMg({ ...open, adjustments: [] }, doseLogs, [])
      const delta = r6(stored - computed)
      if (Math.abs(delta) > 1e-6) {
        open.adjustments.push({ id: `adj-mig-${p.id}`, mg: delta, reason: 'migration', at: now.toISOString() })
        row.adjustmentMg = delta
      }
    }
    nextOpen[p.id] = open
    row.action = fromBatch ? 'opened one vial from the newest batch' : 'kept as the open vial'
    row.openedAt = openedAt
    row.mixedAt = mixedAt
    report.push(row)
  }
  // compounds with open records but no longer in the protocol are carried over as they were
  for (const [id, o] of Object.entries(openVials)) if (!(id in nextOpen)) nextOpen[id] = o
  return { openVials: nextOpen, vials: nextVials, report }
}
