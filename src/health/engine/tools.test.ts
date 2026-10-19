import { describe, it, expect } from 'vitest'
import { groupSplit, beforeAfter, sinceStart, journalImpact, directionWords } from './compare'
import { planBedtime, hhmm, parseHhmm } from './planner'
import { vo2Percentile, fitnessAge, smoothVo2 } from './fitness'
import { VO2_NORMS } from './vo2Norms'
import { doseChanges, bloodPoints, shortName } from './overlay'
import { buildModel, rowFor } from './model'
import { daySnapshot } from './snapshot'
import { makeTz, addDays, dateRange } from '../tz'
import type { SleepNight } from '../types'
import { generateDemo } from '../demo'
import { buildNights, buildDaily, buildWorkout } from '../dayLogic'

const tz = makeTz('Australia/Sydney')
const range = (from: string, n: number) => dateRange(from, addDays(from, n - 1))

describe('dose timing: group split', () => {
  const days = range('2026-09-01', 20)
  const dosed = new Set(days.filter((_, i) => i % 2 === 0))
  const outcome = (d: string) => (dosed.has(d) ? 60 : 50) + (Number(d.slice(-2)) % 3)

  it('compares group means with n for each, once each group has 7 days', () => {
    const s = groupSplit(days, (d) => dosed.has(d), outcome)
    expect(s.with.n).toBe(10)
    expect(s.without.n).toBe(10)
    expect(s.enough).toBe(true)
    expect(s.diff as number).toBeCloseTo(10, 0)
    expect(s.dots.with).toHaveLength(10)
    expect(directionWords(s.diff)).toBe('Higher on days with')
    expect(directionWords(-2)).toBe('Lower on days with')
  })

  it('under 7 in either group shows no difference and says how many more are needed', () => {
    const few = groupSplit(days, (d) => d <= '2026-09-05', outcome)
    expect(few.with.n).toBe(5)
    expect(few.enough).toBe(false)
    expect(few.diff).toBeNull()
    expect(few.needsMore).toBe(2)
  })

  it('days without an outcome, or excluded, count in neither group', () => {
    const s = groupSplit(days, (d) => (d === '2026-09-01' ? null : dosed.has(d)), (d) => (d === '2026-09-03' ? null : 1))
    expect(s.with.n + s.without.n).toBe(18)
  })

  it('no data is not an error', () => {
    expect(groupSplit([], () => true, () => 1)).toMatchObject({ enough: false, diff: null, needsMore: 7 })
  })
})

describe('before and after', () => {
  const metric = (d: string) => (d < '2026-09-15' ? 55 : 60)

  it('14 days before vs 14 days after, the event day itself in neither', () => {
    const r = beforeAfter('2026-09-15', metric)
    expect(r.window).toEqual({ beforeFrom: '2026-09-01', beforeTo: '2026-09-14', afterFrom: '2026-09-16', afterTo: '2026-09-29' })
    expect(r.before.n).toBe(14)
    expect(r.after.n).toBe(14)
    expect(r.diff).toBe(5)
  })

  it('needs 7 values on each side', () => {
    const sparse = (d: string) => (d > '2026-09-15' && d <= '2026-09-20' ? 60 : d < '2026-09-15' ? 55 : null)
    const r = beforeAfter('2026-09-15', sparse)
    expect(r.after.n).toBe(5)
    expect(r.enough).toBe(false)
    expect(r.diff).toBeNull()
    expect(r.needsMore).toBe(2)
  })
})

describe('since start: 14 days before against the latest 14', () => {
  const metric = (d: string) => (d < '2026-08-01' ? 70 : 74)

  it('compares the fortnight before the start with the latest fortnight', () => {
    const r = sinceStart('2026-08-01', '2026-09-30', metric)
    expect(r.window).toEqual({ beforeFrom: '2026-07-18', beforeTo: '2026-07-31', afterFrom: '2026-09-17', afterTo: '2026-09-30' })
    expect(r.diff).toBe(4)
  })

  it('never reaches back before the start when the compound is new', () => {
    const r = sinceStart('2026-09-25', '2026-09-30', metric)
    expect(r.window.afterFrom).toBe('2026-09-26')
    expect(r.after.n).toBe(5)
    expect(r.enough).toBe(false)
    expect(r.needsMore).toBe(2)
  })
})

