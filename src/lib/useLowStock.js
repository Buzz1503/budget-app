import useOrderDot from './useStock'

/** True when a compound has to be ordered within a week, or is already out. */
export default function useLowStockDot() {
  return useOrderDot()
}
