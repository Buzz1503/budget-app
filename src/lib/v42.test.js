// v42 — the photo site map and the simplified reaction tracker.
//
// The pin tests are geometry with consequences: a pin 30 px from its neighbour
// cannot be tapped reliably, a pin labelled "Left" on the wrong side of the
// midline silently reverses every finding about which side reacts, and a pin
// within 5 cm of the navel is not a subcutaneous site. All of it is checked
// here and again by npm run pin-qa, which reads these same functions.
//
// The tracker tests are mostly about refusing to count what cannot be counted:
// a shared site belongs to neither peptide, an unrated injection is not a
// clean one, and four is the fewest injections that will be turned into a rate.
import { describe, it, expect } from 'vitest'
import {
  PINS, PIN_BY_ID, WINDOWS, MIDLINE, NAVEL, NAVEL_CLEARANCE_PCT, GROUP_IDS,
  COMPOSITE_ASPECT, SCREEN_WIDTH, MIN_SPACING_PX, EDGE_MARGIN_PX,
  pxPerXPct, pxPerYPct, toScreen, windowHeightPx, spacingPx, navelDistancePct,
  edgeMarginPx, sideAt, pinsWith, pinsFor, nearestPin, validatePosition, checkPins,
} from './sitePins'
import {
  SEVERITIES, SEVERITY_BY_ID, severityRank, worstOf, reacted, rated,
  durationDays, durationWords, stillReacting, findMixedGroup, recentOtherUse,
  pinStatus, suggestedPin, newSites, openSites, checkDue, severeStreak,
  countable, peptideScorecards, groupScorecards, peptideDetail, pinHistory,
  topLine, activeSafety, SAFETY_FLAGS, migrateReactionLab, pinForZone,
  severityFromCheckin, MIN_FOR_NUMBERS, DEFAULT_CHECK_TIME,
} from './reactionTracker'
import { looksHeic, swapsAxes, localDateStr, localTimeStr, MAX_EDGE, QUALITY } from './photoImport'

// =========================================================== the site map

describe('the pin table', () => {
  it('has thirty pins with unique ids', () => {
    expect(PINS).toHaveLength(30)
    expect(new Set(PINS.map((p) => p.id)).size).toBe(30)
  })

  it('splits them the way the brief does', () => {
    const count = (g) => PINS.filter((p) => p.group === g).length
    expect(count('abdomen')).toBe(12)
    expect(count('thigh')).toBe(10)
    expect(count('flank')).toBe(2)
    expect(count('glute')).toBe(6)
  })

  it('puts every pin in a known group with a label and a view', () => {
    for (const p of PINS) {
      expect(GROUP_IDS).toContain(p.group)
      expect(p.label.length).toBeGreaterThan(3)
      expect(['front', 'back']).toContain(p.view)
      expect(['l', 'r']).toContain(p.side)
    }
  })

  it('keeps every pin inside the half of the composite its view shows', () => {
    for (const p of PINS) {
      const w = WINDOWS[p.view]
      expect(p.x).toBeGreaterThanOrEqual(w.x0)
      expect(p.x).toBeLessThanOrEqual(w.x1)
      expect(p.y).toBeGreaterThanOrEqual(w.y0)
      expect(p.y).toBeLessThanOrEqual(w.y1)
    }
  })
})

describe('the side convention', () => {
  it('reads the front view mirrored and the back view straight', () => {
    // front: the person's right hand is on the viewer's left
    expect(sideAt('front', MIDLINE.front - 5)).toBe('r')
    expect(sideAt('front', MIDLINE.front + 5)).toBe('l')
    // back: the person's left is on the viewer's left
    expect(sideAt('back', MIDLINE.back - 5)).toBe('l')
    expect(sideAt('back', MIDLINE.back + 5)).toBe('r')
  })

  it('stores the anatomical side, not the viewer’s, for every pin', () => {
    for (const p of PINS) {
      expect(p.side).toBe(sideAt(p.view, p.x))
    }
  })

  it('makes the leftmost pin in each view read the way the brief states', () => {
    const leftmost = (view) => PINS.filter((p) => p.view === view).sort((a, b) => a.x - b.x)[0]
    expect(leftmost('front').side).toBe('r')
    expect(leftmost('front').label.startsWith('Right')).toBe(true)
    expect(leftmost('back').side).toBe('l')
    expect(leftmost('back').label.startsWith('Left')).toBe(true)
  })

  it('never lets a label disagree with the stored side', () => {
    for (const p of PINS) {
      const word = p.side === 'l' ? 'Left' : 'Right'
      expect(p.label.startsWith(word)).toBe(true)
    }
  })
})

