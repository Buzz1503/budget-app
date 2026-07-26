import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { format } from 'date-fns'
import {
  seedPeptides, seedVials, seedTitration, seedOpenVials, SEED_NEEDLE_NOTES,
} from '../data/seed'
import { SEED_KNOWN_GOOD } from '../lib/mixing'
import { currentRung, cycleInfo, addDaysStr } from '../lib/schedule'
import { isScheduledToday } from '../lib/daily'
import { perfectRotation } from '../lib/sites'
import { toMg, doseToUnits, concentration } from '../lib/calc'
import { XP, rankUpInfo } from '../lib/gamification'

export const todayStr = () => format(new Date(), 'yyyy-MM-dd')

// ISO-ish year+week key for streak grouping (good enough for weekly cadence).
function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const onejan = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${week}`
}

// localStorage wrapped so a genuine quota/security failure surfaces once, without crashing.
let storageErrorHandler = null
export function onStorageError(fn) { storageErrorHandler = fn }
const safeStorage = {
  getItem: (k) => {
    try { return localStorage.getItem(k) } catch { return null }
  },
  setItem: (k, v) => {
    try { localStorage.setItem(k, v) } catch (e) { storageErrorHandler?.(e) }
  },
  removeItem: (k) => {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  },
}

function initialState() {
  const t = todayStr()
  const peptides = seedPeptides(t)
  return {
    peptides,
    vials: seedVials(peptides),
    doseLogs: [],
    knownGoodMixes: [...SEED_KNOWN_GOOD],
    titration: seedTitration(peptides, t),
    openVials: seedOpenVials(peptides),
    gamification: {
      xp: 0, currentStreak: 0, bestStreak: 0, lastFullDay: null, badges: [], totalLogs: 0,
      checkinStreak: 0, bestCheckinStreak: 0, lastCheckin: null, clearDayStreak: 0,
    },
    needleNotes: SEED_NEEDLE_NOTES,
    mixExplored: [], // codex: sorted-pair keys the user has revealed
    symptomLogs: [],
    measurements: [], // body-comp entries (structured; no blobs)
    photos: [], // progress-photo metadata; blobs live in IndexedDB by blobKey
    bodyGoals: {}, // { metric: targetValue }
    settings: { currency: 'AUD', restockLeadDays: 30, theme: 'dark', disclaimerDismissed: false, haptics: true, sound: false },
  }
}

let celebrationNonce = 0

const useStore = create(
  persist(
    (set, get) => ({
      ...initialState(),
      celebration: null, // transient, not persisted

      fireCelebration(payload) {
        set({ celebration: { ...payload, nonce: ++celebrationNonce } })
      },

      // ---------- peptides ----------
      updatePeptide(id, patch) {
        set((s) => ({ peptides: s.peptides.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
      },
      updateLadder(id, patch) {
        set((s) => ({
          peptides: s.peptides.map((p) => (p.id === id ? { ...p, ladder: { ...p.ladder, ...patch } } : p)),
        }))
      },
      updateRecon(id, patch) {
        set((s) => ({
          peptides: s.peptides.map((p) => (p.id === id ? { ...p, recon: { ...p.recon, ...patch } } : p)),
        }))
      },
      addPeptide(data) {
        const id = `custom-${Date.now()}`
        const t = todayStr()
        const peptide = {
          id, route: 'SubQ', startDate: t, frequency: 'daily', timing: 'Flexible',
          cycleOnDays: 0, cycleOffDays: 0,
          ladder: { floor: 100, step: 100, intervalWeeks: 1, ceiling: 500, unit: 'mcg' },
          recon: { vialMg: 10, bacMl: 2, expiryDays: 28 },
          ...data,
        }
        set((s) => ({
          peptides: [...s.peptides, peptide],
          titration: { ...s.titration, [id]: { level: 0, levelStartDate: t } },
          openVials: { ...s.openVials, [id]: { remainingMg: peptide.recon.vialMg, reconstitutedAt: null } },
        }))
        return id
      },
      removePeptide(id) {
        set((s) => {
          const titration = { ...s.titration }
          const openVials = { ...s.openVials }
          delete titration[id]
          delete openVials[id]
          return {
            peptides: s.peptides.filter((p) => p.id !== id),
            vials: s.vials.filter((v) => v.peptideId !== id),
            doseLogs: s.doseLogs.filter((l) => l.peptideId !== id),
            titration,
            openVials,
          }
        })
      },

      // ---------- titration (tolerance-gated) ----------
      confirmStepUp(id) {
        const s = get()
        const p = s.peptides.find((x) => x.id === id)
        if (!p) return
        const { level, maxLevel, rungs } = currentRung(p, s.titration[id])
        if (level >= maxLevel) return
        const newLevel = level + 1
        set((st) => ({
          titration: { ...st.titration, [id]: { level: newLevel, levelStartDate: todayStr() } },
        }))
        const oldXp = get().gamification.xp
        get().awardXp(XP.levelUp)
        const newBadges = []
        get().awardBadge('level-up', newBadges)
        if (newLevel === maxLevel) get().awardBadge('ceiling', newBadges)
        get().fireCelebration({
          type: 'levelup', peptide: p.name, level: newLevel + 1,
          dose: rungs[newLevel], unit: p.ladder.unit, badges: newBadges,
          rankUp: rankUpInfo(oldXp, get().gamification.xp),
        })
      },
      holdStepUp(id) {
        // declined → keep dose, restart the interval so it re-asks next interval
        set((s) => ({
          titration: { ...s.titration, [id]: { ...s.titration[id], levelStartDate: todayStr() } },
        }))
      },
      setRungLevel(id, level) {
        const s = get()
        const p = s.peptides.find((x) => x.id === id)
        if (!p) return
        const { maxLevel } = currentRung(p, s.titration[id])
        const clamped = Math.max(0, Math.min(level, maxLevel))
        set((st) => ({
          titration: { ...st.titration, [id]: { level: clamped, levelStartDate: todayStr() } },
        }))
      },

      // ---------- logging ----------
      logDose(peptideId, siteId) {
        const s = get()
        const p = s.peptides.find((x) => x.id === peptideId)
        if (!p) return
        const t = todayStr()
        const { dose } = currentRung(p, s.titration[peptideId])
        const doseMg = toMg(dose, p.ladder.unit)
        const conc = concentration(p.recon.vialMg, p.recon.bacMl)
        const log = {
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          peptideId, date: t, doseValue: dose, unit: p.ladder.unit,
          insulinUnits: Math.round(doseToUnits(doseMg, conc) * 10) / 10,
          siteId: siteId || null, loggedAt: new Date().toISOString(),
        }

        // inventory: draw from the open vial; auto-open a sealed one when depleted
        const open = { ...(s.openVials[peptideId] || { remainingMg: 0, reconstitutedAt: null }) }
        open.remainingMg = Math.round((open.remainingMg - doseMg) * 1e6) / 1e6
        let vials = s.vials
        if (open.remainingMg <= 1e-9) {
          const idx = vials.findIndex((v) => v.peptideId === peptideId && v.qtyOnHand > 0)
          if (idx >= 0) {
            vials = vials.map((v, i) => (i === idx ? { ...v, qtyOnHand: v.qtyOnHand - 1 } : v))
            open.remainingMg = Math.round((open.remainingMg + s.vials[idx].vialMg) * 1e6) / 1e6
            open.reconstitutedAt = t // fresh vial goes into the fridge reconstituted
          } else {
            open.remainingMg = Math.max(0, open.remainingMg)
          }
        }

        set((st) => ({
          doseLogs: [...st.doseLogs, log],
          vials,
          openVials: { ...st.openVials, [peptideId]: open },
        }))

        // ---- gamification ----
        const after = get()
        let xpGain = XP.log
        const newBadges = []
        after.awardBadge('first-log', newBadges)
        if (after.doseLogs.length >= 100) after.awardBadge('logs-100', newBadges)

        // full-stack day? every peptide scheduled today has a log today
        const due = after.peptides.filter((x) => isScheduledToday(x, t))
        const loggedToday = new Set(after.doseLogs.filter((l) => l.date === t).map((l) => l.peptideId))
        const fullDay = due.length > 0 && due.every((x) => loggedToday.has(x.id))

        // perfect-rotation badge — 7 injections, no site repeat
        if (perfectRotation(after.doseLogs, t)) after.awardBadge('perfect-rotation', newBadges)

        let g = { ...after.gamification, totalLogs: (after.gamification.totalLogs || 0) + 1 }
        if (fullDay && g.lastFullDay !== t) {
          xpGain += XP.fullDay
          const yesterday = addDaysStr(t, -1)
          g.currentStreak = g.lastFullDay === yesterday ? g.currentStreak + 1 : 1
          g.bestStreak = Math.max(g.bestStreak, g.currentStreak)
          g.lastFullDay = t
          xpGain += XP.streakDay * Math.min(g.currentStreak, 10)
          after.awardBadge('full-stack', newBadges)
          if (g.currentStreak >= 7) after.awardBadge('streak-7', newBadges)
          if (g.currentStreak >= 30) after.awardBadge('streak-30', newBadges)
        }

        // completed a full on-cycle on any cycled peptide?
        const cyc = cycleInfo(p, t)
        if (cyc.completedCycles > 0) {
          const already = after.gamification.badges.includes('cycle-complete')
          after.awardBadge('cycle-complete', newBadges)
          if (!already) xpGain += XP.cycleComplete
        }

        const oldXp = get().gamification.xp
        g = { ...g, xp: oldXp + xpGain }
        // awardBadge() mutated state after `after` was snapshotted — keep the live badges list
        set({ gamification: { ...get().gamification, ...g, badges: get().gamification.badges } })

        get().fireCelebration({
          type: fullDay ? 'fullday' : 'log',
          peptide: p.name, xp: xpGain, fullDay, streak: g.currentStreak, badges: newBadges,
          rankUp: rankUpInfo(oldXp, g.xp),
        })
      },
      undoLog(logId) {
        set((s) => {
          const log = s.doseLogs.find((l) => l.id === logId)
          if (!log) return {}
          const p = s.peptides.find((x) => x.id === log.peptideId)
          const open = { ...(s.openVials[log.peptideId] || { remainingMg: 0 }) }
          if (p) open.remainingMg += toMg(log.doseValue, log.unit)
          return {
            doseLogs: s.doseLogs.filter((l) => l.id !== logId),
            openVials: { ...s.openVials, [log.peptideId]: open },
          }
        })
      },

      awardXp(amount) {
        set((s) => ({ gamification: { ...s.gamification, xp: s.gamification.xp + amount } }))
      },
      awardBadge(id, collector) {
        const s = get()
        if (s.gamification.badges.includes(id)) return false
        set({ gamification: { ...s.gamification, badges: [...s.gamification.badges, id] } })
        collector?.push(id)
        return true
      },

      // ---------- inventory ----------
      addVial(peptideId, data) {
        const vial = {
          id: `vial-${Date.now()}`, peptideId, vialMg: 10, costAud: 0, vendor: '', lot: '',
          qtyPurchased: 1, qtyOnHand: 1, ...data,
        }
        set((s) => ({ vials: [...s.vials, vial] }))
      },
      updateVial(id, patch) {
        set((s) => ({ vials: s.vials.map((v) => (v.id === id ? { ...v, ...patch } : v)) }))
      },
      removeVial(id) {
        set((s) => ({ vials: s.vials.filter((v) => v.id !== id) }))
      },
      reconstituteVial(peptideId) {
        const s = get()
        const p = s.peptides.find((x) => x.id === peptideId)
        set((st) => ({
          openVials: {
            ...st.openVials,
            [peptideId]: {
              remainingMg: st.openVials[peptideId]?.remainingMg ?? p?.recon.vialMg ?? 0,
              reconstitutedAt: todayStr(),
            },
          },
        }))
      },

      // ---------- mixing ----------
      markKnownGood(key) {
        set((s) => (s.knownGoodMixes.includes(key) ? {} : { knownGoodMixes: [...s.knownGoodMixes, key] }))
      },
      unmarkKnownGood(key) {
        set((s) => ({ knownGoodMixes: s.knownGoodMixes.filter((k) => k !== key) }))
      },
      // Compatibility Codex: reveal a pair once, award discovery XP the first time.
      exploreMixPair(key) {
        const s = get()
        if (s.mixExplored.includes(key)) return
        set({ mixExplored: [...s.mixExplored, key] })
        const oldXp = s.gamification.xp
        get().awardXp(XP.mixDiscovery)
        const newBadges = []
        if (get().mixExplored.length >= 10) get().awardBadge('chemist', newBadges)
        get().fireCelebration({
          type: 'discovery', xp: XP.mixDiscovery, badges: newBadges,
          rankUp: rankUpInfo(oldXp, get().gamification.xp),
        })
      },

      // ---------- symptoms ----------
      logSymptomCheckin({ tags, note, site }) {
        const s = get()
        const t = todayStr()
        // active peptides on this date, captured for later pattern overlay
        const active = s.peptides
          .filter((p) => cycleInfo(p, t).isOn)
          .map((p) => ({ id: p.id, name: p.name, cycleDay: cycleInfo(p, t).cycleDay, level: currentRung(p, s.titration[p.id]).level }))
        const entry = {
          id: `sym-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          date: t, tags, note: note || '', site: site || null, activePeptides: active,
        }
        // one check-in per day replaces the prior one
        const symptomLogs = [...s.symptomLogs.filter((l) => l.date !== t), entry]
        const hadCheckinToday = s.symptomLogs.some((l) => l.date === t)
        set({ symptomLogs })

        const oldXp = s.gamification.xp
        let xpGain = XP.symptomCheckin
        const newBadges = []
        get().awardBadge('first-checkin', newBadges)

        const hasNegative = tags.some((tg) => tg.polarity === 'neg')
        const clearDay = tags.length > 0 && !hasNegative

        let g = { ...get().gamification }
        if (!hadCheckinToday) {
          const yesterday = addDaysStr(t, -1)
          g.checkinStreak = g.lastCheckin === yesterday ? (g.checkinStreak || 0) + 1 : 1
          g.bestCheckinStreak = Math.max(g.bestCheckinStreak || 0, g.checkinStreak)
          g.lastCheckin = t
          if (clearDay) {
            xpGain += XP.clearDay
            g.clearDayStreak = (g.clearDayStreak || 0) + 1
            if (g.clearDayStreak >= 7) get().awardBadge('clear-week', newBadges)
          } else {
            g.clearDayStreak = 0
          }
        }
        g.xp = oldXp + xpGain
        set({ gamification: { ...g, badges: get().gamification.badges } })

        get().fireCelebration({
          type: clearDay ? 'clearday' : 'checkin',
          xp: xpGain, clearDay, streak: g.checkinStreak, badges: newBadges,
          rankUp: rankUpInfo(oldXp, g.xp),
        })
      },
      deleteSymptomLog(id) {
        set((s) => ({ symptomLogs: s.symptomLogs.filter((l) => l.id !== id) }))
      },

      // ---------- body composition ----------
      addMeasurement(data) {
        const s = get()
        const entry = {
          id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          date: data.date || todayStr(), source: data.source || 'manual', ...data,
        }
        // one entry per date+source replaces the prior one
        const measurements = [
          ...s.measurements.filter((m) => !(m.date === entry.date && m.source === entry.source)),
          entry,
        ].sort((a, b) => a.date.localeCompare(b.date))
        set({ measurements })

        const oldXp = s.gamification.xp
        const newBadges = []
        get().awardBadge('first-measurement', newBadges)
        if (entry.source === 'scan') get().awardBadge('first-scan', newBadges)
        get().checkBodyMilestones(newBadges)
        get().awardXp(XP.measurement)
        get().fireCelebration({
          type: 'measurement', xp: XP.measurement, badges: newBadges,
          rankUp: rankUpInfo(oldXp, get().gamification.xp),
        })
      },
      deleteMeasurement(id) {
        set((s) => ({ measurements: s.measurements.filter((m) => m.id !== id) }))
      },
      setBodyGoal(metric, value) {
        set((s) => ({ bodyGoals: { ...s.bodyGoals, [metric]: value } }))
      },
      // award body-comp milestone badges vs goals / trend
      checkBodyMilestones(collector) {
        const s = get()
        const ms = s.measurements
        if (ms.length < 2) return
        const first = ms[0], last = ms[ms.length - 1]
        const dropped = (k) => first[k] != null && last[k] != null && last[k] < first[k]
        if (dropped('visceralFat') || dropped('waist') || dropped('weight')) {
          get().awardBadge('body-milestone', collector)
        }
      },

      // ---------- progress photos (metadata; blob lives in IndexedDB) ----------
      addPhoto({ pose, blobKey, date }) {
        const s = get()
        const entry = {
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          date: date || todayStr(), pose: pose || 'front', blobKey,
        }
        set({ photos: [...s.photos, entry].sort((a, b) => a.date.localeCompare(b.date)) })
        const oldXp = s.gamification.xp
        const newBadges = []
        get().awardBadge('first-photo', newBadges)
        // 4-week photo streak: photos on ≥4 distinct ISO weeks
        const weeks = new Set(get().photos.map((p) => isoWeek(p.date)))
        if (weeks.size >= 4) get().awardBadge('photo-streak', newBadges)
        get().awardXp(XP.photo)
        get().fireCelebration({
          type: 'photo', xp: XP.photo, badges: newBadges,
          rankUp: rankUpInfo(oldXp, get().gamification.xp),
        })
        return entry
      },
      removePhoto(id) {
        set((s) => ({ photos: s.photos.filter((p) => p.id !== id) }))
      },

      // ---------- misc ----------
      updateNeedleNote(id, patch) {
        set((s) => ({ needleNotes: s.needleNotes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))
      },
      updateSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }))
      },
      resetAll() {
        set({ ...initialState(), celebration: null })
      },
    }),
    {
      name: 'peptide-command-center',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => {
        const { celebration, ...rest } = s
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function'))
      },
    }
  )
)

export default useStore
