import type { MorningCheck } from '../data/records'
import type { LoggedSet, SlotSession } from './types'

export const set = (reps: number, rir: number | null = 2, pain: LoggedSet['pain'] = {}, weightKg: number | null = null): LoggedSet => ({
  weightKg,
  reps,
  holdSec: null,
  rir,
  pain,
})

export const hold = (sec: number): LoggedSet => ({ weightKg: 0, reps: null, holdSec: sec, rir: null, pain: {} })

export const session = (weightKg: number | null, target: number, sets: LoggedSet[], date = '2026-09-25'): SlotSession => ({
  date,
  weightKg,
  target,
  sets,
})

export const check = (date: string, kneeLeft = 1, kneeRight = 1, wristPain = 1, wristSwelling = false): MorningCheck => ({
  date,
  kneeLeft,
  kneeRight,
  wristPain,
  wristSwelling,
  createdAt: 0,
})

export const baseline = { kneeLeft: 1, kneeRight: 1, wristPain: 1, setAt: '2026-09-25' }
