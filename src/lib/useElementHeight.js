import { useLayoutEffect, useState } from 'react'

/**
 * The live height of an element that is given whatever space is left over.
 *
 * The full-screen maps sit between a header and a footer, and the footer is not
 * a fixed height: choosing a pin swaps a one-line suggestion for a pin bar with
 * warnings in it. A height measured once at mount goes stale the moment that
 * happens, and the map — a positioned element, so painted above its
 * non-positioned neighbours — then sits on top of the footer and swallows taps
 * meant for what is underneath. Observing the element keeps the map fitted to
 * the space it actually has.
 */
export function useElementHeight(ref, fallback = 300) {
  const [height, setHeight] = useState(fallback)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setHeight((prev) => {
      const next = Math.max(120, Math.round(el.clientHeight))
      return prev === next ? prev : next
    })
    measure()
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.removeEventListener('resize', measure)
        window.visualViewport?.removeEventListener('resize', measure)
      }
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [ref])

  return height
}

/** What an `px-2 py-2` area leaves for its content: the padding is inside clientHeight. */
export const AREA_PADDING_PX = 16
