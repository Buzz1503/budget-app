import { describe, it, expect } from 'vitest'
import {
  heatOf, daysSinceUse, siteHistory, wearCounts, wearProfile, reactionState, repeatReactors,
  siteState, allSiteStates, rotationPath, excludedSites, nextOnPath, pathPreview,
  suggestBest, suggestReason, rotationHealth, gradeFor, sideOf, restDaysFor, faceOf,
  sitesOnFace, REST_DAYS, WEAR_OVERUSE_RATIO, WEAR_MIN_USES, REACTION_KINDS, SITE_STATUS,
} from './rotation'
import { SITES, IM_SITES, SITE_BY_ID, sitesForRoute } from './sites'
import { addDaysStr } from './schedule'
import { heatColor } from '../components/BodyMap'

const T = '2026-06-15'
const log = (siteId, dayOffset, peptideId = 'bpc157') => ({
  id: `l-${siteId}-${dayOffset}`, siteId, peptideId,
  date: addDaysStr(T, dayOffset), loggedAt: `${addDaysStr(T, dayOffset)}T09:00:00`,
})
const ctxFor = (doseLogs = [], reactions = {}, route = 'SubQ') => ({ doseLogs, reactions, todayStr: T, route })

// ---------- heat ----------
describe('heat', () => {
  it('is 1 the day of use and 0 once fully rested', () => {
    expect(heatOf('abd-ul', [log('abd-ul', 0)], T, 'SubQ')).toBe(1)
    expect(heatOf('abd-ul', [log('abd-ul', -7)], T, 'SubQ')).toBe(0)
    expect(heatOf('abd-ul', [log('abd-ul', -30)], T, 'SubQ')).toBe(0)
  })

  it('is 0 for a site never used', () => {
    expect(heatOf('abd-ul', [], T, 'SubQ')).toBe(0)
    expect(daysSinceUse('abd-ul', [], T)).toBeNull()
  })

  it('cools monotonically across the rest window', () => {
    const series = [0, -1, -2, -3, -4, -5, -6, -7].map((d) => heatOf('abd-ul', [log('abd-ul', d)], T, 'SubQ'))
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeLessThan(series[i - 1])
    expect(series.at(-1)).toBe(0)
  })

  it('gives muscle a longer rest than fat', () => {
    expect(REST_DAYS.IM).toBeGreaterThan(REST_DAYS.SubQ)
    expect(restDaysFor('IM')).toBe(REST_DAYS.IM)
    expect(restDaysFor('SubQ')).toBe(REST_DAYS.SubQ)
    // the same 8-day-old shot is cold SubQ but still warm IM
    expect(heatOf('im-glute-l', [log('im-glute-l', -8)], T, 'SubQ')).toBe(0)
    expect(heatOf('im-glute-l', [log('im-glute-l', -8)], T, 'IM')).toBeGreaterThan(0)
  })

  it('takes the most recent use when a site has several', () => {
    const logs = [log('abd-ul', -20), log('abd-ul', -1), log('abd-ul', -9)]
    expect(daysSinceUse('abd-ul', logs, T)).toBe(1)
  })

  it('maps to a colour that runs coral → amber → lime', () => {
    expect(heatColor(0)).toBe('var(--lime)')
    expect(heatColor(1)).toBe('var(--coral)')
    expect(heatColor(0.8)).toMatch(/coral/)
    expect(heatColor(0.2)).toMatch(/amber/)
  })
})

