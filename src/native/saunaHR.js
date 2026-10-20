// A sauna session timed on the iPhone without the Watch app gets whatever
// heart rate Health has for its window, marked sparse when there is less than
// one sample a minute. Runs once per session, shortly after it is saved (Health
// may still be catching up when it is saved), and never for Watch sessions,
// which bring their own series. iPhone app only.
import useStore from '../store/useStore'
import { sessionHeartRate, sessionWindow } from '../sauna/heartRate'

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

let started = false
export function startSaunaHR() {
  if (started) return
  started = true
  let timer = null
  useStore.subscribe((s, prev) => {
    if (s.saunaSessions === prev.saunaSessions) return
    clearTimeout(timer)
    timer = setTimeout(() => { void attachHeartRate() }, 60000)
  })
  void attachHeartRate()
}
