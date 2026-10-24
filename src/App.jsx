import { useState, useEffect, useLayoutEffect, useRef, Suspense, lazy } from 'react'
import ErrorBoundary from './components/ui/ErrorBoundary'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, LayoutGrid, ChevronLeft, PersonStanding, Moon, Flame,
} from 'lucide-react'

import useStore, { onStorageError } from './store/useStore'
import { haptic } from './lib/feedback'
import { useVisualViewport, useKeyboardSafeFocus } from './lib/viewport'
import Home from './components/Home'
import useLowStockDot from './lib/useLowStock'
import MoreHub from './components/MoreHub'
import Toast from './components/Toast'
import VialPromptHost from './components/stock/VialPromptHost'
import UpdatePrompt from './components/UpdatePrompt'
import { HEALTH_BUILD, HealthBoot, HealthSettings, SleepTab } from './health/ui'
import { useNativeFeed } from './native/feed'
import { ShortcutsScreen, NotificationsScreen, WatchScreen, LockSettingsScreen, LockGate } from './native/ui'

const ProtocolTab = lazy(() => import('./components/ProtocolTab'))
const CalendarTab = lazy(() => import('./components/CalendarTab'))
const CalcTab = lazy(() => import('./components/CalcTab'))
const MixTab = lazy(() => import('./components/MixTab'))
const SuppliesTab = lazy(() => import('./components/SuppliesTab'))
const SettingsTab = lazy(() => import('./components/SettingsTab'))
const RightNowTab = lazy(() => import('./components/RightNowTab'))
const ReactionsScreen = lazy(() => import('./components/ReactionsScreen'))
const SaunaTab = lazy(() => import('./components/sauna/SaunaTab'))
const BodyTab = lazy(() => import('./components/BodyTab'))
const HistoryTab = lazy(() => import('./components/HistoryTab'))
const SupplementsTab = lazy(() => import('./components/SupplementsTab'))
const BloodsTab = lazy(() => import('./components/BloodsTab'))
const ImportScans = lazy(() => import('./components/ImportScans'))
const DataReports = lazy(() => import('./components/data/DataReports'))
const ScheduleWizard = lazy(() => import('./components/ScheduleWizard'))

/** While a screen's code loads: a quiet placeholder rather than a blank page. */
function ScreenLoading() {
  return <div className="card p-5" aria-busy="true" data-testid="screen-loading"><div className="h-4 w-1/3 rounded-full" style={{ background: 'var(--surface-sunk)' }} /><div className="mt-3 h-3 w-2/3 rounded-full" style={{ background: 'var(--surface-sunk)' }} /></div>
}

// full registry of every screen. Home is in the first bundle; every other
// screen loads when it is first opened, so the app starts on less code.
const SCREENS = {
  today: Home,
  calendar: CalendarTab,
  now: RightNowTab,
  mix: MixTab,
  reactions: ReactionsScreen,
  body: BodyTab,
  sauna: SaunaTab,
  bloods: BloodsTab,
  more: MoreHub,
  protocol: ProtocolTab,
  calc: CalcTab,
  supplies: SuppliesTab,
  settings: SettingsTab,
  history: HistoryTab,
  supplements: SupplementsTab,
  scans: ImportScans,
  reports: DataReports,
  // native app only: compiled out of the web build
  ...(HEALTH_BUILD ? { health: HealthSettings, sleep: SleepTab, shortcuts: ShortcutsScreen, notifications: NotificationsScreen, watch: WatchScreen, lock: LockSettingsScreen } : {}),
}

// Primary tabs in the bottom bar; everything else lives under More (Calendar,
// Reactions, Bloods and Stock are its first rows). Sleep reads Apple Health, so
// it is only in the iPhone app; the web build has four tabs.
const PRIMARY = [
  { id: 'today', label: 'Home', icon: Sun },
  { id: 'body', label: 'Body', icon: PersonStanding },
  ...(HEALTH_BUILD ? [{ id: 'sleep', label: 'Sleep', icon: Moon }] : []),
  { id: 'sauna', label: 'Sauna', icon: Flame },
  { id: 'more', label: 'More', icon: LayoutGrid },
]
const PRIMARY_IDS = new Set(PRIMARY.map((t) => t.id))

