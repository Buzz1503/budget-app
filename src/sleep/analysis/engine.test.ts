import { describe, it, expect } from 'vitest'
import { addDays, dateRange } from '../../health/tz'
import { bootstrapDiff, bootstrapMean, ridge, ridgeWithCI, rng, excludesZero, solveSPD } from './stats'
import {
  ANALYSIS, compare, simpleComparisons, adjustedEffects, helpsAndHurts, dataBins, binSpecs, doseResponse, withLag, carryOver,
  bestWorst, weekdayWeekend, effectWords, CHANCE_NOTE,
} from './engine'
import { OUTCOME_BY_KEY, factorName, buildRows } from './dataset'
import type { NightRow, Names } from './dataset'

const names: Names = { habits: { alcohol: 'Alcohol', stress: 'Stressful day' }, asNeeded: { 'an-temazepam': 'Temazepam', 'an-diazepam': 'Diazepam (Valium)', 'an-dex': 'Dexamphetamine' }, supplements: { mg: 'Magnesium glycinate' }, compounds: {} }

/** Synthetic nights: alcohol takes 10 min of deep sleep and 6 points of score; stress takes 4 points. */
function synth(n = 120, seed = 1): NightRow[] {
  const r = rng(seed)
  const g = () => { let u = 0; let v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
  return dateRange('2026-01-01', addDays('2026-01-01', n - 1)).map((date, i) => {
    const alcohol = r() < 0.3
    const stress = r() < 0.35
    const temaz = r() < 0.2
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
    const weekend = dow === 5 || dow === 6
    const drinks = alcohol ? 1 + Math.floor(r() * 4) : 0
    return {
      date, weekend,
      binary: { 'habit:alcohol': alcohol, 'habit:stress': stress, 'asNeeded:an-temazepam': temaz, 'asNeeded:an-diazepam': false, 'asNeeded:an-dex': false },
      continuous: { drinks, 'grams:mg': i % 3 === 0 ? 0 : 0.2 + (i % 5) * 0.1, 'toBed:an-dex': 6 + (i % 10) },
      outcomes: {
        deep: 60 - (alcohol ? 10 : 0) + g() * 6,
        sleepScore: 80 - (alcohol ? 6 : 0) - (stress ? 4 : 0) + g() * 5,
        totalSleep: 420 + g() * 20,
      },
    }
  })
}

describe('bootstrap', () => {
  it('is deterministic for a seed, and different seeds move only the interval', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8]
    const b = [3, 4, 5, 6, 7, 8, 9, 10]
    const x = bootstrapDiff(a, b, 42)
    expect(bootstrapDiff(a, b, 42)).toEqual(x)
    expect(x.diff).toBe(-2)
    expect(x.ci.lo).toBeLessThan(x.diff)
    expect(x.ci.hi).toBeGreaterThan(x.diff)
    expect(bootstrapDiff(a, b, 7).diff).toBe(-2)
    expect(bootstrapMean([5, 5, 5], 1)).toEqual({ mean: 5, ci: { lo: 5, hi: 5 } })
    expect(excludesZero({ lo: 1, hi: 2 })).toBe(true)
    expect(excludesZero({ lo: -1, hi: 2 })).toBe(false)
  })

  it('a clear difference is called Clear, with words like "9 min lower"', () => {
    const rows = synth()
    const c = compare(rows, 'habit:alcohol', 'deep', names)!
    expect(c.diff).toBeLessThan(-6)
    expect(c.label).toBe('Clear')
    expect(c.text).toMatch(/^Deep sleep \d+ min less \(95% CI \d+ to \d+ less\) with alcohol$/)
    expect(effectWords(OUTCOME_BY_KEY.deep, 2, { lo: -1, hi: 5 })).toBe('Deep sleep 2 min more (95% CI 1 less to 5 more)')
  })
})

describe('ridge regression', () => {
  it('solves a small system', () => {
    expect(solveSPD([[4, 2], [2, 3]], [2, 1])!.map((v) => Number(v.toFixed(6)))).toEqual([0.5, 0])
    expect(solveSPD([[0, 0], [0, 0]], [1, 1])).toBeNull()
  })

  it('recovers the sign and rough size of known effects', () => {
    const r = rng(3)
    const X: number[][] = []
    const y: number[] = []
    for (let i = 0; i < 300; i++) {
      const a = r() < 0.4 ? 1 : 0
      const b = r() < 0.5 ? 1 : 0
      // b overlaps a: on alcohol nights stress is more likely
      const c = a && r() < 0.6 ? 1 : b
      X.push([a, c, r()])
      y.push(50 - 8 * a - 3 * c + (r() - 0.5) * 6)
    }
    const fit = ridge(X, y)!
    expect(fit.coef[0]).toBeLessThan(-6)
    expect(fit.coef[0]).toBeGreaterThan(-10)
    expect(fit.coef[1]).toBeLessThan(-1.5)
    expect(fit.coef[1]).toBeGreaterThan(-4.5)
    expect(Math.abs(fit.coef[2])).toBeLessThan(1.5)
    const withCI = ridgeWithCI(X, y, 9, { resamples: 120 })!
    expect(withCI.ci[0].hi).toBeLessThan(0)
    expect(excludesZero(withCI.ci[2])).toBe(false)
  })
})

