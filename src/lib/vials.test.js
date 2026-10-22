// The open-vial model: what is left, when to ask, which vial is next, fridge
// life and waste, the forecast and the order-by date, the weekly count, and the
// move from the old stock data. All pure; the store and native tests are in
// stockTracking.test.js.
import { describe, it, expect } from 'vitest'
import {
  remainingMg, drawnMg, hasOpenVial, vialChangeNeeded, vialAskAfter, nextDose, dosesLeft,
  expiryOf, fridgeLifeDays, orderLeadDays, FRIDGE_DEFAULT_DAYS, ORDER_LEAD_DEFAULT_DAYS,
  sealedBatches, nextSealedBatch, changeVial, wasteInYear, vialHistory, recipeFor,
  forecastRunOut, stockRows, orderDot, orderWords, orderNotices, dosesLeftWords, stockAlertsFor,
  countRows, countDue, isOutOfStock, isTracked, migrateVialModel, withRemaining,
} from './vials'
import { addDaysStr } from './schedule'

const T = '2026-10-07'
const day = (o) => addDaysStr(T, o)

const reta = (over = {}) => ({
  id: 'reta', name: 'Retatrutide', frequency: 'daily', startDate: '2026-10-01', startedOn: '2026-10-01', slot: 'AM', route: 'SubQ',
  cycleOnDays: 0, cycleOffDays: 0, ladder: { floor: 3, step: 0, ceiling: 3, intervalWeeks: 1, unit: 'mg' },
  recon: { vialMg: 10, bacMl: 2, expiryDays: 28 }, ...over,
})
const tState = { level: 0, levelStartDate: '2026-10-01' }
const open = (over = {}) => ({
  id: 'o1', peptideId: 'reta', batchId: 'b1', vialMg: 10, volumeMl: 2, reconstitutedAt: '2026-10-05', activatedAt: '2026-10-05T00:00:00.000Z',
  adjustments: [], expiryAskedOn: null, ...over,
})
const log = (date, mg, over = {}) => ({
  id: `l-${date}-${mg}`, peptideId: 'reta', date, doseValue: mg, unit: 'mg', loggedAt: `${date}T08:00:00.000Z`, ...over,
})
const batch = (over = {}) => ({ id: 'b1', peptideId: 'reta', vialMg: 10, qtyOnHand: 1, addedAt: '2026-09-01T00:00:00.000Z', ...over })

// ------------------------------------------------------------- what is left

describe('what is left in the open vial', () => {
  it('is the total less every dose logged since it was opened, whatever their sizes', () => {
    const logs = [log('2026-10-05', 3), log('2026-10-06', 500, { unit: 'mcg' }), log('2026-10-07', 2)]
    expect(drawnMg(open(), logs)).toBe(5.5)
    expect(remainingMg(open(), logs)).toBe(4.5)
  })

  it('ignores doses from before it was opened, from other compounds, and ones that never moved stock', () => {
    const logs = [
      log('2026-10-04', 3), // the vial before this one
      log('2026-10-06', 1, { peptideId: 'bpc157' }),
      log('2026-10-06', 2, { movedStock: false }),
      log('2026-10-06', 1),
    ]
    expect(remainingMg(open(), logs)).toBe(9)
  })

  it('counts what someone else drew, and a hand adjustment either way', () => {
    const draws = [{ peptideId: 'reta', doseMg: 0.5, at: '2026-10-06T10:00:00.000Z' }]
    expect(remainingMg(open(), [log('2026-10-06', 1)], draws)).toBe(8.5)
    expect(remainingMg(open({ adjustments: [{ mg: -0.4 }, { mg: 0.1 }] }), [])).toBe(9.7)
  })

  it('puts the drug back when a dose is deleted from the log, with nothing else to keep in step', () => {
    const logs = [log('2026-10-05', 3), log('2026-10-06', 3)]
    expect(remainingMg(open(), logs)).toBe(4)
    expect(remainingMg(open(), logs.slice(0, 1))).toBe(7)
  })

  it('goes negative for an overfilled vial instead of stopping at zero', () => {
    expect(remainingMg(open(), [log('2026-10-05', 6), log('2026-10-06', 5)])).toBe(-1)
  })

  it('is zero when nothing is open', () => {
    expect(remainingMg({ peptideId: 'reta', finished: true }, [log('2026-10-05', 3)])).toBe(0)
    expect(hasOpenVial(null)).toBe(false)
  })
})

