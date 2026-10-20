import { useEffect } from 'react'
import { todayStr } from '../../store/useStore'
import { useHealth } from '../../health/state'
import { rowFor } from '../../health/engine/model'
import { useNativeFeed } from '../../native/feed'
import useHealthModel from './useHealthModel'

/**
 * Hands today's readiness, last night's sleep and the max heart rate to the
 * native snapshot (widgets, the Watch, Siri). iPhone app only. Renders nothing.
 */
export default function NativeHealthFeed() {
  const model = useHealthModel()
  const lastSyncAt = useHealth((s) => s.data.meta?.lastSyncAt || null)
  const t = todayStr()
  useEffect(() => {
    const r = model.readiness(t)
    const night = model.nightBy.get(t)
    const rhr = rowFor(model, 'rhr', t)
    const hrv = rowFor(model, 'hrv', t)
    useNativeFeed.getState().setHealth({
      maxHR: model.maxHR,
      readiness: {
        score: r.status === 'ok' ? r.score : null,
        band: r.status === 'ok' ? r.band : null,
        bandLabel: r.status === 'ok' ? r.bandLabel : null,
        status: r.status,
        asOf: lastSyncAt,
        rhr: rhr.value ?? null,
        rhrDelta: rhr.delta ?? null,
        hrv: hrv.value ?? null,
        hrvDelta: hrv.delta ?? null,
        sleepMin: night?.asleepMin ?? null,
      },
    })
  }, [model, t, lastSyncAt])
  return null
}