describe('the geometry', () => {
  it('scales each window to the full viewport width', () => {
    for (const view of ['front', 'back']) {
      const w = WINDOWS[view]
      expect(pxPerXPct(view) * (w.x1 - w.x0)).toBeCloseTo(SCREEN_WIDTH, 5)
    }
  })

  it('carries the aspect ratio into the vertical, and only there', () => {
    expect(pxPerYPct('front')).toBeCloseTo(pxPerXPct('front') * COMPOSITE_ASPECT, 8)
    // a square window on a tall image is taller than it is wide on screen
    expect(windowHeightPx('front')).toBeGreaterThan(0)
    expect(windowHeightPx('back')).toBeGreaterThan(0)
  })

  it('puts the top-left of a window at the origin', () => {
    const w = WINDOWS.front
    const corner = { ...PINS[0], x: w.x0, y: w.y0 }
    expect(toScreen(corner)).toEqual({ x: 0, y: 0 })
  })

  it('reports two pins in different views as infinitely far apart', () => {
    const front = PINS.find((p) => p.view === 'front')
    const back = PINS.find((p) => p.view === 'back')
    expect(spacingPx(front, back)).toBe(Infinity)
  })

  it('measures the navel radially, in shares of the width', () => {
    const at = (x, y) => navelDistancePct({ x, y })
    expect(at(NAVEL.x, NAVEL.y)).toBe(0)
    expect(at(NAVEL.x + 5, NAVEL.y)).toBeCloseTo(5, 6)
    // a vertical percent is worth more than a horizontal one on a tall image
    expect(at(NAVEL.x, NAVEL.y + 5)).toBeCloseTo(5 * COMPOSITE_ASPECT, 6)
  })
})

