import { describe, it, expect, beforeEach } from 'vitest'
import { entryFrom, addEntry, errorReport, logError, readErrors, clearErrors, MAX_ERRORS } from './errorLog'

describe('the local error log', () => {
  beforeEach(() => { try { localStorage.clear() } catch { /* node */ } })

  it('keeps what failed and where, trimmed, never the data', () => {
    const e = entryFrom(new TypeError('x is undefined'), { where: 'sync', kind: 'sync' }, new Date('2026-10-24T08:00:00Z'))
    expect(e).toMatchObject({ at: '2026-10-24T08:00:00.000Z', kind: 'sync', where: 'sync', name: 'TypeError', message: 'x is undefined' })
    expect(entryFrom('a'.repeat(1000)).message).toHaveLength(300)
    expect(entryFrom({ weird: true }).message).toBe('Unknown error')
  })

  it('counts a repeat within a minute instead of filling up, and keeps the last 200', () => {
    const a = entryFrom('boom', { where: 'x' }, new Date('2026-10-24T08:00:00Z'))
    const b = entryFrom('boom', { where: 'x' }, new Date('2026-10-24T08:00:30Z'))
    const list = addEntry(addEntry([], a), b)
    expect(list).toHaveLength(1)
    expect(list[0].count).toBe(2)
    let many = []
    for (let i = 0; i < MAX_ERRORS + 20; i++) many = addEntry(many, entryFrom(`e${i}`, {}, new Date(Date.UTC(2026, 9, 24, 0, i))))
    expect(many).toHaveLength(MAX_ERRORS)
    expect(many[0].message).toBe('e20')
  })

  it('exports as plain text to paste', () => {
    const text = errorReport([{ ...entryFrom(new Error('Sync failed'), { kind: 'sync', where: 'health' }, new Date('2026-10-24T08:00:00Z')), count: 3 }], { version: '1.0 (42)' })
    expect(text.startsWith('Pepito+ error log\nVersion 1.0 (42)\n1 entries')).toBe(true)
    expect(text).toContain('2026-10-24T08:00:00.000Z (x3) sync in health')
    expect(text).toContain('Error: Sync failed')
  })

  it('logError never throws and is read back', () => {
    if (typeof localStorage === 'undefined') return
    logError(new Error('one'), { where: 'test' })
    expect(readErrors().at(-1).message).toBe('one')
    clearErrors()
    expect(readErrors()).toEqual([])
  })
})
