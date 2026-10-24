// Stock tracking through the store: the question after a log, the answers, the
// recipe, undo, fridge life, the weekly count, the move from the old data, and
// the same question arriving from a notification or the Watch.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { remainingMg, stockRows } from './vials'
import { addDaysStr } from './schedule'
import { buildSnapshot } from '../native/snapshot'
import { stockNotices, vialChangeNotice } from '../native/stockNotices'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}
let useStore
let todayStr
beforeAll(async () => {
  const mod = await import('../store/useStore')
  useStore = mod.default
  todayStr = mod.todayStr
})

const reta = (over = {}) => ({
  id: 'reta', name: 'Retatrutide', frequency: 'daily', startDate: '2026-01-01', startedOn: '2026-01-01', slot: 'AM', route: 'SubQ',
  cycleOnDays: 0, cycleOffDays: 0, ladder: { floor: 3, step: 0, ceiling: 3, intervalWeeks: 4, unit: 'mg' },
  recon: { vialMg: 10, bacMl: 2, expiryDays: 28 }, ...over,
})
const hourAgo = () => new Date(Date.now() - 3600000).toISOString()
const open = (over = {}) => ({
  id: 'o1', peptideId: 'reta', batchId: 'b1', vialMg: 10, volumeMl: 2, reconstitutedAt: todayStr(), activatedAt: hourAgo(),
  adjustments: [], expiryAskedOn: null, ...over,
})
const batch = (over = {}) => ({
  id: 'b1', peptideId: 'reta', vialMg: 10, qtyOnHand: 2, qtyPurchased: 2, addedAt: '2026-09-01T00:00:00.000Z', drawProfiles: [], ...over,
})

const setup = (over = {}) => useStore.setState({
  peptides: [reta()], titration: { reta: { level: 0, levelStartDate: '2026-01-01' } }, doseLogs: [], injectionRecords: [],
  skips: [], pushes: [], pauses: [], sharedDraws: [], finishedVials: [], stockAdjustments: [],
  vials: [batch()], openVials: { reta: open() }, vialPrompts: [], lastVialChange: null,
  notificationSettings: { ...useStore.getState().notificationSettings, stock: true, countCheck: true },
  nativeState: { processedActionIds: [], stockAlerted: [], lastWatchSync: null, ordersSent: {}, orderSnoozed: {}, countCheckOn: null },
  ...over,
})
beforeEach(() => setup())

const left = () => {
  const s = useStore.getState()
  return remainingMg(s.openVials.reta, s.doseLogs, s.sharedDraws)
}
const logOne = () => useStore.getState().logDose('reta')

describe('logging counts the open vial down, and asks at the right dose', () => {
  it('works out what is left from the log, with nothing stored to keep in step', () => {
    logOne(); logOne()
    expect(left()).toBe(4)
    expect('remainingMg' in useStore.getState().openVials.reta).toBe(false)
  })

  it('asks nothing while the next dose is still covered', () => {
    logOne(); logOne() // 4 left, next 3
    expect(useStore.getState().vialPrompts).toEqual([])
  })

  it('asks on the log that leaves less than the next dose, once', () => {
    logOne(); logOne(); logOne() // 1 left
    const p = useStore.getState().vialPrompts
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ kind: 'change', peptideId: 'reta', noOpen: false, remainingMg: 1, nextMg: 3 })
    // a second log of something else does not stack a second question for it
    useStore.getState()._queueVialPrompt('reta')
    expect(useStore.getState().vialPrompts).toHaveLength(1)
  })

  it('takes the question back when the dose that caused it is undone', () => {
    logOne(); logOne(); logOne()
    const id = useStore.getState().doseLogs[2].id
    useStore.getState().undoLog(id)
    expect(useStore.getState().vialPrompts).toEqual([])
    expect(left()).toBe(4)
  })

  it('is not asked for a backfilled dose', () => {
    useStore.getState().backfillDose('reta', todayStr())
    useStore.getState().backfillDose('reta', todayStr())
    expect(useStore.getState().vialPrompts).toEqual([])
  })

  it('an edited dose moves what is left by the difference', () => {
    logOne()
    useStore.getState().editLog(useStore.getState().doseLogs[0].id, { doseValue: 2 })
    expect(left()).toBe(8)
  })

  it('a dose taken from a shared draw comes out of the same vial', () => {
    setup({ vials: [batch({ drawProfiles: [{ id: 'dp1', label: 'Sam', doseMg: 2, frequency: 'daily' }] })] })
    const id = useStore.getState().logSharedDraw('reta', 'dp1')
    expect(left()).toBe(8)
    useStore.getState().undoSharedDraw(id)
    expect(left()).toBe(10)
  })
})

