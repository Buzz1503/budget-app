// v41 — Reaction Lab: scoring, site rules, check-in timing, traces, the
// investigation's locks and the analysis engine.
//
// The through-line in all of these is refusing to overclaim. The score is
// arithmetic on recorded observations; the onset labels describe timing and
// stop; the confidence badge exists to say "not yet" most of the time; and the
// confounding detector's whole job is to notice when the data cannot separate
// two things and say so instead of ranking them anyway.
import { describe, it, expect } from 'vitest'
import {
  ZONES, ZONE_BY_ID, zonesOn, allowedZones, zoneAllowedFor, defaultSideAssignment,
  SIDE_SETS, COINS, COIN_BY_ID,
} from './reactionZones'
import {
  rednessPoints, itchPoints, durationPoints, reactionScore, worstCheckin,
  onsetLabel, ONSET, escalating, safetyCheck, activeSafety, RS_POSITIVE, hoursBetween,
} from './reactionScore'
import {
  zoneStatus, nextBestSite, blockReason, sideWarning, zoneHistory, reactionRateByZone,
  DEFAULT_REST_DAYS,
} from './reactionSites'
import {
  dueWindows, outstanding, checkinsDue, shouldResolve, spreadPct, spreadWords,
  DEFAULT_WINDOWS,
} from './reactionCheckins'
import {
  mmPerPx, polygonAreaPx, maxCaliperPx, traceMeasurements, simplify, toPath,
} from './reactionTrace'
import {
  STEP_TYPES, DEFAULT_STEP_ORDER, newInvestigation, brokenLocks, lockWarning,
  stepRecords, stepProgress, stepResult, advance, remainingForVerdict,
} from './investigation'
import {
  groupsFor, factorSpread, confidenceFor, CONFIDENCE, confounded, suspectBoard,
  compare, evidence, FACTOR_BY_ID,
} from './reactionAnalysis'

const T = '2026-09-30'
const iso = (d, h = 12) => `${d}T${String(h).padStart(2, '0')}:00:00.000Z`

const rec = (over = {}) => ({
  id: `ir-${Math.random()}`, injectedAt: iso(T), compoundIds: ['motsc'], componentIds: [],
  sharedSyringe: false, zoneId: 'abd-ll-in', side: 'L', diluent: 'bac',
  confounded: false, investigationStepId: null, ...over,
})
const rx = (over = {}) => ({
  id: `rx-${Math.random()}`, injectionRecordId: 'ir-1', injectedAt: iso(T),
  status: 'open', resolvedAt: null, ...over,
})
const ci = (over = {}) => ({
  id: `rc-${Math.random()}`, reactionId: 'rx-1', completedAt: iso(T, 14),
  present: true, itch: 0, pain: 0, welt: false, lump: false, warm: false,
  diameterMm: 0, tracedAreaMm2: null, ...over,
})

// ------------------------------------------------------------------ zones

describe('the body map', () => {
  it('has every zone on exactly one view, with a side and a group', () => {
    for (const z of ZONES) {
      expect(['front', 'back']).toContain(z.view)
      expect(['L', 'R']).toContain(z.side)
      expect(z.group).toBeTruthy()
      expect(z.label).toBeTruthy()
    }
  })

  it('names each zone once', () => {
    expect(new Set(ZONES.map((z) => z.id)).size).toBe(ZONES.length)
  })

  it('splits the abdomen into eight', () => {
    expect(ZONES.filter((z) => z.group === 'abdomen')).toHaveLength(8)
  })

  it('carries the zones the brief names', () => {
    for (const g of ['abdomen', 'flank', 'thigh', 'glute', 'arm']) {
      expect(ZONES.some((z) => z.group === g)).toBe(true)
    }
    expect(zonesOn('front').length).toBeGreaterThan(0)
    expect(zonesOn('back').length).toBeGreaterThan(0)
  })

  it('keeps every zone inside the body box', () => {
    for (const z of ZONES) {
      expect(z.x).toBeGreaterThanOrEqual(0)
      expect(z.x + z.w).toBeLessThanOrEqual(100)
      expect(z.y + z.h).toBeLessThanOrEqual(200)
    }
  })

  it('puts MOTS-c left and anything with GHK-Cu right', () => {
    const a = defaultSideAssignment(['motsc', 'ghkcu', 'klow'], (id) => (id === 'klow' ? ['bpc157', 'ghkcu'] : []))
    expect(a.motsc).toBe('left-abdomen')
    expect(a.ghkcu).toBe('right-abdomen')
    // KLOW contains GHK-Cu, so it goes where GHK-Cu goes
    expect(a.klow).toBe('right-abdomen')
  })

  it('confines a compound to its assigned zones', () => {
    const a = { motsc: 'left-abdomen' }
    expect(zoneAllowedFor('motsc', 'abd-ll-in', a)).toBe(true)
    expect(zoneAllowedFor('motsc', 'abd-lr-in', a)).toBe(false)
    // a compound with no rule is free to go anywhere
    expect(zoneAllowedFor('selank', 'abd-lr-in', a)).toBe(true)
  })

  it('never puts a left set and a right set on the same zone', () => {
    const l = new Set(SIDE_SETS['left-abdomen'].zones)
    expect(SIDE_SETS['right-abdomen'].zones.some((z) => l.has(z))).toBe(false)
  })

  it('carries the four coins with their real diameters', () => {
    expect(COIN_BY_ID['aud-20c'].mm).toBe(28.52)
    expect(COINS.map((c) => c.mm)).toEqual([28.52, 25.00, 23.60, 19.41])
  })
})