describe('journal impact', () => {
  const days = range('2026-09-01', 28)
  const habits = [{ id: 'alcohol', name: 'Alcohol' }, { id: 'plunge', name: 'Cold plunge' }, { id: 'rare', name: 'Rare' }]
  const habitLogs: Record<string, Record<string, boolean>> = {}
  days.forEach((d, i) => {
    habitLogs[d] = { alcohol: i % 2 === 0, plunge: i % 3 === 0 }
    if (i === 0) habitLogs[d].rare = true
  })
  delete habitLogs['2026-09-28'] // a day the journal was not filled in
  const readiness = (d: string) => (habitLogs[addDays(d, -1)]?.alcohol ? 45 : 65) + (Number(d.slice(-2)) % 4)

  it('ranks habits by the largest standardised difference, with group sizes', () => {
    const rows = journalImpact({ habits, habitLogs, days, outcomes: { readiness: (d) => readiness(addDays(d, 1)) } })
    expect(rows[0].name).toBe('Alcohol')
    const a = rows[0].outcomes.readiness
    expect(a.enough).toBe(true)
    expect(a.diff as number).toBeLessThan(-15)
    expect(a.with.n + a.without.n).toBe(27) // 28 days, one with no journal
  })

  it('a habit without 7 days in each group is gated, and ranked last', () => {
    const rows = journalImpact({ habits, habitLogs, days, outcomes: { readiness: (d) => readiness(addDays(d, 1)) } })
    const rare = rows.find((r) => r.habitId === 'rare')!
    expect(rare.outcomes.readiness.enough).toBe(false)
    expect(rare.rankScore).toBeNull()
    expect(rows.at(-1)!.habitId).toBe('rare')
  })
})

// ------------------------------------------------------------------ planner

function night(date: string, asleepMin: number, inBedMin: number, wakeH = 6.5): SleepNight {
  const end = tz.startOfDay(date) + wakeH * 3600000
  return {
    date, source: 'watch', sourceName: 'W', start: end - inBedMin * 60000, end, inBedMin, asleepMin, awakeMin: 0,
    deepMin: 0, coreMin: 0, remMin: 0, unspecifiedMin: asleepMin, hasStages: false, naps: [],
  }
}

describe('sleep planner', () => {
  const recent = range('2026-09-01', 14).map((d) => night(d, 432, 480)) // 90 % efficient, waking 06:30

  it('no debt, usual load: need / efficiency before the usual wake time', () => {
    const p = planBedtime({ recent, debtH: 0, needH: 8, tz })
    expect(p.inputs.wakeFrom).toBe('history')
    expect(p.wake).toBe('06:30')
    expect(p.inputs.efficiency).toBe(0.9)
    expect(p.inputs.inBedMin).toBe(Math.round(480 / 0.9))
    expect(p.bedtime).toBe(hhmm(6.5 * 60 - Math.round(480 / 0.9)))
  })

  it('a quarter of the week’s debt is added, capped at an hour', () => {
    expect(planBedtime({ recent, debtH: 2, needH: 8, tz }).inputs.debtAddMin).toBe(30)
    expect(planBedtime({ recent, debtH: 10, needH: 8, tz }).inputs.debtAddMin).toBe(60)
  })

  it('15 minutes more after a higher-load day', () => {
    const p = planBedtime({ recent, debtH: 0, needH: 8, yesterdayLoad: 'Higher', tz })
    expect(p.inputs.loadBumpMin).toBe(15)
    expect(p.inputs.sleepTargetMin).toBe(495)
  })

  it('efficiency is kept between 85 % and 95 %', () => {
    const poor = range('2026-09-01', 14).map((d) => night(d, 300, 480))
    const great = range('2026-09-01', 14).map((d) => night(d, 478, 480))
    expect(planBedtime({ recent: poor, debtH: 0, tz }).inputs.efficiency).toBe(0.85)
    expect(planBedtime({ recent: great, debtH: 0, tz }).inputs.efficiency).toBe(0.95)
    expect(planBedtime({ recent: [], debtH: 0, tz }).inputs).toMatchObject({ efficiency: 0.9, wakeFrom: 'default' })
  })

  it('a wake-time setting wins over history', () => {
    const p = planBedtime({ recent, debtH: 0, wakeTarget: '05:45', tz })
    expect(p).toMatchObject({ wake: '05:45' })
    expect(p.inputs.wakeFrom).toBe('setting')
    expect(parseHhmm('25:00')).toBeNull()
    expect(hhmm(-30)).toBe('23:30')
  })
})

// ---------------------------------------------------------------- VO2 max

