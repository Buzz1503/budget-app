import { useMemo } from 'react'
import useStore, { todayStr } from '../store/useStore'
import { showLowStockDot } from './lowStock'

/** True when a compound is running low and nothing on order covers it. */
export default function useLowStockDot() {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const vials = useStore((s) => s.vials)
  const restock = useStore((s) => s.restock)
  const leadDays = useStore((s) => s.settings.restockLeadDays)
  const t = todayStr()
  return useMemo(() => showLowStockDot({ peptides, titration, vials, restock, leadDays, today: t }), [peptides, titration, vials, restock, leadDays, t])
}