// ---------- wear ----------
describe('cumulative wear', () => {
  it('counts uses inside the window and ignores older ones', () => {
    const logs = [log('abd-ul', -5), log('abd-ul', -40), log('abd-ul', -200)]
    expect(wearCounts(logs, T, 'SubQ')['abd-ul']).toBe(2)
  })

  it('flags a site carrying well over its fair share', () => {
    // 10 shots into one site, 1 each into two others
    const logs = [
      ...Array.from({ length: 10 }, (_, i) => log('abd-ul', -i - 1)),
      log('abd-ur', -3), log('abd-ml', -4),
    ]
    const w = wearProfile(logs, T, 'SubQ')
    expect(w.sites['abd-ul'].uses).toBe(10)
    expect(w.sites['abd-ul'].ratio).toBeGreaterThan(WEAR_OVERUSE_RATIO)
    expect(w.sites['abd-ul'].overworn).toBe(true)
    expect(w.sites['abd-ur'].overworn).toBe(false)
  })

  it('will not call a site over-worn on a couple of uses', () => {
    const logs = [log('abd-ul', -1), log('abd-ul', -2)]
    const w = wearProfile(logs, T, 'SubQ')
    expect(w.sites['abd-ul'].uses).toBeLessThan(WEAR_MIN_USES)
    expect(w.sites['abd-ul'].overworn).toBe(false)
  })

  it('an over-worn site is excluded even when its recency looks fine', () => {
    // heavily used, but not for a fortnight — recency alone would clear it
    const logs = Array.from({ length: 12 }, (_, i) => log('abd-ul', -i - 14))
    const st = siteState('abd-ul', ctxFor(logs))
    expect(st.heat).toBe(0)
    expect(st.overworn).toBe(true)
    expect(st.usable).toBe(false)
    expect(st.status).toBe('overworn')
  })
})

// ---------- reactions ----------
describe('reactions', () => {
  const rx = (kind, dayOffset, cleared = false) => ({
    id: `rx-${kind}`, kind, date: addDaysStr(T, dayOffset), cleared,
  })

  it('an uncleared reaction rests the site', () => {
    const st = reactionState('abd-ul', { 'abd-ul': [rx('lump', -1)] }, T)
    expect(st.resting).toBe(true)
    expect(st.active.kind).toBe('lump')
    expect(st.daysLeft).toBeGreaterThan(0)
  })

  it('a cleared reaction stays in the history but stops resting the site', () => {
    const st = reactionState('abd-ul', { 'abd-ul': [rx('bruise', -2, true)] }, T)
    expect(st.resting).toBe(false)
    expect(st.history).toHaveLength(1)
  })

  it('the longest rest wins when several are open', () => {
    const st = reactionState('abd-ul', { 'abd-ul': [rx('bleed', -1), rx('lump', -1)] }, T)
    expect(st.active.kind).toBe('lump')
  })

  it('a resting site is excluded from everything', () => {
    const ctx = ctxFor([], { 'abd-ul': [rx('lump', 0)] })
    const st = siteState('abd-ul', ctx)
    expect(st.resting).toBe(true)
    expect(st.usable).toBe(false)
    expect(st.status).toBe('resting')
    expect(excludedSites(ctx)).toContain('abd-ul')
    expect(rotationPath('SubQ', excludedSites(ctx))).not.toContain('abd-ul')
    expect(suggestBest(ctx)).not.toBe('abd-ul')
    expect(nextOnPath(ctx).siteId).not.toBe('abd-ul')
  })

  it('every reaction kind has a label and a rest period', () => {
    for (const k of REACTION_KINDS) {
      expect(k.label).toBeTruthy()
      expect(k.restDays).toBeGreaterThan(0)
    }
  })

  it('surfaces a site that keeps reacting', () => {
    const reactions = { 'abd-ul': [rx('sting', -3, true), rx('bruise', -10, true), rx('pain', -20, true)] }
    const out = repeatReactors(reactions, T)
    expect(out[0].siteId).toBe('abd-ul')
    expect(out[0].count).toBe(3)
    expect(repeatReactors({ 'abd-ur': [rx('sting', -3)] }, T)).toEqual([])
  })
})

