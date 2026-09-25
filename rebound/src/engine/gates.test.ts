import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { kneeStage3Gate, wristDays, wristGate } from './gates'
import { baseline, check } from './testUtil'

const run = (end: string, n: number, pain = 1) =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(end, -i), maxPain: pain, swelling: false }))

describe('wristGate', () => {
  it('unlocks after 14 days in a row at 2/10 or less', () => {
    const g = wristGate(run('2026-10-20', 14, 2), '2026-10-20')
    expect(g).toMatchObject({ streak: 14, eligible: true, regress: false })
  })

  it('13 days is not enough', () => {
    expect(wristGate(run('2026-10-20', 13), '2026-10-20').eligible).toBe(false)
  })

  it('a day at 3/10 resets the streak', () => {
    const days = run('2026-10-20', 20)
    days[5] = { ...days[5]!, maxPain: 3 }
    expect(wristGate(days, '2026-10-20').streak).toBe(5)
  })

  it('swelling resets the streak', () => {
    const days = run('2026-10-20', 20)
    days[2] = { ...days[2]!, swelling: true }
    expect(wristGate(days, '2026-10-20').streak).toBe(2)
  })

  it('a missing day breaks the streak', () => {
    const days = run('2026-10-20', 20).filter((d) => d.date !== '2026-10-15')
    expect(wristGate(days, '2026-10-20').streak).toBe(5)
  })

  it('today without a record yet counts from yesterday', () => {
    expect(wristGate(run('2026-10-19', 14), '2026-10-20').eligible).toBe(true)
  })

  it('regresses on pain above 3 or swelling', () => {
    expect(wristGate([{ date: '2026-10-20', maxPain: 4, swelling: false }], '2026-10-20')).toMatchObject({ regress: true, regressReason: 'Wrist pain 4/10' })
    expect(wristGate([{ date: '2026-10-20', maxPain: 0, swelling: true }], '2026-10-20').regress).toBe(true)
    expect(wristGate([{ date: '2026-10-20', maxPain: 3, swelling: false }], '2026-10-20').regress).toBe(false)
  })

  it('merges morning checks and session pain, worst of the day', () => {
    const days = wristDays([check('2026-10-20', 0, 0, 1)], [{ date: '2026-10-20', pain: 3 }, { date: '2026-10-19', pain: 2 }])
    expect(days).toEqual([
      { date: '2026-10-19', maxPain: 2, swelling: false },
      { date: '2026-10-20', maxPain: 3, swelling: false },
    ])
  })
})

describe('kneeStage3Gate', () => {
  const base = {
    today: '2026-12-01',
    stage2Start: '2026-09-25',
    declineSquat: { date: '2026-11-30', pain: 2 },
    legPress4x6Dates: ['2026-11-10', '2026-11-12'],
    checks: [check('2026-11-20')],
    baseline,
  }

  it('all met', () => {
    expect(kneeStage3Gate(base).allMet).toBe(true)
  })

  it('needs 8 weeks of Stage 2', () => {
    const g = kneeStage3Gate({ ...base, stage2Start: '2026-10-10' })
    expect(g.criteria[0]).toMatchObject({ met: false, detail: '7 of 8 weeks' })
    expect(g.allMet).toBe(false)
  })

  it('needs a decline squat test at 2/10 or less', () => {
    expect(kneeStage3Gate({ ...base, declineSquat: null }).criteria[1]?.met).toBe(false)
    expect(kneeStage3Gate({ ...base, declineSquat: { date: '2026-11-30', pain: 3 } }).criteria[1]?.met).toBe(false)
  })

  it('a worse morning restarts the 2-week clock', () => {
    const g = kneeStage3Gate({ ...base, checks: [check('2026-11-25', 3, 1)] })
    expect(g.criteria[2]).toMatchObject({ met: false, detail: '6 of 14 days' })
  })

  it('needs a 4 x 6 leg press first', () => {
    expect(kneeStage3Gate({ ...base, legPress4x6Dates: [] }).criteria[2]).toMatchObject({ met: false, detail: 'No 4 x 6 leg press yet' })
  })
})
