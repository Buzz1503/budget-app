import { useMemo } from 'react'
import useStore, { todayStr } from '../store/useStore'
import { stockRows, withRemaining, orderDot } from './vials'

/** The open-vial records with what is left in each worked out from the log. */
export function useOpenVialsView() {
  const openVials = useStore((s) => s.openVials)
  const doseLogs = useStore((s) => s.doseLogs)
  const sharedDraws = useStore((s) => s.sharedDraws)
  return useMemo(() => withRemaining(openVials, doseLogs, sharedDraws), [openVials, doseLogs, sharedDraws])
}

/** One row per compound for the Stock screen, the dot and the order notice. */
export function useStockRows() {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const vials = useStore((s) => s.vials)
  const openVials = useStore((s) => s.openVials)
  const doseLogs = useStore((s) => s.doseLogs)
  const sharedDraws = useStore((s) => s.sharedDraws)
  const pushes = useStore((s) => s.pushes)
  const pauses = useStore((s) => s.pauses)
  const t = todayStr()
  return useMemo(
    () => stockRows({ peptides, titration, vials, openVials, doseLogs, sharedDraws, pushes, pauses, todayStr: t }),
    [peptides, titration, vials, openVials, doseLogs, sharedDraws, pushes, pauses, t],
  )
}

/** The dot on More and on Stock: something to order within a week, or already out. */
export default function useOrderDot() {
  return orderDot(useStockRows())
}
