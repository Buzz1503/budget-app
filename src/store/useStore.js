import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { format } from 'date-fns'
import {
  seedPeptides, seedVials, seedTitration, seedOpenVials,
  testosteroneEnanthate, TEST_E_ID, DEFAULT_BAC_ML, LEGACY_BAC_ML, THIGH_ONLY_IDS,
} from '../data/seed'
import { SEED_KNOWN_GOOD } from '../lib/mixing'
import { currentRung, cycleInfo, addDaysStr } from '../lib/schedule'
import { isDueToday } from '../lib/daily'
import { enrichPeptide } from '../lib/reference'
import { toPeptide } from '../lib/wizardDefaults'
import { countEntries } from '../lib/backup'
import { toMg, doseToUnits, concentration, isNasal, convertLadderForRoute } from '../lib/calc'
import { DEFAULT_BODY_REFS } from '../lib/metrics'
import { attributeSymptom, attributionSnapshot } from '../lib/attribution'
import { slotForCategory } from '../lib/supplements'
import { vialOnDate } from '../lib/backfill'

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
    mixExplored: [], // codex: sorted-pair keys the user has revealed
    symptomLogs: [],
    measurements: [], // body-comp entries (structured; no blobs)
    photos: [], // progress-photo metadata; blobs live in IndexedDB by blobKey
    bodyGoals: {}, // { metric: targetValue }
    // Fixed distances up a limb, in cm, so every arm/thigh reading is taken at
    // the identical spot. Set once, editable, shown next to the field each time.
    bodyRefs: { ...DEFAULT_BODY_REFS },
    backupMeta: { lastBackupAt: null, lastBackupEntryCount: 0, nudgeDismissedAt: null },
    // Oral supplements: the same daily-habit shape as the peptide stack, minus
    // everything that belongs to a needle. Logs are one row per taken-day.
    supplements: [],
    supplementLogs: [],
    // Doses deliberately not taken. Kept apart from doseLogs because a skip is
    // not a dose: nothing was drawn, nothing left the vial, and adherence has
    // to be able to tell the two apart from a plain miss.
    skips: [],
    // Vials that have been used up. Kept as a record rather than deleted: it is
    // the only trace of how long a vial actually lasted.
    finishedVials: [],
    coachMarks: {}, // one-time beginner tips already seen, by id
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

let toastNonce = 0

