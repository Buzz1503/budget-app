import { describe, it, expect } from 'vitest'
import {
  SITES, SITE_BY_ID, daysSince, siteStatus, suggestSite, lastUsedSite, perfectRotation,
} from './sites'

describe('site inventory', () => {
  it('has 16 sites: 6 abdomen, 2 love handles, 4+4 thighs', () => {
    expect(SITES.length).toBe(16)
    const by = (r) => SITES.filter((s) => s.region === r).length
    expect(by('abdomen')).toBe(6)
    expect(by('love-handle-L') + by('love-handle-R')).toBe(2)
    expect(by('thigh-L')).toBe(4)
    expect(by('thigh-R')).toBe(4)
  })
  it('every neighbor id resolves', () => {
    for (const s of SITES) for (const n of s.neighbors) expect(SITE_BY_ID[n], `${s.id}->${n}`).toBeTruthy()
  })
})

const today = '2026-02-01'
const log = (siteId, date) => ({ id: `${siteId}-${date}`, siteId, date, loggedAt: `${date}T10:00:00` })

describe('recency', () => {
  it('daysSince counts calendar days, null if never used', () => {
    const logs = [log('abd-ul', '2026-01-25')]
    expect(daysSince('abd-ul', logs, today)).toBe(7)
    expect(daysSince('lh-l', logs, today)).toBe(null)
  })
  it('siteStatus buckets by recency', () => {
    const logs = [log('abd-ul', '2026-02-01'), log('abd-ur', '2026-01-29'), log('abd-ml', '2026-01-20')]
    expect(siteStatus('abd-ul', logs, today).level).toBe('blocked') // 0d
    expect(siteStatus('abd-ur', logs, today).level).toBe('warm')    // 3d
    expect(siteStatus('abd-ml', logs, today).level).toBe('rested')  // 12d
    expect(siteStatus('lh-r', logs, today).level).toBe('fresh')     // never
  })
})

describe('suggestion', () => {
  it('lastUsedSite is the most recent by timestamp', () => {
    const logs = [log('abd-ul', '2026-01-30'), log('thr-uo', '2026-01-31')]
    expect(lastUsedSite(logs)).toBe('thr-uo')
  })
  it('suggests a never-used site when most are fresh', () => {
    const logs = [log('abd-ul', '2026-01-31')]
    const s = suggestSite(logs, today)
    expect(s).not.toBe('abd-ul')
    expect(daysSince(s, logs, today)).toBe(null) // a fresh site
  })
  it('avoids the last-used site and its immediate neighbours', () => {
    // make everything used recently except leave neighbours of last in play to prove they are skipped
    const logs = []
    // use all sites 5 days ago
    for (const s of SITES) logs.push(log(s.id, '2026-01-27'))
    // then use abd-ul today (most recent)
    logs.push(log('abd-ul', '2026-02-01'))
    const s = suggestSite(logs, today)
    expect(s).not.toBe('abd-ul')
    expect(SITE_BY_ID['abd-ul'].neighbors).not.toContain(s)
  })
  it('picks the longest-rested among eligible', () => {
    const logs = [
      log('abd-ul', '2026-01-31'), // last used
      log('thr-uo', '2026-01-30'),
      log('thl-uo', '2026-01-10'), // longest rested, not a neighbour of abd-ul
    ]
    // fill the rest as used yesterday so thl-uo clearly wins
    for (const s of SITES) if (!['abd-ul', 'thr-uo', 'thl-uo'].includes(s.id)) logs.push(log(s.id, '2026-01-31'))
    expect(suggestSite(logs, today)).toBe('thl-uo')
  })
})

describe('perfect rotation', () => {
  it('true when 7 consecutive injections never repeat a site', () => {
    const ids = ['abd-ul', 'thr-uo', 'lh-l', 'thl-uo', 'abd-lr', 'thr-li', 'abd-ur']
    const logs = ids.map((id, i) => log(id, `2026-01-${String(26 + Math.floor(i / 2)).padStart(2, '0')}`))
    // ensure strictly increasing timestamps
    logs.forEach((l, i) => { l.loggedAt = `2026-01-26T${String(8 + i).padStart(2, '0')}:00:00`; l.date = '2026-01-30' })
    expect(perfectRotation(logs, '2026-01-31')).toBe(true)
  })
  it('false when a site repeats back-to-back', () => {
    const ids = ['abd-ul', 'abd-ul', 'lh-l', 'thl-uo', 'abd-lr', 'thr-li', 'abd-ur']
    const logs = ids.map((id, i) => ({ id: `x${i}`, siteId: id, date: '2026-01-30', loggedAt: `2026-01-30T${String(8 + i).padStart(2, '0')}:00:00` }))
    expect(perfectRotation(logs, '2026-01-31')).toBe(false)
  })
})
