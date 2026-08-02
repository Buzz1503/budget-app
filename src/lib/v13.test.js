import { describe, it, expect } from 'vitest'
import {
  buildCalendar, weekSummary, adherenceTally, groupEvents, weekStart, monthStart, monthEnd,
  monthGridRange, addMonths, datesBetween, EVENT_META, ADHERENCE_TONE, ADHERENCE_WORDS,
} from './calendarView'
import {
  METRICS, METRIC_BY_KEY, LEGACY_METRICS, ALL_METRIC_BY_KEY, PRIMARY_FIELDS,
  EXTRA_GROUPS, EXTRA_FIELDS, MEASURE_RULES, REF_DISTANCES, DEFAULT_BODY_REFS,
  refPhrase, legacyMetricsPresent,
} from './metrics'
import { restockRows } from './restock'
import { addDaysStr } from './schedule'

// ---------- fixtures ----------
const T = '2026-03-04' // a Wednesday

function peptide(over = {}) {
  return {
    id: 'bpc157', name: 'BPC-157', frequency: 'daily', timing: 'AM', slot: 'AM',
    startDate: '2026-01-01', cycleOnDays: 0, cycleOffDays: 0, route: 'SubQ',
    ladder: { floor: 250, step: 0, intervalWeeks: 2, ceiling: 250, unit: 'mcg' },
    recon: { vialMg: 10, bacMl: 2, expiryDays: 28 },
    ...over,
  }
}

const base = {
  peptides: [peptide()],
  titration: { bpc157: { level: 0, levelStartDate: '2026-01-01' } },
  doseLogs: [],
  openVials: {},
  vials: [],
  restock: {},
  todayStr: T,
}

const MIX_ALL = () => 'MIX'

// ---------- date helpers ----------
describe('calendar date helpers', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-03-04')).toBe('2026-03-02') // Wed → Mon
    expect(weekStart('2026-03-02')).toBe('2026-03-02') // Mon → itself
    expect(weekStart('2026-03-01')).toBe('2026-02-23') // Sun → previous Mon
  })

  it('month bounds and the whole-week grid around them', () => {
    expect(monthStart('2026-03-04')).toBe('2026-03-01')
    expect(monthEnd('2026-03-04')).toBe('2026-03-31')
    expect(monthEnd('2026-02-10')).toBe('2026-02-28')
    const g = monthGridRange('2026-03-04')
    expect(g.from).toBe('2026-02-23') // Monday before 1 March (a Sunday)
    expect(datesBetween(g.from, g.to).length % 7).toBe(0)
  })

  it('addMonths lands on the first of the target month', () => {
    expect(addMonths('2026-03-04', 1)).toBe('2026-04-01')
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01')
  })

  it('datesBetween is inclusive and empty when reversed', () => {
    expect(datesBetween('2026-03-01', '2026-03-03')).toEqual(['2026-03-01', '2026-03-02', '2026-03-03'])
    expect(datesBetween('2026-03-03', '2026-03-01')).toEqual([])
  })
})

