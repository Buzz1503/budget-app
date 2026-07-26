import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, CalendarRange, FlaskConical, Combine, Package, Syringe as SyringeIcon, Settings as SettingsIcon, BookOpen,
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
import CelebrationLayer from './components/CelebrationLayer'

const TABS = [
  { id: 'today', label: 'Today', icon: Sun, comp: Today },
  { id: 'library', label: 'Library', icon: BookOpen, comp: Library },
  { id: 'schedule', label: 'Schedule', icon: CalendarRange, comp: Schedule },
  { id: 'calc', label: 'Calc', icon: FlaskConical, comp: CalcTab },
  { id: 'mix', label: 'Mix', icon: Combine, comp: MixTab },
  { id: 'inventory', label: 'Stock', icon: Package, comp: InventoryTab },
  { id: 'needle', label: 'Needle', icon: SyringeIcon, comp: NeedleTab },
  { id: 'settings', label: 'More', icon: SettingsIcon, comp: SettingsTab },
]

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

  const Active = TABS.find((t) => t.id === tab)?.comp || Today

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
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
        <div className="mx-auto grid max-w-3xl grid-cols-8 px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-2">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id
            return (
              <motion.button
                key={id}
                whileTap={{ scale: 0.88 }}
                onClick={() => setTab(id)}
                className="flex flex-col items-center gap-0.5 rounded-xl py-1"
                style={{ color: active ? 'var(--lime)' : 'var(--muted)' }}
              >
                <Icon size={19} strokeWidth={active ? 2.4 : 2} />
                <span className="text-[9.5px] font-semibold leading-none">{label}</span>
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
            className="fixed inset-x-4 top-3 z-[60] rounded-2xl p-3 text-sm font-semibold"
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