describe('answering', () => {
  const emptyIt = () => { logOne(); logOne(); logOne() }

  it('Yes finishes the vial, opens the oldest batch and shows the recipe', () => {
    setup({ vials: [batch({ id: 'new', addedAt: '2026-09-20T00:00:00.000Z', vialMg: 20, qtyOnHand: 1 }), batch({ id: 'old', addedAt: '2026-08-01T00:00:00.000Z', qtyOnHand: 1 })] })
    emptyIt()
    const [pr] = useStore.getState().vialPrompts
    const change = useStore.getState().answerVialPrompt(pr.id, 'yes')
    const s = useStore.getState()
    expect(s.vialPrompts).toEqual([])
    expect(s.finishedVials).toHaveLength(1)
    expect(s.finishedVials[0]).toMatchObject({ peptideId: 'reta', reason: 'empty', remainingMg: 1 })
    expect(s.openVials.reta).toMatchObject({ batchId: 'old', vialMg: 10, reconstitutedAt: null, needsMixing: true })
    expect(s.vials.find((v) => v.id === 'old').qtyOnHand).toBe(0)
    expect(change.recipe.text).toBe('Add 2 mL bacteriostatic water. 60 units = 3 mg')
    expect(left()).toBe(10) // the doses before it stay with the vial that is finished
  })

  it('shows the recipe for the vial that was opened, so a 20 mg changes the units', () => {
    setup({ vials: [batch({ vialMg: 20, qtyOnHand: 1 })] })
    emptyIt()
    useStore.getState().answerVialPrompt(useStore.getState().vialPrompts[0].id, 'yes')
    expect(useStore.getState().lastVialChange.recipe.text).toBe('Add 2 mL bacteriostatic water. 30 units = 3 mg')
    expect(useStore.getState().peptides[0].recon.vialMg).toBe(20)
  })

  it('Mixed sets the mixed date to now and clears the prompt', () => {
    emptyIt()
    useStore.getState().answerVialPrompt(useStore.getState().vialPrompts[0].id, 'yes')
    useStore.getState().markVialMixed('reta')
    expect(useStore.getState().openVials.reta).toMatchObject({ reconstitutedAt: todayStr(), needsMixing: false })
    expect(useStore.getState().lastVialChange.needsMixing).toBe(false)
  })

  it('can be undone: the old vial is open again, the batch is back on the shelf, no finished record', () => {
    emptyIt()
    const before = useStore.getState().openVials.reta
    useStore.getState().answerVialPrompt(useStore.getState().vialPrompts[0].id, 'yes')
    expect(useStore.getState().undoVialChange()).toBe(true)
    const s = useStore.getState()
    expect(s.openVials.reta).toEqual(before)
    expect(s.vials[0].qtyOnHand).toBe(2)
    expect(s.finishedVials).toEqual([])
    expect(s.lastVialChange).toBe(null)
    expect(s.vialPrompts).toEqual([]) // not asked again straight away; the next log asks as usual
    logOne()
    expect(useStore.getState().vialPrompts).toHaveLength(1)
  })

  it('Still some left keeps the vial open and asks again at the next log, then records the overfill', () => {
    emptyIt() // 1 left
    useStore.getState().answerVialPrompt(useStore.getState().vialPrompts[0].id, 'still')
    expect(useStore.getState().vialPrompts).toEqual([])
    expect(useStore.getState().openVials.reta.stillSomeAt).toHaveLength(1)
    expect(useStore.getState().finishedVials).toEqual([])
    logOne() // 3 more out of a vial with 1 left: -2
    expect(useStore.getState().vialPrompts).toHaveLength(1)
    expect(left()).toBe(-2)
    useStore.getState().answerVialPrompt(useStore.getState().vialPrompts[0].id, 'yes')
    expect(useStore.getState().finishedVials[0]).toMatchObject({ overfillMg: 2, remainingMg: -2 })
  })

  it('with no sealed vial left, Yes marks it finished and raises the out of stock state', () => {
    setup({ vials: [] })
    emptyIt()
    const change = useStore.getState().answerVialPrompt(useStore.getState().vialPrompts[0].id, 'yes')
    expect(change).toMatchObject({ outOfStock: true, opened: false })
    const s = useStore.getState()
    expect(s.openVials.reta).toMatchObject({ finished: true, vialMg: null })
    const row = stockRows({ ...s, vials: s.vials, todayStr: todayStr() })[0]
    expect(row.out).toBe(true)
    // more logs do not keep asking
    logOne()
    expect(useStore.getState().vialPrompts).toEqual([])
  })

  it('ordering more afterwards ends the out of stock state and the next log asks for a vial', () => {
    setup({ vials: [] })
    emptyIt()
    useStore.getState().answerVialPrompt(useStore.getState().vialPrompts[0].id, 'yes')
    useStore.getState().addVial('reta', { vialMg: 10, qtyOnHand: 2, qtyPurchased: 2 })
    const s = useStore.getState()
    expect(stockRows({ ...s, todayStr: todayStr() })[0].out).toBe(false)
    logOne()
    expect(useStore.getState().vialPrompts[0]).toMatchObject({ kind: 'change', noOpen: true })
  })

  it('Mark vial finished by hand does not open another and is not out of stock while sealed vials remain', () => {
    useStore.getState().finishVial('reta')
    const s = useStore.getState()
    expect(s.openVials.reta.finished).toBe(true)
    expect(s.vials[0].qtyOnHand).toBe(2)
    expect(s.finishedVials[0]).toMatchObject({ reason: 'manual', leftoverMg: 10 })
    expect(stockRows({ ...s, todayStr: todayStr() })[0].out).toBe(false)
  })

  it('Adjust sets what is left by hand and keeps the reason', () => {
    logOne()
    useStore.getState().adjustOpenVial('reta', 5.5, 'adjusted')
    expect(left()).toBe(5.5)
    expect(useStore.getState().openVials.reta.adjustments.at(-1)).toMatchObject({ mg: -1.5, reason: 'adjusted' })
  })
})

