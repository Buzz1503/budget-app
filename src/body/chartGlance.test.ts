import { describe, it, expect } from 'vitest'
import { CHART_QUESTION, chartQuestion, chartAnswer, axisUnit, betterHint, legendItems, needsLegend } from './chartGlance'
import { rangeBounds } from './chartPoints'

describe('chart checklist', () => {
  it('every chart has a question title and a one-line answer', () => {
    expect(chartQuestion('hrv', 'Heart rate variability')).toBe('Is my HRV going up?')
    expect(chartQuestion('something', 'Something')).toBe('Something')
    expect(chartAnswer('down 0.6 kg over 78 days')).toBe('Down 0.6 kg over 78 days.')
    expect(chartAnswer(null)).toBeNull()
  })

  it('the y axis carries its unit in words', () => {
    expect(axisUnit('bpm')).toBe('bpm')
    expect(axisUnit('kg')).toBe('kg')
    expect(axisUnit('%')).toBe('%')
    expect(axisUnit('h')).toBe('hours')
    expect(axisUnit('', 'readiness')).toBe('score')
    expect(axisUnit('', 'bedtime')).toBe('time')
  })

  it('a better hint where the measure has a better side', () => {
    expect(betterHint('hrv')).toBe('↑ better')
    expect(betterHint('rhr')).toBe('↓ better')
    expect(betterHint('fatMass')).toBe('↓ better')
    expect(betterHint('remSleep')).toBe('↑ better')
    expect(betterHint('sleepHR')).toBe('↓ better')
    expect(betterHint('weight')).toBeNull()
  })

  it('a legend whenever there is more than one kind of mark', () => {
    expect(needsLegend(legendItems({ averaged: true }))).toBe(false)
    const two = legendItems({ averaged: true, scans: true })
    expect(needsLegend(two)).toBe(true)
    expect(two.map((x) => x.label)).toEqual(['Average', 'Scan'])
    expect(legendItems({ trend: true, daily: true, scans: true }).map((x) => x.label)).toContain('trend')
  })

  it('data starts at the left at the first point', () => {
    const series = [{ date: '2026-09-20', value: 1 }, { date: '2026-10-20', value: 2 }]
    expect(rangeBounds('All', '2026-10-28', series).from).toBe('2026-09-20')
    // a 1 year range on 5 weeks of data still starts at the first reading
    expect(rangeBounds('1Y', '2026-10-28', series).from).toBe('2026-09-20')
  })
})

describe('chart checklist across every chart', () => {
  it('every chart title is a question and every unit has words for the axis', () => {
    for (const [metric, q] of Object.entries(CHART_QUESTION)) expect([metric, q.endsWith('?')]).toEqual([metric, true])
    for (const unit of ['h', 'min', 'ms', 'bpm', 'kg', '%', 'cm', 'C', 'per h']) expect(axisUnit(unit)).toBeTruthy()
  })

  it('one kind of mark has no legend, the first point is the left edge', () => {
    expect(needsLegend(legendItems({ daily: true }))).toBe(false)
    expect(needsLegend(legendItems({ daily: true, refBand: 'Usual range' }))).toBe(true)
  })
})
