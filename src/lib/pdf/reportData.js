// Plain numbers for the doctor reports, from the store. Pure: the screens
// pass the state and today, and get back what the PDF lays out.
import { addDaysStr, rungOn } from '../schedule'
import { formatDose, formatUnitsLong, unitsFor, isNasal } from '../calc'
import { displayName } from '../naming'
import { outOfRangeNow, seriesFor } from '../bloods'

const FREQUENCY = { weekly: 'Weekly', '2xweek': 'Twice a week', '3xweek': '3 times a week', '5on2off': '5 days on, 2 off', daily: 'Daily', nightly: 'Nightly' }

/** The current protocol: each compound with its dose today (and syringe units), how often, and since when. */
export function protocolLines(state, today) {
  return (state.peptides || []).filter((p) => !p.archived).map((p) => {
    const { dose } = rungOn(p, state.titration?.[p.id], today)
    const doseText = p.ladder?.unit === 'spray' ? `${dose} spray${dose === 1 ? '' : 's'}` : formatDose(dose, p.ladder?.unit)
    const units = isNasal(p) ? null : unitsFor(p, dose)
    const cycle = p.cycleOnDays && p.cycleOffDays ? `, ${p.cycleOnDays} days on and ${p.cycleOffDays} off` : ''
    return {
      name: displayName(p),
      dose: [doseText, units != null && isFinite(units) ? formatUnitsLong(units) : null].filter(Boolean).join(', '),
      schedule: `${FREQUENCY[p.frequency] || 'Daily'}${cycle}`,
      since: p.startDate || null,
    }
  })
}

/** The amount logged most often, "10 mg". */
function typical(logs) {
  const count = new Map()
  for (const l of logs) { const k = `${l.amount} ${l.unit}`; count.set(k, (count.get(k) || 0) + 1) }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

const pad = (n) => String(n).padStart(2, '0')
const dateOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
/** The evening an instant belongs to: before noon is the evening before. */
const eveningOf = (iso) => { const d = new Date(iso); if (d.getHours() < 12) d.setDate(d.getDate() - 1); return dateOf(d.toISOString()) }

/**
 * How often each evening as-needed item (the sedatives) and alcohol were
 * logged in the window: the number of evenings, and the usual amount.
 */
export function eveningLogs(state, from, to) {
  const items = (state.asNeededItems || []).filter((i) => i.slot === 'PM')
  const out = []
  for (const i of items) {
    const logs = (state.asNeededLogs || []).filter((l) => l.itemId === i.id && eveningOf(l.at) >= from && eveningOf(l.at) <= to)
    if (!logs.length) continue
    out.push({ name: i.name, nights: new Set(logs.map((l) => eveningOf(l.at))).size, typical: typical(logs) })
  }
  const drinkNights = []
  for (let d = from; d <= to; d = addDaysStr(d, 1)) {
    const n = state.eveningDetails?.[d]?.drinks
    if (n > 0 || (n == null && state.habitLogs?.[d]?.alcohol)) drinkNights.push(n || null)
  }
  if (drinkNights.length) {
    const known = drinkNights.filter((x) => x != null).sort((a, b) => a - b)
    const mid = known.length ? known[Math.floor(known.length / 2)] : null
    out.push({ name: 'Alcohol', nights: drinkNights.length, typical: mid ? `${mid} drink${mid === 1 ? '' : 's'}` : null })
  }
  return out
}

/** As-needed items of any time of day in the window, for the health summary. */
export function asNeededCounts(state, from, to) {
  return (state.asNeededItems || []).map((i) => {
    const logs = (state.asNeededLogs || []).filter((l) => l.itemId === i.id && dateOf(l.at) >= from && dateOf(l.at) <= to)
    return logs.length ? { name: i.name, count: logs.length, typical: typical(logs) } : null
  }).filter(Boolean)
}

/** Markers outside their range now, each with its history. */
export function flaggedBloods(state) {
  const b = state.bloods || {}
  return outOfRangeNow({ tests: b.tests || [], custom: b.customMarkers || [], overrides: b.rangeOverrides || {} }).map((x) => ({
    name: x.marker.name,
    unit: x.marker.unit || '',
    latest: x.latest.value,
    date: x.latest.date,
    range: x.range.low != null && x.range.high != null ? `${x.range.low} to ${x.range.high}` : x.range.low != null ? `above ${x.range.low}` : `below ${x.range.high}`,
    points: seriesFor(x.marker.name, b.tests || []).map((p) => ({ date: p.date, value: p.value })),
  }))
}

/** The latest result of each named marker, with its date and unit. */
export function latestBloods(state, names) {
  const tests = state.bloods?.tests || []
  return names.map((name) => {
    const s = seriesFor(name, tests)
    const last = s[s.length - 1]
    return { name, value: last ? last.value : null, date: last?.date ?? null }
  })
}