// ------------------------------------------------------------------ score

describe('the reaction score', () => {
  it('bands redness the way the brief states', () => {
    expect(rednessPoints(0)).toBe(0)
    expect(rednessPoints(1)).toBe(1)
    expect(rednessPoints(10)).toBe(1)
    expect(rednessPoints(11)).toBe(2)
    expect(rednessPoints(25)).toBe(2)
    expect(rednessPoints(26)).toBe(3)
    expect(rednessPoints(50)).toBe(3)
    expect(rednessPoints(51)).toBe(4)
  })

  it('scales itch to two points', () => {
    expect(itchPoints(0)).toBe(0)
    expect(itchPoints(5)).toBe(1)
    expect(itchPoints(10)).toBe(2)
  })

  it('bands duration in days', () => {
    expect(durationPoints(0)).toBe(0)
    expect(durationPoints(23)).toBe(0)
    expect(durationPoints(24)).toBe(1)
    expect(durationPoints(72)).toBe(1)
    expect(durationPoints(73)).toBe(2)
    expect(durationPoints(null)).toBe(0)
  })

  it('adds the parts up and shows its working', () => {
    const r = rx({ id: 'rx-1' })
    const checks = [ci({ reactionId: 'rx-1', diameterMm: 30, itch: 5, welt: true, lump: false })]
    const out = reactionScore(r, checks)
    // 3 redness + 1 itch + 1 welt + 0 lump + 0 duration
    expect(out.score).toBe(5)
    expect(out.parts.redness.points).toBe(3)
    expect(out.parts.itch.points).toBe(1)
    expect(out.parts.welt.points).toBe(1)
    const sum = Object.values(out.parts).reduce((n, p) => n + p.points, 0)
    expect(Math.min(10, Math.round(sum * 10) / 10)).toBe(out.score)
  })

  it('caps at ten however bad it was', () => {
    const r = rx({ id: 'rx-1', resolvedAt: iso('2026-10-10') })
    const checks = [ci({ reactionId: 'rx-1', diameterMm: 300, itch: 10, welt: true, lump: true, completedAt: iso(T, 13) })]
    expect(reactionScore(r, checks).score).toBeLessThanOrEqual(10)
  })

  it('takes the worst check-in, not the last one', () => {
    const r = rx({ id: 'rx-1' })
    const checks = [
      ci({ reactionId: 'rx-1', diameterMm: 40, itch: 8, completedAt: iso(T, 13) }),
      ci({ reactionId: 'rx-1', diameterMm: 2, itch: 0, completedAt: iso(T, 20) }),
    ]
    expect(reactionScore(r, checks).parts.redness.points).toBe(3)
  })

  it('scores nothing when nothing was recorded', () => {
    expect(reactionScore(rx({ id: 'rx-1' }), []).score).toBe(0)
  })

  it('calls two or more positive', () => {
    expect(RS_POSITIVE).toBe(2)
    const r = rx({ id: 'rx-1' })
    expect(reactionScore(r, [ci({ reactionId: 'rx-1', diameterMm: 12 })]).positive).toBe(true)
    expect(reactionScore(r, [ci({ reactionId: 'rx-1', diameterMm: 5 })]).positive).toBe(false)
  })

  it('only counts check-ins from the first 72 hours', () => {
    const r = rx({ id: 'rx-1', injectedAt: iso('2026-09-20') })
    const checks = [
      ci({ reactionId: 'rx-1', diameterMm: 5, completedAt: iso('2026-09-21') }),
      ci({ reactionId: 'rx-1', diameterMm: 90, completedAt: iso('2026-09-29') }),
    ]
    // the huge one is on day nine and outside the window the score is built on
    expect(worstCheckin(checks, r.injectedAt).diameterMm).toBe(5)
  })
})

