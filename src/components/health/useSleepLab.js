import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import useStore from '../../store/useStore'
import { addDays } from '../../health/tz'
import { clockFromNoon } from '../../health/engine/sleep'
import { hrDip } from '../../health/overnight'
import { nightFeatures } from '../../sleep/features'
import { soundsNight } from '../../sleep/sounds'
import { spo2Night } from '../../sleep/oxygen'
import { buildRows } from '../../sleep/analysis/dataset'
import { useCompounds } from '../../lib/useCompounds'
import useHealthModel, { tz } from './useHealthModel'

/**
 * Everything the Sleep Lab knows about each night, gathered from Health and
 * the store: the night features (what was logged and done), the measured
 * extras (Watch movement, Sleep sounds, Screen Time), and one analysis row
 * per night. The analysis itself runs elsewhere (useSleepAnalysis).
 */
export default function useSleepLab() {
  const model = useHealthModel()
  const compounds = useCompounds()
  const s = useStore(useShallow((st) => ({
    asNeededItems: st.asNeededItems, asNeededLogs: st.asNeededLogs, supplements: st.supplements, supplementLogs: st.supplementLogs,
    doseLogs: st.doseLogs, habitLogs: st.habitLogs, habits: st.habits, eveningDetails: st.eveningDetails, saunaSessions: st.saunaSessions,
    morningChecks: st.morningChecks, nightExtras: st.nightExtras, lateUse: st.lateUse, sleepSettings: st.sleepSettings,
  })))

  return useMemo(() => {
    const nights = [...model.nightBy.values()]
    const daily = model.dailyBy
    const features = nightFeatures({
      tz, nights,
      asNeededItems: s.asNeededItems, asNeededLogs: s.asNeededLogs,
      supplements: s.supplements, supplementLogs: s.supplementLogs,
      doseLogs: s.doseLogs, compounds: compounds.map((c) => ({ id: c.id, name: c.name })),
      habitLogs: s.habitLogs, habits: s.habits, eveningDetails: s.eveningDetails,
      workouts: model.sessions.map((w) => ({ start: w.start, end: w.end, energyKcal: w.energyKcal })),
      load: model.load,
      sauna: s.saunaSessions,
      daylight: new Map(model.daily.filter((r) => r.daylightMin != null).map((r) => [r.date, r.daylightMin])),
      steps: new Map(model.daily.filter((r) => r.steps != null).map((r) => [r.date, r.steps])),
      naps: nights.flatMap((n) => (n.naps || []).map((x) => ({ date: n.date, start: x.start, end: x.end }))),
    })
    const featureBy = new Map(features.map((f) => [f.date, f]))
    const inputs = new Map()
    const extras = new Map()
    for (const n of nights) {
      const o = n.overnight || null
      const evening = addDays(n.date, -1)
      const dayBefore = daily.get(evening)
      const ex = s.nightExtras[n.date] || {}
      const sounds = soundsNight(ex.sounds || [], { start: n.start, end: n.end, asleepMin: n.asleepMin })
      const spo2 = spo2Night(o?.spo2)
      const readiness = model.readiness(n.date)
      const input = {
        date: n.date,
        asleepMin: n.asleepMin ?? null,
        deepMin: n.hasStages ? n.deepMin : null,
        remMin: n.hasStages ? n.remMin : null,
        awakeMin: o?.wasoMin ?? n.awakeMin ?? null,
        awakenings: o?.awakenings ?? null,
        hrLow: n.sleepingHR?.min ?? null,
        hrAvg: n.sleepingHR?.avg ?? null,
        hrv: model.series.hrv.get(n.date) ?? null,
        score: model.sleepScore(n.date)?.score ?? null,
        rhrNext: model.series.rhr.get(n.date) ?? null,
        readinessNext: readiness.status === 'ok' ? readiness.score : null,
        breathing: o?.breathing ?? null,
        spo2Dips: spo2.readings ? spo2.dips : null,
        restless: ex.restless || null,
        sounds,
        morning: s.morningChecks[n.date] || null,
        lateUseMin: s.lateUse[evening] ?? null,
        audio: o ? o.audio : null,
        latencyMin: o?.latencyMin ?? null,
        hrDipPct: hrDip(n.sleepingHR?.avg, dayBefore?.hrDaytime),
        daylightMorningMin: dayBefore?.daylightMorningMin ?? null,
        waterL: dayBefore?.dietWater != null ? Math.round(dayBefore.dietWater / 100) / 10 : null,
      }
      inputs.set(n.date, input)
      extras.set(n.date, { night: n, overnight: o, sounds, spo2, restless: ex.restless || null, feature: featureBy.get(n.date), input })
    }
    const rows = buildRows(features, inputs)
    const timing = nights.map((n) => [n.date, { bedFromNoon: clockFromNoon(n.start, tz), wakeFromNoon: clockFromNoon(n.end, tz) }])
    const names = {
      habits: Object.fromEntries(s.habits.map((h) => [h.id, h.name])),
      asNeeded: Object.fromEntries(s.asNeededItems.map((i) => [i.id, i.name])),
      supplements: Object.fromEntries(s.supplements.map((x) => [x.id, x.name])),
      compounds: Object.fromEntries(compounds.map((c) => [c.id, c.name])),
    }
    return { model, features, featureBy, inputs, extras, rows, timing, names, needMin: Math.round(model.needH * 60) }
  }, [model, compounds, s])
}