describe('fridge life', () => {
  const old = () => addDaysStr(todayStr(), -28)

  it('asks once on the day, and a yes records what was left as waste', () => {
    setup({ openVials: { reta: open({ reconstitutedAt: old() }) } })
    logOne() // 7 left
    const asked = useStore.getState().checkVialExpiry()
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ kind: 'expired', peptideId: 'reta' })
    expect(useStore.getState().checkVialExpiry()).toEqual([]) // not stacked
    useStore.getState().answerVialPrompt('vp-expired-reta', 'yes')
    expect(useStore.getState().finishedVials[0]).toMatchObject({ reason: 'expired', wasteMg: 7 })
  })

  it('Not yet is not asked again', () => {
    setup({ openVials: { reta: open({ reconstitutedAt: old() }) } })
    useStore.getState().checkVialExpiry()
    useStore.getState().answerVialPrompt('vp-expired-reta', 'notyet')
    expect(useStore.getState().openVials.reta.expiryAskedOn).toBe(todayStr())
    expect(useStore.getState().checkVialExpiry()).toEqual([])
  })

  it('is not asked while the vial is within its life, or for one that keeps', () => {
    expect(useStore.getState().checkVialExpiry()).toEqual([])
    setup({ peptides: [reta({ recon: { vialMg: 10, bacMl: 2, expiryDays: 0 } })], openVials: { reta: open({ reconstitutedAt: old() }) } })
    expect(useStore.getState().checkVialExpiry()).toEqual([])
  })
})

