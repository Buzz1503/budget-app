import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Info, Clock, AlertTriangle, Sun, Moon, ChevronRight, Syringe, X, ShieldCheck, Layers, Wind, Bell, Zap, SkipForward, Undo2, PackageOpen, MoreHorizontal } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import { cyclePhase, currentRung, stepUpDue, addDaysStr, prettyDate } from '../lib/schedule'
import { isDueToday, slotOf, isDueSlot, currentSlot, slotIsFlexible, needsProtocolSetup } from '../lib/daily'
import { formatDose, formatUnitsLong, unitsFor, round, isNasal } from '../lib/calc'
import { displayName } from '../lib/naming'
import { tenureFor, milestonesFor } from '../lib/tenure'
import { loadMatrix, LIB_TO_COMPOUND } from '../lib/mixMatrix'
import { planShots, MAX_GROUP_ML } from '../lib/grouping'
import { expiryInfo, runOutInfo } from '../lib/inventory'
import { backupNudge, countEntries } from '../lib/backup'
import { deliveryCovers } from '../lib/restock'
import Modal from './ui/Modal'
import CoachTip from './ui/CoachTip'
import Term from './ui/Term'
import CoDrawModal from './CoDrawModal'
import { dueInSlot, takenOn, FORM_LABEL } from '../lib/supplements'
import { skippedOn, supplementsSkippedOn, skipFor, SKIP_REASONS, REASON_LABEL } from '../lib/skips'
import { activeVialStatus, coverageFor, coverageWords } from '../lib/stock'
import ReplaceVial from './ReplaceVial'
import CompoundSheet from './CompoundSheet'
import { FormIcon } from './SupplementsTab'

const spring = { type: 'spring', stiffness: 260, damping: 22 }

