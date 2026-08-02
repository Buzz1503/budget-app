import { motion } from 'framer-motion'
import {
  BookOpen, Package, Syringe, Settings, Zap, Flame, ChevronRight, Award,
  Activity, History, Wand2, FlaskConical, Combine,
} from 'lucide-react'
import useStore from '../store/useStore'
import { levelProgress, rankForLevel, BADGES } from '../lib/gamification'

// Nothing here re-opens a bottom-nav tab — Home, Calendar, Symptoms and Body are
// one tap away already, so a duplicate row would just be a longer route to the
// same screen. Every id below is a screen that exists nowhere else.
const LINKS = [
  { id: 'wizard', label: 'Build / rebuild my schedule', desc: 'Guided setup with suggestions pre-loaded', icon: Wand2, color: 'var(--violet)' },
  { id: 'library', label: 'Library', desc: 'Your peptides, ladders, cycles & protocols', icon: BookOpen, color: 'var(--lime)' },
  { id: 'calc', label: 'Calculator', desc: 'Reconstitution & syringe units', icon: FlaskConical, color: 'var(--lime)' },
  { id: 'mix', label: 'Mix', desc: 'Can these two share a syringe?', icon: Combine, color: 'var(--indigo)' },
  { id: 'supplies', label: 'Stock & restock', desc: 'Vials, cost, expiry, and what to order', icon: Package, color: 'var(--amber)' },
  { id: 'now', label: 'Right Now', desc: 'What your stack is doing today', icon: Activity, color: 'var(--lime)' },
  { id: 'history', label: 'History & adherence', desc: 'Every dose, rates, shareable summary', icon: History, color: 'var(--indigo)' },
  { id: 'needle', label: 'Needle guide', desc: 'SubQ, IM and nasal technique', icon: Syringe, color: 'var(--coral)' },
  { id: 'settings', label: 'Settings & badges', desc: 'Theme, badges, backup & export', icon: Settings, color: 'var(--violet)' },
]

export default function MoreHub({ goTo }) {
  const gamification = useStore((s) => s.gamification)
  const lp = levelProgress(gamification.xp)
  const earned = gamification.badges.length

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black tracking-tight">More</h1>

      {/* profile snapshot */}
      <motion.button
        onClick={() => goTo('settings')}
        whileTap={{ scale: 0.98 }}
        className="card w-full overflow-hidden p-4 text-left"
        style={{ backgroundImage: 'linear-gradient(135deg, color-mix(in srgb, var(--violet) 22%, var(--surface)), color-mix(in srgb, var(--indigo) 16%, var(--surface)))' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', boxShadow: '0 0 22px color-mix(in srgb, var(--violet) 50%, transparent)' }}>
            <span className="text-xl font-black text-white">{lp.level}</span>
          </div>
          <div className="flex-1">
            <p className="flex items-center gap-1.5 text-base font-black">
              <Zap size={15} style={{ color: 'var(--violet)' }} /> {rankForLevel(lp.level)}
            </p>
            <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface2)' }}>
              <motion.div className="h-full rounded-full"
                style={{ backgroundImage: 'linear-gradient(90deg, var(--violet), var(--indigo))' }}
                initial={false} animate={{ width: `${Math.max(3, lp.pct * 100)}%` }} />
            </div>
            <p className="mt-1 text-[11px] font-bold" style={{ color: 'var(--muted)' }}>
              {lp.current}/{lp.needed} XP to level {lp.level + 1}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs font-bold">
          <span className="flex items-center gap-1" style={{ color: 'var(--amber)' }}><Flame size={13} /> {gamification.currentStreak} day streak</span>
          <span className="flex items-center gap-1" style={{ color: 'var(--gold)' }}><Award size={13} /> {earned}/{BADGES.length} badges</span>
        </div>
      </motion.button>

      {/* links */}
      <div className="space-y-2">
        {LINKS.map((l, i) => (
          <motion.button
            key={l.id}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => goTo(l.id)}
            className="card flex w-full items-center gap-3 p-4 text-left"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: `color-mix(in srgb, ${l.color} 18%, transparent)`, color: l.color }}>
              <l.icon size={20} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold">{l.label}</p>
              <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>{l.desc}</p>
            </div>
            <ChevronRight size={18} style={{ color: 'var(--muted)' }} />
          </motion.button>
        ))}
      </div>

      <p className="pb-2 text-center text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
        Pepito + · personal tracking tool, not medical advice
      </p>
    </div>
  )
}
