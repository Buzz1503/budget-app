import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { HealthDB, loadAll, readMeta } from './cache'
import { syncHealth, syncWindows, earliestReading, BACKFILL_DAYS, CHUNK_DAYS, NIGHTS_SCHEMA } from './sync'
import { demoBridge, generateDemo } from './demo'
import { nativeBridge } from './bridge'
import type { HealthBridge } from './bridge'
import { makeTz, addDays } from './tz'

const tz = makeTz('Australia/Sydney')
const NOW = tz.startOfDay('2026-10-18') + 10 * 3600000 // 10:00 on 18 Oct
let n = 0
const freshDb = () => new HealthDB(`test-health-${n++}`)

describe('sync windows', () => {
  it('first run reads 365 days, 30 at a time, ending today', () => {
    const w = syncWindows({ today: '2026-10-18', lastSyncDate: null, backfillDone: false })
    expect(w[0][0]).toBe(addDays('2026-10-18', -(BACKFILL_DAYS - 1)))
    expect(w.at(-1)![1]).toBe('2026-10-18')
    expect(w).toHaveLength(13)
    expect(w.slice(0, -1).every(([a, b]) => b === addDays(a, 29))).toBe(true)
  })

  it('later runs re-read from three days before the last sync, for late Withings data', () => {
    expect(syncWindows({ today: '2026-10-18', lastSyncDate: '2026-10-16', backfillDone: true }))
      .toEqual([['2026-10-13', '2026-10-18']])
  })

  it('a full re-sync goes back the whole year again', () => {
    expect(syncWindows({ today: '2026-10-18', lastSyncDate: '2026-10-17', backfillDone: true, full: true })).toHaveLength(13)
  })
})

describe('full-history backfill', () => {
  it('reaches back to the earliest reading in 30-day windows with no gaps or overlaps', () => {
    const w = syncWindows({ today: '2026-10-18', lastSyncDate: null, backfillDone: false, historyFrom: '2019-03-05' })
    expect(w[0][0]).toBe('2019-03-05')
    expect(w.at(-1)![1]).toBe('2026-10-18')
    expect(w.slice(0, -1).every(([a, b]) => b === addDays(a, CHUNK_DAYS - 1))).toBe(true)
    for (let i = 1; i < w.length; i++) expect(w[i][0]).toBe(addDays(w[i - 1][1], 1))
    expect(w.length).toBeGreaterThan(80)
  })

  it('an existing cache that is up to date reads the whole history once; a later date is ignored', () => {
    expect(syncWindows({ today: '2026-10-18', lastSyncDate: '2026-10-17', backfillDone: true, historyFrom: '2024-01-01' })[0][0]).toBe('2024-01-01')
    expect(syncWindows({ today: '2026-10-18', lastSyncDate: '2026-10-17', backfillDone: true, historyFrom: '2026-10-16' })).toEqual([['2026-10-14', '2026-10-18']])
  })

  it('the probe takes the oldest body reading across types, and nothing when there is none', async () => {
    const at = (d: string) => tz.startOfDay(d) + 7 * 3600000
    const bridge = {
      quantity: async (type: string) => (type === 'weight' ? [{ start: at('2016-02-03') }, { start: at('2020-01-01') }] : type === 'leanMass' ? [{ start: at('2018-06-01') }] : []),
    } as unknown as HealthBridge
    expect(await earliestReading(bridge, tz, NOW)).toBe('2016-02-03')
    expect(await earliestReading({ quantity: async () => [] } as unknown as HealthBridge, tz, NOW)).toBeNull()
  })

  it('a first sync reports older windows as history, reads once, and the second pass is the short one', async () => {
    const db = freshDb()
    const bridge = demoBridge({ now: NOW, tz })
    const seen: string[] = []
    await syncHealth({ bridge, db, tz, now: NOW, onProgress: (p) => seen.push(p.phase || '') })
    expect(seen.includes('recent')).toBe(true)
    const r2 = await syncHealth({ bridge, db, tz, now: NOW + 3600000 })
    expect(r2.from >= addDays('2026-10-18', -10)).toBe(true)
  })
})

