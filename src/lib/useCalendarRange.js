import { useEffect, useMemo, useState } from 'react'
import useStore, { todayStr } from '../store/useStore'
import { buildCalendar } from './calendarView'
import { loadMatrix, LIB_TO_COMPOUND } from './mixMatrix'

// The chemistry matrix is a lazy ~1.9 MB chunk. Until it lands every dose
// counts as its own syringe — the safe over-count — and the UI says so.
export function useVerdictOf() {
  const [matrix, setMatrix] = useState(null)
  useEffect(() => {
    let alive = true
    loadMatrix().then((m) => { if (alive) setMatrix(m) }).catch(() => { /* over-count stands */ })
    return () => { alive = false }
  }, [])
  return useMemo(() => {
    if (!matrix) return null
    return (a, b) => matrix.lookup(LIB_TO_COMPOUND[a] || a, LIB_TO_COMPOUND[b] || b)?.verdict || null
  }, [matrix])
}

/**
 * The built calendar over a date range.
 *
 * Lives here rather than beside the Calendar screen because backfill reads the
 * same days the calendar draws — what was due, what is logged, what was skipped.
 * Two implementations of "what was owed that day" would eventually disagree,
 * and the one the user is looking at would not be the one being corrected.
 */
export function useCalendarRange(from, to) {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const openVials = useStore((s) => s.openVials)
  const vials = useStore((s) => s.vials)
  const restock = useStore((s) => s.restock)
  const supplements = useStore((s) => s.supplements)
  const supplementLogs = useStore((s) => s.supplementLogs)
  const skips = useStore((s) => s.skips)
  const leadDays = useStore((s) => s.settings.restockLeadDays)
  const verdictOf = useVerdictOf()
  const t = todayStr()

  return useMemo(
    () => buildCalendar({ peptides, titration, doseLogs, openVials, vials, supplements, supplementLogs, skips, restock, todayStr: t, from, to, verdictOf, leadDays }),
    [peptides, titration, doseLogs, openVials, vials, supplements, supplementLogs, skips, restock, t, from, to, verdictOf, leadDays]
  )
}
