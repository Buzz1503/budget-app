// Local-calendar arithmetic in a named time zone.
//
// Health samples are instants. Everything the screens talk about is a local
// day: the night belongs to the morning you woke up, a workout to the day it
// started. Every function that turns an instant into a day takes one of these,
// so the logic can be tested in a zone with daylight saving (Sydney) whatever
// machine runs the tests.

export interface Tz {
  zone: string
  /** 'YYYY-MM-DD' of an instant, in this zone. */
  dateOf(ms: number): string
  /** Hour of day as a fraction (07:30 -> 7.5), in this zone. */
  hourOf(ms: number): number
  /** The instant local midnight begins on a date. */
  startOfDay(date: string): number
}

const pad = (n: number) => String(n).padStart(2, '0')

export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function makeTz(zone: string = deviceZone()): Tz {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = (ms: number) => {
    const out: Record<string, number> = {}
    for (const p of fmt.formatToParts(new Date(ms))) {
      if (p.type !== 'literal') out[p.type] = Number(p.value)
    }
    return out
  }
  // minutes this zone is ahead of UTC at an instant
  const offsetMin = (ms: number) => {
    const p = parts(ms)
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000)
  }
  return {
    zone,
    dateOf(ms) {
      const p = parts(ms)
      return `${p.year}-${pad(p.month)}-${pad(p.day)}`
    },
    hourOf(ms) {
      const p = parts(ms)
      return p.hour + p.minute / 60 + p.second / 3600
    },
    startOfDay(date) {
      const [y, m, d] = date.split('-').map(Number)
      const utcMidnight = Date.UTC(y, m - 1, d)
      // two passes settle the offset even on a daylight-saving day
      let guess = utcMidnight - offsetMin(utcMidnight) * 60000
      guess = utcMidnight - offsetMin(guess) * 60000
      return guess
    },
  }
}

// ------------------------------------------------- calendar-date arithmetic

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

/** Every date from `from` to `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}
