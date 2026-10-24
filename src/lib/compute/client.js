// Runs a job in the compute worker when Web Workers exist, else here after
// a paint. A worker that fails once is not tried again this session.
import { JOBS } from './jobs'

let worker = null
let seq = 0
const waiting = new Map()

function getWorker() {
  if (worker !== null) return worker
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const { id, result, error } = e.data || {}
      const w = waiting.get(id)
      if (!w) return
      waiting.delete(id)
      if (error) w.reject(new Error(error))
      else w.resolve(result)
    }
    worker.onerror = () => {
      for (const w of waiting.values()) w.reject(new Error('worker'))
      waiting.clear()
      worker = false
    }
  } catch {
    worker = false
  }
  return worker
}

export async function compute(kind, input) {
  const w = typeof Worker !== 'undefined' ? getWorker() : false
  if (!w) return JOBS[kind](input)
  const id = ++seq
  try {
    return await new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      w.postMessage({ id, kind, input })
    })
  } catch {
    return JOBS[kind](input)
  }
}
