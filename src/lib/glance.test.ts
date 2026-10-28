import { describe, it, expect } from 'vitest'
import { recoveryAnswer, toneFor, deltaText, chip, statusOf, progressWords, richParts, TONE_COLOR, betterOf } from './glance'

describe('delta chip colour follows the metric', () => {
  it('resting HR down is better, up is worse', () => {
    expect(toneFor('rhr', -2)).toBe('better')
    expect(toneFor('rhr', 2)).toBe('worse')
  })
  it('HRV up is better', () => {
    expect(toneFor('hrv', 26)).toBe('better')
    expect(toneFor('hrv', -5)).toBe('worse')
  })
  it('fat down, muscle up, deep sleep up, restlessness down', () => {
    expect(toneFor('fatMass', -0.4)).toBe('better')
    expect(toneFor('bodyFat', 0.3)).toBe('worse')
    expect(toneFor('muscleMass', 0.5)).toBe('better')
    expect(toneFor('skeletalMuscle', -0.5)).toBe('worse')
    expect(toneFor('deepSleep', 12)).toBe('better')
    expect(toneFor('restlessness', -3)).toBe('better')
  })
  it('no change and metrics with no better side are grey', () => {
    expect(toneFor('hrv', 0)).toBe('same')
    expect(toneFor('weight', -1.2)).toBe('same')
    expect(toneFor('unknown', 4)).toBe('same')
    expect(toneFor('hrv', 0.4, 0.5)).toBe('same')
    expect(betterOf('weight')).toBeNull()
  })
  it('maps tones to accent, amber and grey', () => {
    expect(TONE_COLOR.better).toBe('var(--good)')
    expect(TONE_COLOR.worse).toBe('var(--warn)')
    expect(TONE_COLOR.same).toBe('var(--text-3)')
  })
})

describe('stat row formatting', () => {
  it('writes the arrow, size and unit', () => {
    expect(deltaText(26, 'ms')).toBe('▲ 26 ms')
    expect(deltaText(-2)).toBe('▼ 2')
    expect(deltaText(-0.47, 'kg', 1)).toBe('▼ 0.5 kg')
    expect(deltaText(0.04, 'kg', 1)).toBe('0 kg')
    expect(deltaText(null)).toBe('')
  })
  it('a chip that rounds to zero is grey', () => {
    expect(chip('rhr', 0.3)).toEqual({ text: '0', tone: 'same' })
    expect(chip('rhr', 2)).toEqual({ text: '▲ 2', tone: 'worse' })
    expect(chip('hrv', null)).toBeNull()
  })
})

describe('status dot mapping', () => {
  it('maps every engine label to four words', () => {
    expect(statusOf('Clear change')).toBe('Clear')
    expect(statusOf('Clear difference')).toBe('Clear')
    expect(statusOf('Clear')).toBe('Clear')
    expect(statusOf('Possible change')).toBe('Possible')
    expect(statusOf('Possible difference')).toBe('Possible')
    expect(statusOf('Within normal fluctuation')).toBe('Normal')
    expect(statusOf('Unclear')).toBe('Normal')
    expect(statusOf('Too early')).toBe('Early')
    expect(statusOf(null)).toBe('Early')
  })
})

describe('progress row', () => {
  it('collapses locked items into one line', () => {
    expect(progressWords(3, 'comparison', 4, 5, 'more sessions')).toBe('3 comparisons unlock with more sessions · 4 of 5')
    expect(progressWords(1, 'chart', 9, 5)).toBe('1 chart unlocks with more data · 5 of 5')
  })
})

describe('numbers in sentences', () => {
  const nums = (s: string) => richParts(s).filter((p) => p.t === 'num').map((p) => `${p.v}${p.unit ?? ''}`)
  it('picks out numbers and their units', () => {
    expect(nums('HRV is up 26 ms since you started.')).toEqual(['26 ms'])
    expect(nums('Heart rate dropped 50 bpm in 2 min')).toEqual(['50 bpm', '2 min'])
    expect(nums('Body fat 28.1% and 92.5 kg')).toEqual(['28.1%', '92.5 kg'])
  })
  it('leaves times, dates and names alone', () => {
    expect(nums('At 09:30 on 28 Oct 2026')).toEqual([])
    expect(nums('MOTS-c and SS-31 and B12')).toEqual([])
  })
  it('keeps the whole sentence', () => {
    const s = 'Resting HR 65 bpm, 2 lower.'
    expect(richParts(s).map((p) => p.v + (p.unit ?? '')).join('')).toBe(s)
  })
})

describe('recovery answer', () => {
  it('names the biggest move against usual', () => {
    expect(recoveryAnswer({ hrv: { delta: 13 }, rhr: { delta: null }, sleep: { delta: -1.5 } })).toBe('Sleep is down 1.5 h on your usual.')
    expect(recoveryAnswer({ hrv: { delta: 26 }, rhr: { delta: 1 } })).toBe('HRV is up 26 ms on your usual.')
    expect(recoveryAnswer({ hrv: { delta: 2 }, rhr: { delta: 1 } })).toBe('Everything is close to your usual.')
  })
})