// --------------------------------------------------- when to ask for a new one

describe('the question after a log', () => {
  const need = (logs, over = {}) => vialChangeNeeded({
    peptide: reta(), tState, open: open(), vials: [batch()], doseLogs: logs, todayStr: T, ...over,
  })

  it('is not asked while what is left still covers the next dose', () => {
    // 10 - 3 - 3 = 4, and the next dose is 3
    expect(need([log('2026-10-05', 3), log('2026-10-06', 3)]).needed).toBe(false)
  })

  it('is asked on the log that leaves less than the next dose', () => {
    // 10 - 9 = 1 < 3
    const r = need([log('2026-10-05', 3), log('2026-10-06', 3), log('2026-10-07', 3)])
    expect(r).toMatchObject({ needed: true, remainingMg: 1, nextMg: 3 })
  })

  it('is not asked when what is left is exactly the next dose', () => {
    expect(need([log('2026-10-05', 3.5), log('2026-10-06', 3.5)]).needed).toBe(false) // 3 left, next 3
    expect(need([log('2026-10-05', 3.5), log('2026-10-06', 3.6)]).needed).toBe(true) // 2.9 left
  })

  it('is asked when the vial is empty or over', () => {
    expect(need([log('2026-10-05', 10)]).needed).toBe(true)
    expect(need([log('2026-10-05', 12)]).needed).toBe(true)
  })

  it('measures against the next dose after a step up, not the one just taken', () => {
    const stepping = reta({ ladder: { floor: 3, step: 1, ceiling: 5, intervalWeeks: 1, unit: 'mg' } })
    // 3.5 left. The step up lands on 8 Oct, so the next dose is 4 and the vial cannot cover it
    const logs = [log('2026-10-05', 3), log('2026-10-06', 3.5)]
    expect(nextDose(stepping, tState, { afterStr: T }).mg).toBe(4)
    expect(need(logs, { peptide: stepping }).needed).toBe(true)
    expect(need(logs).needed).toBe(false) // flat at 3 mg it still covers one
  })

  it('looks through a rest to the next dose that is owed', () => {
    const cycled = reta({ cycleOnDays: 7, cycleOffDays: 7 })
    // on 1 to 7 Oct, off 8 to 14 Oct: the next dose is on the 15th, still 3 mg
    expect(nextDose(cycled, tState, { afterStr: T })).toMatchObject({ date: '2026-10-15', mg: 3 })
  })

  it('can be worked out ahead of the log, for the Watch', () => {
    const base = { peptide: reta(), tState, open: open(), doseLogs: [log('2026-10-05', 3), log('2026-10-06', 3)], todayStr: T }
    expect(vialAskAfter({ ...base, doseMg: 3 })).toBe(true) // 4 - 3 = 1 < 3
    expect(vialAskAfter({ ...base, doseMg: 0.5 })).toBe(false) // 3.5 left covers 3
  })

  it('asks "start a new one" when the compound is tracked but nothing is open, and stays quiet once it is out', () => {
    const none = { peptideId: 'reta', finished: true }
    expect(vialChangeNeeded({ peptide: reta(), tState, open: none, vials: [batch()], doseLogs: [], todayStr: T })).toMatchObject({ needed: true, noOpen: true })
    expect(vialChangeNeeded({ peptide: reta(), tState, open: none, vials: [], doseLogs: [], todayStr: T })).toMatchObject({ needed: false, out: true })
  })

  it('never asks about a compound that was never tracked', () => {
    expect(vialChangeNeeded({ peptide: reta(), tState, open: undefined, vials: [], doseLogs: [], todayStr: T }).needed).toBe(false)
    expect(vialChangeNeeded({ peptide: reta(), tState, open: { unlinked: true }, vials: [batch()], doseLogs: [], todayStr: T }).needed).toBe(false)
  })

  it('counts doses left at the size of the next dose', () => {
    expect(dosesLeft(open(), reta(), tState, { doseLogs: [log('2026-10-05', 3)], todayStr: T })).toBe(2) // 7 / 3
    expect(dosesLeftWords({ untracked: false, open: open(), dosesLeft: 1 })).toBe('1 dose left')
    expect(dosesLeftWords({ untracked: false, open: open(), dosesLeft: 4 })).toBe('4 doses left')
  })
})

// ------------------------------------------------------------ changing a vial

