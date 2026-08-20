import { describe, it, expect } from 'vitest'
import {
  horizonDays, dosesInWindow, syringesInWindow, restockRows, consumableRows,
  restockPlan, costPerVial, deliveryCovers, deliveryEvents, DEFAULT_UNIT_COSTS,
} from './restock'
import {
  parseDoseRange, ladderFromRange, niceStep, wizardSuggestion, toPeptide,
  frequencyFrom, cycleFrom, seedProtocolFor, DEFAULT_RECON, INTRANASAL_IDS,
} from './wizardDefaults'
import { buildRungs } from './schedule'
import { buildIcs, deliveryVevents } from './calendar'
import { REFERENCE_COMPOUNDS } from './reference'
import { seedPeptides, TEST_E_ID } from '../data/seed'
import { toMg } from './calc'

const TODAY = '2026-03-02' // a Monday
const titrationFor = (ps) => Object.fromEntries(ps.map((p) => [p.id, { level: 0, levelStartDate: TODAY }]))

const daily = (over = {}) => ({
  id: 'a', name: 'A', startDate: TODAY, route: 'SubQ', frequency: 'daily', timing: '',
  cycleOnDays: 0, cycleOffDays: 0,
  ladder: { floor: 500, step: 0, intervalWeeks: 1, ceiling: 500, unit: 'mcg' },
  recon: { vialMg: 10, bacMl: 2, expiryDays: 28 },
  ...over,
})

// ---------------------------------------------------------------- restock
describe('restock horizon', () => {
  it('offers fixed 8 and 12 week windows', () => {
    expect(horizonDays('8w', [], TODAY)).toBe(56)
    expect(horizonDays('12w', [], TODAY)).toBe(84)
  })

  it('runs to the end of the longest current cycle', () => {
    // 42 on / 14 off, started today → 56 days left in this round
    const p = daily({ cycleOnDays: 42, cycleOffDays: 14 })
    expect(horizonDays('cycles', [p], TODAY)).toBe(56)
    // ten days in, ten fewer to go
    expect(horizonDays('cycles', [{ ...p, startDate: '2026-02-20' }], TODAY)).toBe(46)
  })

  it('falls back to 8 weeks when nothing is cycled', () => {
    expect(horizonDays('cycles', [daily()], TODAY)).toBe(56)
    expect(horizonDays('cycles', [], TODAY)).toBe(56)
  })
})

describe('doses over the window', () => {
  it('counts a daily peptide every day', () => {
    expect(dosesInWindow(daily(), TODAY, 28)).toBe(28)
  })

  it('counts a weekday-limited peptide only on its days', () => {
    const p = daily({ frequency: '2xweek', scheduleWeekdays: [1, 4] })
    expect(dosesInWindow(p, TODAY, 28)).toBe(8)
  })

  it('charges nothing for an off-cycle stretch', () => {
    // 14 on / 14 off from today → 28 days covers exactly one on-block
    const p = daily({ cycleOnDays: 14, cycleOffDays: 14 })
    expect(dosesInWindow(p, TODAY, 28)).toBe(14)
  })

  it('counts nothing for a peptide with no protocol set', () => {
    const blank = daily({ ladder: { floor: 0, step: 0, intervalWeeks: 1, ceiling: 0, unit: 'mcg' } })
    expect(dosesInWindow(blank, TODAY, 28)).toBe(0)
  })
})