export default function Home({ goTo }) {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const runs = useStore((s) => s.runs)
  const openVials = useStore((s) => s.openVials)
  const vials = useStore((s) => s.vials)
  const settings = useStore((s) => s.settings)
  const restock = useStore((s) => s.restock)
  const updateSettings = useStore((s) => s.updateSettings)

  const t = todayStr()
  const [slot, setSlot] = useState(() => currentSlot())
  const [selected, setSelected] = useState(() => new Set()) // co-draw selection
  const [coDraw, setCoDraw] = useState(false)
  const [showAbout, setShowAbout] = useState(false)

  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const scheduledToday = useMemo(() => peptides.filter((p) => isDueToday(p, t)), [peptides, t])
  /**
   * Cycled compounds sitting out their off-weeks.
   *
   * They are still on the protocol — they have not been stopped — so they stay
   * on the screen. Vanishing for a fortnight is what makes people think an item
   * has been lost, and re-add it as a second copy. Shown without a Log button,
   * because injecting one today would break the rest that is the point of it.
   */
  const resting = useMemo(() => peptides
    .filter((p) => !needsProtocolSetup(p))
    .map((p) => ({ p, phase: cyclePhase(p, t) }))
    .filter((r) => r.phase.phase === 'rest')
    .sort((a, b) => a.phase.daysLeft - b.phase.daysLeft), [peptides, t])
  const slotDue = useMemo(() => scheduledToday.filter((p) => slotOf(p) === slot), [scheduledToday, slot])
  const otherSlot = slot === 'AM' ? 'PM' : 'AM'
  const otherCount = scheduledToday.filter((p) => slotOf(p) === otherSlot).length

  // Oral supplements ride alongside the injections but never mix with them:
  // no site, no co-draw, no units. They do count towards the day, because a
  // morning is not finished while half of it is still on the shelf.
  const supplements = useStore((s) => s.supplements)
  const supplementLogs = useStore((s) => s.supplementLogs)
  const toggleSupplementTaken = useStore((s) => s.toggleSupplementTaken)
  const skips = useStore((s) => s.skips)
  const skipDose = useStore((s) => s.skipDose)
  const skipSupplement = useStore((s) => s.skipSupplement)
  const skipMany = useStore((s) => s.skipMany)
  const unskipToday = useStore((s) => s.unskipToday)
  const unskip = useStore((s) => s.unskip)
  // what has been deliberately set aside today
  const skippedIds = useMemo(() => skippedOn(skips, t), [skips, t])
  const skippedSupps = useMemo(() => supplementsSkippedOn(skips, t), [skips, t])
  // the sheet that asks why, shared by both kinds
  const [skipping, setSkipping] = useState(null)
  // the peptide whose vial just ran out, and which now needs a replacement
  const finishVial = useStore((s) => s.finishVial)
  const [replacing, setReplacing] = useState(null)
  const [sheetId, setSheetId] = useState(null)
  const slotSupps = useMemo(() => dueInSlot(supplements, slot), [supplements, slot])
  const takenIds = useMemo(() => takenOn(supplementLogs, t), [supplementLogs, t])
  const suppDone = slotSupps.filter((x) => takenIds.has(x.id)).length

  const loggedToday = useMemo(
    () => new Set(doseLogs.filter((l) => l.date === t).map((l) => l.peptideId)),
    [doseLogs, t]
  )

  const logDose = useStore((st) => st.logDose)
  const logMany = useStore((st) => st.logMany)

  // Everything in this slot still waiting on a tap — injections and orals
  // together, because "log all" has to mean all of it.
  const outstandingPeptides = useMemo(
    () => slotDue.filter((p) => !loggedToday.has(p.id) && !skippedIds.has(p.id)),
    [slotDue, loggedToday, skippedIds]
  )
  const outstandingSupps = useMemo(
    () => slotSupps.filter((x) => !takenIds.has(x.id) && !skippedSupps.has(x.id)),
    [slotSupps, takenIds, skippedSupps]
  )
  const outstanding = outstandingPeptides.length + outstandingSupps.length
  const logSlot = () => logMany(
    outstandingPeptides.map((p) => p.id),
    outstandingSupps.map((x) => x.id),
  )

  /**
   * Anything still open from the slot that has already been and gone.
   *
   * The app flips itself to PM partway through the day, and whatever the
   * morning did not get is then one tab away and invisible — which is exactly
   * when it is most likely to be forgotten.
   */
  const earlierSlot = slot === 'PM' ? 'AM' : null
  const earlierDue = useMemo(() => {
    if (!earlierSlot) return []
    return scheduledToday
      .filter((p) => slotOf(p) === earlierSlot)
      .filter((p) => !loggedToday.has(p.id) && !skippedIds.has(p.id))
  }, [earlierSlot, scheduledToday, loggedToday, skippedIds])
  const earlierSupps = useMemo(() => {
    if (!earlierSlot) return []
    return dueInSlot(supplements, earlierSlot)
      .filter((x) => !takenIds.has(x.id) && !skippedSupps.has(x.id))
  }, [earlierSlot, supplements, takenIds, skippedSupps])
  const logEarlier = () => logMany(
    earlierDue.map((p) => p.id),
    earlierSupps.map((x) => x.id),
  )
  // selection resolved against the live slot list so done/removed/skipped ids drop out
  const selectedPeptides = slotDue.filter(
    (p) => selected.has(p.id) && !loggedToday.has(p.id) && !skippedIds.has(p.id)
  )
  // A skipped item is settled, not outstanding: it leaves the denominator
  // entirely rather than sitting in it as a permanent shortfall. Deciding not
  // to do something is a decision, and the ring should not scold you for it.
  const slotSkipped = slotDue.filter((p) => skippedIds.has(p.id)).length
    + slotSupps.filter((x) => skippedSupps.has(x.id)).length
    + supplements.filter((x) => skippedSupps.has(x.id)).length
  const slotTotal = Math.max(0, slotDue.length + slotSupps.length - slotSkipped)
  const firstRun = doseLogs.length === 0

  // "back up your data" nudge — weekly, or after a batch of new entries
  const backupMeta = useStore((s) => s.backupMeta)
  const symptomLogs = useStore((s) => s.symptomLogs)
  const measurements = useStore((s) => s.measurements)
  const photos = useStore((s) => s.photos)
  const dismissBackupNudge = useStore((s) => s.dismissBackupNudge)
  const nudge = useMemo(() => {
    if (!backupMeta) return null
    // stay quiet for a day after an explicit dismiss
    if (backupMeta.nudgeDismissedAt && Date.now() - new Date(backupMeta.nudgeDismissedAt) < 86400000) return null
    return backupNudge({
      lastBackupAt: backupMeta.lastBackupAt,
      lastBackupEntryCount: backupMeta.lastBackupEntryCount,
      entryCount: countEntries({ doseLogs, symptomLogs, measurements, photos }),
    })
  }, [backupMeta, doseLogs, symptomLogs, measurements, photos])

  // ---- chemistry: one source for both the per-card hint and the plan ----
  // The matrix is a ~1.9 MB lazy chunk, so it's only pulled in once there are
  // two or more injections in this slot that could conceivably share a syringe.
  const [matrix, setMatrix] = useState(null)
  const injectable = useMemo(() => slotDue.filter((p) => !isNasal(p)), [slotDue])
  useEffect(() => {
    if (matrix || injectable.length < 2) return
    let alive = true
    loadMatrix().then((m) => { if (alive) setMatrix(m) }).catch(() => { /* hints stay hidden */ })
    return () => { alive = false }
  }, [matrix, injectable.length])

  const verdictOf = useMemo(() => {
    if (!matrix) return null
    return (a, b) => matrix.lookup(LIB_TO_COMPOUND[a] || a, LIB_TO_COMPOUND[b] || b)?.verdict || null
  }, [matrix])

  const unloggedInjectable = useMemo(
    () => injectable.filter((p) => !loggedToday.has(p.id)), [injectable, loggedToday]
  )

  const plan = useMemo(() => {
    if (!matrix || unloggedInjectable.length < 2) return null
    const items = unloggedInjectable.map((p) => {
      const units = unitsFor(p, currentRung(p, titration[p.id]).dose)
      return {
        id: p.id,
        // an always-separate compound never gets a compound id, so it can't
        // even be considered for a group
        compoundId: p.alwaysSeparate ? null : (LIB_TO_COMPOUND[p.id] || p.id),
        name: p.name,
        units,
        ml: units / 100,
        separate: !!p.alwaysSeparate,
        separateReason: p.separateReason,
      }
    })
    return planShots(items, (a, b) => matrix.lookup(a, b)?.verdict || null)
  }, [matrix, unloggedInjectable, titration])

  const acceptGroup = (group) => {
    setSelected(new Set(group.items.map((i) => i.id)))
    setCoDraw(true)
  }

  const alerts = useMemo(() => {
    const out = []
    for (const p of peptides) {
      const exp = expiryInfo(p, openVials[p.id], t)
      if (exp && exp.daysLeft <= 5) {
        out.push({
          id: `exp-${p.id}`, kind: exp.daysLeft < 0 ? 'expired' : 'expiring',
          text: exp.daysLeft < 0
            ? `${p.name} vial expired ${-exp.daysLeft}d ago — discard and reconstitute fresh`
            : `${p.name} vial expires in ${exp.daysLeft}d (fridge)`,
        })
      }
      // Counted off the SEALED shelf rather than everything you own: the open
      // vial is already draining and reports its own doses-left on the card.
      // Adding the two together produces a number that reads fine right up
      // until the morning there is nothing to open.
      const cov = coverageFor(p, titration[p.id], vials, t)
      if (isFinite(cov.days) && cov.days <= settings.restockLeadDays) {
        // an order already on the way answers this — say so instead of nagging,
        // and drop it entirely once the delivery date has passed
        const covered = deliveryCovers(restock, p.id, cov.runOutDate, t)
        if (covered?.arrived) continue
        out.push(covered
          ? { id: `stock-${p.id}`, kind: 'ordered', text: `${coverageWords(cov.weeks)} of ${p.name} left — delivery expected ${covered.eta}` }
          : {
            id: `stock-${p.id}`,
            kind: 'stock',
            text: cov.vials === 0
              ? `No sealed ${p.name} left across your vials — reorder`
              : `${coverageWords(cov.weeks)} of ${p.name} left across your vials — reorder`,
          })
      }
    }
    return out
  }, [peptides, openVials, vials, titration, settings.restockLeadDays, restock, t])

  /**
   * The titration question, moved off the card list.
   *
   * It is a decision about a dose rather than a dose to take, and asking it in
   * the middle of a list of things to do is how it got ignored for weeks.
   */
  const stepUps = useMemo(() => scheduledToday
    .filter((p) => stepUpDue(p, titration[p.id], t))
    .map((p) => {
      const { dose } = currentRung(p, titration[p.id])
      return {
        id: p.id,
        name: displayName(p),
        weeks: p.ladder?.intervalWeeks || 1,
        doseText: formatDose(dose, p.ladder?.unit),
      }
    }), [scheduledToday, titration, t])

  /**
   * Markers reached today.
   *
   * Four weeks, eight, twelve, six months, a year — the kind of thing people
   * notice about a compound long after the app has stopped having anything new
   * to say about it. Off the cards and into the bell, once, on the day.
   */
  const milestones = useMemo(() => peptides.map((p) => {
    const ten = tenureFor(p, { runs, todayStr: t })
    const hit = ten?.running ? milestonesFor(ten.currentDays).today : null
    return hit ? { id: p.id, text: `${displayName(p)} — ${hit.label} on it today.` } : null
  }).filter(Boolean), [peptides, runs, t])

  // Everything still owed today across both slots, so the bell can clear it.
  const overdueToday = useMemo(() => [
    ...scheduledToday
      .filter((p) => !loggedToday.has(p.id) && !skippedIds.has(p.id))
      .map((p) => ({ kind: 'peptide', id: p.id, name: displayName(p) })),
    ...supplements
      .filter((x) => !takenIds.has(x.id) && !skippedSupps.has(x.id))
      .map((x) => ({ kind: 'supplement', id: x.id, name: x.name })),
  ], [scheduledToday, loggedToday, skippedIds, supplements, takenIds, skippedSupps])
  const logOverdue = () => logMany(
    overdueToday.filter((x) => x.kind === 'peptide').map((x) => x.id),
    overdueToday.filter((x) => x.kind === 'supplement').map((x) => x.id),
  )

  const now = new Date()

  return (
    <div className="space-y-3">
      {/* Shown once, on first launch, and never again — it is not a standing
          row in the column. Afterwards it lives behind the ⓘ in the header. */}
      <Disclaimer
        open={!settings.disclaimerDismissed || showAbout}
        firstRun={!settings.disclaimerDismissed}
        onClose={() => { updateSettings({ disclaimerDismissed: true }); setShowAbout(false) }}
      />

      {/* screen title + alerts + slot toggle */}
      <div>
        <p className="t-caption" style={{ color: 'var(--text-3)' }}>Pepito +</p>
        <h1 className="t-display mt-1">
          Today, {now.getDate()} {now.toLocaleDateString(undefined, { month: 'long' })}
        </h1>
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="t-caption flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
            {now.toLocaleDateString(undefined, { weekday: 'long' })}
            <button onClick={() => setShowAbout(true)} aria-label="About this app" style={{ color: 'var(--text-3)' }}>
              <Info size={12} />
            </button>
          </p>
          <div className="flex shrink-0 items-center gap-2">
          <AlertBell alerts={alerts} nudge={nudge} goTo={goTo} onDismissNudge={dismissBackupNudge}
            stepUps={stepUps} overdue={overdueToday} onLogOverdue={logOverdue} milestones={milestones} />
          <div className="sunk flex p-1" style={{ borderRadius: 'var(--r-pill)' }}>
            {['AM', 'PM'].map((s) => (
              <button key={s} onClick={() => setSlot(s)} aria-label={s}
                className="relative flex min-h-[36px] items-center gap-1 px-3 text-sm font-medium"
                style={{ borderRadius: 'var(--r-pill)' }}>
                {slot === s && <motion.span layoutId="slot-pill" className="absolute inset-0"
                  style={{ background: 'var(--accent)', borderRadius: 'var(--r-pill)' }} />}
                <span className="relative flex items-center gap-1"
                  style={{ color: slot === s ? 'var(--accent-fg)' : 'var(--text-2)' }}>
                  {s === 'AM' ? <Sun size={14} /> : <Moon size={14} />}{s}
                </span>
              </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* first-run pointer at the row */}
      <CoachTip id="log-button" when={slotDue.length > 0}>
        Tap a row to log it — that is the whole thing. Undo sits on the toast if you mis-tap,
        and <span className="font-black">…</span> holds skip and vial actions.
      </CoachTip>

      {/* anything still open from earlier today, without changing tabs */}
      <EarlierSlot from={earlierSlot} count={earlierDue.length + earlierSupps.length}
        onLogAll={logEarlier} onSwitch={() => setSlot(earlierSlot)} />

      {/* The day's doses as rows in one card, divided by hairlines. A stack of
          separate floating cards was most of this screen's visual noise. */}
      <div className="card rows overflow-hidden">
        {slotTotal === 0 && (
          <div className="p-8 text-center">
            <p className="t-label" style={{ color: 'var(--text-2)' }}>
              {slot === 'AM' ? "Nothing this morning — you're clear" : "Nothing tonight — you're clear"}
            </p>
            {otherCount > 0 && (
              <button onClick={() => setSlot(otherSlot)} className="t-label mt-2 inline-flex items-center gap-1" style={{ color: 'var(--text)' }}>
                {otherCount} due this {otherSlot} <ChevronRight size={14} />
              </button>
            )}
          </div>
        )}
        {/* One tap for the whole slot. Above the rows because it is the fastest
            path through them, and gone once nothing is outstanding rather than
            lingering as a dead button. */}
        {outstanding > 1 && (
          <div className="px-4 pb-1 pt-4">
            <motion.button whileTap={{ scale: 0.98 }} onClick={logSlot} data-testid="log-all"
              className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-xs font-black">
              <Check size={14} strokeWidth={3} /> Log all {outstanding} this {slot}
            </motion.button>
          </div>
        )}
        {/* quieter: a label, not a banner */}
        {slotDue.length > 0 && slotSupps.length > 0 && (
          <p className="px-4 pb-1 pt-5 text-xs font-medium"
            style={{ color: 'var(--text-3)' }} data-testid="inject-heading">
            Inject
          </p>
        )}
        {slotDue.map((p, i) => (
          <DueCard key={p.id} peptide={p} index={i} done={loggedToday.has(p.id)}
            titration={titration}
            onLog={() => logDose(p.id)}
            selected={selected.has(p.id)} onToggleSelect={() => toggleSelect(p.id)}
            skipped={skippedIds.has(p.id)}
            skipReason={skipFor(skips, p.id, t)?.reason}
            onSkip={() => setSkipping({ kind: 'peptide', ids: [p.id], name: p.name })}
            onUnskip={() => unskipToday(p.id)}
            onFinishVial={() => { finishVial(p.id); setReplacing(p.id) }}
            onOpenSheet={setSheetId}
            beckon={firstRun && i === slotDue.findIndex((x) => !loggedToday.has(x.id))} />
        ))}
      </div>

      {/* Oral group — deliberately its own block. No site, no co-draw, no
          units: tapping it is the whole interaction. */}
      {slotSupps.length > 0 && (
        <div className="space-y-2" data-testid="take-group">
          <p className="px-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            Take · {suppDone}/{slotSupps.length}
          </p>
          {slotSupps.map((sup, i) => (
            <TakeRow key={sup.id} supplement={sup} taken={takenIds.has(sup.id)} index={i}
              skipped={skippedSupps.has(sup.id)}
              onToggle={() => toggleSupplementTaken(sup.id)}
              onSkip={() => setSkipping({ kind: 'supplement', ids: [sup.id], name: sup.name })}
              onUnskip={() => {
                const rec = skips.find((k) => k.kind === 'supplement' && k.supplementId === sup.id && k.date === t)
                if (rec) unskip(rec.id)
              }} />
          ))}
        </div>
      )}

      {/* Below the cards, not above them: the individual doses are the job,
          and combining them is a shortcut offered once you can see what there
          is to combine. */}
      {plan && plan.saved > 0 && selected.size === 0 && (
        <ShotPlan plan={plan} slot={slot} onAccept={acceptGroup} />
      )}

      {/* Still on the protocol, just not today. */}
      <RestingGroup resting={resting} onOpenSheet={setSheetId} />

      {/* what tomorrow asks for, with the doses */}
      <Tomorrow />

      {/* keeps the last card clear of the floating co-draw bar */}
      {selected.size > 0 && <div aria-hidden className="h-20" />}

      <ReplaceVial
        open={!!replacing} peptideId={replacing}
        onClose={() => setReplacing(null)} goTo={goTo} />

      <CompoundSheet open={!!sheetId} compoundId={sheetId}
        onClose={() => setSheetId(null)} goTo={goTo} />

      <SkipSheet
        target={skipping}
        onClose={() => setSkipping(null)}
        onConfirm={(reason) => {
          if (!skipping) return
          if (skipping.kind === 'supplement') skipSupplement(skipping.ids[0], reason)
          else skipMany(skipping.ids, reason)
          setSkipping(null)
          setSelected(new Set())
        }} />

      {/* co-draw action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            // z-45 sits above the nav (z-40) but below modals (z-50); --nav-h is
            // the nav's measured height, safe-area inset included
            className="fixed inset-x-0 z-[45] px-3"
            style={{ bottom: 'calc(var(--nav-h, 92px) + 10px)' }}
            data-testid="codraw-bar"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-[14px] p-3 shadow-lg"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 8px 30px rgba(0,0,0,0.45)' }}>
              <button onClick={() => setSelected(new Set())} className="shrink-0 rounded-full p-2" style={{ background: 'var(--surface-sunk)' }} aria-label="Clear selection">
                <X size={16} />
              </button>
              <div className="min-w-0 flex-1 text-xs font-bold leading-tight">
                {selected.size} selected{selected.size < 2 ? ' · pick 1 more' : ' · one shot, one site'}
              </div>
              <motion.button whileTap={{ scale: 0.95 }} data-testid="skip-selected"
                onClick={() => setSkipping({
                  kind: 'peptide',
                  ids: selectedPeptides.map((x) => x.id),
                  name: selectedPeptides.map((x) => x.name).join(', '),
                })}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-3 text-xs font-black"
                style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}
                aria-label="Skip the selected doses">
                <SkipForward size={14} /> Skip
              </motion.button>
              <motion.button whileTap={{ scale: 0.95 }} disabled={selected.size < 2}
                onClick={() => setCoDraw(true)}
                className="btn-primary flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-3 text-sm font-black disabled:opacity-40">
                <Syringe size={16} /> Log together
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CoDrawModal
        open={coDraw}
        onClose={() => { setCoDraw(false); setSelected(new Set()) }}
        peptides={selectedPeptides}
      />
    </div>
  )
}

/**
 * Every standing nudge in one place: a bell that carries a count and opens on
 * tap. They used to be full-width cards stacked above the doses, which meant
 * the first thing on the screen was housekeeping rather than the one question
 * Home exists to answer.
 */
/**
 * Asks why, without insisting. A skip with no reason is still a skip — the
 * point is to record the decision, and demanding an explanation for it is how
 * a quick tap turns into something you avoid doing.
 */
function SkipSheet({ target, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  useEffect(() => { if (target) setReason('') }, [target])
  if (!target) return null
  const many = target.ids.length > 1

  return (
    <Modal open onClose={onClose} title={many ? `Skip ${target.ids.length} doses?` : `Skip ${target.name}?`}>
      <div className="space-y-3" data-testid="skip-sheet">
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Recorded as skipped, not missed. Nothing comes out of your stock, and it
          won't count against you.
        </p>
        <div className="flex flex-wrap gap-2">
          {SKIP_REASONS.map((r) => (
            <button key={r.id} onClick={() => setReason(reason === r.id ? '' : r.id)}
              className="rounded-full px-3 py-2 text-xs font-bold"
              style={reason === r.id
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Optional — tap Skip without one.</p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            Cancel
          </button>
          <button onClick={() => onConfirm(reason)} data-testid="skip-confirm"
            className="flex-1 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            Skip {many ? `all ${target.ids.length}` : ''}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * One oral supplement on the Home list. Deliberately the simplest row in the
 * app: name, dose, and a single tap that toggles. Tapping again undoes it,
 * because the common mistake is a mis-tap, not a genuine second dose.
 */
function TakeRow({ supplement: s, taken, skipped, onToggle, onSkip, onUnskip, index = 0 }) {
  const settled = taken || skipped
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.25) }}
      data-testid="take-row"
      className="card flex w-full items-center gap-3 p-3"
      style={taken ? { background: 'color-mix(in srgb, var(--good) 10%, var(--surface))' }
        : skipped ? { background: 'color-mix(in srgb, var(--text) 8%, var(--surface))' } : undefined}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px]"
        style={taken
          ? { background: 'color-mix(in srgb, var(--good) 20%, transparent)', color: 'var(--good)' }
          : skipped
            ? { background: 'var(--surface-sunk)', color: 'var(--text)' }
            : { background: 'color-mix(in srgb, var(--warn) 16%, transparent)', color: 'var(--warn)' }}>
        {skipped ? <SkipForward size={16} /> : <FormIcon form={s.form} size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold leading-tight"
          style={settled ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}>
          {s.name}
        </p>
        <p className="truncate text-xs font-semibold leading-tight"
          style={{ color: skipped ? 'var(--text)' : 'var(--text-2)' }}>
          {skipped ? 'Skipped today' : (s.dose || FORM_LABEL[s.form] || s.form)}
        </p>
      </div>

      {skipped ? (
        <motion.button whileTap={{ scale: 0.94 }} onClick={onUnskip}
          aria-label={`Undo skip: ${s.name}`}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-black"
          style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
          <Undo2 size={12} /> Undo
        </motion.button>
      ) : (
        <>
          {!taken && (
            <motion.button whileTap={{ scale: 0.94 }} onClick={onSkip}
              aria-label={`Skip ${s.name}`} data-testid="skip-supplement"
              className="flex h-8 shrink-0 items-center justify-center rounded-full px-3"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              <SkipForward size={13} />
            </motion.button>
          )}
          <motion.button whileTap={{ scale: 0.94 }} onClick={onToggle}
            aria-label={`${taken ? 'Undo' : 'Taken'}: ${s.name}`} aria-pressed={taken}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-black"
            style={taken
              ? { background: 'color-mix(in srgb, var(--good) 20%, transparent)', color: 'var(--good)' }
              : { background: 'var(--accent)', color: 'var(--accent-fg)' }}>
            {taken ? <><Check size={12} /> Taken</> : 'Taken'}
          </motion.button>
        </>
      )}
    </motion.div>
  )
}

function AlertBell({ alerts, nudge, goTo, onDismissNudge, stepUps = [], overdue = [], onLogOverdue, milestones = [] }) {
  const [open, setOpen] = useState(false)
  const confirmStepUp = useStore((s) => s.confirmStepUp)
  const holdStepUp = useStore((s) => s.holdStepUp)
  const count = alerts.length + stepUps.length + milestones.length + (overdue.length ? 1 : 0) + (nudge ? 1 : 0)
  const urgent = alerts.some((a) => a.kind === 'expired' || a.kind === 'stock')

  useEffect(() => { if (count === 0) setOpen(false) }, [count])
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (count === 0) return null

  return (
    // The dismiss backdrop is a child of this wrapper, so lifting the wrapper
    // lifts both. The button needs its own z-index *inside* that context to
    // stay tappable — otherwise the second tap (to close) hits the overlay.
    <div className={`relative ${open ? 'z-[46]' : ''}`}>
      <motion.button whileTap={{ scale: 0.9 }} onClick={() => setOpen((v) => !v)}
        aria-label={`${count} thing${count === 1 ? '' : 's'} to look at`}
        data-testid="alert-bell"
        className="relative z-[47] flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: 'var(--surface-sunk)', color: urgent ? 'var(--warn)' : 'var(--text-2)' }}>
        <Bell size={18} />
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs font-black"
          style={{ background: urgent ? 'var(--warn)' : 'var(--info)', color: 'var(--accent-fg)' }}>
          {count}
        </span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-[44]" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 340, damping: 26 }}
              data-testid="alert-panel"
              // Anchored to the viewport, not the bell: the bell sits mid-header,
              // so a panel hung off its right edge ran off the left of a 390px
              // screen and cut the warning in half.
              className="fixed inset-x-3 top-16 z-[45] rounded-[14px] p-4"
              style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-nav)' }}>
              <div className="space-y-3">
                {/* Anything still owed today, logged from here rather than by
                    going and finding it. */}
                {overdue.length > 0 && (
                  <div className="flex items-start gap-2" data-testid="bell-overdue">
                    <Clock size={13} className="mt-1 shrink-0" style={{ color: 'var(--warn)' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">
                        {overdue.length} still due today — {overdue.map((x) => x.name).join(', ')}
                      </p>
                      <button onClick={() => { onLogOverdue?.(); setOpen(false) }} data-testid="bell-log-overdue"
                        className="mt-2 rounded-full px-3 py-1 text-xs font-black"
                        style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                        Log {overdue.length}
                      </button>
                    </div>
                  </div>
                )}

                {/* The titration question, asked here instead of interrupting
                    the list of things to do. It is a decision, not a dose. */}
                {stepUps.map((st) => (
                  <div key={st.id} className="flex items-start gap-2" data-testid="bell-stepup">
                    <Zap size={13} className="mt-1 shrink-0" style={{ color: 'var(--text-2)' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">
                        {st.name} — {st.weeks} week{st.weeks === 1 ? '' : 's'} at {st.doseText}. Tolerating well?
                      </p>
                      <p className="mt-0.5 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                        Advancing moves to the next rung; holding keeps this dose and asks again next interval.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => confirmStepUp(st.id)} data-testid="stepup-advance"
                          className="rounded-full px-3 py-1 text-xs font-black"
                          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                          Advance
                        </button>
                        <button onClick={() => holdStepUp(st.id)} data-testid="stepup-hold"
                          className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'var(--surface-sunk)' }}>
                          Hold here
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* A marker passed, stated once and never dressed up as an
                    achievement. It is a fact about elapsed time. */}
                {milestones.map((m) => (
                  <button key={m.id} onClick={() => { setOpen(false); goTo('protocol') }}
                    data-testid="bell-milestone"
                    className="flex w-full items-start gap-2 text-left">
                    <Clock size={13} className="mt-1 shrink-0" style={{ color: 'var(--text-2)' }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold">{m.text}</span>
                      <span className="block text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                        Its timeline and everything taken so far are on its compound page.
                      </span>
                    </span>
                  </button>
                ))}

                {alerts.map((a) => (
                  <button key={a.id} onClick={() => { setOpen(false); goTo('supplies') }}
                    className="flex w-full items-start gap-2 text-left text-xs font-semibold">
                    <AlertTriangle size={13} className="mt-1 shrink-0"
                      style={{ color: a.kind === 'expired' ? 'var(--danger)' : a.kind === 'ordered' ? 'var(--info)' : 'var(--warn)' }} />
                    <span style={{ color: a.kind === 'expired' ? 'var(--danger)' : 'var(--text)' }}>{a.text}</span>
                  </button>
                ))}
                {nudge && (
                  <div className="flex items-start gap-2">
                    <ShieldCheck size={13} className="mt-1 shrink-0" style={{ color: 'var(--text-2)' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">{nudge.text}</p>
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => { setOpen(false); goTo('settings') }}
                          className="rounded-full px-3 py-1 text-xs font-black"
                          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                          Back up now
                        </button>
                        <button onClick={() => { onDismissNudge(); setOpen(false) }}
                          className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'var(--surface-sunk)' }}>
                          Later
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * The framing, shown once. It used to sit permanently at the top of Home, which
 * meant the first thing on the screen every single morning was a caveat the
 * user had already read. Dismissal is persisted in settings, so it never comes
 * back; the ⓘ in the header reopens it on demand.
 */
function Disclaimer({ open, firstRun, onClose }) {
  return (
    <Modal open={open} onClose={firstRun ? undefined : onClose} title="Pepito +">
      <div className="space-y-3">
        <p className="text-sm font-bold leading-relaxed">
          Personal tracking tool — not medical advice.
        </p>
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Every dose, ladder, cycle and reconstitution in here is an editable starting point drawn from
          anecdotal reports, not a prescription. Verify everything for yourself, and talk to someone
          qualified before you change what you're doing.
        </p>
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Your logs, photos and measurements stay on this device — they're never uploaded anywhere.
        </p>
        <button onClick={onClose} className="btn-primary w-full rounded-full py-3 text-sm font-black">
          Got it
        </button>
      </div>
    </Modal>
  )
}

// Fewest-syringes plan for the selected slot. Accepting a group hands straight
// off to the existing co-draw flow, which re-runs the mix check, gates CAUTION
// on visual inspection, and takes one site for the whole group.
/**
 * The combine-your-shots offer, as one row.
 *
 * Shots, units, millilitres and the action — nothing else. The compound names
 * are directly above in the cards this row is about, and repeating them here
 * was most of this block's height for none of its meaning. A *separate*-only
 * plan still gets its say, because "never share a syringe with this" is a
 * safety statement rather than a shortcut.
 */
function ShotPlan({ plan, slot, onAccept }) {
  const [why, setWhy] = useState(false)
  const combinable = plan.groups.filter((g) => g.items.length > 1)
  const separates = plan.groups.filter((g) => g.separate)
  if (combinable.length === 0 && separates.length === 0) return null

  const shots = combinable.length
  const units = combinable.reduce((n, g) => n + g.units, 0)
  const ml = combinable.reduce((n, g) => n + g.ml, 0)

  return (
    <motion.div layout className="space-y-2" data-testid="shot-plan"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      {/* The names are deliberately not rendered — the cards above already
          carry them. They stay on the row as data, so what went into each
          syringe is still checkable against the matrix. */}
      {combinable.length > 0 && (
        <div className="card flex items-center gap-3 p-3" data-testid="codraw-row"
          data-groups={JSON.stringify(combinable.map((g) => g.items.map((x) => x.name)))}>
          <Layers size={15} className="shrink-0" style={{ color: 'var(--good)' }} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black leading-tight">
              {shots === 1 ? '1 shot instead of ' : `${shots} shots instead of `}
              {combinable.reduce((n, g) => n + g.items.length, 0)} this {slot}
            </p>
            <p className="text-xs font-bold leading-tight" style={{ color: 'var(--good)' }}>
              {formatUnitsLong(units)}
              <span className="font-semibold" style={{ color: 'var(--text-2)' }}> · {round(ml, 2)} mL total</span>
            </p>
          </div>
          <button onClick={() => setWhy((v) => !v)} aria-label="Why these are combined"
            className="shrink-0 rounded-full p-2"
            style={{ background: 'var(--surface-sunk)', color: why ? 'var(--good)' : 'var(--text-2)' }}>
            <Info size={13} />
          </button>
          {/* One syringe at a time. Two combinable groups are two separate
              injections into two separate sites, so the tap opens the first
              and the row recomputes to offer the next once it is logged —
              never a single tap that quietly logs one and drops the other. */}
          <motion.button whileTap={{ scale: 0.94 }} data-testid="log-together"
            onClick={() => onAccept(combinable[0])}
            className="btn-primary shrink-0 rounded-full px-3 py-2 text-xs font-black">
            Log together{shots > 1 ? ` · 1 of ${shots}` : ''}
          </motion.button>
        </div>
      )}

      {/* Behind a tap, not printed: the reasoning is real and has to be
          reachable, but it is not what the row is for. */}
      <AnimatePresence initial={false}>
        {why && combinable.length > 0 && (
          <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} data-testid="codraw-note"
            className="overflow-hidden px-1 text-xs font-medium leading-relaxed"
            style={{ color: 'var(--text-2)' }}>
            Only pairs the matrix rates <span className="font-bold">safe to mix</span> are combined, capped at
            {' '}{MAX_GROUP_ML} mL a syringe — still inspect every draw.
          </motion.p>
        )}
      </AnimatePresence>

      {separates.map((g, i) => (
        <p key={i} className="flex items-start gap-2 px-1 text-xs font-medium leading-relaxed"
          data-testid="separate-note" style={{ color: 'var(--text-2)' }}>
          <ShieldCheck size={12} className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }} />
          <span>
            <span className="font-black" style={{ color: 'var(--text)' }}>{g.items.map((x) => x.name).join(', ')}</span>
            {' — '}{g.separateReason || 'always injected on its own.'}
          </span>
        </p>
      ))}
    </motion.div>
  )
}

/**
 * Cycled compounds resting through their off-weeks.
 *
 * Deliberately inert: no Log button, no circle to select, no tap target beyond
 * opening the compound's own sheet. A rest is only a rest if the app does not
 * quietly invite you to break it.
 */
function RestingGroup({ resting, onOpenSheet }) {
  if (!resting.length) return null
  return (
    <div className="space-y-2" data-testid="resting-group">
      <p className="flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wide"
        style={{ color: 'var(--text-3)' }}>
        <Moon size={12} /> Resting · {resting.length}
      </p>
      <div className="card rows overflow-hidden">
        {resting.map(({ p, phase }) => (
          <button key={p.id} onClick={() => onOpenSheet(p.id)} data-testid="resting-row"
            className="flex w-full items-center gap-3 p-3 text-left" style={{ opacity: 0.62 }}>
            <Moon size={14} className="shrink-0" style={{ color: 'var(--text-3)' }} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-sm font-bold leading-tight">{p.name}</span>
                <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: 'var(--text-3)' }}>
                  day {phase.dayOfPhase}/{phase.phaseLength}
                </span>
              </span>
              {/* wraps rather than truncating: "back in 12 days" is the whole
                  point of the row, and "back in 12 da…" answers nothing */}
              <span className="block text-xs font-semibold leading-tight" style={{ color: 'var(--text-3)' }}>
                part of your stack · resting, back in {phase.daysLeft} day{phase.daysLeft === 1 ? '' : 's'}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Tomorrow, with the doses.
 *
 * A week of numbers told you how many shots and nothing about what they were.
 * One day, named and dosed, is what you can actually act on tonight — whether
 * to reconstitute something, or whether tomorrow is a rest.
 */
function Tomorrow() {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const supplements = useStore((s) => s.supplements)
  const tomorrow = addDaysStr(todayStr(), 1)

  const rows = useMemo(() => peptides
    .filter((p) => isDueToday(p, tomorrow))
    .map((p) => {
      const { dose } = currentRung(p, titration[p.id])
      return {
        id: p.id,
        name: p.name,
        slot: slotOf(p),
        nasal: isNasal(p),
        dose: formatDose(dose, p.ladder.unit),
        units: isNasal(p) ? null : formatUnitsLong(unitsFor(p, dose)),
      }
    }), [peptides, titration, tomorrow])

  const orals = useMemo(() => supplements.length, [supplements])

  return (
    <div className="card p-3" data-testid="tomorrow">
      <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide"
        style={{ color: 'var(--text-3)' }}>
        <ChevronRight size={12} /> Tomorrow · {prettyDate(tomorrow)}
      </p>
      {rows.length === 0 ? (
        <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          Nothing to inject{orals > 0 ? ` — ${orals} oral${orals === 1 ? '' : 's'} as usual` : ' — a clear day'}
        </p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <p key={r.id} className="flex items-baseline gap-2 text-xs font-bold leading-snug"
              data-testid="tomorrow-row">
              {r.nasal
                ? <Wind size={11} className="shrink-0 translate-y-0.5" style={{ color: 'var(--text-3)' }} />
                : <Syringe size={11} className="shrink-0 translate-y-0.5" style={{ color: 'var(--text-3)' }} />}
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="shrink-0 tabular-nums" style={{ color: 'var(--text)' }}>{r.dose}</span>
              {r.units && (
                <span className="shrink-0 tabular-nums font-semibold" style={{ color: 'var(--text-2)' }}>{r.units}</span>
              )}
              <span className="shrink-0 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{r.slot}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One dose, one tap.
 *
 * The whole row is the log button. There used to be a circle on the left for
 * co-draw selection and a Log button on the right, which read as two controls
 * for one act; the circle is gone and the row itself is the target.
 *
 * Everything that is not the name, the dose or when to take it has left the
 * card. Rung position, doses-left and the step-up question are all real, and
 * all belong somewhere you go to read rather than somewhere you go to tap —
 * they are on the compound page and in the bell now.
 */
function DueCard({ peptide: p, index, done, titration, onLog, selected, onToggleSelect, skipped, skipReason, onSkip, onUnskip, onFinishVial, onOpenSheet, beckon }) {
  const tState = titration[p.id]
  const { dose } = currentRung(p, tState)
  const nasal = isNasal(p)
  const units = nasal ? null : unitsFor(p, dose)
  const [menu, setMenu] = useState(false)
  const [dragging, setDragging] = useState(false)
  const name = displayName(p)

  if (skipped) {
    return (
      <motion.div layout className="flex items-center gap-3 p-4" style={{ opacity: 0.6 }}
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 0.6, y: 0 }}>
        <div className="min-w-0 flex-1">
          <p className="t-label font-semibold leading-tight">{name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            <SkipForward size={12} /> Skipped today{skipReason ? ` · ${REASON_LABEL[skipReason] || skipReason}` : ''}
            <span>· nothing taken from stock</span>
          </p>
        </div>
        <motion.button whileTap={{ scale: 0.92 }} onClick={onUnskip}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-black"
          style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}
          aria-label={`Undo skip: ${p.name}`}>
          <Undo2 size={14} /> Undo
        </motion.button>
      </motion.div>
    )
  }

  return (
    <motion.div layout className="relative overflow-hidden"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: index * 0.03 }}
      style={selected ? { background: 'var(--surface-sunk)' } : undefined}>

      {/* Revealed by dragging the row aside — the same action the … menu holds,
          for anyone who reaches for a swipe first. Rendered only while the drag
          is happening: the row's own background is translucent by design, so a
          layer parked underneath it shows through at rest. */}
      {dragging && (
        <div className="absolute inset-y-0 right-0 flex items-center pr-5" aria-hidden>
          <span className="flex items-center gap-1 text-xs font-black" style={{ color: 'var(--warn)' }}>
            <SkipForward size={13} /> Skip
          </span>
        </div>
      )}

      <motion.div
        drag={done ? false : 'x'}
        dragConstraints={{ left: -100, right: 0 }}
        dragElastic={0.06}
        dragSnapToOrigin
        onDragStart={() => setDragging(true)}
        onDragEnd={(e, info) => { setDragging(false); if (info.offset.x < -70) onSkip() }}
        className="relative flex items-center">

        {/* the row is the button */}
        <motion.button whileTap={done ? undefined : { scale: 0.99 }} onClick={done ? undefined : onLog}
          disabled={done} data-testid="log-row"
          className={`flex min-w-0 flex-1 items-center gap-3 p-4 text-left ${beckon ? 'beckon' : ''}`}
          aria-label={done ? `${p.name} logged` : `Log ${p.name}`}>
          <span className="min-w-0 flex-1">
            {/* wraps rather than truncates — a short name is short enough to fit */}
            <span className="t-label block font-semibold leading-tight">{name}</span>
            <span className="mt-1 flex items-baseline gap-2">
              <span className="t-metric-sm tabular-nums">{formatDose(dose, p.ladder.unit)}</span>
              {!nasal && <span className="t-metric-sm tabular-nums" style={{ color: 'var(--text)' }}>{formatUnitsLong(units)}</span>}
            </span>
            <span className="mt-1 flex items-center gap-1 text-xs font-medium leading-tight" style={{ color: 'var(--text-3)' }}>
              <Clock size={12} /> {p.timing}
            </span>
          </span>
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-xs font-black ${done ? '' : 'btn-primary'}`}
            style={done ? { background: 'var(--surface-sunk)', color: 'var(--good)' } : undefined}>
            {done ? (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
                <Check size={24} strokeWidth={3} />
              </motion.span>
            ) : 'Log'}
          </span>
        </motion.button>

        {/* everything occasional, out of the way of the thing done daily */}
        <button onClick={() => setMenu((v) => !v)} data-testid="row-overflow"
          aria-label={`More for ${p.name}`} aria-expanded={menu}
          className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: menu ? 'var(--surface-sunk)' : 'transparent', color: 'var(--text-3)' }}>
          <MoreHorizontal size={18} />
        </button>
      </motion.div>

      <AnimatePresence initial={false}>
        {menu && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden" data-testid="row-menu">
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              <MenuAction icon={SkipForward} label="Skip" testid="skip-peptide"
                onClick={() => { setMenu(false); onSkip() }} />
              {!nasal && onFinishVial && (
                <MenuAction icon={PackageOpen} label="Vial done" testid="finish-vial"
                  onClick={() => { setMenu(false); onFinishVial() }} />
              )}
              {!nasal && !p.alwaysSeparate && !done && (
                <MenuAction icon={Layers} label={selected ? 'In co-draw' : 'Log together'} testid="row-codraw"
                  active={selected} onClick={() => { setMenu(false); onToggleSelect() }} />
              )}
              <MenuAction icon={Info} label="About" testid="open-compound-sheet"
                onClick={() => { setMenu(false); onOpenSheet?.(p.id) }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function MenuAction({ icon: Icon, label, onClick, testid, active }) {
  return (
    <button onClick={onClick} data-testid={testid}
      className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-black"
      style={{
        background: active ? 'color-mix(in srgb, var(--good) 16%, transparent)' : 'var(--surface-sunk)',
        color: active ? 'var(--good)' : 'var(--text-2)',
      }}>
      <Icon size={13} /> {label}
    </button>
  )
}

/**
 * "2 still due from this morning."
 *
 * One line that clears itself without going anywhere, for the doses the app
 * scrolled past when it flipped itself to the evening.
 */
function EarlierSlot({ from, count, onLogAll, onSwitch }) {
  if (!from || count <= 0) return null
  return (
    <div className="card flex items-center gap-3 p-3" data-testid="earlier-slot">
      <Clock size={15} className="shrink-0" style={{ color: 'var(--warn)' }} />
      <button onClick={onSwitch} className="min-w-0 flex-1 text-left text-xs font-bold">
        {count} still due from this {from === 'AM' ? 'morning' : 'evening'}
      </button>
      <motion.button whileTap={{ scale: 0.96 }} onClick={onLogAll} data-testid="log-earlier"
        className="btn-primary shrink-0 rounded-full px-3 py-2 text-xs font-black">
        Log {count}
      </motion.button>
    </div>
  )
}