describe('which vial is next, and what changing does', () => {
  const shelf = [
    batch({ id: 'newer', addedAt: '2026-09-20T00:00:00.000Z', vialMg: 20, qtyOnHand: 1 }),
    batch({ id: 'older', addedAt: '2026-08-01T00:00:00.000Z', vialMg: 10, qtyOnHand: 2 }),
    batch({ id: 'empty', addedAt: '2026-07-01T00:00:00.000Z', qtyOnHand: 0 }),
  ]

  it('takes the oldest batch with something in it, whatever order they are stored in', () => {
    expect(sealedBatches(shelf, 'reta').map((b) => b.id)).toEqual(['older', 'newer'])
    expect(nextSealedBatch(shelf, 'reta').id).toBe('older')
  })

  it('falls back to the order they were stored in when no date is known', () => {
    const undated = [batch({ id: 'a', addedAt: null }), batch({ id: 'b', addedAt: null })]
    expect(nextSealedBatch(undated, 'reta').id).toBe('a')
  })

  it('finishes the open vial, opens one from the oldest batch and takes one off the shelf', () => {
    const r = changeVial({ peptide: reta(), open: open(), vials: shelf, doseLogs: [log('2026-10-05', 9)], reason: 'empty', now: new Date('2026-10-07T09:00:00Z'), todayStr: T })
    expect(r.finished).toMatchObject({ peptideId: 'reta', reason: 'empty', vialMg: 10, remainingMg: 1, overfillMg: 0, wasteMg: 0 })
    expect(r.opened).toBe(true)
    expect(r.open).toMatchObject({ batchId: 'older', vialMg: 10, needsMixing: true, reconstitutedAt: null })
    expect(r.vials.find((v) => v.id === 'older').qtyOnHand).toBe(1)
    expect(r.vials.find((v) => v.id === 'newer').qtyOnHand).toBe(1)
    expect(r.outOfStock).toBe(false)
  })

  it('a vial that needs no mixing is dated from the day it was opened', () => {
    const oil = reta({ preparation: 'premixed', recon: { vialMg: 2500, bacMl: 10, expiryDays: 0 } })
    const r = changeVial({ peptide: oil, open: null, vials: [batch({ vialMg: 2500 })], doseLogs: [], reason: 'open', todayStr: T })
    expect(r.open).toMatchObject({ reconstitutedAt: T, needsMixing: false })
  })

  it('records an overfill when a vial gave more than its label', () => {
    const logs = [log('2026-10-05', 6), log('2026-10-06', 4.4)]
    const r = changeVial({ peptide: reta(), open: open(), vials: shelf, doseLogs: logs, reason: 'empty', todayStr: T })
    expect(r.finished.overfillMg).toBe(0.4)
    expect(r.finished.remainingMg).toBe(-0.4)
  })

  it('is out of stock when nothing is sealed: finished, nothing open', () => {
    const r = changeVial({ peptide: reta(), open: open(), vials: [], doseLogs: [log('2026-10-05', 9)], reason: 'empty', todayStr: T })
    expect(r.opened).toBe(false)
    expect(r.outOfStock).toBe(true)
    expect(r.open).toMatchObject({ finished: true, vialMg: null })
    expect(isOutOfStock(r.open, [], 'reta')).toBe(true)
    expect(isTracked(r.open, [], 'reta')).toBe(true)
  })

  it('finishing by hand with a vial on the shelf is not out of stock, and opens nothing', () => {
    const r = changeVial({ peptide: reta(), open: open(), vials: shelf, doseLogs: [], reason: 'manual', openNext: false, todayStr: T })
    expect(r.opened).toBe(false)
    expect(r.outOfStock).toBe(false)
    expect(r.finished.leftoverMg).toBe(10)
    expect(isOutOfStock(r.open, shelf, 'reta')).toBe(false)
  })

  it('shows the recipe from the compound\'s own reconstitution data', () => {
    // 10 mg in 2 mL is 5 mg/mL: a 3 mg dose is 0.6 mL, 60 units
    expect(recipeFor(reta(), tState, 10, T)).toMatchObject({ mix: true, waterMl: 2, text: 'Add 2 mL bacteriostatic water. 60 units = 3 mg' })
    // a bigger vial in the same water changes the units, not the sentence
    expect(recipeFor(reta(), tState, 20, T).text).toBe('Add 2 mL bacteriostatic water. 30 units = 3 mg')
    expect(recipeFor(reta({ route: 'Nasal' }), tState, 10, T).mix).toBe(false)
  })
})

