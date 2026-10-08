import { describe, it, expect } from 'vitest'
import {
  SYMPTOMS, applyCheck, statusOf, gapsOf, dueForCheck, daysOpen, timeToResolve, peakSeverity, direction,
  symptomTimeline, symptomDays, prefillSymptoms, photoStrip, openedOn, checksOf, openReactions, toAbandon,
  abandonDate, describeReaction, addDays, diffDays, currentSeverity,
} from './reactionCourse'

const rx = (...checks) => checks.reduce(
  (r, [date, severity, symptoms]) => applyCheck(r, { date, severity, symptoms }), null,
)

describe('symptom chips', () => {
  it('are the ten in the brief, in order', () => {
    expect(SYMPTOMS.map((s) => s.label)).toEqual([
      'Redness', 'Itching', 'Swelling', 'Lump or hardness', 'Pain or soreness', 'Heat',
      'Bruising', 'Welt or hive', 'Bleeding', 'Skin staining or discolouration',
    ])
  })
})

describe('lifecycle', () => {
  it('logging a reaction opens it', () => {
    const r = rx(['2026-10-01', 'mild', ['redness']])
    expect(statusOf(r, '2026-10-01')).toBe('open')
    expect(openedOn(r)).toBe('2026-10-01')
  })

  it('a site looked at and found clear never opens', () => {
    const r = rx(['2026-10-01', 'none'])
    expect(statusOf(r, '2026-10-02')).toBeNull()
  })

  it('Gone resolves immediately, on that day', () => {
    const r = rx(['2026-10-01', 'moderate', ['redness', 'heat']], ['2026-10-03', 'none'])
    expect(statusOf(r, '2026-10-03')).toBe('resolved')
    expect(r.goneAt).toBe('2026-10-03')
    expect(statusOf(r, '2026-12-25')).toBe('resolved') // and stays so
  })

  it('a Gone check carries no symptoms', () => {
    const r = rx(['2026-10-01', 'mild', ['itching']], ['2026-10-02', 'none', ['itching']])
    expect(checksOf(r).at(-1).symptoms).toEqual([])
  })

  it('a missed day is a gap and nothing more — it does not resolve or abandon', () => {
    const r = rx(['2026-10-01', 'mild', ['redness']], ['2026-10-04', 'mild', ['redness']])
    expect(gapsOf(r, '2026-10-04')).toEqual(['2026-10-02', '2026-10-03'])
    expect(statusOf(r, '2026-10-04')).toBe('open')
    expect(statusOf(r, '2026-10-05')).toBe('open')
    expect(r.goneAt).toBeNull()
  })

  it('today is not a gap until it is over', () => {
    const r = rx(['2026-10-01', 'mild'])
    expect(gapsOf(r, '2026-10-02')).toEqual([])
    expect(gapsOf(r, '2026-10-03')).toEqual(['2026-10-02'])
  })

  it('seven days with no check abandons it; six do not', () => {
    const r = rx(['2026-10-01', 'mild', ['redness']])
    expect(statusOf(r, '2026-10-07')).toBe('open')
    expect(statusOf(r, '2026-10-08')).toBe('abandoned')
    expect(abandonDate(r, '2026-10-20')).toBe('2026-10-08')
  })

  it('the clock runs from the last check, not from the start', () => {
    const r = rx(['2026-10-01', 'mild'], ['2026-10-06', 'mild'])
    expect(statusOf(r, '2026-10-12')).toBe('open')
    expect(statusOf(r, '2026-10-13')).toBe('abandoned')
  })

  it('abandoned keeps its record and stops being due', () => {
    const r = rx(['2026-10-01', 'moderate', ['swelling']])
    expect(dueForCheck(r, '2026-10-09')).toBe(false)
    expect(r.ratings).toHaveLength(1)
    expect(peakSeverity(r)).toBe('moderate')
  })

  it('abandonment is written down once', () => {
    const r = { ...rx(['2026-10-01', 'mild']), injectionRecordId: 'a' }
    const list = toAbandon({ reactions: [r] }, '2026-10-09')
    expect(list).toEqual([{ injectionRecordId: 'a', abandonedAt: '2026-10-08' }])
    expect(toAbandon({ reactions: [{ ...r, abandonedAt: '2026-10-08' }] }, '2026-10-09')).toEqual([])
  })

  it('a late check on an abandoned reaction brings it back', () => {
    const r = { ...rx(['2026-10-01', 'mild']), abandonedAt: '2026-10-08' }
    const back = applyCheck(r, { date: '2026-10-12', severity: 'mild' })
    expect(statusOf(back, '2026-10-12')).toBe('open')
  })

  it('one check per day: a second answer replaces the first', () => {
    const r = rx(['2026-10-01', 'mild', ['redness']], ['2026-10-02', 'moderate', ['redness']], ['2026-10-02', 'mild', ['itching']])
    expect(checksOf(r)).toHaveLength(2)
    expect(checksOf(r)[1]).toEqual({ date: '2026-10-02', severity: 'mild', symptoms: ['itching'] })
  })

  it('correcting today from Gone to still-there reopens it', () => {
    const r = rx(['2026-10-01', 'mild'], ['2026-10-02', 'none'], ['2026-10-02', 'mild', ['redness']])
    expect(r.goneAt).toBeNull()
    expect(statusOf(r, '2026-10-02')).toBe('open')
  })

  it('due for a check only until today has been answered', () => {
    const r = rx(['2026-10-01', 'mild'])
    expect(dueForCheck(r, '2026-10-02')).toBe(true)
    expect(dueForCheck(applyCheck(r, { date: '2026-10-02', severity: 'mild' }), '2026-10-02')).toBe(false)
  })

  it('lists only open reactions, oldest first', () => {
    const mk = (id, ...c) => ({ ...rx(...c), injectionRecordId: id })
    const reactions = [
      mk('b', ['2026-10-05', 'mild']), mk('a', ['2026-10-03', 'mild']),
      mk('done', ['2026-10-01', 'mild'], ['2026-10-02', 'none']), mk('old', ['2026-09-01', 'mild']),
    ]
    const records = ['a', 'b', 'done', 'old'].map((id) => ({ id }))
    expect(openReactions({ records, reactions }, '2026-10-06').map((x) => x.record.id)).toEqual(['a', 'b'])
  })
})

