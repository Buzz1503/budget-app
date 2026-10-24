// A sauna session timed on the iPhone without the Watch app gets whatever
// heart rate Health has for its window, marked sparse when there is less than
// one sample a minute. Runs once per session, shortly after it is saved (Health
// may still be catching up when it is saved), and never for Watch sessions,
// which bring their own series. iPhone app only.
//
// A session with no heart rate during it (logged by hand, or nothing in
// Health for its window) gets the fallback instead, once Health has the half
// hour after it: the heart rate before, just after and 30 minutes after. Only
// those three numbers are kept. Water logged with a session's rating is
// written to Apple Health as dietary water, once.
import useStore from '../store/useStore'
import { sessionHeartRate, sessionWindow } from '../sauna/heartRate'
import { hrFallback, waterToWrite, ANALYTICS } from '../sauna/analytics'

const AROUND_MS = 7 * 86400000
const MIN = 60000

const RECENT_MS = 36 * 3600000
const tried = new Set()

async function bridge() {
  const { createBridge } = await import('../health/runtime')
  const { makeTz } = await import('../health/tz')
  return createBridge(makeTz())
}

export async function attachHeartRate(now = Date.now()) {
  const sessions = useStore.getState().saunaSessions || []
  const todo = sessions.filter((s) => (s.source === 'timer' || s.source === 'phone') && !s.hr && !s.hrChecked && !tried.has(s.id)
    && now - sessionWindow(s)[1] < RECENT_MS && now > sessionWindow(s)[1])
  if (!todo.length) return 0
  const b = await bridge().catch(() => null)
  if (!b) return 0
  let n = 0
  for (const s of todo) {
    tried.add(s.id)
    const [start, end] = sessionWindow(s)
    try {
      const raw = await b.quantity('heartRate', start, end)
      const hr = sessionHeartRate(raw, start, end)
      useStore.getState().updateSaunaSession(s.id, hr.samples.length ? { hr } : { hrChecked: true })
      n++
    } catch { /* no access or no data: left as it is */ }
  }
  return n
}

/** The heart rate around a session that recorded none during it. */
export async function attachHeartRateAround(now = Date.now()) {
  const sessions = useStore.getState().saunaSessions || []
  const after = (ANALYTICS.fallbackAtMin + ANALYTICS.fallbackAtTolMin) * MIN
  const todo = sessions.filter((s) => !s.hr?.samples?.length && s.source !== 'watch' && s.hrAround === undefined && !tried.has(`around-${s.id}`)
    && now > sessionWindow(s)[1] + after && now - sessionWindow(s)[1] < AROUND_MS)
  if (!todo.length) return 0
  const b = await bridge().catch(() => null)
  if (!b) return 0
  let n = 0
  for (const s of todo) {
    tried.add(`around-${s.id}`)
    const [start, end] = sessionWindow(s)
    try {
      const raw = await b.quantity('heartRate', start - ANALYTICS.fallbackBeforeMin * MIN, end + after)
      const fb = hrFallback(raw.map((r) => [r.start, r.value]), start, end)
      useStore.getState().updateSaunaSession(s.id, { hrAround: fb ? { before: fb.before, after: fb.after, at30: fb.at30 } : null })
      n++
    } catch { /* tried again next launch */ }
  }
  return n
}

/** Water from a session's rating, written to Apple Health once. */
export async function writeSaunaWater() {
  const todo = waterToWrite(useStore.getState().saunaSessions || [])
  if (!todo.length) return 0
  const b = await bridge().catch(() => null)
  if (!b) return 0
  let n = 0
  for (const w of todo) {
    const at = w.at ?? (sessionWindow({ date: w.date, start: w.start, lengthMin: w.lengthMin })[1])
    if (await b.writeWater(w.ml, at, w.id)) {
      useStore.getState().updateSaunaSession(w.id, { waterWritten: true })
      n++
    }
  }
  return n
}

let started = false
export function startSaunaHR() {
  if (started) return
  started = true
  let timer = null
  useStore.subscribe((s, prev) => {
    if (s.saunaSessions === prev.saunaSessions) return
    clearTimeout(timer)
    timer = setTimeout(() => { void attachHeartRate(); void attachHeartRateAround(); void writeSaunaWater() }, 60000)
  })
  void attachHeartRate()
  void attachHeartRateAround()
  void writeSaunaWater()
}