describe('onset labels', () => {
  const base = { id: 'rx-1', injectedAt: iso(T, 8) }

  it('calls a quick one that cleared fast a fast reaction', () => {
    const r = rx({ ...base, resolvedAt: iso(T, 20) })
    const checks = [ci({ reactionId: 'rx-1', completedAt: iso(T, 8.5 | 0), present: true, diameterMm: 8 })]
    expect(onsetLabel(r, checks)?.id).toBe('fast')
  })

  it('calls one that appeared a day later delayed', () => {
    const r = rx({ ...base })
    const checks = [ci({ reactionId: 'rx-1', completedAt: iso('2026-10-01', 20), present: true, diameterMm: 20 })]
    expect(onsetLabel(r, checks)?.id).toBe('delayed')
  })

  it('calls a hard lump persistent whatever the timing', () => {
    const r = rx({ ...base })
    const checks = [ci({ reactionId: 'rx-1', completedAt: iso(T, 9), present: true, lump: true })]
    expect(onsetLabel(r, checks)?.id).toBe('persistent')
  })

  it('calls anything still there after a week persistent', () => {
    const r = rx({ ...base })
    const checks = [ci({ reactionId: 'rx-1', completedAt: iso('2026-10-09'), present: true, diameterMm: 10 })]
    expect(onsetLabel(r, checks)?.id).toBe('persistent')
  })

  it('says nothing when nothing was ever present', () => {
    expect(onsetLabel(rx({ ...base }), [ci({ reactionId: 'rx-1', present: false })])).toBe(null)
  })

  it('never claims to know why', () => {
    for (const o of Object.values(ONSET)) {
      expect(o.words).not.toMatch(/\byou are allergic\b|\bdiagnos/i)
      expect(o.words.length).toBeGreaterThan(10)
    }
  })

  it('flags three rising scores as escalating', () => {
    expect(escalating([1, 3, 5])).toBe(true)
    expect(escalating([5, 3, 1])).toBe(false)
    expect(escalating([1, 3])).toBe(false)
    expect(escalating([3, 3, 3])).toBe(false)
    // only the last three matter
    expect(escalating([9, 1, 2, 3])).toBe(true)
  })
})

// ----------------------------------------------------------------- safety

describe('safety', () => {
  it('calls 000 for a throat, face or breathing symptom', () => {
    for (const f of ['faceSwelling', 'throatSwelling', 'breathing']) {
      const hit = safetyCheck(ci({ [f]: true }))
      expect(hit.level).toBe('emergency')
      expect(hit.title).toBe('Call 000 now')
    }
  })

  it('sends you to a doctor for streaks, pus, fever or symptoms elsewhere', () => {
    for (const f of ['redStreaks', 'pus', 'fever', 'elsewhere']) {
      const hit = safetyCheck(ci({ [f]: true }))
      expect(hit.level).toBe('urgent')
      expect(hit.title).toBe('See a doctor today')
    }
  })

  it('sends you for pain of seven or more', () => {
    expect(safetyCheck(ci({ pain: 7 })).level).toBe('urgent')
    expect(safetyCheck(ci({ pain: 6 }))).toBe(null)
  })

  it('sends you when it is growing and warm', () => {
    const prev = ci({ tracedAreaMm2: 100 })
    const now = ci({ tracedAreaMm2: 200, warm: true })
    expect(safetyCheck(now, prev).level).toBe('urgent')
    // growing but not warm, and not yet large, is not on its own a trigger
    expect(safetyCheck(ci({ tracedAreaMm2: 200 }), prev)).toBe(null)
  })

  it('sends you when it is over 50 mm and still spreading', () => {
    const prev = ci({ tracedAreaMm2: 100 })
    expect(safetyCheck(ci({ tracedAreaMm2: 300, diameterMm: 60 }), prev).level).toBe('urgent')
  })

  it('says nothing about an ordinary reaction', () => {
    expect(safetyCheck(ci({ diameterMm: 20, itch: 4 }))).toBe(null)
  })

  it('surfaces the worst thing across every open reaction', () => {
    const reactions = [rx({ id: 'rx-1' }), rx({ id: 'rx-2' })]
    const checks = [
      ci({ reactionId: 'rx-1', pus: true }),
      ci({ reactionId: 'rx-2', breathing: true }),
    ]
    expect(activeSafety({ reactions, checkins: checks }).level).toBe('emergency')
  })

  it('ignores a reaction that has been closed', () => {
    const reactions = [rx({ id: 'rx-1', status: 'resolved' })]
    expect(activeSafety({ reactions, checkins: [ci({ reactionId: 'rx-1', pus: true })] })).toBe(null)
  })
})

// ------------------------------------------------------------- site rules