describe('the five checks the build depends on', () => {
  const result = checkPins()

  it('passes every one on the shipped table', () => {
    expect(result.failures).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('keeps every pair at least 44 px apart', () => {
    expect(result.minSpacingPx).toBeGreaterThanOrEqual(MIN_SPACING_PX)
  })

  it('keeps every pin clear of its window edge', () => {
    for (const p of PINS) expect(edgeMarginPx(p)).toBeGreaterThanOrEqual(EDGE_MARGIN_PX)
  })

  it('keeps every abdomen pin 5 cm clear of the navel', () => {
    for (const p of PINS.filter((x) => x.group === 'abdomen')) {
      expect(navelDistancePct(p)).toBeGreaterThanOrEqual(NAVEL_CLEARANCE_PCT)
    }
  })

  it('catches a pin moved too close to its neighbour', () => {
    const near = PINS.map((p) => (p.id === 'abd-r-upper-outer' ? { ...p, x: 21.5 } : p))
    const bad = checkPins(near)
    expect(bad.ok).toBe(false)
    expect(bad.failures.some((f) => f.check === 'spacing')).toBe(true)
  })

  it('catches a pin whose label and position disagree about the side', () => {
    const wrong = PINS.map((p) => (p.id === 'abd-r-upper-outer' ? { ...p, side: 'l' } : p))
    const bad = checkPins(wrong)
    expect(bad.failures.some((f) => f.check === 'side')).toBe(true)
  })

  it('catches a pin pushed into the navel', () => {
    const wrong = PINS.map((p) => (p.id === 'abd-r-navel-inner' ? { ...p, x: NAVEL.x - 1, y: NAVEL.y } : p))
    expect(checkPins(wrong).failures.some((f) => f.check === 'navel')).toBe(true)
  })

  it('catches a pin pushed off the edge of its window', () => {
    const wrong = PINS.map((p) => (p.id === 'flank-l' ? { ...p, x: WINDOWS.back.x0 + 0.1 } : p))
    expect(checkPins(wrong).failures.some((f) => f.check === 'edge')).toBe(true)
  })

  it('catches a duplicated id', () => {
    const wrong = [...PINS, { ...PINS[0] }]
    expect(checkPins(wrong).failures.some((f) => f.check === 'unique')).toBe(true)
  })
})

describe('tapping', () => {
  it('always resolves a tap to exactly one pin', () => {
    // a grid of taps across the whole window, every one landing on something
    const w = WINDOWS.front
    for (let i = 0; i <= 10; i++) {
      for (let j = 0; j <= 10; j++) {
        const hit = nearestPin('front', {
          x: (i / 10) * SCREEN_WIDTH,
          y: (j / 10) * windowHeightPx('front'),
        })
        expect(hit).toBeTruthy()
        expect(PIN_BY_ID[hit.pin.id]).toBeTruthy()
      }
    }
  })

  it('picks the pin whose centre is nearest, never a neighbour', () => {
    const p = PIN_BY_ID['abd-r-mid-inner']
    const s = toScreen(p)
    const hit = nearestPin('front', { x: s.x + 3, y: s.y - 3 })
    expect(hit.pin.id).toBe('abd-r-mid-inner')
    expect(hit.distancePx).toBeLessThan(MIN_SPACING_PX / 2)
  })

  it('only offers pins from the view being shown', () => {
    const hit = nearestPin('back', { x: 10, y: 10 })
    expect(PIN_BY_ID[hit.pin.id].view).toBe('back')
  })

  it('confines a tap to the filtered groups without moving anything', () => {
    const abdomen = toScreen(PIN_BY_ID['abd-r-mid-inner'])
    const hit = nearestPin('front', abdomen, { groups: ['thigh'] })
    expect(hit.pin.group).toBe('thigh')
    // and the unfiltered answer is unchanged, so filtering dims rather than moves
    expect(nearestPin('front', abdomen).pin.id).toBe('abd-r-mid-inner')
  })
})

describe('adjusting a pin', () => {
  it('moves it without changing what it is', () => {
    const moved = pinsWith({ 'abd-r-mid-inner': { x: 22.4, y: 39.4 } })
    const p = moved.find((x) => x.id === 'abd-r-mid-inner')
    expect(p.x).toBe(22.4)
    expect(p.group).toBe('abdomen')
    expect(p.side).toBe('r')
    expect(p.label).toBe(PIN_BY_ID['abd-r-mid-inner'].label)
    expect(p.moved).toBe(true)
  })

  it('leaves the defaults alone when an override is incomplete', () => {
    const moved = pinsWith({ 'abd-r-mid-inner': { x: 22.4 } })
    expect(moved.find((x) => x.id === 'abd-r-mid-inner').x).toBe(PIN_BY_ID['abd-r-mid-inner'].x)
  })

  it('accepts a small nudge', () => {
    // sideways only: the rows are 3.7–3.8% apart, which is barely over 44 px, so
    // any vertical nudge at all closes on the row above or below
    expect(validatePosition('abd-r-mid-inner', { x: 21.2, y: 38.9 }).ok).toBe(true)
  })

  it('refuses a position on top of another pin, and says which', () => {
    const v = validatePosition('abd-r-mid-inner', { x: 17.0, y: 38.9 })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/Too close to Right abdomen, mid outer/)
  })

  it('refuses a position inside the navel', () => {
    const v = validatePosition('abd-r-navel-inner', { x: NAVEL.x - 1, y: NAVEL.y })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/navel/i)
  })

  it('refuses a position outside the window', () => {
    expect(validatePosition('flank-l', { x: 50, y: 41 }).ok).toBe(false)
    expect(validatePosition('flank-l', { x: 54.2, y: 41 }).reason).toMatch(/edge/i)
  })

  it('lets a pin sit where another pin used to be once that one has moved', () => {
    const overrides = { 'abd-r-mid-outer': { x: 12.0, y: 38.9 } }
    const home = PIN_BY_ID['abd-r-mid-outer']
    expect(validatePosition('abd-r-mid-inner', { x: home.x, y: home.y }, { overrides }).ok).toBe(true)
  })

  it('only applies the navel rule to the abdomen', () => {
    // a thigh pin near the navel's coordinates is nonsense but not this rule's job
    expect(validatePosition('thigh-r-front-upper', { x: 18.7, y: 56.8 }).ok).toBe(true)
  })

  it('filters by view', () => {
    expect(pinsFor('front').every((p) => p.view === 'front')).toBe(true)
    expect(pinsFor('back')).toHaveLength(8)
  })
})

// ====================================================== the reaction tracker

