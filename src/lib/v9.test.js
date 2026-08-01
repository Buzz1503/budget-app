import { describe, it, expect } from 'vitest'
import {
  SITES, IM_SITES, ALL_SITES, SITE_BY_ID, NAVEL, KEEP_CLEAR_R,
  SUBQ_REGIONS, IM_REGIONS, regionsForRoute, sitesInRegionGroup,
  daysWords, restedWords, lastShot, suggestionReason, suggestSite,
} from './sites'
import { GLOSSARY, glossaryFor } from './glossary'

const log = (siteId, date) => ({ id: `${siteId}-${date}`, siteId, date, loggedAt: `${date}T10:00:00` })
const today = '2026-02-10'

describe('beginner-facing site data', () => {
  it('every spot is numbered, labelled and described in plain words', () => {
    for (const s of ALL_SITES) {
      expect(s.n, s.id).toBeGreaterThan(0)
      expect(s.short, s.id).toBeTruthy()
      expect(s.plain, s.id).toBeTruthy()
      // a description that a first-timer can act on names a body landmark
      expect(s.plain.length, s.id).toBeGreaterThan(25)
      expect(s.plain.endsWith('.'), s.id).toBe(true)
    }
  })

  it('numbers run 1..16 on the SubQ map and 1..6 on the IM map', () => {
    expect(SITES.map((s) => s.n).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    expect(IM_SITES.map((s) => s.n).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('belly spots describe themselves relative to the belly button', () => {
    for (const s of SITES.filter((x) => x.region === 'abdomen')) {
      expect(s.plain.toLowerCase()).toContain('belly button')
      expect(s.plain.toLowerCase()).toContain('finger-widths')
    }
  })

  it('love handles reference the hip bone, thighs reference hip-to-knee', () => {
    for (const s of SITES.filter((x) => x.region.startsWith('love-handle'))) {
      expect(s.plain.toLowerCase()).toContain('hip bone')
      expect(s.plain.toLowerCase()).toContain('waist')
    }
    for (const s of SITES.filter((x) => x.region.startsWith('thigh'))) {
      expect(s.plain.toLowerCase()).toContain('knee')
    }
  })

  it('every belly spot sits outside the keep-clear ring around the navel', () => {
    for (const s of SITES.filter((x) => x.region === 'abdomen')) {
      const d = Math.hypot(s.x - NAVEL.x, s.y - NAVEL.y)
      expect(d, `${s.id} is ${d.toFixed(1)} from the navel`).toBeGreaterThanOrEqual(KEEP_CLEAR_R)
    }
  })

  it('no two spots on the same map overlap at the rendered radius', () => {
    const R = 3.4 // must match BodyMap's whole-body target radius
    for (const map of [SITES, IM_SITES]) {
      for (let i = 0; i < map.length; i++) {
        for (let j = i + 1; j < map.length; j++) {
          const d = Math.hypot(map[i].x - map[j].x, map[i].y - map[j].y)
          expect(d, `${map[i].id} ↔ ${map[j].id}`).toBeGreaterThanOrEqual(2 * R)
        }
      }
    }
  })
})

describe('region zoom', () => {
  it('covers every spot exactly once, per route', () => {
    const subq = SUBQ_REGIONS.flatMap((g) => sitesInRegionGroup(g, 'SubQ').map((s) => s.id))
    expect(subq.sort()).toEqual(SITES.map((s) => s.id).sort())
    const im = IM_REGIONS.flatMap((g) => sitesInRegionGroup(g, 'IM').map((s) => s.id))
    expect(im.sort()).toEqual(IM_SITES.map((s) => s.id).sort())
  })

  it('picks the right region set for the route', () => {
    expect(regionsForRoute('IM')).toBe(IM_REGIONS)
    expect(regionsForRoute('SubQ')).toBe(SUBQ_REGIONS)
    expect(regionsForRoute(undefined)).toBe(SUBQ_REGIONS)
  })

  it('every zoom viewBox actually frames its spots', () => {
    for (const [groups, route] of [[SUBQ_REGIONS, 'SubQ'], [IM_REGIONS, 'IM']]) {
      for (const g of groups) {
        const [vx, vy, vw, vh] = g.view.split(' ').map(Number)
        for (const s of sitesInRegionGroup(g, route)) {
          expect(s.x, `${g.id}/${s.id} x`).toBeGreaterThanOrEqual(vx)
          expect(s.x, `${g.id}/${s.id} x`).toBeLessThanOrEqual(vx + vw)
          expect(s.y, `${g.id}/${s.id} y`).toBeGreaterThanOrEqual(vy)
          expect(s.y, `${g.id}/${s.id} y`).toBeLessThanOrEqual(vy + vh)
        }
      }
    }
  })
})

describe('plain-language recency', () => {
  it('says it in words, not colours', () => {
    expect(daysWords(null)).toBe('never used')
    expect(daysWords(0)).toBe('used today')
    expect(daysWords(1)).toBe('used yesterday')
    expect(daysWords(3)).toBe('used 3 days ago')
    expect(restedWords(null)).toBe('never used — fully rested')
    expect(restedWords(1)).toBe('used yesterday')
    expect(restedWords(6)).toBe('6 days rested')
  })

  it('lastShot reports the most recent injection on that route', () => {
    const logs = [log('abd-ul', '2026-02-01'), log('thr-lo', '2026-02-09')]
    const l = lastShot(logs, today, 'SubQ')
    expect(l.siteId).toBe('thr-lo')
    expect(l.when).toBe('yesterday')
    expect(l.label).toBe(SITE_BY_ID['thr-lo'].short)
  })

  it('lastShot says "today" for a shot logged today, and null with no history', () => {
    expect(lastShot([log('abd-ul', today)], today, 'SubQ').when).toBe('today')
    expect(lastShot([], today, 'SubQ')).toBeNull()
  })

  it('lastShot does not mix the two route maps', () => {
    const logs = [log('abd-ul', '2026-02-05'), log('im-glute-l', '2026-02-09')]
    expect(lastShot(logs, today, 'SubQ').siteId).toBe('abd-ul')
    expect(lastShot(logs, today, 'IM').siteId).toBe('im-glute-l')
  })

  it('the suggestion explains itself', () => {
    expect(suggestionReason('abd-ul', [], today)).toMatch(/never used this one/)
    expect(suggestionReason('abd-ul', [log('abd-ul', '2026-02-03')], today)).toMatch(/7 days rested/)
  })

  it('the suggestion still avoids the last-used spot and its neighbours', () => {
    const logs = [log('abd-ul', today)]
    const s = suggestSite(logs, today, 'SubQ')
    expect(s).not.toBe('abd-ul')
    expect(SITE_BY_ID['abd-ul'].neighbors).not.toContain(s)
  })
})

describe('glossary', () => {
  it('explains the jargon this app uses, in one plain sentence each', () => {
    for (const key of ['subq', 'im', 'codraw', 'titration', 'units']) {
      const e = glossaryFor(key)
      expect(e, key).toBeTruthy()
      expect(e.term, key).toBeTruthy()
      expect(e.plain.length, key).toBeGreaterThan(30)
    }
    expect(glossaryFor('nope')).toBeNull()
  })

  it('never leaves an entry without a term or explanation', () => {
    for (const [k, v] of Object.entries(GLOSSARY)) {
      expect(v.term, k).toBeTruthy()
      expect(v.plain, k).toBeTruthy()
    }
  })
})
