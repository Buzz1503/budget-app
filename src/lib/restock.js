// Restock list: what to order, when, and what it costs.
//
// Everything here is projected from the same schedule engine Home runs on, so
// the counts match what the app will actually ask you to do. Nothing is
// estimated from averages when it can be counted exactly.
import { addDaysStr, currentRung, cycleInfo, daysBetween } from './schedule'
import { isDueToday, slotOf, needsProtocolSetup, SLOTS } from './daily'
import { toMg, isNasal, isPremixed, nasalStrength, NASAL_RECIPE, fromMg } from './calc'
import { totalMgOnHand, vialsFor, runOutInfo, costPerDose, expiryInfo } from './inventory'
import { planShots } from './grouping'
import { LIB_TO_COMPOUND } from './mixMatrix'

export const HORIZONS = [
  { id: 'cycles', label: 'To end of cycles' },
  { id: '8w', label: '8 weeks' },
  { id: '12w', label: '12 weeks' },
]

const MIN_HORIZON = 14
const MAX_HORIZON = 168

// "Through the end of current cycles": the furthest point at which any cycled
// peptide finishes its current on/off round. Ongoing peptides have no such
// point, so they fall back to 8 weeks.
export function horizonDays(kind, peptides, todayStr) {
  if (kind === '8w') return 56
  if (kind === '12w') return 84
  let furthest = 0
  for (const p of peptides) {
    if (needsProtocolSetup(p)) continue
    const c = cycleInfo(p, todayStr)
    if (c.ongoing || !c.onDays || !c.offDays) { furthest = Math.max(furthest, 56); continue }
    const len = c.onDays + c.offDays
    furthest = Math.max(furthest, len - (c.cycleDay - 1))
  }
  return Math.min(MAX_HORIZON, Math.max(MIN_HORIZON, furthest || 56))
}

export function horizonLabel(kind, days) {
  const found = HORIZONS.find((h) => h.id === kind)
  return `${found?.label || kind} · ${days} days`
}

// Scheduled doses for one peptide over the window — cycles and weekdays
// respected, so an off-cycle stretch genuinely costs nothing.
export function dosesInWindow(peptide, fromStr, days) {
  let n = 0
  for (let i = 0; i < days; i++) {
    if (isDueToday(peptide, addDaysStr(fromStr, i))) n++
  }
  return n
}

/**
 * Injection events over the window, with co-draws collapsed to one syringe.
 * `verdictOf` is the matrix lookup; without it every dose counts as its own
 * syringe, which is the safe over-estimate.
 */
export function syringesInWindow(peptides, titration, fromStr, days, verdictOf) {
  const injectables = peptides.filter((p) => !needsProtocolSetup(p) && !isNasal(p))
  if (!injectables.length) return { syringes: 0, injections: 0, grouped: !!verdictOf }
  const cache = new Map()
  let syringes = 0
  let injections = 0

  for (let i = 0; i < days; i++) {
    const date = addDaysStr(fromStr, i)
    for (const slot of SLOTS) {
      const due = injectables.filter((p) => isDueToday(p, date) && slotOf(p) === slot)
      if (!due.length) continue
      injections += due.length
      if (!verdictOf) { syringes += due.length; continue }
      // the same set of peptides recurs constantly across a window — plan it once
      const key = due.map((p) => p.id).sort().join('|')
      if (!cache.has(key)) {
        const items = due.map((p) => {
          const { dose } = currentRung(p, titration?.[p.id])
          const ml = toMg(dose, p.ladder.unit) / Math.max(1e-9, p.recon.vialMg / p.recon.bacMl)
          return {
            id: p.id,
            compoundId: p.alwaysSeparate ? null : (LIB_TO_COMPOUND[p.id] || p.id),
            name: p.name,
            units: ml * 100,
            ml,
            separate: !!p.alwaysSeparate,
          }
        })
        cache.set(key, planShots(items, verdictOf).shots)
      }
      syringes += cache.get(key)
    }
  }
  return { syringes, injections, grouped: !!verdictOf }
}