// -------------------------------------------------------- fridge life and waste

describe('fridge life', () => {
  it('is 28 days unless the compound says otherwise, and 0 means no clock', () => {
    expect(fridgeLifeDays({})).toBe(FRIDGE_DEFAULT_DAYS)
    expect(fridgeLifeDays({ recon: { expiryDays: 14 } })).toBe(14)
    expect(fridgeLifeDays({ recon: { expiryDays: 0 } })).toBe(0)
    expect(fridgeLifeDays({ playbook: { fridgeLifeDays: 21 } })).toBe(21)
  })

  it('says Use by from three days before, asks on the day, and only once', () => {
    const o = open({ reconstitutedAt: '2026-10-01' }) // 28 days: goes off on 29 Oct
    const at = (d, v = o) => expiryOf(v, reta(), d)
    expect(at('2026-10-25')).toMatchObject({ expiresOn: '2026-10-29', daysLeft: 4, showUseBy: false, askNow: false })
    expect(at('2026-10-26')).toMatchObject({ daysLeft: 3, showUseBy: true, useBy: 'Use by 29 Oct', askNow: false })
    expect(at('2026-10-29')).toMatchObject({ daysLeft: 0, expired: true, askNow: true })
    expect(at('2026-10-31').askNow).toBe(true) // the app was not opened on the day
    expect(at('2026-10-29', open({ reconstitutedAt: '2026-10-01', expiryAskedOn: '2026-10-29' })).askNow).toBe(false)
  })

  it('has no clock for a vial that is not mixed yet, or one that keeps', () => {
    expect(expiryOf(open({ reconstitutedAt: null }), reta(), T)).toBe(null)
    expect(expiryOf(open(), reta({ recon: { vialMg: 10, bacMl: 2, expiryDays: 0 } }), T)).toBe(null)
  })

  it('records what was left in a vial thrown out as waste, and totals it for the year', () => {
    const logs = [log('2026-10-06', 3), log('2026-10-07', 2.5)]
    const r = changeVial({ peptide: reta(), open: open(), vials: [batch()], doseLogs: logs, reason: 'expired', now: new Date('2026-11-02T09:00:00Z'), todayStr: '2026-11-02' })
    expect(r.finished).toMatchObject({ reason: 'expired', wasteMg: 4.5, leftoverMg: 0 })
    const earlier = { id: 'f0', peptideId: 'reta', date: '2026-02-01', wasteMg: 1.25 }
    const lastYear = { id: 'f1', peptideId: 'reta', date: '2025-12-30', wasteMg: 9 }
    expect(wasteInYear([earlier, lastYear, r.finished], 2026)).toEqual({ mg: 5.75, vials: 2 })
    expect(vialHistory([earlier, r.finished, lastYear], 'reta').map((f) => f.id)).toEqual([r.finished.id, 'f0', 'f1'])
  })

  it('does not count an emptied vial as waste', () => {
    const r = changeVial({ peptide: reta(), open: open(), vials: [], doseLogs: [log('2026-10-06', 10)], reason: 'empty', todayStr: T })
    expect(r.finished.wasteMg).toBe(0)
  })
})

// ------------------------------------------------------------------ forecasting