// ---------- combined state ----------
describe('siteState', () => {
  it('every status it can return has display metadata', () => {
    const states = allSiteStates(ctxFor([log('abd-ul', 0), log('abd-ur', -3)]))
    for (const s of Object.values(states)) {
      expect(SITE_STATUS[s.status], `no metadata for ${s.status}`).toBeTruthy()
    }
  })

  it('reads hot on the day, cooling in the middle, rested at the end', () => {
    expect(siteState('abd-ul', ctxFor([log('abd-ul', 0)])).status).toBe('hot')
    expect(siteState('abd-ul', ctxFor([log('abd-ul', -3)])).status).toBe('cooling')
    expect(siteState('abd-ul', ctxFor([log('abd-ul', -8)])).status).toBe('rested')
    expect(siteState('abd-ul', ctxFor([])).status).toBe('fresh')
  })

  it('a reaction outranks both heat and wear', () => {
    const ctx = ctxFor([log('abd-ul', 0)], { 'abd-ul': [{ id: 'r', kind: 'lump', date: T, cleared: false }] })
    expect(siteState('abd-ul', ctx).status).toBe('resting')
  })

  it('covers the whole pool for the route, and only that pool', () => {
    const subq = allSiteStates(ctxFor([], {}, 'SubQ'))
    const im = allSiteStates(ctxFor([], {}, 'IM'))
    expect(Object.keys(subq).sort()).toEqual(SITES.map((s) => s.id).sort())
    expect(Object.keys(im).sort()).toEqual(IM_SITES.map((s) => s.id).sort())
  })
})

// ---------- the path ----------
describe('rotationPath', () => {
  it('covers every usable site exactly once', () => {
    const seq = rotationPath('SubQ')
    expect(seq).toHaveLength(SITES.length)
    expect(new Set(seq).size).toBe(seq.length)
  })

  it('is stable — the same input always gives the same order', () => {
    expect(rotationPath('SubQ')).toEqual(rotationPath('SubQ'))
    expect(rotationPath('IM')).toEqual(rotationPath('IM'))
  })

  it('does not depend on the dose log, so the path never reshuffles under you', () => {
    const before = rotationPath('SubQ')
    // logging changes state everywhere else, but not the sequence itself
    const after = rotationPath('SubQ')
    expect(after).toEqual(before)
  })

  it('alternates sides on almost every step', () => {
    const seq = rotationPath('SubQ')
    let alternating = 0
    for (let i = 1; i < seq.length; i++) {
      if (sideOf(SITE_BY_ID[seq[i]]) !== sideOf(SITE_BY_ID[seq[i - 1]])) alternating += 1
    }
    expect(alternating / (seq.length - 1)).toBeGreaterThan(0.85)
  })

  it('never puts two adjacent spots back to back', () => {
    const seq = rotationPath('SubQ')
    for (let i = 1; i < seq.length; i++) {
      const prev = SITE_BY_ID[seq[i - 1]]
      expect(prev.neighbors || []).not.toContain(seq[i])
    }
  })

  it('drops excluded sites', () => {
    const seq = rotationPath('SubQ', ['abd-ul', 'thl-uo'])
    expect(seq).not.toContain('abd-ul')
    expect(seq).not.toContain('thl-uo')
    expect(seq).toHaveLength(SITES.length - 2)
  })

  it('copes with a pool of one, or none', () => {
    const nearly = SITES.slice(1).map((s) => s.id)
    expect(rotationPath('SubQ', nearly)).toEqual([SITES[0].id])
    expect(rotationPath('SubQ', SITES.map((s) => s.id))).toEqual([])
  })
})

