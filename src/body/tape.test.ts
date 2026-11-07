import { describe, it, expect } from 'vitest'
import {
  siteSeries, siteCounts, siteRows, totalChange, changeWords, compareDates, quickPairs, nearestByDate,
  ratios, betterFor, sheetSites, prefill, entryFromSheet, stepValue, nextReminder, tapeDates, TAPE_TIP,
} from './tape'

const m = [
  { id: 'a', date: '2025-01-01', waist: 110, hips: 112, armL: 36, armR: 36.4, neck: 42 },
  { id: 'b', date: '2025-03-01', waist: 104.5, armL: 36.5, chest: 108, weight: 101 },
  // two entries on one day: the later one wins for that day
  { id: 'c', date: '2025-06-01', waist: 101.2, hips: 106, armL: 37.1, armR: 37.9, thighL: 62 },
  { id: 'd', date: '2025-06-01', waist: 100.8 },
  // hidden from the body charts is still tape, and the old combined arms are kept
  { id: 'e', date: '2025-09-01', waist: 98, hips: 104, neck: 40.5, hiddenFromCharts: true },
  { id: 'f', date: '2024-12-01', arms: 35 },
  // a scan entry with no tape fields is not tape
  { id: 'g', date: '2025-02-01', source: 'scan', device: 'Evolt 360', weight: 103, abdominalCircumference: 109 },
]

describe('every existing entry is found', () => {
  it('one value per day per site, oldest first, nothing dropped', () => {
    expect(siteSeries(m, 'waist').map((p) => [p.date, p.value])).toEqual([
      ['2025-01-01', 110], ['2025-03-01', 104.5], ['2025-06-01', 100.8], ['2025-09-01', 98],
    ])
    expect(siteSeries(m, 'arms')).toEqual([{ date: '2024-12-01', value: 35 }])
  })

  it('counts every entry with a value, per site', () => {
    expect(siteCounts(m)).toEqual({ neck: 2, chest: 1, waist: 5, hips: 3, armL: 3, armR: 2, thighL: 1, arms: 1 })
    expect(tapeDates(m)).toEqual(['2024-12-01', '2025-01-01', '2025-03-01', '2025-06-01', '2025-09-01'])
  })
})

describe('the answer line', () => {
  it('adds up every girth change since each site’s first entry', () => {
    const t = totalChange(m)!
    // waist -12, hips -8, armL +1.1, armR +1.5, neck -1.5 (chest and thighL once only; old arms left out)
    expect(t.total).toBe(-18.9)
    expect(t.sites).toBe(5)
    expect(t.since).toBe('2025-01-01')
    expect(changeWords(t.total)).toBe('Down 18.9 cm')
    // since last time: the sites measured on 1 Sep against each one's value before
    expect(t.lastDate).toBe('2025-09-01')
    expect(t.lastTime).toBe(-6.3) // waist -2.8, hips -2, neck -1.5
    expect(t.prevDate).toBe('2025-06-01')
    expect(changeWords(0.02)).toBe('No change')
    expect(totalChange([{ date: '2025-01-01', waist: 100 }])).toBeNull()
  })
})

describe('better direction per site', () => {
  it('bigger is better for arms, chest and calves; smaller for waist, hips, neck and thighs; settings turn it round', () => {
    expect(['armL', 'chest', 'calfR'].map((k) => betterFor(k))).toEqual(['up', 'up', 'up'])
    expect(['waist', 'hips', 'neck', 'thighL'].map((k) => betterFor(k))).toEqual(['down', 'down', 'down', 'down'])
    expect(betterFor('thighL', { better: { thighL: 'up' } })).toBe('up')
    const rows = siteRows(m)
    expect(rows.find((r) => r.key === 'waist')).toMatchObject({ sinceLast: -2.8, sinceFirst: -12, tone: 'better' })
    expect(rows.find((r) => r.key === 'armL')).toMatchObject({ sinceLast: 0.6, tone: 'better' })
    expect(siteRows(m, { better: { waist: 'up' } }).find((r) => r.key === 'waist')!.tone).toBe('worse')
    expect(rows.find((r) => r.key === 'chest')).toMatchObject({ sinceLast: null, tone: 'same' })
  })
})