// ---------- day model ----------
describe('buildCalendar day model', () => {
  it('places a daily AM dose in the AM slot every day of the week', () => {
    const cal = buildCalendar({ ...base, from: '2026-03-02', to: '2026-03-08', verdictOf: MIX_ALL })
    expect(cal.days).toHaveLength(7)
    for (const d of cal.days) {
      expect(d.slots.AM).toHaveLength(1)
      expect(d.slots.PM).toHaveLength(0)
      expect(d.slots.AM[0].name).toBe('BPC-157')
    }
  })

  it('carries syringe units for an injectable and sprays for a nasal', () => {
    const nasal = peptide({
      id: 'semax', name: 'Semax', route: 'Nasal',
      ladder: { floor: 1, step: 0, intervalWeeks: 2, ceiling: 1, unit: 'spray' },
    })
    const cal = buildCalendar({
      ...base, peptides: [peptide(), nasal],
      titration: { ...base.titration, semax: { level: 0, levelStartDate: '2026-01-01' } },
      from: T, to: T, verdictOf: MIX_ALL,
    })
    const [inj, spray] = cal.days[0].slots.AM
    expect(inj.units).toBeCloseTo(5, 5) // 250 mcg at 5 mg/mL = 0.05 mL = 5 U
    expect(spray.nasal).toBe(true)
    expect(spray.units).toBeNull()
  })

  it('marks today, past and future distinctly', () => {
    const cal = buildCalendar({ ...base, from: addDaysStr(T, -1), to: addDaysStr(T, 1), verdictOf: MIX_ALL })
    expect(cal.days.map((d) => [d.isPast, d.isToday, d.isFuture])).toEqual([
      [true, false, false], [false, true, false], [false, false, true],
    ])
  })

  it('projects the titrated dose forward but leaves today at the current rung', () => {
    const climbing = peptide({
      ladder: { floor: 250, step: 250, intervalWeeks: 2, ceiling: 1000, unit: 'mcg' },
    })
    const cal = buildCalendar({
      ...base, peptides: [climbing],
      titration: { bpc157: { level: 0, levelStartDate: T } },
      from: T, to: addDaysStr(T, 30), verdictOf: MIX_ALL,
    })
    expect(cal.byDate[T].slots.AM[0].dose).toBe(250)
    expect(cal.byDate[T].slots.AM[0].projected).toBe(false)
    const later = cal.byDate[addDaysStr(T, 30)].slots.AM[0]
    expect(later.dose).toBeGreaterThan(250)
    expect(later.projected).toBe(true)
  })

  it('emits a step-up marker on the date the ladder advances', () => {
    const climbing = peptide({
      ladder: { floor: 250, step: 250, intervalWeeks: 2, ceiling: 1000, unit: 'mcg' },
    })
    const cal = buildCalendar({
      ...base, peptides: [climbing],
      titration: { bpc157: { level: 0, levelStartDate: T } },
      from: T, to: addDaysStr(T, 40), verdictOf: MIX_ALL,
    })
    const stepUps = cal.days.flatMap((d) => d.events.filter((e) => e.kind === 'step-up').map((e) => d.date))
    expect(stepUps.length).toBeGreaterThan(0)
    expect(stepUps[0]).toBe(addDaysStr(T, 14))
  })

  it('marks cycle on and off transitions', () => {
    const cycled = peptide({ startDate: T, cycleOnDays: 5, cycleOffDays: 5 })
    const cal = buildCalendar({
      ...base, peptides: [cycled], from: T, to: addDaysStr(T, 14), verdictOf: MIX_ALL,
    })
    const kinds = cal.days.flatMap((d) => d.events.map((e) => ({ date: d.date, kind: e.kind })))
    expect(kinds).toContainEqual({ date: T, kind: 'cycle-on' })
    expect(kinds).toContainEqual({ date: addDaysStr(T, 5), kind: 'cycle-off' })
    expect(kinds).toContainEqual({ date: addDaysStr(T, 10), kind: 'cycle-on' })
  })

  it('marks reconstituted-vial expiry and a delivery on their own dates', () => {
    const cal = buildCalendar({
      ...base,
      openVials: { bpc157: { remainingMg: 10, reconstitutedAt: T } },
      restock: { delivery: { 'vial:bpc157': addDaysStr(T, 3) } },
      from: T, to: addDaysStr(T, 40), verdictOf: MIX_ALL,
    })
    const expiry = cal.byDate[addDaysStr(T, 28)].events.map((e) => e.kind)
    expect(expiry).toContain('vial-expiry')
    expect(cal.byDate[addDaysStr(T, 3)].events.map((e) => e.kind)).toContain('delivery')
  })

  it('every event kind it can emit has display metadata', () => {
    const cal = buildCalendar({
      ...base,
      peptides: [peptide({ startDate: T, cycleOnDays: 5, cycleOffDays: 5, ladder: { floor: 100, step: 100, intervalWeeks: 2, ceiling: 400, unit: 'mcg' } })],
      openVials: { bpc157: { remainingMg: 1, reconstitutedAt: T } },
      vials: [{ id: 'v1', peptideId: 'bpc157', vialMg: 10, qtyOnHand: 1, costAud: 100 }],
      restock: { delivery: { 'vial:bpc157': addDaysStr(T, 2) } },
      from: T, to: addDaysStr(T, 60), verdictOf: MIX_ALL,
    })
    const kinds = new Set(cal.days.flatMap((d) => d.events.map((e) => e.kind)))
    expect(kinds.size).toBeGreaterThan(2)
    for (const k of kinds) expect(EVENT_META[k]).toBeTruthy()
  })
})

