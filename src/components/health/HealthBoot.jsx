import { useEffect } from 'react'
import useStore from '../../store/useStore'
import { useHealth, startAutoSync } from '../../health/state'

/**
 * Starts Health reading once the user has connected: a sync on launch and one
 * every time the app comes back to the foreground. Renders nothing.
 */
export default function HealthBoot() {
  const available = useHealth((s) => s.available)
  const connected = useStore((s) => s.healthSettings.connected)

  useEffect(() => {
    if (!available || !connected) return undefined
    return startAutoSync(() => useStore.getState().healthSettings.sleepPriority)
  }, [available, connected])

  return null
}
