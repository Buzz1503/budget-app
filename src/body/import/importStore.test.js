import { describe, it, expect, beforeEach } from 'vitest'
import { evoltItem, withingsItems, withingsReportItem, importPayload } from './plan'
import { linesFromText } from './pdfLines'
import { evolt26Oct, WITHINGS_REPORT_TEXT } from './fixtures'
import { dailySeries, getLatestMeasurement } from '../bodySeries'
import useStore from '../../store/useStore'
import { snapshotWatched } from '../../native/runtime'

const none = { measurements: [] }
const CSV = 'Date,Weight (kg),Fat mass (kg),Muscle mass (kg),Pulse\n2024-05-01 07:12:33,95.6,29.9,62.6,61\n2024-05-02 07:10:00,95.2,29.4,62.7,60\n'

describe('after an import', () => {
  beforeEach(() => useStore.setState({ measurements: [], withingsReports: [] }))

  it('adds beside what is there, never replaces, and Undo takes out only what it added', () => {
    useStore.setState({ measurements: [{ id: 'scan-evolt-360-2026-10-26-1241', date: '2026-01-01', source: 'manual', weight: 99 }] })
    const items = [evoltItem('a.pdf', evolt26Oct(), none), withingsReportItem('r.pdf', linesFromText(WITHINGS_REPORT_TEXT), none), ...withingsItems('weight.csv', CSV, none)]
    const { added, undo } = useStore.getState().importBody(importPayload(items))
    expect(added).toBe(4)
    const ms = useStore.getState().measurements
    expect(ms).toHaveLength(4)
    expect(ms.find((m) => m.date === '2026-01-01')?.weight).toBe(99)
    expect(ms.filter((m) => m.id.startsWith('scan-evolt-360-2026-10-26-1241'))).toHaveLength(2)
    expect(useStore.getState().withingsReports).toHaveLength(1)
    undo()
    expect(useStore.getState().measurements).toHaveLength(1)
    expect(useStore.getState().withingsReports).toHaveLength(0)
  })

  it('the body numbers and the widget and Watch snapshot refresh straight away', () => {
    const before = snapshotWatched(useStore.getState())
    useStore.getState().importBody(importPayload([evoltItem('a.pdf', evolt26Oct(), none), ...withingsItems('weight.csv', CSV, none)]))
    const after = snapshotWatched(useStore.getState())
    expect(after.some((v, i) => v !== before[i])).toBe(true)
    const input = { measurements: useStore.getState().measurements }
    expect(getLatestMeasurement('weight', input, '2026-10-28')?.value).toBe(92.5)
    expect(dailySeries('withingsMuscleMass', input).map((p) => [p.date, p.value, p.sourceLabel])).toEqual([['2024-05-01', 62.6, 'Withings'], ['2024-05-02', 62.7, 'Withings']])
    expect(dailySeries('weight', input).find((p) => p.date === '2024-05-01')?.source).toBe('withings')
  })
})
