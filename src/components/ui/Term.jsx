import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { HelpCircle } from 'lucide-react'
import { glossaryFor } from '../../lib/glossary'

// A jargon word you can tap for a one-line explanation. Underlined and given a
// small "?" so it reads as tappable rather than as decoration.
export default function Term({ id, children, className = '' }) {
  const entry = glossaryFor(id)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Tapping anywhere else — or Escape — closes it. Without this the tooltip
  // hangs around covering whatever is underneath it.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!entry) return <>{children}</>

  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className={`inline-flex items-center gap-0.5 font-bold ${className}`}
        style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
        aria-label={`What does ${entry.term} mean?`}
        aria-expanded={open}
      >
        {children || entry.term}
        <HelpCircle size={11} className="shrink-0 opacity-70" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            onClick={(e) => { e.stopPropagation(); setOpen(false) }}
            className="absolute left-0 top-full z-[60] mt-1.5 block w-60 rounded-2xl p-2.5 text-left text-[11px] font-medium leading-relaxed shadow-lg"
            style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', color: 'var(--muted)' }}
          >
            <span className="mb-0.5 block text-[11px] font-black" style={{ color: 'var(--text)' }}>{entry.term}</span>
            {entry.plain}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
