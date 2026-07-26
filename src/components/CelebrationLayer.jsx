import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Flame, TrendingUp, Award, Beaker, HeartPulse, Sun, ChevronsUp, Ruler, Camera } from 'lucide-react'
import useStore from '../store/useStore'
import { burstSmall, burstBig, levelUpBurst } from '../lib/celebrate'
import { badgeById } from '../lib/gamification'
import { formatDose } from '../lib/calc'
import { haptic, blip } from '../lib/feedback'

// Watches store.celebration and plays the right moment: a toast for every event,
// plus a full-screen overlay when the player crosses an XP level (rank-up).
// Purely additive — every effect is wrapped so the core app never breaks.
export default function CelebrationLayer() {
  const celebration = useStore((s) => s.celebration)
  const soundOn = useStore((s) => s.settings.sound)
  const hapticsOn = useStore((s) => s.settings.haptics)
  const [toast, setToast] = useState(null)
  const [overlay, setOverlay] = useState(null)
  const timer = useRef(null)
  const overlayTimer = useRef(null)

  useEffect(() => {
    if (!celebration) return
    const big = celebration.type === 'levelup' || celebration.fullDay || celebration.clearDay || celebration.rankUp
    try {
      if (celebration.rankUp) levelUpBurst()
      else if (celebration.type === 'levelup') levelUpBurst()
      else if (big) burstBig()
      else burstSmall()
    } catch { /* effects are optional */ }
    try {
      if (hapticsOn) haptic(celebration.rankUp ? [18, 40, 18, 40, 30] : big ? [14, 30, 14] : 12)
      if (soundOn) blip(celebration.rankUp ? 'levelup' : big ? 'fullday' : 'log')
    } catch { /* ignore */ }

    setToast(celebration)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), big ? 3200 : 2200)

    if (celebration.rankUp) {
      setOverlay(celebration.rankUp)
      clearTimeout(overlayTimer.current)
      overlayTimer.current = setTimeout(() => setOverlay(null), 2600)
    }
    return () => { clearTimeout(timer.current); clearTimeout(overlayTimer.current) }
  }, [celebration, soundOn, hapticsOn])

  return (
    <>
      {/* toast */}
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
              <ToastIcon toast={toast} />
              <div>
                <ToastBody toast={toast} />
                {toast.badges?.length > 0 && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--gold)' }}>
                    <Award size={12} /> {toast.badges.map((b) => badgeById(b)?.name).filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* full-screen rank-up */}
      <AnimatePresence>
        {overlay && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className="absolute inset-0"
              style={{ background: 'radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--violet) 34%, transparent), color-mix(in srgb, var(--bg) 92%, transparent) 70%)' }}
            />
            <motion.div
              className="relative text-center"
              initial={{ scale: 0.6, y: 24 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 16 }}
            >
              <motion.div
                className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-3xl"
                style={{ backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', boxShadow: '0 0 40px color-mix(in srgb, var(--violet) 60%, transparent)' }}
                animate={{ rotate: [0, -8, 8, 0] }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                <ChevronsUp size={40} color="#fff" strokeWidth={2.5} />
              </motion.div>
              <p className="text-xs font-black uppercase tracking-[0.3em]" style={{ color: 'var(--violet)' }}>Level up</p>
              <p className="text-4xl font-black tracking-tight">Level {overlay.toLevel}</p>
              {overlay.rankChanged && (
                <p className="mt-1 text-sm font-bold" style={{ color: 'var(--muted)' }}>
                  {overlay.fromRank} → <span style={{ color: 'var(--lime)' }}>{overlay.toRank}</span>
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function ToastIcon({ toast }) {
  const map = {
    levelup: { bg: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff', Icon: TrendingUp },
    discovery: { bg: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff', Icon: Beaker },
    checkin: { bg: 'linear-gradient(135deg, var(--coral), var(--rose))', color: '#fff', Icon: HeartPulse },
    clearday: { bg: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#0c1200', Icon: Sun },
    measurement: { bg: 'linear-gradient(135deg, var(--indigo), var(--violet))', color: '#fff', Icon: Ruler },
    photo: { bg: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff', Icon: Camera },
  }
  const s = map[toast.type] || { bg: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#0c1200', Icon: Check }
  const Icon = s.Icon
  return (
    <motion.div
      initial={{ scale: 0 }} animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 14, delay: 0.05 }}
      className="flex h-9 w-9 items-center justify-center rounded-full"
      style={{ backgroundImage: s.bg, color: s.color }}
    >
      <Icon size={19} strokeWidth={2.6} />
    </motion.div>
  )
}

function ToastBody({ toast }) {
  if (toast.type === 'levelup') {
    return (
      <>
        <p className="text-sm font-bold">{toast.peptide} → Lvl {toast.level}</p>
        <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
          New dose {formatDose(toast.dose, toast.unit)} · +50 XP
        </p>
      </>
    )
  }
  if (toast.type === 'discovery') {
    return (
      <>
        <p className="text-sm font-bold">Pair mapped 🧪</p>
        <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>+{toast.xp} XP · Codex updated</p>
      </>
    )
  }
  if (toast.clearDay) {
    return (
      <>
        <p className="text-sm font-bold">Clear day! ☀️</p>
        <p className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--muted)' }}>
          <Flame size={12} style={{ color: 'var(--amber)' }} /> {toast.streak}-day check-in · +{toast.xp} XP
        </p>
      </>
    )
  }
  if (toast.type === 'checkin') {
    return (
      <>
        <p className="text-sm font-bold">Check-in logged</p>
        <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>+{toast.xp} XP</p>
      </>
    )
  }
  if (toast.type === 'measurement') {
    return (
      <>
        <p className="text-sm font-bold">Measurement saved 📏</p>
        <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>+{toast.xp} XP</p>
      </>
    )
  }
  if (toast.type === 'photo') {
    return (
      <>
        <p className="text-sm font-bold">Photo captured 📸</p>
        <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>+{toast.xp} XP</p>
      </>
    )
  }
  if (toast.fullDay) {
    return (
      <>
        <p className="text-sm font-bold">Full stack complete! 🎉</p>
        <p className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--muted)' }}>
          <Flame size={12} style={{ color: 'var(--amber)' }} /> {toast.streak}-day streak · +{toast.xp} XP
        </p>
      </>
    )
  }
  return (
    <>
      <p className="text-sm font-bold">{toast.peptide} logged</p>
      <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>+{toast.xp} XP</p>
    </>
  )
}
