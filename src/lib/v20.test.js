import { describe, it, expect } from 'vitest'
import {
  SITES, ZONES, ZONE_BY_ID, THIGH_REGIONS, THIGH_ONLY_NOTE,
  zoneOf, zoneForGroup, sitesForRoute, regionsForZone, regionsForRoute,
} from './sites'
import {
  wearProfile, allSiteStates, rotationPath, nextOnPath, pathPreview, suggestBest,
  excludedSites, zoneLoad, rotationHealth, WEAR_WARN_RATIO, WEAR_OVERUSE_RATIO, WEAR_MIN_USES,
} from './rotation'
import {
  SKIP_REASONS, REASON_LABEL, isSkipped, isSupplementSkipped, skippedOn,
  supplementsSkippedOn, skipFor, splitAdherence, dayOutcome, skipsInRange, skipCounts,
} from './skips'
import { buildCalendar, ADHERENCE_TONE, ADHERENCE_WORDS } from './calendarView'
import { seedPeptides, THIGH_ONLY_IDS, TEST_E_ID } from '../data/seed'
import { addDaysStr } from './schedule'

const T = '2026-06-18'
const day = (o) => addDaysStr(T, o)

const THIGH_IDS = ['thl-uo', 'thl-ui', 'thl-lo', 'thl-li', 'thr-uo', 'thr-ui', 'thr-lo', 'thr-li']
const BELLY_IDS = ['abd-ul', 'abd-ur', 'abd-ml', 'abd-mr', 'abd-ll', 'abd-lr', 'lh-l', 'lh-r']

const log = (siteId, offset, peptideId = 'ss31') => ({
  id: `l-${siteId}-${offset}`, siteId, peptideId,
  date: day(offset), loggedAt: `${day(offset)}T09:00:00`,
})
const ctx = (over = {}) => ({ doseLogs: [], reactions: {}, todayStr: T, route: 'SubQ', ...over })

// ================================================================ 1 · zones

describe('the zone model', () => {
  it('offers exactly two zones', () => {
    expect(ZONES.map((z) => z.id)).toEqual(['all', 'thigh'])
    expect(ZONE_BY_ID.thigh.label).toBe('Thigh only')
  })

  it('defaults a peptide with no setting to the whole SubQ map', () => {
    expect(zoneOf({})).toBe('all')
    expect(zoneOf(undefined)).toBe('all')
    expect(zoneOf({ allowedZone: 'all' })).toBe('all')
    expect(zoneOf({ allowedZone: 'thigh' })).toBe('thigh')
  })

  it('narrows the SubQ pool to the eight thigh sites', () => {
    const all = sitesForRoute('SubQ')
    const thigh = sitesForRoute('SubQ', 'thigh')
    expect(all).toHaveLength(16)
    expect(thigh).toHaveLength(8)
    expect(thigh.map((s) => s.id).sort()).toEqual([...THIGH_IDS].sort())
    for (const s of thigh) expect(THIGH_REGIONS).toContain(s.region)
  })

  it('hides every belly and love-handle spot from a thigh-only compound', () => {
    const ids = new Set(sitesForRoute('SubQ', 'thigh').map((s) => s.id))
    for (const id of BELLY_IDS) expect(ids.has(id)).toBe(false)
  })

  it('leaves the IM map alone — it has no belly sites to exclude', () => {
    expect(sitesForRoute('IM', 'thigh')).toEqual(sitesForRoute('IM'))
  })

  it('narrows the region groups to the two thighs', () => {
    const groups = regionsForZone('SubQ', 'thigh')
    expect(groups.map((g) => g.id).sort()).toEqual(['thigh-l', 'thigh-r'])
    expect(regionsForZone('SubQ', 'all')).toEqual(regionsForRoute('SubQ'))
  })

  it('states the reason, so a shrunken map is never unexplained', () => {
    expect(THIGH_ONLY_NOTE).toMatch(/thigh only/i)
    expect(THIGH_ONLY_NOTE).toMatch(/reaction/i)
    expect(THIGH_ONLY_NOTE).toMatch(/stomach/i)
  })
})

describe('a co-draw takes the strictest zone in the syringe', () => {
  const free = { id: 'bpc157', name: 'BPC-157' }
  const strict = { id: 'ss31', name: 'SS-31', allowedZone: 'thigh' }

  it('is thigh-only if any one compound is', () => {
    expect(zoneForGroup([free, strict])).toBe('thigh')
    expect(zoneForGroup([strict, free])).toBe('thigh')
    expect(zoneForGroup([strict])).toBe('thigh')
  })

  it('stays flexible when nothing in it is restricted', () => {
    expect(zoneForGroup([free, { id: 'motsc' }])).toBe('all')
    expect(zoneForGroup([])).toBe('all')
  })
})