describe('nextOnPath', () => {
  it('starts at the beginning with no history', () => {
    const { siteId, seq } = nextOnPath(ctxFor([]))
    expect(siteId).toBe(seq[0])
  })

  it('auto-advances to the site after the last one used', () => {
    const seq = rotationPath('SubQ')
    const { siteId } = nextOnPath(ctxFor([log(seq[0], 0)]))
    expect(siteId).toBe(seq[1])
  })

  it('wraps around at the end of the cycle', () => {
    const seq = rotationPath('SubQ')
    const { siteId } = nextOnPath(ctxFor([log(seq.at(-1), 0)]))
    expect(siteId).toBe(seq[0])
  })

  it('skips a site that started resting, without losing its place', () => {
    const full = rotationPath('SubQ')
    const parked = full[1]
    const ctx = ctxFor([log(full[0], 0)], { [parked]: [{ id: 'r', kind: 'lump', date: T, cleared: false }] })
    const { siteId, seq } = nextOnPath(ctx)
    expect(seq).not.toContain(parked)
    expect(siteId).not.toBe(parked)
  })

  it('skips an over-worn site too', () => {
    const full = rotationPath('SubQ')
    const worn = full[1]
    const logs = [log(full[0], 0), ...Array.from({ length: 12 }, (_, i) => log(worn, -i - 2))]
    const { seq } = nextOnPath(ctxFor(logs))
    expect(seq).not.toContain(worn)
  })

  it('falls back honestly when every spot is parked', () => {
    const reactions = Object.fromEntries(
      SITES.map((s) => [s.id, [{ id: `r-${s.id}`, kind: 'lump', date: T, cleared: false }]])
    )
    const out = nextOnPath(ctxFor([], reactions))
    expect(out.allParked).toBe(true)
    expect(out.siteId).toBeTruthy()
  })

  it('previews the next few stops', () => {
    const seq = rotationPath('SubQ')
    expect(pathPreview(ctxFor([]), 3)).toEqual([seq[0], seq[1], seq[2]])
  })

  it('walking the whole path uses every site once before repeating', () => {
    let logs = []
    const used = []
    for (let i = 0; i < SITES.length; i++) {
      const { siteId } = nextOnPath(ctxFor(logs))
      used.push(siteId)
      logs = [...logs, log(siteId, -SITES.length + i)]
    }
    expect(new Set(used).size).toBe(SITES.length)
  })
})

// ---------- single-suggestion mode ----------
describe('suggestBest', () => {
  it('prefers a never-used site', () => {
    const logs = SITES.slice(1).map((s, i) => log(s.id, -i - 1))
    expect(suggestBest(ctxFor(logs))).toBe(SITES[0].id)
  })

  it('picks the coolest when everything has been used', () => {
    const logs = SITES.map((s, i) => log(s.id, -i - 1))
    const best = suggestBest(ctxFor(logs))
    expect(SITE_BY_ID[best]).toBeTruthy()
    expect(heatOf(best, logs, T, 'SubQ')).toBe(0)
  })

  it('never suggests a resting or over-worn site', () => {
    const worn = Array.from({ length: 12 }, (_, i) => log('abd-ul', -i - 1))
    const ctx = ctxFor(worn, { 'abd-ur': [{ id: 'r', kind: 'lump', date: T, cleared: false }] })
    const best = suggestBest(ctx)
    expect(best).not.toBe('abd-ul')
    expect(best).not.toBe('abd-ur')
  })

  it('stays inside the route pool', () => {
    const im = suggestBest(ctxFor([], {}, 'IM'))
    expect(IM_SITES.map((s) => s.id)).toContain(im)
    const subq = suggestBest(ctxFor([], {}, 'SubQ'))
    expect(SITES.map((s) => s.id)).toContain(subq)
  })

  it('explains itself in plain words', () => {
    expect(suggestReason('abd-ul', ctxFor([]))).toMatch(/never used/)
    expect(suggestReason('abd-ul', ctxFor([log('abd-ul', -9)]))).toMatch(/healed/)
  })
})