describe('computed values', () => {
  it('days open counts from the log date, to today while open', () => {
    const r = rx(['2026-10-01', 'mild'], ['2026-10-04', 'mild'])
    expect(daysOpen(r, '2026-10-04')).toBe(3)
    expect(daysOpen(rx(['2026-10-04', 'mild']), '2026-10-04')).toBe(0)
  })

  it('days open stops counting once it has resolved', () => {
    const r = rx(['2026-10-01', 'mild'], ['2026-10-05', 'none'])
    expect(daysOpen(r, '2026-11-30')).toBe(4)
  })

  it('time to resolve is the log date to the first Gone check', () => {
    expect(timeToResolve(rx(['2026-10-01', 'mild'], ['2026-10-02', 'mild'], ['2026-10-06', 'none']))).toBe(5)
    expect(timeToResolve(rx(['2026-10-01', 'mild']))).toBeNull()
  })

  it('time to resolve uses the first Gone, not a later one', () => {
    const r = rx(['2026-10-01', 'mild'], ['2026-10-03', 'none'], ['2026-10-05', 'none'])
    expect(timeToResolve(r)).toBe(2)
  })

  it('peak is the worst it ever got, and null if it never rose', () => {
    expect(peakSeverity(rx(['2026-10-01', 'mild'], ['2026-10-02', 'severe'], ['2026-10-03', 'mild']))).toBe('severe')
    expect(peakSeverity(rx(['2026-10-01', 'none']))).toBeNull()
  })

  it('current severity is the last check', () => {
    expect(currentSeverity(rx(['2026-10-01', 'severe'], ['2026-10-02', 'mild']))).toBe('mild')
  })

  describe('direction', () => {
    it('is null below two checks', () => {
      expect(direction(null)).toBeNull()
      expect(direction(rx(['2026-10-01', 'severe']))).toBeNull()
    })
    it('improving, stable, worsening', () => {
      expect(direction(rx(['2026-10-01', 'severe'], ['2026-10-02', 'moderate']))).toBe('improving')
      expect(direction(rx(['2026-10-01', 'mild'], ['2026-10-02', 'mild']))).toBe('stable')
      expect(direction(rx(['2026-10-01', 'mild'], ['2026-10-02', 'moderate']))).toBe('worsening')
    })
    it('looks at the last three checks only', () => {
      const r = rx(['2026-10-01', 'mild'], ['2026-10-02', 'severe'], ['2026-10-03', 'moderate'], ['2026-10-04', 'mild'])
      expect(direction(r)).toBe('improving') // severe -> moderate -> mild
      const flare = rx(['2026-10-01', 'severe'], ['2026-10-02', 'mild'], ['2026-10-03', 'mild'], ['2026-10-04', 'moderate'])
      expect(direction(flare)).toBe('worsening') // the old severe is out of the window
    })
    it('a wobble that ends where it began is stable', () => {
      expect(direction(rx(['2026-10-01', 'moderate'], ['2026-10-02', 'severe'], ['2026-10-03', 'moderate']))).toBe('stable')
    })
  })

  it('the timeline keeps each day\'s own symptom set', () => {
    const r = rx(
      ['2026-10-01', 'moderate', ['redness', 'itching', 'heat']],
      ['2026-10-02', 'moderate', ['redness', 'itching']],
      ['2026-10-03', 'mild', ['redness']],
    )
    expect(symptomTimeline(r)).toEqual([
      { date: '2026-10-01', severity: 'moderate', symptoms: ['redness', 'itching', 'heat'] },
      { date: '2026-10-02', severity: 'moderate', symptoms: ['redness', 'itching'] },
      { date: '2026-10-03', severity: 'mild', symptoms: ['redness'] },
    ])
    const days = Object.fromEntries(symptomDays(r).map((s) => [s.id, s.dates]))
    expect(days.heat).toEqual(['2026-10-01'])
    expect(days.redness).toHaveLength(3)
  })

  it('pre-fills from the last check', () => {
    expect(prefillSymptoms(rx(['2026-10-01', 'mild', ['itching', 'redness']]))).toEqual(['redness', 'itching'])
    expect(prefillSymptoms(null)).toEqual([])
  })

  it('photos come back in the order they were taken', () => {
    const r = { photoIds: ['c', 'a', 'b'], photoDates: { a: '2026-10-01', b: '2026-10-02', c: '2026-10-03' } }
    expect(photoStrip(r).map((p) => p.key)).toEqual(['a', 'b', 'c'])
    expect(photoStrip({ photoIds: ['x', 'y'] }).map((p) => p.key)).toEqual(['x', 'y'])
  })

  it('older reactions without symptoms or openedOn still read', () => {
    const legacy = { injectionRecordId: 'x', ratings: [{ date: '2026-10-01T09:00:00.000Z', severity: 'mild' }], goneAt: null, photoIds: [] }
    expect(openedOn(legacy)).toBe('2026-10-01')
    expect(checksOf(legacy)[0].symptoms).toEqual([])
    expect(statusOf(legacy, '2026-10-02')).toBe('open')
    const d = describeReaction({}, legacy, '2026-10-03')
    expect(d.daysOpen).toBe(2)
    expect(d.direction).toBeNull()
  })

  it('date helpers', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01')
    expect(diffDays('2026-10-01', '2026-10-08')).toBe(7)
  })
})

describe('Gone on the day it was logged', () => {
  it('resolves at once and keeps the opening check', () => {
    const r = rx(['2026-10-01', 'moderate', ['redness']], ['2026-10-01', 'none'])
    expect(statusOf(r, '2026-10-01')).toBe('resolved')
    expect(timeToResolve(r)).toBe(0)
    expect(checksOf(r)).toHaveLength(1)
    expect(peakSeverity(r)).toBe('moderate')
  })
})