describe('the weekly count', () => {
  it('writes only what differs, each with the reason, and marks the week done', () => {
    setup({ vials: [batch({ id: 'a', qtyOnHand: 3 }), batch({ id: 'b', qtyOnHand: 2 })] })
    const written = useStore.getState().applyCountCheck({ a: 2, b: 2 })
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ batchId: 'a', from: 3, to: 2, delta: -1, reason: 'count check' })
    const s = useStore.getState()
    expect(s.vials.map((v) => v.qtyOnHand)).toEqual([2, 2])
    expect(s.stockAdjustments.filter((x) => x.reason === 'count check')).toHaveLength(1)
    expect(s.nativeState.countCheckOn).toBe(todayStr())
  })

  it('All correct changes nothing and still marks the week done; skipping only marks it', () => {
    setup({ vials: [batch({ qtyOnHand: 3 })] })
    expect(useStore.getState().applyCountCheck({ b1: 3 })).toEqual([])
    expect(useStore.getState().vials[0].qtyOnHand).toBe(3)
    setup({ vials: [batch({ qtyOnHand: 3 })] })
    useStore.getState().skipCountCheck()
    expect(useStore.getState().nativeState.countCheckOn).toBe(todayStr())
    expect(useStore.getState().stockAdjustments).toEqual([])
  })

  it('an order arriving and a hand change are both kept with their reason', () => {
    const id = useStore.getState().addVial('reta', { vialMg: 10, qtyOnHand: 4, qtyPurchased: 4, lot: 'L9' })
    useStore.getState().adjustVialQty(id, -1, 'adjusted')
    const log = useStore.getState().stockAdjustments
    expect(log.map((x) => x.reason)).toEqual(['order arrived', 'adjusted'])
    expect(useStore.getState().vials.find((v) => v.id === id)).toMatchObject({ qtyOnHand: 3, qtyPurchased: 4 })
    expect(useStore.getState().vials.find((v) => v.id === id).addedAt).toBeTruthy()
  })
})

describe('from a notification or the Watch', () => {
  const at = () => new Date().toISOString()

  it('a Watch tick that empties the vial raises the question on the phone, and the Watch answer applies it', () => {
    setup({ openVials: { reta: open({ vialMg: 4 }) } }) // 4 mg: one 3 mg dose leaves 1
    const date = todayStr()
    const result = useStore.getState().applyNativeActions([
      { id: 'a1', type: 'logDose', at: at(), source: 'watch', payload: { refId: 'reta', date } },
      { id: 'a2', type: 'vialChange', at: at(), source: 'watch', payload: { refId: 'reta', answer: 'yes', kind: 'change' } },
    ])
    expect(result.applied).toEqual(['a1', 'a2'])
    const s = useStore.getState()
    expect(s.finishedVials).toHaveLength(1)
    expect(s.openVials.reta.needsMixing).toBe(true)
    expect(s.vialPrompts).toEqual([])
  })

  it('Still some left from a notification keeps the vial and asks again at the next log', () => {
    setup({ openVials: { reta: open({ vialMg: 4 }) } })
    useStore.getState().applyNativeActions([
      { id: 'b1', type: 'logDose', at: at(), source: 'notification', payload: { refId: 'reta', date: todayStr() } },
      { id: 'b2', type: 'vialChange', at: at(), source: 'notification', payload: { refId: 'reta', answer: 'still', kind: 'change' } },
    ])
    expect(useStore.getState().finishedVials).toEqual([])
    expect(useStore.getState().vialPrompts).toEqual([])
    expect(useStore.getState().openVials.reta.stillSomeAt).toHaveLength(1)
  })

  it('an answer for a vial that no longer needs changing is applied to nothing', () => {
    useStore.getState().applyNativeActions([{ id: 'c1', type: 'vialChange', at: at(), source: 'watch', payload: { refId: 'reta', answer: 'yes', kind: 'change' } }])
    expect(useStore.getState().finishedVials).toEqual([])
    expect(useStore.getState().vials[0].qtyOnHand).toBe(2)
  })

  it('the same answer twice changes the vial once', () => {
    setup({ openVials: { reta: open({ vialMg: 4 }) } })
    const a = [
      { id: 'd1', type: 'logDose', at: at(), source: 'watch', payload: { refId: 'reta', date: todayStr() } },
      { id: 'd2', type: 'vialChange', at: at(), source: 'watch', payload: { refId: 'reta', answer: 'yes', kind: 'change' } },
    ]
    useStore.getState().applyNativeActions(a)
    useStore.getState().applyNativeActions(a)
    expect(useStore.getState().finishedVials).toHaveLength(1)
    expect(useStore.getState().vials[0].qtyOnHand).toBe(1)
  })

  it('Remind me in 3 days puts the order notice back three days out', () => {
    useStore.getState().applyNativeActions([{ id: 'e1', type: 'snoozeOrder', at: at(), source: 'notification', payload: { refId: 'reta' } }])
    expect(useStore.getState().nativeState.orderSnoozed.reta).toBe(addDaysStr(todayStr(), 3))
  })
})

