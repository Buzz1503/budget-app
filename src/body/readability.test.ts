import { describe, it, expect } from 'vitest'
import { lastScanStory, sinceStartStory, scanToScan } from './composition'
import { EVOLT_START_SCAN } from './scanFields'
import { yAxis, bandInView, bandCaption, placeLabels, labelPriority, zoomWindow, panWindow, suspectReadings, ZOOM_MIN_DAYS } from './chartPoints'
import { suspectWeights, dailySeries, getLatestMeasurement, weightKey } from './bodySeries'

const evolt = (date: string, v: Record<string, number>, id = `e-${date}`) => ({ id, date, source: 'scan', device: 'Evolt 360', ...v })
const oct16 = evolt('2026-10-16', { weight: 94.2, fatMass: 26.9, skeletalMuscleMass: 36.4, bodyFat: 28.9, leanMass: 66.1 })
const oct26 = evolt('2026-10-26', { weight: 93.0, fatMass: 26.0, skeletalMuscleMass: 36.7, bodyFat: 28.1, leanMass: 66.5 })
const jan13 = evolt('2025-01-13', { weight: 102.6, fatMass: 38.0, skeletalMuscleMass: 35.4, bodyFat: 37.0, leanMass: 64.6 })

describe('Box 1: current weight and what changed since the last scan', () => {
  it('latest Evolt scan against the one before, coloured by direction', () => {
    const s = lastScanStory([EVOLT_START_SCAN, jan13, oct16, oct26])!
    expect(s.latest).toEqual({ date: '2026-10-26', weight: 93.0, device: 'Evolt 360' })
    expect(s.change).toEqual({ key: 'weight', text: 'Down 1.2 kg since 16 Oct', tone: 'good' })
    expect(s.lines).toEqual([
      { key: 'fatMass', text: 'Fat mass down 0.9 kg (26.9 to 26.0)', tone: 'good' },
      { key: 'skeletalMuscleMass', text: 'Skeletal muscle up 0.3 kg (36.4 to 36.7)', tone: 'good' },
      { key: 'bodyFat', text: 'Body fat 28.1%, was 28.9%', tone: 'good' },
    ])
  })

  it('the opposite direction is amber: fat up and muscle down', () => {
    const worse = evolt('2026-10-27', { weight: 93.5, fatMass: 26.6, skeletalMuscleMass: 36.2, bodyFat: 28.5 })
    const s = lastScanStory([oct26, worse])!
    expect(s.change?.tone).toBe('bad')
    expect(s.lines.map((l) => l.tone)).toEqual(['bad', 'bad', 'bad'])
    expect(s.lines[1].text).toBe('Skeletal muscle down 0.5 kg (36.7 to 36.2)')
  })

  it('one scan: the number and nothing to compare; the estimated start never counts as a scan', () => {
    const s = lastScanStory([EVOLT_START_SCAN, oct26])!
    expect(s.latest.weight).toBe(93.0)
    expect(s.previous).toBeNull()
    expect(s.change).toBeNull()
    expect(lastScanStory([EVOLT_START_SCAN])).toBeNull()
  })
})

describe('Box 2: since you started', () => {
  const start = { date: '2025-01-01', entryId: EVOLT_START_SCAN.id, values: { weight: 105.6, bodyFat: 38.3, fatMass: 40.4, leanMass: 65.2, skeletalMuscleMass: 35.6 } }
  it('against the estimated 1 Jan 2025 start, with the estimate noted', () => {
    const s = sinceStartStory([EVOLT_START_SCAN, jan13, oct16, oct26], start)!
    expect(s.lead.text).toBe('Down 12.6 kg since 1 Jan 2025 (105.6 to 93.0 kg)')
    expect(s.lines.map((l) => l.text)).toEqual([
      'Body fat mass down from 40.4 to 26.0 kg',
      'Skeletal muscle up from 35.6 to 36.7 kg',
      'Body fat 28.1%, was 38.3%',
      'Lean mass up from 65.2 to 66.5 kg',
    ])
    expect(s.lines.every((l) => l.tone === 'good')).toBe(true)
    expect(s.estimated).toBe(true)
    expect(s.startWeight).toBe(105.6)
  })

  it('no start, or no scan with a weight, is no box', () => {
    expect(sinceStartStory([oct26], null)).toBeNull()
    expect(sinceStartStory([EVOLT_START_SCAN], start)).toBeNull()
  })
})

describe('the Withings line only when it is newer than the scan', () => {
  it('compares the newest Scale weigh-in date with the scan date', () => {
    const input = { measurements: [oct26], health: [{ date: '2026-10-27', weight: 91.7, weightSource: 'Withings' }] }
    const scale = dailySeries('weight', { health: input.health })
    expect(scale.at(-1)!.date > lastScanStory(input.measurements)!.latest.date).toBe(true)
    const older = { health: [{ date: '2026-10-20', weight: 92.4, weightSource: 'Withings' }] }
    expect(dailySeries('weight', older).at(-1)!.date > '2026-10-26').toBe(false)
  })
})

describe('Scan to scan', () => {
  it('fat and lean change since the scan before, signed, newest last, the estimated start left out', () => {
    expect(scanToScan([EVOLT_START_SCAN, jan13, oct16, oct26])).toEqual([
      { date: '2026-10-16', fat: -11.1, lean: 1.5 },
      { date: '2026-10-26', fat: -0.9, lean: 0.4 },
    ])
    expect(scanToScan([oct26])).toEqual([])
  })
})

