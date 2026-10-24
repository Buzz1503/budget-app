// Cold start: from the moment the page began loading to Home being on screen
// and able to take a tap. Kept on this device (the last 10) so it can be read
// in More › Data › Backups and reports and quoted in a report.
export const COLD_START_KEY = 'pepito-cold-start'

export function recordColdStart(ms) {
  if (!(ms > 0)) return
  try {
    const list = JSON.parse(localStorage.getItem(COLD_START_KEY) || '[]')
    localStorage.setItem(COLD_START_KEY, JSON.stringify([...list, { at: new Date().toISOString(), ms: Math.round(ms) }].slice(-10)))
  } catch { /* storage blocked */ }
}

export function readColdStarts() {
  try { return JSON.parse(localStorage.getItem(COLD_START_KEY) || '[]') } catch { return [] }
}

/** "Last 0.9 s, median of 6 launches 1.1 s", or null. */
export function coldStartWords(list) {
  if (!list.length) return null
  const s = [...list.map((x) => x.ms)].sort((a, b) => a - b)
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  const sec = (ms) => `${(ms / 1000).toFixed(1)} s`
  return list.length === 1 ? `Last launch ${sec(list[0].ms)}` : `Last launch ${sec(list.at(-1).ms)}, median of ${list.length} launches ${sec(med)}`
}

let done = false
/** Called once, when Home has painted and can take a tap. */
export function markInteractive() {
  if (done || typeof performance === 'undefined') return
  done = true
  // after the next paint
  requestAnimationFrame(() => setTimeout(() => recordColdStart(performance.now()), 0))
}