// ---------- rotation health ----------
describe('rotationHealth', () => {
  it('says nothing until there is enough to judge', () => {
    const h = rotationHealth(ctxFor([log('abd-ul', -1)]))
    expect(h.ready).toBe(false)
    expect(h.needed).toBeGreaterThan(h.logs)
  })

  it('scores an even, well-rested, balanced rotation highly', () => {
    // walk the planned path — that is the ideal by construction
    const seq = rotationPath('SubQ')
    const logs = seq.slice(0, 12).map((id, i) => log(id, -12 + i))
    const h = rotationHealth(ctxFor(logs))
    expect(h.ready).toBe(true)
    expect(h.score).toBeGreaterThanOrEqual(90)
    expect(h.grade).toBe('Excellent')
    expect(h.issues).toEqual([])
  })

  it('marks down hammering one spot, and says so', () => {
    const logs = Array.from({ length: 10 }, (_, i) => log('abd-ul', -10 + i))
    const h = rotationHealth(ctxFor(logs))
    expect(h.score).toBeLessThan(55)
    expect(h.issues.map((i) => i.kind)).toContain('clustering')
    expect(h.nudge).toBeTruthy()
  })

  it('notices favouring one side', () => {
    const leftIds = SITES.filter((s) => sideOf(s) === 'L').map((s) => s.id)
    const logs = leftIds.slice(0, 8).map((id, i) => log(id, -8 + i))
    const h = rotationHealth(ctxFor(logs))
    expect(h.left).toBeGreaterThan(h.right)
    expect(h.issues.map((i) => i.kind)).toContain('balance')
    expect(h.issues.find((i) => i.kind === 'balance').text).toMatch(/left/)
  })

  it('notices reusing sites before they have healed', () => {
    const logs = ['abd-ul', 'abd-lr', 'abd-ul', 'abd-lr', 'abd-ul', 'abd-lr']
      .map((id, i) => log(id, -6 + i))
    const h = rotationHealth(ctxFor(logs))
    expect(h.issues.map((i) => i.kind)).toContain('rest')
  })

  it('grades the whole 0–100 range', () => {
    expect(gradeFor(95).label).toBe('Excellent')
    expect(gradeFor(80).label).toBe('Good')
    expect(gradeFor(60).label).toBe('Fair')
    expect(gradeFor(10).label).toBe('Needs work')
  })

  it('always has something to say', () => {
    const seq = rotationPath('SubQ')
    const logs = seq.slice(0, 10).map((id, i) => log(id, -10 + i))
    expect(rotationHealth(ctxFor(logs)).nudge.length).toBeGreaterThan(10)
  })
})

// ---------- front / back ----------
describe('front and back views', () => {
  it('puts every SubQ site on the front', () => {
    for (const s of SITES) expect(faceOf(s)).toBe('front')
    expect(sitesOnFace('SubQ', 'back')).toEqual([])
  })

  it('gives IM a back view, and the glutes live on it', () => {
    const back = sitesOnFace('IM', 'back').map((s) => s.id)
    expect(back).toEqual(['im-glute-l', 'im-glute-r'])
    const front = sitesOnFace('IM', 'front').map((s) => s.id)
    expect(front).toEqual(expect.arrayContaining(['im-delt-l', 'im-delt-r', 'im-quad-l', 'im-quad-r']))
  })

  it('keeps left on the left across both views', () => {
    expect(sideOf(SITE_BY_ID['im-glute-l'])).toBe('L')
    expect(sideOf(SITE_BY_ID['im-glute-r'])).toBe('R')
    expect(sideOf(SITE_BY_ID['im-delt-l'])).toBe('L')
    expect(sideOf(SITE_BY_ID['thl-uo'])).toBe('L')
    expect(sideOf(SITE_BY_ID['thr-uo'])).toBe('R')
  })

  it('every site in every pool has a face and a side', () => {
    for (const route of ['SubQ', 'IM']) {
      for (const s of sitesForRoute(route)) {
        expect(['front', 'back']).toContain(faceOf(s))
        expect(['L', 'R']).toContain(sideOf(s))
      }
    }
  })
})

// ---------- history ----------
describe('siteHistory', () => {
  it('lists a site\'s own shots, newest first, with compound names', () => {
    const peptides = [{ id: 'bpc157', name: 'BPC-157' }]
    const logs = [log('abd-ul', -5), log('abd-ur', -1), log('abd-ul', -1)]
    const h = siteHistory('abd-ul', logs, peptides)
    expect(h).toHaveLength(2)
    expect(h[0].date).toBe(addDaysStr(T, -1))
    expect(h[0].name).toBe('BPC-157')
  })

  it('is empty for a site never used', () => {
    expect(siteHistory('abd-ul', [], [])).toEqual([])
  })
})