// Weighted average cost of a vial from what's been bought.
export function costPerVial(peptideId, vials) {
  const mine = vialsFor(vials, peptideId)
  const qty = mine.reduce((s, v) => s + (v.qtyPurchased ?? v.qtyOnHand ?? 0), 0)
  const cost = mine.reduce((s, v) => s + (v.costAud || 0) * (v.qtyPurchased ?? v.qtyOnHand ?? 0), 0)
  if (!qty || !cost) return 0
  return cost / qty
}

/** One row per compound: what's left, what the window needs, what to order. */
export function restockRows({ peptides, titration, vials, openVials, todayStr, days, leadDays = 30, restock = {} }) {
  const rows = []
  for (const p of peptides) {
    if (needsProtocolSetup(p)) continue
    const { dose } = currentRung(p, titration?.[p.id])
    const doseMg = toMg(dose, p.ladder.unit)
    const doses = dosesInWindow(p, todayStr, days)
    const neededMg = Math.round(doses * doseMg * 1e6) / 1e6
    const stockMg = totalMgOnHand(p, vials, openVials?.[p.id])
    const vialMg = p.recon?.vialMg || 0
    const shortfallMg = Math.max(0, neededMg - stockMg)
    const suggestedVials = vialMg > 0 ? Math.ceil(shortfallMg / vialMg) : 0
    const ro = runOutInfo(p, titration?.[p.id], vials, openVials?.[p.id], todayStr)
    const key = `vial:${p.id}`
    const override = restock.qty?.[key]

    rows.push({
      key,
      kind: 'vial',
      peptideId: p.id,
      name: p.name,
      nasal: isNasal(p),
      premixed: isPremixed(p),
      dose,
      unit: p.ladder.unit,
      doses,
      neededMg,
      stockMg,
      vialMg,
      // sprays left is the readable form of "mg left" for a nasal bottle
      spraysLeft: isNasal(p) ? Math.floor(fromMg(stockMg, 'spray')) : null,
      suggestedVials,
      qty: override ?? suggestedVials,
      runOutDate: isFinite(ro.daysLeft) ? ro.runOutDate : null,
      daysLeft: ro.daysLeft,
      // the open vial's post-reconstitution clock, so Stock and Restock can't
      // disagree about when it goes off
      expiry: expiryInfo(p, openVials?.[p.id], todayStr),
      openMg: Math.max(0, openVials?.[p.id]?.remainingMg || 0),
      reconstituted: !!openVials?.[p.id]?.reconstitutedAt,
      costPerDose: costPerDose(p, titration?.[p.id], vials),
      unitCost: costPerVial(p.id, vials),
      priority: !isFinite(ro.daysLeft) ? 'ok' : ro.daysLeft <= leadDays ? 'now' : ro.daysLeft <= days ? 'soon' : 'ok',
    })
  }
  // soonest to run out first; anything with no burn rate sinks to the bottom
  return rows.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity))
}

export const DEFAULT_UNIT_COSTS = {
  syringe: 0.35,
  bac: 4,
  saline: 3,
  bottle: 6,
  swab: 0.05,
  sharps: 12,
  imNeedle: 0.5,
}

export const CONSUMABLE_META = {
  syringe: { label: 'Insulin syringes (U-100)', unit: 'ea' },
  bac: { label: 'Bacteriostatic water', unit: '× 10 mL vial' },
  saline: { label: 'Sterile saline', unit: '× 10 mL' },
  bottle: { label: 'Nasal spray bottles', unit: 'ea' },
  swab: { label: 'Alcohol swabs', unit: 'ea' },
  sharps: { label: 'Sharps container', unit: 'ea' },
  imNeedle: { label: 'IM needles (23–25 g, 1–1.5")', unit: 'ea' },
}

/**
 * Consumables implied by the schedule over the window. Co-draws need one
 * syringe between them; intranasal needs bottles and saline, not syringes.
 */