const T = '2026-09-30'
const at = (d, h = 20) => `${d}T${String(h).padStart(2, '0')}:00:00.000Z`
const rec = (o = {}) => ({
  id: `ir-${Math.random()}`, doseLogId: null, peptideId: 'motsc', pinId: 'abd-r-mid-inner',
  siteGroup: 'abdomen', side: 'r', timestamp: at(T, 8), mixed: false, ...o,
})
const rx = (o = {}) => ({ injectionRecordId: 'ir-1', ratings: [], worstSeverity: null, goneAt: null, photoIds: [], ...o })

describe('severity', () => {
  it('has the four words the brief names, with definitions', () => {
    expect(SEVERITIES.map((s) => s.label)).toEqual(['None', 'Mild', 'Moderate', 'Severe'])
    for (const s of SEVERITIES) expect(s.words.length).toBeGreaterThan(8)
    expect(SEVERITY_BY_ID.severe.words).toMatch(/20c coin/)
  })

  it('ranks them in order', () => {
    expect(severityRank('none')).toBeLessThan(severityRank('mild'))
    expect(severityRank('mild')).toBeLessThan(severityRank('moderate'))
    expect(severityRank('moderate')).toBeLessThan(severityRank('severe'))
  })

  it('keeps the worst rating, not the latest', () => {
    const r = rx({ ratings: [
      { date: at(T, 20), severity: 'severe' },
      { date: at('2026-10-01', 20), severity: 'mild' },
    ] })
    expect(worstOf(r)).toBe('severe')
  })

  it('calls anything from Mild up a reaction', () => {
    expect(reacted(rx({ ratings: [{ date: at(T), severity: 'none' }] }))).toBe(false)
    expect(reacted(rx({ ratings: [{ date: at(T), severity: 'mild' }] }))).toBe(true)
  })

  it('knows the difference between "no reaction" and "not looked at"', () => {
    expect(rated(rx({ ratings: [{ date: at(T), severity: 'none' }] }))).toBe(true)
    expect(rated(rx())).toBe(false)
    expect(rated(undefined)).toBe(false)
  })
})

describe('duration', () => {
  it('counts days from the injection to the Gone tap', () => {
    const r = rec({ timestamp: at('2026-09-25', 8) })
    expect(durationDays(r, rx({ goneAt: at('2026-09-28', 20) }))).toBe(3)
  })

  it('calls the same day under a day, not zero days', () => {
    const r = rec({ timestamp: at(T, 8) })
    expect(durationDays(r, rx({ goneAt: at(T, 21) }))).toBe(0)
    expect(durationWords(0)).toBe('Under 1 day')
    expect(durationWords(1)).toBe('1 day')
    expect(durationWords(4)).toBe('4 days')
  })

  it('has no duration until it has gone', () => {
    expect(durationDays(rec(), rx())).toBe(null)
    expect(durationWords(null)).toBe(null)
  })

  it('uses the day it was actually tapped, not the evening it was due', () => {
    // a check done two days late still describes the day it was done
    const r = rec({ timestamp: at('2026-09-25', 8) })
    expect(durationDays(r, rx({ goneAt: at('2026-09-30', 2) }))).toBe(5)
  })
})

describe('one peptide per site', () => {
  it('spots two peptides put in the same pin at the same time', () => {
    const existing = [rec({ id: 'a', peptideId: 'ghkcu', pinId: 'abd-r-mid-inner', timestamp: at(T, 8) })]
    const hits = findMixedGroup(existing, { pinId: 'abd-r-mid-inner', timestamp: at(T, 8), peptideId: 'motsc' })
    expect(hits).toHaveLength(1)
  })

  it('does not call the same peptide twice a mix', () => {
    const existing = [rec({ id: 'a', peptideId: 'motsc', timestamp: at(T, 8) })]
    expect(findMixedGroup(existing, { pinId: 'abd-r-mid-inner', timestamp: at(T, 8), peptideId: 'motsc' })).toEqual([])
  })

  it('does not call two shots hours apart a mix', () => {
    const existing = [rec({ id: 'a', peptideId: 'ghkcu', timestamp: at(T, 8) })]
    expect(findMixedGroup(existing, { pinId: 'abd-r-mid-inner', timestamp: at(T, 18), peptideId: 'motsc' })).toEqual([])
  })

  it('warns when something else was here in the last three days', () => {
    const existing = [rec({ id: 'a', peptideId: 'ghkcu', timestamp: at('2026-09-29', 8) })]
    const prev = recentOtherUse(existing, { pinId: 'abd-r-mid-inner', peptideId: 'motsc', nowIso: at(T, 8) })
    expect(prev?.peptideId).toBe('ghkcu')
  })

  it('stops warning once the window has passed', () => {
    const existing = [rec({ id: 'a', peptideId: 'ghkcu', timestamp: at('2026-09-20', 8) })]
    expect(recentOtherUse(existing, { pinId: 'abd-r-mid-inner', peptideId: 'motsc', nowIso: at(T, 8) })).toBe(null)
  })
})

