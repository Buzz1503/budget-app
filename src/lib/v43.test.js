/**
 * Log on body, and knowing which compound went where.
 *
 * The warnings and the suggestion are the whole point of this feature, so they
 * are tested as pure functions against fixed clocks rather than through a
 * screen: "was this warning shown" is a question about a rule, and a rule that
 * is only observable by rendering it is a rule nobody can check.
 */
import { describe, it, expect } from 'vitest'
import {
  autoCode, assignCodes, assignColours, withIdentity, SITE_COLOURS, colourHex,
} from './peptideIdentity'
import {
  recentUses, usesByPin, warningsFor, suggestSite, summaryLine, pinBarLines,
  visibleChips, overlaps, pinBadge, neighboursOf, pinDistancePct,
  NEIGHBOUR_PCT, NEIGHBOUR_HOURS, DEFAULT_WINDOW_DAYS,
} from './siteRotation'
import { peptideScorecards, byGroup, countable, groupScorecards } from './reactionTracker'
import { PIN_BY_ID, NAVEL_CLEARANCE_PCT } from './sitePins'

const NOW = '2026-03-10T20:00:00.000Z'
const hoursBefore = (h) => new Date(new Date(NOW).getTime() - h * 3600000).toISOString()

const rec = (id, peptideId, pinId, hoursAgo, extra = {}) => ({
  id,
  peptideId,
  pinId,
  siteGroup: pinId ? PIN_BY_ID[pinId]?.group ?? null : null,
  side: pinId ? PIN_BY_ID[pinId]?.side ?? null : null,
  timestamp: hoursBefore(hoursAgo),
  mixed: false,
  ...extra,
})
const rated = (id, severity, goneAt = null) => ({
  injectionRecordId: id,
  ratings: [{ date: '2026-03-09', severity }],
  worstSeverity: severity,
  goneAt,
  photoIds: [],
})

const NAMES = { motsc: 'MOTS-c', ghkcu: 'GHK-Cu', reta: 'Retatrutide' }
const nameOf = (id) => NAMES[id] || id

// ------------------------------------------------------------- identity

describe('codes and colours', () => {
  it('takes the leading run of letters, not the punctuation', () => {
    expect(autoCode('GHK-Cu')).toBe('GHK')
    expect(autoCode('MOTS-c')).toBe('MOT')
    expect(autoCode('Retatrutide')).toBe('RET')
  })

  it('handles a name too short for three letters', () => {
    expect(autoCode('BP')).toBe('BP')
    expect(autoCode('')).toBe('?')
  })

  it('keeps codes unique when two names collide', () => {
    const codes = assignCodes([
      { id: 'a', name: 'Glycine' },
      { id: 'b', name: 'Glutathione' },
      { id: 'c', name: 'Glutamine' },
    ])
    const values = Object.values(codes)
    expect(new Set(values).size).toBe(3)
    expect(codes.a).toBe('GLY')
  })

  it('never overwrites a code the user chose', () => {
    const codes = assignCodes([
      { id: 'a', name: 'Glycine', code: 'ZZ' },
      { id: 'b', name: 'Glycine' },
    ])
    expect(codes.a).toBe('ZZ')
    expect(codes.b).toBe('GLY')
  })

  it('deals distinct colours until the palette runs out', () => {
    const many = Array.from({ length: SITE_COLOURS.length }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))
    const colours = Object.values(assignColours(many))
    expect(new Set(colours).size).toBe(SITE_COLOURS.length)
  })

  it('adds identity without disturbing anything else', () => {
    const [p] = withIdentity([{ id: 'motsc', name: 'MOTS-c', ladder: { unit: 'mcg' } }])
    expect(p.code).toBe('MOT')
    expect(p.colour).toBeTruthy()
    expect(p.ladder.unit).toBe('mcg')
    expect(colourHex(p)).toMatch(/^#/)
  })
})

// --------------------------------------------------------------- window

