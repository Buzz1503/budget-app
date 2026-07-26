import { describe, it, expect } from 'vitest'
import {
  concentration, doseToMl, doseToUnits, unitsToDoseMg, mlToUnits, unitsToMl, toMg, fromMg,
} from './calc'

describe('reconstitution + dose math (U-100: 1 unit = 0.01 mL)', () => {
  it('computes concentration', () => {
    expect(concentration(20, 4)).toBe(5)
    expect(concentration(40, 2)).toBe(20)
    expect(concentration(0, 2)).toBe(0)
    expect(concentration(10, 0)).toBe(0)
  })

  it('matches every seed example: dose → units', () => {
    expect(doseToUnits(2, 5)).toBeCloseTo(40, 10) // Retatrutide 2 mg @ 5 mg/mL
    expect(doseToUnits(0.5, 5)).toBeCloseTo(10, 10) // Selank 500 mcg
    expect(doseToUnits(1, 5)).toBeCloseTo(20, 10) // Semax 1 mg
    expect(doseToUnits(0.5, 5)).toBeCloseTo(10, 10) // KPV 500 mcg
    expect(doseToUnits(5, 10)).toBeCloseTo(50, 10) // SS-31 5 mg
    expect(doseToUnits(0.3, 2.5)).toBeCloseTo(12, 10) // DSIP 300 mcg
    expect(doseToUnits(1.4, 20)).toBeCloseTo(7, 10) // MOTS-c 1.4 mg
    expect(doseToUnits(0.25, 2.5)).toBeCloseTo(10, 10) // BPC-157 250 mcg
    expect(doseToUnits(1, 25)).toBeCloseTo(4, 10) // GHK-Cu 1 mg
    expect(doseToUnits(100, 100)).toBeCloseTo(100, 10) // NAD+ 100 mg
    expect(doseToUnits(1, 5)).toBeCloseTo(20, 10) // Tesamorelin 1 mg
  })

  it('is exact in reverse: units → delivered dose', () => {
    expect(unitsToDoseMg(40, 5)).toBeCloseTo(2, 10)
    expect(unitsToDoseMg(7, 20)).toBeCloseTo(1.4, 10)
    expect(unitsToDoseMg(12, 2.5)).toBeCloseTo(0.3, 10)
  })

  it('round-trips arbitrary values', () => {
    for (const conc of [2.5, 5, 10, 20, 25, 100]) {
      for (const mg of [0.1, 0.25, 0.3, 1.4, 2, 5, 100]) {
        expect(unitsToDoseMg(doseToUnits(mg, conc), conc)).toBeCloseTo(mg, 9)
      }
    }
  })

  it('1 unit = 0.01 mL exactly', () => {
    expect(mlToUnits(0.01)).toBeCloseTo(1, 12)
    expect(unitsToMl(1)).toBeCloseTo(0.01, 12)
    expect(doseToMl(2, 5)).toBeCloseTo(0.4, 12)
  })

  it('converts mcg ↔ mg', () => {
    expect(toMg(500, 'mcg')).toBe(0.5)
    expect(toMg(2, 'mg')).toBe(2)
    expect(fromMg(0.5, 'mcg')).toBe(500)
  })
})
