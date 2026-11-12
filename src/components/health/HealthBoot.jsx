import { useEffect } from 'react'
import NativeHealthFeed from './NativeHealthFeed'
import useStore from '../../store/useStore'
import { useHealth, startAutoSync } from '../../health/state'
import { useHealthLink } from '../../lib/healthLink'
import { useHeartLane } from '../../lib/heartLane'
import { fetchOvernight } from '../../lib/weather'

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
  const daily = useHealth((s) => s.data.daily)

  // tell the always-present screens what they may show
  useEffect(() => { useHealthLink.setState({ available }) }, [available])
  useEffect(() => {
    useHealthLink.getState().setWorkoutDates(new Set(workouts.map((w) => w.date)))
  }, [workouts])
  // body readings only: the selector in src/body merges them with manual entries
  useEffect(() => {
    useHealthLink.getState().setBodyDaily(daily
      .filter((r) => r.weight != null || r.bodyFatPct != null || r.leanMass != null || r.bpSys != null)
      .map((r) => ({ date: r.date, weight: r.weight, weightSource: r.weightSource, bodyFatPct: r.bodyFatPct, leanMass: r.leanMass, bpSys: r.bpSys, bpDia: r.bpDia })))
  }, [daily])

  // resting heart rate for the "Heart" lane in every chart's overlay menu
  useEffect(() => {
    useHeartLane.setState({ points: daily.filter((r) => r.restingHR != null).map((r) => ({ date: r.date, value: r.restingHR })) })
  }, [daily])

  // overnight outside temperature for each night (iPhone app; Open-Meteo, position and dates only)
  const nights = useHealth((s) => s.data.nights)
  const weather = useStore((s) => s.weatherSettings)
  useEffect(() => {
    if (!__NATIVE__ || !connected || weather?.enabled === false || !nights.length) return undefined
    let stop = false
    const dates = nights.map((n) => n.date)
    const today = new Date().toISOString().slice(0, 10)
    void fetchOvernight({ lat: weather.lat, lon: weather.lon, nights: dates, cached: useStore.getState().weatherNights || {}, today })
      .then((got) => { if (!stop && Object.keys(got).length) useStore.getState().mergeWeatherNights(got) })
    return () => { stop = true }
  }, [nights, connected, weather?.enabled, weather?.lat, weather?.lon])

  useEffect(() => {
    if (!available || !connected) return undefined
    return startAutoSync(() => useStore.getState().healthSettings.sleepPriority, () => useStore.getState().healthSettings.sleepSource ?? null)
  }, [available, connected])

  // readiness for the widgets, the Watch and Siri (iPhone app only)
  return __NATIVE__ && available && connected ? <NativeHealthFeed /> : null
}
