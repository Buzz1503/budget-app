import { useEffect } from 'react'
import useStore, { todayStr } from '../../store/useStore'
import { planBedtime } from '../../health/engine/planner'
import { nightsEnding } from '../../health/engine/sleep'
import { addDays } from '../../health/tz'
import { useHealth } from '../../health/state'
import { rowFor } from '../../health/engine/model'
import { useNativeFeed } from '../../native/feed'
import useHealthModel, { tz } from './useHealthModel'
import { soundsNight } from '../../sleep/sounds'

/**
 * Hands today's readiness, last night's sleep and the max heart rate to the
 * native snapshot (widgets, the Watch, Siri). iPhone app only. Renders nothing.
 */
export default function NativeHealthFeed() {
  const model = useHealthModel()
  const lastSyncAt = useHealth((s) => s.data.meta?.lastSyncAt || null)
  const t = todayStr()
  const wakeTarget = useStore((s) => s.healthSettings.wakeTarget)
  const extras = useStore((s) => s.nightExtras?.[todayStr()])
  useEffect(() => {
    const r = model.readiness(t)
    const night = model.nightBy.get(t)
    const rhr = rowFor(model, 'rhr', t)
    const hrv = rowFor(model, 'hrv', t)
    // tonight's planned bedtime and the usual wake time: the evening prompt, the
    // morning check and Screen Time's late phone use all hang off these
    const plan = model.nightBy.size ? planBedtime({
      recent: nightsEnding(model.nightBy, t, 14), debtH: model.debtH(t), needH: model.needH,
      yesterdayLoad: model.loadVsUsual(addDays(t, -1)).label, wakeTarget, tz,
    }) : null
    useNativeFeed.getState().setHealth({
      maxHR: model.maxHR,
      plannedBedtime: plan?.bedtime ?? null,
      usualWake: plan?.wake ?? null,
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
      // last night for the Watch's sleep tile, complication and morning screen
      lastNight: night ? {
        date: t,
        asleepMin: Math.round(night.asleepMin),
        score: model.sleepScore(t)?.score ?? null,
        readiness: r.status === 'ok' ? r.score : null,
        restless: extras?.restless?.restlessPeriods ?? null,
        snoringMin: extras?.sounds?.length ? Math.round(soundsNight(extras.sounds, null)?.snoringMin ?? 0) : null,
      } : null,
    })
    // remembered, so the prompts are still planned before Health has loaded next launch
    const ss = useStore.getState().sleepSettings || {}
    if (plan && (ss.lastBedtime !== plan.bedtime || ss.lastWake !== plan.wake)) {
      useStore.getState().setSleepSettings({ lastBedtime: plan.bedtime, lastWake: plan.wake })
    }
  }, [model, t, lastSyncAt, wakeTarget, extras])
  return null
}
