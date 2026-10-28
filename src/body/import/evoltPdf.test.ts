import { describe, it, expect } from 'vitest'
import { rebuildLines, linesFromText, xAt } from './pdfLines'
import { parseEvoltLines, checkEvolt, balanceStatus, isEvoltText, keyForLabel } from './evoltPdf'
import { evolt26Oct, EVOLT_26_OCT_EXPECTED, cols } from './fixtures'
import { scanFromImport } from '../scanImport'

describe('PDF line rebuilding', () => {
  it('groups items by y within a tolerance, sorts by x and joins with spaces, whatever order they came in', () => {
    const items = [
      { str: '92.5 kg', x: 60, y: 700.4, page: 1 },
      { str: 'TORSO', x: 10, y: 600, page: 1 },
      { str: '170 cm', x: 10, y: 700, page: 1 },
      { str: 'Male', x: 160, y: 699.1, page: 1 },
      { str: '36', x: 120, y: 701, page: 1 },
      { str: 'page two', x: 10, y: 790, page: 2 },
      { str: '   ', x: 300, y: 700, page: 1 },
    ]
    const lines = rebuildLines(items)
    expect(lines.map((l) => l.text)).toEqual(['170 cm 92.5 kg 36 Male', 'TORSO', 'page two'])
    expect(lines.map((l) => l.page)).toEqual([1, 1, 2])
  })

  it('keeps where each piece sits, so a value can be matched to its label by x', () => {
    const [line] = rebuildLines([{ str: 'ICF', x: 40, y: 10, w: 15 }, { str: 'ECF', x: 200, y: 10, w: 15 }])
    expect(xAt(line, 0)).toBe(40)
    expect(xAt(line, line.text.indexOf('ECF'))).toBe(200)
  })

  it('items more than the tolerance apart are separate lines', () => {
    expect(rebuildLines([{ str: 'a', x: 0, y: 100 }, { str: 'b', x: 0, y: 96 }]).map((l) => l.text)).toEqual(['a', 'b'])
  })
})

describe('Evolt 360 report', () => {
  const read = parseEvoltLines(evolt26Oct())
  const { entry } = scanFromImport(read.raw)

  it('is recognised by VOLT 360', () => {
    expect(isEvoltText('EVOLT 360 BODY COMPOSITION')).toBe(true)
    expect(isEvoltText('InBody 570 results')).toBe(false)
  })

  it('reads every field of the 26 Oct 2026 report exactly', () => {
    for (const [k, v] of Object.entries(EVOLT_26_OCT_EXPECTED)) expect([k, entry?.[k]]).toEqual([k, v])
    expect(entry?.device).toBe('Evolt 360')
    expect(entry?.heightCm).toBe(170)
    expect(entry?.ageAtScan).toBe(36)
    expect(read.missing).toEqual([])
  })

  it('reads the nutrition recommendations, ranges optional', () => {
    expect(entry?.recommendations).toEqual({ caloriesKcal: [2206, 2306], proteinG: [165, 173], carbsG: [193, 202], fatG: [86, 90] })
    const noMacros = parseEvoltLines([...evolt26Oct().filter((l) => l.page === 1), ...linesFromText('YOUR NUTRITION\n2206 - 2306 kcal', 3)])
    expect(noMacros.raw.evolt_recommendations).toEqual({ calories_kcal: [2206, 2306] })
  })

  it('reads the status and range printed with each numbered value', () => {
    expect((entry?.status as Record<string, string>).leanMass).toBe('High')
    expect((entry?.status as Record<string, string>).visceralFatLevel).toBe('Over Range')
    expect((entry?.ranges as Record<string, number[]>).leanMass).toEqual([47.3, 57.8])
  })

  it('trap: ICF and ECF sit in other rows than their labels, taken by position and checked against total body water', () => {
    expect([entry?.icf, entry?.ecf]).toEqual([31.8, 16.1])
    expect(entry?.icfPct).toBe(66)
    expect(entry?.ecfPct).toBe(34)
    // a nearer distractor that does not add up loses to the pair that does
    const page = evolt26Oct().map((l) => (l.text.startsWith('ICF') ? { ...l } : l))
    const icfRow = page.findIndex((l) => /^ICF/.test(l.text))
    const withDistractor = [...page.slice(0, icfRow + 1), ...linesFromText(cols('12.4', '16.1 kg (34%)', '1806 kcal', '2781 kcal'), 1).map((l) => ({ ...l, y: page[icfRow + 1].y })), ...page.slice(icfRow + 2)]
    const r = parseEvoltLines(withDistractor)
    expect([r.raw.icf_kg, r.raw.ecf_kg]).toEqual([31.8, 16.1])
  })

  it('trap: the waist to hip ratio range has its own pattern, without brackets', () => {
    expect((entry?.ranges as Record<string, number[]>).waistHipRatio).toEqual([0.75, 0.9])
    expect(entry?.waistHipRatio).toBe(0.93)
  })

  it('trap: the segmental block is read by region title, not by order, with the waist to hip ratio mixed in', () => {
    expect([entry?.torsoLean, entry?.torsoFat, entry?.leftLegLean]).toEqual([29.78, 15.39, 8.95])
  })

  it('trap: balance wording maps to a status', () => {
    expect(entry?.balance).toEqual({ upperLower: 'Balanced', leftRight: 'Balanced' })
    expect(balanceStatus('Slightly Imbalanced')).toBe('Slightly unbalanced')
    expect(balanceStatus('Unbalanced')).toBe('Unbalanced')
    expect(balanceStatus('Extremely unbalanced')).toBe('Extremely unbalanced')
    expect(balanceStatus('nothing')).toBeNull()
  })

  it('maps numbered labels to fields', () => {
    expect(keyForLabel('LEAN BODY MASS')).toBe('lean_body_mass_kg')
    expect(keyForLabel('SKELETAL MUSCLE MASS')).toBe('skeletal_muscle_mass_kg')
    expect(keyForLabel('BODY FAT MASS')).toBe('fat_mass_kg')
    expect(keyForLabel('BODY FAT PERCENTAGE')).toBe('body_fat_pct')
    expect(keyForLabel('BODY WATER INDEX')).toBe('bwi_score')
    expect(keyForLabel('TOTAL BODY WATER')).toBe('total_body_water_kg')
    expect(keyForLabel('VISCERAL FAT LEVEL')).toBe('visceral_fat_level')
    expect(keyForLabel('BMI')).toBeNull()
  })
})

