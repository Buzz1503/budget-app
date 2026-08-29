import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useVisualViewport, sheetMaxHeight, useKeyboardSafeFocus } from '../../lib/viewport'

/**
 * A bottom sheet that stays out from under the keyboard.
 *
 * Three parts in a column that never scrolls as a whole: the title, an optional
 * `pinned` strip, and the body. Anything the user has to keep seeing while they
 * type — a search field, above all — belongs in `pinned`, because the body
 * scrolls out from under it and the strip does not.
 */
export default function Modal({ open, onClose, title, children, wide, pinned }) {
  const vp = useVisualViewport()
  const sheetRef = useRef(null)
  useKeyboardSafeFocus(sheetRef, open)

  // Escape closes it, the way every other sheet on the phone does — but it
  // dismisses one layer at a time. With a term explanation open on top, Escape
  // belongs to the tooltip; closing the whole sheet out from under it would
  // lose whatever the user was in the middle of.
  useEffect(() => {
    if (!open || !onClose) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[role="tooltip"]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
          // pinned to the visual viewport, not the window: with the keyboard up
          // those are two different rectangles and only one of them is on screen.
          // bottom:auto so the explicit height wins over inset-0's bottom:0.
          style={{ top: vp.offsetTop, bottom: 'auto', height: vp.height }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />
          <motion.div
            ref={sheetRef}
            data-testid="sheet"
            className={`card relative flex w-full flex-col overflow-hidden ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} rounded-b-none sm:rounded-b-[var(--r-lg)]`}
            style={{ background: 'var(--surface)', maxHeight: sheetMaxHeight(vp) }}
            initial={{ y: 60, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          >
            <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
              <h2 className="text-lg font-black tracking-tight">{title}</h2>
              {onClose && (
                <button onClick={onClose} className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }} aria-label="Close">
                  <X size={16} />
                </button>
              )}
            </div>

            {pinned && (
              <div className="shrink-0 px-5 pb-3" data-testid="sheet-pinned">
                {pinned}
              </div>
            )}

            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5"
              data-testid="sheet-body"
              // the home indicator sits over the last row otherwise
              style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}
            >
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
