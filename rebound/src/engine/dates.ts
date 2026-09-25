import type { ISODate } from '../data/records'

/** Local calendar date as 'YYYY-MM-DD'. */
export function toISODate(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse 'YYYY-MM-DD' as local midnight. */
export function fromISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISODate(s)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

/** Whole calendar days from a to b (b - a). DST-safe. */
export function daysBetween(a: ISODate, b: ISODate): number {
  const ua = Date.UTC(...ymd(a))
  const ub = Date.UTC(...ymd(b))
  return Math.round((ub - ua) / 86_400_000)
}

function ymd(s: ISODate): [number, number, number] {
  const [y, m, d] = s.split('-').map(Number)
  return [y ?? 1970, (m ?? 1) - 1, d ?? 1]
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(s: ISODate): number {
  return fromISODate(s).getDay()
}