describe('site rules', () => {
  const records = [rec({ id: 'a', zoneId: 'abd-ll-in', injectedAt: iso('2026-09-29') })]

  it('rests a zone for three days after a shot', () => {
    const st = zoneStatus('abd-ll-in', { records, reactions: [], todayStr: T, restDays: DEFAULT_REST_DAYS })
    expect(st.status).toBe('resting')
    expect(st.blocked).toBe(true)
    expect(st.until).toBe('2026-10-02')
  })

  it('frees it again once the rest is up', () => {
    const st = zoneStatus('abd-ll-in', { records, reactions: [], todayStr: '2026-10-03', restDays: 3 })
    expect(st.status).toBe('clear')
    expect(st.blocked).toBe(false)
  })

  it('blocks a zone with an open reaction, whatever the dates say', () => {
    const reactions = [rx({ injectionRecordId: 'a', status: 'open' })]
    const st = zoneStatus('abd-ll-in', { records, reactions, todayStr: '2026-12-01' })
    expect(st.status).toBe('reacting')
    expect(st.blocked).toBe(true)
  })

  it('keeps resting for two days after a reaction closes', () => {
    const reactions = [rx({ injectionRecordId: 'a', status: 'resolved', resolvedAt: iso('2026-10-05') })]
    const st = zoneStatus('abd-ll-in', { records, reactions, todayStr: '2026-10-06', restDays: 3 })
    expect(st.status).toBe('resting')
    expect(st.until).toBe('2026-10-07')
  })

  it('calls a zone never used what it is', () => {
    expect(zoneStatus('arm-l', { records, reactions: [], todayStr: T }).status).toBe('unused')
  })

  it('explains a block in words', () => {
    const reactions = [rx({ injectionRecordId: 'a', status: 'open' })]
    expect(blockReason('abd-ll-in', { records, reactions, todayStr: T })).toMatch(/open reaction/i)
    expect(blockReason('abd-ll-in', { records, reactions: [], todayStr: T })).toMatch(/resting/i)
    expect(blockReason('arm-l', { records, reactions: [], todayStr: T })).toBe(null)
  })

  it('suggests a site that respects the side assignment', () => {
    const sideAssignment = { motsc: 'left-abdomen' }
    const { zoneId } = nextBestSite('motsc', { records: [], reactions: [], sideAssignment, todayStr: T })
    expect(SIDE_SETS['left-abdomen'].zones).toContain(zoneId)
  })

  it('prefers a zone never used', () => {
    const sideAssignment = { motsc: 'left-abdomen' }
    const used = SIDE_SETS['left-abdomen'].zones.slice(0, 3).map((z, i) => rec({ id: `u${i}`, zoneId: z, injectedAt: iso('2026-01-01') }))
    const { zoneId, reason } = nextBestSite('motsc', { records: used, reactions: [], sideAssignment, todayStr: T })
    expect(used.map((u) => u.zoneId)).not.toContain(zoneId)
    expect(reason).toBe('never used')
  })

  it('falls back to the least recently used when everything has been used', () => {
    const sideAssignment = { motsc: 'left-abdomen' }
    const zones = SIDE_SETS['left-abdomen'].zones
    const used = zones.map((z, i) => rec({ id: `u${i}`, zoneId: z, injectedAt: iso(`2026-0${(i % 9) + 1}-01`) }))
    const { zoneId } = nextBestSite('motsc', { records: used, reactions: [], sideAssignment, todayStr: T })
    expect(zones).toContain(zoneId)
  })

  it('says so rather than suggesting a blocked site', () => {
    const sideAssignment = { motsc: 'left-abdomen' }
    const used = SIDE_SETS['left-abdomen'].zones.map((z, i) => rec({ id: `u${i}`, zoneId: z, injectedAt: iso('2026-09-29') }))
    const { zoneId, reason } = nextBestSite('motsc', { records: used, reactions: [], sideAssignment, todayStr: T, restDays: 3 })
    expect(zoneId).toBe(null)
    expect(reason).toMatch(/resting|reacting/)
  })

  it('warns when a compound is put on the wrong side', () => {
    const a = { motsc: 'left-abdomen' }
    expect(sideWarning('motsc', 'abd-lr-in', a)).toMatch(/breaks the side split/i)
    expect(sideWarning('motsc', 'abd-ll-in', a)).toBe(null)
  })

  it('lists a zone’s own history newest first', () => {
    const rs = [
      rec({ id: 'x', zoneId: 'abd-ll-in', injectedAt: iso('2026-09-01') }),
      rec({ id: 'y', zoneId: 'abd-ll-in', injectedAt: iso('2026-09-20') }),
      rec({ id: 'z', zoneId: 'arm-l', injectedAt: iso('2026-09-25') }),
    ]
    const h = zoneHistory('abd-ll-in', { records: rs, reactions: [] })
    expect(h.map((x) => x.record.id)).toEqual(['y', 'x'])
  })

  it('computes a reaction rate per zone for the heatmap', () => {
    const rs = [rec({ id: 'a', zoneId: 'abd-ll-in' }), rec({ id: 'b', zoneId: 'abd-ll-in' })]
    const rxs = [rx({ id: 'r1', injectionRecordId: 'a' })]
    const map = reactionRateByZone({ records: rs, reactions: rxs, positiveOf: () => true })
    expect(map['abd-ll-in']).toMatchObject({ n: 2, positive: 1, rate: 0.5 })
    expect(map['arm-l'].n).toBe(0)
  })
})