describe('syringes, with co-draws counted once', () => {
  const a = daily({ id: 'a', name: 'A' })
  const b = daily({ id: 'b', name: 'B' })
  const ps = [a, b]

  it('counts one syringe per dose without the matrix', () => {
    const r = syringesInWindow(ps, titrationFor(ps), TODAY, 7, null)
    expect(r.injections).toBe(14)
    expect(r.syringes).toBe(14)
    expect(r.grouped).toBe(false)
  })

  it('collapses a MIX pair into one syringe a day', () => {
    const r = syringesInWindow(ps, titrationFor(ps), TODAY, 7, () => 'MIX')
    expect(r.injections).toBe(14)
    expect(r.syringes).toBe(7)
    expect(r.grouped).toBe(true)
  })

  it('keeps a CAUTION pair on separate syringes', () => {
    const r = syringesInWindow(ps, titrationFor(ps), TODAY, 7, () => 'CAUTION')
    expect(r.syringes).toBe(14)
  })

  it('leaves nasal peptides out of the syringe count entirely', () => {
    const nasal = daily({ id: 'n', name: 'N', route: 'Nasal', ladder: { floor: 2, step: 0, intervalWeeks: 1, ceiling: 2, unit: 'spray' } })
    const r = syringesInWindow([a, nasal], titrationFor([a, nasal]), TODAY, 7, () => 'MIX')
    expect(r.injections).toBe(7)
    expect(r.syringes).toBe(7)
  })
})

describe('what to order', () => {
  const p = daily() // 0.5 mg a day out of a 10 mg vial
  const vials = [{ id: 'v', peptideId: 'a', vialMg: 10, costAud: 60, qtyPurchased: 2, qtyOnHand: 1 }]
  const openVials = { a: { remainingMg: 10, reconstitutedAt: null } }

  it('orders the shortfall, in whole vials', () => {
    // 28 days × 0.5 mg = 14 mg needed, 20 mg on hand → nothing to order
    const [row] = restockRows({ peptides: [p], titration: titrationFor([p]), vials, openVials, todayStr: TODAY, days: 28 })
    expect(row.neededMg).toBeCloseTo(14, 6)
    expect(row.stockMg).toBe(20)
    expect(row.suggestedVials).toBe(0)
    // over 84 days it needs 42 mg → 22 mg short → 3 more vials
    const [long] = restockRows({ peptides: [p], titration: titrationFor([p]), vials, openVials, todayStr: TODAY, days: 84 })
    expect(long.neededMg).toBeCloseTo(42, 6)
    expect(long.suggestedVials).toBe(3)
  })

  it('flags "order now" only inside the lead time', () => {
    // 20 mg at 0.5 mg/day = 40 days of stock
    const [near] = restockRows({ peptides: [p], titration: titrationFor([p]), vials, openVials, todayStr: TODAY, days: 84, leadDays: 45 })
    expect(near.priority).toBe('now')
    const [later] = restockRows({ peptides: [p], titration: titrationFor([p]), vials, openVials, todayStr: TODAY, days: 84, leadDays: 14 })
    expect(later.priority).toBe('soon')
    expect(later.daysLeft).toBe(40)
    expect(later.runOutDate).toBe('2026-04-11')
  })

  it('prices from the weighted average paid per vial', () => {
    expect(costPerVial('a', vials)).toBe(60)
    expect(costPerVial('a', [
      { peptideId: 'a', costAud: 50, qtyPurchased: 1 },
      { peptideId: 'a', costAud: 70, qtyPurchased: 1 },
    ])).toBe(60)
    expect(costPerVial('a', [])).toBe(0)
  })

  it('honours a manual quantity override', () => {
    const [row] = restockRows({
      peptides: [p], titration: titrationFor([p]), vials, openVials, todayStr: TODAY, days: 84,
      restock: { qty: { 'vial:a': 9 } },
    })
    expect(row.suggestedVials).toBe(3)
    expect(row.qty).toBe(9)
  })

  it('sorts soonest to run out first', () => {
    const slow = daily({ id: 'slow', name: 'Slow', ladder: { floor: 100, step: 0, intervalWeeks: 1, ceiling: 100, unit: 'mcg' } })
    const rows = restockRows({
      peptides: [p, slow], titration: titrationFor([p, slow]),
      vials: [...vials, { id: 'v2', peptideId: 'slow', vialMg: 10, costAud: 20, qtyPurchased: 1, qtyOnHand: 1 }],
      openVials: { ...openVials, slow: { remainingMg: 10 } }, todayStr: TODAY, days: 84,
    })
    expect(rows[0].peptideId).toBe('a')
  })

  it('skips peptides with no protocol set', () => {
    const blank = daily({ id: 'blank', ladder: { floor: 0, step: 0, intervalWeeks: 1, ceiling: 0, unit: 'mcg' } })
    const rows = restockRows({ peptides: [blank], titration: titrationFor([blank]), vials: [], openVials: {}, todayStr: TODAY, days: 28 })
    expect(rows).toHaveLength(0)
  })
})

