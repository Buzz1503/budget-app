// History + adherence: doses actually taken vs. doses scheduled over a window.
import { addDaysStr, daysBetween } from './schedule'
import { isDueToday } from './daily'
import { SITE_BY_ID } from './sites'

export function dateRange(fromStr, toStr) {
  const n = daysBetween(fromStr, toStr)
  if (n < 0) return []
  return Array.from({ length: n + 1 }, (_, i) => addDaysStr(fromStr, i))
}

// Scheduled doses for one peptide across a window. Days before its startDate
// and days needing protocol setup are never counted as "missed".
export function scheduledCount(peptide, fromStr, toStr) {
  return dateRange(fromStr, toStr).filter((d) => isDueToday(peptide, d)).length
}

export function takenCount(peptide, doseLogs, fromStr, toStr) {
  const days = new Set(
    doseLogs.filter((l) => l.peptideId === peptide.id && l.date >= fromStr && l.date <= toStr)
      .map((l) => l.date)
  )
  // only count a log on a day the dose was actually scheduled
  return [...days].filter((d) => isDueToday(peptide, d)).length
}

export function adherenceFor(peptide, doseLogs, fromStr, toStr) {
  const scheduled = scheduledCount(peptide, fromStr, toStr)
  const taken = takenCount(peptide, doseLogs, fromStr, toStr)
  return {
    peptideId: peptide.id, name: peptide.name, scheduled, taken,
    missed: Math.max(0, scheduled - taken),
    pct: scheduled === 0 ? null : Math.round((taken / scheduled) * 100),
  }
}

export function adherenceSummary(peptides, doseLogs, fromStr, toStr) {
  const rows = peptides.map((p) => adherenceFor(p, doseLogs, fromStr, toStr))
  const scheduled = rows.reduce((s, r) => s + r.scheduled, 0)
  const taken = rows.reduce((s, r) => s + r.taken, 0)
  return {
    rows: rows.filter((r) => r.scheduled > 0).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)),
    overall: {
      scheduled, taken, missed: Math.max(0, scheduled - taken),
      pct: scheduled === 0 ? null : Math.round((taken / scheduled) * 100),
    },
  }
}

// History grouped into injection events: co-draws collapse into one row, since
// they were literally one shot.
export function historyEvents(doseLogs, peptides, { peptideId = null, from = null, to = null } = {}) {
  const nameOf = Object.fromEntries(peptides.map((p) => [p.id, p.name]))
  let logs = doseLogs.filter((l) => l.date)
  if (from) logs = logs.filter((l) => l.date >= from)
  if (to) logs = logs.filter((l) => l.date <= to)
  if (peptideId) {
    // keep whole co-draw events that include this peptide
    const keepGroups = new Set(logs.filter((l) => l.peptideId === peptideId && l.coDrawId).map((l) => l.coDrawId))
    logs = logs.filter((l) => l.peptideId === peptideId || (l.coDrawId && keepGroups.has(l.coDrawId)))
  }

  const groups = new Map()
  for (const l of logs) {
    const key = l.coDrawId || l.id
    if (!groups.has(key)) {
      groups.set(key, {
        key, date: l.date, loggedAt: l.loggedAt || `${l.date}T12:00:00`,
        siteId: l.siteId || null,
        siteLabel: l.siteId ? (SITE_BY_ID[l.siteId]?.label || l.siteId) : null,
        coDraw: !!l.coDrawId, items: [],
      })
    }
    const g = groups.get(key)
    g.items.push({
      logId: l.id, peptideId: l.peptideId, name: nameOf[l.peptideId] || l.peptideId,
      doseValue: l.doseValue, unit: l.unit, insulinUnits: l.insulinUnits,
    })
  }
  return [...groups.values()]
    .map((g) => ({ ...g, coDraw: g.items.length > 1 }))
    .sort((a, b) => String(b.loggedAt).localeCompare(String(a.loggedAt)))
}

export const WINDOWS = [
  { id: 7, label: '7 days' },
  { id: 30, label: '30 days' },
  { id: 90, label: '90 days' },
]

export function windowRange(days, todayStr) {
  return { from: addDaysStr(todayStr, -(days - 1)), to: todayStr }
}