describe('VO2 max percentile and fitness age', () => {
  it('the 50th percentile values match the FRIEND abstract end points', () => {
    expect(VO2_NORMS.male[0][2]).toBe(48.0)
    expect(VO2_NORMS.male[5][2]).toBe(24.4)
    expect(VO2_NORMS.female[0][2]).toBe(37.6)
    expect(VO2_NORMS.female[5][2]).toBe(18.3)
  })

  it('interpolates between table points', () => {
    expect(vo2Percentile(42.4, 35, 'male')).toEqual({ value: 50, bound: null })
    // a third of the way from the 50th (42.4) to the 75th (49.2)
    expect(vo2Percentile(42.4 + (49.2 - 42.4) / 3, 35, 'male')).toEqual({ value: 58, bound: null })
    expect(vo2Percentile(20, 35, 'male')).toEqual({ value: 10, bound: 'below' })
    expect(vo2Percentile(70, 35, 'male')).toEqual({ value: 90, bound: 'above' })
    expect(vo2Percentile(40, 35, null)).toBeNull()
  })

  it('fitness age is where the 50th percentile meets your value, clamped to 20–80', () => {
    expect(fitnessAge(42.4, 'male')).toBe(35)
    expect(fitnessAge((42.4 + 37.8) / 2, 'male')).toBe(40)
    expect(fitnessAge(70, 'male')).toBe(20)
    expect(fitnessAge(10, 'male')).toBe(80)
    expect(fitnessAge(30.2, 'female')).toBe(35)
  })

  it('smooths each reading with the two before it', () => {
    expect(smoothVo2([{ date: '2026-09-01', value: 40 }, { date: '2026-09-08', value: 43 }, { date: '2026-09-15', value: 46 }, { date: '2026-09-22', value: 40 }]).map((r) => r.value))
      .toEqual([40, 41.5, 43, 43])
  })
})

// ---------------------------------------------------------------- overlays

describe('overlays', () => {
  const compounds = [
    { id: 'reta', name: 'Retatrutide', points: [{ date: '2026-08-01', kind: 'start', to: 2, unit: 'mg' }, { date: '2026-09-10', kind: 'step-up', to: 4, unit: 'mg' }, { date: '2026-09-11', kind: 'skip' }], runs: [{ startedOn: '2026-08-01', endedOn: null }] },
    { id: 'bpc', name: 'BPC-157', points: [{ date: '2026-09-05', kind: 'start', to: 250, unit: 'mcg' }, { date: '2026-09-25', kind: 'stop' }], runs: [{ startedOn: '2026-09-05', endedOn: '2026-09-25' }] },
  ]

  it('dose-change lines with a short label, inside the range', () => {
    expect(doseChanges(compounds, '2026-09-01', '2026-09-30').map((l) => l.label)).toEqual(['BPC 250 mcg', 'Reta 4 mg', 'BPC stopped'])
    expect(doseChanges(compounds, '2026-09-01', '2026-09-30', ['reta']).map((l) => l.date)).toEqual(['2026-09-10'])
    expect(shortName('Testosterone Enanthate')).toBe('Test')
  })

  it('blood results for chosen markers at their test dates', () => {
    const tests = [{ date: '2026-08-10', values: { Testosterone: 18, HbA1c: 5.2 } }, { date: '2026-09-12', values: { Testosterone: 25, Haematocrit: 0.48 } }]
    expect(bloodPoints(tests, ['Testosterone', 'Haematocrit'], '2026-09-01', '2026-09-30')).toEqual([
      { marker: 'Haematocrit', date: '2026-09-12', value: 0.48 }, { marker: 'Testosterone', date: '2026-09-12', value: 25 },
    ])
  })
})

// ----------------------------------------------------- model and snapshot

