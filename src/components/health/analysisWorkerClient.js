// Runs the Sleep Lab analysis off the main thread when a Web Worker is
// available, and on it (after a paint) when it is not.

let worker = null
let seq = 0
const waiting = new Map()

function getWorker() {
  if (worker !== null) return worker
  try {
    worker = new Worker(new URL('../../sleep/analysis/worker.ts', import.meta.url), { type: 'module' })
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

/** The analysis for an input: in the worker if possible, else with `fallback` here. */
export async function computeAnalysis(input, fallback) {
  const w = typeof Worker !== 'undefined' ? getWorker() : false
  if (!w) return fallback(input)
  const id = ++seq
  try {
    return await new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      w.postMessage({ id, input })
    })
  } catch {
    return fallback(input)
  }
}
