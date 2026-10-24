import { describe, it, expect } from 'vitest'
import { promptPlan, promptsFor, eveningLogged, soundsMissed, recordingMissing, SOUNDS_MISSED_LINE } from './prompts'
import { setupChecklist, needsCharge } from './setup'

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const local = (date: string, hhmm: string) => {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi)
}
const never = () => false

describe('evening and morning prompts', () => {
  it('evening 30 min before bedtime, morning at wake + 30, for seven days', () => {
    const p = promptPlan({ today: '2026-10-24', now: local('2026-10-24', '12:00'), bedtime: '22:30', wake: '06:45', eveningDone: never, morningDone: never })
    const ev = p.filter((x) => x.kind === 'evening')
    const mo = p.filter((x) => x.kind === 'morning')
    expect(ev).toHaveLength(7)
    expect(new Date(ev[0].fireAt).getTime()).toBe(local('2026-10-24', '22:00').getTime())
    expect(ev[0]).toMatchObject({ id: 'pepito.sched.evening.2026-10-24', category: 'EVENING', payload: { kind: 'evening', date: '2026-10-24' } })
    // this morning's has passed
    expect(mo[0].date).toBe('2026-10-25')
    expect(new Date(mo[0].fireAt).getTime()).toBe(local('2026-10-25', '07:15').getTime())
  })

  it('a bedtime after midnight fires early the next calendar day, filed under the evening', () => {
    const p = promptPlan({ today: '2026-10-24', now: local('2026-10-24', '12:00'), bedtime: '00:20', wake: '08:00', eveningDone: never, morningDone: never, settings: { morningPrompt: false } })
    expect(p[0].date).toBe('2026-10-24')
    expect(new Date(p[0].fireAt).getTime()).toBe(local('2026-10-24', '23:50').getTime())
    const late = promptPlan({ today: '2026-10-24', now: local('2026-10-24', '12:00'), bedtime: '01:00', eveningDone: never, morningDone: never, settings: { morningPrompt: false } })
    expect(new Date(late[0].fireAt).getTime()).toBe(local('2026-10-25', '00:30').getTime())
  })

  it('skipped once the evening is logged or the morning answered, and when switched off', () => {
    const p = promptPlan({ today: '2026-10-24', now: local('2026-10-24', '05:00'), bedtime: '22:30', wake: '07:00', eveningDone: (d) => d === '2026-10-24', morningDone: (d) => d === '2026-10-24' })
    expect(p.some((x) => x.id.endsWith('evening.2026-10-24'))).toBe(false)
    expect(p.some((x) => x.id.endsWith('morning.2026-10-24'))).toBe(false)
    expect(p.some((x) => x.id.endsWith('evening.2026-10-25'))).toBe(true)
    const off = promptPlan({ today: '2026-10-24', now: local('2026-10-24', '05:00'), eveningDone: never, morningDone: never, settings: { eveningPrompt: false, morningPrompt: false } })
    expect(off).toEqual([])
  })

  it('an evening counts as logged from a factor, drinks, or a sedative taken that evening (even after midnight)', () => {
    const items = [{ id: 'an-tem', name: 'Temazepam', short: 'Temazepam', slot: 'PM' as const, units: ['mg'], step: 5 }, { id: 'an-dex', name: 'Dex', short: 'Dex', slot: 'AM' as const, units: ['mg'], step: 2.5 }]
    expect(eveningLogged('2026-10-24', { habitLogs: { '2026-10-24': { stress: true } } }, localDate)).toBe(true)
    expect(eveningLogged('2026-10-24', { eveningDetails: { '2026-10-24': { drinks: 2 } } }, localDate)).toBe(true)
    const sedative = { id: 'l1', itemId: 'an-tem', name: 'Temazepam', amount: 10, unit: 'mg', at: local('2026-10-25', '00:40').toISOString() }
    expect(eveningLogged('2026-10-24', { asNeededLogs: [sedative], asNeededItems: items }, localDate)).toBe(true)
    const dex = { ...sedative, itemId: 'an-dex', at: local('2026-10-24', '20:00').toISOString() }
    expect(eveningLogged('2026-10-24', { asNeededLogs: [dex], asNeededItems: items }, localDate)).toBe(false)
  })

  it('promptsFor uses the last known bedtime when the planner has none', () => {
    const p = promptsFor({ sleepSettings: { lastBedtime: '23:00', morningPrompt: false } }, { today: '2026-10-24', now: local('2026-10-24', '12:00'), localDate })
    expect(new Date(p[0].fireAt).getTime()).toBe(local('2026-10-24', '22:30').getTime())
  })
})

describe('quiet checks', () => {
  it('Sleep sounds missed: on before last night, not running, nothing recorded', () => {
    const base = { enabled: true, onSince: '2026-10-20', today: '2026-10-24', running: false, recordedTonight: false }
    expect(soundsMissed(base)).toBe(true)
    expect(soundsMissed({ ...base, recordedTonight: true })).toBe(false)
    expect(soundsMissed({ ...base, running: true })).toBe(false)
    expect(soundsMissed({ ...base, onSince: '2026-10-24' })).toBe(false)
    expect(soundsMissed({ ...base, enabled: false })).toBe(false)
    expect(SOUNDS_MISSED_LINE).toBe("Sleep sounds didn't run last night. Check the automation.")
  })

  it('a night without a Watch recording is flagged only after the first one worked', () => {
    const base = { enabled: true, date: '2026-10-24', firstRecorded: '2026-10-10', hasSleep: true, hasRecording: false }
    expect(recordingMissing(base)).toBe(true)
    expect(recordingMissing({ ...base, firstRecorded: null })).toBe(false)
    expect(recordingMissing({ ...base, date: '2026-10-09' })).toBe(false)
    expect(recordingMissing({ ...base, hasSleep: false })).toBe(false)
    expect(recordingMissing({ ...base, hasRecording: true })).toBe(false)
  })
})

describe('sleep setup checklist', () => {
  const none = { sleepNights: 0, spo2Nights: 0, breathingNights: 0, complication: null, soundsAuto: false, screenTime: false, roomSensor: null, watchBattery: null }
  it('ticks each item from its data; optional and info items do not hold it open', () => {
    const empty = setupChecklist(none)
    expect(empty.complete).toBe(false)
    expect(empty.of).toBe(6)
    const all = setupChecklist({ ...none, sleepNights: 12, spo2Nights: 10, breathingNights: 11, complication: true, soundsAuto: true, screenTime: true, watchBattery: 0.64 })
    expect(all.complete).toBe(true)
    expect(all.items.find((i) => i.key === 'room')!.done).toBe(false)
    expect(all.items.find((i) => i.key === 'battery')!.note).toBe('Last reported: 64%')
  })

  it('Screen Time not available on the device is left out of the count', () => {
    const r = setupChecklist({ ...none, screenTime: null })
    expect(r.of).toBe(5)
    expect(r.items.find((i) => i.key === 'screenTime')!.how).toBe('Not available on this iPhone.')
  })

  it('the bedtime nudge is under 30%', () => {
    expect(needsCharge(0.29)).toBe(true)
    expect(needsCharge(0.3)).toBe(false)
    expect(needsCharge(null)).toBe(false)
  })
})