describe('compare', () => {
  it('every site side by side; a site missing on one date has a dash and no change', () => {
    const rows = compareDates(m, '2025-01-01', '2025-06-01')
    expect(rows.find((r) => r.key === 'waist')).toMatchObject({ before: 110, after: 100.8, change: -9.2, tone: 'better' })
    expect(rows.find((r) => r.key === 'neck')).toMatchObject({ before: 42, after: null, change: null })
    expect(rows.find((r) => r.key === 'thighL')).toMatchObject({ before: null, after: 62, change: null })
    // a site on neither date is not listed
    expect(rows.find((r) => r.key === 'chest')).toBeUndefined()
    expect(quickPairs(m)).toEqual({ latestVsPrevious: ['2025-06-01', '2025-09-01'], latestVsFirst: ['2024-12-01', '2025-09-01'] })
  })

  it('the photo and the scan nearest each date', () => {
    const scans = [{ date: '2025-02-01', weight: 103 }, { date: '2025-05-20', weight: 99 }]
    expect(nearestByDate(scans, '2025-06-01')).toMatchObject({ item: { date: '2025-05-20' }, days: 12 })
    expect(nearestByDate(scans, '2025-01-01')).toMatchObject({ item: { date: '2025-02-01' }, days: 31 })
    // a tie goes to the earlier one
    expect(nearestByDate([{ date: '2025-01-01' }, { date: '2025-01-05' }], '2025-01-03')!.item.date).toBe('2025-01-01')
    expect(nearestByDate([], '2025-01-01')).toBeNull()
  })
})

describe('ratios', () => {
  it('waist to height, waist to hip on the same day, and left against right', () => {
    const r = ratios(m, 170)
    expect(r.find((x) => x.key === 'waistHeight')).toMatchObject({ value: '0.58', date: '2025-09-01' })
    expect(r.find((x) => x.key === 'waistHeight')!.meaning).toBe('Your waist is 58% of your height (170 cm). Lower means a smaller waist for your height.')
    expect(r.find((x) => x.key === 'waistHip')).toMatchObject({ value: '0.94', date: '2025-09-01' })
    expect(r.find((x) => x.key === 'lr-arm')).toMatchObject({ value: '0.8 cm', date: '2025-06-01' })
    expect(r.find((x) => x.key === 'lr-arm')!.meaning).toMatch(/^Right is 0.8 cm bigger/)
    // thighs: only the left was ever measured, so no left and right line
    expect(r.find((x) => x.key === 'lr-thigh')).toBeUndefined()
    expect(ratios([{ date: '2025-01-01', hips: 100 }], 170)).toEqual([])
    for (const x of r) expect(x.meaning).not.toMatch(/should|risk|healthy|unhealthy|doctor/i)
  })
})

describe('the log sheet', () => {
  it('shows measured sites and the defaults, each starting at its last value', () => {
    const sites = sheetSites(m)
    expect(sites).toEqual(['neck', 'chest', 'waist', 'hips', 'armL', 'armR', 'thighL', 'thighR'])
    expect(sheetSites(m, { sites: ['hips', 'waist'] })).toEqual(['waist', 'hips'])
    expect(prefill(m, ['waist', 'thighR'])).toEqual({ waist: 98, thighR: null })
  })

  it('only touched sites are saved', () => {
    const values = { waist: 97.6, hips: 104, armL: 37.1, chest: '108,5' }
    expect(entryFromSheet(values, new Set(['waist', 'chest']))).toEqual({ waist: 97.6, chest: 108.5 })
    expect(entryFromSheet(values, [])).toEqual({})
    // nonsense and old combined sites are not saved
    expect(entryFromSheet({ waist: 3, arms: 40 }, ['waist', 'arms'])).toEqual({})
    expect(stepValue(97.6, 0.1)).toBe(97.7)
    expect(stepValue(null, -0.1, 80)).toBe(79.9)
    expect(TAPE_TIP).toBe('Measure first thing in the morning, same spot, tape snug not tight.')
  })
})

describe('the reminder', () => {
  it('14 days after the last tape entry, or today when overdue or never measured', () => {
    expect(nextReminder(m, '2025-09-05')).toBe('2025-09-15')
    expect(nextReminder(m, '2025-10-01')).toBe('2025-10-01')
    expect(nextReminder([], '2025-10-01')).toBe('2025-10-01')
  })
})