describe('gating', () => {
  it('simple comparisons need 7 nights a side; under that the factor is listed as locked', () => {
    const rows = synth(40).map((r, i) => ({ ...r, binary: { ...r.binary, rare: i < 3 } }))
    const s = simpleComparisons(rows, names, ['deep'])
    expect(s.comparisons.some((c) => c.factor === 'rare')).toBe(false)
    expect(s.locked.find((l) => l.factor === 'rare')).toEqual({ factor: 'rare', have: 3 })
  })

  it('adjusted effects unlock at 60 nights', () => {
    expect(adjustedEffects(synth(59), 'deep', names)).toEqual({ locked: true, have: 59 })
    const a = adjustedEffects(synth(150), 'deep', names)
    expect(a.locked).toBe(false)
    if (a.locked) return
    const alc = a.effects.find((e) => e.factor === 'habit:alcohol')!
    expect(alc.effect).toBeLessThan(-5)
    expect(alc.label).toBe('Clear')
    expect(alc.text).toMatch(/^Alone: Deep sleep \d+ min less\. After accounting for everything else: Deep sleep \d+ min less \(95% CI/)
  })

  it('helps and hurts rank clear effects; alcohol hurts', () => {
    const h = helpsAndHurts(synth(150), names)
    expect(h.hurts[0].factor).toBe('habit:alcohol')
    expect(h.hurts.length).toBeLessThanOrEqual(ANALYSIS.topN)
    expect(h.helps.every((x) => x.factor !== 'habit:alcohol')).toBe(true)
  })

  it('the chance footnote appears past 20 comparisons', () => {
    const r = rng(5)
    const rows = synth(150).map((x) => ({ ...x, binary: { ...x.binary, f1: r() < 0.5, f2: r() < 0.5, f3: r() < 0.5, f4: r() < 0.5 } }))
    const s = simpleComparisons(rows, names)
    expect(s.comparisons.length).toBeGreaterThan(ANALYSIS.manyComparisons)
    expect(s.chanceNote).toBe(CHANCE_NOTE)
    expect(simpleComparisons(synth(150), names, ['deep']).chanceNote).toBeNull()
  })
})

describe('dose-response', () => {
  it('fixed bins for drinks and Dex timing, data bins for grams', () => {
    const rows = synth(120)
    const specs = binSpecs(rows, names)
    const drinks = doseResponse(rows, specs.find((s) => s.key === 'drinks')!, 'deep')
    expect(drinks.bins.map((b) => b.label)).toEqual(['0', '1 to 2', '3 or more'])
    expect(drinks.bins[0].mean!).toBeGreaterThan(drinks.bins[2].mean!)
    expect(drinks.bins.reduce((t, b) => t + b.n, 0)).toBe(120)
    const dex = specs.find((s) => s.key === 'toBed:an-dex')!
    expect(dex.bins.map((b) => b.label)).toEqual(['Under 8 h', '8 to 12 h', 'Over 12 h'])
    const mg = specs.find((s) => s.key === 'grams:mg')!
    expect(mg.label).toBe('Magnesium glycinate grams')
    expect(mg.bins[0].label).toBe('None')
    expect(dataBins([0, 0, 1, 2, 3, 4, 5, 6], 'g', 0).map((b) => b.label)).toEqual(['None', 'Under 3 g', '3 to 5 g', 'Over 5 g'])
    expect(dataBins([0, 1], 'g').map((b) => b.label)).toEqual(['None', 'Any'])
  })
})

describe('carry-over', () => {
  it('lag 1 is the factor on the night before, and a gap is unknown', () => {
    const rows: NightRow[] = ['2026-10-01', '2026-10-02', '2026-10-04'].map((date, i) => ({
      date, weekend: false, binary: { 'asNeeded:an-temazepam': i === 0 }, continuous: {}, outcomes: {},
    }))
    const l = withLag(rows)
    expect(l[0].binary['lag:asNeeded:an-temazepam']).toBeNull()
    expect(l[1].binary['lag:asNeeded:an-temazepam']).toBe(true)
    expect(l[2].binary['lag:asNeeded:an-temazepam']).toBeNull()
    expect(factorName('lag:asNeeded:an-temazepam', names)).toBe('The night after temazepam')
  })

  it('"the night after" comparisons leave out the night itself', () => {
    const rows = synth(150).map((r, i, all) => {
      const prevTemaz = i > 0 && all[i - 1].binary['asNeeded:an-temazepam']
      return { ...r, outcomes: { ...r.outcomes, hrLow: 52 + (prevTemaz ? 3 : 0) + (i % 7) * 0.1 } }
    })
    const c = carryOver(rows, names, ['hrLow']).find((x) => x.factor === 'lag:asNeeded:an-temazepam')!
    expect(c.diff).toBeGreaterThan(2)
    expect(c.text).toContain('the night after temazepam')
  })
})

describe('best and worst nights', () => {
  it('top and bottom 20% by score, with how often each factor was there', () => {
    const b = bestWorst(synth(150), names)
    expect(b.locked).toBe(false)
    if (b.locked) return
    expect(b.k).toBe(30)
    const alc = b.table.find((t) => t.factor === 'habit:alcohol')!
    expect(alc.worst).toBeGreaterThan(alc.best)
    expect(b.sentences[0]).toMatch(/^Alcohol was there on \d+% of your worst nights and \d+% of your best \(\d+% overall\)\.$/)
    expect(bestWorst(synth(20), names).locked).toBe(true)
  })
})

describe('weekday and weekend', () => {
  it('pairs every outcome and gives social jetlag from midpoints', () => {
    const rows = synth(28)
    const timing = new Map(rows.map((r) => [r.date, r.weekend ? { bedFromNoon: 12 * 60, wakeFromNoon: 21 * 60 } : { bedFromNoon: 11 * 60, wakeFromNoon: 19 * 60 }]))
    const w = weekdayWeekend(rows, timing)
    expect(w.nWeekday + w.nWeekend).toBe(28)
    expect(w.socialJetlagMin).toBe(90)
    expect(w.rows.find((x) => x.key === 'bedtime')!.diff).toBe(60)
    expect(w.rows.find((x) => x.key === 'deep')).toBeTruthy()
  })
})

describe('rows', () => {
  it('Screen Time and the bedroom sensor answer the manual toggles when present', () => {
    const rows = buildRows(
      [{ date: '2026-10-24', evening: '2026-10-23', binary: { 'habit:screen-bed': false, 'habit:room-hot': false, weekend: true }, continuous: {}, line: [] }],
      new Map([['2026-10-24', {
        date: '2026-10-24', asleepMin: 400, deepMin: 50, remMin: 90, awakeMin: 20, awakenings: 2, hrLow: 50, hrAvg: 55, hrv: 50, score: 80, rhrNext: 54,
        readinessNext: 70, breathing: 3, spo2Dips: 0, restless: { indexPerHour: 2 }, morning: { rested: 4 },
        sounds: { recorded: true, snoringMin: 20, snoringPct: 5, longestSnoreMin: 4, coughs: 0, talking: 0, loudMinutes: 0, lowConfidence: false, roomMeanC: 25, roomMaxC: 26, humidityMean: 50, startedBy: 'automation' },
        lateUseMin: 30, audio: { minutesInBed: 40, minutesAfterSleep: 15, avgDb: 55 }, latencyMin: 10, hrDipPct: 15, daylightMorningMin: 20, waterL: 2,
      }]]),
    )
    expect(rows[0].binary).toMatchObject({ 'habit:screen-bed': true, 'habit:room-hot': true, sleepAudio: true, audioAfterSleep: true, audioLoud: false })
    expect(rows[0].outcomes).toMatchObject({ snoring: 20, rested: 4, restlessness: 2, deep: 50 })
    expect(rows[0].weekend).toBe(true)
  })
})

describe('the whole analysis', () => {
  it('runs on rows and returns plain data, the same every time', async () => {
    const { runAnalysis, inputHash } = await import('./run')
    const rows = synth(90)
    const input = { rows, names, timing: rows.map((r) => [r.date, { bedFromNoon: 660, wakeFromNoon: 1140 }] as [string, { bedFromNoon: number; wakeFromNoon: number }]), needMin: 480 }
    const a = runAnalysis(input)
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
    expect(a.rankedBy).toBe('adjusted')
    expect(a.hurts.some((h) => h.factor === 'habit:alcohol')).toBe(true)
    expect(a.doseResponse.some((d) => d.key === 'drinks')).toBe(true)
    expect(inputHash(input)).toBe(inputHash({ ...input }))
    expect(inputHash(input)).not.toBe(inputHash({ ...input, needMin: 470 }))
  })
})