describe('the recent window', () => {
  const records = [
    rec('a', 'ghkcu', 'abd-l-mid-inner', 20),
    rec('b', 'motsc', 'thigh-l-front-mid', 60),
    rec('c', 'reta', 'flank-l', 200),
    rec('d', 'motsc', null, 10), // quick-logged, no site
  ]

  it('keeps only sited injections inside the window, newest first', () => {
    const uses = recentUses({ records, reactions: [], nowIso: NOW, windowDays: 3 })
    expect(uses.map((u) => u.record.id)).toEqual(['a', 'b'])
  })

  it('a wider window reaches further back', () => {
    const uses = recentUses({ records, reactions: [], nowIso: NOW, windowDays: 9 })
    expect(uses.map((u) => u.record.id)).toEqual(['a', 'b', 'c'])
  })

  it('groups by pin', () => {
    const uses = recentUses({ records, reactions: [], nowIso: NOW, windowDays: 3 })
    expect(Object.keys(usesByPin(uses)).sort()).toEqual(['abd-l-mid-inner', 'thigh-l-front-mid'])
  })
})

// ------------------------------------------------------------- warnings

describe('the four warnings', () => {
  const base = { nowIso: NOW, windowDays: DEFAULT_WINDOW_DAYS, nameOf }

  it('warns when a different peptide used this pin in the window', () => {
    const records = [rec('a', 'ghkcu', 'abd-l-mid-inner', 20)]
    const w = warningsFor('abd-l-mid-inner', 'motsc', { ...base, records, reactions: [] })
    expect(w.some((x) => x.kind === 'other-peptide')).toBe(true)
    expect(w.find((x) => x.kind === 'other-peptide').text).toMatch(/GHK-Cu went here yesterday/)
  })

  it('warns when the same peptide used this pin in the window', () => {
    const records = [rec('a', 'motsc', 'abd-l-mid-inner', 48)]
    const w = warningsFor('abd-l-mid-inner', 'motsc', { ...base, records, reactions: [], windowDays: 3 })
    expect(w.some((x) => x.kind === 'same-peptide')).toBe(true)
    expect(w.find((x) => x.kind === 'same-peptide').text).toMatch(/MOTS-c went here 2 days ago/)
  })

  it('warns about a still-reacting pin, and says the severity', () => {
    const records = [rec('a', 'ghkcu', 'abd-l-mid-inner', 20)]
    const w = warningsFor('abd-l-mid-inner', 'motsc', {
      ...base, records, reactions: [rated('a', 'moderate')],
    })
    const r = w.find((x) => x.kind === 'reacting')
    expect(r).toBeTruthy()
    expect(r.text).toMatch(/Still reacting from GHK-Cu \(Moderate\)/)
    expect(w[0].kind).toBe('reacting') // worst first
  })

  /*
   * The neighbour rule, proved against pins that are actually close.
   *
   * No two pins in the shipped table are within 3 cm of each other — the 44 px
   * minimum spacing puts the closest pair 6.18 cm apart — so the rule cannot
   * fire on the defaults. It is still tested, because a user can move a pin and
   * because the threshold is a number somebody may want to change. An override
   * is what puts two pins close enough here.
   */
  const CLOSE = { 'abd-l-upper-inner': { x: 31.1, y: 39.9 } }

  it('warns about a different peptide next door within 48 hours', () => {
    const near = neighboursOf('abd-l-mid-inner', { overrides: CLOSE })
    expect(near.map((p) => p.id)).toContain('abd-l-upper-inner')
    const records = [rec('a', 'ghkcu', 'abd-l-upper-inner', 20)]
    const w = warningsFor('abd-l-mid-inner', 'motsc', { ...base, records, reactions: [], overrides: CLOSE })
    expect(w.some((x) => x.kind === 'neighbour')).toBe(true)
    expect(w.find((x) => x.kind === 'neighbour').text).toMatch(/hard to tell apart/)
  })

  it('does not raise the neighbour warning past 48 hours', () => {
    const records = [rec('a', 'ghkcu', 'abd-l-upper-inner', NEIGHBOUR_HOURS + 6)]
    const w = warningsFor('abd-l-mid-inner', 'motsc', {
      ...base, records, reactions: [], windowDays: 7, overrides: CLOSE,
    })
    expect(w.some((x) => x.kind === 'neighbour')).toBe(false)
  })

  it('does not raise the neighbour warning for the same peptide', () => {
    const records = [rec('a', 'motsc', 'abd-l-upper-inner', 20)]
    const w = warningsFor('abd-l-mid-inner', 'motsc', { ...base, records, reactions: [], overrides: CLOSE })
    expect(w.some((x) => x.kind === 'neighbour')).toBe(false)
  })

  it('says nothing about a clean site', () => {
    expect(warningsFor('glute-r-outer-mid', 'motsc', { ...base, records: [], reactions: [] })).toEqual([])
  })
})

