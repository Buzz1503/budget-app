import { describe, expect, it } from 'vitest'
import { SESSIONS } from '../data/seed'
import { addDays, daysBetween, weekday } from './dates'
import { adjustByPct, estimatedOneRepMax, roundToIncrement } from './load'
import { platesPerSide } from './plates'
import { bestSet, milestoneProgress, setsPerMuscle } from './progress'
import { PRWE, VISA_P, questionnaireDue, scorePrwe, scoreVisaP } from './questionnaires'
import { backToBackDays, dayPlan, nextSession } from './schedule'
import { slotKey } from './slots'
import { swapOptions } from './swaps'

describe('dates', () => {
  it('adds days across months and DST', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(daysBetween('2026-10-03', '2026-10-05')).toBe(2) // AU DST starts 4 Oct 2026
    expect(weekday('2026-09-25')).toBe(5) // Friday
  })
})

describe('load', () => {
  it('rounds to the machine increment', () => {
    expect(roundToIncrement(43.2, 2.5)).toBe(42.5)
    expect(roundToIncrement(64.8, 5)).toBe(65)
    expect(adjustByPct(100, -20, 5)).toBe(80)
  })
  it('estimates one-rep max', () => {
    expect(estimatedOneRepMax(100, 1)).toBe(100)
    expect(estimatedOneRepMax(60, 10)).toBe(80)
    expect(estimatedOneRepMax(60, 0)).toBe(0)
  })
})

describe('platesPerSide', () => {
  it('splits the loaded weight per side', () => {
    expect(platesPerSide(60)).toEqual({ perSide: [20, 10], loadedKg: 60, shortByKg: 0 })
    expect(platesPerSide(100)).toEqual({ perSide: [20, 20, 10], loadedKg: 100, shortByKg: 0 })
    expect(platesPerSide(72.5).perSide).toEqual([20, 15, 1.25])
  })
  it('reports when a load cannot be made exactly', () => {
    expect(platesPerSide(61)).toMatchObject({ loadedKg: 60, shortByKg: 1 })
  })
})

describe('schedule', () => {
  const mwf = [1, 3, 5]
  it('rotates A, B, C', () => {
    expect(nextSession(null)).toBe('A')
    expect(nextSession('A')).toBe('B')
    expect(nextSession('C')).toBe('A')
  })
  it('gym, home and rest days for Mon/Wed/Fri', () => {
    expect(dayPlan('2026-09-28', mwf, 'C')).toEqual({ kind: 'gym', session: 'A' }) // Mon
    expect(dayPlan('2026-09-29', mwf, 'A')).toEqual({ kind: 'home', session: null }) // Tue
    expect(dayPlan('2026-10-03', mwf, 'C')).toEqual({ kind: 'home', session: null }) // Sat
    expect(dayPlan('2026-10-04', mwf, 'C')).toEqual({ kind: 'rest', session: null }) // Sun
  })
  it('flags back-to-back gym days, including Saturday to Sunday', () => {
    expect(backToBackDays(mwf)).toEqual([])
    expect(backToBackDays([1, 2, 5])).toEqual([[1, 2]])
    expect(backToBackDays([0, 3, 6])).toEqual([[6, 0]])
  })
})

describe('questionnaires', () => {
  it('VISA-P has 8 scored questions (Q8 has 3 alternatives) and maxes at 100', () => {
    expect(VISA_P.questions.filter((q) => !q.id.startsWith('q8')).length + 1).toBe(8)
    expect(scoreVisaP({ q1: 100, q2: 10, q3: 10, q4: 10, q5: 10, q6: 10, q7: 10, q8a: 30 })).toBe(100)
    expect(scoreVisaP({ q1: 50, q2: 5, q3: 5, q4: 5, q5: 5, q6: 5, q7: 4, q8b: 10 })).toBe(5 + 25 + 4 + 10)
  })
  it('PRWE has 15 items: pain sum + function sum / 2', () => {
    expect(PRWE.questions).toHaveLength(15)
    const all = (v: number) => Object.fromEntries(PRWE.questions.map((q) => [q.id, v]))
    expect(scorePrwe(all(10))).toBe(100)
    expect(scorePrwe(all(0))).toBe(0)
    expect(scorePrwe({ ...all(0), p1: 4, f1: 5 })).toBe(6.5)
  })
  it('is due every 7 days', () => {
    expect(questionnaireDue(null, '2026-10-01', daysBetween)).toBe(true)
    expect(questionnaireDue('2026-09-25', '2026-10-01', daysBetween)).toBe(false)
    expect(questionnaireDue('2026-09-25', '2026-10-02', daysBetween)).toBe(true)
  })
})

describe('progress', () => {
  const m1 = { id: 'm1', order: 1, exerciseId: 'hip-thrust', target: { weightKg: 70, reps: 10 }, label: '', note: null }
  it('milestone achieved only at target weight and reps', () => {
    expect(milestoneProgress(m1, [{ weightKg: 70, reps: 10 }]).achieved).toBe(true)
    expect(milestoneProgress(m1, [{ weightKg: 75, reps: 9 }]).achieved).toBe(false)
  })
  it('milestone progress uses estimated strength', () => {
    const p = milestoneProgress(m1, [{ weightKg: 50, reps: 10 }]).progress
    expect(p).toBeCloseTo(50 / 70, 2)
  })
  it('best set', () => {
    expect(bestSet([{ weightKg: 50, reps: 12 }, { weightKg: 55, reps: 8 }])).toEqual({ weightKg: 50, reps: 12 })
    expect(bestSet([])).toBeNull()
  })
  it('sets per muscle', () => {
    expect(setsPerMuscle([{ muscles: ['glutes'], sets: 3 }, { muscles: ['quads', 'glutes'], sets: 4 }])).toEqual({ glutes: 7, quads: 4 })
  })
})

describe('slots and swaps', () => {
  it('knee lifts share a slot; other lifts are keyed by rep range', () => {
    const a = SESSIONS[0]!.entries
    const b = SESSIONS[1]!.entries
    const key = (entries: typeof a, id: string) => {
      const e = entries.find((x) => 'exerciseId' in x && x.exerciseId === id)
      return e && 'exerciseId' in e ? slotKey(e) : null
    }
    expect(key(a, 'leg-press')).toBe(key(b, 'leg-press'))
    expect(key(a, 'lying-hamstring-curl')).toBe('lying-hamstring-curl:10-12')
    expect(key(b, 'lying-hamstring-curl')).toBe('lying-hamstring-curl:8-10')
  })
  it('plan swaps for chest press, rows and curls; hold or skip otherwise', () => {
    expect(swapOptions('chest-press', 'shoulder').map((s) => s.label)).toEqual(['Shorten range', 'Still sore: drop for the week', 'Skip for the rest of today'])
    expect(swapOptions('chest-supported-row', 'wrist')[0]?.label).toBe('Use straps')
    expect(swapOptions('cable-hammer-curl', 'wrist')[0]).toMatchObject({ kind: 'loadChange', pct: -30 })
    expect(swapOptions('leg-press', 'knee')[0]).toMatchObject({ kind: 'replace', exerciseId: 'spanish-squat' })
    expect(swapOptions('hip-thrust', 'knee').map((s) => s.kind)).toEqual(['hold', 'skip'])
  })
})