describe('syncing into the cache', () => {
  let db: HealthDB
  beforeEach(() => { db = freshDb() })

  it('backfills days, nights and workouts, and records the sync', async () => {
    const progress: number[] = []
    const res = await syncHealth({ bridge: demoBridge({ now: NOW, tz }), db, tz, now: NOW, onProgress: (p) => progress.push(p.done) })
    const snap = await loadAll(db)
    expect(snap.daily.length).toBeGreaterThan(100)
    expect(snap.nights.length).toBeGreaterThanOrEqual(118)
    expect(snap.workouts.length).toBeGreaterThan(50)
    expect(res.workouts).toBe(snap.workouts.length)
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(13)
    const meta = await readMeta(db)
    expect(meta.backfillDone).toBe(true)
    expect(meta.lastSyncAt).toBe(new Date(NOW).toISOString())
    expect(meta.characteristics.dateOfBirth).toBe('1990-06-15')
    // every night carries stages from the watch, never merged with the phone's in-bed record
    expect(snap.nights.every((x) => x.source === 'watch' && x.hasStages)).toBe(true)
  })

  it('running it twice changes nothing', async () => {
    const bridge = demoBridge({ now: NOW, tz })
    await syncHealth({ bridge, db, tz, now: NOW })
    const first = await loadAll(db)
    await syncHealth({ bridge, db, tz, now: NOW, full: true })
    const second = await loadAll(db)
    expect(second.daily).toEqual(first.daily)
    expect(second.nights).toEqual(first.nights)
    expect(second.workouts).toEqual(first.workouts)
  })

  it('an incremental sync picks up a late Withings reading and drops a deleted workout', async () => {
    const data = generateDemo({ now: NOW, tz })
    const base = demoBridge({ now: NOW, tz })
    await syncHealth({ bridge: base, db, tz, now: NOW })
    const before = await loadAll(db)
    const dropped = before.workouts.filter((w) => w.date === '2026-10-17')[0]
    expect(dropped).toBeTruthy()

    // a weigh-in from two days ago arrives late, and yesterday's walk is deleted in Health
    const lateAt = tz.startOfDay('2026-10-16') + 7 * 3600000
    const late: HealthBridge = {
      ...base,
      quantity: async (type, a, b) => {
        const rows = await base.quantity(type, a, b)
        if (type === 'weight' && lateAt >= a && lateAt < b) {
          return [...rows.filter((r) => tz.dateOf(r.start) !== '2026-10-16'), { value: 88.8, start: lateAt, end: lateAt, sourceName: 'Withings', sourceId: 'com.withings.wiScaleNG' }]
        }
        return rows
      },
      workouts: async (a, b) => (await base.workouts(a, b)).filter((w) => w.id !== dropped.id),
    }
    expect(data.workouts.length).toBeGreaterThan(0)
    await syncHealth({ bridge: late, db, tz, now: NOW + 3600000 })
    const after = await loadAll(db)
    expect(after.daily.find((d) => d.date === '2026-10-16')!.weight).toBe(88.8)
    expect(after.workouts.find((w) => w.id === dropped.id)).toBeUndefined()
    // older days were not re-read and are untouched
    expect(after.daily.find((d) => d.date === '2026-09-01')).toEqual(before.daily.find((d) => d.date === '2026-09-01'))
  })

  it('nights carry stage segments and sleeping heart rate; a cache from before them is read again in full', async () => {
    const bridge = demoBridge({ now: NOW, tz })
    await syncHealth({ bridge, db, tz, now: NOW })
    const snap = await loadAll(db)
    const last = snap.nights.at(-1)!
    expect(last.segments!.length).toBeGreaterThan(4)
    expect(last.sleepingHR!.min).toBeLessThanOrEqual(last.sleepingHR!.avg)
    expect((await readMeta(db)).nightsSchema).toBe(NIGHTS_SCHEMA)

    // pretend the cache was written before stage 2C: the next sync reads every window again
    await db.meta.put({ key: 'nightsSchema', value: 1 })
    const res = await syncHealth({ bridge, db, tz, now: NOW + 3600000 })
    expect(res.from).toBe(addDays('2026-10-18', -(BACKFILL_DAYS - 1)))
    const res2 = await syncHealth({ bridge, db, tz, now: NOW + 7200000 })
    expect(res2.from).toBe(addDays('2026-10-18', -3))
  })

  it('recent nights carry the Sleep Lab detail; days carry morning light and daytime heart rate', async () => {
    const bridge = demoBridge({ now: NOW, tz })
    await syncHealth({ bridge, db, tz, now: NOW })
    const snap = await loadAll(db)
    const n = snap.nights.at(-2)!
    expect(n.overnight).toBeTruthy()
    expect(n.overnight!.latencyMin).toBeGreaterThanOrEqual(0)
    expect(n.overnight!.hr.length).toBeGreaterThan(10)
    expect(n.overnight!.spo2.length).toBeGreaterThan(3)
    expect(n.overnight!.breathing).not.toBeNull()
    expect(n.overnight!.inBedStart).toBeLessThanOrEqual(n.start)
    const d = snap.daily.find((r) => r.date === n.date)!
    expect(d.daylightMorningMin).not.toBeNull()
    expect(d.hrDaytime).toBeGreaterThan(50)
  })

  it('a bridge that returns nothing leaves an empty cache, not an error', async () => {
    const empty: HealthBridge = {
      isAvailable: async () => true, requestAuthorization: async () => true, characteristics: async () => ({}),
      quantity: async () => [], dailySum: async () => [], sleep: async () => [], workouts: async () => [], bloodPressure: async () => [], daytimeHeartRate: async () => [], writeWater: async () => false,
    }
    await syncHealth({ bridge: empty, db, tz, now: NOW })
    const snap = await loadAll(db)
    expect(snap.daily).toEqual([])
    expect(snap.nights).toEqual([])
    expect((await readMeta(db)).backfillDone).toBe(true)
  })
})