describe('the forecast follows the real schedule', () => {
  // the same walk, written out by hand
  const byHand = (p, total, todayStr, pauses = []) => {
    let left = total
    for (let i = 0; i < 400; i++) {
      const d = addDaysStr(todayStr, i)
      const info = p.cycleOnDays ? ((i + ((new Date(d) - new Date(p.startDate)) / 86400000 - i)) % (p.cycleOnDays + p.cycleOffDays)) : 0
      const on = !p.cycleOnDays || info < p.cycleOnDays
      const paused = pauses.some((x) => d >= x.startedOn && d <= x.endsOn)
      if (!on || paused) continue
      const dose = p.doseOn(d)
      if (left + 1e-9 < dose) return d
      left -= dose
    }
    return null
  }

  it('steps the dose up on the days the ladder says, so a titrating compound runs out sooner', () => {
    const p = reta({ ladder: { floor: 1, step: 1, ceiling: 3, intervalWeeks: 1, unit: 'mg' } })
    const flat = reta({ ladder: { floor: 1, step: 0, ceiling: 1, intervalWeeks: 1, unit: 'mg' } })
    const start = { level: 0, levelStartDate: T }
    const fc = forecastRunOut({ peptide: p, tState: start, totalMg: 20, todayStr: T })
    const dosesAt = (d) => { const n = Math.floor((new Date(d) - new Date(T)) / 86400000); return Math.min(3, 1 + Math.floor(n / 7)) }
    expect(fc.runOutDate).toBe(byHand({ ...p, doseOn: dosesAt }, 20, T))
    // 1 mg for 7 days (7 mg), then 2 mg: 13 mg is left for six more doses, and day 13 needs 2 with 1 left
    expect(fc.runOutDate).toBe(addDaysStr(T, 13))
    expect(forecastRunOut({ peptide: flat, tState: start, totalMg: 20, todayStr: T }).runOutDate).toBe(addDaysStr(T, 20))
  })

  it('draws nothing in a rest, so the date lands later by the days off', () => {
    const flat = (over) => reta({ ladder: { floor: 1, step: 0, ceiling: 1, intervalWeeks: 1, unit: 'mg' }, startDate: T, startedOn: T, ...over })
    const start = { level: 0, levelStartDate: T }
    // 5 on, 5 off: 7 mg is 5 doses, then 2 more after the rest, and the 8th is owed on day 12
    const cycled = forecastRunOut({ peptide: flat({ cycleOnDays: 5, cycleOffDays: 5 }), tState: start, totalMg: 7, todayStr: T })
    expect(cycled.runOutDate).toBe(addDaysStr(T, 12))
    expect(cycled).toMatchObject({ consumingDays: 7, offCycleDays: 5 })
    expect(forecastRunOut({ peptide: flat(), tState: start, totalMg: 7, todayStr: T }).runOutDate).toBe(addDaysStr(T, 7))
  })

  it('draws nothing while paused, so the date lands later by the days paused', () => {
    const flat = reta({ ladder: { floor: 1, step: 0, ceiling: 1, intervalWeeks: 1, unit: 'mg' } })
    const start = { level: 0, levelStartDate: '2026-10-01' }
    const pauses = [{ id: 'p', startedOn: day(2), endsOn: day(3), peptideIds: ['reta'] }]
    expect(forecastRunOut({ peptide: flat, tState: start, totalMg: 5, todayStr: T }).runOutDate).toBe(day(5))
    const paused = forecastRunOut({ peptide: flat, tState: start, totalMg: 5, todayStr: T, pauses })
    expect(paused.runOutDate).toBe(day(7))
    expect(paused.pausedDays).toBe(2)
  })

  it('counts someone else\'s share of the vial every day', () => {
    const flat = reta({ ladder: { floor: 1, step: 0, ceiling: 1, intervalWeeks: 1, unit: 'mg' } })
    const alone = forecastRunOut({ peptide: flat, tState, totalMg: 10, todayStr: T })
    const shared = forecastRunOut({ peptide: flat, tState, totalMg: 10, todayStr: T, sharedPerDay: 0.5 })
    expect(shared.runOutDate < alone.runOutDate).toBe(true)
  })

  it('has no date for a compound with nothing owed', () => {
    expect(forecastRunOut({ peptide: reta({ ladder: { floor: 0, step: 0, ceiling: 0, intervalWeeks: 1, unit: 'mg' } }), tState, totalMg: 10, todayStr: T }).none).toBe(true)
  })
})