describe('the 3 cm neighbour radius', () => {
  it('is three fifths of the 5 cm navel clearance', () => {
    expect(NEIGHBOUR_PCT).toBeCloseTo((NAVEL_CLEARANCE_PCT / 5) * 3, 6)
  })

  it('never reaches across views', () => {
    expect(pinDistancePct(PIN_BY_ID['abd-l-mid-inner'], PIN_BY_ID['glute-l-outer-mid'])).toBe(Infinity)
    expect(neighboursOf('abd-l-mid-inner').every((p) => p.view === 'front')).toBe(true)
  })

  /*
   * Recorded rather than asserted away: the 44 px minimum spacing and the 3 cm
   * neighbour radius are in tension, and the spacing rule wins. Anyone raising
   * the radius above 6.18 cm brings the rule to life; until then it is inert on
   * the default table, and this test is where that fact lives.
   */
  it('cannot fire on the shipped pin table, because nothing is that close', () => {
    let min = Infinity
    const pins = Object.values(PIN_BY_ID)
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        min = Math.min(min, pinDistancePct(pins[i], pins[j]))
      }
    }
    expect(min).toBeGreaterThan(NEIGHBOUR_PCT)
    const cm = min * (5 / NAVEL_CLEARANCE_PCT)
    expect(cm).toBeGreaterThan(6)
  })

  it('only includes pins actually within the radius', () => {
    for (const n of neighboursOf('abd-l-mid-inner')) {
      expect(pinDistancePct(PIN_BY_ID['abd-l-mid-inner'], PIN_BY_ID[n.id])).toBeLessThanOrEqual(NEIGHBOUR_PCT)
    }
  })
})

// ----------------------------------------------------------- suggestion