// ---------- co-draw grouping ----------
describe('calendar co-draw grouping', () => {
  const two = [
    peptide({ id: 'bpc157', name: 'BPC-157' }),
    peptide({ id: 'tb500', name: 'TB-500' }),
  ]
  const tit = {
    bpc157: { level: 0, levelStartDate: '2026-01-01' },
    tb500: { level: 0, levelStartDate: '2026-01-01' },
  }

  it('two mixable AM doses collapse to one syringe', () => {
    const cal = buildCalendar({ ...base, peptides: two, titration: tit, from: T, to: T, verdictOf: MIX_ALL })
    expect(cal.days[0].scheduled).toBe(2)
    expect(cal.days[0].shots).toBe(1)
    expect(cal.days[0].plans.AM.groups[0].items).toHaveLength(2)
  })

  it('a caution pair is never grouped', () => {
    const cal = buildCalendar({ ...base, peptides: two, titration: tit, from: T, to: T, verdictOf: () => 'CAUTION' })
    expect(cal.days[0].shots).toBe(2)
  })

  it('without the matrix it over-counts rather than claiming a safe co-draw', () => {
    const cal = buildCalendar({ ...base, peptides: two, titration: tit, from: T, to: T, verdictOf: null })
    expect(cal.grouped).toBe(false)
    expect(cal.days[0].shots).toBe(2)
  })

  it('an always-separate compound keeps its own syringe', () => {
    const oil = peptide({ id: 'teste', name: 'Test E', alwaysSeparate: true, separateReason: 'Oil-based' })
    const cal = buildCalendar({
      ...base, peptides: [...two, oil],
      titration: { ...tit, teste: { level: 0, levelStartDate: '2026-01-01' } },
      from: T, to: T, verdictOf: MIX_ALL,
    })
    expect(cal.days[0].shots).toBe(2) // the mixable pair + the oil on its own
  })

  it('a nasal spray adds to the count without joining a syringe', () => {
    const nasal = peptide({
      id: 'semax', name: 'Semax', route: 'Nasal',
      ladder: { floor: 1, step: 0, intervalWeeks: 2, ceiling: 1, unit: 'spray' },
    })
    const cal = buildCalendar({
      ...base, peptides: [...two, nasal],
      titration: { ...tit, semax: { level: 0, levelStartDate: '2026-01-01' } },
      from: T, to: T, verdictOf: MIX_ALL,
    })
    expect(cal.days[0].shots).toBe(2) // one combined syringe + one spray
    expect(cal.days[0].plans.AM.groups).toHaveLength(1)
  })
})

// ---------- adherence ----------
describe('calendar adherence', () => {
  const two = [peptide({ id: 'bpc157' }), peptide({ id: 'tb500', name: 'TB-500' })]
  const tit = {
    bpc157: { level: 0, levelStartDate: '2026-01-01' },
    tb500: { level: 0, levelStartDate: '2026-01-01' },
  }
  const y = addDaysStr(T, -1)

  const cal = (logs, over = {}) => buildCalendar({
    ...base, peptides: two, titration: tit, doseLogs: logs,
    from: addDaysStr(T, -2), to: addDaysStr(T, 2), verdictOf: MIX_ALL, ...over,
  })

  it('a past day with nothing logged is missed', () => {
    expect(cal([]).byDate[y].adherence).toBe('missed')
  })

  it('a past day with some logged is partial', () => {
    expect(cal([{ date: y, peptideId: 'bpc157' }]).byDate[y].adherence).toBe('partial')
  })

  it('a past day with everything logged is all', () => {
    const logs = [{ date: y, peptideId: 'bpc157' }, { date: y, peptideId: 'tb500' }]
    expect(cal(logs).byDate[y].adherence).toBe('all')
  })

  it('today with nothing logged is pending, never missed', () => {
    expect(cal([]).byDate[T].adherence).toBe('pending')
  })

  it('a future day is scheduled, never missed', () => {
    expect(cal([]).byDate[addDaysStr(T, 2)].adherence).toBe('future')
  })

  it('a day with nothing due is not rated at all', () => {
    const off = peptide({ frequency: 'weekly', scheduleWeekdays: [0] }) // Sundays only
    const c = buildCalendar({ ...base, peptides: [off], from: T, to: T, verdictOf: MIX_ALL })
    expect(c.days[0].adherence).toBe('none')
    expect(c.days[0].scheduled).toBe(0)
  })

  it('every adherence state has a tone and plain-words label', () => {
    for (const k of ['all', 'partial', 'missed', 'pending', 'future', 'none']) {
      expect(ADHERENCE_TONE[k]).toBeTruthy()
      expect(ADHERENCE_WORDS[k]).toBeTruthy()
    }
  })

  it('the tally ignores future and unscheduled days when scoring', () => {
    const logs = [{ date: y, peptideId: 'bpc157' }, { date: y, peptideId: 'tb500' }]
    const t = adherenceTally(cal(logs).days)
    expect(t.all).toBe(1)
    expect(t.rated).toBe(t.all + t.partial + t.missed)
    expect(t.pct).toBe(Math.round((t.all / t.rated) * 100))
  })
})

