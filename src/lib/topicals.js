// Two nightly topicals, and the nights since each was started.
//
// A topical is a supplement-shaped habit: a name, a form, a slot, tapped once.
// These two exist as seeded entries because the user already uses them — the
// start dates are theirs, and the backfill records the nights as taken because
// that is what happened. Nothing here invents an amount: `dose` stays empty
// until the user decides what to write there.

export const TOPICAL_SEED = [
  { id: 'sup-minoxidil', libraryId: 'minoxidil', name: 'Minoxidil', startedOn: '2026-08-13' },
  { id: 'sup-tretinoin', libraryId: 'tretinoin', name: 'Tretinoin', startedOn: '2026-08-17' },
]

export const isTopical = (s) => s?.form === 'topical'

function utcDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Every night from `startedOn` through `today`, inclusive. Empty before the start. */
export function nightsFrom(startedOn, today) {
  const out = []
  for (let t = utcDay(startedOn); t <= utcDay(today); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/**
 * The shelf and the log with both topicals present and every night since each
 * start recorded as taken.
 *
 * Safe to run twice. A topical already on the shelf (matched by library id or
 * by name) is reused rather than added again, and a night that already has a
 * log for it is left alone — so no night is ever logged twice, and nothing
 * before a start date is ever written. The logs have the same shape the Taken
 * button writes, and are not marked as added later: they stand as if tapped on
 * the night.
 */
export function backfillTopicals({ supplements = [], supplementLogs = [] }, today, seed = TOPICAL_SEED) {
  const shelf = [...supplements]
  const logs = [...supplementLogs]

  for (const def of seed) {
    let item = shelf.find((s) => s.libraryId === def.libraryId
      || (s.name || '').trim().toLowerCase() === def.name.toLowerCase())
    if (!item) {
      item = {
        id: def.id, libraryId: def.libraryId, name: def.name, brand: '', form: 'topical',
        dose: '', doseNote: '', caution: '', category: 'sleep', slot: 'PM', addedOn: def.startedOn,
      }
      shelf.push(item)
    } else if (!item.addedOn || item.addedOn > def.startedOn) {
      // the calendar counts nothing before the day an item was added
      shelf[shelf.indexOf(item)] = item = { ...item, addedOn: def.startedOn }
    }

    const have = new Set(logs.filter((l) => l.supplementId === item.id).map((l) => l.date))
    for (const date of nightsFrom(def.startedOn, today)) {
      if (have.has(date)) continue
      logs.push({
        id: `sl-${def.libraryId}-${date}`,
        supplementId: item.id, date, takenAt: `${date}T20:00:00.000Z`,
        name: item.name, slot: item.slot || 'PM', dose: item.dose || '',
        backfilled: false,
      })
    }
  }
  return { supplements: shelf, supplementLogs: logs }
}
