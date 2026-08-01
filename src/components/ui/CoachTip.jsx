import { motion, AnimatePresence } from 'framer-motion'
import { Lightbulb, X } from 'lucide-react'
import useStore from '../../store/useStore'

// A one-time beginner tip. Shows until dismissed, then never again — the id is
// persisted, so it survives reloads and doesn't nag on every visit.
export default function CoachTip({ id, children, tone = 'lime', when = true }) {
  const seen = useStore((s) => s.coachMarks?.[id])
  const markCoachSeen = useStore((s) => s.markCoachSeen)
  const show = when && !seen

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key={id}
          data-coach={id}
          initial={{ opacity: 0, y: -6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="flex items-start gap-2 rounded-xl p-2.5"
            style={{
              background: `color-mix(in srgb, var(--${tone}) 14%, transparent)`,
              border: `1px solid color-mix(in srgb, var(--${tone}) 35%, transparent)`,
            }}>
            <Lightbulb size={14} className="mt-0.5 shrink-0" style={{ color: `var(--${tone})` }} />
            <p className="min-w-0 flex-1 text-[11px] font-semibold leading-relaxed">{children}</p>
            <button onClick={() => markCoachSeen(id)} aria-label="Dismiss tip"
              className="shrink-0 rounded-full p-1" style={{ background: 'var(--surface2)' }}>
              <X size={12} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