describe('the native bridge', () => {
  const iso = (ms: number) => new Date(ms).toISOString()
  const t0 = tz.startOfDay('2026-10-10') + 3600000
  const capgo = {
    readSamples: async ({ dataType }: { dataType: string }) => {
      if (dataType === 'sleep') return { samples: [{ value: 30, startDate: iso(t0), endDate: iso(t0 + 1800000), sleepState: 'light', sourceName: 'W', sourceId: 'x' }] }
      if (dataType === 'bodyFat') return { samples: [{ value: 0.204, startDate: iso(t0), endDate: iso(t0) }] }
      if (dataType === 'bloodPressure') return { samples: [{ value: 0, startDate: iso(t0), endDate: iso(t0), systolic: 121, diastolic: 79 }] }
      throw new Error('permission')
    },
    queryAggregated: async () => ({ samples: [{ startDate: iso(tz.startOfDay('2026-10-10')), value: 8000 }] }),
    queryWorkouts: async () => ({ workouts: [{ workoutType: 'running', duration: 1800, startDate: iso(t0), endDate: iso(t0 + 1800000), platformId: 'U1', sourceName: 'Watch' }] }),
  }
  const own = {
    isAvailable: async () => ({ available: true }),
    requestAuthorization: async () => ({ requested: true }),
    getCharacteristics: async () => ({ dateOfBirth: '1990-01-01' }),
    readQuantitySamples: async () => ({ samples: [{ value: 25, startDate: iso(t0), endDate: iso(t0) }] }),
    dailySum: async () => ({ samples: [{ date: '2026-10-10', value: 61 }] }),
  }
  const bridge = nativeBridge({ capgo, own, tz })

  it('maps sleep stages ("light" is core), percents and blood pressure', async () => {
    expect((await bridge.sleep(0, Date.now()))[0].stage).toBe('core')
    expect((await bridge.quantity('bodyFat', 0, Date.now()))[0].value).toBeCloseTo(20.4)
    expect(await bridge.bloodPressure(0, Date.now())).toEqual([{ start: t0, sys: 121, dia: 79, sourceName: undefined }])
  })

  it('daily sums land on the local date', async () => {
    expect(await bridge.dailySum('steps', 0, Date.now())).toEqual([{ date: '2026-10-10', value: 8000 }])
    expect(await bridge.dailySum('daylight', 0, Date.now())).toEqual([{ date: '2026-10-10', value: 61 }])
  })

  it('a refused or unsupported read is no data, never an error', async () => {
    expect(await bridge.quantity('restingHR', 0, Date.now())).toEqual([])
    expect(await bridge.quantity('hrRecovery', 0, Date.now())).toHaveLength(1)
  })

  it('workouts carry their id, type and times', async () => {
    const [w] = await bridge.workouts(0, Date.now())
    expect(w).toMatchObject({ id: 'U1', type: 'running', start: t0, durationSec: 1800 })
  })
})

describe('demo data', () => {
  it('is deterministic for the same moment', () => {
    const a = generateDemo({ now: NOW, tz })
    const b = generateDemo({ now: NOW, tz })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
