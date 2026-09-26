import { describe, it, expect } from 'vitest'
import { GLOSSARY, glossaryFor } from './glossary'

const log = (siteId, date) => ({ id: `${siteId}-${date}`, siteId, date, loggedAt: `${date}T10:00:00` })
const today = '2026-02-10'

describe('glossary', () => {
  it('explains the jargon this app uses, in one plain sentence each', () => {
    for (const key of ['subq', 'im', 'codraw', 'titration', 'units']) {
      const e = glossaryFor(key)
      expect(e, key).toBeTruthy()
      expect(e.term, key).toBeTruthy()
      expect(e.plain.length, key).toBeGreaterThan(30)
    }
    expect(glossaryFor('nope')).toBeNull()
  })

  it('never leaves an entry without a term or explanation', () => {
    for (const [k, v] of Object.entries(GLOSSARY)) {
      expect(v.term, k).toBeTruthy()
      expect(v.plain, k).toBeTruthy()
    }
  })
})
