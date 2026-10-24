import { describe, it, expect } from 'vitest'
import { coldStartWords } from './coldStart'

describe('cold start', () => {
  it('reads as the last launch and the median', () => {
    expect(coldStartWords([])).toBeNull()
    expect(coldStartWords([{ ms: 930 }])).toBe('Last launch 0.9 s')
    expect(coldStartWords([{ ms: 1200 }, { ms: 900 }, { ms: 1000 }])).toBe('Last launch 1.0 s, median of 3 launches 1.0 s')
  })
})