// --------------------------------------------------------------- check-ins

describe('check-in scheduling', () => {
  const r = rx({ id: 'rx-1', injectedAt: iso('2026-09-28', 18) })

  it('asks half an hour after the shot', () => {
    const w = dueWindows(r, { nowIso: iso('2026-09-28', 19) })
    expect(w[0].kind).toBe('quick')
    expect(new Date(w[0].dueAt) - new Date(r.injectedAt)).toBe(30 * 60000)
  })

  it('asks morning and evening for the first three days', () => {
    const w = dueWindows(r, { nowIso: iso('2026-09-30', 21) })
    const kinds = w.filter((x) => x.kind !== 'quick').map((x) => x.kind)
    expect(kinds).toContain('morning')
    expect(kinds).toContain('evening')
  })

  it('drops to evenings only after seventy-two hours', () => {
    const w = dueWindows(r, { nowIso: iso('2026-10-03', 21) })
    const late = w.filter((x) => x.dueAt > iso('2026-10-01', 23))
    expect(late.every((x) => x.kind === 'evening')).toBe(true)
  })

  it('thins to weekly after a week', () => {
    const w = dueWindows(r, { nowIso: iso('2026-10-20', 21) })
    const afterWeek = w.filter((x) => x.dueAt > iso('2026-10-06'))
    // one a week, not one a day
    expect(afterWeek.length).toBeLessThan(5)
  })

  it('never asks for a window before the shot', () => {
    const w = dueWindows(r, { nowIso: iso('2026-09-30') })
    expect(w.every((x) => x.dueAt > r.injectedAt)).toBe(true)
  })

  it('offers one outstanding card per reaction, never one per missed window', () => {
    const o = outstanding(r, [], { nowIso: iso('2026-10-02', 21) })
    expect(o.reactionId).toBe('rx-1')
    expect(o.window).toBeTruthy()
    // several windows went by; there is still exactly one thing to do
    expect(o.missed).toBeGreaterThan(0)
  })

  it('treats a late answer as covering the backlog', () => {
    const answered = [ci({ reactionId: 'rx-1', completedAt: iso('2026-10-02', 23) })]
    expect(outstanding(r, answered, { nowIso: iso('2026-10-02', 23, 30) })).toBe(null)
  })

  it('stores the real completion time, not the scheduled one', () => {
    // the library never invents a timestamp: what it is given is what it uses
    const late = ci({ reactionId: 'rx-1', completedAt: iso('2026-10-01', 2) })
    expect(late.completedAt).toBe(iso('2026-10-01', 2))
  })

  it('has nothing outstanding for a resolved reaction', () => {
    expect(outstanding(rx({ ...r, status: 'resolved' }), [], { nowIso: iso('2026-10-02') })).toBe(null)
  })

  it('sorts what is due oldest first', () => {
    const list = checkinsDue({
      reactions: [rx({ id: 'a', injectedAt: iso('2026-09-25') }), rx({ id: 'b', injectedAt: iso('2026-09-28') })],
      checkins: [], nowIso: iso('2026-09-30', 21),
    })
    expect(list.map((x) => x.reactionId)).toEqual(['a', 'b'])
  })

  it('closes a reaction on two clear looks in a row', () => {
    expect(shouldResolve([ci({ present: false, completedAt: iso(T, 8) }), ci({ present: false, completedAt: iso(T, 20) })])).toBe(true)
    expect(shouldResolve([ci({ present: true, completedAt: iso(T, 8) }), ci({ present: false, completedAt: iso(T, 20) })])).toBe(false)
    expect(shouldResolve([ci({ present: false })])).toBe(false)
  })

  it('computes spread from traced area', () => {
    expect(spreadPct(150, 100)).toBe(50)
    expect(spreadPct(50, 100)).toBe(-50)
    expect(spreadPct(100, 0)).toBe(null)
    expect(spreadWords(50)).toMatch(/larger/)
    expect(spreadWords(-50)).toMatch(/smaller/)
    expect(spreadWords(2)).toMatch(/same/)
  })

  it('uses the stated default windows', () => {
    expect(DEFAULT_WINDOWS).toEqual({ morning: '07:00', evening: '20:00' })
  })
})

// ------------------------------------------------------------------ trace

