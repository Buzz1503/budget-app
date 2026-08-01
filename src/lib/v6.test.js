import { describe, it, expect } from 'vitest'
import {
  buildIcs, eventsForPeptide, escapeIcs, foldLine, firstOccurrence, icsLocalStamp,
} from './calendar'
import {
  adherenceFor, adherenceSummary, historyEvents, scheduledCount, windowRange, dateRange,
} from './adherence'
import {
  validateBackup, describeBackup, backupNudge, countEntries, BACKUP_FORMAT, backupFilename,
} from './backup'

// 2026-01-05 is a Monday
const MON = '2026-01-05'
const pep = (o = {}) => ({
  id: 'bpc157', name: 'BPC-157', frequency: 'daily', timing: 'Flexible', startDate: MON,
  cycleOnDays: 0, cycleOffDays: 0,
  ladder: { floor: 250, step: 250, intervalWeeks: 2, ceiling: 500, unit: 'mcg' },
  recon: { vialMg: 5, bacMl: 2, expiryDays: 28 }, ...o,
})
const tState = { level: 0, levelStartDate: MON }

describe('ics export', () => {
  it('escapes special characters and folds long lines', () => {
    expect(escapeIcs('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
    const folded = foldLine('X'.repeat(200))
    expect(folded.split('\r\n').every((l) => l.length <= 76)).toBe(true)
  })

  it('first occurrence lands on the requested weekday, never in the past', () => {
    const from = new Date('2026-01-05T00:00:00') // Monday
    expect(firstOccurrence(from, 1).getDay()).toBe(1) // same day
    expect(firstOccurrence(from, 3).getDay()).toBe(3) // Wednesday
    expect(firstOccurrence(from, 0).getDay()).toBe(0) // next Sunday
    expect(firstOccurrence(from, 0) >= from).toBe(true)
  })

  it('daily peptide yields 7 weekly rules, one per weekday', () => {
    const evs = eventsForPeptide(pep(), tState, { from: new Date('2026-01-05T00:00:00'), includeDose: true })
    expect(evs.length).toBe(7)
    expect(new Set(evs.map((e) => e.byday)).size).toBe(7)
  })

  it('3x/week peptide yields only its chosen days', () => {
    const p = pep({ id: 'nad', name: 'NAD+', frequency: '3xweek', scheduleWeekdays: [1, 3, 5] })
    const evs = eventsForPeptide(p, tState, { from: new Date('2026-01-05T00:00:00') })
    expect(evs.map((e) => e.byday).sort()).toEqual(['FR', 'MO', 'WE'])
  })

  it('uses the AM/PM slot time and labels the shot', () => {
    const am = eventsForPeptide(pep({ slot: 'AM' }), tState, { from: new Date('2026-01-05T00:00:00') })[0]
    const pm = eventsForPeptide(pep({ slot: 'PM' }), tState, { from: new Date('2026-01-05T00:00:00') })[0]
    expect(am.time.h).toBe(8)
    expect(pm.time.h).toBe(21)
    expect(am.summary).toMatch(/AM shot/)
    expect(pm.summary).toMatch(/PM shot/)
  })

  it('skips peptides with no protocol set', () => {
    const blank = pep({ ladder: { floor: 0, step: 0, intervalWeeks: 1, ceiling: 0, unit: 'mcg' }, recon: { vialMg: 0, bacMl: 0, expiryDays: 28 } })
    expect(eventsForPeptide(blank, tState, { from: new Date() })).toEqual([])
  })

  it('builds a structurally valid calendar', () => {
    const { ics, eventCount } = buildIcs([pep()], { bpc157: tState }, { from: new Date('2026-01-05T00:00:00') })
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(eventCount)
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe((ics.match(/END:VEVENT/g) || []).length)
    expect(ics).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=/)
    expect(ics).toMatch(/\r\n/) // CRLF line endings
  })

  it('adds UNTIL when a date range is given', () => {
    const { ics } = buildIcs([pep()], { bpc157: tState }, {
      from: new Date('2026-01-05T00:00:00'), until: new Date('2026-03-01T00:00:00'),
    })
    expect(ics).toMatch(/UNTIL=20260301T/)
  })

  it('can omit the dose from the title', () => {
    const withDose = buildIcs([pep()], { bpc157: tState }, { from: new Date('2026-01-05T00:00:00'), includeDose: true }).ics
    const without = buildIcs([pep()], { bpc157: tState }, { from: new Date('2026-01-05T00:00:00'), includeDose: false }).ics
    expect(withDose).toMatch(/250 mcg/)
    expect(without).not.toMatch(/SUMMARY:.*250 mcg/)
  })

  it('formats a floating local timestamp', () => {
    expect(icsLocalStamp(new Date('2026-01-05T00:00:00'), 8, 0)).toBe('20260105T080000')
  })
})

describe('adherence', () => {
  const from = MON, to = '2026-01-11' // 7 days, Mon–Sun
  const log = (date, id = 'bpc157', extra = {}) => ({ id: `l-${id}-${date}`, peptideId: id, date, doseValue: 250, unit: 'mcg', ...extra })

  it('counts a daily peptide as scheduled every day', () => {
    expect(scheduledCount(pep(), from, to)).toBe(7)
    expect(dateRange(from, to).length).toBe(7)
  })

  it('computes taken / missed / percentage', () => {
    const logs = [log(MON), log('2026-01-06'), log('2026-01-07')]
    const a = adherenceFor(pep(), logs, from, to)
    expect(a).toMatchObject({ scheduled: 7, taken: 3, missed: 4, pct: 43 })
  })

  it('is 100% when every scheduled dose is logged', () => {
    const logs = dateRange(from, to).map((d) => log(d))
    expect(adherenceFor(pep(), logs, from, to).pct).toBe(100)
  })

  it('ignores logs on unscheduled days rather than exceeding 100%', () => {
    const p = pep({ frequency: '3xweek', scheduleWeekdays: [1, 3, 5] })
    const logs = dateRange(from, to).map((d) => log(d)) // logged every day
    const a = adherenceFor(p, logs, from, to)
    expect(a.scheduled).toBe(3)
    expect(a.taken).toBe(3)
    expect(a.pct).toBe(100)
  })

  it('returns null pct (not 0) when nothing was scheduled', () => {
    const future = pep({ startDate: '2027-01-01' })
    expect(adherenceFor(future, [], from, to).pct).toBe(null)
  })

  it('summarises across peptides and excludes unscheduled ones', () => {
    const a = pep()
    const b = pep({ id: 'kpv', name: 'KPV', frequency: '5on2off', scheduleWeekdays: [1, 2, 3, 4, 5] })
    const logs = [log(MON, 'bpc157'), log(MON, 'kpv'), log('2026-01-06', 'kpv')]
    const s = adherenceSummary([a, b], logs, from, to)
    expect(s.overall.scheduled).toBe(12) // 7 + 5
    expect(s.overall.taken).toBe(3)
    expect(s.overall.pct).toBe(25)
    expect(s.rows.length).toBe(2)
  })

  it('windowRange spans the requested number of days inclusive', () => {
    const r = windowRange(7, '2026-01-11')
    expect(r).toEqual({ from: '2026-01-05', to: '2026-01-11' })
  })
})

describe('history grouping', () => {
  const peptides = [pep(), pep({ id: 'kpv', name: 'KPV' })]
  const base = { date: MON, siteId: 'abd-ul', loggedAt: '2026-01-05T08:00:00' }

  it('collapses a co-draw into a single injection event', () => {
    const logs = [
      { id: 'a', peptideId: 'bpc157', coDrawId: 'cd1', doseValue: 250, unit: 'mcg', ...base },
      { id: 'b', peptideId: 'kpv', coDrawId: 'cd1', doseValue: 100, unit: 'mcg', ...base },
    ]
    const ev = historyEvents(logs, peptides)
    expect(ev.length).toBe(1)
    expect(ev[0].coDraw).toBe(true)
    expect(ev[0].items.length).toBe(2)
    expect(ev[0].siteLabel).toMatch(/Abdomen/)
  })

  it('keeps separate single logs as separate events', () => {
    const logs = [
      { id: 'a', peptideId: 'bpc157', doseValue: 250, unit: 'mcg', ...base },
      { id: 'b', peptideId: 'kpv', doseValue: 100, unit: 'mcg', ...base, loggedAt: '2026-01-05T09:00:00' },
    ]
    const ev = historyEvents(logs, peptides)
    expect(ev.length).toBe(2)
    expect(ev.every((e) => e.coDraw === false)).toBe(true)
  })

  it('sorts newest first', () => {
    const logs = [
      { id: 'a', peptideId: 'bpc157', date: '2026-01-05', loggedAt: '2026-01-05T08:00:00', doseValue: 250, unit: 'mcg' },
      { id: 'b', peptideId: 'bpc157', date: '2026-01-07', loggedAt: '2026-01-07T08:00:00', doseValue: 250, unit: 'mcg' },
    ]
    expect(historyEvents(logs, peptides)[0].date).toBe('2026-01-07')
  })

  it('filtering by peptide keeps the whole co-draw it belonged to', () => {
    const logs = [
      { id: 'a', peptideId: 'bpc157', coDrawId: 'cd1', doseValue: 250, unit: 'mcg', ...base },
      { id: 'b', peptideId: 'kpv', coDrawId: 'cd1', doseValue: 100, unit: 'mcg', ...base },
    ]
    const ev = historyEvents(logs, peptides, { peptideId: 'bpc157' })
    expect(ev.length).toBe(1)
    expect(ev[0].items.length).toBe(2) // partner still shown for context
  })

  it('filters by date range', () => {
    const logs = [
      { id: 'a', peptideId: 'bpc157', date: '2026-01-01', loggedAt: '2026-01-01T08:00:00', doseValue: 250, unit: 'mcg' },
      { id: 'b', peptideId: 'bpc157', date: '2026-01-09', loggedAt: '2026-01-09T08:00:00', doseValue: 250, unit: 'mcg' },
    ]
    expect(historyEvents(logs, peptides, { from: '2026-01-05', to: '2026-01-11' }).length).toBe(1)
  })
})

describe('backup', () => {
  const bundle = {
    format: BACKUP_FORMAT, version: 1, createdAt: '2026-01-05T00:00:00.000Z',
    appState: { state: { peptides: [1, 2], doseLogs: [1], measurements: [], symptomLogs: [], photos: [1] } },
    blobs: { 'photo-1': { type: 'image/jpeg', data: 'AAAA' } },
  }

  it('accepts a well-formed bundle', () => {
    expect(validateBackup(bundle)).toBe(null)
  })

  it('rejects junk, foreign files and future versions', () => {
    expect(validateBackup(null)).toBeTruthy()
    expect(validateBackup({ format: 'something-else' })).toMatch(/not a Pepito/)
    expect(validateBackup({ format: BACKUP_FORMAT, version: 1 })).toMatch(/no app data/)
    expect(validateBackup({ ...bundle, version: 99 })).toMatch(/newer version/)
  })

  it('describes what a restore would bring back', () => {
    const d = describeBackup(bundle)
    expect(d).toMatchObject({ peptides: 2, doseLogs: 1, photos: 1, blobs: 1 })
  })

  it('names the file by date', () => {
    expect(backupFilename(new Date('2026-01-05T10:00:00Z'))).toBe('peptide-command-center-backup-2026-01-05.json')
  })

  it('counts entries across every data type', () => {
    expect(countEntries({ doseLogs: [1, 2], measurements: [1], symptomLogs: [1], photos: [1] })).toBe(5)
    expect(countEntries({})).toBe(0)
  })
})

describe('backup nudge', () => {
  const now = new Date('2026-01-20T12:00:00Z')

  it('stays quiet with no data at all', () => {
    expect(backupNudge({ entryCount: 0, now })).toBe(null)
  })

  it('nudges a user who has data but has never backed up', () => {
    expect(backupNudge({ entryCount: 3, now }).reason).toBe('never')
  })

  it('nudges once a backup is a week old', () => {
    const n = backupNudge({ lastBackupAt: '2026-01-12T12:00:00Z', entryCount: 5, lastBackupEntryCount: 5, now })
    expect(n.reason).toBe('stale')
    expect(n.days).toBe(8)
  })

  it('stays quiet on a recent backup with few new entries', () => {
    expect(backupNudge({ lastBackupAt: '2026-01-19T12:00:00Z', entryCount: 6, lastBackupEntryCount: 5, now })).toBe(null)
  })

  it('nudges after many new entries even if the backup is recent', () => {
    const n = backupNudge({ lastBackupAt: '2026-01-19T12:00:00Z', entryCount: 40, lastBackupEntryCount: 5, now })
    expect(n.reason).toBe('entries')
    expect(n.newEntries).toBe(35)
  })
})
