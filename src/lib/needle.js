// The needle on an injection record: plain gauge and length pickers that
// remember the last values used. Before stage 2D these came from Supplies;
// Supplies is gone from the app, so the last choice is the default instead.

export const NEEDLE_GAUGES = ['27G', '28G', '29G', '30G', '31G', '32G', '33G', '34G']
export const NEEDLE_LENGTHS_MM = [4, 5, 6, 8, 10, 13, 16, 25]

/** A needle as { gauge, lengthMm }, or null when either part is missing. */
export function cleanNeedle(n) {
  if (!n || !n.gauge || !(Number(n.lengthMm) > 0)) return null
  return { gauge: String(n.gauge), lengthMm: Number(n.lengthMm) }
}

/** The default for a new record: the last needle used, if any. */
export const lastNeedle = (settings) => cleanNeedle(settings?.lastNeedle)

/**
 * The settings patch after a needle is chosen. Choosing "none" keeps the last
 * remembered needle, so clearing one record does not forget the default.
 */
export function rememberNeedle(settings, needle) {
  const n = cleanNeedle(needle)
  return n ? { ...settings, lastNeedle: n } : settings
}

/** Gauge options, with any older value on a record kept in the list. */
export const gaugeOptions = (current) => (current && !NEEDLE_GAUGES.includes(current) ? [...NEEDLE_GAUGES, current] : NEEDLE_GAUGES)
export const lengthOptions = (current) => (current && !NEEDLE_LENGTHS_MM.includes(Number(current))
  ? [...NEEDLE_LENGTHS_MM, Number(current)].sort((a, b) => a - b) : NEEDLE_LENGTHS_MM)
