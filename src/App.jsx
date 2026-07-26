import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, Activity, CalendarRange, Combine, HeartPulse, LayoutGrid, ChevronLeft,
  FlaskConical, Package, Syringe as SyringeIcon, BookOpen, Settings as SettingsIcon,
} from 'lucide-react'
import useStore, { onStorageError } from './store/useStore'
import Today from './components/Today'
import Library from './components/Library'
import Schedule from './components/Schedule'
import CalcTab from './components/CalcTab'
import MixTab from './components/MixTab'
import InventoryTab from './components/InventoryTab'
import NeedleTab from './components/NeedleTab'
import SettingsTab from './components/SettingsTab'
import RightNowTab from './components/RightNowTab'
import SymptomsTab from './components/SymptomsTab'
import MoreHub from './components/MoreHub'
import CelebrationLayer from './components/CelebrationLayer'

// full registry of every screen
const SCREENS = {
  today: Today,
  now: RightNowTab,
  schedule: Schedule,
  mix: MixTab,
  symptoms: SymptomsTab,
  more: MoreHub,
  library: Library,
  calc: CalcTab,
  inventory: InventoryTab,
  needle: NeedleTab,
  settings: SettingsTab,
}

// 6 primary tabs in the bottom bar; the rest live under the More hub.
const PRIMARY = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'now', label: 'Now', icon: Activity },
  { id: 'schedule', label: 'Schedule', icon: CalendarRange },
  { id: 'mix', label: 'Mix', icon: Combine },
  { id: 'symptoms', label: 'Symptoms', icon: HeartPulse },
  { id: 'more', label: 'More', icon: LayoutGrid },
]
const PRIMARY_IDS = new Set(PRIMARY.map((t) => t.id))

const SUB_TITLES = {
  library: 'Library', calc: 'Calculator', inventory: 'Stock', needle: 'Needle guide', settings: 'Settings',
}

export default function App() {
  const [tab, setTab] = useState('today')
  const [storageError, setStorageError] = useState(false)
  const theme = useStore((s) => s.settings.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    onStorageError(() => setStorageError(true))
  }, [])

  const Active = SCREENS[tab] || Today
  const isSub = !PRIMARY_IDS.has(tab)

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      {/* back bar for hub sub-screens */}
      <AnimatePresence>
        {isSub && (
          <motion.button
            initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}
            onClick={() => setTab('more')}
            className="sticky top-0 z-30 flex items-center gap-1 px-4 py-2.5 text-sm font-bold backdrop-blur-xl"
            style={{ background: 'color-mix(in srgb, var(--bg) 80%, transparent)', color: 'var(--muted)' }}
          >
            <ChevronLeft size={18} /> {SUB_TITLES[tab] || 'Back'}
          </motion.button>
        )}
      </AnimatePresence>

      <main className="flex-1 px-4 pb-28 pt-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -14 }}
            transition={{ duration: 0.18 }}
          >
            <Active goTo={setTab} />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl"
        style={{ background: 'color-mix(in srgb, var(--bg) 82%, transparent)', borderColor: 'var(--border)' }}
      >
        <div className="mx-auto grid max-w-3xl grid-cols-6 px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-2">
          {PRIMARY.map(({ id, label, icon: Icon }) => {
            const active = tab === id || (id === 'more' && isSub)
            return (
              <motion.button
                key={id}
                whileTap={{ scale: 0.86 }}
                onClick={() => setTab(id)}
                className="flex flex-col items-center gap-0.5 rounded-xl py-1"
                style={{ color: active ? 'var(--lime)' : 'var(--muted)' }}
              >
                <Icon size={21} strokeWidth={active ? 2.5 : 2} />
                <span className="text-[9.5px] font-bold leading-none">{label}</span>
                {active && <motion.div layoutId="tab-dot" className="mt-0.5 h-1 w-1 rounded-full" style={{ background: 'var(--lime)' }} />}
              </motion.button>
            )
          })}
        </div>
      </nav>

      <CelebrationLayer />

      <AnimatePresence>
        {storageError && (
          <motion.div
            initial={{ y: -60 }} animate={{ y: 0 }} exit={{ y: -60 }}
            className="fixed inset-x-4 top-3 z-[90] rounded-2xl p-3 text-sm font-semibold"
            style={{ background: 'var(--coral)', color: '#fff' }}
          >
            Storage is unavailable — changes may not persist on this device.
            <button className="ml-2 underline" onClick={() => setStorageError(false)}>Dismiss</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
