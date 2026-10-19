import { useMemo } from 'react'
import { useCompounds } from '../../lib/useCompounds'
import { trackedEvents, describeChanges } from '../../health/engine/phases'

/**
 * The protocol pins a chart draws: starts, stops and dose changes of the
 * compounds whose effects are tracked (More > Health), as { date, text }.
 */
export default function useChartEvents() {
  const compounds = useCompounds()
  return useMemo(() => trackedEvents(compounds).map((e) => ({ date: e.date, text: describeChanges([e]), compoundId: e.compoundId })), [compounds])
}
