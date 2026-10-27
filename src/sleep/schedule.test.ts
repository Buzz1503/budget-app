import { describe, it, expect } from 'vitest'
import { inWindow, scheduleWords, twelveHour, checkSetup, DEFAULT_SCHEDULE, stopReasonText, logRows } from './soundsView'

describe('the schedule window', () => {
  it('9 pm to 5 am runs across midnight', () => {
    const s = DEFAULT_SCHEDULE
    expect(['21:00', '23:59', '00:00', '04:59'].map((t) => inWindow(t, s))).toEqual([true, true, true, true])
    expect(['05:00', '12:00', '20:59'].map((t) => inWindow(t, s))).toEqual([false, false, false])
  })
  it('a window inside one day, and nonsense', () => {
    expect(inWindow('03:00', { start: '01:00', stop: '06:00' })).toBe(true)
    expect(inWindow('23:00', { start: '01:00', stop: '06:00' })).toBe(false)
    expect(inWindow('25:00', DEFAULT_SCHEDULE)).toBe(false)
  })
  it('words for the row', () => {
    expect(scheduleWords(DEFAULT_SCHEDULE)).toBe('Scheduled 9 pm to 5 am')
    expect(scheduleWords({ on: true, start: '21:30', stop: '06:15' })).toBe('Scheduled 9:30 pm to 6:15 am')
    expect(scheduleWords({ ...DEFAULT_SCHEDULE, on: false })).toBeNull()
    expect(twelveHour('00:00')).toBe('12 am')
    expect(twelveHour('12:00')).toBe('12 pm')
  })
  it('a session stopped by the schedule says so in the log', () => {
    expect(stopReasonText({ stopReason: 'scheduled' })).toBe('Schedule ended')
    expect(logRows([{ at: 1, kind: 'start', by: 'schedule', result: 'started' }])[0].detail).toBe('Scheduled start')
  })
})

describe('Check my setup', () => {
  const at = (date: string, hh = 21) => Date.parse(`${date}T${String(hh).padStart(2, '0')}:00:00Z`)
  const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const dayName = (d: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${d}T12:00:00Z`).getUTCDay()]
  const today = '2026-10-29' // Thursday: the last 3 evenings are Mon, Tue, Wed
  const base = { today, dateOf, dayName, sessions: [] as Array<{ start: number; startedBy: string }> }

  it('working on all of the last 3 nights', () => {
    const log = ['2026-10-26', '2026-10-27', '2026-10-28'].map((d) => ({ at: at(d), kind: 'start' as const, by: 'schedule', result: 'started' }))
    const v = checkSetup({ ...base, log })
    expect(v.ok).toBe(true)
    expect(v.text).toBe('Working. It started by itself on Mon, Tue and Wed.')
  })

  it('names the nights it did not start', () => {
    const log = [{ at: at('2026-10-28'), kind: 'start' as const, by: 'schedule', result: 'started' }]
    const v = checkSetup({ ...base, log })
    expect(v.ok).toBe(false)
    expect(v.text).toBe("Didn't start on Mon and Tue. Check the automation.")
  })

  it('a start that fired but was blocked is named with its reason', () => {
    const log = [
      { at: at('2026-10-26'), kind: 'start' as const, by: 'schedule', result: 'started' },
      { at: at('2026-10-27'), kind: 'start' as const, by: 'schedule', result: 'blockedLocked' },
      { at: at('2026-10-28'), kind: 'start' as const, by: 'schedule', result: 'alreadyRunning' },
    ]
    const v = checkSetup({ ...base, log })
    expect(v.nights.map((n) => n.state)).toEqual(['started', 'failed', 'started'])
    expect(v.text).toBe('Tried on Tue but could not start: the phone was locked.')
  })

  it('a session the schedule started counts even without a log entry; other starts do not', () => {
    const sessions = [
      { start: at('2026-10-26'), startedBy: 'schedule' },
      { start: at('2026-10-27'), startedBy: 'app' },
    ]
    const v = checkSetup({ ...base, log: [], sessions })
    expect(v.nights.map((n) => n.state)).toEqual(['started', 'none', 'none'])
    expect(v.text).toBe("Didn't start on Tue and Wed. Check the automation.")
  })
})
