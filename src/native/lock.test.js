import { describe, it, expect } from 'vitest'
import { shouldLock } from './lock'

describe('Face ID lock', () => {
  const t = 1_000_000
  it('never locks when it is off', () => {
    expect(shouldLock({ enabled: false, launch: true })).toBe(false)
  })
  it('always asks on launch', () => {
    expect(shouldLock({ enabled: true, graceSec: 900, launch: true })).toBe(true)
  })
  it('asks on return only after the grace period', () => {
    expect(shouldLock({ enabled: true, graceSec: 0, backgroundedAt: t, now: t + 1 })).toBe(true)
    expect(shouldLock({ enabled: true, graceSec: 60, backgroundedAt: t, now: t + 59_000 })).toBe(false)
    expect(shouldLock({ enabled: true, graceSec: 60, backgroundedAt: t, now: t + 60_000 })).toBe(true)
    expect(shouldLock({ enabled: true, graceSec: 900, backgroundedAt: t, now: t + 5 * 60_000 })).toBe(false)
  })
})
