// The Sleep Lab's part of the snapshot: what the Watch needs to log an
// as-needed item with your last amount, the evening sheet's order, the
// evening and morning prompts it plans when reminders are on the Watch, and
// whether its overnight movement recording should run. No health values:
// names, amounts you logged, settings.

import { asNeededInSlot, lastAmount, EVENING_FACTORS } from '../sleep/logging'
import { promptsFor, promptPlan } from '../sleep/prompts'

/** Items for the Watch's "As needed" row, each with its last amount (or none). */
export function asNeededForWatch(state) {
  const items = state.asNeededItems || []
  const logs = state.asNeededLogs || []
  return ['AM', 'PM'].flatMap((slot) => asNeededInSlot(items, slot)).map((i) => {
    const last = lastAmount(logs, i.id)
    return { id: i.id, name: i.name, short: i.short, slot: i.slot, units: i.units, step: i.step, last: last?.amount ?? null, lastUnit: last?.unit ?? null }
  })
}

/**
 * The item behind "Took Dex" on the AM reminder: the morning as-needed item
 * (a stimulant first) that has a last amount to log again. Null without one.
 */
export function tookItem(state) {
  const am = asNeededForWatch(state).filter((i) => i.slot === 'AM' && i.last > 0)
  const items = new Map((state.asNeededItems || []).map((i) => [i.id, i]))
  const pick = am.find((i) => items.get(i.id)?.stimulant) || am[0]
  return pick ? { id: pick.id, short: pick.short, amount: pick.last, unit: pick.lastUnit || pick.units[0] } : null
}

/** The evening sheet's quick toggles on the Watch: the factors you answer yourself (alcohol is the drinks row). */
export function eveningToggles(state) {
  const ss = state.sleepSettings || {}
  const automatic = new Set([ss.screenTimeOn ? 'screen-bed' : null, ss.roomSensor ? 'room-hot' : null].filter(Boolean))
  return EVENING_FACTORS.filter((f) => f.id !== 'alcohol' && !automatic.has(f.id)).map((f) => ({ id: f.id, name: f.name }))
}

export function sleepSection(state, now = new Date(), { bedtime = null, wake = null, localDate } = {}) {
  const ss = state.sleepSettings || {}
  const today = localDate ? localDate(now) : null
  const prompts = today ? promptsFor(state, { today, now, bedtime, wake, localDate }) : []
  // the battery check happens at the evening prompt's time even when the evening is already logged
  const evening = today
    ? promptPlan({ today, now, bedtime: bedtime || ss.lastBedtime, wake: wake || ss.lastWake, settings: { morningPrompt: false }, eveningDone: () => false, morningDone: () => true, days: 2 })[0]
    : null
  return {
    asNeeded: asNeededForWatch(state),
    restlessness: ss.restlessness !== false,
    took: tookItem(state),
    toggles: eveningToggles(state),
    // the same entries the iPhone schedules (ids match), for the Watch to plan
    prompts: prompts.map(({ id, title, body, fireAt, category, threadId, payload }) => ({ id, title, body, fireAt, category, threadId, payload })),
    // the next evening prompt: the Watch checks its battery then
    nextEvening: evening ? evening.fireAt : null,
  }
}
