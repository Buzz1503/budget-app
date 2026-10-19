// One day at a glance, for the calendar's day sheet: readiness, sleep, heart,
// workouts, steps, the check-in, habits and the doses logged.

import type { HealthModel } from './model'
import { rowFor } from './model'
import type { BandId } from './readiness'

export interface DaySnapshot {
  date: string
  readiness: { score: number | null; band: BandId | null; status: string }
  sleep: { asleepMin: number; score: number | null; hasStages: boolean } | null
  rhr: { value: number | null; delta: number | null }
  hrv: { value: number | null; delta: number | null }
  workouts: Array<{ id: string; title: string; durationMin: number; avgHR: number | null; trimp: number }>
  steps: number | null
  checkin: Record<string, number> | null
  habits: Array<{ id: string; name: string; value: boolean }>
  doses: Array<{ peptideId: string; name: string }>
  hasHealth: boolean
}

export function daySnapshot(
  model: HealthModel,
  date: string,
  { checkins = {}, habitLogs = {}, habits = [], doseLogs = [], compounds = [] }: {
    checkins?: Record<string, Record<string, number>>
    habitLogs?: Record<string, Record<string, boolean>>
    habits?: Array<{ id: string; name: string }>
    doseLogs?: Array<{ peptideId: string; date: string }>
    compounds?: Array<{ id: string; name: string }>
  } = {},
): DaySnapshot {
  const r = model.readiness(date)
  const night = model.nightBy.get(date)
  const rhr = rowFor(model, 'rhr', date)
  const hrv = rowFor(model, 'hrv', date)
  const workouts = model.sessions.filter((s) => s.date === date).map((s) => ({
    id: s.id, title: s.title, durationMin: s.durationMin, avgHR: s.avgHR, trimp: s.trimp,
  }))
  const day = model.dailyBy.get(date)
  const log = habitLogs[date] || {}
  const nameOf = (id: string) => compounds.find((c) => c.id === id)?.name || id
  const doses = [...new Set(doseLogs.filter((l) => l.date === date).map((l) => l.peptideId))].map((id) => ({ peptideId: id, name: nameOf(id) }))
  return {
    date,
    readiness: { score: r.score, band: r.band, status: r.status },
    sleep: night ? { asleepMin: night.asleepMin, score: model.sleepScore(date)?.score ?? null, hasStages: night.hasStages } : null,
    rhr: { value: rhr.value, delta: rhr.delta },
    hrv: { value: hrv.value, delta: hrv.delta },
    workouts,
    steps: day?.steps ?? null,
    checkin: checkins[date] && Object.keys(checkins[date]).length ? checkins[date] : null,
    habits: habits.filter((h) => h.id in log).map((h) => ({ id: h.id, name: h.name, value: !!log[h.id] })),
    doses,
    hasHealth: !!night || !!day || workouts.length > 0,
  }
}
