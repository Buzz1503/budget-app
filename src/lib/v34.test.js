import { describe, it, expect } from 'vitest'
import { anecdotalDose, doseWords, NO_DOSE_REASON } from './anecdotalDose'
import { anecdotalWeeklyMg, stockRunway } from './runway'
import { REFERENCE_COMPOUNDS } from './reference'
import { durationWords } from './stock'

const shelf = (peptideId, vialMg, qtyOnHand) => [{ id: 'v', peptideId, vialMg, qtyOnHand, qtyPurchased: qtyOnHand }]
const T = '2026-09-22'

// ------------------------------------------------------ reading the anecdote

describe('reading a dose out of the reference prose', () => {
  it('takes the maintenance dose over the step it titrates through', () => {
    // "0.25 mg weekly x4wk, 0.5 x4wk, 1.0 x4wk, 1.7 x4wk, 2.4 mg maintenance"
    // — 0.25 is where semaglutide starts, not what a vial gets used up at
    const a = anecdotalDose('semaglutide')
    expect(a.dose).toBe(2.4)
    expect(a.maintenance).toBe(true)
  })

  it('reaches a range in a later sentence', () => {
    // tirzepatide's range is in sentence two, which the strict parser never sees
    expect(doseWords(anecdotalDose('tirzepatide'))).toBe('10–15 mg')
  })

  it('accepts a single stated figure, not only a range', () => {
    expect(anecdotalDose('hexarelin').dose).toBe(100)
    expect(anecdotalDose('hexarelin').unit).toBe('mcg')
    expect(anecdotalDose('ara290').dose).toBe(4)
  })

  it('reads past a clause about another route to the injectable one', () => {
    // "Trials used up to 1 mg daily oral; community injectable 300 mcg"
    const a = anecdotalDose('aod9604')
    expect(a.unit).toBe('mcg')
    expect(a.dose).toBe(300)
  })

  it('keeps a figure given for IV/IM, because IM is a route this app injects', () => {
    expect(anecdotalDose('glutathione').dose).toBe(600)
  })
})

describe('what it refuses to read', () => {
  it('a number quoted only to be disowned is not a dose', () => {
    // "Community figures around 200-500 mcg exist without basis."
    const a = anecdotalDose('pe2228')
    expect(a.dose).toBe(null)
    expect(a.reason).toBe('unstated')
  })

  it('an oral-only compound gives no injectable dose', () => {
    // 5-Amino-1MQ: "predominantly ORAL, 50-150 mg per day"
    expect(anecdotalDose('amino1mq').dose).toBe(null)
  })

  it('a withheld compound stays withheld', () => {
    const a = anecdotalDose('dermorphin')
    expect(a.dose).toBe(null)
    expect(a.reason).toBe('withheld')
  })

  it('a blend has no single figure, and says so', () => {
    expect(anecdotalDose('glow').reason).toBe('blend')
  })

  it('IU and millilitres are not milligrams, and are not guessed at', () => {
    expect(anecdotalDose('hcg').reason).toBe('unconvertible')
    expect(anecdotalDose('cerebrolysin').reason).toBe('unconvertible')
  })

  it('every refusal has a sentence to print', () => {
    for (const r of ['withheld', 'blend', 'unconvertible', 'unstated', 'unknown']) {
      expect(NO_DOSE_REASON[r].length).toBeGreaterThan(10)
    }
  })

  it('never returns a dose of zero or a negative one', () => {
    for (const c of REFERENCE_COMPOUNDS) {
      const a = anecdotalDose(c.id)
      if (a.dose != null) expect(a.dose).toBeGreaterThan(0)
    }
  })
})

describe('the protocol this app ships wins over re-reading the prose', () => {
  it('uses the seeded ladder for a seeded compound', () => {
    const a = anecdotalDose('retatrutide')
    expect(a.fromSeed).toBe(true)
    expect(a.lo).toBe(0.5)
    expect(a.hi).toBe(2)
  })

  it('and carries the seed\'s own frequency and cycle with it', () => {
    const a = anecdotalDose('semax')
    expect(a.fromSeed).toBe(true)
    expect(a.frequency).toBe('daily')
    expect(a.cycleOnDays).toBe(42)
    expect(a.cycleOffDays).toBe(14)
  })
})

// ------------------------------------------------------------ the burn rate

describe('the anecdotal burn rate', () => {
  it('multiplies the dose by how often the reference says it is taken', () => {
    // TB-500: 2 mg, twice weekly, not cycled
    const e = anecdotalWeeklyMg('tb500')
    expect(e.perDoseMg).toBe(2)
    expect(e.frequency).toBe('2xweek')
    expect(e.perWeekMg).toBe(4)
  })

  it('discounts the weeks a cycled compound is not being taken', () => {
    // Ipamorelin: 100 mcg daily = 0.7 mg/wk, on an 84/28 cycle = 0.75 duty
    const e = anecdotalWeeklyMg('ipamorelin')
    expect(e.cycle.cycleOnDays).toBe(84)
    expect(e.cycle.cycleOffDays).toBe(28)
    expect(e.perWeekMg).toBeCloseTo(0.7 * 0.75, 6)
  })

  it('a second person drawing on the same vials shortens it here too', () => {
    const alone = anecdotalWeeklyMg('tb500', [])
    const shared = anecdotalWeeklyMg('tb500', [
      { peptideId: 'tb500', drawProfiles: [{ id: 'p', doseMg: 2, frequency: '2xweek' }] },
    ])
    expect(shared.perWeekMg).toBe(alone.perWeekMg + 4)
  })

  it('is zero when there is no dose to multiply', () => {
    expect(anecdotalWeeklyMg('humanin').perWeekMg).toBe(0)
  })
})

