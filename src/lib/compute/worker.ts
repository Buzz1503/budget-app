// The compute worker: heavy statistics off the main thread.
import { JOBS } from './jobs'
import type { JobKind } from './jobs'

self.onmessage = (e: MessageEvent<{ id: number; kind: JobKind; input: unknown }>) => {
  const { id, kind, input } = e.data
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (JOBS[kind] as (x: any) => unknown)(input)
    ;(self as unknown as Worker).postMessage({ id, result })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
