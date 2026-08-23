import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, CalendarDays, HeartPulse, LayoutGrid, ChevronLeft, PersonStanding, Plus,
} from 'lucide-react'

import useStore, { onStorageError } from './store/useStore'
import { haptic } from './lib/feedback'
import Home from './components/Home'
import ProtocolTab from './components/ProtocolTab'
import CalendarTab from './components/CalendarTab'
import CalcTab from './components/CalcTab'
import MixTab from './components/MixTab'
import SuppliesTab from './components/SuppliesTab'
import SettingsTab from './components/SettingsTab'
import RightNowTab from './components/RightNowTab'
import SymptomsTab from './components/SymptomsTab'
import BodyTab from './components/BodyTab'
import HistoryTab from './components/HistoryTab'
import SupplementsTab from './components/SupplementsTab'
import ScheduleWizard from './components/ScheduleWizard'
import MoreHub from './components/MoreHub'
import Toast from './components/Toast'
import UpdatePrompt from './components/UpdatePrompt'

// full registry of every screen
const SCREENS = {
  today: Home,
  calendar: CalendarTab,
  now: RightNowTab,
  mix: MixTab,
  symptoms: SymptomsTab,
  body: BodyTab,
  more: MoreHub,
  protocol: ProtocolTab,
  calc: CalcTab,
  supplies: SuppliesTab,
  settings: SettingsTab,
  history: HistoryTab,
  supplements: SupplementsTab,
}

// Five primary tabs in the bottom bar; everything else lives under More.
const PRIMARY = [
  { id: 'today', label: 'Home', icon: Sun },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'symptoms', label: 'Symptoms', icon: HeartPulse },
  { id: 'body', label: 'Body', icon: PersonStanding },
  { id: 'more', label: 'More', icon: LayoutGrid },
]
const PRIMARY_IDS = new Set(PRIMARY.map((t) => t.id))

const SUB_TITLES = {
  now: 'Right Now', protocol: 'My protocol', supplies: 'Stock', calc: 'Calculator',
  mix: 'Mix', settings: 'Settings', history: 'History', supplements: 'Supplements',
}

// Screens that were their own destination in an earlier version. Old deep links
// still point at them, so they're mapped rather than left to fall through to
// Home. `library` is here because it was a real screen for many versions — its
// reference content now lives in the compound sheet, and its "what am I on"
// job is what My protocol does.
const ALIASES = {
  schedule: 'protocol', library: 'protocol', inventory: 'supplies', restock: 'supplies',
  insights: 'history', recap: 'history', needle: 'settings',
}

export default function App() {
  const [tab, setTab] = useState('today')
  const [wizard, setWizard] = useState(false)
  const peptides = useStore((s) => s.peptides)
  const coachMarks = useStore((s) => s.coachMarks)
  const markCoachSeen = useStore((s) => s.markCoachSeen)

  // 'wizard' isn't a screen — it's a modal any screen can ask for.
  const goTo = (id) => (id === 'wizard' ? setWizard(true) : setTab(ALIASES[id] || id))

  // Offered once, unprompted, when there's nothing to track yet.
  useEffect(() => {
    if (peptides.length === 0 && !coachMarks?.['wizard-offered'] && !coachMarks?.['wizard-done']) {
      setWizard(true)
      markCoachSeen('wizard-offered')
    }
  }, [peptides.length, coachMarks, markCoachSeen])
  const [storageError, setStorageError] = useState(false)
  const theme = useStore((s) => s.settings.theme)
  const haptics = useStore((s) => s.settings.haptics)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    onStorageError(() => setStorageError(true))
  }, [])

  // A new screen starts at its top. Without this the window keeps whatever
  // scroll the previous screen had, which leaves the sticky back bar parked
  // over the new screen's heading.
  useEffect(() => { window.scrollTo(0, 0) }, [tab])

  // The bottom nav's real height (icons + labels + the iOS home-indicator inset)
  // is published as --nav-h so floating bars and scroll padding sit above it
  // instead of guessing a pixel value that's wrong on notched phones.
  const navRef = useRef(null)
  useLayoutEffect(() => {
    const el = navRef.current
    if (!el) return
    const publish = () => {
      document.documentElement.style.setProperty('--nav-h', `${Math.round(el.offsetHeight)}px`)
    }
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The FAB is shared chrome, but what it *does* is screen-specific (on Home
  // it opens the next unlogged dose). Rather than lift that logic up, Home
  // registers a handler here and the FAB just calls whatever's registered —
  // an extra entry point into the existing log flow, not a new one.
  const quickActionRef = useRef(null)
  const onQuickAction = useCallback((fn) => { quickActionRef.current = fn }, [])

  const Active = SCREENS[tab] || Home
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

      <main className="flex-1 px-4 pt-5" style={{ paddingBottom: 'calc(var(--nav-h, 76px) + 28px)' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -14 }}
            transition={{ duration: 0.18 }}
          >
            <Active goTo={goTo} onQuickAction={tab === 'today' ? onQuickAction : undefined} />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* bottom chrome: a floating pill nav plus a separate circular "+" for
          the primary quick action — both siblings in one fixed row so their
          spacing is trivial and --nav-h keeps meaning "total reserved bottom
          chrome height", unchanged from the old full-width bar. */}
      <footer
        ref={navRef}
        className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pt-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 14px)' }}
      >
        <div className="mx-auto flex w-full max-w-3xl items-center justify-center gap-2">
          <nav
            className="flex items-center rounded-full p-1"
            style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-nav)' }}
          >
            {PRIMARY.map(({ id, label, icon: Icon }) => {
              const active = tab === id || (id === 'more' && isSub)
              return (
                <motion.button
                  key={id}
                  whileTap={{ scale: 0.86 }}
                  onClick={() => { if (haptics) { try { haptic(6) } catch { /* optional */ } } setTab(id) }}
                  className="relative flex flex-col items-center gap-0.5 rounded-full px-1.5 py-1"
                  aria-label={label}
                >
                  {active && (
                    <motion.div layoutId="tab-pill" className="absolute inset-0 rounded-full"
                      style={{ background: 'var(--surface2)' }} transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
                  )}
                  <span className="relative" style={{ color: active ? 'var(--violet)' : 'var(--muted)' }}>
                    <Icon size={28} strokeWidth={active ? 2.5 : 2} />
                  </span>
                  <span className="relative text-[7px] font-bold leading-none tracking-tight" style={{ color: active ? 'var(--violet)' : 'var(--muted)' }}>
                    {label}
                  </span>
                </motion.button>
              )
            })}
          </nav>

          {tab === 'today' && (
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => { if (haptics) { try { haptic(8) } catch { /* optional */ } } quickActionRef.current?.() }}
              aria-label="Quick log"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', boxShadow: 'var(--shadow-fab)' }}
            >
              <Plus size={26} color="#fff" strokeWidth={2.5} />
            </motion.button>
          )}
        </div>
      </footer>

      <ScheduleWizard open={wizard} onClose={() => setWizard(false)} />

      <Toast />
      <UpdatePrompt />

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
