import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, title, children, wide }) {
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />
          <motion.div
            className={`card relative w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[88dvh] overflow-y-auto rounded-b-none sm:rounded-b-[20px] p-5`}
            style={{ background: 'var(--surface-solid)' }}
            initial={{ y: 60, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">{title}</h2>
              {onClose && (
                <button onClick={onClose} className="rounded-full p-1.5" style={{ background: 'var(--surface2)' }} aria-label="Close">
                  <X size={16} />
                </button>
              )}
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
