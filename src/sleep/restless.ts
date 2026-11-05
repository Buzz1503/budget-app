// Restless nights from Apple Health alone (the Watch movement recording and
// Sleep sounds were removed). Pure: the night's stage segments and its heart
// rate through the night go in.
//
//   Wake-ups       awake periods after falling asleep, touching ones joined,
//                  and their total minutes.
//   Fragmentation  stage changes per hour, from falling asleep to the final wake.
//   HR spikes      heart rate more than 10 bpm above that night's median for
//                  2 minutes or more.

const MIN = 60000

export const RESTLESS = {
  /** a heart rate spike: this far above the night's median... */
  spikeBpm: 10,
  /** ...for at least this long */
  spikeMin: 2,
  /** readings this far apart still belong to one spike */
  spikeGapMin: 2,
  /** an awake period listed in What happened */
  listWakeMin: 2,
}

export interface Segment { start: number; end: number; stage: string }

const asleep = (s: Segment) => s.stage !== 'awake'

/** The span from the first sleep to the end of the last, or null without sleep. */
export function sleepSpan(segments: Segment[] | undefined): { from: number; to: number } | null {
  const sleeps = (segments || []).filter(asleep)
  if (!sleeps.length) return null
  return { from: Math.min(...sleeps.map((s) => s.start)), to: Math.max(...sleeps.map((s) => s.end)) }
}

/** Awake periods inside the sleep span, touching ones (a minute or less apart) joined. */
export function awakePeriods(segments: Segment[] | undefined): Array<{ s: number; e: number }> {
  const span = sleepSpan(segments)
  if (!span) return []
  const runs: Array<{ s: number; e: number }> = []
  for (const g of [...(segments || [])].sort((a, b) => a.start - b.start)) {
    if (g.stage !== 'awake' || g.end <= span.from || g.start >= span.to) continue
    const s = Math.max(g.start, span.from)
    const e = Math.min(g.end, span.to)
    const last = runs[runs.length - 1]
    if (last && s - last.e <= MIN) last.e = Math.max(last.e, e)
    else runs.push({ s, e })
  }
  return runs
}

/** Wake-ups after falling asleep and their total minutes; null without stage detail. */
export function wakeUps(segments: Segment[] | undefined): { count: number; awakeMin: number } | null {
  if (!sleepSpan(segments)) return null
  const runs = awakePeriods(segments)
  return { count: runs.length, awakeMin: Math.round(runs.reduce((t, r) => t + (r.e - r.s) / MIN, 0)) }
}

/** Stage changes per hour from falling asleep to the final wake; null without stages. */
export function fragmentation(segments: Segment[] | undefined): number | null {
  const span = sleepSpan(segments)
  const segs = [...(segments || [])].filter((g) => g.end > (span?.from ?? 0) && g.start < (span?.to ?? 0)).sort((a, b) => a.start - b.start)
  if (!span || !segs.some((g) => g.stage === 'core' || g.stage === 'deep' || g.stage === 'rem')) return null
  let changes = 0
  for (let i = 1; i < segs.length; i++) if (segs[i].stage !== segs[i - 1].stage) changes++
  const hours = (span.to - span.from) / 3600000
  return hours > 0 ? Math.round((changes / hours) * 10) / 10 : null
}

export interface HrSpike {
  /** epoch ms of the first reading above the line */
  t: number
  /** epoch ms of the last */
  end: number
  peak: number
  /** bpm above the night's median at the peak */
  above: number
  durationMin: number
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** The night's median heart rate, or null with too few readings. */
export const nightMedianHR = (hr: Array<[number, number]> | undefined) => (hr && hr.length >= 3 ? median(hr.map((p) => p[1])) : null)

/**
 * Heart rate spikes: readings more than 10 bpm above the night's median, in a
 * run lasting 2 minutes or more. `hr` is [minutes from `start`, bpm].
 */
export function hrSpikes(hr: Array<[number, number]> | undefined, start: number): HrSpike[] {
  const base = nightMedianHR(hr)
  if (base == null || !hr) return []
  const line = base + RESTLESS.spikeBpm
  const out: HrSpike[] = []
  let run: Array<[number, number]> = []
  const close = () => {
    if (run.length) {
      const dur = run[run.length - 1][0] - run[0][0] + 1
      if (dur >= RESTLESS.spikeMin) {
        const peak = Math.max(...run.map((p) => p[1]))
        out.push({ t: start + run[0][0] * MIN, end: start + run[run.length - 1][0] * MIN, peak, above: Math.round(peak - base), durationMin: dur })
      }
    }
    run = []
  }
  for (const p of [...hr].sort((a, b) => a[0] - b[0])) {
    if (p[1] > line) {
      if (run.length && p[0] - run[run.length - 1][0] > RESTLESS.spikeGapMin) close()
      run.push(p)
    } else close()
  }
  close()
  return out
}

export interface RestlessNight {
  wakeUps: number | null
  awakeMin: number | null
  fragmentation: number | null
  hrSpikes: number | null
}

/** All four for one night, null where Health had nothing to go on. */
export function restlessNight(night: { start: number; segments?: Segment[]; overnight?: { hr?: Array<[number, number]> } | null }): RestlessNight {
  const w = wakeUps(night.segments)
  const hr = night.overnight?.hr
  return {
    wakeUps: w?.count ?? null,
    awakeMin: w?.awakeMin ?? null,
    fragmentation: fragmentation(night.segments),
    hrSpikes: hr && hr.length >= 3 ? hrSpikes(hr, night.start).length : null,
  }
}

const times = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)

/** "Woke 4 times, 21 min awake. 2 heart rate spikes." */
export function restlessLine(r: RestlessNight): string {
  const parts: string[] = []
  if (r.wakeUps != null) {
    parts.push(r.wakeUps === 0 ? 'No wake-ups.' : `Woke ${times(r.wakeUps, 'once', 'times')}, ${r.awakeMin} min awake.`)
  }
  if (r.hrSpikes != null) parts.push(r.hrSpikes === 0 ? 'No heart rate spikes.' : `${times(r.hrSpikes, '1 heart rate spike', 'heart rate spikes')}.`)
  return parts.join(' ')
}
