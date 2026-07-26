import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { format } from 'date-fns'
import {
  seedPeptides, seedVials, seedTitration, seedOpenVials, SEED_NEEDLE_NOTES,
} from '../data/seed'
import { SEED_KNOWN_GOOD } from '../lib/mixing'
import { currentRung, isDueOn, cycleInfo, addDaysStr } from '../lib/schedule'
import { toMg, doseToUnits, concentration } from '../lib/calc'
import { XP } from '../lib/gamification'

export const todayStr = () => format(new Date(), 'yyyy-MM-dd')

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
    gamification: { xp: 0, currentStreak: 0, bestStreak: 0, lastFullDay: null, badges: [], totalLogs: 0 },
    needleNotes: SEED_NEEDLE_NOTES,
    settings: { currency: 'AUD', restockLeadDays: 30, theme: 'dark', disclaimerDismissed: false },
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
        get().awardXp(XP.levelUp)
        const newBadges = []
        get().awardBadge('level-up', newBadges)
        if (newLevel === maxLevel) get().awardBadge('ceiling', newBadges)
        get().fireCelebration({
          type: 'levelup', peptide: p.name, level: newLevel + 1,
          dose: rungs[newLevel], unit: p.ladder.unit, badges: newBadges,
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
      logDose(peptideId, site) {
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
          site: site || null,
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

        // full-stack day? every due peptide has a log today
        const due = after.peptides.filter((x) => isDueOn(x, t))
        const loggedToday = new Set(after.doseLogs.filter((l) => l.date === t).map((l) => l.peptideId))
        const fullDay = due.length > 0 && due.every((x) => loggedToday.has(x.id))

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

        g = { ...g, xp: g.xp + xpGain }
        // awardBadge() mutated state after `after` was snapshotted — keep the live badges list
        set({ gamification: { ...get().gamification, ...g, badges: get().gamification.badges } })

        get().fireCelebration({
          type: fullDay ? 'fullday' : 'log',
          peptide: p.name, xp: xpGain, fullDay, streak: g.currentStreak, badges: newBadges,
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
