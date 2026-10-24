// The snapshot fixture the Swift tests decode (ios/PepitoKit/Tests/PepitoCoreTests/Fixtures).
// It is written by buildSnapshot itself, so the Swift model is always tested
// against what the web layer really writes. Run with UPDATE_FIXTURES=1 to
// rewrite it after a deliberate change to the snapshot.
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { buildSnapshot } from './snapshot'
import { buildSchedule } from './notifySchedule'

const FIXTURE = new URL('../../ios/PepitoKit/Tests/PepitoCoreTests/Fixtures/snapshot.json', import.meta.url)
// The iPhone's dose reminders for the same state and moment. The Swift tests
// check that the Watch, scheduling from the snapshot alone, plans exactly these.
const REMINDERS = new URL('../../ios/PepitoKit/Tests/PepitoCoreTests/Fixtures/reminders.json', import.meta.url)
const pad = (n) => String(n).padStart(2, '0')
const wall = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const pep = (over) => ({
  frequency: 'daily', startDate: '2026-01-01', slot: 'AM', route: 'SubQ',
  ladder: { floor: 1, step: 0, ceiling: 1, intervalWeeks: 4, unit: 'mg' }, recon: { vialMg: 10, bacMl: 2 },
  ...over,
})
export const fixtureState = {
  peptides: [
    pep({ id: 'reta', name: 'Retatrutide', shortName: 'Reta', frequency: 'weekly', scheduleWeekdays: [2], slot: 'PM', ladder: { floor: 3, step: 0, ceiling: 3, intervalWeeks: 4, unit: 'mg' }, recon: { vialMg: 20, bacMl: 2 } }),
    pep({ id: 'bpc157', name: 'BPC-157', ladder: { floor: 250, step: 0, ceiling: 250, intervalWeeks: 4, unit: 'mcg' }, recon: { vialMg: 5, bacMl: 2 } }),
    pep({ id: 'tb500', name: 'TB-500', ladder: { floor: 2, step: 0, ceiling: 2, intervalWeeks: 4, unit: 'mg' } }),
    pep({ id: 'semax', name: 'Semax', route: 'Nasal', ladder: { floor: 1, step: 0, ceiling: 1, intervalWeeks: 4, unit: 'spray' } }),
    // 10 days on, 15 off from 1 Sep: resting on 20 Oct, back on cycle on 21 Oct
    pep({ id: 'epithalon', name: 'Epithalon', startDate: '2026-09-01', startedOn: '2026-09-01', cycleOnDays: 10, cycleOffDays: 15,
      ladder: { floor: 5, step: 0, ceiling: 5, intervalWeeks: 4, unit: 'mg' }, recon: { vialMg: 50, bacMl: 2 } }),
  ],
  titration: {},
  doseLogs: [{ peptideId: 'semax', date: '2026-10-20' }],
  pushes: [], pauses: [], skips: [],
  supplements: [{ id: 'fish', name: 'Fish oil', form: 'capsule', dose: '2 capsules', slot: 'AM' }],
  supplementLogs: [],
  saunaSessions: [{ id: 's1', date: '2026-10-19', start: '19:00', lengthMin: 25, tempC: 65 }],
  asNeededItems: [
    { id: 'an-dex', name: 'Dexamphetamine', short: 'Dex', slot: 'AM', units: ['mg'], step: 2.5 },
    { id: 'an-restavit', name: 'Restavit', short: 'Restavit', slot: 'PM', units: ['tablets', 'mg'], step: 1 },
  ],
  asNeededLogs: [
    { id: 'l1', itemId: 'an-restavit', name: 'Restavit', amount: 1, unit: 'tablets', at: '2026-10-18T11:00:00.000Z' },
    { id: 'l2', itemId: 'an-dex', name: 'Dexamphetamine', amount: 10, unit: 'mg', at: '2026-10-19T08:00:00.000Z' },
  ],
  sleepSettings: { lastBedtime: '22:30', lastWake: '07:00' },
  saunaSettings: { weeklyTarget: 4, usualLengthMin: null, usualTempC: null },
  saunaTimer: { startedAt: 1792483200000, targetMin: 20, tempC: 65, rounds: 2, source: 'watch' },
  healthSettings: { maxHR: null },
  notificationSettings: { amTime: '07:00', pmTime: '20:00' },
}
const verdictOf = (a, b) => ([a, b].sort().join('|') === 'bpc157|tb500' ? 'MIX' : null)
const NOW = new Date('2026-10-20T08:00:00')

describe('Swift snapshot fixture', () => {
  it('matches what buildSnapshot writes', () => {
    const snap = buildSnapshot(fixtureState, {
      now: NOW,
      verdictOf,
      readiness: { score: 72, band: 'moderate', bandLabel: 'Moderate', status: 'ok', asOf: '2026-10-20T06:30:00.000Z', rhr: 54, rhrDelta: -1.5, hrv: 61, hrvDelta: 4, sleepMin: 431 },
      maxHR: 182,
    })
    // the generation time is the only thing that is not a function of the inputs
    snap.generatedAt = '2026-10-20T08:00:00.000Z'
    const json = `${JSON.stringify(snap, null, 2)}\n`
    if (process.env.UPDATE_FIXTURES) writeFileSync(FIXTURE, json)
    expect(readFileSync(FIXTURE, 'utf8')).toBe(json)
  })
})

describe('Swift reminder parity fixture', () => {
  it('matches the dose reminders, nudges, restart reminders and sleep prompts buildSchedule plans for the iPhone', () => {
    const list = buildSchedule(fixtureState, { now: NOW, verdictOf, watchReady: false })
      .filter((n) => /\.(dose|nudge|restart|evening|morning)\./.test(n.id))
      .map(({ fireAt, ...rest }) => ({ ...rest, fireLocal: wall(fireAt) }))
    const json = `${JSON.stringify(list, null, 2)}\n`
    if (process.env.UPDATE_FIXTURES) writeFileSync(REMINDERS, json)
    expect(readFileSync(REMINDERS, 'utf8')).toBe(json)
  })
})
