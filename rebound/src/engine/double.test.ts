import { describe, expect, it } from 'vitest'
import { jointsOverLimit, nextDouble, type DoubleInput } from './double'
import { hold, session, set } from './testUtil'

const hipThrust = (over: Partial<DoubleInput> = {}): DoubleInput => ({
  progression: 'double',
  startWeightKg: 50,
  startWeightNote: null,
  increment: { amount: 5, unit: 'kg' },
  sets: 3,
  range: { min: 8, max: 12 },
  recent: [],
  ...over,
})

describe('nextDouble (double progression)', () => {
  it('starts at the plan start weight', () => {
    expect(nextDouble(hipThrust())).toMatchObject({ weightKg: 50, change: 'start', status: 'ready' })
  })

  it('asks for a day-1 weight when the plan says "set on day 1"', () => {
    const s = nextDouble(hipThrust({ startWeightKg: null, startWeightNote: 'Set on day 1 at 3 RIR' }))
    expect(s.status).toBe('needsWeight')
    expect(s.reason).toContain('Set on day 1 at 3 RIR')
  })

  it('adds the increment and drops to the bottom of the range when all sets hit the top at 2+ RIR', () => {
    const s = nextDouble(hipThrust({ recent: [session(50, 8, [set(12), set(12), set(12, 3)])] }))
    expect(s).toMatchObject({ weightKg: 55, reps: { min: 8, max: 12 }, change: 'up', light: 'green' })
    expect(s.reason).toBe('Up 5 kg: all sets hit 12 with 2+ in reserve. Back to 8 reps.')
  })

  it('does not add weight if any top set had under 2 in reserve', () => {
    expect(nextDouble(hipThrust({ recent: [session(50, 8, [set(12), set(12), set(12, 1)])] })).change).toBe('hold')
  })

  it('does not add weight if fewer sets than prescribed were done', () => {
    expect(nextDouble(hipThrust({ recent: [session(50, 8, [set(12), set(12)])] })).change).toBe('hold')
  })

  it('holds and aims for one more rep while inside the range', () => {
    const s = nextDouble(hipThrust({ recent: [session(50, 8, [set(11), set(10), set(9)])] }))
    expect(s).toMatchObject({ weightKg: 50, reps: { min: 10, max: 12 }, change: 'hold' })
  })

  it('drops 10% after two sessions in a row below the bottom of the range', () => {
    const s = nextDouble(
      hipThrust({
        recent: [session(60, 8, [set(8), set(7), set(6)], '2026-09-30'), session(60, 8, [set(8), set(8), set(7)], '2026-09-26')],
      }),
    )
    expect(s).toMatchObject({ weightKg: 55, change: 'down', light: 'red' })
  })

  it('one session below the range only holds', () => {
    const s = nextDouble(hipThrust({ recent: [session(60, 8, [set(7)], '2026-09-30'), session(60, 8, [set(9)], '2026-09-26')] }))
    expect(s.change).toBe('hold')
  })

  it('rounds -10% to the increment', () => {
    // curl 17.5 * 0.9 = 15.75 -> 15 (2.5 kg steps)
    const s = nextDouble(
      hipThrust({
        increment: { amount: 2.5, unit: 'kg' },
        range: { min: 10, max: 15 },
        recent: [session(17.5, 10, [set(9)]), session(17.5, 10, [set(8)])],
      }),
    )
    expect(s.weightKg).toBe(15)
  })

  it('pain flag holds load and surfaces the swap', () => {
    const s = nextDouble(hipThrust({ recent: [session(50, 8, [set(12), set(12, 2, { wrist: 4 }), set(12)])] }))
    expect(s).toMatchObject({ weightKg: 50, change: 'hold', painFlag: true })
    expect(s.reason).toContain('wrist 4/10')
  })

  it('shoulder flags above 2, wrist and knee above 3', () => {
    expect(jointsOverLimit([set(10, 2, { shoulder: 3, wrist: 3, knee: 3 })])).toEqual([{ joint: 'shoulder', pain: 3 }])
    expect(jointsOverLimit([set(10, 2, { shoulder: 2 })])).toEqual([])
  })
})

describe('nextDouble (bodyweight)', () => {
  it('dead bug adds 2 reps once every set hits the target', () => {
    const s = nextDouble({
      progression: 'reps',
      startWeightKg: 0,
      startWeightNote: 'Bodyweight',
      increment: { amount: 2, unit: 'reps' },
      sets: 3,
      range: { min: 8, max: 8 },
      recent: [session(0, 8, [set(8), set(8), set(8)])],
    })
    expect(s).toMatchObject({ reps: { min: 10, max: 10 }, change: 'up' })
  })

  it('side plank adds 5 sec once every hold hits the target', () => {
    const s = nextDouble({
      progression: 'hold',
      startWeightKg: 0,
      startWeightNote: 'Bodyweight',
      increment: { amount: 5, unit: 'sec' },
      sets: 3,
      range: { min: 20, max: 30 },
      recent: [session(0, 20, [hold(20), hold(22), hold(20)])],
    })
    expect(s).toMatchObject({ holdSec: 25, change: 'up' })
  })

  it('side plank starts at the bottom of the range', () => {
    const s = nextDouble({
      progression: 'hold',
      startWeightKg: 0,
      startWeightNote: null,
      increment: { amount: 5, unit: 'sec' },
      sets: 3,
      range: { min: 20, max: 30 },
      recent: [],
    })
    expect(s.holdSec).toBe(20)
  })
})
