// Nights that may not be typical, flagged so they can be left out with one
// tap. Nothing is ever deleted: an excluded night stays in the store and the
// backup, is still shown, and comes back with Restore. Excluded nights are
// left out of baselines, Sleep Lab, good and bad nights, dose comparisons and
// any switch comparison.

export const OUTLIER = {
  /** wrist temperature this far above your baseline (°C) */
  wristTempUp: 0.5,
  /** breathing rate this far above your baseline (per minute) */
  respUp: 2,
  /** under this much sleep (minutes) */
  shortSleepMin: 240,
  /** a bedtime this far from your median (minutes) */
  oddBedMin: 180,
}

export type OutlierReason = 'illness' | 'short' | 'bedtime' | 'missing' | 'travel'

export const OUTLIER_WORDS: Record<OutlierReason, string> = {
  illness: 'Possibly unwell',
  short: 'Very short sleep',
  bedtime: 'Unusual bedtime',
  missing: 'Missing data',
  travel: 'Travel',
}

export interface OutlierNightInput {
  date: string
  asleepMin: number | null
  /** minutes from the median bedtime of the 14 nights before */
  bedOffMin: number | null
  wristTempDev: number | null
  respDev: number | null
  /** a night from another source than the chosen one, or without heart rate */
  missing: boolean
  /** the time zone offset recorded with the night, minutes; a change from the night before is travel */
  tzOffsetMin?: number | null
  prevTzOffsetMin?: number | null
  /** sick was logged for that day (the evening's Unwell) */
  sick?: boolean
  /** Slept away from home was logged for that evening */
  away?: boolean
}

/** Every reason a night is flagged; an empty list when nothing stands out. */
export function outlierReasons(n: OutlierNightInput): OutlierReason[] {
  const out: OutlierReason[] = []
  if (n.sick || (n.wristTempDev != null && n.wristTempDev >= OUTLIER.wristTempUp) || (n.respDev != null && n.respDev >= OUTLIER.respUp)) out.push('illness')
  if (n.asleepMin != null && n.asleepMin < OUTLIER.shortSleepMin) out.push('short')
  if (n.bedOffMin != null && n.bedOffMin >= OUTLIER.oddBedMin) out.push('bedtime')
  if (n.missing) out.push('missing')
  if (n.away || (n.tzOffsetMin != null && n.prevTzOffsetMin != null && n.tzOffsetMin !== n.prevTzOffsetMin)) out.push('travel')
  return out
}

/** "3 nights excluded", or null with none. */
export function excludedNote(excluded: Record<string, unknown> | undefined, within?: (date: string) => boolean): string | null {
  const n = Object.keys(excluded || {}).filter((d) => !within || within(d)).length
  return n ? `${n} ${n === 1 ? 'night' : 'nights'} excluded` : null
}

/** Leave excluded nights out of any list of dated rows. */
export function withoutExcluded<T extends { date: string }>(rows: T[], excluded: Record<string, unknown> | undefined): T[] {
  if (!excluded || !Object.keys(excluded).length) return rows
  return rows.filter((r) => !excluded[r.date])
}