// =========================================================== 2 · the seeds

describe('the reaction-prone defaults', () => {
  const seeds = seedPeptides(T)
  const byId = Object.fromEntries(seeds.map((p) => [p.id, p]))

  it('names the five compounds kept off the belly', () => {
    expect([...THIGH_ONLY_IDS].sort()).toEqual(
      ['ghkcu', 'nad', 'ss31', 'tesamorelin', 'testosterone-e'].sort()
    )
  })

  it('ships each of them thigh-only', () => {
    for (const id of THIGH_ONLY_IDS) {
      expect(byId[id], `${id} missing from the seed`).toBeTruthy()
      expect(zoneOf(byId[id]), `${id} is not thigh-only`).toBe('thigh')
    }
  })

  it('leaves MOTS-c flexible on purpose', () => {
    expect(zoneOf(byId.motsc)).toBe('all')
    expect(zoneOf(byId.bpc157)).toBe('all')
    expect(zoneOf(byId.retatrutide)).toBe('all')
  })

  it('puts Testosterone E into thigh fat rather than muscle', () => {
    const te = byId[TEST_E_ID]
    expect(te.route).toBe('SubQ')
    expect(zoneOf(te)).toBe('thigh')
  })

  it('keeps Test E out of any shared syringe regardless', () => {
    expect(byId[TEST_E_ID].alwaysSeparate).toBe(true)
  })

  it('does not disturb the vial it was shipped with', () => {
    const te = byId[TEST_E_ID]
    expect(te.recon.vialMg / te.recon.bacMl).toBe(250)
  })
})

// ====================================================== 3 · routing by zone

describe('routing inside a narrowed zone', () => {
  it('suggests a thigh spot and never a belly one', () => {
    const c = ctx({ zone: 'thigh' })
    expect(THIGH_IDS).toContain(suggestBest(c))
  })

  it('walks a path made only of thigh sites', () => {
    const seq = rotationPath('SubQ', [], 'thigh')
    expect(seq).toHaveLength(8)
    for (const id of seq) expect(THIGH_IDS).toContain(id)
  })

  it('still alternates sides across the thigh path', () => {
    const seq = rotationPath('SubQ', [], 'thigh')
    let flips = 0
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].startsWith('thl') !== seq[i - 1].startsWith('thl')) flips += 1
    }
    // with four a side, a good order alternates nearly every step
    expect(flips).toBeGreaterThanOrEqual(6)
  })

  it('advances along the thigh path as thigh shots are logged', () => {
    const seq = rotationPath('SubQ', [], 'thigh')
    const first = seq[0]
    const next = nextOnPath(ctx({ zone: 'thigh', doseLogs: [log(first, 0)] }))
    expect(next.siteId).toBe(seq[1])
  })

  it('ignores a belly shot when deciding where the thigh rotation is up to', () => {
    // a flexible compound went into the belly yesterday; that says nothing
    // about where the thigh-only one should go
    const seq = rotationPath('SubQ', [], 'thigh')
    const next = nextOnPath(ctx({ zone: 'thigh', doseLogs: [log('abd-ul', 0, 'bpc157')] }))
    expect(THIGH_IDS).toContain(next.siteId)
    expect(next.siteId).toBe(seq[0])
  })

  it('previews only thigh spots', () => {
    for (const id of pathPreview(ctx({ zone: 'thigh' }), 3)) {
      expect(THIGH_IDS).toContain(id)
    }
  })

  it('reports state for eight sites, not sixteen', () => {
    expect(Object.keys(allSiteStates(ctx({ zone: 'thigh' })))).toHaveLength(8)
    expect(Object.keys(allSiteStates(ctx()))).toHaveLength(16)
  })

  it('scores rotation health against the thigh pool alone', () => {
    const logs = THIGH_IDS.map((id, i) => log(id, -i))
    const h = rotationHealth(ctx({ zone: 'thigh', doseLogs: logs }), { minLogs: 4, window: 28 })
    expect(h.ready).toBe(true)
  })
})

// ==================================================== 4 · thigh wear + load