describe('charts that read in three seconds', () => {
  it('the y axis fits the data with a little room', () => {
    const a = yAxis([91, 95], 4)
    expect(a.lo).toBeGreaterThanOrEqual(85)
    expect(a.lo).toBeLessThan(91)
    expect(a.hi).toBeGreaterThan(95)
    expect(a.hi).toBeLessThanOrEqual(100)
  })

  it('a reference band is drawn only where it overlaps, else one caption says where it is', () => {
    const axis = { lo: 24, hi: 32 }
    expect(bandInView({ lo: 15, hi: 26 }, axis)).toEqual({ lo: 24, hi: 26 })
    expect(bandInView({ lo: 15, hi: 20 }, axis)).toBeNull()
    expect(bandCaption({ lo: 15, hi: 20, label: 'Evolt healthy range' }, axis, '%')).toBe('Evolt healthy range 15 to 20%, below this chart')
    expect(bandCaption({ lo: 35, hi: 40, label: 'Evolt healthy range' }, axis, 'kg')).toBe('Evolt healthy range 35 to 40 kg, above this chart')
    expect(bandCaption({ lo: 15, hi: 26 }, axis)).toBeNull()
  })

  it('labels by priority: last, first, lowest, highest, then the start label; lower ones hide on a collision', () => {
    expect(labelPriority([93, 95, 91, 96, 92])).toEqual([4, 0, 2, 3])
    expect(labelPriority([1])).toEqual([0])
    const kept = placeLabels([
      { id: 'last', x: 100, y: 50, w: 30, h: 10 },
      { id: 'first', x: 20, y: 50, w: 30, h: 10 },
      { id: 'low', x: 110, y: 52, w: 30, h: 10 }, // overlaps last
      { id: 'start', x: 300, y: 50, w: 40, h: 9, anchor: 'end' },
    ], [{ id: 'axis', x: 300, y: 54, w: 30, h: 10, anchor: 'end' }])
    expect([...kept]).toEqual(['last', 'first'])
  })

  it('full screen zoom never goes narrower than 14 days or outside the range', () => {
    const bounds = { from: '2026-01-01', to: '2026-10-27' }
    const z = zoomWindow(bounds, 0.01, 0.5, bounds)
    expect(Math.round((Date.parse(z.to) - Date.parse(z.from)) / 86400000)).toBe(ZOOM_MIN_DAYS)
    const out = zoomWindow({ from: '2026-10-01', to: '2026-10-27' }, 50, 0.9, bounds)
    expect(out).toEqual(bounds)
    const right = zoomWindow({ from: '2026-10-01', to: '2026-10-27' }, 0.5, 1, bounds)
    expect(right.to).toBe('2026-10-27')
    expect(panWindow({ from: '2026-10-01', to: '2026-10-27' }, 30, bounds)).toEqual({ from: '2026-10-01', to: '2026-10-27' })
    expect(panWindow({ from: '2026-01-10', to: '2026-02-10' }, -30, bounds)).toEqual({ from: '2026-01-01', to: '2026-02-01' })
  })
})

describe('readings that look wrong', () => {
  const day = (d: number) => `2025-02-${String(d).padStart(2, '0')}`
  it('more than 3 kg from both neighbours within 14 days is flagged; anything else is not', () => {
    const s = [{ date: day(1), value: 101.0 }, { date: day(5), value: 85.2 }, { date: day(9), value: 100.6 }, { date: day(20), value: 99.9 }]
    expect(suspectReadings(s)).toEqual([{ date: day(5), value: 85.2 }])
    // a real drop that stays is not flagged: the next reading agrees with it
    expect(suspectReadings([{ date: day(1), value: 101 }, { date: day(5), value: 97 }, { date: day(9), value: 96.8 }])).toEqual([])
    // a neighbour more than 14 days away does not count
    expect(suspectReadings([{ date: '2025-01-01', value: 101 }, { date: day(5), value: 85 }, { date: day(9), value: 100 }])).toEqual([])
    // exactly 3 kg is not more than 3
    expect(suspectReadings([{ date: day(1), value: 100 }, { date: day(5), value: 97 }, { date: day(9), value: 100 }])).toEqual([])
  })

  it('a flagged weigh-in is out of the line and the maths but stays in the data, until kept', () => {
    const health = [
      { date: day(1), weight: 101.0, weightSource: 'Withings' },
      { date: day(5), weight: 85.2, weightSource: 'Withings' },
      { date: day(9), weight: 100.6, weightSource: 'Withings' },
    ]
    const flagged = suspectWeights({ health })
    expect(flagged).toEqual([{ date: day(5), value: 85.2, sourceLabel: 'Withings', key: weightKey(day(5), 85.2) }])
    const excluded = { health, excludeWeight: flagged.map((x) => x.key) }
    expect(dailySeries('weight', excluded).map((p) => p.value)).toEqual([101.0, 100.6])
    expect(health).toHaveLength(3)
    // the latest value ignores it too, if it were the newest
    const tail = { health: [...health, { date: day(12), weight: 80.1, weightSource: 'Withings' }, { date: day(14), weight: 100.2, weightSource: 'Withings' }] }
    const keys = suspectWeights(tail).map((x) => x.key)
    expect(keys).toContain(weightKey(day(12), 80.1))
    expect(getLatestMeasurement('weight', { ...tail, excludeWeight: keys }, day(15))?.value).toBe(100.2)
    // kept: back in every line
    expect(dailySeries('weight', { health, excludeWeight: [] }).map((p) => p.value)).toEqual([101.0, 85.2, 100.6])
  })
})