describe('what the snapshot and the notifications say', () => {
  const NOW = new Date()
  const state = () => ({ ...useStore.getState() })

  it('flags the item whose log would leave the vial about empty, for the Watch to ask after its tick', () => {
    setup({ openVials: { reta: open({ vialMg: 4 }) } })
    const snap = buildSnapshot(state(), { now: NOW })
    expect(snap.days[0].items.find((i) => i.refId === 'reta').vialAsk).toBe(true)
    setup()
    expect(buildSnapshot(state(), { now: NOW }).days[0].items.find((i) => i.refId === 'reta').vialAsk).toBe(false)
  })

  it('lists who is out of stock', () => {
    setup({ vials: [], openVials: { reta: { peptideId: 'reta', finished: true, adjustments: [] } } })
    expect(buildSnapshot(state(), { now: NOW }).stock.outOfStock).toEqual(['Retatrutide'])
  })

  it('plans the order notice for the morning of the order date, and the Watch gets the same ids', () => {
    // 10 mg open, nothing else: 3 doses, the 4th is owed in 3 days, delivery takes 14
    setup({ vials: [], openVials: { reta: open({ vialMg: 10 }) }, peptides: [reta({ orderLeadDays: 1 })] })
    const notices = stockNotices(state(), { now: NOW }).notices
    const order = notices.find((n) => n.category === 'ORDER')
    expect(order).toBeTruthy()
    expect(order.payload).toMatchObject({ kind: 'order', refId: 'reta' })
    const snap = buildSnapshot(state(), { now: NOW })
    expect(snap.stock.notices.map((n) => n.id)).toEqual(notices.filter((n) => !n.immediate).map((n) => n.id))
  })

  it('plans the Sunday count only while there is something sealed to count, and not once it is done', () => {
    const sundayMorning = new Date(2026, 9, 11, 9, 0)
    const counts = (over) => {
      setup(over)
      return stockNotices(state(), { now: sundayMorning }).notices.filter((n) => n.category === 'COUNT')
    }
    expect(counts({})).toHaveLength(1)
    expect(counts({})[0].id).toBe('pepito.sched.count.2026-10-11')
    expect(counts({ vials: [] })).toEqual([])
    expect(counts({ nativeState: { ...state().nativeState, countCheckOn: '2026-10-11' } })).toEqual([])
    expect(counts({ notificationSettings: { ...state().notificationSettings, countCheck: false } })).toEqual([])
  })

  it('asks about a vial at the end of its fridge life on that morning', () => {
    const morning = new Date(); morning.setHours(6, 0, 0, 0)
    const goesOff = addDaysStr(todayStr(), 2)
    setup({ openVials: { reta: open({ reconstitutedAt: addDaysStr(goesOff, -28) }) } })
    const n = stockNotices(state(), { now: morning }).notices.find((x) => x.category === 'VIAL_EXPIRED')
    expect(n.id).toBe(`pepito.sched.expired.reta.${goesOff}`)
    expect(n.body).toMatch(/Has this vial been thrown out\? Start a new one\?$/)
  })

  it('the question after a log goes out with the same words, as an immediate notice', () => {
    const n = vialChangeNotice({ kind: 'change', peptideId: 'reta', name: 'Retatrutide' }, { now: NOW })
    expect(n).toMatchObject({ category: 'VIAL_CHANGE', immediate: true, body: 'This vial should be about empty. Start a new one?' })
    expect(vialChangeNotice({ kind: 'expired', peptideId: 'reta', name: 'Retatrutide' }, { now: NOW }).category).toBe('VIAL_EXPIRED')
  })

  it('order, fridge life and count notices obey the stock switch', () => {
    setup({ vials: [], openVials: { reta: open({ vialMg: 10 }) }, notificationSettings: { ...state().notificationSettings, stock: false } })
    expect(stockNotices(state(), { now: NOW }).notices.filter((n) => n.category === 'ORDER')).toEqual([])
  })
})