describe('the suggestion', () => {
  const base = { nowIso: NOW, windowDays: 3, nameOf }

  it('prefers a site never used at all', () => {
    const s = suggestSite('motsc', { ...base, records: [], reactions: [] })
    expect(s.breaks).toBe(null)
    expect(s.reason).toMatch(/Never used/)
  })

  it('avoids pins used inside the window', () => {
    const records = [rec('a', 'ghkcu', 'abd-l-mid-inner', 4)]
    const s = suggestSite('motsc', { ...base, records, reactions: [] })
    expect(s.pinId).not.toBe('abd-l-mid-inner')
  })

  it('avoids a reacting pin', () => {
    const records = [rec('a', 'ghkcu', 'abd-l-mid-inner', 4)]
    const s = suggestSite('motsc', { ...base, records, reactions: [rated('a', 'severe')] })
    expect(s.pinId).not.toBe('abd-l-mid-inner')
    expect(s.breaks).toBe(null)
  })

  it('picks the least recently used once every site has been used', () => {
    // every pin used, the oldest of them a long time ago and outside the window
    const all = Object.keys(PIN_BY_ID)
    const records = all.map((id, i) => rec(`r${i}`, 'motsc', id, 100 + i * 10))
    const s = suggestSite('motsc', { ...base, records, reactions: [] })
    expect(s.breaks).toBe(null)
    expect(s.pinId).toBe(all[all.length - 1]) // the one used longest ago
  })

  it('falls back to the best available and says which rule it breaks', () => {
    const all = Object.keys(PIN_BY_ID)
    // everything used within the window, so nothing can qualify
    const records = all.map((id, i) => rec(`r${i}`, 'motsc', id, 1 + i * 0.01))
    const s = suggestSite('motsc', { ...base, records, reactions: [] })
    expect(s).toBeTruthy()
    expect(s.breaks).toBe('in-window')
    expect(s.reason).toMatch(/Every site has been used recently/)
  })

  it('says so when everything is reacting', () => {
    const all = Object.keys(PIN_BY_ID)
    const records = all.map((id, i) => rec(`r${i}`, 'motsc', id, 1 + i * 0.01))
    const reactions = records.map((r) => rated(r.id, 'moderate'))
    const s = suggestSite('motsc', { ...base, records, reactions })
    expect(s.breaks).toBe('reacting')
    expect(s.reason).toMatch(/Every site is reacting/)
  })

  it('can be held to one site group', () => {
    const s = suggestSite('motsc', { ...base, records: [], reactions: [], group: 'glute' })
    expect(PIN_BY_ID[s.pinId].group).toBe('glute')
  })
})

describe('the summary line', () => {
  it('names the last shot and the suggestion', () => {
    const records = [rec('a', 'ghkcu', 'abd-l-mid-inner', 20)]
    const line = summaryLine('motsc', { records, reactions: [], nowIso: NOW, windowDays: 3, nameOf })
    expect(line).toMatch(/Yesterday: GHK-Cu, Left abdomen, mid inner\./)
    expect(line).toMatch(/Suggested for MOTS-c:/)
  })

  it('is just the suggestion when nothing is recent', () => {
    const line = summaryLine('motsc', { records: [], reactions: [], nowIso: NOW, windowDays: 3, nameOf })
    expect(line).toMatch(/^Suggested for MOTS-c:/)
  })
})

describe('the selected pin bar', () => {
  const ctx = (records, reactions = []) => ({ records, reactions, nowIso: NOW, windowDays: 3, nameOf })

  it('says when a pin has not been used', () => {
    expect(pinBarLines('flank-r', ctx([]))).toEqual(['Not used in the last 3 days.'])
  })

  it('lists every use in the window', () => {
    const records = [
      rec('a', 'ghkcu', 'abd-l-mid-inner', 20),
      rec('b', 'motsc', 'abd-l-mid-inner', 50),
    ]
    const lines = pinBarLines('abd-l-mid-inner', ctx(records, [rated('a', 'none'), rated('b', 'mild')]))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/GHK-Cu, yesterday\. No reaction\./)
    expect(lines[1]).toMatch(/MOTS-c, 2 days ago\. Mild, still there\./)
  })

  it('calls an unrated use not checked', () => {
    const records = [rec('a', 'ghkcu', 'abd-l-mid-inner', 20)]
    expect(pinBarLines('abd-l-mid-inner', ctx(records))[0]).toMatch(/Not checked\./)
  })
})

// ------------------------------------------------------------ the chips