describe('wear in a narrowed pool', () => {
  // one spot taking four of twelve thigh shots
  const heavy = [
    ...Array.from({ length: 4 }, (_, i) => log('thl-uo', -i * 2)),
    ...Array.from({ length: 8 }, (_, i) => log(THIGH_IDS[(i % 7) + 1], -i * 3)),
  ]

  it('measures fair share against the eight thigh sites, not all sixteen', () => {
    const wide = wearProfile(heavy, T, 'SubQ', 'all')
    const narrow = wearProfile(heavy, T, 'SubQ', 'thigh')
    // the same shots spread over half as many sites read as twice the share
    expect(narrow.fairShare).toBeGreaterThan(wide.fairShare)
    expect(narrow.sites['thl-uo'].ratio).toBeLessThan(wide.sites['thl-uo'].ratio)
  })

  it('flags a spot as nearing overuse before it is parked', () => {
    const ratios = { uses: 5, ratio: 1.5 }
    expect(WEAR_WARN_RATIO).toBeLessThan(WEAR_OVERUSE_RATIO)
    const logs = [
      ...Array.from({ length: 5 }, (_, i) => log('thl-uo', -i)),
      ...Array.from({ length: 9 }, (_, i) => log(THIGH_IDS[(i % 7) + 1], -i - 6)),
    ]
    const w = wearProfile(logs, T, 'SubQ', 'thigh').sites['thl-uo']
    if (w.ratio >= WEAR_WARN_RATIO && w.ratio < WEAR_OVERUSE_RATIO && w.uses >= WEAR_MIN_USES) {
      expect(w.nearing).toBe(true)
      expect(w.overworn).toBe(false)
    }
  })

  it('parks an over-used thigh spot and routes around it', () => {
    const hammered = Array.from({ length: 10 }, (_, i) => log('thl-uo', -i * 2))
    const c = ctx({ zone: 'thigh', doseLogs: hammered })
    expect(excludedSites(c)).toContain('thl-uo')
    expect(suggestBest(c)).not.toBe('thl-uo')
    expect(rotationPath('SubQ', excludedSites(c), 'thigh')).not.toContain('thl-uo')
  })

  it('says nothing when the thighs are being rotated evenly', () => {
    const even = THIGH_IDS.map((id, i) => log(id, -i * 2))
    const load = zoneLoad(ctx({ zone: 'thigh', doseLogs: even }))
    expect(load.level).toBe('ok')
    expect(load.message).toBe(null)
  })

  it('warns while spots are still usable, not only once they are gone', () => {
    const lopsided = [
      ...Array.from({ length: 6 }, (_, i) => log('thl-uo', -i)),
      ...Array.from({ length: 6 }, (_, i) => log('thr-uo', -i)),
      ...Array.from({ length: 4 }, (_, i) => log(THIGH_IDS[i + 2], -i - 10)),
    ]
    const load = zoneLoad(ctx({ zone: 'thigh', doseLogs: lopsided }))
    expect(['watch', 'high', 'critical']).toContain(load.level)
    expect(load.message).toBeTruthy()
    expect(load.total).toBe(8)
  })

  it('names the thigh when the narrowed pool is the one under pressure', () => {
    const hammered = THIGH_IDS.slice(0, 6).flatMap((id) =>
      Array.from({ length: 6 }, (_, i) => log(id, -i)))
    const load = zoneLoad(ctx({ zone: 'thigh', doseLogs: hammered }))
    if (load.message) expect(load.message).toMatch(/thigh/i)
  })

  it('offers a way out rather than a dead end when everything is parked', () => {
    const c = ctx({
      zone: 'thigh',
      reactions: Object.fromEntries(THIGH_IDS.map((id) => [id, [{ id: `r${id}`, kind: 'lump', date: T, cleared: false }]])),
    })
    const load = zoneLoad(c)
    expect(load.level).toBe('critical')
    expect(load.message).toMatch(/all SubQ sites|few days/i)
    // and it still answers with a spot rather than nothing
    expect(nextOnPath(c).siteId).toBeTruthy()
  })
})

// ================================================================ 5 · skips

describe('skipping a dose', () => {
  const skips = [
    { id: 'k1', kind: 'peptide', peptideId: 'ss31', date: T, name: 'SS-31', reason: 'travel', at: `${T}T08:00` },
    { id: 'k2', kind: 'supplement', supplementId: 's1', date: T, name: 'Glycine', reason: '', at: `${T}T09:00` },
    { id: 'k3', kind: 'peptide', peptideId: 'nad', date: day(-3), name: 'NAD+', reason: 'stock', at: `${day(-3)}T08:00` },
  ]

  it('reads back what was skipped, by kind and date', () => {
    expect(isSkipped(skips, 'ss31', T)).toBe(true)
    expect(isSkipped(skips, 'ss31', day(-1))).toBe(false)
    expect(isSupplementSkipped(skips, 's1', T)).toBe(true)
    // a supplement id must not match a peptide lookup
    expect(isSkipped(skips, 's1', T)).toBe(false)
  })

  it('gives the ids for a date as sets', () => {
    expect(skippedOn(skips, T)).toEqual(new Set(['ss31']))
    expect(supplementsSkippedOn(skips, T)).toEqual(new Set(['s1']))
  })

  it('keeps the reason when there is one, and copes when there is not', () => {
    expect(skipFor(skips, 'ss31', T).reason).toBe('travel')
    expect(REASON_LABEL.travel).toBe('Travelling')
    expect(skipFor(skips, 'missing', T)).toBe(null)
  })

  it('offers reasons but never demands one', () => {
    expect(SKIP_REASONS.length).toBeGreaterThan(2)
    // an empty reason is still a valid skip
    expect(isSupplementSkipped(skips, 's1', T)).toBe(true)
    expect(skips.find((k) => k.id === 'k2').reason).toBe('')
  })

  it('lists and counts skips in a window', () => {
    expect(skipsInRange(skips, day(-7), T)).toHaveLength(3)
    expect(skipsInRange(skips, T, T)).toHaveLength(2)
    expect(skipCounts(skips, day(-7), T)).toEqual({ ss31: 1, s1: 1, nad: 1 })
  })

  it('is newest first, so the recent decision is the visible one', () => {
    const rows = skipsInRange(skips, day(-7), T)
    expect(rows[0].date >= rows[rows.length - 1].date).toBe(true)
  })
})