// --------------------------------------------------------------- the runway

describe('a duration for every row on the shelf', () => {
  it('estimates one for a compound with no protocol at all', () => {
    // 3 x 10 mg = 30 mg at 4 mg a week
    const r = stockRunway({ peptideId: 'tb500', vials: shelf('tb500', 10, 3), todayStr: T })
    expect(r.basis).toBe('anecdotal')
    expect(r.days).toBe(Math.floor((30 / 4) * 7))
    expect(r.days).toBe(52)
    expect(r.words).toBe('~7 weeks')
    expect(r.doseWords).toBe('2–2.5 mg')
    expect(r.freqWords).toBe('2×/week')
  })

  it('scales with how much is on the shelf', () => {
    const one = stockRunway({ peptideId: 'tb500', vials: shelf('tb500', 10, 1), todayStr: T })
    const four = stockRunway({ peptideId: 'tb500', vials: shelf('tb500', 10, 4), todayStr: T })
    expect(four.days).toBeCloseTo(one.days * 4, -1)
  })

  it('reaches months and years, not just days', () => {
    const many = stockRunway({ peptideId: 'tb500', vials: shelf('tb500', 10, 60), todayStr: T })
    expect(many.words).toMatch(/year/)
    expect(durationWords(400)).toMatch(/month/)
    expect(durationWords(9)).toBe('9 days')
  })

  it('says plainly when there is no dose to measure against', () => {
    for (const [id, reason] of [['humanin', 'unstated'], ['glow', 'blend'], ['hcg', 'unconvertible'], ['dermorphin', 'withheld']]) {
      const r = stockRunway({ peptideId: id, vials: shelf(id, 10, 2), todayStr: T })
      expect(r.basis).toBe('none')
      expect(r.words).toBe(null)
      expect(r.reason).toBe(reason)
      expect(r.note).toBe(NO_DOSE_REASON[reason])
    }
  })

  it('an empty shelf reads as out, whatever the dose situation is', () => {
    const r = stockRunway({ peptideId: 'tb500', vials: shelf('tb500', 10, 0), todayStr: T })
    expect(r.out).toBe(true)
    expect(r.days).toBe(0)
  })
})

describe('your own protocol always wins over the anecdote', () => {
  const peptide = {
    id: 'tb500', name: 'TB-500', route: 'SubQ', startDate: T, frequency: 'weekly',
    cycleOnDays: 0, cycleOffDays: 0,
    ladder: { floor: 1, step: 1, intervalWeeks: 4, ceiling: 5, unit: 'mg' },
    recon: { vialMg: 10, bacMl: 2, expiryDays: 28 },
  }

  it('uses your dose, not the reference\'s', () => {
    const r = stockRunway({
      peptideId: 'tb500', peptide, tState: { level: 0 },
      openVial: { remainingMg: 0 }, vials: shelf('tb500', 10, 3), todayStr: T,
    })
    expect(r.basis).toBe('protocol')
    // 30 mg at 1 mg a week, not the reference's 4 mg a week
    expect(r.days).toBe(Math.floor(30 * 7))
    expect(r.note).toBe('From your protocol')
  })

  it('and carries a restock-by date, which an estimate never does', () => {
    const own = stockRunway({
      peptideId: 'tb500', peptide, tState: { level: 0 },
      openVial: { remainingMg: 0 }, vials: shelf('tb500', 10, 3), todayStr: T,
    })
    const guess = stockRunway({ peptideId: 'tb500', vials: shelf('tb500', 10, 3), todayStr: T })
    expect(own.restockByDate).toBeTruthy()
    // a date is a commitment, and an estimate at somebody else's dose isn't one
    expect(guess.restockByDate).toBe(null)
  })

  it('falls back to the anecdote when the protocol has no dose set yet', () => {
    const blank = { ...peptide, ladder: { ...peptide.ladder, floor: 0, ceiling: 0 } }
    const r = stockRunway({
      peptideId: 'tb500', peptide: blank, tState: { level: 0 },
      openVial: { remainingMg: 0 }, vials: shelf('tb500', 10, 3), todayStr: T,
    })
    expect(r.basis).toBe('anecdotal')
  })
})

describe('coverage across the whole catalogue', () => {
  it('every compound either gets a duration or says why it cannot', () => {
    let priced = 0
    for (const c of REFERENCE_COMPOUNDS) {
      const r = stockRunway({ peptideId: c.id, vials: shelf(c.id, 10, 2), todayStr: T })
      expect(['protocol', 'anecdotal', 'none']).toContain(r.basis)
      if (r.basis === 'none') expect(r.note.length).toBeGreaterThan(10)
      else { expect(r.words).toBeTruthy(); priced += 1 }
    }
    // a majority, and the rest are refusals the reference itself makes
    expect(priced).toBeGreaterThanOrEqual(45)
  })
})
