import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { format } from 'date-fns'
import {
  seedPeptides, seedVials, seedTitration, seedOpenVials, seedRuns, seedDoseEvents,
  testosteroneEnanthate, TEST_E_ID, DEFAULT_BAC_ML, LEGACY_BAC_ML,
} from '../data/seed'
import { SEED_KNOWN_GOOD } from '../lib/mixing'
import { canPush } from '../lib/pushes'
import { pauseEnd } from '../lib/pauses'
import { findMixedGroup, severityRank, migrateReactionLab } from '../lib/reactionTracker'
import { PIN_BY_ID } from '../lib/sitePins'
import { withIdentity } from '../lib/peptideIdentity'
import { applyImport } from '../lib/bloodImport'
import {
  seedGear, cleanItem, finishItem, withOption, newId as newGearId,
} from '../lib/gear'
import { DEFAULT_WINDOW_DAYS } from '../lib/siteRotation'
import { seedTests as seedBloodTests, seedMarkers as seedBloodMarkers } from '../lib/bloods'
import { currentRung, cycleInfo, addDaysStr, resolveDoseChange } from '../lib/schedule'
import { isDueToday } from '../lib/daily'
import { enrichPeptide } from '../lib/reference'
import { toPeptide } from '../lib/wizardDefaults'
import { countEntries } from '../lib/backup'
import { toMg, doseToUnits, concentration, isNasal, convertLadderForRoute } from '../lib/calc'
import { DEFAULT_BODY_REFS } from '../lib/metrics'
import { attributeSymptom, attributionSnapshot } from '../lib/attribution'
import { slotForCategory } from '../lib/supplements'
import { backfillTopicals } from '../lib/topicals'
import { applyCheck, toAbandon, localDay } from '../lib/reactionCourse'
import { captureFor, normaliseNeedle, coDrawInfo } from '../lib/injectionCapture'
import { vialOnDate } from '../lib/backfill'
import { DEFAULT_FX_USD_TO_AUD, referenceUsdPerVial } from '../lib/cost'

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
  const peptides = withIdentity(seedPeptides(t))
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
    /**
     * Doses moved to the next day.
     *
     * { id, peptideId, from, to, at } — a third outcome alongside logged and
     * skipped, and deliberately neither. "Not today, but I still mean to" is
     * what people actually do with a Mon/Thu compound, and recording it as a
     * skip would misreport a decision they did not make.
     */
    pushes: [],
    /**
     * Breaks from the protocol.
     *
     * { id, startedOn, endedOn, endsOn, reason, reasonText, note, peptideIds, at }
     * — the fourth outcome, and the only one that covers a stretch rather than a
     * single dose. `peptideIds: null` means the whole protocol. A pause draws
     * nothing, so stock is untouched and the days inside it are neither taken
     * nor missed; they are days the protocol was not running.
     */
    pauses: [],
    /**
     * Reaction tracker.
     *
     * One question: which peptide irritates the site, how badly, and for how
     * long. It reads the dose log but writes only here, so nothing in this
     * slice can disturb logging, stock or adherence.
     */
    reactionSettings: {
      checkTime: '20:00',      // when the evening check becomes due
      lastCheckAt: null,       // the last time the check was actually answered
      windowDays: DEFAULT_WINDOW_DAYS, // how far back "recent sites" looks
    },
    injectionRecords: [],      // {id, doseLogId, peptideId, pinId, siteGroup, side, timestamp, mixed}
    reactions: [],             // {injectionRecordId, ratings[], worstSeverity, goneAt, photoIds}
    safetyFlags: [],           // {id, date, type, clearedAt}
    /**
     * The photo site map.
     *
     * `photoKey` names an IndexedDB blob. The image itself never touches this
     * store, the repository or any build output, and is only in a backup when
     * `includePhotoInBackup` has been turned on by hand.
     */
    siteMap: {
      photoKey: null,
      importedAt: null,
      pinOverrides: {},        // { pinId: {x, y} } — everything else is the default table
      includePhotoInBackup: false,
    },
    /**
     * Supplies and equipment: needles, syringes, swabs, sharps.
     *
     * Its own ledger. It never reads or writes vials, doses, run-out dates or
     * adherence, and none of those read it.
     */
    gearItems: seedGear(),
    gearSwaps: [],             // one dated record per finished box
    gearOptions: {},           // dropdown values the user has added, by option key
    // Vials that have been used up. Kept as a record rather than deleted: it is
    // the only trace of how long a vial actually lasted.
    finishedVials: [],
    // Draws taken out of a shared vial by someone who is not on this protocol.
    // Deliberately not doseLogs: they move the vial, and nothing else.
    sharedDraws: [],
    /**
     * How long each compound has been run, across stops and restarts.
     *
     * { peptideId: [{ id, startedOn, endedOn|null, reason }] } — the open run
     * is the one with endedOn null. Removing a compound closes its run rather
     * than deleting it, because "I ran this for four months last year" is a
     * fact about me that survives me taking it off the list.
     */
    runs: seedRuns(peptides, t),
    /**
     * Every change to what a dose actually was, in order.
     *
     * The titration slice only ever knew the rung it is on now, which cannot
     * draw a line. These are the points on it: step-ups, holds, manual
     * overrides, route changes and the run boundaries. Append-only.
     */
    doseEvents: seedDoseEvents(peptides, t),
    /**
     * Blood results.
     *
     * tests are the record, oldest first. Everything else is what the person
     * has said about it: markers the catalogue does not carry, intervals a
     * different lab printed, notes to themselves, and how often they mean to
     * retest a panel. The seed data is imported as ordinary tests rather than
     * held apart, because a result from 2014 is a result.
     */
    bloods: {
      tests: seedBloodTests(),
      customMarkers: [],
      rangeOverrides: {},   // { [markerName]: { refLow, refHigh } }
      markerNotes: {},      // { [markerName]: 'my own words' }
      retestIntervals: {},  // { [panel]: days }
    },
    coachMarks: {}, // one-time beginner tips already seen, by id
    // restock list: horizon, per-line quantity overrides, what's been ordered,
    // expected delivery dates, and editable consumable unit costs
    restock: { horizon: 'cycles', qty: {}, checked: {}, delivery: {}, unitCostsUsd: {} },
    // fx_usd_to_aud is the only half of a price that is allowed to change
    // without the vial changing. Everything in dollars is multiplied out from
    // it at render time — see lib/cost.js for why none of it is stored.
    settings: {
      currency: 'AUD', fx_usd_to_aud: DEFAULT_FX_USD_TO_AUD, restockLeadDays: 30,
      disclaimerDismissed: false, haptics: true, sound: false,
    },
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
        get()._recordDoseEvent(id, 'route', { note: route })
      },
      updateRecon(id, patch) {
        set((s) => ({
          peptides: s.peptides.map((p) => (p.id === id ? { ...p, recon: { ...p.recon, ...patch } } : p)),
        }))
      },
      // `data.id` may carry a compound id from the matrix — keeping it as the
      // peptide id is what wires the new entry into Mix and co-draw
      // with no manual mapping. Returns null if that id is already in the stack.
      /** Append one point to the dose timeline. */
      _recordDoseEvent(peptideId, kind, patch = {}) {
        const ev = {
          id: `de-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          peptideId, kind, date: patch.date || todayStr(), at: new Date().toISOString(), ...patch,
        }
        set((s) => ({ doseEvents: [...(s.doseEvents || []), ev] }))
        return ev.id
      },

      /** Open a run for a compound, closing nothing — restarts stack up. */
      _openRun(peptideId, startedOn) {
        set((s) => {
          const mine = s.runs?.[peptideId] || []
          if (mine.some((r) => !r.endedOn)) return {}
          return {
            runs: {
              ...s.runs,
              [peptideId]: [...mine, {
                id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                startedOn: startedOn || todayStr(), endedOn: null,
              }],
            },
          }
        })
      },

      /** Close the open run. Never deletes one — the history is the point. */
      _closeRun(peptideId, reason = 'removed') {
        set((s) => {
          const mine = s.runs?.[peptideId] || []
          if (!mine.some((r) => !r.endedOn)) return {}
          return {
            runs: {
              ...s.runs,
              [peptideId]: mine.map((r) => (r.endedOn ? r : { ...r, endedOn: todayStr(), reason })),
            },
          }
        })
      },

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
        // startedOn is tenure and startDate is the schedule's anchor. They are
        // the same day when you start today, and different the moment you say
        // you have been on this since March — which is the whole point of it.
        if (!peptide.startedOn) peptide.startedOn = peptide.startDate || t
        set((s) => ({
          peptides: [...s.peptides, peptide],
          titration: { ...s.titration, [id]: { level: 0, levelStartDate: t } },
          openVials: { ...s.openVials, [id]: { remainingMg: peptide.recon.vialMg || 0, reconstitutedAt: null } },
        }))
        get()._openRun(id, peptide.startedOn)
        get()._recordDoseEvent(id, 'start', {
          date: peptide.startedOn,
          to: peptide.ladder?.floor ?? null, unit: peptide.ladder?.unit ?? null,
        })
        return id
      },

      /**
       * Move a compound's start date, including backwards.
       *
       * Tenure only. No logs are written, no stock moves and adherence does not
       * shift — a date you were taking something on is not evidence that you
       * recorded it, and the app must not manufacture the difference.
       */
      setStartedOn(id, date) {
        if (!date) return
        set((s) => ({
          peptides: s.peptides.map((p) => (p.id === id ? { ...p, startedOn: date } : p)),
          runs: {
            ...s.runs,
            [id]: (s.runs?.[id] || []).map((r, i) => (i === 0 ? { ...r, startedOn: date } : r)),
          },
          // The 'start' point is the same fact as the start date, so it moves
          // with it. Leaving it behind would draw a line that starts two years
          // after the run it belongs to.
          doseEvents: (s.doseEvents || []).map((e) => (
            e.peptideId === id && e.kind === 'start' ? { ...e, date } : e
          )),
        }))
      },

      /**
       * What I was doing before I started logging.
       *
       * Entered by hand, kept apart from logs, and labelled estimated wherever
       * it surfaces. It feeds tenure and the earliest segment of the timeline;
       * it never feeds adherence, because nothing here was recorded at the time.
       */
      setPriorDoseHistory(id, entries = []) {
        set((s) => ({
          peptides: s.peptides.map((p) => (p.id === id
            ? { ...p, priorDoseHistory: entries.filter((e) => e && e.fromDate) }
            : p)),
        }))
      },
      addPriorDose(id, entry = {}) {
        set((s) => ({
          peptides: s.peptides.map((p) => (p.id === id
            ? {
              ...p,
              priorDoseHistory: [...(p.priorDoseHistory || []), {
                id: `ph-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                fromDate: entry.fromDate || todayStr(),
                dose: entry.dose ?? p.ladder?.floor ?? 0,
                unit: entry.unit || p.ladder?.unit || 'mcg',
                frequency: entry.frequency || p.frequency || 'daily',
              }].sort((a, b) => a.fromDate.localeCompare(b.fromDate)),
            }
            : p)),
        }))
      },
      removePriorDose(id, entryId) {
        set((s) => ({
          peptides: s.peptides.map((p) => (p.id === id
            ? { ...p, priorDoseHistory: (p.priorDoseHistory || []).filter((e) => e.id !== entryId) }
            : p)),
        }))
      },
      setShortName(id, shortName) {
        set((s) => ({
          peptides: s.peptides.map((p) => (p.id === id ? { ...p, shortName: String(shortName || '').trim() } : p)),
        }))
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
        // Closes the run rather than forgetting it: re-adding later starts a
        // second run beside the first, and the lifetime total is the sum of both.
        get()._closeRun(id, 'removed')
        get()._recordDoseEvent(id, 'stop')
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
        get()._recordDoseEvent(id, 'step-up', {
          from: rungs[level], to: rungs[newLevel], unit: p.ladder.unit,
        })
        const prev = s.titration[id]
        get().showToast(
          `${p.name} stepped up to ${rungs[newLevel]} ${p.ladder.unit}`,
          () => set((st) => ({ titration: { ...st.titration, [id]: prev } }))
        )
      },
      holdStepUp(id) {
        // declined → keep dose, restart the interval so it re-asks next interval
        const s = get()
        const p = s.peptides.find((x) => x.id === id)
        set((st) => ({
          titration: { ...st.titration, [id]: { ...st.titration[id], levelStartDate: todayStr() } },
        }))
        if (p) {
          const { dose } = currentRung(p, s.titration[id])
          get()._recordDoseEvent(id, 'hold', { from: dose, to: dose, unit: p.ladder.unit })
        }
      },
      setRungLevel(id, level) {
        const s = get()
        const p = s.peptides.find((x) => x.id === id)
        if (!p) return
        const { maxLevel } = currentRung(p, s.titration[id])
        const clamped = Math.max(0, Math.min(level, maxLevel))
        const { dose: fromDose, rungs } = currentRung(p, s.titration[id])
        set((st) => ({
          titration: { ...st.titration, [id]: { level: clamped, levelStartDate: todayStr() } },
        }))
        if (rungs[clamped] !== fromDose) {
          get()._recordDoseEvent(id, 'override', {
            from: fromDose, to: rungs[clamped], unit: p.ladder.unit,
          })
        }
      },

      /**
       * Set the dose by hand, right now.
       *
       * Changing a dose used to mean walking back through Build / rebuild, which
       * is the wrong amount of ceremony for the most ordinary edit there is.
       *
       * The number is never refused: `resolveDoseChange` reshapes the ladder
       * around it instead, because refusing would leave the app disagreeing with
       * what is already in the syringe.
       *
       * Everything downstream — units per shot, vial draw-down, run-out dates,
       * time at this dose — is derived from the ladder and the rung, so all of
       * it follows without being told.
       */
      setDose(id, newDose, reason = '') {
        const s = get()
        const p = s.peptides.find((x) => x.id === id)
        if (!p) return null
        const dose = Number(newDose)
        if (!isFinite(dose) || dose <= 0) return null
        const { dose: fromDose } = currentRung(p, s.titration[id])
        if (Math.abs(dose - fromDose) < 1e-9) return null

        const snapshot = { ladder: { ...p.ladder }, titration: { ...(s.titration[id] || {}) } }

        const { ladder, level } = resolveDoseChange(p.ladder, dose)

        const t = todayStr()
        set((st) => ({
          peptides: st.peptides.map((x) => (x.id === id ? { ...x, ladder } : x)),
          titration: { ...st.titration, [id]: { ...(st.titration[id] || {}), level, levelStartDate: t } },
        }))
        const eventId = get()._recordDoseEvent(id, 'override', {
          from: fromDose, to: dose, unit: p.ladder?.unit, note: reason || null, date: t,
        })
        return { eventId, snapshot, from: fromDose, to: dose, unit: p.ladder?.unit }
      },

      /** Put a hand-set dose back the way it was, ladder and all. */
      revertDose(id, change) {
        if (!change?.snapshot) return
        set((s) => ({
          peptides: s.peptides.map((x) => (x.id === id ? { ...x, ladder: change.snapshot.ladder } : x)),
          titration: { ...s.titration, [id]: change.snapshot.titration },
          doseEvents: (s.doseEvents || []).filter((e) => e.id !== change.eventId),
        }))
      },

      // ---------- logging ----------
      // Append one dose log + decrement its inventory. No toast here so a
      // co-draw can record several doses then award once. Returns the peptide.
      _recordDose(peptideId, loggedAt, coDrawId, dateStr, opts = {}) {
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
      backfillDose(peptideId, dateStr, { doseValue = null, coDrawId = null } = {}) {
        if (!peptideId || !dateStr) return null
        const s = get()
        const v = vialOnDate(peptideId, dateStr, { openVials: s.openVials, finishedVials: s.finishedVials })
        const p = get()._recordDose(
          peptideId, new Date(`${dateStr}T12:00:00`).toISOString(), coDrawId, dateStr,
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
       * history where there was one.
       */
      backfillCoDraw(peptideIds = [], dateStr, { doses = {} } = {}) {
        if (!peptideIds.length || !dateStr) return []
        const coDrawId = `cd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const done = []
        for (const id of peptideIds) {
          const p = get().backfillDose(id, dateStr, {
            coDrawId: peptideIds.length > 1 ? coDrawId : null, doseValue: doses[id] ?? null,
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

      logDose(peptideId) {
        const p = get()._recordDose(peptideId, new Date().toISOString(), null)
        if (!p) return
        const [id] = get()._lastLoggedIds(1)
        get()._recordUnsited(peptideId, id)
        get().showToast(`${p.name} logged`, () => get().undoLog(id))
      },

      /**
       * A live injection with no site chosen yet.
       *
       * A quick log still happened somewhere on a body, so it gets a record
       * with a null pin rather than none at all. That is what lets the evening
       * check offer "Add site" on it, and what keeps it counting towards the
       * compound's own reaction rate while staying out of every per-site
       * figure. Nasal doses are not injected and get nothing.
       */
      _recordUnsited(peptideId, doseLogId) {
        const p = get().peptides.find((x) => x.id === peptideId)
        if (!p || isNasal(p)) return null
        return get().logInjection({ peptideId, pinId: null, doseLogId })
      },

      /**
       * The same dose, with a site attached.
       *
       * Deliberately _recordDose plus logInjection rather than a second logging
       * path: the dose log is what stock, adherence and every chart read, and a
       * dose logged on the body has to be indistinguishable from a quick one in
       * all of them. The only difference is that this one also knows where it
       * went.
       */
      logDoseOnSite(peptideId, pinId, extras = {}) {
        const p = get()._recordDose(peptideId, new Date().toISOString(), null)
        if (!p) return null
        const [id] = get()._lastLoggedIds(1)
        const record = get().logInjection({
          peptideId, pinId, doseLogId: id,
          ...(extras.needle !== undefined ? { needle: extras.needle } : {}),
        })
        const pin = PIN_BY_ID[pinId]
        get().showToast(
          `Logged ${p.name}, ${pin?.label || 'no site'}`,
          () => { get().removeInjectionRecord(record.id); get().undoLog(id) },
        )
        return record
      },

      /**
       * Give an already-logged dose a site.
       *
       * Attaches to the existing dose rather than writing a second one — the
       * drug was taken once, and a quick log that is later pinned is the same
       * event with more known about it.
       */
      attachSiteToDose(doseLogId, pinId) {
        const s = get()
        const existing = s.injectionRecords.find((r) => r.doseLogId === doseLogId)
        if (existing) {
          get().updateInjectionRecord(existing.id, { pinId })
          return existing
        }
        const log = s.doseLogs.find((l) => l.id === doseLogId)
        if (!log) return null
        return get().logInjection({
          peptideId: log.peptideId, pinId, doseLogId, timestamp: log.loggedAt,
        })
      },

      /**
       * Log a whole slot in one tap.
       *
       * Deliberately not a co-draw: these are separate injections that happen
       * to be due together, so they get separate logs and no shared coDrawId.
       * One toast covers the batch, and its Undo takes the whole batch back
       * out — a row of six toasts, each undoing one sixth of what just
       * happened, is not an undo anybody can use.
       */
      logMany(peptideIds = [], supplementIds = []) {
        const loggedAt = new Date().toISOString()
        const names = []
        for (const id of peptideIds) {
          const p = get()._recordDose(id, loggedAt, null)
          if (p) names.push(p.name)
        }
        const doseIds = get()._lastLoggedIds(names.length)
        // one record per dose, in the order they were just written
        peptideIds.slice(0, doseIds.length).forEach((pid, i) => get()._recordUnsited(pid, doseIds[i]))
        const suppTaken = []
        for (const id of supplementIds) {
          if (get().toggleSupplementTaken(id, null, { quiet: true })) suppTaken.push(id)
        }
        const n = names.length + suppTaken.length
        if (n === 0) return
        get().showToast(
          n === 1 ? `${names[0] || 'Taken'} logged` : `${n} logged`,
          () => {
            for (const id of doseIds) get().undoLog(id)
            for (const id of suppTaken) get().toggleSupplementTaken(id, null, { quiet: true })
          },
        )
      },

      // Co-draw: several peptides drawn into one syringe → one injection event
      // at one site with one shared timestamp + coDrawId.
      logCoDraw(peptideIds) {
        const loggedAt = new Date().toISOString()
        const coDrawId = `cd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const logged = []
        for (const id of peptideIds) {
          const p = get()._recordDose(id, loggedAt, coDrawId)
          if (p) logged.push(p)
        }
        if (!logged.length) return
        const ids = get()._lastLoggedIds(logged.length)
        get().showToast(
          logged.length > 1 ? `${logged.length} logged in one shot` : `${logged[0].name} logged`,
          () => { for (const id of ids) get().undoLog(id) }
        )
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
          // the injection record hangs off the dose: undoing one that was never
          // rated leaves nothing behind. A record that has been rated is kept,
          // because somebody looked at that site and said what they saw.
          const rx = s.injectionRecords.find((r) => r.doseLogId === logId)
          const rated = rx && s.reactions.some((x) => x.injectionRecordId === rx.id)
          return {
            doseLogs: s.doseLogs.filter((l) => l.id !== logId),
            openVials: { ...s.openVials, [log.peptideId]: open },
            injectionRecords: rx && !rated
              ? s.injectionRecords.filter((r) => r.id !== rx.id)
              : s.injectionRecords,
          }
        })
      },

      /**
       * Take back today's log for one compound.
       *
       * The toast's Undo is six seconds long, which is the right length for a
       * mis-tap and the wrong length for noticing at bedtime that you ticked
       * the wrong row this morning. This is the same reversal, reachable for
       * as long as the day lasts: the log goes, and what it drew goes back in
       * the vial.
       */
      unlogToday(peptideId, dateStr = null) {
        const t = dateStr || todayStr()
        const mine = get().doseLogs.filter((l) => l.peptideId === peptideId && l.date === t)
        if (!mine.length) return null
        // the most recent one, so a double-tap undoes what it just did
        const last = mine[mine.length - 1]
        get().undoLog(last.id)
        return last
      },

      // ---------- blood results ----------

      /**
       * Record a test.
       *
       * `values` carries only the markers that were actually measured. A marker
       * left blank is absent, not zero — a panel that did not include a marker
       * and a marker that came back at zero are different facts, and collapsing
       * them would put a false point on every graph.
       */
      addBloodTest({ date, lab = '', ref = '', notes = '', values = {} } = {}) {
        if (!date) return null
        const clean = {}
        for (const [k, v] of Object.entries(values)) {
          if (v === '' || v == null) continue
          const n = Number(v)
          if (isFinite(n)) clean[k] = n
        }
        const id = `bt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        set((s) => ({
          bloods: {
            ...s.bloods,
            tests: [...s.bloods.tests, { id, date, lab, ref, notes, values: clean, attachment: null }]
              .sort((a, b) => a.date.localeCompare(b.date)),
          },
        }))
        return id
      },

      updateBloodTest(id, patch = {}) {
        set((s) => ({
          bloods: {
            ...s.bloods,
            tests: s.bloods.tests
              .map((t) => (t.id === id ? { ...t, ...patch } : t))
              .sort((a, b) => a.date.localeCompare(b.date)),
          },
        }))
      },

      /** Set or clear one marker on one test. Clearing removes it entirely. */
      setBloodValue(id, marker, value) {
        set((s) => ({
          bloods: {
            ...s.bloods,
            tests: s.bloods.tests.map((t) => {
              if (t.id !== id) return t
              const values = { ...t.values }
              const n = Number(value)
              if (value === '' || value == null || !isFinite(n)) delete values[marker]
              else values[marker] = n
              return { ...t, values }
            }),
          },
        }))
      },

      removeBloodTest(id) {
        set((s) => ({ bloods: { ...s.bloods, tests: s.bloods.tests.filter((t) => t.id !== id) } }))
      },

      /** A marker the catalogue does not carry. */
      addCustomMarker({ name, panel = 'Chemistry', unit = '', refLow = null, refHigh = null } = {}) {
        const clean = String(name || '').trim()
        if (!clean) return null
        const s = get()
        const exists = [...seedBloodMarkers(), ...s.bloods.customMarkers].some((m) => m.name === clean)
        if (exists) return null
        set((st) => ({
          bloods: {
            ...st.bloods,
            customMarkers: [...st.bloods.customMarkers, { name: clean, panel, unit, refLow, refHigh, custom: true }],
          },
        }))
        return clean
      },

      removeCustomMarker(name) {
        set((s) => ({
          bloods: {
            ...s.bloods,
            customMarkers: s.bloods.customMarkers.filter((m) => m.name !== name),
            // and the values recorded against it, which now belong to nothing
            tests: s.bloods.tests.map((t) => {
              if (t.values?.[name] == null) return t
              const values = { ...t.values }
              delete values[name]
              return { ...t, values }
            }),
          },
        }))
      },

      /**
       * Move a reference interval.
       *
       * Two labs running the same assay publish different intervals, and the
       * one that matters is the one printed on the report in front of you. The
       * seed value is a default, never a fact.
       */
      setRangeOverride(marker, { refLow, refHigh } = {}) {
        set((s) => {
          const next = { ...s.bloods.rangeOverrides }
          if (refLow === undefined && refHigh === undefined) delete next[marker]
          else next[marker] = { ...(next[marker] || {}), ...(refLow !== undefined ? { refLow } : {}), ...(refHigh !== undefined ? { refHigh } : {}) }
          return { bloods: { ...s.bloods, rangeOverrides: next } }
        })
      },
      clearRangeOverride(marker) {
        set((s) => {
          const next = { ...s.bloods.rangeOverrides }
          delete next[marker]
          return { bloods: { ...s.bloods, rangeOverrides: next } }
        })
      },

      setMarkerNote(marker, note) {
        set((s) => ({
          bloods: { ...s.bloods, markerNotes: { ...s.bloods.markerNotes, [marker]: note } },
        }))
      },

      setRetestInterval(panel, days) {
        set((s) => ({
          bloods: {
            ...s.bloods,
            retestIntervals: { ...s.bloods.retestIntervals, [panel]: days == null ? undefined : Number(days) },
          },
        }))
      },

      /**
       * Write a previewed import into the blood record, all at once.
       *
       * Takes the plan the preview produced and nothing else: by this point every
       * decision — merge or replace, what to do with a name the app did not know,
       * which values were confirmed — has already been made on screen. Touches the
       * `bloods` slice only. Returns what happened, which test each result became
       * (so a report can be attached to it), and a `restore` that puts the record
       * back exactly as it was.
       */
      importBloodResults(plan) {
        const prev = get().bloods
        const result = applyImport(prev, plan)
        set({ bloods: result.bloods })
        return { ...result, restore: () => set({ bloods: prev }) }
      },

      /** The report itself — a PDF or a photo — kept in IndexedDB, not here. */
      setBloodAttachment(id, attachment) {
        set((s) => ({
          bloods: { ...s.bloods, tests: s.bloods.tests.map((t) => (t.id === id ? { ...t, attachment } : t)) },
        }))
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
          peptideId, vialMg: 10, usdPerVial: null, vendor: '', lot: '',
          sealedExpiry: '', coaKey: null,
          drawProfiles: [],
          qtyPurchased: 1, qtyOnHand: 1, ...data,
        }
        set((s) => ({ vials: [...s.vials, vial] }))
        return vial.id
      },

      // ---------- shared vials ----------
      // One vial, more than one person drawing from it at different doses.
      // The profiles describe who draws what; the vial's remaining_mg stays a
      // single number, because there is only one vial.
      addDrawProfile(vialId, profile = {}) {
        const id = `dp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        set((s) => ({
          vials: s.vials.map((v) => (v.id === vialId
            ? {
              ...v,
              drawProfiles: [...(v.drawProfiles || []), {
                id, label: 'Someone else', doseMg: 0, frequency: 'daily', ...profile,
              }],
            }
            : v)),
        }))
        return id
      },
      updateDrawProfile(vialId, profileId, patch) {
        set((s) => ({
          vials: s.vials.map((v) => (v.id === vialId
            ? { ...v, drawProfiles: (v.drawProfiles || []).map((d) => (d.id === profileId ? { ...d, ...patch } : d)) }
            : v)),
        }))
      },
      // Removing a profile removes a description of who draws, never the vial
      // and never anything already logged out of it.
      removeDrawProfile(vialId, profileId) {
        set((s) => ({
          vials: s.vials.map((v) => (v.id === vialId
            ? { ...v, drawProfiles: (v.drawProfiles || []).filter((d) => d.id !== profileId) }
            : v)),
        }))
      },

      /**
       * A draw taken by someone other than the stack owner.
       *
       * It comes out of the same open vial the owner's own doses come out of —
       * that is the whole point of sharing one — so it runs through the same
       * decrement, including rolling onto the next sealed vial when this one
       * runs dry. It is not a dose log: it is not on the owner's protocol, so
       * it must not touch their adherence or their history.
       */
      logSharedDraw(peptideId, profileId) {
        const s = get()
        const open = s.openVials[peptideId]
        if (!open || open.unlinked) return null
        const batch = s.vials.find((v) => v.id === open.batchId)
          || s.vials.find((v) => v.peptideId === peptideId && (v.drawProfiles || []).length > 0)
        const profile = (batch?.drawProfiles || []).find((d) => d.id === profileId)
        const doseMg = Number(profile?.doseMg)
        if (!(doseMg > 0)) return null

        const next = { ...open }
        let vials = s.vials
        next.remainingMg = Math.round((next.remainingMg - doseMg) * 1e6) / 1e6
        if (next.remainingMg <= 1e-9) {
          const idx = vials.findIndex((v) => v.peptideId === peptideId && v.qtyOnHand > 0)
          if (idx >= 0) {
            vials = vials.map((v, i) => (i === idx ? { ...v, qtyOnHand: v.qtyOnHand - 1 } : v))
            next.remainingMg = Math.round((next.remainingMg + s.vials[idx].vialMg) * 1e6) / 1e6
            next.batchId = s.vials[idx].id
            next.vialMg = s.vials[idx].vialMg
            next.reconstitutedAt = todayStr()
            next.activatedAt = new Date().toISOString()
          } else {
            next.remainingMg = Math.max(0, next.remainingMg)
          }
        }
        const draw = {
          id: `sd-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          peptideId, profileId, label: profile.label || '', doseMg,
          date: todayStr(), at: new Date().toISOString(),
        }
        set((st) => ({
          openVials: { ...st.openVials, [peptideId]: next },
          vials,
          sharedDraws: [...(st.sharedDraws || []), draw],
        }))
        get().showToast(
          `${profile.label || 'Draw'} · ${doseMg} mg out of the vial`,
          () => get().undoSharedDraw(draw.id),
        )
        return draw.id
      },
      undoSharedDraw(drawId) {
        set((s) => {
          const draw = (s.sharedDraws || []).find((d) => d.id === drawId)
          if (!draw) return {}
          const open = { ...(s.openVials[draw.peptideId] || { remainingMg: 0 }) }
          if (!open.unlinked) open.remainingMg = Math.round((open.remainingMg + draw.doseMg) * 1e6) / 1e6
          return {
            sharedDraws: s.sharedDraws.filter((d) => d.id !== drawId),
            openVials: { ...s.openVials, [draw.peptideId]: open },
          }
        })
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
      /**
       * Move today's occurrence to tomorrow.
       *
       * Repeatable with no limit — each call records another hop, so a dose can
       * follow you down the week until you log it or skip it. Nothing is drawn
       * and nothing is written to the log, so stock does not move and adherence
       * does not see a miss; the schedule is untouched, so the following doses
       * stay on their own days.
       */
      pushDose(peptideId, dateStr = null) {
        const from = dateStr || todayStr()
        const s = get()
        const p = s.peptides.find((x) => x.id === peptideId)
        if (!p || !canPush(p)) return null
        // a settled dose has no occurrence left to move
        if (s.doseLogs.some((l) => l.peptideId === peptideId && l.date === from)) return null
        if (s.skips.some((k) => k.kind === 'peptide' && k.peptideId === peptideId && k.date === from)) return null
        if (s.pushes.some((x) => x.peptideId === peptideId && x.from === from)) return null
        const to = addDaysStr(from, 1)
        const id = `pu-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        set({
          pushes: [...s.pushes, {
            id, peptideId, from, to, at: new Date().toISOString(), name: p.name || '',
          }],
        })
        return id
      },
      /** Undo a push, putting the occurrence back on the day it came from. */
      unpush(id) {
        set((s) => ({ pushes: s.pushes.filter((x) => x.id !== id) }))
      },
      /** Undo the push that moved this compound off `dateStr`. */
      unpushFrom(peptideId, dateStr = null) {
        const from = dateStr || todayStr()
        set((s) => ({
          pushes: s.pushes.filter((x) => !(x.peptideId === peptideId && x.from === from)),
        }))
      },

      // ---------- reaction tracker ----------

      updateReactionSettings(patch = {}) {
        set((s) => ({ reactionSettings: { ...s.reactionSettings, ...patch } }))
      },

      /**
       * Record one injection at one pin.
       *
       * Two peptides on the same pin at the same time cannot be told apart
       * afterwards, so both are marked `mixed` here rather than being silently
       * counted — the scorecards then leave them out instead of averaging a
       * number nobody can act on.
       */
      logInjection(rec = {}) {
        const s = get()
        const timestamp = rec.timestamp || new Date().toISOString()
        const pin = rec.pinId ? PIN_BY_ID[rec.pinId] : null
        const id = `ir-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const clash = findMixedGroup(s.injectionRecords, {
          pinId: rec.pinId, timestamp, peptideId: rec.peptideId,
        })
        // the dose is read off the ladder when the caller has not supplied one,
        // so a record logged from a pin tap alone still says how much went in
        const peptide = s.peptides.find((p) => p.id === rec.peptideId)
        const rung = peptide ? currentRung(peptide, s.titration?.[peptide.id]) : null
        const record = {
          id,
          doseLogId: rec.doseLogId || null,
          peptideId: rec.peptideId || null,
          dose: rec.dose ?? rung?.dose ?? null,
          units: rec.units ?? peptide?.ladder?.unit ?? null,
          pinId: pin ? pin.id : (rec.pinId || null),
          siteGroup: pin ? pin.group : null,
          side: pin ? pin.side : null,
          timestamp,
          mixed: !!clash.length,
          needsPinning: !pin,
          // pulled from what the app already knows, so logging stays one tap:
          // who shared the syringe, and the needle currently In use in Supplies
          // for this route. Anything the caller passes wins, and every one of
          // them can be corrected afterwards.
          ...(() => {
            const cap = captureFor({
              peptide, doseLogId: rec.doseLogId, doseLogs: s.doseLogs,
              gearItems: s.gearItems || [], records: s.injectionRecords,
            })
            return {
              coDraw: rec.coDraw ?? cap.coDraw,
              coDrawId: rec.coDrawId ?? cap.coDrawId,
              coDrawPeptideIds: rec.coDrawPeptideIds ?? cap.coDrawPeptideIds,
              needle: rec.needle !== undefined ? normaliseNeedle(rec.needle) : cap.needle,
              route: cap.route,
            }
          })(),
        }
        const clashIds = clash.map((r) => r.id)
        set((st) => ({
          injectionRecords: [
            ...st.injectionRecords.map((r) => (clashIds.includes(r.id) ? { ...r, mixed: true } : r)),
            record,
          ],
        }))
        return record
      },

      updateInjectionRecord(id, patch = {}) {
        set((s) => ({
          injectionRecords: s.injectionRecords.map((r) => {
            if (r.id !== id) return r
            const next = { ...r, ...patch }
            if (patch.pinId) {
              const pin = PIN_BY_ID[patch.pinId]
              if (pin) {
                next.siteGroup = pin.group
                next.side = pin.side
                next.needsPinning = false
              }
            }
            return next
          }),
        }))
      },

      removeInjectionRecord(id) {
        set((s) => ({
          injectionRecords: s.injectionRecords.filter((r) => r.id !== id),
          reactions: s.reactions.filter((x) => x.injectionRecordId !== id),
        }))
      },

      /**
       * Record tonight's answer for one site.
       *
       * One rating per date: answering the same evening twice corrects it
       * rather than adding a second observation of the same moment. The worst
       * severity is kept alongside, because it is what the scorecards report
       * and recomputing it on every read would make "worst so far" quietly
       * change when an old rating is corrected downwards.
       */
      rateSite(injectionRecordId, severity, date = todayStr(), symptoms = null) {
        set((s) => {
          const existing = s.reactions.find((r) => r.injectionRecordId === injectionRecordId)
          // a check that says nothing about symptoms carries yesterday's forward,
          // so a bare "still there" does not quietly erase what was ticked
          const last = existing ? [...(existing.ratings || [])].sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1) : null
          const base = existing || { injectionRecordId, ratings: [], worstSeverity: null, goneAt: null, photoIds: [] }
          const next = applyCheck(base, {
            date, severity, symptoms: symptoms ?? last?.symptoms ?? [],
          })
          return {
            reactions: existing
              ? s.reactions.map((r) => (r.injectionRecordId === injectionRecordId ? next : r))
              : [...s.reactions, next],
          }
        })
      },

      /**
       * The daily check: today's symptoms and severity, and an optional photo.
       * Gone resolves the reaction on the spot. One check a day — answering
       * again corrects it.
       */
      recordReactionCheck(injectionRecordId, { severity, symptoms = [], date = todayStr(), photoKey = null } = {}) {
        get().rateSite(injectionRecordId, severity, date, symptoms)
        if (photoKey) get().addReactionPhoto(injectionRecordId, photoKey, date)
      },

      /**
       * Log a reaction against an injection: opens it. Whatever was captured
       * with the injection can be corrected in the same breath.
       */
      logReaction(injectionRecordId, { severity = 'mild', symptoms = [], date = todayStr(), record = null, photoKey = null } = {}) {
        if (record && Object.keys(record).length) get().updateInjectionRecord(injectionRecordId, record)
        get().recordReactionCheck(injectionRecordId, { severity, symptoms, date, photoKey })
      },

      /**
       * Write down reactions that have gone a week without a check. Safe to run
       * as often as you like: it only ever marks ones not already marked, and
       * nothing is deleted.
       */
      sweepReactions(today = localDay()) {
        const list = toAbandon({ reactions: get().reactions }, today)
        if (!list.length) return 0
        const by = Object.fromEntries(list.map((x) => [x.injectionRecordId, x.abandonedAt]))
        set((s) => ({
          reactions: s.reactions.map((r) => (by[r.injectionRecordId] ? { ...r, abandonedAt: by[r.injectionRecordId] } : r)),
        }))
        return list.length
      },

      /** "Gone" — the reaction has finished. The date is what ends the duration. */
      markGone(injectionRecordId, date = todayStr()) {
        set((s) => ({
          reactions: s.reactions.map((r) => (
            r.injectionRecordId === injectionRecordId ? applyCheck(r, { date, severity: 'none' }) : r
          )),
        }))
      },

      /** "Still there" — yesterday's answer, dated today. */
      markStillThere(injectionRecordId, date = todayStr()) {
        const rx = get().reactions.find((r) => r.injectionRecordId === injectionRecordId)
        if (!rx) return
        const last = [...(rx.ratings || [])].filter((x) => x.severity !== 'none')
          .sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1)
        get().rateSite(injectionRecordId, last?.severity || rx.worstSeverity || 'mild', date, last?.symptoms ?? [])
      },

      /** One photo per row, stored as an IndexedDB blob key. No annotation. */
      addReactionPhoto(injectionRecordId, blobKey, date = todayStr()) {
        if (!blobKey) return
        set((s) => {
          const existing = s.reactions.find((r) => r.injectionRecordId === injectionRecordId)
          if (!existing) {
            return {
              reactions: [...s.reactions, {
                injectionRecordId, ratings: [], worstSeverity: null, goneAt: null, photoIds: [blobKey],
                photoDates: { [blobKey]: date },
              }],
            }
          }
          return {
            reactions: s.reactions.map((r) => (r.injectionRecordId === injectionRecordId
              ? {
                ...r,
                photoIds: [...new Set([...(r.photoIds || []), blobKey])],
                photoDates: { ...(r.photoDates || {}), [blobKey]: date },
              }
              : r)),
          }
        })
      },

      removeReactionPhoto(injectionRecordId, blobKey) {
        set((s) => ({
          reactions: s.reactions.map((r) => (r.injectionRecordId === injectionRecordId
            ? { ...r, photoIds: (r.photoIds || []).filter((k) => k !== blobKey) }
            : r)),
        }))
      },

      /** Mark the evening check answered, so it stops being due tonight. */
      recordCheck(atIso = null) {
        set((s) => ({
          reactionSettings: { ...s.reactionSettings, lastCheckAt: atIso || new Date().toISOString() },
        }))
      },

      // ---------- safety ----------

      /**
       * Raise a safety flag. These cannot be switched off in settings: the
       * banner stays until it is cleared by hand, which is the whole point of
       * it.
       */
      raiseSafetyFlag(type, date = todayStr()) {
        const s = get()
        const open = s.safetyFlags.find((f) => f.type === type && !f.clearedAt)
        if (open) return open
        const flag = { id: `sf-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, type, date, clearedAt: null }
        set((st) => ({ safetyFlags: [...st.safetyFlags, flag] }))
        return flag
      },

      clearSafetyFlag(type) {
        const now = new Date().toISOString()
        set((s) => ({
          safetyFlags: s.safetyFlags.map((f) => (
            f.type === type && !f.clearedAt ? { ...f, clearedAt: now } : f
          )),
        }))
      },

      clearAllSafetyFlags() {
        const now = new Date().toISOString()
        set((s) => ({
          safetyFlags: s.safetyFlags.map((f) => (f.clearedAt ? f : { ...f, clearedAt: now })),
        }))
      },

      // ---------- site map ----------

      /**
       * Point the map at an imported photo.
       *
       * Pin positions and history are deliberately untouched: replacing the
       * photo is retaking the same picture, not starting again, and losing
       * every adjusted pin would make anyone reluctant to replace a bad one.
       */
      setMapPhoto(photoKey) {
        set((s) => ({
          siteMap: { ...s.siteMap, photoKey, importedAt: new Date().toISOString() },
        }))
      },

      clearMapPhoto() {
        set((s) => ({ siteMap: { ...s.siteMap, photoKey: null, importedAt: null } }))
      },

      setPinOverride(pinId, pos) {
        set((s) => ({
          siteMap: {
            ...s.siteMap,
            pinOverrides: { ...s.siteMap.pinOverrides, [pinId]: { x: pos.x, y: pos.y } },
          },
        }))
      },

      resetPin(pinId) {
        set((s) => {
          const next = { ...s.siteMap.pinOverrides }
          delete next[pinId]
          return { siteMap: { ...s.siteMap, pinOverrides: next } }
        })
      },

      resetAllPins() {
        set((s) => ({ siteMap: { ...s.siteMap, pinOverrides: {} } }))
      },

      /**
       * The only thing that may turn the map photo on in a backup.
       *
       * It stamps when the choice was made, so a later migration can tell an
       * explicit "yes" apart from a value that arrived some other way and
       * needs putting back to off.
       */
      setIncludeMapPhotoInBackup(on) {
        set((s) => ({
          siteMap: {
            ...s.siteMap,
            includePhotoInBackup: !!on,
            includePhotoInBackupSetAt: new Date().toISOString(),
          },
        }))
      },

      // ---------- supplies & equipment ----------

      /**
       * Add an item, or top up the row it would duplicate.
       *
       * Returns { item, merged }. `mergeInto` is the id of an existing row the
       * caller was offered and accepted; without it a duplicate is just a second
       * row, because the person may well want one (a different brand, say).
       */
      addGearItem(data, { mergeInto = null } = {}) {
        const s = get()
        if (mergeInto) {
          const target = s.gearItems.find((i) => i.id === mergeInto)
          if (target) {
            const qty = (Number(target.qty) || 0) + (Number(data.qty) || 0)
            set({ gearItems: s.gearItems.map((i) => (i.id === mergeInto ? { ...i, qty } : i)) })
            return { item: { ...target, qty }, merged: true }
          }
        }
        const item = cleanItem({ ...data, id: newGearId('gear'), createdAt: Date.now() })
        set({ gearItems: [...s.gearItems, item] })
        return { item, merged: false }
      },

      /**
       * Change anything about an item.
       *
       * Saving an edit clears the "confirm quantity" flag: having looked at the
       * row enough to change it is as good as confirming it.
       */
      updateGearItem(id, patch = {}) {
        set((s) => ({
          gearItems: s.gearItems.map((i) => (i.id === id
            ? cleanItem({ ...i, ...patch, id, verify: false, createdAt: i.createdAt })
            : i)),
        }))
      },

      /** "Looks right" — dismiss the prompt without changing the row. */
      confirmGearItem(id) {
        set((s) => ({ gearItems: s.gearItems.map((i) => (i.id === id ? { ...i, verify: false } : i)) }))
      },

      deleteGearItem(id) {
        const before = get().gearItems
        const gone = before.find((i) => i.id === id)
        if (!gone) return
        set({ gearItems: before.filter((i) => i.id !== id) })
        get().showToast('Item deleted', () => set({ gearItems: before }))
      },

      /**
       * Finish the box in use, swapping a spare in when one is chosen.
       *
       * The toast's Undo puts back both arrays exactly as they were, so a
       * mis-tap on Finished costs nothing.
       */
      finishGearItem(itemId, { promoteId = null, date } = {}) {
        const s = get()
        const day = date || todayStr()
        const result = finishItem(s.gearItems, s.gearSwaps, { itemId, promoteId, date: day })
        if (!result.ok) {
          get().showToast(result.reason)
          return result
        }
        const prev = { gearItems: s.gearItems, gearSwaps: s.gearSwaps }
        set({ gearItems: result.items, gearSwaps: result.swaps })
        get().showToast(
          result.outcome === 'promoted'
            ? `Swapped in a new box: ${result.swap.label}`
            : `Finished: ${result.swap.label}`,
          () => set(prev),
        )
        return result
      },

      removeGearSwap(id) {
        const before = get().gearSwaps
        set({ gearSwaps: before.filter((x) => x.id !== id) })
        get().showToast('Swap removed from history', () => set({ gearSwaps: before }))
      },

      /** A new value for one dropdown. Returns the value as stored, or null if refused. */
      addGearOption(key, raw) {
        const s = get()
        const { extras, value } = withOption(s.gearOptions, key, raw, s.gearItems)
        if (value != null && extras !== s.gearOptions) set({ gearOptions: extras })
        return value
      },

      // ---------- pauses ----------

      /**
       * Stop the protocol, or part of it, for a while.
       *
       * `peptideIds: null` pauses everything. An `endsOn` ends it on its own
       * when the day comes; without one it runs until Resume is pressed. The
       * schedule is not touched and nothing is written to the log — the days
       * inside a pause are days the protocol was not running, which is a
       * different fact from a dose going unrecorded.
       */
      startPause({ reason = 'break', reasonText = '', note = '', endsOn = null, peptideIds = null, startedOn = null } = {}) {
        const t = startedOn || todayStr()
        const s = get()
        const ids = peptideIds && peptideIds.length ? [...peptideIds] : null
        // a second pause over the same compounds would double-count every day
        // inside the overlap, so the one already running is the one that stands
        const clash = s.pauses.some((p) => !pauseEnd(p)
          && (!p.peptideIds || !ids || p.peptideIds.some((x) => ids.includes(x))))
        if (clash) return null
        if (endsOn && endsOn < t) return null
        const id = `pa-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        set({
          pauses: [...s.pauses, {
            id, startedOn: t, endedOn: null, endsOn: endsOn || null,
            reason, reasonText: reason === 'other' ? reasonText.trim() : '',
            note: note.trim(), peptideIds: ids, at: new Date().toISOString(),
          }],
        })
        return id
      },

      /**
       * Come back.
       *
       * The pause keeps its dates rather than being deleted, because "we were
       * away for a fortnight in October" stays true afterwards and the calendar
       * has to keep saying so. Ending today means today is back on the protocol,
       * so the pause's last day is yesterday — unless it only started today, in
       * which case it covered nothing and goes.
       */
      endPause(id = null, onDate = null) {
        const t = onDate || todayStr()
        const s = get()
        const target = id
          ? s.pauses.find((p) => p.id === id)
          : s.pauses.find((p) => !pauseEnd(p))
        if (!target) return null
        if (target.startedOn >= t) {
          set({ pauses: s.pauses.filter((p) => p.id !== target.id) })
          return { removed: true, pause: target }
        }
        const endedOn = addDaysStr(t, -1)
        set({
          pauses: s.pauses.map((p) => (p.id === target.id ? { ...p, endedOn } : p)),
        })
        return { removed: false, pause: { ...target, endedOn } }
      },

      /** Put a pause back the way it was — the undo behind Resume. */
      restorePause(snapshot) {
        if (!snapshot) return
        set((s) => (s.pauses.some((p) => p.id === snapshot.id)
          ? { pauses: s.pauses.map((p) => (p.id === snapshot.id ? snapshot : p)) }
          : { pauses: [...s.pauses, snapshot] }))
      },

      updatePause(id, patch = {}) {
        set((s) => ({ pauses: s.pauses.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
      },

      removePause(id) {
        set((s) => ({ pauses: s.pauses.filter((p) => p.id !== id) }))
      },

      /**
       * Take the step-up that was held while everything was paused.
       *
       * Answered on the way back in rather than applied on the way out, because
       * the interval between rungs is meant to be time at a dose and a fortnight
       * not taking it is not time at it. Declining restarts the clock from today
       * instead, so the question is not asked again tomorrow.
       */
      resolveHeldStepUp(peptideId, take) {
        const s = get()
        const p = s.peptides.find((x) => x.id === peptideId)
        if (!p) return null
        const t = todayStr()
        if (!take) {
          set({ titration: { ...s.titration, [peptideId]: { ...(s.titration[peptideId] || {}), levelStartDate: t } } })
          return { advanced: false }
        }
        const { level, maxLevel, rungs } = currentRung(p, s.titration[peptideId])
        if (level >= maxLevel) return { advanced: false }
        const next = level + 1
        set({ titration: { ...s.titration, [peptideId]: { ...(s.titration[peptideId] || {}), level: next, levelStartDate: t } } })
        get()._recordDoseEvent(peptideId, 'step-up', {
          from: rungs[level], to: rungs[next], unit: p.ladder?.unit, date: t,
          note: 'taken on resume',
        })
        return { advanced: true, from: rungs[level], to: rungs[next] }
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
      toggleSupplementTaken(id, dateStr = null, { quiet = false } = {}) {
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
        if (!quiet) get().showToast(`${supp?.name || 'Supplement'} ${supp?.form === 'topical' ? 'applied' : 'taken'}`, () => get().toggleSupplementTaken(id, dateStr))
        return true
      },

      // ---------- symptoms ----------
      /**
       * A check-in, for today or for a day that has already been.
       *
       * `dateStr` is what makes this backdatable from the calendar. Everything
       * else is unchanged, including the attribution snapshot — which is taken
       * against the protocol as it stands now rather than as it stood that day,
       * because the app has no record of the latter and guessing would be worse
       * than the small inaccuracy of the former.
       */
      logSymptomCheckin({ tags, note, site, dateStr = null }) {
        const s = get()
        const t = dateStr || todayStr()
        // active peptides on this date, captured for later pattern overlay
        const active = s.peptides
          .filter((p) => cycleInfo(p, t).isOn)
          .map((p) => ({ id: p.id, name: p.name, cycleDay: cycleInfo(p, t).cycleDay, level: currentRung(p, s.titration[p.id]).level }))
        // Attribution is snapshotted onto the entry rather than recomputed on
        // read: months later the stack will have changed, and the honest answer
        // is what the suspects were on the day, not what they'd be now.
        const ctx = {
          peptides: s.peptides, titration: s.titration, doseLogs: s.doseLogs,
          doseEvents: s.doseEvents || [], todayStr: t,
        }
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

        get().showToast(
          dateStr && dateStr !== todayStr()
            ? `Check-in saved for ${dateStr}`
            : clearDay ? 'Clear day logged' : 'Check-in logged'
        )
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
      /**
       * Correct an entry that is already in the history.
       *
       * `editedAt` is stamped so the list can mark it, and the array is sorted
       * again because the date is editable: an entry moved to last March
       * belongs in last March, and every chart, trend and average below reads
       * this array in order.
       */
      updateMeasurement(id, patch = {}) {
        set((s) => ({
          measurements: s.measurements
            .map((m) => (m.id === id ? { ...m, ...patch, editedAt: new Date().toISOString() } : m))
            .sort((a, b) => a.date.localeCompare(b.date)),
        }))
      },
      deleteMeasurement(id) {
        set((s) => ({ measurements: s.measurements.filter((m) => m.id !== id) }))
      },
      /** Put a deleted or pre-edit entry back exactly as it was, for Undo. */
      restoreMeasurement(entry) {
        if (!entry) return
        set((s) => ({
          measurements: [...s.measurements.filter((m) => m.id !== entry.id), entry]
            .sort((a, b) => a.date.localeCompare(b.date)),
        }))
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
      /** Correct an imported photo's date or pose. Re-sorted, like the list is. */
      updatePhoto(id, patch = {}) {
        set((s) => ({
          photos: s.photos
            .map((p) => (p.id === id ? { ...p, ...patch } : p))
            .sort((a, b) => a.date.localeCompare(b.date)),
        }))
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
      setRestockUnitCost(id, usd) {
        set((s) => ({ restock: { ...s.restock, unitCostsUsd: { ...s.restock.unitCostsUsd, [id]: Math.max(0, usd || 0) } } }))
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
          // Unset, not zero: a vial nobody has priced falls back to the
          // reference table, and $0.00 is a price rather than a silence.
          const usd = entry.usdPerVial != null && entry.usdPerVial >= 0
            ? entry.usdPerVial
            : referenceUsdPerVial(data)
          if (qty > 0 || usd != null) {
            set((s) => ({
              vials: [
                ...s.vials.filter((v) => v.id !== `vial-${data.id}`),
                {
                  id: `vial-${data.id}`, peptideId: data.id, vialMg: data.recon.vialMg || 0,
                  usdPerVial: usd, vendor: '', lot: '', drawProfiles: [],
                  qtyPurchased: qty, qtyOnHand: qty,
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
      version: 20,
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
      //   v9: prices held in USD + one exchange rate, never in stored AUD
      //   v10: injection-site rotation removed
      //   v11: light mode removed
      //   v12: doses can be pushed to the next day
      //   v13: blood results
      //   v14: pauses
      //   v15: Reaction Lab
      //   v16: Reaction Lab replaced by the photo site map and the simplified tracker
      //   v17: the map photo is out of backups again unless it was asked for
      //   v18: a code and a colour on every compound, for the map
      //   v19: supplies and equipment, seeded from the user's own inventory
      //   v20: two nightly topicals, with the nights since each was started
      migrate: (persisted, from) => {
        if (!persisted || from >= 20) return persisted
        const s = { ...persisted }
        const t = todayStr()
        if (from < 20) {
          // Idempotent: a topical already on the shelf is reused and a night
          // that already has a log is left alone, so running this over a save
          // that has partly done it adds only what is missing.
          const next = backfillTopicals({
            supplements: s.supplements || [], supplementLogs: s.supplementLogs || [],
          }, t)
          s.supplements = next.supplements
          s.supplementLogs = next.supplementLogs
          // Reactions grow a lifecycle and injections remember who shared the
          // syringe. Past injections gain the co-draw fields from the dose they
          // hang off; their needle stays unrecorded rather than guessed, and
          // every reaction keeps the ratings it already had.
          s.injectionRecords = (s.injectionRecords || []).map((r) => {
            if (r.coDrawPeptideIds !== undefined) return r
            const co = coDrawInfo(s.doseLogs || [], r.doseLogId)
            return {
              ...r,
              coDraw: co.coDraw, coDrawId: co.coDrawId,
              coDrawPeptideIds: co.peptideIds.length ? co.peptideIds : [r.peptideId].filter(Boolean),
              needle: r.needle ?? null,
            }
          })
        }
        if (from < 19) {
          // Only ever added, never replaced: a save that somehow already has an
          // inventory keeps it. Nothing outside the three gear keys is touched,
          // which is the whole point of keeping it a separate ledger.
          s.gearItems = s.gearItems || seedGear()
          s.gearSwaps = s.gearSwaps || []
          s.gearOptions = s.gearOptions || {}
        }
        if (from < 18) {
          // Codes and colours are added, never overwritten: a library edited by
          // hand keeps whatever it was given.
          s.peptides = withIdentity(s.peptides || [])
          s.reactionSettings = {
            ...(s.reactionSettings || {}),
            windowDays: s.reactionSettings?.windowDays ?? DEFAULT_WINDOW_DAYS,
          }
        }
        if (from < 17) {
          // "Include map photo in backup" is meant to be off until somebody
          // turns it on. Nothing but the switch could ever have set it, and the
          // switch did not record that it had been used — so a `true` here
          // cannot be shown to be the user's choice, and a full-body photograph
          // is not a thing to leave in a backup file on the balance of doubt.
          if (s.siteMap && !s.siteMap.includePhotoInBackupSetAt) {
            s.siteMap = { ...s.siteMap, includePhotoInBackup: false }
          }
        }
        if (from < 16) {
          // Reaction Lab is gone. Its records are not: every injection is
          // re-pinned to the nearest site on the photo map, every check-in is
          // read as one of the four words, and every resolved date becomes a
          // "Gone" date. Anything that had no site to re-pin to is kept with
          // `needsPinning` set, so it can be placed by hand instead of being
          // dropped — the one thing a migration must never do.
          const { records, reactions, unmapped } = migrateReactionLab({
            injectionRecords: s.injectionRecords || [],
            reactions: s.reactions || [],
            reactionCheckins: s.reactionCheckins || [],
            reactionPhotos: s.reactionPhotos || [],
          })
          s.injectionRecords = records
          s.reactions = reactions
          s.safetyFlags = s.safetyFlags || []
          s.siteMap = s.siteMap || {
            photoKey: null, importedAt: null, pinOverrides: {}, includePhotoInBackup: false,
          }
          s.reactionSettings = {
            checkTime: s.reactionSettings?.windowTimes?.evening || '20:00',
            lastCheckAt: null,
          }
          if (unmapped.length) {
            // eslint-disable-next-line no-console
            console.warn(`[v16] ${unmapped.length} injection(s) had no site on the photo map and need pinning by hand:`, unmapped)
          }
          delete s.reactionCheckins
          delete s.reactionPhotos
          delete s.reactionTreatments
          delete s.investigations
          delete s.investigationSteps
        }
        if (from < 14) {
          // A save written before pauses existed has none. The key is created
          // so nothing downstream has to guard for it.
          s.pauses = s.pauses || []
        }
        if (from < 13) {
          // A save written before the Bloods tab existed has no results at all,
          // so it gets the seed — the same import a fresh install gets. A save
          // that somehow already has some keeps them untouched.
          // Anything the save already said about markers is kept; only the
          // results themselves are seeded, and only when there are none.
          s.bloods = {
            customMarkers: [],
            rangeOverrides: {},
            markerNotes: {},
            retestIntervals: {},
            ...(s.bloods || {}),
            tests: s.bloods?.tests?.length ? s.bloods.tests : seedBloodTests(),
          }
        }
        if (from < 12) {
          // Nothing to backfill — a save written before pushes existed simply
          // has none. The key is created so nothing downstream has to guard.
          s.pushes = s.pushes || []
        }
        if (from < 11) {
          // The app is dark only now. Nothing reads settings.theme any more, and
          // a dead key would otherwise ride along in every backup from here on.
          if (s.settings) {
            const { theme, ...settings } = s.settings
            s.settings = settings
          }
        }
        if (from < 10) {
          // Tenure needs a starting point and an open run for everything
          // already on the protocol. The honest one is the schedule's own
          // startDate — the first day the app believed a dose was due — and
          // the user can move it backwards from there.
          s.doseEvents = s.doseEvents || []
          s.runs = s.runs || {}
          for (const p of (s.peptides || [])) {
            if (!p.startedOn) p.startedOn = p.startDate || t
            if (!s.runs[p.id]?.length) {
              s.runs[p.id] = [{ id: `run-${p.id}`, startedOn: p.startedOn, endedOn: null }]
            }
            // The rung standing now is the only dose history that was ever
            // stored, so it becomes the first point on the line rather than
            // the line starting empty for everyone who upgrades.
            if (!s.doseEvents.some((e) => e.peptideId === p.id)) {
              s.doseEvents.push({
                id: `de-mig-${p.id}`, peptideId: p.id, kind: 'start', date: p.startedOn, at: null,
                to: p.ladder?.floor ?? null, unit: p.ladder?.unit ?? null,
              })
            }
          }
          // Rotation is gone: the reaction log, the path mode and the per-
          // compound zone described a feature that no longer exists, and a
          // dead slice in storage is a dead slice in every future backup.
          //
          // The siteId already on a dose log is left exactly where it is. Those
          // are records of things that happened, the app simply stops reading
          // the field — deleting history to tidy up a removed feature would be
          // the app editing the past to match its own present.
          delete s.siteReactions
          delete s.rotation
          s.peptides = (s.peptides || []).map(({ allowedZone, ...p }) => p)
        }
        if (from < 9) {
          // Money stops being stored in AUD. An existing costAud was entered at
          // whatever rate was in force then, and nothing recorded what that was
          // — so the default rate is the only honest divisor available, and the
          // result is the figure that reproduces what the user already sees.
          // A zero is dropped rather than carried across: it always meant
          // "never filled in", and keeping it would read as "this was free" and
          // block the reference price from ever standing in.
          const fx = DEFAULT_FX_USD_TO_AUD
          s.settings = { fx_usd_to_aud: fx, ...(s.settings || {}) }
          s.sharedDraws = s.sharedDraws || []
          s.vials = (s.vials || []).map((v) => {
            const { costAud, ...rest } = v
            const usd = rest.usdPerVial != null
              ? rest.usdPerVial
              : (costAud > 0 ? Math.round((costAud / fx) * 100) / 100 : null)
            return { ...rest, usdPerVial: usd, drawProfiles: rest.drawProfiles || [] }
          })
          // The restock list kept its own per-unit AUD overrides. Same rule.
          if (s.restock?.unitCosts) {
            s.restock = {
              ...s.restock,
              unitCostsUsd: Object.fromEntries(
                Object.entries(s.restock.unitCosts)
                  .filter(([, aud]) => aud > 0)
                  .map(([id, aud]) => [id, Math.round((aud / fx) * 100) / 100])
              ),
            }
            delete s.restock.unitCosts
          }
        }
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
          // The zone this step used to set is gone with rotation; the route
          // change it also made is not, so that half stays.
          s.peptides = (s.peptides || []).map((p) => (
            p.id === TEST_E_ID && p.route === 'IM' ? { ...p, route: 'SubQ' } : p
          ))
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
            usdPerVial: null, vendor: '', lot: '', drawProfiles: [], qtyPurchased: 1, qtyOnHand: 1,
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
        // saves written before v19 have neither key
        supplements: persisted?.supplements || current.supplements,
        supplementLogs: persisted?.supplementLogs || current.supplementLogs,
        skips: persisted?.skips || current.skips,
        finishedVials: persisted?.finishedVials || current.finishedVials,
        sharedDraws: persisted?.sharedDraws || current.sharedDraws,
        doseEvents: persisted?.doseEvents || current.doseEvents,
        pushes: persisted?.pushes || current.pushes,
        pauses: persisted?.pauses || current.pauses,
        reactionSettings: { ...current.reactionSettings, ...(persisted?.reactionSettings || {}) },
        injectionRecords: persisted?.injectionRecords || current.injectionRecords,
        reactions: persisted?.reactions || current.reactions,
        safetyFlags: persisted?.safetyFlags || current.safetyFlags,
        // an empty inventory is a real state (everything deleted), so these take
        // the saved value whenever there is one, not only when it is non-empty
        gearItems: persisted?.gearItems || current.gearItems,
        gearSwaps: persisted?.gearSwaps || current.gearSwaps,
        gearOptions: persisted?.gearOptions || current.gearOptions,
        siteMap: {
          ...current.siteMap,
          ...(persisted?.siteMap || {}),
          pinOverrides: { ...(persisted?.siteMap?.pinOverrides || {}) },
        },
        bloods: { ...current.bloods, ...(persisted?.bloods || {}) },
        runs: { ...current.runs, ...(persisted?.runs || {}) },
        // merged rather than replaced, so a setting added in a later release
        // arrives with its default instead of being undefined on every existing
        // save — fx_usd_to_aud is the first one this actually matters for
        settings: { ...current.settings, ...(persisted?.settings || {}) },
      }),
      onRehydrateStorage: () => (state) => {
        state?.enrichLibraryFromReference?.()
      },
    }
  )
)

export default useStore
