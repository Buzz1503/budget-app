/**
 * Supplies stay out of peptide stock.
 *
 * The one promise in the brief that a pure-function test cannot make: that the
 * *store actions* leave vials, doses, open vials and every other slice exactly
 * as they were. Each action is run against the real store and the rest of the
 * state is compared before and after.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import useStore from '../store/useStore'
import { specKey, seedGear } from './gear'

const OTHER_SLICES = [
  'peptides', 'vials', 'openVials', 'doseLogs', 'titration', 'doseEvents', 'skips',
  'pushes', 'pauses', 'finishedVials', 'sharedDraws', 'runs', 'supplements',
  'supplementLogs', 'measurements', 'symptomLogs', 'injectionRecords', 'reactions', 'bloods',
]
const snapshot = () => {
  const s = useStore.getState()
  return JSON.stringify(Object.fromEntries(OTHER_SLICES.map((k) => [k, s[k]])))
}

describe('supplies actions', () => {
  beforeEach(() => {
    useStore.getState().resetAll()
  })

  it('starts from the seeded inventory', () => {
    expect(useStore.getState().gearItems).toHaveLength(seedGear().length)
    expect(useStore.getState().gearSwaps).toEqual([])
  })

  it('leaves every peptide, dose and stock slice untouched through a whole session of use', () => {
    const before = snapshot()
    const st = () => useStore.getState()

    const { item } = st().addGearItem({
      category: 'Pen needles', status: 'stock', gauge: '33G', lengthMm: 5, qty: 2, unit: 'box',
    })
    st().updateGearItem(item.id, { qty: 3, brand: 'NovoFine' })
    st().confirmGearItem('gear-seed-10')
    st().addGearOption('syringe_needle_gauge', '28')

    const use = st().gearItems.find((i) => i.status === 'in_use' && i.gauge === '25G')
    const spare = st().gearItems.find((i) => i.status === 'stock' && specKey(i) === specKey(use))
    st().finishGearItem(use.id, { promoteId: spare.id, date: '2026-03-01' })
    const swap = st().gearSwaps[0]
    st().removeGearSwap(swap.id)
    st().deleteGearItem(item.id)

    expect(snapshot()).toBe(before)
  })

  it('addGearItem tops up an existing row instead of adding one when asked', () => {
    const st = () => useStore.getState()
    const target = st().gearItems.find((i) => i.status === 'stock' && i.gauge === '27G')
    const n = st().gearItems.length
    const r = st().addGearItem({ category: 'Syringe needles', status: 'stock', gauge: '27G', lengthMm: 13, qty: 3, unit: 'box' }, { mergeInto: target.id })
    expect(r.merged).toBe(true)
    expect(st().gearItems).toHaveLength(n)
    expect(st().gearItems.find((i) => i.id === target.id).qty).toBe(target.qty + 3)
  })

  it('addGearItem adds a second row when no merge is asked for', () => {
    const st = () => useStore.getState()
    const n = st().gearItems.length
    st().addGearItem({ category: 'Syringe needles', status: 'stock', gauge: '27G', lengthMm: 13, qty: 1, unit: 'box', brand: 'Other brand' })
    expect(st().gearItems).toHaveLength(n + 1)
  })

  it('finishing with a spare swaps, decrements, and records the date', () => {
    const st = () => useStore.getState()
    const use = st().gearItems.find((i) => i.status === 'in_use' && i.gauge === '27G')
    const spare = st().gearItems.find((i) => i.status === 'stock' && i.gauge === '27G')
    expect(spare.qty).toBe(2)
    const r = st().finishGearItem(use.id, { promoteId: spare.id, date: '2026-02-02' })
    expect(r.ok).toBe(true)
    expect(st().gearItems.find((i) => i.id === spare.id).qty).toBe(1)
    expect(st().gearItems.find((i) => i.id === use.id)).toBeUndefined()
    expect(st().gearSwaps).toHaveLength(1)
    expect(st().gearSwaps[0].date).toBe('2026-02-02')
  })

  it('finishing with nothing to swap in clears the slot and still records it', () => {
    const st = () => useStore.getState()
    const use = st().gearItems.find((i) => i.status === 'in_use' && i.gauge === '29G')
    const r = st().finishGearItem(use.id, { date: '2026-02-02' })
    expect(r.outcome).toBe('cleared')
    expect(st().gearItems.find((i) => i.id === use.id)).toBeUndefined()
    expect(st().gearSwaps[0].outcome).toBe('cleared')
  })

  it('undoing a finish puts back both the items and the history', () => {
    const st = () => useStore.getState()
    const use = st().gearItems.find((i) => i.status === 'in_use' && i.gauge === '27G')
    const spare = st().gearItems.find((i) => i.status === 'stock' && i.gauge === '27G')
    const before = JSON.stringify([st().gearItems, st().gearSwaps])
    st().finishGearItem(use.id, { promoteId: spare.id, date: '2026-02-02' })
    st().runUndo()
    expect(JSON.stringify([st().gearItems, st().gearSwaps])).toBe(before)
  })

  it('editing an item clears its confirm-quantity flag; confirming does too', () => {
    const st = () => useStore.getState()
    const flagged = st().gearItems.filter((i) => i.verify)
    expect(flagged).toHaveLength(3)
    st().updateGearItem(flagged[0].id, { note: 'checked' })
    st().confirmGearItem(flagged[1].id)
    expect(st().gearItems.filter((i) => i.verify)).toHaveLength(1)
  })

  it('refuses a swap onto a spare that is not there, and changes nothing', () => {
    const st = () => useStore.getState()
    const use = st().gearItems.find((i) => i.status === 'in_use' && i.gauge === '27G')
    const before = JSON.stringify([st().gearItems, st().gearSwaps])
    const r = st().finishGearItem(use.id, { promoteId: 'not-a-spare', date: '2026-02-02' })
    expect(r.ok).toBe(false)
    expect(JSON.stringify([st().gearItems, st().gearSwaps])).toBe(before)
  })
})
