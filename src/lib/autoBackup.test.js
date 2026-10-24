import { describe, it, expect } from 'vitest'
import { backupPlan, backupName, dateOfBackup, lastBackupWords, sizeWords, KEEP_BACKUPS } from './autoBackup'

const file = (date, modified = Date.parse(`${date}T03:00:00`)) => ({ name: backupName(date), size: 1000, modified })

describe('automatic daily backups', () => {
  it('one a day: due until today has one', () => {
    expect(backupPlan([], '2026-10-24')).toEqual({ due: true, remove: [] })
    expect(backupPlan([file('2026-10-24')], '2026-10-24').due).toBe(false)
    expect(dateOfBackup('Pepito-backup-2026-10-24.json')).toBe('2026-10-24')
    expect(dateOfBackup('notes.txt')).toBeNull()
  })

  it('keeps the last 14, removing the oldest, and never touches other files', () => {
    const days = Array.from({ length: 16 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
    const files = [...days.map((d) => file(d)), { name: 'mine.txt', size: 1, modified: 0 }]
    const p = backupPlan(files, '2026-10-24')
    // today's is still to make, so 13 old ones stay
    expect(p.due).toBe(true)
    expect(p.remove).toEqual(['2026-10-03', '2026-10-02', '2026-10-01'].map(backupName))
    expect(backupPlan(files.slice(0, 14), '2026-10-14')).toEqual({ due: false, remove: [] })
    expect(KEEP_BACKUPS).toBe(14)
  })

  it('"Last backup" in plain words', () => {
    const now = new Date('2026-10-24T10:00:00')
    expect(lastBackupWords([], now)).toBe('No backup yet')
    expect(lastBackupWords([file('2026-10-24')], now)).toBe('Last backup: today 3:00 am')
    expect(lastBackupWords([file('2026-10-23', Date.parse('2026-10-23T21:14:00'))], now)).toBe('Last backup: yesterday 9:14 pm')
    expect(lastBackupWords([file('2026-10-12', Date.parse('2026-10-12T08:00:00'))], now)).toBe('Last backup: 12 Oct 8:00 am')
    expect(sizeWords(2_500_000)).toBe('2.4 MB')
    expect(sizeWords(840_000)).toBe('820 KB')
  })
})