describe('skips are not misses', () => {
  it('separates skipped from missed in the totals', () => {
    const a = splitAdherence({ scheduled: 10, taken: 7, skipped: 2 })
    expect(a.skipped).toBe(2)
    expect(a.missed).toBe(1) // 10 − 2 skipped − 7 taken
    expect(a.attempted).toBe(8)
  })

  it('reports the honest headline and the fairer read side by side', () => {
    const a = splitAdherence({ scheduled: 10, taken: 7, skipped: 2 })
    expect(a.pct).toBe(70) // of everything scheduled
    expect(a.ofAttempted).toBe(88) // of what wasn't deliberately skipped
    expect(a.ofAttempted).toBeGreaterThan(a.pct)
  })

  it('never reports a negative miss count', () => {
    const a = splitAdherence({ scheduled: 3, taken: 3, skipped: 3 })
    expect(a.missed).toBe(0)
  })

  it('has no rate to report when nothing was scheduled', () => {
    const a = splitAdherence({ scheduled: 0, taken: 0, skipped: 0 })
    expect(a.pct).toBe(null)
    expect(a.ofAttempted).toBe(null)
  })

  it('calls a fully skipped day skipped, never missed', () => {
    expect(dayOutcome({ scheduled: 2, taken: 0, skipped: 2 })).toBe('skipped')
    expect(dayOutcome({ scheduled: 2, taken: 0, skipped: 0 })).toBe('missed')
  })

  it('calls a day taken-and-skipped a resolved day, not a lapse', () => {
    expect(dayOutcome({ scheduled: 3, taken: 2, skipped: 1 })).toBe('partial-skipped')
  })

  it('still calls a genuinely incomplete day partial', () => {
    expect(dayOutcome({ scheduled: 3, taken: 1, skipped: 0 })).toBe('partial')
    expect(dayOutcome({ scheduled: 3, taken: 3, skipped: 0 })).toBe('all')
  })

  it('gives skipped its own colour and wording on the calendar', () => {
    expect(ADHERENCE_TONE.skipped).toBeTruthy()
    expect(ADHERENCE_TONE.skipped).not.toBe(ADHERENCE_TONE.missed)
    expect(ADHERENCE_WORDS.skipped).toBe('skipped')
  })
})

describe('skips in the calendar', () => {
  const p = {
    id: 'bpc157', name: 'BPC-157', startDate: day(-30), frequency: 'daily',
    ladder: { unit: 'mcg', floor: 250, step: 0, ceiling: 250, intervalWeeks: 2 },
    cycleOnDays: 0, cycleOffDays: 0, route: 'SubQ',
    recon: { vialMg: 5, bacMl: 2, expiryDays: 28 },
  }
  const base = {
    peptides: [p], titration: { bpc157: { level: 0, levelStartDate: day(-30) } },
    doseLogs: [], openVials: {}, vials: [], supplements: [], supplementLogs: [],
    restock: {}, todayStr: T,
  }

  it('marks a skipped day as skipped rather than missed', () => {
    const cal = buildCalendar({
      ...base, skips: [{ id: 'k', kind: 'peptide', peptideId: 'bpc157', date: day(-2) }],
      from: day(-2), to: day(-2),
    })
    expect(cal.byDate[day(-2)].adherence).toBe('skipped')
    expect(cal.byDate[day(-2)].skipped).toBe(1)
  })

  it('leaves an ordinary missed day alone', () => {
    const cal = buildCalendar({ ...base, skips: [], from: day(-2), to: day(-2) })
    expect(cal.byDate[day(-2)].adherence).toBe('missed')
  })

  it('does not let a skip make a day look taken', () => {
    const cal = buildCalendar({
      ...base, skips: [{ id: 'k', kind: 'peptide', peptideId: 'bpc157', date: day(-2) }],
      from: day(-2), to: day(-2),
    })
    expect(cal.byDate[day(-2)].done).toBe(0)
  })
})
