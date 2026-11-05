import { describe, it, expect } from 'vitest'
import { sourceRows, stagesWords, countsForBaselines, OTHER_SOURCE_LABEL } from './sources'

const n = (date: string, sources: Array<[string, string, string[]]>) => ({ date, sources: sources.map(([name, cls, stages]) => ({ name, cls, stages })) })
const W: [string, string, string[]] = ["Buzz's Apple Watch", 'watch', ['awake', 'core', 'deep', 'rem']]
const A: [string, string, string[]] = ['AutoSleep', 'other', ['asleep', 'awake']]

describe('the sleep source picker', () => {
  it('lists only the sources Health returned, with nights in the last 30 days and their stages', () => {
    const nights = [n('2026-11-04', [W, A]), n('2026-11-03', [W]), n('2026-11-02', [A]), n('2026-11-01', [W]), n('2026-09-01', [['Old Ring', 'other', ['core']]])]
    const rows = sourceRows(nights, '2026-11-05')
    // most nights first; an old source outside the 30 days is not offered
    expect(rows.map((r) => r.name)).toEqual(["Buzz's Apple Watch", 'AutoSleep'])
    expect(rows[0]).toMatchObject({ nights: 3, stages: ['awake', 'rem', 'core', 'deep'] })
    expect(rows[1]).toMatchObject({ nights: 2, stages: ['awake', 'asleep'] })
    // nothing invented: no Health data, no rows
    expect(sourceRows([], '2026-11-05')).toEqual([])
    expect(sourceRows([{ date: '2026-11-04' }], '2026-11-05')).toEqual([])
  })

  it('says which stages a source gives', () => {
    expect(stagesWords(['awake', 'rem', 'core', 'deep'])).toBe('Awake, REM, Core, Deep')
    expect(stagesWords(['awake', 'asleep'])).toBe('Asleep and awake only, no stages')
    expect(stagesWords([])).toBe('No stage detail')
  })

  it('a fallback night is labelled Other source and left out of baselines', () => {
    expect(OTHER_SOURCE_LABEL).toBe('Other source')
    expect(countsForBaselines({ fallback: true })).toBe(false)
    expect(countsForBaselines({ fallback: false })).toBe(true)
    expect(countsForBaselines(null)).toBe(false)
  })
})