describe('consumables follow the schedule', () => {
  const a = daily({ id: 'a', name: 'A' })
  const b = daily({ id: 'b', name: 'B' })

  it('two swabs an injection, and syringes that match the co-draws', () => {
    const c = consumableRows({
      peptides: [a, b], titration: titrationFor([a, b]), vials: [], openVials: {},
      todayStr: TODAY, days: 7, verdictOf: () => 'MIX',
    })
    expect(c.syringes).toBe(7)
    const by = Object.fromEntries(c.rows.map((r) => [r.id, r.suggestedVials]))
    expect(by.syringe).toBe(7)
    expect(by.swab).toBe(14)
    expect(by.sharps).toBe(1)
  })

  it('an IM compound gets IM needles instead of insulin syringes', () => {
    const im = daily({ id: 'im', name: 'IM one', route: 'IM' })
    const c = consumableRows({
      peptides: [im], titration: titrationFor([im]), vials: [], openVials: {},
      todayStr: TODAY, days: 7, verdictOf: () => 'MIX',
    })
    const by = Object.fromEntries(c.rows.map((r) => [r.id, r.suggestedVials]))
    expect(by.imNeedle).toBe(7)
    expect(by.syringe).toBeUndefined() // all seven were IM
  })

  it('an intranasal compound gets bottles and saline, not syringes', () => {
    const nasal = daily({
      id: 'semax', name: 'Semax', route: 'Nasal',
      ladder: { floor: 2, step: 0, intervalWeeks: 1, ceiling: 2, unit: 'spray' },
    })
    const c = consumableRows({
      peptides: [nasal], titration: titrationFor([nasal]), vials: [], openVials: {},
      todayStr: TODAY, days: 56, verdictOf: () => 'MIX',
    })
    const by = Object.fromEntries(c.rows.map((r) => [r.id, r.suggestedVials]))
    // 56 days × 2 sprays = 112 sprays, 50 to a bottle → 3 bottles
    expect(by.bottle).toBe(3)
    expect(by.saline).toBeGreaterThan(0)
    expect(by.syringe).toBeUndefined()
    expect(c.injections).toBe(0)
  })

  it('counts BAC water against the vials actually being ordered', () => {
    const c = consumableRows({
      peptides: [a], titration: titrationFor([a]), vials: [], openVials: {},
      todayStr: TODAY, days: 84, verdictOf: () => 'MIX',
    })
    const by = Object.fromEntries(c.rows.map((r) => [r.id, r.suggestedVials]))
    // 42 mg needed, nothing on hand → 5 vials × 2 mL = 10 mL → 1 bottle
    expect(by.bac).toBe(1)
  })
})

