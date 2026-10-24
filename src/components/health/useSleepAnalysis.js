import { useEffect, useMemo, useState } from 'react'
import { runAnalysis, inputHash } from '../../sleep/analysis/run'

// The last result for each input, so reopening a screen shows it at once.
const cache = new Map()
let lastResult = null

/**
 * The Sleep Lab analysis for the current nights. The result is cached by a
 * hash of its input: a screen opened again, or opened before a new sync
 * lands, shows the last result straight away with `updating` true while the
 * new one is worked out.
 */
export default function useSleepAnalysis(lab) {
  const input = useMemo(() => (lab ? { rows: lab.rows, names: lab.names, timing: lab.timing, needMin: lab.needMin } : null), [lab])
  const hash = useMemo(() => (input ? inputHash(input) : null), [input])
  const [state, setState] = useState(() => ({ result: (hash && cache.get(hash)) || lastResult, hash: hash && cache.has(hash) ? hash : null }))

  useEffect(() => {
    if (!input || !hash) return undefined
    if (cache.has(hash)) { setState({ result: cache.get(hash), hash }); return undefined }
    let live = true
    // let the screen paint the last result before the work starts
    const id = setTimeout(async () => {
      const { computeAnalysis } = await import('./analysisWorkerClient')
      const result = await computeAnalysis(input, runAnalysis)
      cache.set(hash, result)
      lastResult = result
      if (live) setState({ result, hash })
    }, 0)
    return () => { live = false; clearTimeout(id) }
  }, [input, hash])

  return { result: state.result, updating: !!hash && state.hash !== hash }
}
