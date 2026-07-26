import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Flame, TrendingUp, Award } from 'lucide-react'
import useStore from '../store/useStore'
import { burstSmall, burstBig, levelUpBurst } from '../lib/celebrate'
import { badgeById } from '../lib/gamification'
import { formatDose } from '../lib/calc'

// Watches store.celebration and plays the right moment. Purely additive — any
// failure here is swallowed so the core app never breaks.
export default function CelebrationLayer() {
  const celebration = useStore((s) => s.celebration)
  const [toast, setToast] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    if (!celebration) return
    try {
      if (celebration.type === 'levelup') levelUpBurst()
      else if (celebration.type === 'fullday') burstBig()
      else burstSmall()
    } catch { /* effects are optional */ }
    setToast(celebration)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), celebration.type === 'levelup' || celebration.fullDay ? 3200 : 2200)
    return () => clearTimeout(timer.current)
  }, [celebration])

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.nonce}
          className="pointer-events-none fixed inset-x-0 top-6 z-[70] flex justify-center px-4"
          initial={{ y: -24, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -16, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        >
          <div className="card flex items-center gap-3 px-4 py-3" style={{ background: 'var(--surface-solid)' }}>
            <motion.div
              initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 14, delay: 0.05 }}
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{
                backgroundImage: toast.type === 'levelup'
                  ? 'linear-gradient(135deg, var(--violet), var(--indigo))'
                  : 'linear-gradient(135deg, var(--lime), var(--lime-deep))',
                color: toast.type === 'levelup' ? '#fff' : '#0c1200',
              }}
            >
              {toast.type === 'levelup' ? <TrendingUp size={18} /> : <Check size={20} strokeWidth={3} />}
            </motion.div>
            <div>
              {toast.type === 'levelup' ? (
                <>
                  <p className="text-sm font-bold">{toast.peptide} → Lvl {toast.level}</p>
                  <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                    New dose {formatDose(toast.dose, toast.unit)} · +50 XP
                  </p>
                </>
              ) : toast.fullDay ? (
                <>
                  <p className="text-sm font-bold">Full stack complete! 🎉</p>
                  <p className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--muted)' }}>
                    <Flame size={12} style={{ color: 'var(--amber)' }} /> {toast.streak}-day streak · +{toast.xp} XP
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold">{toast.peptide} logged</p>
                  <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>+{toast.xp} XP</p>
                </>
              )}
              {toast.badges?.length > 0 && (
                <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--violet)' }}>
                  <Award size={12} /> {toast.badges.map((b) => badgeById(b)?.name).filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
