// Stock notifications: the order-by notice, the fridge-life question, the weekly
// count, and the "start a new vial?" question after a log. Pure, like
// notifySchedule.js; the runtime hands them to iOS.
//
//   order     "Order Retatrutide by 3 Nov, runs out 17 Nov", once on the order-by
//             date (or at once if it has already come); "Remind me in 3 days" moves
//             it. Out of stock is the same notice, now.
//   expired   the morning a mixed vial reaches the end of its fridge life
//   count     Sunday evening, the weekly count of sealed vials
//   vial      right after a log that left the vial about empty (iPhone only; the
//             Watch asks inline)
//
// Ones for a day still ahead have the pepito.sched. prefix, so they are replaced
// with the rest of the rolling schedule and the Watch plans the same ids from the
// snapshot. Immediate ones (pepito.stock.) are added once and left alone.
import { addDaysStr } from '../lib/schedule'
import { stockRows, orderNotices, expiryOf, sealedCountOf, hasOpenVial } from '../lib/vials'
import { displayName } from '../lib/naming'
import { format, parseISO } from 'date-fns'

// The same constants as notifySchedule.js, kept here so the snapshot can build
// these notices without importing the schedule (which imports the snapshot).
const ID_PREFIX = 'pepito.sched.'
const SCHEDULE_DAYS = 7
const pad = (n) => String(n).padStart(2, '0')
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const at = (date, hhmm) => {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, m] = String(hhmm || '00:00').split(':').map(Number)
  return new Date(y, mo - 1, d, h || 0, m || 0, 0, 0)
}

export const IMMEDIATE_PREFIX = 'pepito.stock.'
export const ORDER_TIME = '09:00'
export const EXPIRY_TIME = '09:00'
export const VIAL_CHANGE_TEXT = 'This vial should be about empty. Start a new one?'
export const VIAL_EXPIRED_TEXT = 'Has this vial been thrown out? Start a new one?'

const shortDate = (d) => format(parseISO(d), 'd MMM')

/** Sundays (weekday 0) within the schedule window, as local dates. */
function sundays(today) {
  const out = []
  for (let i = 0; i < SCHEDULE_DAYS; i++) {
    const d = addDaysStr(today, i)
    if (parseISO(d).getDay() === 0) out.push(d)
  }
  return out
}

export function stockRowsOf(state, todayStr) {
  return stockRows({
    peptides: state.peptides || [], titration: state.titration || {}, vials: state.vials || [], openVials: state.openVials || {},
    doseLogs: state.doseLogs || [], sharedDraws: state.sharedDraws || [], pushes: state.pushes || [], pauses: state.pauses || [],
    todayStr,
  })
}

/**
 * Everything stock-related to notify, as schedule entries.
 *
 * @returns {{ notices: object[], sent: Record<string,string> }} `sent` is what to
 *   remember so an order notice is not delivered twice.
 */
export function stockNotices(state, { now = new Date() } = {}) {
  const ns = state.notificationSettings || {}
  const today = localDate(now)
  const out = []
  const sent = {}
  const base = { threadId: 'pepito.stock', timeSensitive: false }

  if (ns.stock !== false) {
    const rows = stockRowsOf(state, today)
    const orders = orderNotices(rows, {
      sent: state.nativeState?.ordersSent || {}, snoozed: state.nativeState?.orderSnoozed || {}, now, time: ORDER_TIME,
    })
    for (const o of orders) {
      out.push({
        ...base, id: o.id, title: o.title, body: o.body, fireAt: o.fireAt, category: 'ORDER', immediate: o.immediate,
        payload: { kind: 'order', refId: o.peptideId, route: 'supplies' },
      })
      sent[o.peptideId] = o.key
    }

    // fridge life: asked on the morning the vial goes off
    for (const p of state.peptides || []) {
      const open = state.openVials?.[p.id]
      if (!hasOpenVial(open) || open.expiryAskedOn) continue
      const ex = expiryOf(open, p, today)
      if (!ex) continue
      const day = ex.expiresOn < today ? today : ex.expiresOn
      const fire = at(day, EXPIRY_TIME)
      if (fire.getTime() <= now.getTime() || addDaysStr(today, SCHEDULE_DAYS) <= day) continue
      out.push({
        ...base, id: `${ID_PREFIX}expired.${p.id}.${day}`, title: displayName(p),
        body: `Mixed ${shortDate(open.reconstitutedAt)}. ${VIAL_EXPIRED_TEXT}`, fireAt: fire.toISOString(), category: 'VIAL_EXPIRED',
        immediate: false, payload: { kind: 'vial', refId: p.id, vialKind: 'expired', route: 'supplies' },
      })
    }
  }

  // the weekly count: Sunday evening, when there is something on the shelf to count
  if (ns.countCheck !== false && (state.peptides || []).some((p) => sealedCountOf(state.vials || [], p.id) > 0)) {
    for (const d of sundays(today)) {
      const fire = at(d, ns.countTime || '18:00')
      if (fire.getTime() <= now.getTime() || state.nativeState?.countCheckOn === d) continue
      out.push({
        ...base, id: `${ID_PREFIX}count.${d}`, title: 'Weekly count', body: 'A quick count of the sealed vials on the shelf.',
        fireAt: fire.toISOString(), category: 'COUNT', immediate: false, payload: { kind: 'count', route: 'count' },
      })
    }
  }
  return { notices: out, sent }
}

/** The question that follows a log, as a notification (used when the app is not in front). */
export function vialChangeNotice(prompt, { now = new Date() } = {}) {
  const expired = prompt.kind === 'expired'
  return {
    id: `${IMMEDIATE_PREFIX}vial.${prompt.peptideId}`,
    title: prompt.name || 'Vial',
    body: expired ? VIAL_EXPIRED_TEXT : (prompt.noOpen ? 'No vial is open. Start a new one?' : VIAL_CHANGE_TEXT),
    fireAt: new Date(now.getTime() + 2000).toISOString(),
    category: expired ? 'VIAL_EXPIRED' : 'VIAL_CHANGE',
    threadId: 'pepito.stock',
    timeSensitive: false,
    immediate: true,
    payload: { kind: 'vial', refId: prompt.peptideId, vialKind: expired ? 'expired' : 'change', route: 'supplies' },
  }
}
