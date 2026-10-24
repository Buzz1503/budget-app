import { useMemo } from 'react'
import useComputed from '../../lib/compute/useComputed'

/**
 * The Sleep Lab analysis for the current nights, from the compute worker and
 * cached by a hash of its input: a screen opened again, or opened before a new
 * sync lands, shows the last result straight away with `updating` true while
 * the new one is worked out.
 */
export default function useSleepAnalysis(lab) {
  const input = useMemo(() => (lab ? { rows: lab.rows, names: lab.names, timing: lab.timing, needMin: lab.needMin } : null), [lab])
  return useComputed('sleepAnalysis', input)
}