describe('what a pin looks like', () => {
  const nowIso = at(T, 21)

  it('starts unused', () => {
    expect(pinStatus('abd-r-mid-inner', { records: [], reactions: [], nowIso }).status).toBe('unused')
  })

  it('reads as recent for three days after a shot', () => {
    const records = [rec({ id: 'a', timestamp: at('2026-09-29', 8) })]
    expect(pinStatus('abd-r-mid-inner', { records, reactions: [], nowIso }).status).toBe('recent')
  })

  it('reads as clear once the three days are up', () => {
    const records = [rec({ id: 'a', timestamp: at('2026-09-20', 8) })]
    expect(pinStatus('abd-r-mid-inner', { records, reactions: [], nowIso }).status).toBe('clear')
  })

  it('reads as reacting while a mark is still there and still being checked, however long ago the shot was', () => {
    // v36: a reaction nobody has checked in a week is abandoned, not open
    const records = [rec({ id: 'a', timestamp: at('2026-08-01', 8) })]
    const reactions = [rx({ injectionRecordId: 'a', ratings: [{ date: at('2026-09-28'), severity: 'moderate' }] })]
    const st = pinStatus('abd-r-mid-inner', { records, reactions, nowIso })
    expect(st.status).toBe('reacting')
    expect(st.severity).toBe('moderate')
  })

  it('stops reacting once it has gone', () => {
    const records = [rec({ id: 'a', timestamp: at('2026-09-01', 8) })]
    const reactions = [rx({ injectionRecordId: 'a', ratings: [{ date: at('2026-09-02'), severity: 'severe' }], goneAt: at('2026-09-05') })]
    expect(pinStatus('abd-r-mid-inner', { records, reactions, nowIso }).status).toBe('clear')
  })

  it('suggests a site that is not reacting', () => {
    const records = PINS.map((p, i) => rec({ id: `p${i}`, pinId: p.id, timestamp: at('2026-09-01', 8) }))
    const reactions = [rx({ injectionRecordId: 'p0', ratings: [{ date: at('2026-09-02'), severity: 'severe' }] })]
    const pick = suggestedPin({ records, reactions, nowIso })
    expect(pick).not.toBe(PINS[0].id)
  })

  it('prefers a site never used', () => {
    const records = [rec({ id: 'a', pinId: 'abd-r-mid-inner', timestamp: at('2026-09-01', 8) })]
    const pick = suggestedPin({ records, reactions: [], nowIso })
    expect(pick).not.toBe('abd-r-mid-inner')
    expect(PIN_BY_ID[pick]).toBeTruthy()
  })
})

