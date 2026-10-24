import { describe, it, expect } from 'vitest'
import { makeTz, addDays, dateRange } from '../health/tz'
import { nightFeatures, eveningClock, hoursToBed, lagged } from './features'
import type { FeatureInput, NightLike } from './features'
import { DEFAULT_AS_NEEDED, migrateHabits } from './logging'

const tz = makeTz('Australia/Sydney')
const at = (date: string, hhmm: string) => tz.startOfDay(date) + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60000
const iso = (date: string, hhmm: string) => new Date(at(date, hhmm)).toISOString()
/** a night to wake date `wake`, in bed at `bed` the evening before (or after midnight) */
const night = (wake: string, bed = '23:00', up = '06:30'): NightLike => {
  const bedDay = Number(bed.slice(0, 2)) < 12 ? wake : addDays(wake, -1)
  return { date: wake, start: at(bedDay, bed), end: at(wake, up) }
}

const base = (over: Partial<FeatureInput> = {}): FeatureInput => ({
  tz, nights: [], asNeededItems: DEFAULT_AS_NEEDED, asNeededLogs: [], supplements: [], supplementLogs: [], doseLogs: [], compounds: [],
  habitLogs: {}, habits: migrateHabits([]), eveningDetails: {}, workouts: [], sauna: [], daylight: new Map(), steps: new Map(), ...over,
})

describe('time to bed', () => {
  it('an evening clock before noon is after midnight', () => {
    expect(eveningClock('2026-10-20', '23:40', tz)).toBe(at('2026-10-20', '23:40'))
    expect(eveningClock('2026-10-20', '00:30', tz)).toBe(at('2026-10-21', '00:30'))
    expect(eveningClock('2026-10-20', 'late', tz)).toBeNull()
    expect(hoursToBed(at('2026-10-20', '21:00'), at('2026-10-20', '23:30'))).toBe(2.5)
    expect(hoursToBed(null, 0)).toBeNull()
  })

  it('works across midnight for drinks, meals, sedatives and Dex', () => {
    const rows = nightFeatures(base({
      nights: [night('2026-10-20'), night('2026-10-21', '00:40', '07:30')],
      eveningDetails: { '2026-10-20': { drinks: 2, lastDrinkAt: '23:50', lastMealAt: '20:10' } },
      habitLogs: { '2026-10-20': { alcohol: true } },
      asNeededLogs: [
        { id: 'a', itemId: 'an-dex', name: 'Dexamphetamine', amount: 10, unit: 'mg', at: iso('2026-10-20', '07:40') },
        { id: 'b', itemId: 'an-temazepam', name: 'Temazepam', amount: 10, unit: 'mg', at: iso('2026-10-21', '00:20') },
        { id: 'c', itemId: 'an-diazepam', name: 'Diazepam (Valium)', amount: 5, unit: 'mg', at: iso('2026-10-21', '03:10') },
      ],
    }))
    const r = rows.find((x) => x.date === '2026-10-21')!
    expect(r.evening).toBe('2026-10-20')
    // bed at 00:40: last drink 23:50 is 0.8 h before, the meal 4.5 h, Dex 17 h
    expect(r.continuous['toBed:lastDrink']).toBe(0.8)
    expect(r.continuous['toBed:lastMeal']).toBe(4.5)
    expect(r.continuous['toBed:an-dex']).toBe(17)
    expect(r.continuous['toBed:an-temazepam']).toBe(0.3)
    // a dose at 3 am, in bed: negative, and still this night
    expect(r.continuous['toBed:an-diazepam']).toBe(-2.5)
    expect(r.binary['asNeeded:an-diazepam']).toBe(true)
    expect(r.continuous.drinks).toBe(2)
    expect(r.binary['habit:alcohol']).toBe(true)
    expect(r.binary.lateMeal).toBe(false)
    expect(r.line).toContain('2 drinks, last 11:50 pm')
    expect(r.line).toContain('Temazepam 10 mg 12:20 am')
    // the night before saw none of it
    const before = rows.find((x) => x.date === '2026-10-20')!
    expect(before.binary['asNeeded:an-temazepam']).toBe(false)
    expect(before.continuous.drinks).toBeNull()
  })
})

