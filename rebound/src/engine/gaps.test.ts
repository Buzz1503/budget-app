import { describe, expect, it } from 'vitest'
import { nextDouble } from './double'
import { kneeStatus, wristStatus } from './morning'
import { scoreQuestionnaire } from './questionnaires'
import { slotKey } from './slots'
import { baseline, check, session, set } from './testUtil'

describe('status edge cases', () => {
  it('knee amber when above 3 even at baseline', () => {
    const b = { ...baseline, kneeLeft: 4, kneeRight: 4 }
    expect(kneeStatus({ check: check('d', 4, 4), baseline: b, lastSessionPain: null, flareActive: false })).toMatchObject({ light: 'amber' })
  })
  it('wrist amber after a session over the limit, or worse than baseline', () => {
    expect(wristStatus({ check: check('d', 1, 1, 1), baseline, lastSessionPain: 5 }).light).toBe('amber')
    expect(wristStatus({ check: check('d', 1, 1, 2), baseline, lastSessionPain: null }).message).toContain('worse than baseline')
    expect(wristStatus({ check: null, baseline, lastSessionPain: null }).light).toBe('amber')
  })
})

describe('bodyweight holds', () => {
  const deadBug = { progression: 'reps' as const, startWeightKg: 0, startWeightNote: null, increment: { amount: 2, unit: 'reps' as const }, sets: 3, range: { min: 8, max: 8 } }
  it('holds the target with a pain flag', () => {
    const s = nextDouble({ ...deadBug, recent: [session(0, 10, [set(10, 2, { shoulder: 3 })])] })
    expect(s).toMatchObject({ reps: { min: 10, max: 10 }, change: 'hold', painFlag: true })
  })
  it('holds the target when a set falls short', () => {
    expect(nextDouble({ ...deadBug, recent: [session(0, 10, [set(10), set(9), set(10)])] }).change).toBe('hold')
  })
})

it('scoreQuestionnaire dispatches by type', () => {
  expect(scoreQuestionnaire('VISA-P', { q1: 100 })).toBe(10)
  expect(scoreQuestionnaire('PRWE', { p1: 5 })).toBe(5)
})

it('slot keys for holds and durations', () => {
  expect(slotKey({ exerciseId: 'forearm-side-plank', prescription: { kind: 'timed', sets: 3, holdSec: { min: 20, max: 30 } } })).toBe('forearm-side-plank:20-30s')
  expect(slotKey({ exerciseId: 'bike', prescription: { kind: 'duration', minutes: { min: 5, max: 5 } } })).toBe('bike:5-5min')
})