// ---------- event grouping ----------
describe('groupEvents', () => {
  const ev = (kind, name) => ({ kind, text: `${name} — whatever` })

  it('leaves a short list alone', () => {
    const out = groupEvents([ev('step-up', 'A'), ev('vial-expiry', 'B')])
    expect(out.map((e) => e.text)).toEqual(['A — whatever', 'B — whatever'])
  })

  it('collapses a kind that would bury the doses under identical lines', () => {
    const out = groupEvents(Array.from({ length: 12 }, (_, i) => ev('cycle-on', `P${i}`)))
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('12 compounds — cycle starts')
    expect(out[0].count).toBe(12)
  })

  it('collapses each kind independently', () => {
    const out = groupEvents([
      ...Array.from({ length: 5 }, (_, i) => ev('cycle-on', `P${i}`)),
      ev('step-up', 'Solo'),
    ])
    expect(out).toHaveLength(2)
    expect(out.find((e) => e.kind === 'cycle-on').count).toBe(5)
    expect(out.find((e) => e.kind === 'step-up').count).toBe(1)
  })
})

// ---------- week summary ----------
describe('weekSummary', () => {
  it('counts doses, syringes and markers over the visible days', () => {
    const two = [peptide({ id: 'bpc157' }), peptide({ id: 'tb500', name: 'TB-500' })]
    const cal = buildCalendar({
      ...base, peptides: two,
      titration: {
        bpc157: { level: 0, levelStartDate: '2026-01-01' },
        tb500: { level: 0, levelStartDate: '2026-01-01' },
      },
      openVials: { bpc157: { remainingMg: 10, reconstitutedAt: addDaysStr(T, -26) } },
      from: T, to: addDaysStr(T, 6), verdictOf: MIX_ALL,
    })
    const s = weekSummary(cal.days)
    expect(s.doses).toBe(14) // 2 peptides × 7 days
    expect(s.shots).toBe(7) // they co-draw, so one syringe a day
    expect(s.expiring).toBe(1)
  })
})

// ---------- merged stock/restock: one source for the numbers ----------
describe('restock rows carry the stock figures too', () => {
  const args = {
    peptides: [peptide()],
    titration: { bpc157: { level: 0, levelStartDate: '2026-01-01' } },
    vials: [{ id: 'v1', peptideId: 'bpc157', vialMg: 10, qtyOnHand: 2, qtyPurchased: 2, costAud: 80 }],
    openVials: { bpc157: { remainingMg: 4, reconstitutedAt: '2026-03-01' } },
    todayStr: T,
    days: 56,
  }

  it('exposes expiry, open-vial mg and cost-per-dose so no screen recomputes them', () => {
    const [row] = restockRows(args)
    expect(row.expiry.expiresAt).toBe('2026-03-29')
    expect(row.expiry.daysLeft).toBe(25)
    expect(row.openMg).toBe(4)
    expect(row.reconstituted).toBe(true)
    expect(row.costPerDose).toBeCloseTo(0.25 * (160 / 20), 6) // 0.25 mg at $8/mg
  })

  it('reports no expiry clock for an un-reconstituted vial', () => {
    const [row] = restockRows({ ...args, openVials: { bpc157: { remainingMg: 4, reconstitutedAt: null } } })
    expect(row.expiry).toBeNull()
    expect(row.reconstituted).toBe(false)
  })
})