describe('the order-by date', () => {
  const rowsFor = (over = {}) => stockRows({
    peptides: [reta(over.peptide)], titration: { reta: tState }, vials: [batch({ qtyOnHand: 1 })],
    openVials: { reta: open() }, doseLogs: [log('2026-10-05', 3)], todayStr: T, ...over.rest,
  })

  it('is the run-out date less the delivery time, 14 days unless set', () => {
    // 7 mg in the open vial and 10 sealed: 17 mg is 5 doses of 3 mg, the 6th is owed on the 12th
    const [r] = rowsFor()
    expect(r.runOutDate).toBe(day(5))
    expect(r.leadDays).toBe(ORDER_LEAD_DEFAULT_DAYS)
    expect(r.orderBy).toBe(day(5 - 14))
    expect(rowsFor({ peptide: { orderLeadDays: 30 } })[0].orderBy).toBe(day(5 - 30))
    expect(orderLeadDays({})).toBe(14)
    expect(orderLeadDays({ orderLeadDays: 0 })).toBe(0)
  })

  it('says it the way the notification does', () => {
    expect(orderWords({ name: 'Retatrutide', orderBy: '2026-11-03', runOutDate: '2026-11-17', out: false }))
      .toBe('Order Retatrutide by 3 Nov, runs out 17 Nov')
    expect(orderWords({ name: 'Retatrutide', out: true })).toBe('Order Retatrutide now, none left')
  })

  it('sorts by order date, with out of stock first and anything without a date last', () => {
    const rows = stockRows({
      peptides: [reta({ id: 'a', name: 'A' }), reta({ id: 'b', name: 'B' }), reta({ id: 'c', name: 'C' }), reta({ id: 'd', name: 'D', frequency: 'daily', ladder: { floor: 0, step: 0, ceiling: 0, intervalWeeks: 1, unit: 'mg' } })],
      titration: { a: tState, b: tState, c: tState, d: tState },
      vials: [batch({ id: 'a1', peptideId: 'a', qtyOnHand: 5 }), batch({ id: 'b1', peptideId: 'b', qtyOnHand: 1 }), batch({ id: 'd1', peptideId: 'd', qtyOnHand: 1 })],
      openVials: { c: { peptideId: 'c', finished: true } }, doseLogs: [], todayStr: T,
    })
    expect(rows.map((r) => r.peptideId)).toEqual(['c', 'b', 'a', 'd'])
    expect(rows[0].out).toBe(true)
  })

  it('puts the dot on More when something is to be ordered within a week, or is out', () => {
    // runs out on day 5, delivery takes 14 days: the order date has passed
    expect(orderDot(rowsFor())).toBe(true)
    // plenty: 20 sealed vials
    const plenty = stockRows({ peptides: [reta()], titration: { reta: tState }, vials: [batch({ qtyOnHand: 20 })], openVials: { reta: open() }, doseLogs: [], todayStr: T })
    expect(orderDot(plenty)).toBe(false)
    // exactly a week away
    const edge = stockRows({ peptides: [reta({ orderLeadDays: 0 })], titration: { reta: tState }, vials: [], openVials: { reta: open({ vialMg: 3 * 7 }) }, doseLogs: [], todayStr: T })
    expect(edge[0].orderByDays).toBe(7)
    expect(orderDot(edge)).toBe(true)
  })

  it('says nothing about a compound that was never tracked or has no dose set', () => {
    const rows = stockRows({ peptides: [reta()], titration: { reta: tState }, vials: [], openVials: {}, doseLogs: [], todayStr: T })
    expect(rows[0]).toMatchObject({ untracked: true, orderBy: null })
    expect(orderDot(rows)).toBe(false)
  })

  it('raises the out-of-stock state for the Home bell too', () => {
    const rows = stockRows({ peptides: [reta()], titration: { reta: tState }, vials: [], openVials: { reta: { peptideId: 'reta', finished: true } }, doseLogs: [], todayStr: T })
    expect(stockAlertsFor(rows)).toEqual([{ id: 'out-reta', kind: 'stock', text: 'Retatrutide is out of stock. Order it now.' }])
  })

  it('says Use by on the bell from three days out, and past its fridge life after', () => {
    const near = stockRows({ peptides: [reta()], titration: { reta: tState }, vials: [batch({ qtyOnHand: 9 })], openVials: { reta: open({ reconstitutedAt: day(-25) }) }, doseLogs: [], todayStr: T })
    expect(stockAlertsFor(near)[0]).toMatchObject({ kind: 'expiring', text: `Retatrutide: Use by ${new Date(day(3) + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.` })
    const gone = stockRows({ peptides: [reta()], titration: { reta: tState }, vials: [batch({ qtyOnHand: 9 })], openVials: { reta: open({ reconstitutedAt: day(-30) }) }, doseLogs: [], todayStr: T })
    expect(stockAlertsFor(gone)[0]).toMatchObject({ kind: 'expired' })
  })
})

