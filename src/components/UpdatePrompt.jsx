import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, WifiOff } from 'lucide-react'
import { setupPWA } from '../pwa'

// "New version available — refresh" prompt, plus a one-time offline-ready note.
export default function UpdatePrompt() {
  const [applyUpdate, setApplyUpdate] = useState(null)
  const [offlineReady, setOfflineReady] = useState(false)

  useEffect(() => {
    setupPWA({
      onNeedRefresh: (apply) => setApplyUpdate(() => apply),
      onOfflineReady: () => {
        setOfflineReady(true)
        setTimeout(() => setOfflineReady(false), 4000)
      },
    })
  }, [])

  return (
    <AnimatePresence>
      {applyUpdate && (
        <motion.div
          key="update"
          initial={{ y: 70, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 70, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="fixed inset-x-4 z-[85] flex items-center gap-3 rounded-2xl p-3 shadow-lg"
          style={{ bottom: 'calc(var(--nav-h, 76px) + 10px)', background: 'var(--surface-solid)', border: '1px solid var(--border)' }}
        >
          <RefreshCw size={17} className="shrink-0" style={{ color: 'var(--lime)' }} />
          <p className="flex-1 text-xs font-bold">New version available</p>
          <button onClick={() => applyUpdate()}
            className="btn-primary rounded-full px-3 py-2 text-xs font-black">
            Refresh
          </button>
          <button onClick={() => setApplyUpdate(null)}
            className="rounded-full px-2.5 py-2 text-xs font-bold" style={{ background: 'var(--surface2)' }}>
            Later
          </button>
        </motion.div>
      )}

      {offlineReady && !applyUpdate && (
        <motion.div
          key="offline"
          initial={{ y: 70, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 70, opacity: 0 }}
          className="fixed inset-x-4 bottom-[86px] z-[85] flex items-center gap-2 rounded-2xl p-3"
          style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)' }}
        >
          <WifiOff size={15} style={{ color: 'var(--indigo)' }} />
          <p className="text-xs font-bold">Ready to work offline</p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