describe('the photo trace', () => {
  // a 20 px radius coin standing for a 20 mm coin: 0.5 mm per pixel
  const cal = { coinRadiusPx: 20, coinMm: 20 }

  it('converts pixels to millimetres through the coin', () => {
    expect(mmPerPx(20, 20)).toBe(0.5)
    expect(mmPerPx(0, 20)).toBe(null)
  })

  it('measures the area inside an outline', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    expect(polygonAreaPx(square)).toBe(100)
    // direction of travel does not change the patch of skin
    expect(polygonAreaPx([...square].reverse())).toBe(100)
  })

  it('finds the widest point across an outline', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    expect(maxCaliperPx(square)).toBeCloseTo(Math.sqrt(200), 5)
  })

  it('produces plausible millimetres for a traced circle', () => {
    // a circle of radius 40 px = 20 mm radius = 40 mm across, area ~1257 mm²
    const pts = Array.from({ length: 60 }, (_, i) => {
      const a = (i / 60) * Math.PI * 2
      return { x: 100 + Math.cos(a) * 40, y: 100 + Math.sin(a) * 40 }
    })
    const m = traceMeasurements(pts, cal)
    expect(m.diameterMm).toBeGreaterThan(38)
    expect(m.diameterMm).toBeLessThan(41)
    expect(m.areaMm2).toBeGreaterThan(1200)
    expect(m.areaMm2).toBeLessThan(1300)
    expect(m.equivalentDiameterMm).toBeCloseTo(m.diameterMm, 0)
  })

  it('refuses to measure without a calibration or a closed shape', () => {
    expect(traceMeasurements([{ x: 0, y: 0 }], cal)).toBe(null)
    expect(traceMeasurements([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], {})).toBe(null)
  })

  it('thins a finger path without losing its shape', () => {
    const dense = Array.from({ length: 200 }, (_, i) => ({ x: i * 0.5, y: 0 }))
    const thin = simplify(dense, 3)
    expect(thin.length).toBeLessThan(dense.length)
    expect(thin[0]).toEqual(dense[0])
  })

  it('writes an outline as a closed SVG path', () => {
    const p = toPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    expect(p.startsWith('M ')).toBe(true)
    expect(p.endsWith(' Z')).toBe(true)
  })
})

// ---------------------------------------------------------- investigation

