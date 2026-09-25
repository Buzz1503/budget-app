import { describe, expect, it } from 'vitest'
import { compareToBaseline, kneeStatus, worstLight, wristStatus } from './morning'
import { baseline, check } from './testUtil'

describe('compareToBaseline', () => {
  it('same, better, worse for the knee (per leg, strict)', () => {
    expect(compareToBaseline(check('d', 1, 1), baseline).knee).toBe('same')
    expect(compareToBaseline(check('d', 0, 1), baseline).knee).toBe('better')
    expect(compareToBaseline(check('d', 0, 2), baseline).knee).toBe('worse')
  })

  it('wrist swelling always counts as worse', () => {
    expect(compareToBaseline(check('d', 1, 1, 0, true), baseline).wrist).toBe('worse')
    expect(compareToBaseline(check('d', 1, 1, 2), baseline).wrist).toBe('worse')
    expect(compareToBaseline(check('d', 1, 1, 0), baseline).wrist).toBe('better')
  })
})

describe('kneeStatus', () => {
  it('green when clear', () => {
    expect(kneeStatus({ check: check('d'), baseline, lastSessionPain: 2, flareActive: false }).light).toBe('green')
  })
  it('red when worse than baseline, explaining the -20%', () => {
    const s = kneeStatus({ check: check('d', 2, 1), baseline, lastSessionPain: null, flareActive: false })
    expect(s.light).toBe('red')
    expect(s.message).toContain('20%')
  })
  it('red during flare mode', () => {
    expect(kneeStatus({ check: check('d'), baseline, lastSessionPain: null, flareActive: true }).light).toBe('red')
  })
  it('amber when last session went over the limit', () => {
    expect(kneeStatus({ check: check('d'), baseline, lastSessionPain: 4, flareActive: false }).light).toBe('amber')
  })
  it('amber with no check yet', () => {
    expect(kneeStatus({ check: null, baseline, lastSessionPain: null, flareActive: false }).light).toBe('amber')
  })
})

describe('wristStatus', () => {
  it('red on swelling or pain above 3', () => {
    expect(wristStatus({ check: check('d', 1, 1, 0, true), baseline, lastSessionPain: null }).light).toBe('red')
    expect(wristStatus({ check: check('d', 1, 1, 4), baseline: { ...baseline, wristPain: 4 }, lastSessionPain: null }).light).toBe('red')
  })
  it('amber at 3 (does not count towards unlock)', () => {
    expect(wristStatus({ check: check('d', 1, 1, 3), baseline: { ...baseline, wristPain: 3 }, lastSessionPain: null }).light).toBe('amber')
  })
  it('green at 2 or less', () => {
    expect(wristStatus({ check: check('d', 1, 1, 1), baseline, lastSessionPain: 2 }).light).toBe('green')
  })
})

it('worstLight picks the most severe', () => {
  expect(worstLight('green', 'amber')).toBe('amber')
  expect(worstLight('amber', 'red', 'green')).toBe('red')
  expect(worstLight()).toBe('green')
})