describe('the whole plan', () => {
  const a = daily({ id: 'a', name: 'A' })
  const vials = [{ id: 'v', peptideId: 'a', vialMg: 10, costAud: 60, qtyPurchased: 1, qtyOnHand: 0 }]

  it('totals compounds and consumables in AUD', () => {
    const plan = restockPlan({
      peptides: [a], titration: titrationFor([a]), vials, openVials: { a: { remainingMg: 0 } },
      todayStr: TODAY, restock: { horizon: '8w' }, verdictOf: () => 'MIX',
    })
    expect(plan.days).toBe(56)
    expect(plan.rows[0].suggestedVials).toBe(3) // 28 mg needed, none on hand
    expect(plan.vialCost).toBe(180)
    expect(plan.consumableCost).toBeGreaterThan(0)
    expect(plan.totalAud).toBeCloseTo(plan.vialCost + plan.consumableCost, 2)
  })

  it('uses an edited unit cost for consumables', () => {
    const base = restockPlan({
      peptides: [a], titration: titrationFor([a]), vials: [], openVials: {},
      todayStr: TODAY, restock: { horizon: '8w' }, verdictOf: () => 'MIX',
    })
    const dearer = restockPlan({
      peptides: [a], titration: titrationFor([a]), vials: [], openVials: {},
      todayStr: TODAY, restock: { horizon: '8w', unitCosts: { syringe: DEFAULT_UNIT_COSTS.syringe * 10 } },
      verdictOf: () => 'MIX',
    })
    expect(dearer.consumableCost).toBeGreaterThan(base.consumableCost)
  })
})

