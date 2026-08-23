import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Undo2, X } from 'lucide-react'
import useStore from '../store/useStore'

const DWELL_MS = 6000

/**
 * A brief line about what just happened, with a way back out of it.
 *
 * Six seconds rather than two: an Undo you have to catch is not an Undo, and
 * the whole point of offering one is that the tap which needs reversing was
 * usually a mis-tap noticed a moment later. It sits above the bottom nav so it
 * never covers the thing you just pressed.
 */
export default function Toast() {
  const toast = useStore((s) => s.toast)
  const dismissToast = useStore((s) => s.dismissToast)
  const runUndo = useStore((s) => s.runUndo)

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(dismissToast, DWELL_MS)
    return () => clearTimeout(id)
  }, [toast?.nonce, dismissToast])

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.nonce}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
          style={{ bottom: 'calc(var(--nav-h, 64px) + 12px)' }}
          data-testid="toast"
        >
          <div className="pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-full px-4 py-3"
            style={{ background: 'var(--surface-solid)', boxShadow: 'var(--shadow-nav)' }}>
            <p className="min-w-0 flex-1 truncate text-[12px] font-bold">{toast.message}</p>
            {toast.undo && (
              <button onClick={runUndo} data-testid="toast-undo"
                className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-black"
                style={{ background: 'color-mix(in srgb, var(--lime) 12%, transparent)', color: 'var(--lime)' }}>
                <Undo2 size={12} /> Undo
              </button>
            )}
            <button onClick={dismissToast} aria-label="Dismiss"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={{ color: 'var(--muted)' }}>
              <X size={13} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
