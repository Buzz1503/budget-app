// Low stock, as a dot on the More tab and the Stock row.
//
// The same rule Home's alerts used: a compound is low when its sealed shelf
// covers no more than the restock lead time. An order already on the way that
// arrives in time answers it, and one whose delivery date has passed drops it.

import { coverageFor, coverageWords } from './stock'
import { deliveryCovers } from './restock'

/** Every compound running low, with the words the Stock screen can show. */
export function lowStockItems({ peptides = [], titration = {}, vials = [], restock = {}, leadDays = 30, today }) {
  const out = []
  for (const p of peptides) {
    const cov = coverageFor(p, titration[p.id], vials, today)
    if (!isFinite(cov.days) || cov.days > leadDays) continue
    const covered = deliveryCovers(restock, p.id, cov.runOutDate, today)
    if (covered?.arrived) continue
    out.push(covered
      ? { peptideId: p.id, kind: 'ordered', text: `${coverageWords(cov.weeks)} of ${p.name} left, delivery expected ${covered.eta}` }
      : {
        peptideId: p.id,
        kind: 'low',
        text: cov.vials === 0 ? `No sealed ${p.name} left` : `${coverageWords(cov.weeks)} of ${p.name} left`,
      })
  }
  return out
}

/** The dot: something is low and nothing is on order to cover it. */
export const showLowStockDot = (args) => lowStockItems(args).some((i) => i.kind === 'low')