// ---------- body measurements ----------
describe('body measurement metadata', () => {
  it('states the global rules once', () => {
    expect(MEASURE_RULES.length).toBeGreaterThanOrEqual(4)
    expect(MEASURE_RULES.join(' ')).toMatch(/same time of day/i)
    expect(MEASURE_RULES.join(' ')).toMatch(/exhale/i)
  })

  it('stores left and right separately for every limb', () => {
    for (const g of ['arm', 'forearm', 'thigh', 'calf']) {
      const pair = METRICS.filter((m) => m.group === g)
      expect(pair.map((m) => m.side).sort()).toEqual(['L', 'R'])
      expect(new Set(pair.map((m) => m.key)).size).toBe(2)
    }
  })

  it('gives every measurement an exact where-and-how instruction', () => {
    for (const m of METRICS) {
      expect(m.how, `${m.key} has no instruction`).toBeTruthy()
      expect(m.how.length).toBeGreaterThan(15)
    }
  })

  it('uses the wording the spec asked for on the landmark measurements', () => {
    expect(METRIC_BY_KEY.waist.how).toMatch(/belly button \(navel\)/i)
    expect(METRIC_BY_KEY.neck.how).toMatch(/Adam's apple/i)
    expect(METRIC_BY_KEY.chest.how).toMatch(/nipple level/i)
    expect(METRIC_BY_KEY.hips.how).toMatch(/widest part of the buttocks/i)
    expect(METRIC_BY_KEY.weight.how).toMatch(/before eating or drinking/i)
    expect(METRIC_BY_KEY.forearmL.how).toMatch(/widest part below the elbow/i)
    expect(METRIC_BY_KEY.calfR.how).toMatch(/widest part, standing/i)
  })

  it('ties arms to the elbow crease and thighs to the kneecap', () => {
    expect(METRIC_BY_KEY.armL.refKey).toBe('arm')
    expect(METRIC_BY_KEY.armR.refKey).toBe('arm')
    expect(METRIC_BY_KEY.thighL.refKey).toBe('thigh')
    expect(METRIC_BY_KEY.thighR.refKey).toBe('thigh')
    expect(REF_DISTANCES.arm.from).toMatch(/elbow crease/i)
    expect(REF_DISTANCES.thigh.from).toMatch(/kneecap/i)
  })

  it('renders the saved distance as the phrase shown beside the field', () => {
    expect(refPhrase({ arm: 18, thigh: 15 }, 'arm')).toBe('18 cm up from the elbow crease')
    expect(refPhrase({ arm: 18, thigh: 15 }, 'thigh')).toBe('15 cm above the top of the kneecap')
    // an unset reference falls back to the default rather than rendering blank
    expect(refPhrase({}, 'arm')).toBe(`${DEFAULT_BODY_REFS.arm} cm up from the elbow crease`)
    expect(refPhrase({ arm: 20 }, 'arm')).toBe('20 cm up from the elbow crease')
  })

  it('offers no single-value arm or thigh field for new entries', () => {
    const keys = new Set([...PRIMARY_FIELDS, ...EXTRA_FIELDS])
    expect(keys.has('arms')).toBe(false)
    expect(keys.has('thighs')).toBe(false)
    expect(METRIC_BY_KEY.arms).toBeUndefined()
  })

  it('keeps pre-split readings chartable instead of discarding them', () => {
    expect(LEGACY_METRICS.map((m) => m.key)).toEqual(['arms', 'thighs'])
    expect(ALL_METRIC_BY_KEY.arms.legacy).toBe(true)
    const ms = [{ date: '2026-01-01', arms: 38 }, { date: '2026-02-01', weight: 80 }]
    expect(legacyMetricsPresent(ms).map((m) => m.key)).toEqual(['arms'])
    expect(legacyMetricsPresent([{ date: '2026-01-01', weight: 80 }])).toEqual([])
  })

  it('groups each left/right pair under one instruction in the form', () => {
    const arm = EXTRA_GROUPS.find((g) => g.id === 'arm')
    expect(arm.keys).toEqual(['armL', 'armR'])
    // every grouped key is a real metric, and nothing is listed twice
    expect(new Set(EXTRA_FIELDS).size).toBe(EXTRA_FIELDS.length)
    for (const k of EXTRA_FIELDS) expect(METRIC_BY_KEY[k]).toBeTruthy()
  })
})