describe('the investigation', () => {
  const built = newInvestigation({ suspects: ['motsc', 'ghkcu'], startDate: T })

  it('lays out the default plan in order', () => {
    expect(built.steps.map((s) => s.type)).toEqual(DEFAULT_STEP_ORDER)
    expect(built.steps[0].status).toBe('running')
    expect(built.steps.slice(1).every((s) => s.status === 'pending')).toBe(true)
  })

  it('gives every step a plain-English what and why', () => {
    for (const t of Object.values(STEP_TYPES)) {
      expect(t.what.length).toBeGreaterThan(10)
      expect(t.why.length).toBeGreaterThan(10)
      expect(t.name).toBeTruthy()
    }
  })

  it('states the control step in the brief’s own words', () => {
    expect(STEP_TYPES.control.why).toMatch(/A control shot/)
    expect(STEP_TYPES.control.why).toMatch(/not the peptide/)
  })

  it('catches a shared syringe during the split step', () => {
    const step = built.steps.find((s) => s.type === 'split')
    expect(brokenLocks(rec({ sharedSyringe: true }), step)).toContain('sharedSyringe')
    expect(brokenLocks(rec({ sharedSyringe: false }), step)).toEqual([])
  })

  it('catches a shot on the wrong side during the side step', () => {
    const step = built.steps.find((s) => s.type === 'sides')
    const ctx = {
      sideAssignment: { motsc: 'left-abdomen' },
      allowedZonesFor: (id) => allowedZones(id, { motsc: 'left-abdomen' }),
    }
    expect(brokenLocks(rec({ zoneId: 'abd-lr-in' }), step, ctx)).toContain('side')
    expect(brokenLocks(rec({ zoneId: 'abd-ll-in' }), step, ctx)).toEqual([])
  })

  it('catches a suspect taken during the pause step', () => {
    const step = built.steps.find((s) => s.type === 'pause')
    const ctx = { suspects: ['motsc', 'ghkcu'] }
    expect(brokenLocks(rec({ compoundIds: ['motsc'] }), step, ctx)).toContain('suspectsOff')
    expect(brokenLocks(rec({ compoundIds: ['selank'] }), step, ctx)).toEqual([])
  })

  it('warns in one line before anything is saved', () => {
    const step = built.steps.find((s) => s.type === 'split')
    const w = lockWarning(rec({ sharedSyringe: true }), step, {})
    expect(w).toMatch(/one compound per syringe/)
    expect(w).toMatch(/kept in your history/)
  })

  it('keeps a broken shot in history but out of the result', () => {
    const step = built.steps.find((s) => s.type === 'split')
    const records = [
      rec({ id: 'a', investigationStepId: step.id, sharedSyringe: false }),
      rec({ id: 'b', investigationStepId: step.id, sharedSyringe: true }),
    ]
    const { all, counted, confounded: bad } = stepRecords(step, { records })
    expect(all).toHaveLength(2)
    expect(counted.map((r) => r.id)).toEqual(['a'])
    expect(bad.map((r) => r.id)).toEqual(['b'])
  })

  it('counts progress on shots that counted, not shots logged', () => {
    const step = built.steps.find((s) => s.type === 'control')
    const records = Array.from({ length: 5 }, (_, i) => rec({
      id: `c${i}`, investigationStepId: step.id, confounded: true,
    }))
    const p = stepProgress(step, { records, reactions: [], todayStr: T })
    expect(p.logged).toBe(5)
    expect(p.n).toBe(0)
    expect(p.ready).toBe(false)
  })

  it('reads a clean control out in one sentence', () => {
    const step = built.steps.find((s) => s.type === 'control')
    const records = Array.from({ length: 3 }, (_, i) => rec({ id: `c${i}`, investigationStepId: step.id }))
    const r = stepResult(step, { records, reactions: [], positiveOf: () => false, scoreOf: () => 0, todayStr: T })
    expect(r.text).toBe('Control shots: 0 of 3 reacted. The water and technique are not the cause.')
  })

  it('reads a dirty control out differently', () => {
    const step = built.steps.find((s) => s.type === 'control')
    const records = Array.from({ length: 3 }, (_, i) => rec({ id: `c${i}`, investigationStepId: step.id }))
    const reactions = records.map((rr) => rx({ injectionRecordId: rr.id }))
    const r = stepResult(step, { records, reactions, positiveOf: () => true, scoreOf: () => 4, todayStr: T })
    expect(r.text).toMatch(/3 of 3 reacted/)
    expect(r.text).toMatch(/not the peptide|technique is involved/i)
  })

  it('counts down the injections still needed', () => {
    const step = built.steps.find((s) => s.type === 'control')
    const records = [rec({ id: 'c0', investigationStepId: step.id })]
    expect(remainingForVerdict(step, { records, reactions: [] })).toBe(2)
  })

  it('advances to the next step and records the result', () => {
    const next = advance(built.steps, built.steps[0].id, 'Baseline: 3 of 5 reacted.')
    expect(next[0].status).toBe('done')
    expect(next[0].result).toMatch(/Baseline/)
    expect(next[1].status).toBe('running')
  })
})

// --------------------------------------------------------------- analysis

