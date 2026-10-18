import { useEffect } from 'react'
import useStore from '../../store/useStore'
import { useHealth, startAutoSync } from '../../health/state'
import { useHealthLink } from '../../lib/healthLink'

/**
 * Starts Health reading once the user has connected: a sync on launch and one
 * every time the app comes back to the foreground. Renders nothing.
 */
export default function HealthBoot() {
  const available = useHealth((s) => s.available)
  const connected = useStore((s) => s.healthSettings.connected)
  const load = useHealth((s) => s.load)
  useEffect(() => { if (available) void load() }, [available, load])

  const workouts = useHealth((s) => s.data.workouts)

  // tell the always-present screens what they may show
  useEffect(() => { useHealthLink.setState({ available }) }, [available])
  useEffect(() => {
    useHealthLink.getState().setWorkoutDates(new Set(workouts.map((w) => w.date)))
  }, [workouts])

  useEffect(() => {
    if (!available || !connected) return undefined
    return startAutoSync(() => useStore.getState().healthSettings.sleepPriority)
  }, [available, connected])

  return null
}
