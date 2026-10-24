// The Sleep Lab analysis in a Web Worker: bootstrap intervals and ridge
// regressions run here, off the main thread.
import { runAnalysis } from './run'
import type { AnalysisInput } from './run'

self.onmessage = (e: MessageEvent<{ id: number; input: AnalysisInput }>) => {
  const { id, input } = e.data
  try {
    const result = runAnalysis(input)
    ;(self as unknown as Worker).postMessage({ id, result })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