describe('the analysis engine', () => {
  const scoreOf = (r) => r._score ?? 0
  const positiveOf = (r) => (r._score ?? 0) >= 2

  // six on the right with GHK-Cu, five reacting; four on the left with MOTS-c,
  // none reacting; three controls, none reacting
  const records = [
    ...Array.from({ length: 6 }, (_, i) => rec({ id: `r${i}`, compoundIds: ['ghkcu'], zoneId: 'abd-lr-in', side: 'R' })),
    ...Array.from({ length: 4 }, (_, i) => rec({ id: `l${i}`, compoundIds: ['motsc'], zoneId: 'abd-ll-in', side: 'L' })),
    ...Array.from({ length: 3 }, (_, i) => rec({ id: `c${i}`, compoundIds: [], zoneId: 'thigh-l-up', side: 'L' })),
  ]
  const reactions = Array.from({ length: 5 }, (_, i) => rx({ id: `rx${i}`, injectionRecordId: `r${i}`, _score: 4 }))
  const ctx = { records, reactions, scoreOf, positiveOf }

  it('groups by any factor with n, rate and average score', () => {
    const g = groupsFor('compound', ctx)
    const ghk = g.find((x) => x.value === 'ghkcu')
    const mots = g.find((x) => x.value === 'motsc')
    expect(ghk).toMatchObject({ n: 6, positive: 5 })
    expect(ghk.rate).toBeCloseTo(5 / 6, 5)
    expect(mots).toMatchObject({ n: 4, positive: 0, rate: 0 })
  })

  it('leaves confounded injections out of the rates but counts them', () => {
    const withBad = [...records, rec({ id: 'bad', compoundIds: ['ghkcu'], confounded: true })]
    const g = groupsFor('compound', { ...ctx, records: withBad })
    const ghk = g.find((x) => x.value === 'ghkcu')
    expect(ghk.n).toBe(6)
    expect(ghk.confounded).toBe(1)
  })

  it('measures how much a factor separates things', () => {
    const spread = factorSpread(groupsFor('compound', ctx))
    expect(spread.gap).toBeCloseTo(5 / 6, 5)
    expect(spread.top.value).toBe('ghkcu')
  })

  it('ranks the suspects with the evidence line', () => {
    const board = suspectBoard({ ...ctx, suspects: ['ghkcu', 'motsc'], nameOf: (x) => x, controlDone: true })
    expect(board.top.id).toBe('ghkcu')
    expect(board.top.evidence).toMatch(/Reacted 5 of 6 times/)
    expect(board.verdict).toMatch(/ghkcu/)
  })

  it('will not call it high without enough in every group', () => {
    expect(confidenceFor({ groups: [{ rate: 1, n: 2 }, { rate: 0, n: 8 }], controlDone: true })).toBe(CONFIDENCE.low)
  })

  it('will not call it high on a small gap', () => {
    expect(confidenceFor({ groups: [{ rate: 0.6, n: 8 }, { rate: 0.5, n: 8 }], controlDone: true })).toBe(CONFIDENCE.low)
  })

  it('will not call it high without the control', () => {
    const c = confidenceFor({ groups: [{ rate: 0.9, n: 8 }, { rate: 0.1, n: 8 }], controlDone: false })
    expect(c).toBe(CONFIDENCE.medium)
  })

  it('calls it high only with size, gap and a control', () => {
    expect(confidenceFor({ groups: [{ rate: 0.9, n: 8 }, { rate: 0.1, n: 8 }], controlDone: true })).toBe(CONFIDENCE.high)
  })

  it('drops to low when a third of the data is confounded', () => {
    expect(confidenceFor({ groups: [{ rate: 0.9, n: 8 }, { rate: 0.1, n: 8 }], confoundedShare: 0.35, controlDone: true }))
      .toBe(CONFIDENCE.low)
  })

  it('spots two things that have only ever happened together', () => {
    const shared = Array.from({ length: 4 }, (_, i) => rec({
      id: `s${i}`, compoundIds: ['motsc', 'ghkcu'], sharedSyringe: true,
    }))
    const hits = confounded({ records: shared, factorIds: ['compound'] })
    expect(hits.length).toBeGreaterThan(0)
    const pair = hits[0]
    expect([pair.a.value, pair.b.value].sort()).toEqual(['ghkcu', 'motsc'])
    expect(pair.fix.step).toBeTruthy()
  })

  it('does not flag two things that have been apart', () => {
    expect(confounded({ records, factorIds: ['compound'] })).toEqual([])
  })

  it('compares any two values side by side', () => {
    const c = compare('compound', 'ghkcu', 'motsc', ctx)
    expect(c.a.n).toBe(6)
    expect(c.b.n).toBe(4)
    expect(c.a.rate).toBeGreaterThan(c.b.rate)
  })

  it('returns zeroes rather than nothing for a value with no data', () => {
    const c = compare('compound', 'ghkcu', 'nothing-here', ctx)
    expect(c.b.n).toBe(0)
    expect(c.b.rate).toBe(null)
  })

  it('sorts the evidence page by what separates most', () => {
    const rows = evidence(ctx)
    expect(rows.length).toBeGreaterThan(0)
    const gaps = rows.map((r) => r.spread?.gap ?? -1)
    expect([...gaps].sort((a, b) => b - a)).toEqual(gaps)
  })

  it('considers blends, diluent, vials and technique as well as compounds', () => {
    for (const f of ['component', 'diluent', 'vial', 'batch', 'vendor', 'needleGauge', 'speed', 'temperature', 'sharedSyringe']) {
      expect(FACTOR_BY_ID[f]).toBeTruthy()
    }
  })
})

describe('one evening, several shots', () => {
  it('sends a compound with no rule of its own to the thighs', () => {
    // the brief's default, and the reason nextBestSite asks allowedZones rather
    // than zoneAllowedFor — the latter is permissive so it does not warn
    const { zoneId } = nextBestSite('selank', { records: [], reactions: [], sideAssignment: { motsc: 'left-abdomen' }, todayStr: T })
    expect(SIDE_SETS.thighs.zones).toContain(zoneId)
  })

  it('never sends two shots on the same night to the same place', () => {
    const taken = []
    const picks = ['a', 'b', 'c'].map((id) => {
      const r = nextBestSite(id, { records: [], reactions: [], sideAssignment: {}, todayStr: T, excludeZones: taken })
      if (r.zoneId) taken.push(r.zoneId)
      return r.zoneId
    })
    expect(new Set(picks).size).toBe(picks.length)
  })

  it('says so when the evening has used every site it is allowed', () => {
    const taken = [...SIDE_SETS.thighs.zones]
    const r = nextBestSite('selank', { records: [], reactions: [], sideAssignment: {}, todayStr: T, excludeZones: taken })
    expect(r.zoneId).toBe(null)
    expect(r.reason).toMatch(/other shots tonight/)
  })
})
