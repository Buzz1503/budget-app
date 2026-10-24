import { useEffect, useMemo, useState } from 'react'
import { get, set, createStore } from 'idb-keyval'
import { hashOf } from './hash'
import { logError } from '../errorLog'

// Results kept on the device between launches (never in the backup: they are
// worked out again from the data), so a screen opens with its last result.
const store = typeof indexedDB !== 'undefined' ? createStore('pepito-compute', 'results') : null
const memory = new Map() // kind -> { hash, result }
const loading = new Map() // kind -> Promise

function lastSaved(kind) {
  if (memory.has(kind)) return Promise.resolve(memory.get(kind))
  if (!store) return Promise.resolve(null)
  if (!loading.has(kind)) loading.set(kind, get(kind, store).catch(() => null))
  return loading.get(kind)
}

/**
 * A heavy result for `input`, worked out in the compute worker and cached by
 * a hash of the input. The last result (from this session or the last one)
 * shows at once with `updating` true while a changed input is worked out, so
 * it is recomputed after a sync or a log, not on every screen open.
 */
export default function useComputed(kind, input) {
  const hash = useMemo(() => (input ? hashOf(input) : null), [input])
  const [state, setState] = useState(() => {
    const m = memory.get(kind)
    return { result: m?.result ?? null, hash: m?.hash ?? null }
  })

  useEffect(() => {
    if (!input || !hash) return undefined
    let live = true
    const m = memory.get(kind)
    if (m?.hash === hash) { setState(m); return undefined }
    void (async () => {
      const saved = await lastSaved(kind)
      if (!live) return
      if (saved?.hash === hash) { memory.set(kind, saved); setState(saved); return }
      if (saved && !memory.has(kind)) setState(saved)
      // let the screen paint the last result before the work starts
      await new Promise((r) => setTimeout(r, 0))
      try {
        const { compute } = await import('./client')
        const result = await compute(kind, input)
        const next = { hash, result }
        memory.set(kind, next)
        if (store) set(kind, next, store).catch(() => {})
        if (live) setState(next)
      } catch (err) {
        logError(err, { where: `compute:${kind}` })
      }
    })()
    return () => { live = false }
  }, [kind, input, hash])

  return { result: state.result, updating: !!hash && state.hash !== hash }
}
