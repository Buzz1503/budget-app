import { describe, expect, it } from 'vitest'
import { nextKneeLift, repBlockForWeek, stage2Label, stage2Week, type KneeLiftInput } from './knee'
import { session, set } from './testUtil'

describe('knee Stage 2 weeks and blocks', () => {
  it('counts weeks from the Stage 2 start date', () => {
    expect(stage2Week('2026-09-25', '2026-09-25')).toBe(1)
    expect(stage2Week('2026-09-25', '2026-10-01')).toBe(1)
    expect(stage2Week('2026-09-25', '2026-10-02')).toBe(2)
    expect(stage2Week('2026-09-25', '2026-10-09')).toBe(3)
  })

  it.each([
    [1, 3, 15], [2, 3, 15], [3, 3, 12], [4, 3, 12], [5, 4, 10], [6, 4, 10],
    [7, 4, 8], [9, 4, 8], [10, 4, 6], [12, 4, 6], [15, 4, 6],
  ])('week %i is %i x %i', (week, sets, reps) => {
    expect(repBlockForWeek(week)).toMatchObject({ sets, reps })
  })

  it('labels the week', () => {
    expect(stage2Label(3)).toBe('Heavy slow resistance, week 3 of 12: 3 x 12')
  })
})

const legExt = (over: Partial<KneeLiftInput> = {}): KneeLiftInput => ({
  name: 'Leg extension',
  startWeightKg: 30,
  incrementKg: 2.5,
  week: 1,
  lastWeek: 1,
  last: session(30, 15, [set(15), set(15), set(15, 2, { knee: 1 })]),
  morning: 'same',
  flare: null,
  ...over,
})

describe('nextKneeLift', () => {
  it('starts at the plan start weight with the week block', () => {
    const s = nextKneeLift(legExt({ last: null, lastWeek: null }))
    expect(s).toMatchObject({ weightKg: 30, sets: 3, reps: { min: 15, max: 15 }, change: 'start' })
  })

  it('adds the increment when every criterion is met', () => {
    const s = nextKneeLift(legExt())
    expect(s.weightKg).toBe(32.5)
    expect(s.change).toBe('up')
    expect(s.light).toBe('green')
    expect(s.reason).toBe('Up 2.5 kg: all reps hit, pain 1/10, knee check clear.')
  })

  it('leg press goes up 5 kg', () => {
    const s = nextKneeLift(legExt({ startWeightKg: 60, incrementKg: 5, last: session(60, 15, [set(15), set(15), set(15)]) }))
    expect(s.weightKg).toBe(65)
  })

  it('accepts a better morning check', () => {
    expect(nextKneeLift(legExt({ morning: 'better' })).change).toBe('up')
  })

  it('holds when a target rep is missed', () => {
    const s = nextKneeLift(legExt({ last: session(30, 15, [set(15), set(14), set(15)]) }))
    expect(s).toMatchObject({ weightKg: 30, change: 'hold', light: 'amber' })
    expect(s.reason).toContain('not every set hit 15')
  })

  it('holds when the last set has under 2 in reserve', () => {
    const s = nextKneeLift(legExt({ last: session(30, 15, [set(15, 3), set(15, 2), set(15, 1)]) }))
    expect(s.change).toBe('hold')
    expect(s.reason).toContain('last set under 2 in reserve')
  })

  it('only the last set RIR matters', () => {
    expect(nextKneeLift(legExt({ last: session(30, 15, [set(15, 0), set(15, 1), set(15, 2)]) })).change).toBe('up')
  })

  it('holds when knee pain goes above 3', () => {
    const s = nextKneeLift(legExt({ last: session(30, 15, [set(15, 2, { knee: 4 }), set(15), set(15)]) }))
    expect(s.change).toBe('hold')
    expect(s.reason).toContain('knee pain 4/10')
  })

  it('allows knee pain of exactly 3', () => {
    expect(nextKneeLift(legExt({ last: session(30, 15, [set(15, 2, { knee: 3 }), set(15), set(15)]) })).change).toBe('up')
  })

  it('holds without a morning check', () => {
    const s = nextKneeLift(legExt({ morning: null }))
    expect(s.change).toBe('hold')
    expect(s.reason).toContain('no morning check yet')
  })

  it('drops 20% and 3 sets after a worse morning, even in a 4-set block', () => {
    const s = nextKneeLift(legExt({ week: 5, lastWeek: 5, last: session(40, 10, [set(10), set(10), set(10), set(10)]), morning: 'worse' }))
    expect(s).toMatchObject({ weightKg: 32.5, sets: 3, reps: { min: 10, max: 10 }, change: 'down', light: 'red' })
  })

  it('rounds -20% to the machine increment', () => {
    // 62.5 * 0.8 = 50
    expect(nextKneeLift(legExt({ last: session(62.5, 15, [set(15)]), morning: 'worse' })).weightKg).toBe(50)
    // leg press 85 * 0.8 = 68 -> 70 (5 kg steps)
    expect(nextKneeLift(legExt({ incrementKg: 5, last: session(85, 15, [set(15)]), morning: 'worse' })).weightKg).toBe(70)
  })

  it('raises about 8% when the rep block changes', () => {
    // 40 * 1.08 = 43.2 -> 42.5
    const s = nextKneeLift(legExt({ week: 3, lastWeek: 2, last: session(40, 15, [set(15), set(15), set(15)]) }))
    expect(s).toMatchObject({ weightKg: 42.5, sets: 3, reps: { min: 12, max: 12 }, change: 'up' })
    expect(s.reason).toContain('new block 3 x 12')
  })

  it('block change raises at least one increment', () => {
    // 30 * 1.08 = 32.4 -> 32.5; leg press 60 * 1.08 = 64.8 -> 65
    expect(nextKneeLift(legExt({ week: 3, lastWeek: 2 })).weightKg).toBe(32.5)
    const lp = nextKneeLift(legExt({ incrementKg: 5, week: 3, lastWeek: 2, last: session(60, 15, [set(15), set(15), set(15)]) }))
    expect(lp.weightKg).toBe(65)
  })

  it('block change holds load when criteria are not met', () => {
    const s = nextKneeLift(legExt({ week: 3, lastWeek: 2, last: session(40, 15, [set(15), set(13), set(15)]) }))
    expect(s).toMatchObject({ weightKg: 40, reps: { min: 12, max: 12 }, change: 'hold' })
    expect(s.reason).toContain('New block 3 x 12')
  })

  it('pauses knee lifts during the flare isometric phase', () => {
    const s = nextKneeLift(legExt({ flare: { phase: 'isometric', daysLeft: 2 } }))
    expect(s.status).toBe('paused')
    expect(s.reason).toContain('back in 2 days')
  })

  it('restarts at -20% of the pre-flare weight', () => {
    const s = nextKneeLift(legExt({ flare: { phase: 'restart', preFlareWeightKg: 50 } }))
    expect(s).toMatchObject({ weightKg: 40, change: 'down' })
  })
})