describe('Evolt validation', () => {
  const good = parseEvoltLines(evolt26Oct()).raw
  const clone = () => JSON.parse(JSON.stringify(good))

  it('the 26 Oct report passes every check', () => {
    expect(checkEvolt(good)).toEqual({ ok: true, problems: [] })
  })

  it('lean + fat must be within 0.3 kg of weight', () => {
    const r = clone(); r.weight_kg = 92.9
    expect(checkEvolt(r).ok).toBe(false)
    r.weight_kg = 92.8
    expect(checkEvolt(r).problems.some((p) => p.startsWith('Lean'))).toBe(false)
  })

  it('ICF + ECF must be within 0.3 of total body water', () => {
    const r = clone(); r.icf_kg = 31.4
    expect(checkEvolt(r).problems.some((p) => p.startsWith('ICF'))).toBe(true)
  })

  it('the five regions must fit lean body mass and fat mass', () => {
    const r = clone(); r.segmental.torso.lean_kg = 49.78
    expect(checkEvolt(r).problems.some((p) => p.includes('lean'))).toBe(true)
    const f = clone(); f.segmental.torso.fat_kg = 17.0
    expect(checkEvolt(f).problems.some((p) => p.includes('fat'))).toBe(true)
    const missing = clone(); delete missing.segmental.left_leg
    expect(checkEvolt(missing).problems).toContain('Not all five regions found')
  })

  it('body fat % must match fat mass over weight within 0.5', () => {
    const r = clone(); r.body_fat_pct = 28.7
    expect(checkEvolt(r).problems.some((p) => p.startsWith('Body fat'))).toBe(true)
    r.body_fat_pct = 28.5
    expect(checkEvolt(r).problems.some((p) => p.startsWith('Body fat'))).toBe(false)
  })

  it('a report with no date or weight needs a check', () => {
    const r = clone(); delete r.date; delete r.weight_kg
    expect(checkEvolt(r).problems).toEqual(expect.arrayContaining(['No scan date found', 'No weight found']))
  })
})