describe('the one notification per order date', () => {
  const NOW = new Date(2026, 9, 7, 8, 0, 0) // 7 Oct 2026, 08:00 local
  const row = (over = {}) => ({ peptideId: 'reta', name: 'Retatrutide', setUp: true, untracked: false, out: false, runOutDate: '2026-10-24', orderBy: '2026-10-10', ...over })

  it('is scheduled for the morning of the order date', () => {
    const [n] = orderNotices([row()], { now: NOW })
    expect(n).toMatchObject({ id: 'pepito.sched.order.reta.2026-10-10', body: 'Order Retatrutide by 10 Oct, runs out 24 Oct', immediate: false })
    expect(new Date(n.fireAt).getDate()).toBe(10)
    expect(new Date(n.fireAt).getHours()).toBe(9)
  })

  it('goes at once when the date has already come, then not again', () => {
    const late = row({ orderBy: '2026-10-05' })
    const [n] = orderNotices([late], { now: NOW })
    expect(n).toMatchObject({ immediate: true, id: 'pepito.stock.order.reta.2026-10-05' })
    expect(orderNotices([late], { now: NOW, sent: { reta: '2026-10-05' } })).toEqual([])
  })

  it('is not repeated, but a date that moves is a new notice', () => {
    expect(orderNotices([row({ orderBy: '2026-10-05' })], { now: NOW, sent: { reta: '2026-10-05' } })).toEqual([])
    expect(orderNotices([row({ orderBy: '2026-10-06' })], { now: NOW, sent: { reta: '2026-10-05' } })).toHaveLength(1)
  })

  it('"Remind me in 3 days" delivers once on that day and not before', () => {
    const late = row({ orderBy: '2026-10-05' })
    const snoozed = { reta: '2026-10-10' }
    const [n] = orderNotices([late], { now: NOW, sent: { reta: '2026-10-05' }, snoozed })
    expect(n).toMatchObject({ immediate: false, id: 'pepito.sched.order.reta.snooze.2026-10-10' })
    // once that morning has passed it is not sent again
    expect(orderNotices([late], { now: new Date(2026, 9, 10, 10, 0), sent: { reta: '2026-10-05' }, snoozed })).toEqual([])
  })

  it('out of stock is one notice, now', () => {
    const [n] = orderNotices([row({ out: true, orderBy: null, runOutDate: null })], { now: NOW })
    expect(n).toMatchObject({ title: 'Out of stock', body: 'Order Retatrutide now, none left', immediate: true })
    expect(orderNotices([row({ out: true, orderBy: null })], { now: NOW, sent: { reta: 'out' } })).toEqual([])
  })

  it('leaves out what is not tracked or has no date', () => {
    expect(orderNotices([row({ untracked: true }), row({ orderBy: null, runOutDate: null })], { now: NOW })).toEqual([])
  })
})

// ---------------------------------------------------------------- the count

describe('the weekly count', () => {
  it('lists only batches with something expected, grouped by compound', () => {
    const rows = countRows([
      batch({ id: 'a', qtyOnHand: 2 }), batch({ id: 'b', qtyOnHand: 0 }), batch({ id: 'c', peptideId: 'bpc', qtyOnHand: 1 }),
    ], [reta(), { id: 'bpc', name: 'BPC-157' }])
    expect(rows.map((g) => g.name)).toEqual(['BPC-157', 'Retatrutide'])
    expect(rows[1].batches).toEqual([expect.objectContaining({ id: 'a', expected: 2 }), expect.objectContaining({ id: 'b', expected: 0 })])
  })

  it('is due from Sunday evening until it is done or skipped', () => {
    const sunday6pm = new Date(2026, 9, 11, 18, 0) // Sunday 11 Oct 2026
    expect(new Date(2026, 9, 11).getDay()).toBe(0)
    expect(countDue({ now: new Date(2026, 9, 11, 17, 59), last: '2026-10-04' })).toBe(false)
    expect(countDue({ now: sunday6pm, last: '2026-10-04' })).toBe(true)
    expect(countDue({ now: new Date(2026, 9, 14, 9, 0), last: '2026-10-04' })).toBe(true) // still due on Wednesday
    expect(countDue({ now: new Date(2026, 9, 14, 9, 0), last: '2026-10-11' })).toBe(false)
    expect(countDue({ now: sunday6pm, last: null, on: false })).toBe(false)
  })
})

// ---------------------------------------------------------------- migration

