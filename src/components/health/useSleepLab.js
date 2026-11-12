import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import useStore from '../../store/useStore'
import { addDays } from '../../health/tz'
import { clockFromNoon } from '../../health/engine/sleep'
import { hrDip } from '../../health/overnight'
import { nightFeatures } from '../../sleep/features'
import { autoContext } from '../../sleep/autoContext'
import { outlierReasons } from '../../sleep/outliers'
import { doseSegments } from '../../health/heart'
import { spo2Night } from '../../sleep/oxygen'
import { buildRows } from '../../sleep/analysis/dataset'
import { detectEvents, calibrate, truthOf } from '../../sleep/nightmares'
import { restlessNight } from '../../sleep/restless'
import { useCompounds } from '../../lib/useCompounds'
import useHealthModel, { tz } from './useHealthModel'

/**
 * Everything the Sleep Lab knows about each night, gathered from Health and
 * the store: the night features (what was logged and done), the measured
 * extras (Apple Health's restless-night measures, Screen Time), and one
 * analysis row per night. A night from another source than the chosen one
 * ("Other source") is shown but left out of the analysis. The analysis
 * itself runs elsewhere (useSleepAnalysis).
 */
const clockMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) }

export default function useSleepLab() {
  const model = useHealthModel()
  const compounds = useCompounds()
  const s = useStore(useShallow((st) => ({
    asNeededItems: st.asNeededItems, asNeededLogs: st.asNeededLogs, supplements: st.supplements, supplementLogs: st.supplementLogs,
    doseLogs: st.doseLogs, habitLogs: st.habitLogs, habits: st.habits, eveningDetails: st.eveningDetails, saunaSessions: st.saunaSessions,
    morningChecks: st.morningChecks, lateUse: st.lateUse, sleepSettings: st.sleepSettings,
    weatherNights: st.weatherNights, wakeReasons: st.wakeReasons,
  })))

  return useMemo(() => {
    const nights = [...model.nightBy.values()]
    // only the chosen sleep source feeds the analysis; a fallback night is shown, never analysed
    const chosen = nights.filter((n) => !(n.fallback || n.excluded))
    const daily = model.dailyBy
    const features = nightFeatures({
      tz, nights: chosen,
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
    // automatic context (late workouts, sauna near bed, consistency, breathing and wrist temperature
    // against your baseline, overnight outside temperature, injection timing, why I woke) joins each night
    const segs = new Map(compounds.map((c) => [c.id, doseSegments(c, model.today)]))
    // every night from the chosen source, excluded ones too, so an excluded night keeps its flags
    const own = nights.filter((n) => !n.fallback)
    const auto = autoContext({
      nights: own.map((n) => ({ date: n.date, start: n.start, end: n.end, respRate: n.overnight?.respRate ?? null })),
      hourOf: (ms) => tz.hourOf(ms),
      workouts: model.sessions.map((w) => ({ start: w.start, end: w.end, type: w.type, title: w.title })),
      sauna: (s.saunaSessions || []).map((x) => ({ date: x.date, end: x.endedAt ?? (x.startedAt ?? (tz.startOfDay(x.date) + clockMin(x.start) * 60000)) + (x.lengthMin || 0) * 60000 })),
      wristTemp: model.series.temp || new Map(),
      weather: s.weatherNights || {},
      doses: (s.doseLogs || []).map((l) => ({ compoundId: l.peptideId, t: l.loggedAt && !l.backfilled ? Date.parse(l.loggedAt) : Date.parse(`${l.date}T12:00:00`) })).filter((d) => Number.isFinite(d.t)),
      doseLevel: (id, date) => segs.get(id)?.find((g) => date >= g.from && date <= g.to)?.dose ?? null,
      compounds: compounds.map((c) => ({ id: c.id, name: c.name })),
      wakeReasons: s.wakeReasons,
    })
    for (const f of features) {
      const a = auto.get(f.date)
      if (!a) continue
      Object.assign(f.binary, a.binary)
      Object.assign(f.continuous, a.continuous)
      f.line = [...f.line, ...a.line]
    }
    const featureBy = new Map(features.map((f) => [f.date, f]))
    // outlier nights: possibly unwell, very short, an unusual bedtime, missing heart rate, away from home
    const outliers = own.map((n) => {
      const a = auto.get(n.date)
      const evening = s.habitLogs?.[addDays(n.date, -1)] || {}
      const reasons = outlierReasons({
        date: n.date, asleepMin: n.asleepMin ?? null, bedOffMin: a?.continuous.bedOffMin ?? null,
        wristTempDev: a?.continuous.wristTempDev ?? null, respDev: a?.continuous.respDev ?? null,
        missing: !n.overnight?.hr?.length, sick: evening.unwell === true, away: evening.away === true,
      })
      return { date: n.date, reasons, excluded: !!n.excluded }
    }).filter((o) => o.reasons.length || o.excluded)
    const outlierBy = new Map(outliers.map((o) => [o.date, o]))
    const inputs = new Map()
    const extras = new Map()
    // nightmare events per night, then a rating (fitted to your answers once there are enough)
    const sorted = [...nights].sort((a, b) => a.start - b.start)
    const eventsBy = new Map()
    sorted.forEach((n, i) => {
      const o = n.overnight
      if (!o?.hr?.length) return
      const prevResp = sorted.slice(Math.max(0, i - 28), i).map((x) => x.overnight?.respRate).filter((v) => v != null).sort((a, b) => a - b)
      const usualResp = prevResp.length >= 7 ? prevResp[Math.floor(prevResp.length / 2)] : null
      eventsBy.set(n.date, detectEvents({
        start: n.start, hr: o.hr, segments: n.segments, hrv: o.hrv || null,
        respAboveUsual: usualResp != null && o.respRate != null ? o.respRate > usualResp + 1 : null,
      }))
    })
    const cal = calibrate([...eventsBy.entries()].map(([d, events]) => ({ events, truth: truthOf(s.morningChecks[d]?.dreams) })))
    for (const n of nights) {
      const o = n.overnight || null
      const evening = addDays(n.date, -1)
      const dayBefore = daily.get(evening)
      const restless = restlessNight(n)
      const spo2 = spo2Night(o?.spo2)
      const readiness = model.readiness(n.date)
      const events = eventsBy.get(n.date) || null
      const rating = events ? cal.rate(events) : null
      const truth = truthOf(s.morningChecks[n.date]?.dreams)
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
        restless,
        morning: s.morningChecks[n.date] || null,
        lateUseMin: s.lateUse[evening] ?? null,
        audio: o ? o.audio : null,
        latencyMin: o?.latencyMin ?? null,
        hrDipPct: hrDip(n.sleepingHR?.avg, dayBefore?.hrDaytime),
        daylightMorningMin: dayBefore?.daylightMorningMin ?? null,
        waterL: dayBefore?.dietWater != null ? Math.round(dayBefore.dietWater / 100) / 10 : null,
        // the outcome for the analysis: your answer when there is one, else the estimate's Likely
        nightmare: truth != null ? (truth ? 1 : 0) : rating ? (rating === 'Likely' ? 1 : 0) : null,
      }
      inputs.set(n.date, input)
      extras.set(n.date, { night: n, overnight: o, spo2, restless, feature: featureBy.get(n.date), input, events, rating, truth })
    }
    const rows = buildRows(features, new Map([...inputs].filter(([d]) => { const x = model.nightBy.get(d); return !(x?.fallback || x?.excluded) })))
    const timing = nights.map((n) => [n.date, { bedFromNoon: clockFromNoon(n.start, tz), wakeFromNoon: clockFromNoon(n.end, tz) }])
    const names = {
      habits: Object.fromEntries(s.habits.map((h) => [h.id, h.name])),
      asNeeded: Object.fromEntries(s.asNeededItems.map((i) => [i.id, i.name])),
      supplements: Object.fromEntries(s.supplements.map((x) => [x.id, x.name])),
      compounds: Object.fromEntries(compounds.map((c) => [c.id, c.name])),
    }
    return { model, features, featureBy, inputs, extras, rows, timing, names, outliers, outlierBy, needMin: Math.round(model.needH * 60), calibration: { personal: cal.personal, confirmed: cal.confirmed } }
  }, [model, compounds, s])
}