const SUB_TITLES = {
  now: 'Right Now', protocol: 'My protocol', supplies: 'Stock', calc: 'Calculator',
  mix: 'Mix', settings: 'Settings', history: 'History', supplements: 'Supplements',
  health: 'Health', shortcuts: 'Shortcuts and widgets', notifications: 'Notifications', watch: 'Apple Watch', lock: 'Face ID lock', scans: 'Import scans', reports: 'Backups and reports', reactions: 'Reactions', bloods: 'Bloods', calendar: 'Calendar',
}

// Screens that were their own destination in an earlier version. Old deep links
// still point at them, so they're mapped rather than left to fall through to
// Home. `library` is here because it was a real screen for many versions — its
// reference content now lives in the compound sheet, and its "what am I on"
// job is what My protocol does.
const ALIASES = {
  schedule: 'protocol', library: 'protocol', inventory: 'supplies', restock: 'supplies',
  insights: 'history', recap: 'history', needle: 'settings',
  // stage 2D: Symptoms ("how I feel") and Supplies left the app; their data stays stored
  symptoms: 'reactions', gear: 'more',
}

export default function App() {
  const [tab, setTab] = useState('today')
  const [wizard, setWizard] = useState(false)
  const peptides = useStore((s) => s.peptides)
  const coachMarks = useStore((s) => s.coachMarks)
  const markCoachSeen = useStore((s) => s.markCoachSeen)

  // 'wizard' isn't a screen — it's a modal any screen can ask for.
  const goTo = (id) => (id === 'wizard' ? setWizard(true) : setTab(ALIASES[id] || id))

  // the bottom-bar tabs' code, fetched once the app is idle after start-up, so
  // the first tap on Body or Sauna opens at once
  useEffect(() => {
    const id = setTimeout(() => {
      void import('./components/BodyTab'); void import('./components/sauna/SaunaTab')
      if (HEALTH_BUILD) void import('./components/health/SleepTab')
    }, 2500)
    return () => clearTimeout(id)
  }, [])

  // iPhone app: a notification tap (Open Stock, Check now) asks for a screen
  const nativeRoute = useNativeFeed((s) => s.route)
  useEffect(() => {
    if (!nativeRoute) return
    if (nativeRoute === 'count') {
      setTab('supplies')
      useNativeFeed.setState({ openCount: true })
    } else if (nativeRoute === 'evening') {
      setTab('sleep')
      useNativeFeed.setState({ openEvening: true })
    } else if (SCREENS[ALIASES[nativeRoute] || nativeRoute]) setTab(ALIASES[nativeRoute] || nativeRoute)
    useNativeFeed.setState({ route: null })
  }, [nativeRoute])

  // A compound set to restart from the floor starts its new on-cycle stretch
  // there. Checked on opening, on coming back to the app, and through the day,
  // so it is right across midnight even if the app was never closed.
  useEffect(() => {
    const run = () => {
      useStore.getState().applyCycleRestarts?.()
      // a mixed vial that has reached the end of its fridge life: asked once
      useStore.getState().checkVialExpiry?.()
    }
    run()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(run, 15 * 60 * 1000)
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(id) }
  }, [])

  // Offered once, unprompted, when there's nothing to track yet.
  useEffect(() => {
    if (peptides.length === 0 && !coachMarks?.['wizard-offered'] && !coachMarks?.['wizard-done']) {
      setWizard(true)
      markCoachSeen('wizard-offered')
    }
  }, [peptides.length, coachMarks, markCoachSeen])
  const [storageError, setStorageError] = useState(false)
  const haptics = useStore((s) => s.settings.haptics)
  const lowStock = useLowStockDot()

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

  // Fields on a full screen have the same problem as fields in a sheet: focus
  // one near the bottom and the keyboard covers it. One listener on <main>
  // covers every screen rather than each of them remembering to.
  const mainRef = useRef(null)
  useKeyboardSafeFocus(mainRef)
  const vp = useVisualViewport()

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
            className="sticky top-0 z-30 flex items-center gap-1 px-4 py-3 text-sm font-bold backdrop-blur-xl"
            style={{ background: 'color-mix(in srgb, var(--bg) 80%, transparent)', color: 'var(--text-2)' }}
          >
            <ChevronLeft size={18} /> {SUB_TITLES[tab] || 'Back'}
          </motion.button>
        )}
      </AnimatePresence>

      <main
        ref={mainRef}
        className="flex-1 px-4 pt-5"
        style={{ paddingBottom: 'calc(var(--nav-h, 76px) + 28px)' }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -14 }}
            transition={{ duration: 0.18 }}
          >
            <ErrorBoundary key={tab} where={tab}><Suspense fallback={<ScreenLoading />}><Active goTo={goTo} /></Suspense></ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>

      {HEALTH_BUILD && <Suspense fallback={null}><HealthBoot /></Suspense>}
      {__NATIVE__ && <Suspense fallback={null}><LockGate /></Suspense>}

      {/* bottom tab bar */}
      <nav
        ref={navRef}
        className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl transition-opacity"
        // While the keyboard is up the bar is either behind it or floating over
        // the field being typed into. Neither is any use, and both are in the way.
        style={{
          background: 'color-mix(in srgb, var(--bg) 82%, transparent)',
          borderColor: 'var(--border)',
          opacity: vp.keyboardOpen ? 0 : 1,
          pointerEvents: vp.keyboardOpen ? 'none' : undefined,
        }}
      >
        <div className="mx-auto grid max-w-3xl px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-2" style={{ gridTemplateColumns: `repeat(${PRIMARY.length}, minmax(0, 1fr))` }}>
          {PRIMARY.map(({ id, label, icon: Icon }) => {
            const active = tab === id || (id === 'more' && isSub)
            return (
              <motion.button
                key={id}
                whileTap={{ scale: 0.86 }}
                onClick={() => { if (haptics) { try { haptic(6) } catch { /* optional */ } } setTab(id) }}
                className="flex min-w-0 flex-col items-center gap-1 rounded-xl py-1.5"
                style={{ color: active ? 'var(--lime)' : 'var(--muted)' }}
                aria-label={label}
              >
                {/* five across a 390px phone leaves ~76px a column; the label
                    is sized never to wrap */}
                <span className="relative">
                  <Icon size={28} strokeWidth={active ? 2.5 : 2} />
                  {/* a compound running low: a small dot, the Stock row says which */}
                  {id === 'more' && lowStock && <i aria-hidden="true" className="absolute -right-0.5 -top-0.5 block h-2 w-2 rounded-full" style={{ background: 'var(--warn)' }} data-testid="more-low-dot" />}
                </span>
                <span className="max-w-full truncate text-[10px] font-bold leading-none">{label}</span>
                {active && <motion.div layoutId="tab-dot" className="mt-0.5 h-1 w-1 rounded-full" style={{ background: 'var(--lime)' }} />}
              </motion.button>
            )
          })}
        </div>
      </nav>

      {wizard && <Suspense fallback={null}><ScheduleWizard open={wizard} onClose={() => setWizard(false)} /></Suspense>}

      <Toast />
      <VialPromptHost goTo={goTo} />
      <UpdatePrompt />

      <AnimatePresence>
        {storageError && (
          <motion.div
            initial={{ y: -60 }} animate={{ y: 0 }} exit={{ y: -60 }}
            className="fixed inset-x-4 top-3 z-[90] rounded-[14px] p-3 text-sm font-semibold"
            style={{ background: 'var(--danger)', color: 'var(--accent-fg)' }}
          >
            Storage is unavailable, changes may not persist on this device.
            <button className="ml-2 underline" onClick={() => setStorageError(false)}>Dismiss</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