describe('chip collisions', () => {
  const box = (x, y, w = 30, h = 12) => ({ x, y, w, h })

  it('detects overlap and separation', () => {
    expect(overlaps(box(0, 0), box(10, 5))).toBe(true)
    expect(overlaps(box(0, 0), box(40, 0))).toBe(false)
    expect(overlaps(box(0, 0), box(0, 12))).toBe(false) // touching, not overlapping
  })

  it('hides the chip of two adjacent used pins', () => {
    const chips = [
      { pinId: 'a', box: box(0, 0) },
      { pinId: 'b', box: box(12, 0) },
    ]
    expect(visibleChips(chips, [])).toEqual(['a'])
  })

  it('keeps both when they are far enough apart', () => {
    const chips = [
      { pinId: 'a', box: box(0, 0) },
      { pinId: 'b', box: box(60, 0) },
    ]
    expect(visibleChips(chips, [])).toEqual(['a', 'b'])
  })

  it('hides a chip that would sit on another pin', () => {
    const chips = [{ pinId: 'a', box: box(0, 0) }]
    const pins = [{ id: 'b', box: box(10, 2, 18, 18) }]
    expect(visibleChips(chips, pins)).toEqual([])
  })

  it('ignores the chip sitting under its own pin', () => {
    const chips = [{ pinId: 'a', box: box(0, 0) }]
    const pins = [{ id: 'a', box: box(0, 0, 18, 18) }]
    expect(visibleChips(chips, pins)).toEqual(['a'])
  })
})

describe('the pin badge', () => {
  const codeOf = (id) => ({ motsc: 'MOT', ghkcu: 'GHK' }[id] || '?')

  it('shows the most recent peptide alone', () => {
    const uses = recentUses({ records: [rec('a', 'motsc', 'flank-l', 5)], reactions: [], nowIso: NOW, windowDays: 3 })
    expect(pinBadge('flank-l', uses, codeOf)).toMatchObject({ label: 'MOT', extra: 0 })
  })

  it('counts a second peptide as +1', () => {
    const records = [rec('a', 'motsc', 'flank-l', 5), rec('b', 'ghkcu', 'flank-l', 30)]
    const uses = recentUses({ records, reactions: [], nowIso: NOW, windowDays: 3 })
    expect(pinBadge('flank-l', uses, codeOf)).toMatchObject({ label: 'MOT', extra: 1 })
  })

  it('shows both codes for a mixed injection', () => {
    const at = hoursBefore(5)
    const records = [
      { ...rec('a', 'motsc', 'flank-l', 5), mixed: true, timestamp: at },
      { ...rec('b', 'ghkcu', 'flank-l', 5), mixed: true, timestamp: at },
    ]
    const uses = recentUses({ records, reactions: [], nowIso: NOW, windowDays: 3 })
    const badge = pinBadge('flank-l', uses, codeOf)
    expect(badge.mixed).toBe(true)
    expect(badge.label.split('/').sort()).toEqual(['GHK', 'MOT'])
  })

  it('is nothing for an unused pin', () => {
    expect(pinBadge('flank-r', [], codeOf)).toBe(null)
  })
})

// ------------------------------------------------ unsited doses and stats

describe('doses with no site', () => {
  const records = [
    rec('s1', 'motsc', 'abd-l-mid-inner', 100),
    rec('s2', 'motsc', 'abd-l-upper-inner', 120),
    rec('u1', 'motsc', null, 140),
    rec('u2', 'motsc', null, 160),
  ]
  const reactions = [
    rated('s1', 'mild'), rated('s2', 'none'), rated('u1', 'moderate'), rated('u2', 'none'),
  ]

  it('counts towards the peptide, all four of them', () => {
    const card = peptideScorecards({ records, reactions }).find((c) => c.peptideId === 'motsc')
    expect(card.n).toBe(4)
    expect(card.reacted).toBe(2)
    expect(card.enough).toBe(true)
  })

  it('is left out of every site group', () => {
    const groups = byGroup(countable({ records, reactions }))
    const total = groups.reduce((sum, g) => sum + g.n, 0)
    expect(total).toBe(2)
    expect(groups.find((g) => g.group === 'abdomen').n).toBe(2)
  })

  it('is left out of the site-group scorecards too', () => {
    const groups = groupScorecards({ records, reactions })
    expect(groups.reduce((sum, g) => sum + g.n, 0)).toBe(2)
  })

  it('never appears on the map', () => {
    const uses = recentUses({ records, reactions, nowIso: NOW, windowDays: 30 })
    expect(uses.every((u) => u.pinId)).toBe(true)
    expect(uses).toHaveLength(2)
  })
})