describe('moving a v24 save onto the open-vial model', () => {
  const migrate = (persisted, from = 24) => useStore.persist.getOptions().migrate(persisted, from)
  const t = () => todayStr()

  it('keeps what was left in the open vial, opens the shelf in the order it arrived, and loses nothing', () => {
    const save = {
      peptides: [reta()], titration: { reta: { level: 0, levelStartDate: '2026-01-01' } },
      doseLogs: [
        { id: 'l1', peptideId: 'reta', date: '2026-10-02', doseValue: 3, unit: 'mg', loggedAt: '2026-10-02T08:00:00.000Z' },
        { id: 'l2', peptideId: 'reta', date: '2026-10-03', doseValue: 3, unit: 'mg', loggedAt: '2026-10-03T08:00:00.000Z' },
      ],
      openVials: { reta: { remainingMg: 5, vialMg: 10, batchId: 'vial-1700000000000-abc', reconstitutedAt: '2026-10-01', activatedAt: '2026-10-01T00:00:00.000Z', lot: 'L1' } },
      vials: [{ id: 'vial-1700000000000-abc', peptideId: 'reta', vialMg: 10, qtyOnHand: 2, qtyPurchased: 3, usdPerVial: 90, lot: 'L1' }, { id: 'vial-reta', peptideId: 'reta', vialMg: 20, qtyOnHand: 1 }],
      finishedVials: [{ id: 'f0', peptideId: 'reta', vialMg: 10, date: '2026-09-15' }],
      sharedDraws: [{ id: 'sd1', peptideId: 'reta', doseMg: 1, at: '2026-10-03T10:00:00.000Z' }],
    }
    const out = migrate(save)
    const o = out.openVials.reta
    expect(remainingMg(o, out.doseLogs, [])).toBeCloseTo(5, 6)
    expect(o).toMatchObject({ vialMg: 10, reconstitutedAt: '2026-10-01', lot: 'L1' })
    // the sealed shelf, the finished vial, the shared draw and the logs come through as they were
    expect(out.vials.map((v) => v.qtyOnHand)).toEqual([2, 1])
    expect(out.vials[0].addedAt).toBe(new Date(1700000000000).toISOString())
    expect(out.vials[1].addedAt).toBe(null)
    expect(out.finishedVials).toEqual(save.finishedVials)
    expect(out.sharedDraws).toEqual(save.sharedDraws)
    expect(out.doseLogs).toEqual(save.doseLogs)
    expect(out.stockAdjustments).toEqual([])
    expect(out.stockMigration.rows[0]).toMatchObject({ peptideId: 'reta', action: 'kept as the open vial' })
    // run once: a save already at the current version is left alone
    expect(migrate(out, 26)).toBe(out)
  })

  it('goes through the older migrations first, so a v6 save arrives in the same place', () => {
    const out = migrate({ peptides: [reta()], doseLogs: [], openVials: { reta: { remainingMg: 10, reconstitutedAt: null } }, vials: [], titration: {} }, 6)
    expect(out.openVials.reta).toMatchObject({ vialMg: 10, adjustments: [] })
    expect(out.stockMigration).toBeTruthy()
  })

  it('a fresh install starts with one full vial open per compound and two sealed', async () => {
    const { seedOpenVials, seedVials, seedPeptides } = await import('../data/seed')
    const peps = seedPeptides(t())
    const opens = seedOpenVials(peps, t(), new Date().toISOString())
    const shelf = seedVials(peps)
    for (const p of peps) {
      expect(opens[p.id]).toMatchObject({ peptideId: p.id, vialMg: p.recon.vialMg, adjustments: [] })
      expect(remainingMg(opens[p.id], [])).toBe(p.recon.vialMg)
    }
    expect(shelf.every((v) => v.qtyOnHand === 2)).toBe(true)
  })
})
