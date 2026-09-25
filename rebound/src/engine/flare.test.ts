import { describe, expect, it } from 'vitest'
import { flarePhase, shouldSuggestFlare } from './flare'
import { baseline, check } from './testUtil'

describe('flare mode', () => {
  it('suggests flare after two worse knee mornings in a row', () => {
    expect(shouldSuggestFlare([check('2026-10-01', 3), check('2026-10-02', 2)], baseline)).toBe(true)
  })

  it('not if the mornings are not consecutive days', () => {
    expect(shouldSuggestFlare([check('2026-10-01', 3), check('2026-10-03', 2)], baseline)).toBe(false)
  })

  it('not if only one morning is worse', () => {
    expect(shouldSuggestFlare([check('2026-10-01', 3), check('2026-10-02', 1)], baseline)).toBe(false)
    expect(shouldSuggestFlare([check('2026-10-02', 3)], baseline)).toBe(false)
  })

  it('3 days isometric, then restart until ended', () => {
    const f = { startedAt: '2026-10-01', preFlareWeights: {}, endedAt: null }
    expect(flarePhase(f, '2026-10-01')).toEqual({ phase: 'isometric', day: 1, daysLeft: 3 })
    expect(flarePhase(f, '2026-10-03')).toEqual({ phase: 'isometric', day: 3, daysLeft: 1 })
    expect(flarePhase(f, '2026-10-04')).toEqual({ phase: 'restart' })
    expect(flarePhase({ ...f, endedAt: '2026-10-05' }, '2026-10-06')).toBeNull()
    expect(flarePhase(null, '2026-10-06')).toBeNull()
  })
})