describe('moving the old stock data onto the open-vial model', () => {
  const NOW = new Date('2026-10-07T09:00:00.000Z')
  const migrate = (o) => migrateVialModel({ todayStr: T, now: NOW, ...o })

  it('keeps the open vial and what the screen said was left in it, exactly', () => {
    const old = { remainingMg: 4.2, vialMg: 10, batchId: 'b1', lot: 'L1', reconstitutedAt: '2026-10-01', activatedAt: '2026-10-01T00:00:00.000Z' }
    const logs = [log('2026-10-02', 1), log('2026-10-03', 1), log('2026-10-04', 1)]
    const r = migrate({ peptides: [reta()], openVials: { reta: old }, vials: [batch({ qtyOnHand: 2 })], doseLogs: logs })
    const o = r.openVials.reta
    expect(o).toMatchObject({ vialMg: 10, batchId: 'b1', lot: 'L1', reconstitutedAt: '2026-10-01', activatedAt: '2026-10-01T00:00:00.000Z' })
    expect(remainingMg(o, logs)).toBeCloseTo(4.2, 6)
    expect(o.adjustments).toEqual([expect.objectContaining({ reason: 'migration', mg: expect.closeTo(-2.8, 6) })])
    // sealed stock is untouched
    expect(r.vials).toEqual([batch({ qtyOnHand: 2 })])
    expect(r.report[0]).toMatchObject({ peptideId: 'reta', action: 'kept as the open vial', mixedAt: '2026-10-01' })
  })

  it('needs no adjustment when the log already explains the figure', () => {
    const old = { remainingMg: 7, vialMg: 10, reconstitutedAt: '2026-10-01', activatedAt: '2026-10-01T00:00:00.000Z' }
    const logs = [log('2026-10-02', 3)]
    const r = migrate({ peptides: [reta()], openVials: { reta: old }, vials: [], doseLogs: logs })
    expect(r.openVials.reta.adjustments).toEqual([])
    expect(remainingMg(r.openVials.reta, logs)).toBe(7)
  })

  it('dates the mix from the first log against the vial when the mix day was never recorded, else today', () => {
    const noMix = { remainingMg: 10, vialMg: 10, activatedAt: '2026-10-02T00:00:00.000Z' }
    const withLog = migrate({ peptides: [reta()], openVials: { reta: noMix }, vials: [], doseLogs: [log('2026-10-03', 0.1)] })
    expect(withLog.openVials.reta.reconstitutedAt).toBe('2026-10-03')
    const noLog = migrate({ peptides: [reta()], openVials: { reta: { remainingMg: 10, vialMg: 10, activatedAt: null } }, vials: [], doseLogs: [] })
    expect(noLog.openVials.reta.reconstitutedAt).toBe(T)
    expect(noLog.openVials.reta.activatedAt).toBe(NOW.toISOString())
  })

  it('opens one vial from the newest batch when there was no clear open vial, and takes it off the shelf', () => {
    const shelf = [batch({ id: 'old', qtyOnHand: 1, vialMg: 10 }), batch({ id: 'new', qtyOnHand: 2, vialMg: 20 })]
    const r = migrate({ peptides: [reta()], openVials: { reta: { remainingMg: 0 } }, vials: shelf, doseLogs: [] })
    expect(r.openVials.reta).toMatchObject({ batchId: 'new', vialMg: 20 })
    expect(r.vials.find((v) => v.id === 'new').qtyOnHand).toBe(1)
    expect(r.vials.find((v) => v.id === 'old').qtyOnHand).toBe(1)
    expect(r.report[0].action).toBe('opened one vial from the newest batch')
  })

  it('leaves a finished vial finished, a stopped one stopped, and everything sealed as it was', () => {
    const peptides = [reta(), reta({ id: 'bpc', name: 'BPC-157' }), reta({ id: 'sema', name: 'Sema' })]
    const shelf = [batch(), batch({ id: 'x', peptideId: 'bpc', qtyOnHand: 3 })]
    const r = migrate({
      peptides, vials: shelf, doseLogs: [],
      openVials: { reta: { finished: true, remainingMg: 0 }, bpc: { unlinked: true, remainingMg: 0 } },
    })
    expect(r.openVials.reta).toMatchObject({ finished: true })
    expect(r.openVials.bpc).toMatchObject({ unlinked: true })
    expect(r.vials).toEqual(shelf)
    expect(r.report.map((x) => x.action)).toEqual(['finished, nothing open', 'not tracked, left as it was', 'nothing open, nothing sealed'])
  })

  it('does not lose an open record for a compound that is no longer in the protocol', () => {
    const r = migrate({ peptides: [], openVials: { gone: { remainingMg: 3, vialMg: 10 } }, vials: [], doseLogs: [] })
    expect(r.openVials.gone).toEqual({ remainingMg: 3, vialMg: 10 })
  })

  it('hands older readers the same records with the figure worked out', () => {
    const view = withRemaining({ reta: open() }, [log('2026-10-06', 3)], [])
    expect(view.reta.remainingMg).toBe(7)
    expect(withRemaining({ reta: { finished: true } }, [], []).reta.remainingMg).toBe(0)
  })
})