describe('the evening check', () => {
  it('lists anything not yet rated as a new site', () => {
    const records = [rec({ id: 'a' }), rec({ id: 'b' })]
    const reactions = [rx({ injectionRecordId: 'a', ratings: [{ date: at(T), severity: 'none' }] })]
    expect(newSites({ records, reactions }).map((r) => r.id)).toEqual(['b'])
  })

  it('lists anything still marked as a still-reacting site', () => {
    const records = [rec({ id: 'a' }), rec({ id: 'b' })]
    const reactions = [
      rx({ injectionRecordId: 'a', ratings: [{ date: at(T), severity: 'mild' }] }),
      rx({ injectionRecordId: 'b', ratings: [{ date: at(T), severity: 'none' }] }),
    ]
    expect(openSites({ records, reactions, nowIso: at(T, 20) }).map((x) => x.record.id)).toEqual(['a'])
  })

  it('drops a site from the list once it is gone', () => {
    const records = [rec({ id: 'a' })]
    const reactions = [rx({ injectionRecordId: 'a', ratings: [{ date: at(T), severity: 'mild' }], goneAt: at(T) })]
    expect(openSites({ records, reactions })).toEqual([])
    expect(checkDue({ records, reactions })).toBe(false)
  })

  it('has nothing due when everything has been answered', () => {
    const records = [rec({ id: 'a' })]
    const reactions = [rx({ injectionRecordId: 'a', ratings: [{ date: at(T), severity: 'none' }] })]
    expect(checkDue({ records, reactions })).toBe(false)
  })

  it('defaults to eight in the evening', () => {
    expect(DEFAULT_CHECK_TIME).toBe('20:00')
  })

  it('prompts for the other-symptoms list after three severe evenings', () => {
    const r = rx({ ratings: [
      { date: at('2026-09-28'), severity: 'severe' },
      { date: at('2026-09-29'), severity: 'severe' },
      { date: at('2026-09-30'), severity: 'severe' },
    ] })
    expect(severeStreak(rec(), r)).toBe(true)
  })

  it('does not prompt on three ratings from the same evening', () => {
    const r = rx({ ratings: [
      { date: at(T, 20), severity: 'severe' },
      { date: at(T, 21), severity: 'severe' },
      { date: at(T, 22), severity: 'severe' },
    ] })
    expect(severeStreak(rec(), r)).toBe(false)
  })

  it('stops prompting once it has gone', () => {
    const r = rx({
      ratings: ['2026-09-28', '2026-09-29', '2026-09-30'].map((d) => ({ date: at(d), severity: 'severe' })),
      goneAt: at('2026-10-01'),
    })
    expect(severeStreak(rec(), r)).toBe(false)
  })
})

describe('the scorecards', () => {
  const mk = (i, sev, group = 'abdomen', peptideId = 'motsc', mixed = false) => ({
    record: rec({ id: `r${i}`, peptideId, siteGroup: group, mixed, timestamp: at('2026-09-20', 8) }),
    reaction: rx({ injectionRecordId: `r${i}`, ratings: sev ? [{ date: at('2026-09-21'), severity: sev }] : [] }),
  })
  const build = (rows) => ({ records: rows.map((r) => r.record), reactions: rows.map((r) => r.reaction) })

  it('counts only rated, non-mixed injections', () => {
    const ctx = build([mk(1, 'mild'), mk(2, null), mk(3, 'none', 'abdomen', 'motsc', true)])
    expect(countable(ctx)).toHaveLength(1)
  })

  it('works out a reaction rate', () => {
    const ctx = build([mk(1, 'mild'), mk(2, 'none'), mk(3, 'moderate'), mk(4, 'none')])
    const card = peptideScorecards(ctx)[0]
    expect(card.n).toBe(4)
    expect(card.reacted).toBe(2)
    expect(card.rate).toBe(0.5)
    expect(card.enough).toBe(true)
  })

  it('withholds the numbers until there are four', () => {
    const ctx = build([mk(1, 'mild'), mk(2, 'none'), mk(3, 'mild')])
    expect(MIN_FOR_NUMBERS).toBe(4)
    expect(peptideScorecards(ctx)[0].enough).toBe(false)
  })

  it('leaves a mixed injection out of the rate entirely', () => {
    const clean = build([mk(1, 'none'), mk(2, 'none'), mk(3, 'none'), mk(4, 'none')])
    const withMixed = build([...[1, 2, 3, 4].map((i) => mk(i, 'none')), mk(5, 'severe', 'abdomen', 'motsc', true)])
    expect(peptideScorecards(withMixed)[0].rate).toBe(peptideScorecards(clean)[0].rate)
    expect(peptideScorecards(withMixed)[0].n).toBe(4)
  })

  it('names the most common severity', () => {
    const ctx = build([mk(1, 'mild'), mk(2, 'mild'), mk(3, 'severe'), mk(4, 'none')])
    expect(peptideScorecards(ctx)[0].commonSeverity).toBe('mild')
  })

  it('averages the durations that exist', () => {
    const rows = [mk(1, 'mild'), mk(2, 'mild'), mk(3, 'none'), mk(4, 'none')]
    rows[0].reaction.goneAt = at('2026-09-22')
    rows[1].reaction.goneAt = at('2026-09-24')
    const card = peptideScorecards(build(rows))[0]
    expect(card.avgDurationDays).toBe(3)
  })

  it('sorts the peptides worst first', () => {
    const ctx = build([
      ...[1, 2, 3, 4].map((i) => mk(i, 'none', 'abdomen', 'quiet')),
      ...[5, 6, 7, 8].map((i) => mk(i, 'severe', 'abdomen', 'loud')),
    ])
    expect(peptideScorecards(ctx)[0].peptideId).toBe('loud')
  })

  it('splits one peptide by site group', () => {
    const ctx = build([
      ...[1, 2, 3, 4].map((i) => mk(i, 'severe', 'abdomen')),
      ...[5, 6, 7, 8].map((i) => mk(i, 'none', 'thigh')),
    ])
    const d = peptideDetail('motsc', ctx)
    const abdomen = d.groups.find((g) => g.group === 'abdomen')
    const thigh = d.groups.find((g) => g.group === 'thigh')
    expect(abdomen.rate).toBe(1)
    expect(thigh.rate).toBe(0)
    expect(d.injections).toHaveLength(8)
  })

  it('rates each site group across every peptide', () => {
    const ctx = build([
      ...[1, 2, 3, 4].map((i) => mk(i, 'mild', 'abdomen', 'a')),
      ...[5, 6, 7, 8].map((i) => mk(i, 'none', 'thigh', 'b')),
    ])
    const groups = groupScorecards(ctx)
    expect(groups.find((g) => g.group === 'abdomen').rate).toBe(1)
    expect(groups.find((g) => g.group === 'thigh').rate).toBe(0)
  })

  it('lists every injection at one pin', () => {
    const ctx = build([mk(1, 'mild'), mk(2, 'none')])
    expect(pinHistory('abd-r-mid-inner', ctx)).toHaveLength(2)
    expect(pinHistory('flank-l', ctx)).toHaveLength(0)
  })

  it('says something useful before there is anything to say', () => {
    expect(topLine({ records: [], reactions: [] })).toMatch(/Log a few injections/)
  })

  it('names the worst peptide and the worst group once it can', () => {
    const ctx = build([
      ...[1, 2, 3, 4].map((i) => mk(i, 'severe', 'abdomen', 'motsc')),
      ...[5, 6, 7, 8].map((i) => mk(i, 'none', 'thigh', 'selank')),
    ])
    const line = topLine(ctx, (x) => x)
    expect(line).toMatch(/motsc reacts most often/)
    expect(line).toMatch(/Abdomen reacts more than thigh/)
  })
})

