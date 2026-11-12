// Overnight outside temperature per night from Open-Meteo (free, no account
// or key). Only a latitude, a longitude and dates go out: never a health
// value. Recent nights come from the forecast endpoint (past days), older
// ones from the archive. Each night is cached in the store once fetched, so
// the app works offline with what it has; a failed request is skipped
// quietly and tried again next time.

export const WEATHER = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  archive: 'https://archive-api.open-meteo.com/v1/archive',
  /** the archive lags a few days behind; newer nights come from the forecast's past days */
  archiveLagDays: 5,
  pastDays: 7,
  /** at most this many days per archive request */
  chunkDays: 366,
  /** 9 pm the evening before to 6 am on the night's date */
  fromHour: 21,
  toHour: 6,
}

const DAY = 86400000
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const r1 = (x) => Math.round(x * 10) / 10

/**
 * Overnight average and minimum per night from hourly readings in local time
 * ("2026-11-11T21:00"). A night is its wake date; it needs every hour from 9 pm
 * to 6 am to count.
 */
export function overnightFromHourly(times, temps) {
  const byNight = new Map()
  ;(times || []).forEach((iso, i) => {
    const v = temps?.[i]
    if (v == null || !Number.isFinite(v)) return
    const date = iso.slice(0, 10)
    const hour = Number(iso.slice(11, 13))
    let night = null
    if (hour >= WEATHER.fromHour) night = addDays(date, 1)
    else if (hour <= WEATHER.toHour) night = date
    if (!night) return
    byNight.set(night, [...(byNight.get(night) || []), v])
  })
  const need = 24 - WEATHER.fromHour + WEATHER.toHour + 1
  const out = {}
  for (const [night, vals] of byNight) {
    if (vals.length < need) continue
    out[night] = { avgC: r1(vals.reduce((a, b) => a + b, 0) / vals.length), minC: r1(Math.min(...vals)) }
  }
  return out
}

/** The requests that cover the missing nights: archive chunks for older nights, the forecast for recent ones. */
export function weatherRequests({ lat, lon, nights, cached = {}, today }) {
  const missing = [...new Set(nights)].filter((d) => !cached[d] && d <= today).sort()
  if (!missing.length) return []
  const q = `latitude=${lat}&longitude=${lon}&hourly=temperature_2m&timezone=auto`
  const lagFrom = addDays(today, -WEATHER.archiveLagDays)
  const old = missing.filter((d) => d < lagFrom)
  const recent = missing.filter((d) => d >= lagFrom)
  const reqs = []
  // archive: from the evening before the first night to the last night, in yearly chunks
  let i = 0
  while (i < old.length) {
    const from = old[i]
    let j = i
    while (j + 1 < old.length && Date.parse(old[j + 1]) - Date.parse(from) < WEATHER.chunkDays * DAY) j++
    reqs.push(`${WEATHER.archive}?${q}&start_date=${addDays(from, -1)}&end_date=${old[j]}`)
    i = j + 1
  }
  if (recent.length) reqs.push(`${WEATHER.forecast}?${q}&past_days=${WEATHER.pastDays}&forecast_days=1`)
  return reqs
}

/**
 * Fetch what is missing and return the new nights ({ date: { avgC, minC, at } }).
 * Never throws: offline or a failed request gives back what did arrive.
 */
export async function fetchOvernight({ lat, lon, nights, cached, today, fetchFn = globalThis.fetch }) {
  const out = {}
  if (typeof fetchFn !== 'function' || lat == null || lon == null) return out
  const want = new Set(nights)
  for (const url of weatherRequests({ lat, lon, nights, cached, today })) {
    try {
      const res = await fetchFn(url)
      if (!res?.ok) continue
      const body = await res.json()
      const got = overnightFromHourly(body?.hourly?.time, body?.hourly?.temperature_2m)
      const at = Date.now()
      for (const [d, v] of Object.entries(got)) if (want.has(d) && d <= today) out[d] = { ...v, at }
    } catch {
      // offline or refused: skipped, tried again on the next sync
    }
  }
  return out
}
