// Heart rate for a sauna session recorded on the iPhone only (no Watch
// workout): whatever samples Health has for the window, marked sparse when
// there is less than one a minute. A Watch session brings its own 5-second
// series and never goes through here.

export interface SessionHR {
  samples: Array<[number, number]> // [epoch seconds, bpm]
  avg: number | null
  peak: number | null
  sparse: boolean
  from: 'watch' | 'health'
}

/** Samples inside [startMs, endMs] (epoch ms in, epoch seconds out), sorted. */
export function sessionHeartRate(raw: Array<{ start: number; value: number }>, startMs: number, endMs: number): SessionHR {
  const inside = raw
    .filter((r) => r.start >= startMs && r.start <= endMs && Number.isFinite(r.value))
    .sort((a, b) => a.start - b.start)
  const bpms = inside.map((r) => r.value)
  const minutes = Math.max(0, (endMs - startMs) / 60000)
  return {
    samples: inside.map((r) => [Math.round(r.start / 1000), Math.round(r.value)]),
    avg: bpms.length ? Math.round(bpms.reduce((s, x) => s + x, 0) / bpms.length) : null,
    peak: bpms.length ? Math.round(Math.max(...bpms)) : null,
    sparse: minutes > 0 ? inside.length < minutes : true,
    from: 'health',
  }
}

/** The session's window in epoch ms: the stored start and end when known, else its date, start and length. */
export function sessionWindow(s: { date: string; start: string; lengthMin: number; startedAt?: number; endedAt?: number }): [number, number] {
  const start = s.startedAt ?? new Date(`${s.date}T${s.start}:00`).getTime()
  const end = s.endedAt ?? start + s.lengthMin * 60000
  return [start, end]
}
