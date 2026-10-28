import { describe, it, expect } from 'vitest'
import { wakeDateOf, recordSleepMode, onsetMin, onsetWords } from './sleepMode'

const at = (s: string) => new Date(s).getTime()

describe('Watch sleep mode on the iPhone', () => {
  it('an evening lights out belongs to the next morning, after midnight to the same one', () => {
    expect(wakeDateOf(at('2026-10-28T22:40:00'))).toBe('2026-10-29')
    expect(wakeDateOf(at('2026-10-29T00:30:00'))).toBe('2026-10-29')
  })
  it('lights out and get-up land on one night', () => {
    let log = recordSleepMode({}, 'lightsOut', at('2026-10-28T22:40:00'))
    log = recordSleepMode(log, 'up', at('2026-10-29T06:50:00'))
    expect(log['2026-10-29']).toEqual({ lightsOut: at('2026-10-28T22:40:00'), upAt: at('2026-10-29T06:50:00') })
  })
  it('time to fall asleep: lights out to sleep onset', () => {
    expect(onsetMin(at('2026-10-28T22:40:00'), at('2026-10-28T22:54:00'))).toBe(14)
    // the Watch saw sleep start a few minutes before the tap: zero, not negative
    expect(onsetMin(at('2026-10-28T22:40:00'), at('2026-10-28T22:35:00'))).toBe(0)
    // not the same night
    expect(onsetMin(at('2026-10-28T22:40:00'), at('2026-10-29T04:00:00'))).toBeNull()
    expect(onsetMin(at('2026-10-28T22:40:00'), at('2026-10-28T21:00:00'))).toBeNull()
    expect(onsetMin(null, at('2026-10-28T22:00:00'))).toBeNull()
    expect(onsetWords(14)).toBe('Fell asleep 14 min after lights out')
  })
})