describe('safety', () => {
  it('lists the eight the brief names', () => {
    expect(SAFETY_FLAGS).toHaveLength(8)
    expect(SAFETY_FLAGS.filter((f) => f.level === 'emergency').map((f) => f.id))
      .toEqual(['faceSwelling', 'breathing'])
  })

  it('sends the first six to a doctor', () => {
    for (const f of SAFETY_FLAGS.filter((x) => x.level === 'doctor')) {
      const hit = activeSafety([{ id: '1', type: f.id, date: T, clearedAt: null }])
      expect(hit.level).toBe('doctor')
      expect(hit.title).toBe('See a doctor today')
    }
  })

  it('sends swelling and breathing to 000', () => {
    for (const id of ['faceSwelling', 'breathing']) {
      const hit = activeSafety([{ id: '1', type: id, date: T, clearedAt: null }])
      expect(hit.level).toBe('emergency')
      expect(hit.title).toBe('Call 000 now')
    }
  })

  it('lets an emergency outrank everything else standing', () => {
    const hit = activeSafety([
      { id: '1', type: 'pus', date: T, clearedAt: null },
      { id: '2', type: 'breathing', date: T, clearedAt: null },
    ])
    expect(hit.level).toBe('emergency')
  })

  it('stays up until it is cleared by hand', () => {
    expect(activeSafety([{ id: '1', type: 'pus', date: T, clearedAt: at(T) }])).toBe(null)
    expect(activeSafety([])).toBe(null)
  })
})