describe('deliveries', () => {
  it('covers a run-out it lands before, and clears once it has arrived', () => {
    const restock = { delivery: { 'vial:a': '2026-03-10' } }
    expect(deliveryCovers(restock, 'a', '2026-03-20', TODAY)).toEqual({ eta: '2026-03-10', arrived: false })
    // arrives after the run-out — no cover
    expect(deliveryCovers(restock, 'a', '2026-03-05', TODAY)).toBeNull()
    // already here
    expect(deliveryCovers(restock, 'a', '2026-03-20', '2026-03-11')).toEqual({ eta: '2026-03-10', arrived: true })
    expect(deliveryCovers({}, 'a', '2026-03-20', TODAY)).toBeNull()
  })

  it('turns into calendar events', () => {
    const events = deliveryEvents(
      { delivery: { 'vial:a': '2026-03-10', 'consumable:syringe': '2026-03-05' } },
      [{ id: 'a', name: 'Alpha' }]
    )
    expect(events.map((e) => e.date)).toEqual(['2026-03-05', '2026-03-10'])
    expect(events[1].label).toMatch(/Alpha delivery expected/)
    expect(deliveryVevents(events, '20260302T000000Z').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2)
  })

  it('rides along in the exported .ics', () => {
    const p = daily()
    const { ics, eventCount } = buildIcs([p], titrationFor([p]), {
      from: new Date('2026-03-02T00:00:00'),
      deliveries: [{ key: 'vial:a', date: '2026-03-10', label: 'A delivery expected' }],
    })
    expect(ics).toMatch(/DTSTART;VALUE=DATE:20260310/)
    expect(ics).toMatch(/delivery expected/)
    expect(ics.endsWith('END:VCALENDAR')).toBe(true)
    expect(eventCount).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------- wizard
describe('reading a dose range out of the reference', () => {
  it('takes an explicit low–high range', () => {
    expect(parseDoseRange('Community range 200-500 mcg per day.')).toEqual({ lo: 200, hi: 500, unit: 'mcg' })
    expect(parseDoseRange('Community injectable 1-2 mg per day.')).toEqual({ lo: 1, hi: 2, unit: 'mg' })
    expect(parseDoseRange('Historical label: 0.2-0.3 mg.')).toEqual({ lo: 0.2, hi: 0.3, unit: 'mg' })
  })

  it('refuses a single number — those are starting doses or maximums', () => {
    expect(parseDoseRange('Label titration: 0.25 mg weekly x4wk, 0.5 x4wk, 2.4 mg maintenance.')).toBeNull()
    expect(parseDoseRange('Trials used up to 6.0 mg weekly with slow escalation.')).toBeNull()
    expect(parseDoseRange('Label: 2 mg daily subcutaneous.')).toBeNull()
    expect(parseDoseRange('Trials used 3.0, 4.5, 6.0 and 9.0 mg weekly.')).toBeNull()
  })

  it('refuses a range quoted for another route', () => {
    expect(parseDoseRange('Community use is predominantly ORAL, 50-150 mg per day.')).toBeNull()
    expect(parseDoseRange('Community IV/IM 600-2400 mg.')).toBeNull()
    expect(parseDoseRange('Label range varies widely by indication: 5-30 ml per day.')).toBeNull()
  })

  it('refuses nonsense and empties', () => {
    expect(parseDoseRange('')).toBeNull()
    expect(parseDoseRange('No established figure.')).toBeNull()
    expect(parseDoseRange('NOT PROVIDED.')).toBeNull()
    expect(parseDoseRange('500-200 mcg')).toBeNull() // backwards
  })

  it('never derives a ladder that the schedule engine would choke on', () => {
    for (const c of REFERENCE_COMPOUNDS) {
      const s = wizardSuggestion(c)
      if (!s.ladder) continue
      const l = s.ladder
      expect(l.floor, c.id).toBeGreaterThan(0)
      expect(l.ceiling, c.id).toBeGreaterThanOrEqual(l.floor)
      expect(l.step, c.id).toBeGreaterThan(0)
      expect(l.intervalWeeks, c.id).toBeGreaterThanOrEqual(1)
      const rungs = buildRungs(l)
      expect(rungs[0], c.id).toBe(l.floor)
      expect(rungs[rungs.length - 1], c.id).toBe(l.ceiling)
      expect(rungs.length, c.id).toBeLessThanOrEqual(8)
    }
  })

  it('gives a step that divides the range into a handful of rungs', () => {
    expect(niceStep(300, 'mcg')).toBe(100)
    expect(ladderFromRange({ lo: 200, hi: 500, unit: 'mcg' }).step).toBe(100)
    // a 1 mg span steps 1 → 1.35 → 1.7 → 2
    expect(ladderFromRange({ lo: 1, hi: 2, unit: 'mg' }).step).toBe(0.35)
    // never a float artefact
    for (const r of [{ lo: 1, hi: 2, unit: 'mg' }, { lo: 2, hi: 2.5, unit: 'mg' }, { lo: 0.5, hi: 1, unit: 'mg' }]) {
      const s = ladderFromRange(r).step
      expect(String(s).replace(/^-?\d*\.?/, '').length, `${r.lo}-${r.hi}`).toBeLessThanOrEqual(3)
    }
  })
})

describe('wizard suggestions', () => {
  it('uses the app’s own protocol verbatim for the compounds it seeds', () => {
    for (const seed of seedPeptides('2026-01-01')) {
      if (seed.id === TEST_E_ID) continue
      const s = wizardSuggestion({ id: seed.id, name: seed.name })
      expect(s.source, seed.id).toBe('seed')
      expect(s.ladder, seed.id).toEqual(seed.ladder)
      expect(s.recon, seed.id).toEqual(seed.recon)
      expect(s.frequency, seed.id).toBe(seed.frequency)
    }
  })

  it('carries the oil injectable’s full setup, SubQ thigh and never-co-drawn', () => {
    const s = wizardSuggestion({ id: TEST_E_ID, name: 'Testosterone Enanthate' })
    expect(s.source).toBe('seed')
    // v20: SubQ into thigh fat rather than IM
    expect(s.route).toBe('SubQ')
    expect(s.alwaysSeparate).toBe(true)
    expect(s.preparation).toBe('premixed')
    expect(s.ladder.floor).toBe(50)
    expect(seedProtocolFor(TEST_E_ID)).toBeTruthy()
  })

  it('never pre-fills a dose for a TX compound, and shows why', () => {
    const tx = REFERENCE_COMPOUNDS.filter((c) => c.tier === 'TX')
    expect(tx.length).toBeGreaterThan(0)
    for (const c of tx) {
      const s = wizardSuggestion(c)
      expect(s.source, c.id).toBe('excluded')
      expect(s.ladder, c.id).toBeNull()
      expect(s.excluded, c.id).toBe(true)
      expect(s.doseText, c.id).toBe('')
      expect(s.safety.length, c.id).toBeGreaterThan(0)
      // and it lands in the library with a blank ladder rather than a made-up one
      const p = toPeptide(s, TODAY)
      expect(p.ladder.ceiling, c.id).toBe(0)
    }
  })

  it('keeps established and reported apart', () => {
    const s = wizardSuggestion({ id: 'semaglutide' })
    expect(s.established.length).toBeGreaterThan(0)
    expect(s.reported.length).toBeGreaterThan(0)
    for (const e of s.established) expect(s.reported).not.toContain(e)
    expect(s.reference.established).toEqual(s.established)
    expect(s.reference.reported).toEqual(s.reported)
  })

  it('carries mechanism, tier and confidence through', () => {
    const s = wizardSuggestion({ id: 'bpc157' })
    expect(s.tier).toBeTruthy()
    expect(s.confidence).toBeTruthy()
    expect(s.mechanism.length).toBeGreaterThan(10)
  })

  it('offers the nasal route only where it applies', () => {
    expect(wizardSuggestion({ id: 'semax' }).routes).toContain('Nasal')
    expect(wizardSuggestion({ id: 'selank' }).routes).toContain('Nasal')
    expect(wizardSuggestion({ id: 'bpc157' }).routes).not.toContain('Nasal')
    expect([...INTRANASAL_IDS].sort()).toEqual(['selank', 'semax'])
  })

  it('reads frequency and cycle out of the reference wording', () => {
    expect(frequencyFrom({ frequency: 'Once weekly, subcutaneous, same day each week.' })).toBe('weekly')
    expect(frequencyFrom({ frequency: 'Twice weekly.' })).toBe('2xweek')
    expect(frequencyFrom({ frequency: 'Nightly before bed.' })).toBe('nightly')
    expect(frequencyFrom({})).toBe('daily')
    expect(cycleFrom({ cycle: '8wk on, 4wk off.' })).toEqual({ cycleOnDays: 56, cycleOffDays: 28 })
    expect(cycleFrom({ cycle: 'Not cycled. Continuous therapy.' })).toEqual({ cycleOnDays: 0, cycleOffDays: 0 })
  })

  it('falls back to a labelled generic vial when the reference says nothing', () => {
    const s = wizardSuggestion({ id: 'ipamorelin' })
    expect(s.source).toBe('reference')
    expect(s.recon).toEqual(DEFAULT_RECON)
  })
})

describe('turning a wizard entry into a peptide', () => {
  it('produces something the schedule engine can run', () => {
    const s = wizardSuggestion({ id: 'bpc157' })
    const p = toPeptide({ ...s, slot: 'PM' }, TODAY)
    expect(p.id).toBe('bpc157')
    expect(p.startDate).toBe(TODAY)
    expect(p.slot).toBe('PM')
    expect(p.ladder).toEqual(s.ladder)
    expect(toMg(p.ladder.floor, p.ladder.unit)).toBeGreaterThan(0)
    expect(dosesInWindow(p, TODAY, 28)).toBeGreaterThan(0)
  })

  it('leaves a no-dose compound blank rather than inventing one', () => {
    const s = wizardSuggestion({ id: 'humanin' })
    expect(s.source).toBe('none')
    const p = toPeptide(s, TODAY)
    expect(p.ladder.floor).toBe(0)
    expect(p.ladder.ceiling).toBe(0)
    // and it stays out of the due list until the user fills it in
    expect(dosesInWindow(p, TODAY, 28)).toBe(0)
  })

  it('keeps the intranasal flag and weekday picks', () => {
    const p = toPeptide(wizardSuggestion({ id: 'semax' }), TODAY)
    expect(p.intranasalCapable).toBe(true)
    const te = toPeptide(wizardSuggestion({ id: TEST_E_ID }), TODAY)
    expect(te.scheduleWeekdays).toEqual([1, 4])
    expect(te.alwaysSeparate).toBe(true)
  })
})