const useStore = create(
  persist(
    (set, get) => ({
      ...initialState(),
      toast: null, // transient, not persisted

      /**
       * A brief line about what just happened, with a way back.
       *
       * `undo` is a plain thunk rather than a serialised description of the
       * change, so reversing is the same code path as doing — there is no
       * second implementation of "what the opposite of this action is" to fall
       * out of step with the first.
       */
      showToast(message, undo = null) {
        set({ toast: { message, undo, nonce: ++toastNonce } })
      },
      dismissToast() {
        set({ toast: null })
      },
      runUndo() {
        const t = get().toast
        if (t?.undo) t.undo()
        set({ toast: null })
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
      /**
       * Take a compound out of my protocol.
       *
       * Protocol, stock and history are three independent layers, and this
       * touches exactly one of them. The vials you own stay on the shelf —
       * deleting them would be the app throwing away a record of your own
       * property — and the doses you actually took stay in the log, because
       * they happened. Stopping a compound is a statement about the future,
       * not permission to rewrite the past.
       *
       * The only thing that ends is the schedule.
       */
      removePeptide(id) {
        set((s) => {
          const titration = { ...s.titration }
          const openVials = { ...s.openVials }
          delete titration[id]
          delete openVials[id]
          return {
            peptides: s.peptides.filter((p) => p.id !== id),
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
        const prev = s.titration[id]
        get().showToast(
          `${p.name} stepped up to ${rungs[newLevel]} ${p.ladder.unit}`,
          () => set((st) => ({ titration: { ...st.titration, [id]: prev } }))
        )
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
      // Append one dose log + decrement its inventory. No toast here so a
      // co-draw can record several doses then award once. Returns the peptide.
      _recordDose(peptideId, siteId, loggedAt, coDrawId, dateStr, opts = {}) {
        const s = get()
        const p = s.peptides.find((x) => x.id === peptideId)
        if (!p) return null
        const t = dateStr || todayStr()
        const dose = opts.doseValue != null ? opts.doseValue : currentRung(p, s.titration[peptideId]).dose
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
          loggedAt: loggedAt || new Date(`${t}T12:00:00`).toISOString(),
          coDrawId: coDrawId || null,
        }
        const open = { ...(s.openVials[peptideId] || { remainingMg: 0, reconstitutedAt: null }) }
        let vials = s.vials
        // An unlinked item has no vial behind it: the dose is still recorded,
        // because it was still taken, but there is nothing to draw it out of.
        // Silently decrementing a vial that does not exist is how an inventory
        // drifts away from the shelf it is supposed to describe.
        //
        // A backfill onto a day that ran on a vial since finished passes
        // movesStock: false for the same reason — that drug came out of a vial
        // that is already gone, and taking it out of today's instead would make
        // this vial read emptier than it is and move every date downstream.
        if (opts.movesStock === false) {
          log.drawnFrom = opts.drawnFrom || null
          log.movedStock = false
        } else if (!open.unlinked) {
          open.remainingMg = Math.round((open.remainingMg - doseMg) * 1e6) / 1e6
          if (open.remainingMg <= 1e-9) {
            const idx = vials.findIndex((v) => v.peptideId === peptideId && v.qtyOnHand > 0)
            if (idx >= 0) {
              vials = vials.map((v, i) => (i === idx ? { ...v, qtyOnHand: v.qtyOnHand - 1 } : v))
              open.remainingMg = Math.round((open.remainingMg + s.vials[idx].vialMg) * 1e6) / 1e6
              open.batchId = s.vials[idx].id
              open.vialMg = s.vials[idx].vialMg
              open.reconstitutedAt = t
              open.activatedAt = new Date().toISOString()
            } else {
              open.remainingMg = Math.max(0, open.remainingMg)
            }
          }
        }
        set((st) => ({
          doseLogs: [...st.doseLogs, log],
          vials,
          openVials: { ...st.openVials, [peptideId]: open },
        }))
        return p
      },

      /**
       * A dose that was taken but never logged, added after the fact.
       *
       * Recorded exactly like a live one — same inventory draw, same effect on
       * run-out dates and adherence — because it was the same event. The only
       * difference is the date it lands on and a flag saying it was entered
       * later, so the record does not quietly claim to be something it isn't.
       */
      backfillDose(peptideId, dateStr, { siteId = null, doseValue = null, coDrawId = null } = {}) {
        if (!peptideId || !dateStr) return null
        const s = get()
        const v = vialOnDate(peptideId, dateStr, { openVials: s.openVials, finishedVials: s.finishedVials })
        const p = get()._recordDose(
          peptideId, siteId, new Date(`${dateStr}T12:00:00`).toISOString(), coDrawId, dateStr,
          { doseValue, movesStock: v.movesStock, drawnFrom: v.batchId },
        )
        if (!p) return null
        set((st) => ({
          doseLogs: st.doseLogs.map((l, i) => (i === st.doseLogs.length - 1 ? { ...l, backfilled: true } : l)),
        }))
        return p
      },

      /**
       * Catch up a whole co-draw group: one syringe, one site, one moment.
       *
       * The same shape as logCoDraw, because it records the same event — the
       * only difference is that it happened on a day that has already passed.
       * Splitting it into separate logs would put three punctures into the
       * rotation history where there was one.
       */
      backfillCoDraw(peptideIds = [], dateStr, { siteId = null, doses = {} } = {}) {
        if (!peptideIds.length || !dateStr) return []
        const coDrawId = `cd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const done = []
        for (const id of peptideIds) {
          const p = get().backfillDose(id, dateStr, {
            siteId, coDrawId: peptideIds.length > 1 ? coDrawId : null, doseValue: doses[id] ?? null,
          })
          if (p) done.push(p)
        }
        return done
      },

      /**
       * Correct a log that was recorded wrong.
       *
       * Changing the dose moves the inventory by the difference rather than
       * re-running the whole draw, so a correction of 0.1 mg costs the vial
       * 0.1 mg — not a second full dose on top of the first.
       */
      editLog(logId, patch = {}) {
        set((s) => {
          const log = s.doseLogs.find((l) => l.id === logId)
          if (!log) return {}
          const next = { ...log, ...patch, edited: true }
          const openVials = { ...s.openVials }
          const oldMg = toMg(log.doseValue, log.unit)
          const newMg = toMg(next.doseValue, next.unit)
          if (oldMg !== newMg && log.movedStock !== false) {
            const open = { ...(openVials[log.peptideId] || { remainingMg: 0 }) }
            if (!open.unlinked) {
              open.remainingMg = Math.round((open.remainingMg + oldMg - newMg) * 1e6) / 1e6
              openVials[log.peptideId] = open
            }
          }
          // a date change keeps loggedAt in step, so history sorts correctly
          if (patch.date && patch.date !== log.date) {
            next.loggedAt = new Date(`${patch.date}T12:00:00`).toISOString()
          }
          return {
            doseLogs: s.doseLogs.map((l) => (l.id === logId ? next : l)),
            openVials,
          }
        })
      },

      // The ids just written to the log, newest batch first — what an Undo of
      // that action has to take back out again.
      _lastLoggedIds(count) {
        return get().doseLogs.slice(-count).map((l) => l.id)
      },

      logDose(peptideId, siteId) {
        const p = get()._recordDose(peptideId, siteId, new Date().toISOString(), null)
        if (!p) return
        const [id] = get()._lastLoggedIds(1)
        get().showToast(`${p.name} logged`, () => get().undoLog(id))
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
        const ids = get()._lastLoggedIds(logged.length)
        get().showToast(
          logged.length > 1 ? `${logged.length} logged in one shot` : `${logged[0].name} logged`,
          () => { for (const id of ids) get().undoLog(id) }
        )
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

      // Deleting a log puts the drug back in the vial it came out of — the dose
      // never happened, so the inventory must not go on believing it did.
      undoLog(logId) {
        set((s) => {
          const log = s.doseLogs.find((l) => l.id === logId)
          if (!log) return {}
          const p = s.peptides.find((x) => x.id === log.peptideId)
          const open = { ...(s.openVials[log.peptideId] || { remainingMg: 0 }) }
          // a backfill that never moved the stock has nothing to give back
          if (p && !open.unlinked && log.movedStock !== false) open.remainingMg += toMg(log.doseValue, log.unit)
          return {
            doseLogs: s.doseLogs.filter((l) => l.id !== logId),
            openVials: { ...s.openVials, [log.peptideId]: open },
          }
        })
      },

      // My own observations about a compound, kept apart from symptom check-ins:
      // a symptom is a data point the attribution engine reads, a note is a
      // sentence to my future self, and merging them would corrupt both.
      setPeptideNote(id, note) {
        set((s) => ({ peptides: s.peptides.map((p) => (p.id === id ? { ...p, note } : p)) }))
      },

      // ---------- stock room ----------
      // A batch is a group of identical sealed vials — same peptide, same size,
      // same vendor. Several batches of one peptide are normal and stay apart:
      // a 10 mg from one vendor and a 20 mg from another are different things
      // to draw from, and one merged number would lose both facts.
      addVial(peptideId, data) {
        const vial = {
          id: `vial-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          peptideId, vialMg: 10, costAud: 0, vendor: '', lot: '',
          sealedExpiry: '', coaKey: null,
          qtyPurchased: 1, qtyOnHand: 1, ...data,
        }
        set((s) => ({ vials: [...s.vials, vial] }))
        return vial.id
      },
      /** Bought more, was given some, binned one — a signed nudge either way. */
      adjustVialQty(id, delta) {
        set((s) => ({
          vials: s.vials.map((v) => {
            if (v.id !== id) return v
            const qtyOnHand = Math.max(0, (v.qtyOnHand || 0) + delta)
            // buying more raises the purchased total too, so cost-per-mg stays
            // honest; binning one does not un-buy it
            const qtyPurchased = delta > 0
              ? (v.qtyPurchased ?? v.qtyOnHand ?? 0) + delta
              : (v.qtyPurchased ?? v.qtyOnHand ?? 0)
            return { ...v, qtyOnHand, qtyPurchased }
          }),
        }))
      },
      setBatchCoa(id, coaKey, coaMeta = null) {
        set((s) => ({
          vials: s.vials.map((v) => (v.id === id ? { ...v, coaKey, coaMeta } : v)),
        }))
      },

      /**
       * Pull one sealed vial out of a batch and make it the active vial.
       *
       * The library's dosing, ladder, cycle and water carry across untouched —
       * only the vial size follows the batch, which is what makes the units
       * recompute when a 10 mg is replaced by a 20 mg.
       */
      activateBatch(peptideId, batchId) {
        const s = get()
        const batch = s.vials.find((v) => v.id === batchId && v.peptideId === peptideId)
        if (!batch || (batch.qtyOnHand || 0) <= 0) return false
        const p = s.peptides.find((x) => x.id === peptideId)
        if (!p) return false
        const t = todayStr()
        set({
          vials: s.vials.map((v) => (v.id === batchId ? { ...v, qtyOnHand: v.qtyOnHand - 1 } : v)),
          peptides: s.peptides.map((x) => (
            x.id === peptideId ? { ...x, recon: { ...x.recon, vialMg: batch.vialMg } } : x
          )),
          openVials: {
            ...s.openVials,
            [peptideId]: {
              remainingMg: batch.vialMg,
              vialMg: batch.vialMg,
              batchId,
              vendor: batch.vendor || '',
              lot: batch.lot || '',
              reconstitutedAt: t,
              // the clock the run-out figure reads from — only doses logged
              // after this instant came out of this vial
              activatedAt: new Date().toISOString(),
              unlinked: false,
            },
          },
        })
        return true
      },

      /**
       * Break the link between a protocol item and any vial.
       *
       * "Not in stock" is a real, supportable state: the compound still
       * schedules, still logs, still counts for adherence — it just has no vial
       * behind it, so nothing is decremented and the screens say so out loud.
       * The alternative (refusing to schedule what you have not bought) hides
       * the very doses you most need reminding about.
       */
      unlinkVial(peptideId) {
        set((s) => ({
          openVials: {
            ...s.openVials,
            [peptideId]: { remainingMg: 0, vialMg: null, batchId: null, reconstitutedAt: null, activatedAt: null, unlinked: true },
          },
        }))
      },

      /**
       * The vial in use is done. Nothing else is decremented — finishing is not
       * consuming, and picking a replacement is what takes one off the shelf.
       */
      finishVial(peptideId) {
        const s = get()
        const open = s.openVials[peptideId]
        set({
          openVials: {
            ...s.openVials,
            [peptideId]: { remainingMg: 0, vialMg: open?.vialMg ?? null, batchId: null, reconstitutedAt: null, activatedAt: null, finished: true },
          },
          finishedVials: [...(s.finishedVials || []), {
            id: `fin-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            peptideId,
            name: s.peptides.find((x) => x.id === peptideId)?.name || '',
            vialMg: open?.vialMg ?? null,
            batchId: open?.batchId || null,
            activatedAt: open?.activatedAt || null,
            finishedAt: new Date().toISOString(),
            date: todayStr(),
          }],
        })
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

      },

      // ---------- skipping ----------
      // A skip is an explicit "not today", which is a different thing from
      // forgetting. It never touches inventory — nothing was used — and it is
      // stored rather than inferred so the distinction survives.
      // `dateStr` lets a past day be cleared as deliberately as today can be:
      // "I was away that week" is a decision, and recording it as one keeps it
      // out of the missed column where it would read as a lapse.
      skipDose(peptideId, reason = '', dateStr = null) {
        const t = dateStr || todayStr()
        const s = get()
        if (s.skips.some((k) => k.kind === 'peptide' && k.peptideId === peptideId && k.date === t)) return
        const p = s.peptides.find((x) => x.id === peptideId)
        set({
          skips: [...s.skips, {
            id: `sk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            kind: 'peptide', peptideId, date: t, at: new Date().toISOString(),
            name: p?.name || '', reason: reason || '',
          }],
        })
      },
      skipSupplement(supplementId, reason = '') {
        const t = todayStr()
        const s = get()
        if (s.skips.some((k) => k.kind === 'supplement' && k.supplementId === supplementId && k.date === t)) return
        const sup = s.supplements.find((x) => x.id === supplementId)
        set({
          skips: [...s.skips, {
            id: `sk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            kind: 'supplement', supplementId, date: t, at: new Date().toISOString(),
            name: sup?.name || '', reason: reason || '',
          }],
        })
      },
      /** Skip several at once — a whole co-draw group, or a multi-selection. */
      skipMany(peptideIds = [], reason = '', dateStr = null) {
        for (const id of peptideIds) get().skipDose(id, reason, dateStr)
      },
      /** Undo a skip, putting the occurrence back on today's list. */
      unskip(id) {
        set((s) => ({ skips: s.skips.filter((k) => k.id !== id) }))
      },
      unskipToday(peptideId) {
        const t = todayStr()
        set((s) => ({
          skips: s.skips.filter((k) => !(k.kind === 'peptide' && k.peptideId === peptideId && k.date === t)),
        }))
      },

      // ---------- supplements ----------
      addSupplement(data = {}) {
        const t = todayStr()
        const id = data.id || `sup-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        if (get().supplements.some((x) => x.id === id)) return null
        // A library row already carries a considered slot; anything hand-entered
        // falls back to the category rule (daily → AM, sleep → PM).
        const entry = {
          name: '', brand: '', form: 'capsule', dose: '', doseNote: '', caution: '',
          category: 'daily', libraryId: null,
          ...data,
          slot: data.slot || slotForCategory(data.category),
          id,
          addedOn: data.addedOn || t,
        }
        set((s) => ({ supplements: [...s.supplements, entry] }))
        return id
      },
      updateSupplement(id, patch) {
        set((s) => ({
          supplements: s.supplements.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        }))
      },
      removeSupplement(id) {
        set((s) => ({
          supplements: s.supplements.filter((x) => x.id !== id),
          supplementLogs: s.supplementLogs.filter((l) => l.supplementId !== id),
        }))
      },
      // Taking a supplement is a toggle, not an event: tapping again on the same
      // day undoes a mis-tap rather than recording a second dose.
      toggleSupplementTaken(id, dateStr = null) {
        const t = dateStr || todayStr()
        const s = get()
        const existing = s.supplementLogs.find((l) => l.supplementId === id && l.date === t)
        if (existing) {
          set({ supplementLogs: s.supplementLogs.filter((l) => l !== existing) })
          return false
        }
        const supp = s.supplements.find((x) => x.id === id)
        set({
          supplementLogs: [...s.supplementLogs, {
            id: `sl-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            supplementId: id, date: t, takenAt: new Date().toISOString(),
            name: supp?.name || '', slot: supp?.slot || 'AM', dose: supp?.dose || '',
            backfilled: !!dateStr,
          }],
        })
        get().showToast(`${supp?.name || 'Supplement'} taken`, () => get().toggleSupplementTaken(id, dateStr))
        return true
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



        const hasNegative = tags.some((tg) => tg.polarity === 'neg')
        const clearDay = tags.length > 0 && !hasNegative

        get().showToast(clearDay ? 'Clear day logged' : 'Check-in logged')
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
        get().showToast('Measurement saved')
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
      // ---------- progress photos (metadata; blob lives in IndexedDB) ----------
      addPhoto({ pose, blobKey, date }) {
        const s = get()
        const entry = {
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          date: date || todayStr(), pose: pose || 'front', blobKey,
        }
        set({ photos: [...s.photos, entry].sort((a, b) => a.date.localeCompare(b.date)) })

        // 4-week photo streak: photos on ≥4 distinct ISO weeks
        get().showToast('Photo saved')
        return entry
      },
      removePhoto(id) {
        set((s) => ({ photos: s.photos.filter((p) => p.id !== id) }))
      },

      // ---------- misc ----------
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
      /**
       * Apply a round of protocol edits.
       *
       * Only the compounds passed in are touched. Everything else in the
       * protocol is left exactly as it was, because "I came here to change one
       * dose" must not be a way to lose the other eleven.
       *
       * `removed` takes compounds out of the protocol only — their stock and
       * their logged history both survive, the same as removePeptide.
       */
      applyWizard(entries, { startOver = false, startDate = null, removed = [] } = {}) {
        const t = startDate || todayStr()
        if (startOver) {
          // The one deliberate exception, behind its own confirmed checkbox.
          // Stock and logs still survive it — only the schedule is cleared.
          set((s) => ({
            peptides: [],
            titration: {},
            openVials: {},
            restock: { ...s.restock, qty: {}, checked: {}, delivery: {} },
          }))
        }
        for (const id of removed) get().removePeptide(id)

        const applied = []
        for (const entry of entries) {
          const data = toPeptide(entry, entry.existing ? (entry.startDate || t) : t)
          const exists = get().peptides.some((p) => p.id === data.id)
          if (exists) {
            get().updatePeptide(data.id, data)
            // An edit is not a restart. The rung the user has climbed to is
            // kept, only clamped if the ladder they just set is shorter than
            // where they were standing on the old one.
            set((s) => {
              const prev = s.titration[data.id] || { level: 0, levelStartDate: t }
              const { maxLevel } = currentRung({ ...data }, prev)
              return {
                titration: {
                  ...s.titration,
                  [data.id]: { ...prev, level: Math.min(prev.level ?? 0, maxLevel) },
                },
              }
            })
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
        set({ ...initialState(), toast: null })
      },
    }),
    {
      name: 'peptide-command-center', // storage key is history — renaming it would orphan existing data
      version: 8,
      storage: createJSONStorage(() => safeStorage),
      // Saves written before a release can't pick new library entries up from
      // the seed, so each version bump backfills them here — once. Deleting one
      // afterwards sticks, because the migration only runs on the bump.
      //   v1: the oil-based injectable
      //   v2: the intranasal-capable flag on Semax / Selank
      //   v3: 2 mL reconstitution default
      //   v4: oral supplements
      //   v5: thigh-only zone on the reaction-prone compounds
      //   v6: skipped doses
      //   v7: batch stock room + the active vial's own clock
      //   v8: gamification and the weekly recap removed
      migrate: (persisted, from) => {
        if (!persisted || from >= 8) return persisted
        const s = { ...persisted }
        const t = todayStr()
        if (from < 8) {
          // XP, levels, badges and streaks are gone. Dropping the slice rather
          // than leaving it inert keeps a stale streak count out of every
          // future backup file, and there is nothing here worth restoring: it
          // only ever described how the app was used, never what was taken.
          delete s.gamification
          delete s.recapSeen
          delete s.needleNotes
        }
        if (from < 7) {
          s.finishedVials = s.finishedVials || []
          // Existing rows are already one-batch-per-peptide; they just predate
          // the extra fields. Nothing is restructured — the array always allowed
          // several rows per peptide, there was simply no way to add them.
          s.vials = (s.vials || []).map((v) => ({
            sealedExpiry: '', coaKey: null, coaMeta: null, ...v,
          }))
          // The active vial gains the clock the "doses left" count reads from.
          // Backdated to when it was reconstituted where that is known, so an
          // existing part-used vial does not suddenly read as full.
          s.openVials = Object.fromEntries(
            Object.entries(s.openVials || {}).map(([id, o]) => [id, {
              ...o,
              vialMg: o?.vialMg ?? (s.peptides || []).find((p) => p.id === id)?.recon?.vialMg ?? null,
              activatedAt: o?.activatedAt || (o?.reconstitutedAt ? `${o.reconstitutedAt}T00:00:00.000Z` : null),
            }])
          )
        }
        if (from < 6) s.skips = s.skips || []
        if (from < 5) {
          // Only set a zone where the save has none — a peptide the user has
          // already given an explicit zone is their decision, not ours.
          s.peptides = (s.peptides || []).map((p) => {
            const patch = {}
            if (p.allowedZone == null && THIGH_ONLY_IDS.includes(p.id)) patch.allowedZone = 'thigh'
            // Test E moves off IM onto SubQ thigh fat, unless it was re-routed
            if (p.id === TEST_E_ID && p.route === 'IM') patch.route = 'SubQ'
            return Object.keys(patch).length ? { ...p, ...patch } : p
          })
        }
        if (from < 4) {
          // new slices, empty — nothing to convert, just present
          s.supplements = s.supplements || []
          s.supplementLogs = s.supplementLogs || []
        }
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
        if (from >= 1) return s
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
        return s
      },
      partialize: (s) => {
        const { toast, ...rest } = s
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
        // saves written before v19 have neither key
        supplements: persisted?.supplements || current.supplements,
        supplementLogs: persisted?.supplementLogs || current.supplementLogs,
        skips: persisted?.skips || current.skips,
        finishedVials: persisted?.finishedVials || current.finishedVials,
      }),
      onRehydrateStorage: () => (state) => {
        state?.enrichLibraryFromReference?.()
      },
    }
  )
)

export default useStore
