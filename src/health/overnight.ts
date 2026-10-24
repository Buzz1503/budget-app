// What happens inside one night, beyond the stages: how long it took to fall
// asleep, time awake after falling asleep, heart rate and HRV through the
// night, blood oxygen readings, breathing disturbances, and audio played in
// bed. Pure: every reading is passed in. Anything not recorded is null, never
// zero, and the screens say "no data".

import type { RawQuantity, RawSleep, SleepSegment } from './types'

export interface HeadphoneSample { start: number; end: number; value: number }

export interface Overnight {
  /** in bed (Sleep Focus or in-bed samples, any source), epoch ms */
  inBedStart: number | null
  /** minutes from in bed to the first sleep; an estimate */
  latencyMin: number | null
  /** awake minutes between first sleep and final wake */
  wasoMin: number | null
  /** awake stretches longer than 5 minutes */
  awakenings: number | null
  /** heart rate through the night: [minutes from the night's start, bpm], one a minute at most */
  hr: Array<[number, number]>
  /** HRV in the first and second half of the night, ms */
  hrvFirst: number | null
  hrvSecond: number | null
  /** every blood oxygen reading in the night: [minutes from start, %] */
  spo2: Array<[number, number]>
  /** Apple's breathing disturbances for the night, and Apple's elevated call when the sample carries one */
  breathing: number | null
  breathingElevated: boolean | null
  respRate: number | null
  /** headphone audio in bed */
  audio: AudioNight | null
}

export interface AudioNight {
  /** minutes of audio after getting into bed */
  minutesInBed: number
  /** minutes still playing after falling asleep */
  minutesAfterSleep: number
  /** when it stopped, epoch ms */
  stoppedAt: number
  /** average level, dB(A) */
  avgDb: number
}

export const OVERNIGHT = {
  awakeningMin: 5, // an awakening is longer than 5 minutes
  latencyMaxMin: 180, // longer than 3 h from in bed is not latency, it is a missing sample
  inBedLookbackH: 3, // in-bed samples up to 3 h before the night's first sample
  morningLightHour: 10, // daylight before 10 am
  loudAudioDb: 60,
}

const MIN = 60000
const r1 = (v: number) => Math.round(v * 10) / 10
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** The earliest in-bed sample (any source) that leads into the night, else the night's own start. */
export function inBedStart(raw: RawSleep[], night: { start: number; end: number }): number {
  const from = night.start - OVERNIGHT.inBedLookbackH * 3600000
  const inBed = raw.filter((s) => s.stage === 'inBed' && s.end > from && s.start < night.end && s.start <= night.start)
  return inBed.length ? Math.min(night.start, ...inBed.map((s) => s.start)) : night.start
}

const asleep = (s: SleepSegment) => s.stage !== 'awake'

/** Minutes from getting into bed to the first sleep. Null without stages or past 3 h. */
export function onsetLatency(segments: SleepSegment[] | undefined, inBed: number): number | null {
  const first = (segments || []).filter(asleep).sort((a, b) => a.start - b.start)[0]
  if (!first) return null
  const m = Math.max(0, (first.start - inBed) / MIN)
  return m > OVERNIGHT.latencyMaxMin ? null : Math.round(m)
}

/** Wake after sleep onset: awake minutes between the first and last sleep, and awakenings over 5 minutes. */
export function waso(segments: SleepSegment[] | undefined): { minutes: number; awakenings: number } | null {
  const segs = [...(segments || [])].sort((a, b) => a.start - b.start)
  const sleeps = segs.filter(asleep)
  if (!sleeps.length) return null
  const from = sleeps[0].start
  const to = Math.max(...sleeps.map((s) => s.end))
  // awake stretches inside the sleep, touching ones joined into one run
  const runs: Array<[number, number]> = []
  for (const s of segs) {
    if (s.stage !== 'awake' || s.end <= from || s.start >= to) continue
    const a = Math.max(s.start, from)
    const b = Math.min(s.end, to)
    const last = runs[runs.length - 1]
    if (last && a - last[1] <= MIN) last[1] = Math.max(last[1], b)
    else runs.push([a, b])
  }
  const minutes = runs.reduce((t, [a, b]) => t + (b - a) / MIN, 0)
  const awakenings = runs.filter(([a, b]) => (b - a) / MIN > OVERNIGHT.awakeningMin).length
  return { minutes: Math.round(minutes), awakenings }
}

/** Heart rate through the night, one value a minute (the median of that minute's samples). */
export function nightHeartRate(hr: RawQuantity[], start: number, end: number): Array<[number, number]> {
  const byMin = new Map<number, number[]>()
  for (const s of hr) {
    if (s.start < start || s.start > end || s.value <= 25) continue
    const m = Math.floor((s.start - start) / MIN)
    byMin.set(m, [...(byMin.get(m) || []), s.value])
  }
  return [...byMin.entries()].sort((a, b) => a[0] - b[0]).map(([m, v]) => [m, Math.round(median(v)!)])
}

/** Mean HRV in the first and the second half of the night. */
export function hrvHalves(hrv: RawQuantity[], start: number, end: number): { first: number | null; second: number | null } {
  const mid = (start + end) / 2
  const inN = hrv.filter((s) => s.start >= start && s.start <= end)
  const f = mean(inN.filter((s) => s.start < mid).map((s) => s.value))
  const s = mean(inN.filter((x) => x.start >= mid).map((x) => x.value))
  return { first: f == null ? null : Math.round(f), second: s == null ? null : Math.round(s) }
}