describe('bringing the old Reaction Lab across', () => {
  it('maps every drawn zone that has a photo equivalent', () => {
    expect(pinForZone('abd-ll-in')).toBe('abd-l-navel-inner')
    expect(pinForZone('glute-r')).toBe('glute-r-upper-outer')
    expect(pinForZone('arm-l')).toBe(null)
  })

  it('reads an old check-in as one of the four words', () => {
    expect(severityFromCheckin({ present: false })).toBe('none')
    expect(severityFromCheckin({ present: true, diameterMm: 5, itch: 1 })).toBe('mild')
    expect(severityFromCheckin({ present: true, diameterMm: 20 })).toBe('moderate')
    expect(severityFromCheckin({ present: true, welt: true })).toBe('severe')
    expect(severityFromCheckin({ present: true, diameterMm: 40 })).toBe('severe')
  })

  it('carries records, ratings, gone dates and photos over', () => {
    const old = {
      injectionRecords: [{ id: 'ir-1', doseLogId: 'dl-1', compoundIds: ['motsc'], zoneId: 'abd-ll-in', injectedAt: at('2026-09-01', 8) }],
      reactions: [{ id: 'rx-1', injectionRecordId: 'ir-1', resolvedAt: at('2026-09-04') }],
      reactionCheckins: [
        { id: 'c1', reactionId: 'rx-1', completedAt: at('2026-09-02'), present: true, diameterMm: 30, itch: 5 },
        { id: 'c2', reactionId: 'rx-1', completedAt: at('2026-09-03'), present: false },
      ],
      reactionPhotos: [{ id: 'p1', reactionId: 'rx-1', blobKey: 'blob-1' }],
    }
    const out = migrateReactionLab(old)
    expect(out.records).toHaveLength(1)
    expect(out.records[0]).toMatchObject({
      peptideId: 'motsc', pinId: 'abd-l-navel-inner', siteGroup: 'abdomen', side: 'l',
      doseLogId: 'dl-1', mixed: false, needsPinning: false,
    })
    const r = out.reactions[0]
    expect(r.ratings.map((x) => x.severity)).toEqual(['severe', 'none'])
    expect(r.worstSeverity).toBe('severe')
    expect(r.goneAt).toBe(at('2026-09-04'))
    expect(r.photoIds).toEqual(['blob-1'])
    expect(out.unmapped).toEqual([])
  })

  it('marks a shared syringe as mixed', () => {
    const out = migrateReactionLab({
      injectionRecords: [{ id: 'ir-1', compoundIds: ['motsc', 'ghkcu'], zoneId: 'abd-ll-in', injectedAt: at(T) }],
    })
    expect(out.records[0].mixed).toBe(true)
  })

  it('keeps a record it cannot place, and flags it rather than dropping it', () => {
    const out = migrateReactionLab({
      injectionRecords: [
        { id: 'ir-1', compoundIds: ['motsc'], zoneId: 'arm-l', injectedAt: at(T) },
        { id: 'ir-2', compoundIds: ['motsc'], zoneId: null, injectedAt: at(T) },
      ],
    })
    expect(out.records).toHaveLength(2)
    expect(out.records.every((r) => r.needsPinning)).toBe(true)
    expect(out.unmapped.map((u) => u.id)).toEqual(['ir-1', 'ir-2'])
    expect(out.unmapped[0].reason).toMatch(/no matching site/)
  })

  it('loses nothing when there is nothing to migrate', () => {
    const out = migrateReactionLab({})
    expect(out).toEqual({ records: [], reactions: [], unmapped: [] })
  })
})

// ============================================================ photo import

describe('importing a photo', () => {
  it('spots HEIC by type or by name', () => {
    expect(looksHeic({ type: 'image/heic', name: 'x' })).toBe(true)
    expect(looksHeic({ type: '', name: 'IMG_0001.HEIC' })).toBe(true)
    expect(looksHeic({ type: 'image/jpeg', name: 'x.jpg' })).toBe(false)
    expect(looksHeic(null)).toBe(false)
  })

  it('knows which rotations swap the axes', () => {
    for (const o of [1, 2, 3, 4]) expect(swapsAxes(o)).toBe(false)
    for (const o of [5, 6, 7, 8]) expect(swapsAxes(o)).toBe(true)
  })

  it('dates a photo in local time, not UTC', () => {
    // a shot at nine in the evening belongs to that day, not the next one
    const d = new Date(2026, 8, 30, 21, 5)
    expect(localDateStr(d)).toBe('2026-09-30')
    expect(localTimeStr(d)).toBe('21:05')
  })

  it('imports at the same size and quality the camera uses', () => {
    expect(MAX_EDGE).toBe(1080)
    expect(QUALITY).toBe(0.82)
  })
})