describe('automatic factors', () => {
  it('workouts, sauna, naps, daylight, steps and weekends', () => {
    const rows = nightFeatures(base({
      nights: [night('2026-10-24')], // Friday evening 23 Oct
      workouts: [{ start: at('2026-10-23', '19:00'), end: at('2026-10-23', '21:00'), energyKcal: 500 }],
      sauna: [{ date: '2026-10-23', start: '17:00', lengthMin: 30, tempC: 80, electrolytes: true, waterMl: 500, rating: { feel: 4, lightheaded: true, headache: false, cramps: false } }],
      naps: [{ date: '2026-10-23', start: at('2026-10-23', '14:00'), end: at('2026-10-23', '14:25') }],
      daylight: new Map([['2026-10-23', 42]]),
      steps: new Map([['2026-10-23', 9000]]),
    }))
    const r = rows[0]
    expect(r.binary).toMatchObject({ workout: true, lateWorkout: true, sauna: true, lateSauna: false, nap: true, weekend: true, saunaElectrolytes: true, saunaLightheaded: true, saunaHeadache: false })
    expect(r.continuous).toMatchObject({ 'toBed:workout': 2, 'toBed:sauna': 5.5, saunaMin: 30, saunaTemp: 80, napMin: 25, daylightMin: 42, steps: 9000, workoutKcal: 500, saunaWaterMl: 500, saunaFeel: 4 })
  })

  it('compound doses and grams of a variable supplement', () => {
    const rows = nightFeatures(base({
      nights: [night('2026-10-21')],
      compounds: [{ id: 'p1', name: 'BPC' }],
      doseLogs: [{ peptideId: 'p1', date: '2026-10-20', loggedAt: iso('2026-10-20', '20:00') }],
      supplements: [{ id: 'mg', name: 'Magnesium glycinate', amountUnit: 'g' }, { id: 'd', name: 'Vitamin D' }],
      supplementLogs: [
        { supplementId: 'mg', date: '2026-10-20', takenAt: iso('2026-10-20', '21:00'), amount: 0.4, unit: 'g' },
        { supplementId: 'd', date: '2026-10-20' },
      ],
    }))
    const r = rows[0]
    expect(r.binary['dose:p1']).toBe(true)
    expect(r.continuous['toBed:dose:p1']).toBe(3)
    expect(r.continuous['grams:mg']).toBe(0.4)
    expect(r.binary['supp:d']).toBe(true)
    expect(r.line).toContain('Magnesium 0.4 g')
  })

  it('an early start is a wake-up 60 min before the usual', () => {
    const wakes = dateRange('2026-09-01', '2026-09-20')
    const nights = wakes.map((d) => night(d, '23:00', '07:00'))
    nights.push(night('2026-09-21', '22:30', '05:30'))
    const rows = nightFeatures(base({ nights }))
    expect(rows.at(-1)!.binary.earlyStart).toBe(true)
    expect(rows.at(-2)!.binary.earlyStart).toBe(false)
    expect(rows[2].binary.earlyStart).toBeNull() // too few nights to know the usual
  })

  it('an unanswered evening is unknown, not "no"', () => {
    const r = nightFeatures(base({ nights: [night('2026-10-21')] }))[0]
    expect(r.binary['habit:stress']).toBeNull()
    expect(r.continuous.drinks).toBeNull()
  })
})

describe('the night after', () => {
  it('lag 1 aligns to the next consecutive night only', () => {
    const rows = nightFeatures(base({
      nights: [night('2026-10-20'), night('2026-10-21'), night('2026-10-23')],
      asNeededLogs: [{ id: 'a', itemId: 'an-temazepam', name: 'Temazepam', amount: 10, unit: 'mg', at: iso('2026-10-19', '22:30') }],
    }))
    const lag = lagged(rows, 'asNeeded:an-temazepam')
    expect(lag.get('2026-10-20')).toBeNull()
    expect(lag.get('2026-10-21')).toBe(true) // the night after the Temazepam night
    expect(lag.get('2026-10-23')).toBeNull() // 22 Oct is missing
  })
})