export function consumableRows({ peptides, titration, vials, openVials, todayStr, days, verdictOf, restock = {} }) {
  const { syringes, injections, grouped } = syringesInWindow(peptides, titration, todayStr, days, verdictOf)
  const vialRows = restockRows({ peptides, titration, vials, openVials, todayStr, days, restock })

  // one BAC vial reconstitutes several peptide vials; count the mL and round up
  const bacMl = vialRows
    .filter((r) => !r.premixed)
    .reduce((s, r) => s + r.qty * (peptides.find((p) => p.id === r.peptideId)?.recon?.bacMl || 0), 0)

  const nasalPeptides = peptides.filter((p) => isNasal(p) && !needsProtocolSetup(p))
  let bottles = 0
  for (const p of nasalPeptides) {
    const strength = nasalStrength(p.nasal || NASAL_RECIPE)
    const sprays = dosesInWindow(p, todayStr, days) * currentRung(p, titration?.[p.id]).dose
    const have = Math.floor(fromMg(totalMgOnHand(p, vials, openVials?.[p.id]), 'spray'))
    bottles += Math.max(0, Math.ceil((sprays - have) / Math.max(1, strength.spraysPerBottle)))
  }
  const salineMl = bottles * (NASAL_RECIPE.salineMl || 3)

  const imDoses = peptides
    .filter((p) => p.route === 'IM' && !needsProtocolSetup(p))
    .reduce((s, p) => s + dosesInWindow(p, todayStr, days), 0)

  const counts = {
    syringe: Math.max(0, syringes - imDoses), // an IM shot uses its own needle
    bac: Math.ceil(bacMl / 10),
    saline: Math.ceil(salineMl / 10),
    bottle: bottles,
    // one for the vial top, one for the skin
    swab: (syringes + imDoses) * 2,
    sharps: syringes + imDoses > 0 ? Math.ceil((syringes + imDoses) / 100) : 0,
    imNeedle: imDoses,
  }

  return {
    injections,
    syringes,
    grouped,
    rows: Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => {
        const key = `consumable:${id}`
        const unitCost = restock.unitCosts?.[id] ?? DEFAULT_UNIT_COSTS[id] ?? 0
        return {
          key,
          kind: 'consumable',
          id,
          label: CONSUMABLE_META[id].label,
          unitLabel: CONSUMABLE_META[id].unit,
          suggestedVials: n,
          qty: restock.qty?.[key] ?? n,
          unitCost,
        }
      }),
  }
}

/** Everything the Restock screen renders, plus the AUD total. */
export function restockPlan({ peptides, titration, vials, openVials, todayStr, restock = {}, leadDays = 30, verdictOf = null }) {
  const kind = restock.horizon || 'cycles'
  const days = horizonDays(kind, peptides, todayStr)
  const rows = restockRows({ peptides, titration, vials, openVials, todayStr, days, leadDays, restock })
  const consumables = consumableRows({ peptides, titration, vials, openVials, todayStr, days, verdictOf, restock })

  const line = (r) => Math.round(r.qty * (r.unitCost || 0) * 100) / 100
  const vialCost = rows.reduce((s, r) => s + line(r), 0)
  const consumableCost = consumables.rows.reduce((s, r) => s + line(r), 0)

  return {
    horizon: kind,
    days,
    label: horizonLabel(kind, days),
    until: addDaysStr(todayStr, days),
    rows,
    consumables,
    orderNow: rows.filter((r) => r.priority === 'now' && r.qty > 0),
    totalAud: Math.round((vialCost + consumableCost) * 100) / 100,
    vialCost: Math.round(vialCost * 100) / 100,
    consumableCost: Math.round(consumableCost * 100) / 100,
  }
}

// A delivery due on or before the projected run-out means the low-stock alert
// is already handled — it stops nagging, and clears outright once it arrives.
export function deliveryCovers(restock, peptideId, runOutDate, todayStr) {
  const eta = restock?.delivery?.[`vial:${peptideId}`]
  if (!eta) return null
  const arrived = daysBetween(eta, todayStr) >= 0
  if (arrived) return { eta, arrived: true }
  if (!runOutDate) return { eta, arrived: false }
  return daysBetween(eta, runOutDate) >= 0 ? { eta, arrived: false } : null
}

// Deliveries the calendar export should carry.
export function deliveryEvents(restock, peptides) {
  const out = []
  for (const [key, date] of Object.entries(restock?.delivery || {})) {
    if (!date) continue
    const id = key.startsWith('vial:') ? key.slice(5) : null
    const p = id ? peptides.find((x) => x.id === id) : null
    out.push({
      key,
      date,
      label: p ? `${p.name} delivery expected` : `${CONSUMABLE_META[key.replace('consumable:', '')]?.label || 'Order'} delivery expected`,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
