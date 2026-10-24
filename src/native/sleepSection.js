// The Sleep Lab's part of the snapshot: what the Watch needs to log an
// as-needed item with your last amount, and whether its overnight movement
// recording should run. No health values: names, amounts you logged, settings.

import { asNeededInSlot, lastAmount } from '../sleep/logging'

/** Items for the Watch's "As needed" row, each with its last amount (or none). */
export function asNeededForWatch(state) {
  const items = state.asNeededItems || []
  const logs = state.asNeededLogs || []
  return ['AM', 'PM'].flatMap((slot) => asNeededInSlot(items, slot)).map((i) => {
    const last = lastAmount(logs, i.id)
    return { id: i.id, name: i.name, short: i.short, slot: i.slot, units: i.units, step: i.step, last: last?.amount ?? null, lastUnit: last?.unit ?? null }
  })
}

export function sleepSection(state) {
  const ss = state.sleepSettings || {}
  return {
    asNeeded: asNeededForWatch(state),
    restlessness: ss.restlessness !== false,
  }
}
