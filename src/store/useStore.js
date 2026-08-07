import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { format } from 'date-fns'
import {
  seedPeptides, seedVials, seedTitration, seedOpenVials, SEED_NEEDLE_NOTES,
  testosteroneEnanthate, TEST_E_ID, DEFAULT_BAC_ML, LEGACY_BAC_ML,
} from '../data/seed'
import { SEED_KNOWN_GOOD } from '../lib/mixing'
import { currentRung, cycleInfo, addDaysStr } from '../lib/schedule'
import { isDueToday } from '../lib/daily'
import { perfectRotation } from '../lib/sites'
import { rotationHealth } from '../lib/rotation'
import { enrichPeptide } from '../lib/reference'
import { toPeptide } from '../lib/wizardDefaults'
import { countEntries } from '../lib/backup'
import { toMg, doseToUnits, concentration, isNasal, convertLadderForRoute } from '../lib/calc'
import { XP, rankUpInfo } from '../lib/gamification'
import { DEFAULT_BODY_REFS } from '../lib/metrics'
import { attributeSymptom, attributionSnapshot } from '../lib/attribution'

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
    // Fixed distances up a limb, in cm, so every arm/thigh reading is taken at
    // the identical spot. Set once, editable, shown next to the field each time.
    bodyRefs: { ...DEFAULT_BODY_REFS },
    backupMeta: { lastBackupAt: null, lastBackupEntryCount: 0, nudgeDismissedAt: null },
    coachMarks: {}, // one-time beginner tips already seen, by id
    // The week whose recap has already been read on Home, as its Monday date.
    // Stored rather than derived so dismissing it holds until the week turns.
    recapSeen: null,
    // restock list: horizon, per-line quantity overrides, what's been ordered,
    // expected delivery dates, and editable consumable unit costs
    restock: { horizon: 'cycles', qty: {}, checked: {}, delivery: {}, unitCosts: {} },
    // Reactions logged against an injection site: { siteId: [{ id, kind, date, note, cleared }] }.
    // An uncleared reaction parks the site — nothing routes to it until it's cleared.
    siteReactions: {},
    // 'suggest' picks one spot each time; 'path' walks a pre-planned even sequence.
    rotation: { mode: 'suggest' },
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
      // Switching between injecting and spraying changes the unit the dose is
      // counted in, so the ladder is converted rather than left reading mcg for
      // a spray bottle. Rounded to whole sprays and never below one — the
      // resulting mcg is shown right next to it, so any change is visible.
      setRoute(id, route) {
        set((s) => ({
          peptides: s.peptides.map((p) => {
            if (p.id !== id) return p
            const wasNasal = p.route === 'Nasal'
            const nowNasal = route === 'Nasal'
            if (wasNasal === nowNasal) return { ...p, route }
            return { ...p, route, ladder: convertLadderForRoute(p.ladder, nowNasal) }
          }),
        }))
      },
      updateRecon(id, patch) {
        set((s) => ({
          peptides: s.peptides.map((p) => (p.id === id ? { ...p, recon: { ...p.recon, ...patch } } : p)),
        }))
      },
      // `data.id` may carry a compound id from the matrix — keeping it as the
      // peptide id is what wires the new entry into Mix / co-draw / rotation
      // with no manual mapping. Returns null if that id is already in the stack.
      addPeptide(data = {}) {
        const t = todayStr()
        const id = data.id || `custom-${Date.now()}`
        if (get().peptides.some((p) => p.id === id)) return null
        const base = {
          route: 'SubQ', startDate: t, frequency: 'daily', timing: 'Flexible',
          cycleOnDays: 0, cycleOffDays: 0,
          ladder: { floor: 100, step: 100, intervalWeeks: 1, ceiling: 500, unit: 'mcg' },
          recon: { vialMg: 10, bacMl: 2, expiryDays: 28 },
          ...data,
          id,
        }
        // Attach the evidence reference and seed the descriptive protocol text.
        // Structured dose/ladder/recon are never derived from it.
        const peptide = { ...base, ...(enrichPeptide(base) || {}) }
        set((s) => ({
          peptides: [...s.peptides, peptide],
          titration: { ...s.titration, [id]: { level: 0, levelStartDate: t } },
          openVials: { ...s.openVials, [id]: { remainingMg: peptide.recon.vialMg || 0, reconstitutedAt: null } },
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
      // Append one dose log + decrement its inventory. No gamification here so a
      // co-draw can record several doses then award once. Returns the peptide.
      _recordDose(peptideId, siteId, loggedAt, coDrawId) {
        const s = get()
        const p = s.peptides.find((x) => x.id === peptideId)
        if (!p) return null
        const t = todayStr()
        const { dose } = currentRung(p, s.titration[peptideId])
        const doseMg = toMg(dose, p.ladder.unit)
        const conc = concentration(p.recon.vialMg, p.recon.bacMl)
        const log = {
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          peptideId, date: t, doseValue: dose, unit: p.ladder.unit,
          // a nasal dose isn't drawn into a syringe, so it has no unit count
          // and no injection site
          insulinUnits: isNasal(p) ? null : Math.round(doseToUnits(doseMg, conc) * 10) / 10,
          route: p.route || 'SubQ',
          siteId: isNasal(p) ? null : (siteId || null),
          loggedAt: loggedAt || new Date().toISOString(),
          coDrawId: coDrawId || null,
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
            open.reconstitutedAt = t
          } else {
            open.remainingMg = Math.max(0, open.remainingMg)
          }
        }
        set((st) => ({
          doseLogs: [...st.doseLogs, log],
          vials,
          openVials: { ...st.openVials, [peptideId]: open },
        }))
        return p
      },

      // Run gamification once for a batch of just-logged peptides.
      _awardForLogging(loggedPeptides, opts = {}) {
        const t = todayStr()
        const after = get()
        const count = loggedPeptides.length
        let xpGain = XP.log * count
        const newBadges = []
        after.awardBadge('first-log', newBadges)
        if (after.doseLogs.length >= 100) after.awardBadge('logs-100', newBadges)

        const due = after.peptides.filter((x) => isDueToday(x, t))
        const loggedToday = new Set(after.doseLogs.filter((l) => l.date === t).map((l) => l.peptideId))
        const fullDay = due.length > 0 && due.every((x) => loggedToday.has(x.id))

        if (perfectRotation(after.doseLogs, t)) after.awardBadge('perfect-rotation', newBadges)
        // rotating well over a whole month is a different achievement to seven
        // clean shots in a row, and worth its own badge
        for (const route of ['SubQ', 'IM']) {
          const h = rotationHealth({ doseLogs: after.doseLogs, todayStr: t, route }, { minLogs: 8, window: 28 })
          if (h.ready && h.score >= 90) { after.awardBadge('rotation-health', newBadges); break }
        }

        let g = { ...after.gamification, totalLogs: (after.gamification.totalLogs || 0) + count }
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

        // completed a full on-cycle on any logged cycled peptide?
        for (const p of loggedPeptides) {
          if (cycleInfo(p, t).completedCycles > 0) {
            const already = get().gamification.badges.includes('cycle-complete')
            after.awardBadge('cycle-complete', newBadges)
            if (!already) { xpGain += XP.cycleComplete; break }
          }
        }

        const oldXp = get().gamification.xp
        g = { ...g, xp: oldXp + xpGain }
        set({ gamification: { ...get().gamification, ...g, badges: get().gamification.badges } })

        get().fireCelebration({
          type: fullDay ? 'fullday' : (opts.baseType || 'log'),
          peptide: opts.peptide, names: opts.names, count,
          xp: xpGain, fullDay, streak: g.currentStreak, badges: newBadges,
          rankUp: rankUpInfo(oldXp, g.xp),
        })
      },

      logDose(peptideId, siteId) {
        const p = get()._recordDose(peptideId, siteId, new Date().toISOString(), null)
        if (!p) return
        get()._awardForLogging([p], { baseType: 'log', peptide: p.name })
      },

      // Co-draw: several peptides drawn into one syringe → one injection event
      // at one site with one shared timestamp + coDrawId.
      logCoDraw(peptideIds, siteId) {
        const loggedAt = new Date().toISOString()
        const coDrawId = `cd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const logged = []
        for (const id of peptideIds) {
          const p = get()._recordDose(id, siteId, loggedAt, coDrawId)
          if (p) logged.push(p)
        }
        if (!logged.length) return
        get()._awardForLogging(logged, {
          baseType: logged.length > 1 ? 'codraw' : 'log',
          peptide: logged[0].name, names: logged.map((p) => p.name),
        })
      },
      // ---------- injection-site reactions ----------
      logSiteReaction(siteId, kind, note) {
        if (!siteId || !kind) return
        const entry = {
          id: `rx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind, date: todayStr(), note: note || '', cleared: false,
        }
        set((s) => ({
          siteReactions: { ...s.siteReactions, [siteId]: [...(s.siteReactions[siteId] || []), entry] },
        }))
      },
      // Clearing marks the history rather than deleting it — a site that keeps
      // reacting is worth knowing about even after each one settles.
      clearSiteReactions(siteId) {
        set((s) => ({
          siteReactions: {
            ...s.siteReactions,
            [siteId]: (s.siteReactions[siteId] || []).map((r) => (r.cleared ? r : { ...r, cleared: true, clearedAt: todayStr() })),
          },
        }))
      },
      removeSiteReaction(siteId, reactionId) {
        set((s) => ({
          siteReactions: {
            ...s.siteReactions,
            [siteId]: (s.siteReactions[siteId] || []).filter((r) => r.id !== reactionId),
          },
        }))
      },
      setRotationMode(mode) {
        set({ rotation: { mode: mode === 'path' ? 'path' : 'suggest' } })
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
        // Attribution is snapshotted onto the entry rather than recomputed on
        // read: months later the stack will have changed, and the honest answer
        // is what the suspects were on the day, not what they'd be now.
        const ctx = { peptides: s.peptides, titration: s.titration, doseLogs: s.doseLogs, todayStr: t }
        const withCause = tags.map((tg) => {
          const snap = attributionSnapshot(attributeSymptom(tg.id, ctx))
          return snap ? { ...tg, attribution: snap } : tg
        })
        const entry = {
          id: `sym-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          date: t, tags: withCause, note: note || '', site: site || null, activePeptides: active,
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
      setBodyRef(key, cm) {
        const v = Math.max(0, Math.round((+cm || 0) * 10) / 10)
        set((s) => ({ bodyRefs: { ...s.bodyRefs, [key]: v } }))
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
      // ---------- restock ----------
      setRestockHorizon(horizon) {
        set((s) => ({ restock: { ...s.restock, horizon } }))
      },
      setRestockQty(key, qty) {
        set((s) => ({ restock: { ...s.restock, qty: { ...s.restock.qty, [key]: Math.max(0, Math.round(qty || 0)) } } }))
      },
      clearRestockQty(key) {
        set((s) => {
          const qty = { ...s.restock.qty }
          delete qty[key]
          return { restock: { ...s.restock, qty } }
        })
      },
      toggleRestockChecked(key) {
        set((s) => {
          const checked = { ...s.restock.checked }
          if (checked[key]) delete checked[key]
          else checked[key] = new Date().toISOString()
          return { restock: { ...s.restock, checked } }
        })
      },
      setRestockDelivery(key, date) {
        set((s) => {
          const delivery = { ...s.restock.delivery }
          if (date) delivery[key] = date
          else delete delivery[key]
          return { restock: { ...s.restock, delivery } }
        })
      },
      setRestockUnitCost(id, aud) {
        set((s) => ({ restock: { ...s.restock, unitCosts: { ...s.restock.unitCosts, [id]: Math.max(0, aud || 0) } } }))
      },
      resetRestock() {
        set((s) => ({ restock: { ...s.restock, qty: {}, checked: {}, delivery: {} } }))
      },

      // ---------- schedule wizard ----------
      // Builds the stack from wizard entries. Existing peptides are updated in
      // place rather than duplicated, and nothing else is touched unless the
      // user explicitly asked to start over — which clears the stack and its
      // inventory, and deliberately leaves the dose history alone.
      applyWizard(entries, { startOver = false, startDate = null } = {}) {
        const t = startDate || todayStr()
        if (startOver) {
          set((s) => ({
            peptides: [],
            vials: [],
            titration: {},
            openVials: {},
            restock: { ...s.restock, qty: {}, checked: {}, delivery: {} },
          }))
        }
        const applied = []
        for (const entry of entries) {
          const data = toPeptide(entry, t)
          const exists = get().peptides.some((p) => p.id === data.id)
          if (exists) {
            get().updatePeptide(data.id, data)
            set((s) => ({ titration: { ...s.titration, [data.id]: { level: 0, levelStartDate: t } } }))
          } else {
            get().addPeptide(data)
          }
          // optional stock + cost feed inventory and the restock list
          const qty = Math.max(0, Math.round(entry.stockVials || 0))
          const cost = Math.max(0, entry.costAud || 0)
          if (qty > 0 || cost > 0) {
            set((s) => ({
              vials: [
                ...s.vials.filter((v) => v.id !== `vial-${data.id}`),
                {
                  id: `vial-${data.id}`, peptideId: data.id, vialMg: data.recon.vialMg || 0,
                  costAud: cost, vendor: '', lot: '', qtyPurchased: qty, qtyOnHand: qty,
                },
              ],
            }))
          }
          applied.push(data.id)
        }
        set((s) => ({ coachMarks: { ...s.coachMarks, 'wizard-done': true } }))
        return applied
      },

      // One-time coach tips: shown until dismissed, then never again.
      markCoachSeen(id) {
        set((s) => (s.coachMarks?.[id] ? {} : { coachMarks: { ...s.coachMarks, [id]: true } }))
      },
      resetCoachMarks() {
        set({ coachMarks: {} })
      },

      // Recap read for this week — it comes back on its own next Monday.
      markRecapSeen(periodId) {
        set({ recapSeen: periodId })
      },

      // ---------- backup bookkeeping ----------
      markBackedUp(when = new Date().toISOString()) {
        const s = get()
        set({
          backupMeta: {
            ...s.backupMeta,
            lastBackupAt: when,
            lastBackupEntryCount: countEntries(s),
            nudgeDismissedAt: null,
          },
        })
      },
      dismissBackupNudge() {
        set((s) => ({ backupMeta: { ...s.backupMeta, nudgeDismissedAt: new Date().toISOString() } }))
      },

      // Attach reference info to peptides that predate it, without touching any
      // protocol value the user has already set.
      enrichLibraryFromReference() {
        set((s) => ({
          peptides: s.peptides.map((p) => {
            const patch = enrichPeptide(p)
            return patch ? { ...p, ...patch } : p
          }),
        }))
      },
      resetAll() {
        set({ ...initialState(), celebration: null })
      },
    }),
    {
      name: 'peptide-command-center', // storage key is history — renaming it would orphan existing data
      version: 3,
      storage: createJSONStorage(() => safeStorage),
      // Saves written before a release can't pick new library entries up from
      // the seed, so each version bump backfills them here — once. Deleting one
      // afterwards sticks, because the migration only runs on the bump.
      //   v1: the oil-based injectable
      //   v2: the intranasal-capable flag on Semax / Selank
      //   v3: 2 mL reconstitution default
      migrate: (persisted, from) => {
        if (!persisted || from >= 3) return persisted
        const s = { ...persisted }
        const t = todayStr()
        if (from < 3) {
          // v3: one reconstitution volume across the board. Only peptides still
          // sitting on their original seeded value are moved — a volume the user
          // chose themselves is theirs, and gets left alone.
          s.peptides = (s.peptides || []).map((p) => {
            const wasSeeded = LEGACY_BAC_ML[p.id]
            if (!wasSeeded || p.recon?.bacMl !== wasSeeded) return p
            return { ...p, recon: { ...p.recon, bacMl: DEFAULT_BAC_ML } }
          })
        }
        if (from < 2) {
          // v2: Semax and Selank can be switched to a nasal spray. The flag only
          // offers the choice — the route itself stays whatever the user has.
          s.peptides = (s.peptides || []).map((p) => (
            ['semax', 'selank'].includes(p.id) ? { ...p, intranasalCapable: true } : p
          ))
        }
        if (from >= 1) {
          const have1 = new Set((s.needleNotes || []).map((n) => n.id))
          s.needleNotes = [...(s.needleNotes || []), ...SEED_NEEDLE_NOTES.filter((n) => !have1.has(n.id))]
          return s
        }
        if (!s.peptides?.some((p) => p.id === TEST_E_ID)) {
          const te = testosteroneEnanthate(t)
          s.peptides = [...(s.peptides || []), te]
          s.titration = { ...(s.titration || {}), [TEST_E_ID]: { level: 0, levelStartDate: t } }
          s.openVials = {
            ...(s.openVials || {}),
            [TEST_E_ID]: { remainingMg: te.recon.vialMg, reconstitutedAt: null },
          }
          s.vials = [...(s.vials || []), {
            id: `vial-${TEST_E_ID}`, peptideId: TEST_E_ID, vialMg: te.recon.vialMg,
            costAud: 0, vendor: '', lot: '', qtyPurchased: 1, qtyOnHand: 1,
          }]
        }
        // pick up needle-guide sections added since this save was written,
        // without touching any section the user has already edited
        const have = new Set((s.needleNotes || []).map((n) => n.id))
        s.needleNotes = [...(s.needleNotes || []), ...SEED_NEEDLE_NOTES.filter((n) => !have.has(n.id))]
        return s
      },
      partialize: (s) => {
        const { celebration, ...rest } = s
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function'))
      },
      // Older saves predate backupMeta and the reference attachment; fill both
      // in on load so existing users get them without losing anything.
      merge: (persisted, current) => ({
        ...current,
        ...persisted,
        backupMeta: { ...current.backupMeta, ...(persisted?.backupMeta || {}) },
        coachMarks: { ...current.coachMarks, ...(persisted?.coachMarks || {}) },
        restock: { ...current.restock, ...(persisted?.restock || {}) },
        bodyRefs: { ...current.bodyRefs, ...(persisted?.bodyRefs || {}) },
        siteReactions: { ...current.siteReactions, ...(persisted?.siteReactions || {}) },
        rotation: { ...current.rotation, ...(persisted?.rotation || {}) },
      }),
      onRehydrateStorage: () => (state) => {
        state?.enrichLibraryFromReference?.()
      },
    }
  )
)

export default useStore