describe('model and day snapshot', () => {
  const now = tz.startOfDay('2026-10-18') + 10 * 3600000
  const demo = generateDemo({ now, tz })
  const from = '2026-06-20'
  const to = '2026-10-18'
  const nights = Object.values(buildNights(demo.sleep, { tz }))
  const daily = buildDaily({
    restingHR: demo.quantities.restingHR, hrv: demo.quantities.hrv, respRate: demo.quantities.respRate,
    wristTemp: demo.quantities.wristTemp, weight: demo.quantities.weight, bodyFat: demo.quantities.bodyFat,
    leanMass: demo.quantities.leanMass, steps: demo.sums.steps,
  }, { tz, from, to, nights: Object.fromEntries(nights.map((n) => [n.date, n])) })
  const workouts = demo.workouts.map((w) => buildWorkout(w, { tz, hr: demo.quantities.heartRate }))
  const protocol = {
    compounds: [{ id: 'retatrutide', name: 'Retatrutide', points: [{ date: '2026-09-01', kind: 'start', to: 2, unit: 'mg' }], runs: [{ startedOn: '2026-09-01' }] }],
    doseLogs: [{ peptideId: 'retatrutide', date: '2026-10-15' }],
    measurements: [{ date: '2026-10-10', source: 'manual', weight: 91 }],
    checkins: { '2026-10-15': { energy: 4 } },
    habitLogs: { '2026-10-15': { alcohol: true } },
    habits: [{ id: 'alcohol', name: 'Alcohol' }, { id: 'stress', name: 'Stressful day' }],
  }
  const model = buildModel({ daily, nights, workouts, characteristics: { dateOfBirth: '1990-06-15', biologicalSex: 'male' }, protocol, today: '2026-10-18', tz })

  it('scores readiness once a baseline exists, and builds before that', () => {
    expect(model.readiness('2026-10-17').status).toBe('ok')
    expect(model.readiness('2026-06-25').status).toBe('building')
  })

  it('max HR comes from date of birth unless set; manual weight beats the scale', () => {
    expect(model.maxHR).toBe(183) // 208 − 0.7 × 36 = 182.8
    expect(model.bodyBy.get('2026-10-10')!.weightSource).toBe('manual')
    expect(model.sessions.length).toBeLessThan(workouts.length) // Hevy + Watch pairs merged
  })

  it('recovery rows give value, baseline and delta', () => {
    const r = rowFor(model, 'rhr', '2026-10-17')
    expect(r.ready).toBe(true)
    expect(r.value).not.toBeNull()
    expect(r.delta).toBeCloseTo((r.value as number) - (r.baseline as number), 0)
  })

  it('a day snapshot brings health, doses, check-in and habits together', () => {
    const s = daySnapshot(model, '2026-10-15', { ...protocol, compounds: protocol.compounds })
    expect(s.hasHealth).toBe(true)
    expect(s.sleep).not.toBeNull()
    expect(s.doses).toEqual([{ peptideId: 'retatrutide', name: 'Retatrutide' }])
    expect(s.checkin).toEqual({ energy: 4 })
    expect(s.habits).toEqual([{ id: 'alcohol', name: 'Alcohol', value: true }])
  })

  it('a day with no health data still returns a snapshot, empty where it should be', () => {
    const s = daySnapshot(model, '2025-01-01', protocol)
    expect(s).toMatchObject({ hasHealth: false, sleep: null, steps: null, workouts: [], checkin: null, doses: [] })
    expect(s.readiness.status).toBe('building')
  })

  it('an empty model is valid', () => {
    const empty = buildModel({ daily: [], nights: [], workouts: [], protocol: { ...protocol, doseLogs: [], measurements: [] }, today: '2026-10-18', tz })
    expect(empty.hasData).toBe(false)
    expect(empty.readiness('2026-10-18').status).toBe('building')
    expect(empty.maxHR).toBe(190)
    expect(empty.outcomes.find((o) => o.key === 'sleepTotal')!.fn('2026-10-17')).toBeNull()
  })
})

describe('target wake time range', () => {
  it('only 03:00 to 12:00 counts; anything else falls back to the 14-night median', async () => {
    const { validWakeTarget, planBedtime } = await import('./planner')
    expect(validWakeTarget('03:00')).toBe(true)
    expect(validWakeTarget('12:00')).toBe(true)
    expect(validWakeTarget('13:50')).toBe(false)
    expect(validWakeTarget('02:59')).toBe(false)
    expect(validWakeTarget(null)).toBe(false)
    const tz = makeTz('Australia/Sydney')
    const nights = dateRange('2026-09-01', '2026-09-14').map((d) => ({
      date: d, start: Date.parse(`${addDays(d, -1)}T12:30:00Z`), end: Date.parse(`${d}T20:30:00Z`),
      inBedMin: 480, asleepMin: 440, awakeMin: 20, deepMin: 60, coreMin: 280, remMin: 100, unspecifiedMin: 0, hasStages: true, source: 'watch', sourceName: 'Watch', naps: [],
    })) as unknown as SleepNight[]
    const bad = planBedtime({ recent: nights, debtH: 0, wakeTarget: '13:50', tz })
    expect(bad.inputs.wakeFrom).toBe('history')
    expect(bad.wake).toBe('06:30') // 20:30 UTC is 06:30 in Sydney in September
    expect(planBedtime({ recent: nights, debtH: 0, wakeTarget: '05:45', tz }).wake).toBe('05:45')
  })
})