/** Every blood oxygen reading in the night, in %. */
export function nightSpo2(spo2: RawQuantity[], start: number, end: number): Array<[number, number]> {
  return spo2.filter((s) => s.start >= start && s.start <= end && s.value > 50 && s.value <= 100)
    .sort((a, b) => a.start - b.start).map((s) => [Math.round((s.start - start) / MIN), r1(s.value)])
}

/** The night's breathing disturbances: the reading that ends within the night or up to 3 h after waking. */
export function nightBreathing(samples: RawQuantity[], start: number, end: number): number | null {
  const hit = samples.filter((s) => s.end >= start && s.end <= end + 3 * 3600000).sort((a, b) => b.end - a.end)[0]
  return hit ? r1(hit.value) : null
}

/**
 * Apple's own "elevated" call for the night's breathing disturbances, when
 * the sample carries one in its metadata. Null when it does not: the value is
 * then shown without a judgement.
 */
export function breathingElevated(samples: Array<RawQuantity & { meta?: Record<string, string> }>, start: number, end: number): boolean | null {
  const hit = samples.filter((s) => s.end >= start && s.end <= end + 3 * 3600000).sort((a, b) => b.end - a.end)[0]
  if (!hit?.meta) return null
  const words = Object.values(hit.meta).join(' ')
  if (/not\s*elevated/i.test(words)) return false
  if (/elevated/i.test(words)) return true
  return null
}

/** Union of intervals, in minutes, inside [from, to]. */
function overlapMinutes(iv: Array<[number, number]>, from: number, to: number): number {
  const clipped = iv.map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  let total = 0
  let curA = -Infinity
  let curB = -Infinity
  for (const [a, b] of clipped) {
    if (a > curB) { if (curB > curA) total += curB - curA; curA = a; curB = b } else curB = Math.max(curB, b)
  }
  if (curB > curA) total += curB - curA
  return total / MIN
}

/**
 * Headphone audio in bed, from Health's headphone exposure samples: minutes
 * after getting into bed, minutes still playing after falling asleep, when it
 * stopped, and its average level. Null when nothing played in bed.
 */
export function audioInBed(samples: HeadphoneSample[], inBed: number, onset: number | null, wake: number): AudioNight | null {
  const inWin = samples.filter((s) => s.end > inBed && s.start < wake && Number.isFinite(s.value))
  if (!inWin.length) return null
  const iv = inWin.map((s) => [s.start, s.end] as [number, number])
  const minutesInBed = overlapMinutes(iv, inBed, wake)
  if (minutesInBed < 1) return null
  const after = onset != null ? overlapMinutes(iv, onset, wake) : 0
  let w = 0
  let sum = 0
  for (const s of inWin) {
    const d = Math.max(0, Math.min(s.end, wake) - Math.max(s.start, inBed))
    w += d
    sum += d * s.value
  }
  return {
    minutesInBed: Math.round(minutesInBed),
    minutesAfterSleep: Math.round(after),
    stoppedAt: Math.min(wake, Math.max(...inWin.map((s) => s.end))),
    avgDb: w ? r1(sum / w) : r1(mean(inWin.map((s) => s.value))!),
  }
}

/** Nocturnal heart rate dip: how far average sleeping heart rate sits below the daytime average, in %. */
export function hrDip(sleepingAvg: number | null | undefined, daytimeAvg: number | null | undefined): number | null {
  if (!sleepingAvg || !daytimeAvg || daytimeAvg <= 0) return null
  return r1(((daytimeAvg - sleepingAvg) / daytimeAvg) * 100)
}

/** Daylight minutes before 10 am on a day, from timestamped time-in-daylight samples. */
export function morningLight(samples: RawQuantity[], dayStart: number): number | null {
  if (!samples.length) return null
  const to = dayStart + OVERNIGHT.morningLightHour * 3600000
  let total = 0
  for (const s of samples) {
    if (s.end <= dayStart || s.start >= to) continue
    const span = Math.max(1, s.end - s.start)
    // the sample's minutes, pro rata for the part before 10 am
    const part = (Math.min(s.end, to) - Math.max(s.start, dayStart)) / span
    total += s.value * Math.max(0, Math.min(1, part))
  }
  return Math.round(total)
}

/** Everything above for one night. */
export function buildOvernight(input: {
  night: { start: number; end: number; segments?: SleepSegment[] }
  raw: RawSleep[]
  hr: RawQuantity[]
  hrv: RawQuantity[]
  spo2: RawQuantity[]
  breathing: Array<RawQuantity & { meta?: Record<string, string> }>
  resp: RawQuantity[]
  headphone: HeadphoneSample[]
}): Overnight {
  const { night } = input
  const bed = inBedStart(input.raw, night)
  const latency = onsetLatency(night.segments, bed)
  const firstSleep = (night.segments || []).filter(asleep).sort((a, b) => a.start - b.start)[0]?.start ?? null
  const w = waso(night.segments)
  const halves = hrvHalves(input.hrv, night.start, night.end)
  const resp = mean(input.resp.filter((s) => s.start >= night.start && s.start <= night.end).map((s) => s.value))
  return {
    inBedStart: bed,
    latencyMin: latency,
    wasoMin: w?.minutes ?? null,
    awakenings: w?.awakenings ?? null,
    hr: nightHeartRate(input.hr, night.start, night.end),
    hrvFirst: halves.first,
    hrvSecond: halves.second,
    spo2: nightSpo2(input.spo2, night.start, night.end),
    breathing: nightBreathing(input.breathing, night.start, night.end),
    breathingElevated: breathingElevated(input.breathing, night.start, night.end),
    respRate: resp == null ? null : r1(resp),
    audio: audioInBed(input.headphone, bed, firstSleep, night.end),
  }
}
