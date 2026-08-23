import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Info, Clock, AlertTriangle, Combine, Sun, Moon, ChevronRight, MapPin, Syringe, X, Circle, CheckCircle2, ShieldCheck, Layers, Wind, Bell, Zap, Pill, SkipForward, Undo2, PackageOpen, Droplet } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import { cycleInfo, currentRung, stepUpDue } from '../lib/schedule'
import { isDueToday, slotOf, isDueSlot, currentSlot, slotIsFlexible, needsProtocolSetup } from '../lib/daily'
import { formatDose, formatUnitsLong, unitsFor, round, isNasal } from '../lib/calc'
import { loadMatrix, LIB_TO_COMPOUND } from '../lib/mixMatrix'
import { planShots, shotsHeadline, MAX_GROUP_ML } from '../lib/grouping'
import { expiryInfo, runOutInfo } from '../lib/inventory'
import { daysSince, SITE_BY_ID } from '../lib/sites'
import { backupNudge, countEntries } from '../lib/backup'
import { deliveryCovers } from '../lib/restock'
import Modal from './ui/Modal'
import Ring from './ui/Ring'
import CountUp from './ui/CountUp'
import CoachTip from './ui/CoachTip'
import Term from './ui/Term'
import SitePicker from './SitePicker'
import CoDrawModal from './CoDrawModal'
import { NextSevenDays } from './CalendarTab'
import { dueInSlot, takenOn, FORM_LABEL } from '../lib/supplements'
import { skippedOn, supplementsSkippedOn, skipFor, SKIP_REASONS, REASON_LABEL } from '../lib/skips'
import { activeVialStatus, coverageFor, coverageWords } from '../lib/stock'
import ReplaceVial from './ReplaceVial'
import CompoundSheet from './CompoundSheet'
import { FormIcon } from './SupplementsTab'

const spring = { type: 'spring', stiffness: 260, damping: 22 }

export default function Home({ goTo, onQuickAction }) {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const openVials = useStore((s) => s.openVials)
  const vials = useStore((s) => s.vials)
  const settings = useStore((s) => s.settings)
  const restock = useStore((s) => s.restock)
  const updateSettings = useStore((s) => s.updateSettings)

  const t = todayStr()
  const [slot, setSlot] = useState(() => currentSlot())
  const [picker, setPicker] = useState(null) // peptide being logged (single)
  const [selected, setSelected] = useState(() => new Set()) // co-draw selection
  const [coDraw, setCoDraw] = useState(false)
  const [showAbout, setShowAbout] = useState(false)

  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const scheduledToday = useMemo(() => peptides.filter((p) => isDueToday(p, t)), [peptides, t])
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
  const suppDayTotal = supplements.length
  const suppDayDone = supplements.filter((x) => takenIds.has(x.id)).length

  const loggedToday = useMemo(
    () => new Set(doseLogs.filter((l) => l.date === t).map((l) => l.peptideId)),
    [doseLogs, t]
  )
  const slotDone = slotDue.filter((p) => loggedToday.has(p.id)).length
  const dayDone = scheduledToday.filter((p) => loggedToday.has(p.id)).length
  const unlogged = useMemo(
    () => slotDue.filter((p) => !loggedToday.has(p.id) && !skippedIds.has(p.id)),
    [slotDue, loggedToday, skippedIds]
  )
  const unloggedCount = unlogged.length

  // The shell's floating "+" calls whatever we register here — same
  // setPicker flow as tapping Log on a card, just a second entry point.
  useEffect(() => {
    onQuickAction?.(() => { const next = unlogged[0]; if (next) setPicker(next) })
  }, [onQuickAction, unlogged])
  // selection resolved against the live slot list so done/removed/skipped ids drop out
  const selectedPeptides = slotDue.filter(
    (p) => selected.has(p.id) && !loggedToday.has(p.id) && !skippedIds.has(p.id)
  )
  // A skipped item is settled, not outstanding: it leaves the denominator
  // entirely rather than sitting in it as a permanent shortfall. Deciding not
  // to do something is a decision, and the ring should not scold you for it.
  const slotSkipped = slotDue.filter((p) => skippedIds.has(p.id)).length
    + slotSupps.filter((x) => skippedSupps.has(x.id)).length
  const daySkipped = scheduledToday.filter((p) => skippedIds.has(p.id)).length
    + supplements.filter((x) => skippedSupps.has(x.id)).length
  const slotTotal = Math.max(0, slotDue.length + slotSupps.length - slotSkipped)
  const slotDoneAll = slotDone + suppDone
  const ringPct = slotTotal ? slotDoneAll / slotTotal : (scheduledToday.length === 0 ? 0 : 1)
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

  // Who each peptide can actually share a syringe with, in the context of what
  // else is due in this slot. Compatibility is pairwise, so this is computed —
  // never a fixed per-peptide tag — and the plan below reads the same verdicts.
  const partnersById = useMemo(() => {
    const out = {}
    if (!verdictOf) return out
    for (const p of injectable) {
      out[p.id] = p.alwaysSeparate ? [] : injectable.filter((o) => (
        o.id !== p.id && !o.alwaysSeparate && verdictOf(p.id, o.id) === 'MIX'
      ))
    }
    return out
  }, [verdictOf, injectable])

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
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: 'var(--muted)' }}>
            Pepito +
            <button onClick={() => setShowAbout(true)} aria-label="About this app" style={{ color: 'var(--muted)' }}>
              <Info size={11} />
            </button>
          </p>
          <h1 className="text-[21px] font-black leading-tight tracking-tight">
            Today, {now.getDate()} {now.toLocaleDateString(undefined, { month: 'long' })}
          </h1>
          <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            {now.toLocaleDateString(undefined, { weekday: 'long' })} · {slot}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AlertBell alerts={alerts} nudge={nudge} goTo={goTo} onDismissNudge={dismissBackupNudge} />
          <div className="flex rounded-full p-1" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' }}>
          {['AM', 'PM'].map((s) => (
            <button key={s} onClick={() => setSlot(s)}
              className="relative flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-black">
              {slot === s && <motion.span layoutId="slot-pill" className="absolute inset-0 rounded-full"
                style={{ backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))' }} />}
              <span className="relative flex items-center gap-1" style={{ color: slot === s ? '#fff' : 'var(--muted)' }}>
                {s === 'AM' ? <Sun size={14} /> : <Moon size={14} />}{s}
              </span>
            </button>
          ))}
          </div>
        </div>
      </div>

      {/* Hero: how much is left, and nothing else. */}
      <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}
        className="flex items-center gap-4" data-testid="hero">
        <Ring pct={ringPct} size={76} stroke={7} from="var(--violet)" to="var(--indigo)">
          <div className="text-center leading-tight">
            <p className="num text-base font-black"><CountUp value={slotDoneAll} />/{slotTotal}</p>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>this {slot}</p>
          </div>
        </Ring>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-black leading-tight tracking-tight">
            {slotTotal === 0 ? (slot === 'AM' ? 'Clear morning' : 'Clear evening')
              : ringPct === 1 ? `${slot} done`
                : unloggedCount > 0
                  ? `${unloggedCount} to inject`
                  : `${slotSupps.filter((x) => !takenIds.has(x.id) && !skippedSupps.has(x.id)).length} to take`}
          </p>
          <p className="num text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            {dayDone + suppDayDone}/{Math.max(0, scheduledToday.length + suppDayTotal - daySkipped)} today
            {daySkipped > 0 && <> · {daySkipped} skipped</>} · {otherCount} this {otherSlot}
          </p>
        </div>
      </motion.div>

      {/* combine-your-shots plan — only when there is actually something to
          combine. "Nothing is combinable" is not news worth a block of screen;
          each card already says whether it can share a syringe. */}
      {plan && plan.saved > 0 && selected.size === 0 && (
        <ShotPlan plan={plan} slot={slot} onAccept={acceptGroup} />
      )}

      {/* first-run pointer at the Log button */}
      <CoachTip id="log-button" when={slotDue.length > 0}>
        Tap the green <span className="font-black">Log</span> button on a card when you've taken a dose —
        we'll show you a labelled body map and tell you exactly where to inject.
      </CoachTip>

      {/* co-draw hint */}
      {unloggedInjectable.length >= 2 && selected.size === 0 && !plan && (
        <p className="px-1 text-center text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
          Injecting more than one? Tap the circles to <span className="font-bold" style={{ color: 'var(--lime)' }}>log them together</span> as one <Term id="codraw" />.
        </p>
      )}

      {/* due list for slot */}
      <div className="space-y-3">
        {slotTotal === 0 && (
          <div className="py-8 text-center" style={{ color: 'var(--muted)' }}>
            <p className="text-sm font-bold">
              {slot === 'AM' ? "Nothing this morning — you're clear ☀️" : "Nothing tonight — you're clear 🌙"}
            </p>
            {otherCount > 0 && (
              <button onClick={() => setSlot(otherSlot)} className="mt-2 inline-flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--indigo)' }}>
                {otherCount} due this {otherSlot} <ChevronRight size={13} />
              </button>
            )}
          </div>
        )}
        {/* The heading only earns its space once both kinds are on screen —
            with injections alone the old unlabelled list is cleaner. */}
        {slotDue.length > 0 && slotSupps.length > 0 && (
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ color: 'var(--lime)' }} data-testid="inject-heading">
            <Syringe size={12} /> Inject · {slotDue.length}
          </p>
        )}
        {slotDue.map((p, i) => (
          <DueCard key={p.id} peptide={p} index={i} done={loggedToday.has(p.id)}
            titration={titration} partners={partnersById[p.id]} slot={slot}
            onLog={() => setPicker(p)} goTo={goTo} today={t} doseLogs={doseLogs}
            selected={selected.has(p.id)} onToggleSelect={() => toggleSelect(p.id)}
            selectMode={selected.size > 0}
            skipped={skippedIds.has(p.id)}
            skipReason={skipFor(skips, p.id, t)?.reason}
            onSkip={() => setSkipping({ kind: 'peptide', ids: [p.id], name: p.name })}
            onUnskip={() => unskipToday(p.id)}
            vial={activeVialStatus(p, titration[p.id], openVials[p.id], doseLogs)}
            onFinishVial={() => { finishVial(p.id); setReplacing(p.id) }}
            onOpenSheet={setSheetId}
            beckon={firstRun && i === slotDue.findIndex((x) => !loggedToday.has(x.id))} />
        ))}
      </div>

      {/* Oral group — deliberately its own block. No site, no co-draw, no
          units: tapping it is the whole interaction. */}
      {slotSupps.length > 0 && (
        <div className="space-y-2" data-testid="take-group">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ color: 'var(--amber)' }}>
            <Pill size={12} /> Take · {suppDone}/{slotSupps.length}
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

      {/* what's coming — taps through to the full calendar */}
      <NextSevenDays goTo={goTo} />

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
            style={{ bottom: 'calc(var(--nav-h, 76px) + 10px)' }}
            data-testid="codraw-bar"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl p-2.5 shadow-lg"
              style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', boxShadow: '0 8px 30px rgba(0,0,0,0.45)' }}>
              <button onClick={() => setSelected(new Set())} className="shrink-0 rounded-full p-2" style={{ background: 'var(--surface2)' }} aria-label="Clear selection">
                <X size={16} />
              </button>
              <div className="min-w-0 flex-1 text-[11px] font-bold leading-tight">
                {selected.size} selected{selected.size < 2 ? ' · pick 1 more' : ' · one shot, one site'}
              </div>
              <motion.button whileTap={{ scale: 0.95 }} data-testid="skip-selected"
                onClick={() => setSkipping({
                  kind: 'peptide',
                  ids: selectedPeptides.map((x) => x.id),
                  name: selectedPeptides.map((x) => x.name).join(', '),
                })}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-2.5 text-xs font-black"
                style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
                aria-label="Skip the selected doses">
                <SkipForward size={14} /> Skip
              </motion.button>
              <motion.button whileTap={{ scale: 0.95 }} disabled={selected.size < 2}
                onClick={() => setCoDraw(true)}
                className="btn-primary flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2.5 text-sm font-black disabled:opacity-40">
                <Syringe size={16} /> Log together
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <SitePicker
        open={!!picker} onClose={() => setPicker(null)}
        peptide={picker}
        dose={picker ? currentRung(picker, titration[picker.id]).dose : 0}
        unit={picker?.ladder.unit}
        units={picker ? unitsFor(picker, currentRung(picker, titration[picker.id]).dose) : 0}
      />

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
        <p className="text-[12px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          Recorded as skipped, not missed. Nothing comes out of your stock, and it
          won't count against you.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SKIP_REASONS.map((r) => (
            <button key={r.id} onClick={() => setReason(reason === r.id ? '' : r.id)}
              className="rounded-full px-3 py-1.5 text-[11px] font-bold"
              style={reason === r.id
                ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}>Optional — tap Skip without one.</p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full py-2.5 text-xs font-black"
            style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
            Cancel
          </button>
          <button onClick={() => onConfirm(reason)} data-testid="skip-confirm"
            className="flex-1 rounded-full py-2.5 text-xs font-black"
            style={{ backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }}>
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
      className="card flex w-full items-center gap-3 p-4"
      style={taken ? { background: 'color-mix(in srgb, var(--lime) 10%, var(--surface))' }
        : skipped ? { background: 'color-mix(in srgb, var(--violet) 8%, var(--surface))' } : undefined}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl"
        style={taken
          ? { background: 'color-mix(in srgb, var(--lime) 20%, transparent)', color: 'var(--lime)' }
          : skipped
            ? { background: 'color-mix(in srgb, var(--violet) 18%, transparent)', color: 'var(--violet)' }
            : { background: 'color-mix(in srgb, var(--amber) 16%, transparent)', color: 'var(--amber)' }}>
        {skipped ? <SkipForward size={16} /> : <FormIcon form={s.form} size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold"
          style={settled ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}>
          {s.name}
        </p>
        <p className="truncate text-[11px] font-semibold"
          style={{ color: skipped ? 'var(--violet)' : 'var(--muted)' }}>
          {skipped ? 'Skipped today' : (s.dose || FORM_LABEL[s.form] || s.form)}
        </p>
      </div>

      {skipped ? (
        <motion.button whileTap={{ scale: 0.94 }} onClick={onUnskip}
          aria-label={`Undo skip: ${s.name}`}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[11px] font-black"
          style={{ background: 'var(--surface2)', color: 'var(--violet)' }}>
          <Undo2 size={12} /> Undo
        </motion.button>
      ) : (
        <>
          {!taken && (
            <motion.button whileTap={{ scale: 0.94 }} onClick={onSkip}
              aria-label={`Skip ${s.name}`} data-testid="skip-supplement"
              className="flex h-8 shrink-0 items-center justify-center rounded-full px-2.5"
              style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
              <SkipForward size={13} />
            </motion.button>
          )}
          <motion.button whileTap={{ scale: 0.94 }} onClick={onToggle}
            aria-label={`${taken ? 'Undo' : 'Taken'}: ${s.name}`} aria-pressed={taken}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[11px] font-black"
            style={taken
              ? { background: 'color-mix(in srgb, var(--lime) 20%, transparent)', color: 'var(--lime)' }
              : { backgroundImage: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#fff' }}>
            {taken ? <><Check size={12} /> Taken</> : 'Taken'}
          </motion.button>
        </>
      )}
    </motion.div>
  )
}

function AlertBell({ alerts, nudge, goTo, onDismissNudge }) {
  const [open, setOpen] = useState(false)
  const count = alerts.length + (nudge ? 1 : 0)
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
        style={{ background: 'var(--surface2)', color: urgent ? 'var(--amber)' : 'var(--muted)' }}>
        <Bell size={18} />
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-black"
          style={{ background: urgent ? 'var(--amber)' : 'var(--indigo)', color: '#fff' }}>
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
              className="fixed inset-x-3 top-16 z-[45] rounded-2xl p-4"
              style={{ background: 'var(--surface-solid)', boxShadow: 'var(--shadow-nav)' }}>
              <div className="space-y-2.5">
                {alerts.map((a) => (
                  <button key={a.id} onClick={() => { setOpen(false); goTo('supplies') }}
                    className="flex w-full items-start gap-2 text-left text-[11px] font-semibold">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0"
                      style={{ color: a.kind === 'expired' ? 'var(--coral)' : a.kind === 'ordered' ? 'var(--indigo)' : 'var(--amber)' }} />
                    <span style={{ color: a.kind === 'expired' ? 'var(--coral)' : 'var(--text)' }}>{a.text}</span>
                  </button>
                ))}
                {nudge && (
                  <div className="flex items-start gap-2">
                    <ShieldCheck size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--indigo)' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold">{nudge.text}</p>
                      <div className="mt-1.5 flex gap-2">
                        <button onClick={() => { setOpen(false); goTo('settings') }}
                          className="rounded-full px-2.5 py-1 text-[10px] font-black"
                          style={{ background: 'var(--indigo)', color: '#fff' }}>
                          Back up now
                        </button>
                        <button onClick={() => { onDismissNudge(); setOpen(false) }}
                          className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'var(--surface2)' }}>
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
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          Every dose, ladder, cycle and reconstitution in here is an editable starting point drawn from
          anecdotal reports, not a prescription. Verify everything for yourself, and talk to someone
          qualified before you change what you're doing.
        </p>
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          Your logs, photos and measurements stay on this device — they're never uploaded anywhere.
        </p>
        <button onClick={onClose} className="btn-primary w-full rounded-full py-2.5 text-sm font-black">
          Got it
        </button>
      </div>
    </Modal>
  )
}

// Fewest-syringes plan for the selected slot. Accepting a group hands straight
// off to the existing co-draw flow, which re-runs the mix check, gates CAUTION
// on visual inspection, and takes one site for the whole group.
function ShotPlan({ plan, slot, onAccept }) {
  const headline = shotsHeadline(plan, slot)
  const combinable = plan.groups.filter((g) => g.items.length > 1)
  const [why, setWhy] = useState(false)

  return (
    <motion.div layout className="space-y-2" data-testid="shot-plan"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center gap-2">
        <Layers size={15} className="shrink-0" style={{ color: 'var(--lime)' }} />
        <p className="flex-1 text-sm font-black leading-tight">{headline}</p>
        {/* the reasoning is real, but it isn't the point of the screen */}
        <button onClick={() => setWhy((v) => !v)} aria-label="Why these are combined"
          className="shrink-0 rounded-full p-1.5"
          style={{ background: 'var(--surface2)', color: why ? 'var(--lime)' : 'var(--muted)' }}>
          <Info size={13} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {why && (
          <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            {combinable.length > 0
              ? <>Only pairs the matrix rates <span className="font-bold">safe to mix</span> are combined, capped at {MAX_GROUP_ML} mL a syringe. That still isn't proof of compatibility — inspect every draw.</>
              : <>Nothing here shares a syringe: a pair is combined only on a confirmed “safe to mix”, so caution, don't-mix and unrated pairs all get their own shot.</>}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Only the rows that say something. A plain "on its own" row repeated
          the card directly below it and was most of this block's height; a
          *separate* shot stays, because "never share a syringe with this" is a
          safety statement, not a restatement of the schedule. */}
      <div className="space-y-2">
        {plan.groups.filter((g) => g.items.length > 1 || g.separate).map((g, i) => (
          <ShotRow key={g.items.map((x) => x.id).join('+') || i} group={g} onAccept={onAccept} />
        ))}
      </div>
    </motion.div>
  )
}

function ShotRow({ group, onAccept }) {
  const many = group.items.length > 1

  return (
    <div className="rounded-2xl p-2.5" style={{ background: 'var(--surface2)' }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-wide"
            style={{ color: many ? 'var(--lime)' : 'var(--muted)' }}>
            {many ? `Combine into 1 shot · ${group.items.length}` : group.separate ? 'Separate shot' : 'On its own'}
          </p>
          {/* Every compound in the draw, listed — this is the one place that
              answers "what exactly am I about to put in one syringe", so it
              wraps rather than truncating. */}
          <ul className="mt-0.5" data-testid="codraw-names">
            {group.items.map((it) => (
              <li key={it.id} className="text-sm font-bold leading-snug">
                {many && <span style={{ color: 'var(--lime)' }}>· </span>}{it.name}
              </li>
            ))}
          </ul>
          <p className="mt-0.5 text-[11px] font-bold" style={{ color: 'var(--lime)' }}>
            {formatUnitsLong(group.units)}{many ? ' total' : ''}
            <span className="font-semibold" style={{ color: 'var(--muted)' }}> · {round(group.ml, 2)} mL</span>
          </p>
        </div>
        {many && (
          <motion.button whileTap={{ scale: 0.94 }} onClick={() => onAccept(group)}
            className="btn-primary shrink-0 rounded-full px-3 py-2 text-xs font-black">
            Log together
          </motion.button>
        )}
      </div>

      {/* Stated plainly, in the same muted voice as everything else. It is a
          fact about how this compound is given, not an alarm. */}
      {group.separate && (
        <p className="mt-1.5 text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
          {group.separateReason || 'Always injected on its own.'}
        </p>
      )}
    </div>
  )
}

function DueCard({ peptide: p, index, done, titration, partners, slot, onLog, goTo, today, doseLogs, beckon, selected, onToggleSelect, selectMode, skipped, skipReason, onSkip, onUnskip, vial, onFinishVial, onOpenSheet }) {
  const tState = titration[p.id]
  const { dose, level, maxLevel } = currentRung(p, tState)
  const nasal = isNasal(p)
  const units = nasal ? null : unitsFor(p, dose)
  const cyc = cycleInfo(p, today)
  const stepDue = stepUpDue(p, tState, today)
  const [stepOpen, setStepOpen] = useState(false)
  const confirmStepUp = useStore((s) => s.confirmStepUp)
  const holdStepUp = useStore((s) => s.holdStepUp)
  const noCoDraw = nasal || !!p.alwaysSeparate

  // The hint is pairwise and comes from the same matrix the combine plan reads,
  // in the context of what else is due in this slot — so the two can never
  // disagree. `partners` is undefined until the matrix resolves; that's the one
  // case where no claim is made either way.
  const when = slot === 'PM' ? 'tonight' : 'today'
  const hint = nasal
    ? { ok: false, text: 'Nasal spray — nothing to draw' }
    : p.alwaysSeparate
      ? { ok: false, text: p.vehicle === 'oil' ? 'Always its own shot — oil-based' : 'Always its own shot' }
      : partners == null
        ? null
        : partners.length
          ? { ok: true, text: `Can combine with ${partners.map((x) => x.name).join(', ')} ${when}` }
          : { ok: false, text: `Best on its own ${when}` }

  // last site used for this peptide
  const lastSiteLog = [...doseLogs].filter((l) => l.peptideId === p.id && l.siteId).sort((a, b) => (b.loggedAt || b.date).localeCompare(a.loggedAt || a.date))[0]

  return (
    <motion.div layout className={`card p-5 ${beckon ? 'beckon' : ''}`}
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: index * 0.04 }}
      style={selected
        ? { borderColor: 'var(--lime)', boxShadow: '0 0 0 1.5px var(--lime), var(--shadow)' }
        : done ? { borderColor: 'color-mix(in srgb, var(--lime) 40%, transparent)' }
          : skipped ? { borderColor: 'color-mix(in srgb, var(--violet) 40%, transparent)', opacity: 0.75 } : undefined}>
      <div className="flex items-center gap-3">
        {/* co-draw select toggle */}
        {!done && !skipped && (noCoDraw ? (
          <span className="shrink-0"
            title={nasal ? 'Sprayed, not injected — cannot be co-drawn' : 'Always injected on its own — cannot be co-drawn'}
            aria-label={`${p.name} cannot be co-drawn`}
            style={{ color: 'var(--muted)', opacity: 0.7 }}>
            {nasal ? <Wind size={24} /> : <Syringe size={24} />}
          </span>
        ) : (
          <motion.button whileTap={{ scale: 0.85 }} onClick={onToggleSelect}
            className="shrink-0" aria-label={selected ? `Deselect ${p.name}` : `Select ${p.name} to co-draw`}
            style={{ color: selected ? 'var(--lime)' : 'var(--muted)' }}>
            {selected ? <CheckCircle2 size={24} /> : <Circle size={24} />}
          </motion.button>
        ))}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button onClick={() => onOpenSheet?.(p.id)} data-testid="open-compound-sheet"
              aria-label={`About ${p.name}`} className="min-w-0 truncate text-left">
              <h3 className="truncate text-base font-bold">{p.name}</h3>
            </button>
            <span className="chip" style={{ color: 'var(--violet)' }}>Rung {level + 1}{level === maxLevel ? ' · top' : ''}</span>
          </div>
          <p className="mt-0.5 text-2xl font-black tracking-tight">
            {formatDose(dose, p.ladder.unit)}
            {!nasal && (
              <span className="ml-2 text-sm font-bold" style={{ color: 'var(--lime)' }}>{formatUnitsLong(units)}</span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
            <span className="flex items-center gap-1"><Clock size={11} /> {p.timing}</span>
            <span>{cyc.ongoing ? `day ${cyc.cycleDay} · ongoing` : `day ${cyc.cycleDay}/${cyc.onDays + cyc.offDays}`}</span>
            {hint && (
              <button className="flex items-center gap-1" style={{ color: hint.ok ? 'var(--lime)' : 'var(--muted)' }} onClick={() => goTo('mix')}>
                {nasal ? <Wind size={11} /> : <Combine size={11} />} {hint.text}
              </button>
            )}
            {done && lastSiteLog && (
              <span className="flex items-center gap-1" style={{ color: 'var(--lime)' }}>
                <MapPin size={11} /> {SITE_BY_ID[lastSiteLog.siteId]?.label}
              </span>
            )}
            {/* a heads-up, not an authority — your taps decide when a vial is
                done, and this is only what the logs add up to */}
            {vial?.dosesLeft != null && (
              <span className="flex items-center gap-1" data-testid="doses-left"
                style={{ color: vial.dosesLeft <= 2 ? 'var(--amber)' : 'var(--muted)' }}>
                <Droplet size={11} /> ~{vial.dosesLeft} dose{vial.dosesLeft === 1 ? '' : 's'} left in this vial
              </span>
            )}
          </div>
        </div>
        {skipped ? (
          <motion.button whileTap={{ scale: 0.92 }} onClick={onUnskip}
            className="flex h-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-3"
            style={{ background: 'var(--surface2)', color: 'var(--violet)' }}
            aria-label={`Undo skip: ${p.name}`}>
            <Undo2 size={18} />
            <span className="text-[9px] font-black">Undo</span>
          </motion.button>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            <motion.button whileTap={{ scale: 0.9 }} disabled={done} onClick={onLog}
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-sm font-black ${done ? '' : 'btn-primary'}`}
              style={done ? { background: 'var(--surface2)', color: 'var(--lime)' } : undefined}
              aria-label={done ? `${p.name} logged` : `Log ${p.name}`}>
              {done ? (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
                  <Check size={26} strokeWidth={3} />
                </motion.span>
              ) : 'Log'}
            </motion.button>
          </div>
        )}
      </div>

      {/* Secondary actions sit under the row rather than beside Log: three
          full-height buttons abreast pushed the name and the dose into
          truncation at 390px, and the dose is the thing you came to read. */}
      {!done && !skipped && (
        <div className="mt-2.5 flex gap-1.5">
          <motion.button whileTap={{ scale: 0.97 }} onClick={onSkip} data-testid="skip-peptide"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[11px] font-black"
            style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
            aria-label={`Skip ${p.name}`}>
            <SkipForward size={13} /> Skip
          </motion.button>
          {onFinishVial && !nasal && (
            <motion.button whileTap={{ scale: 0.97 }} onClick={onFinishVial} data-testid="finish-vial"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[11px] font-black"
              style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
              aria-label={`Finished vial: ${p.name}`}>
              <PackageOpen size={13} /> Vial done
            </motion.button>
          )}
        </div>
      )}

      {skipped && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold" style={{ color: 'var(--violet)' }}>
          <SkipForward size={12} /> Skipped today{skipReason ? ` · ${REASON_LABEL[skipReason] || skipReason}` : ''}
          <span className="font-medium" style={{ color: 'var(--muted)' }}>· nothing taken from stock</span>
        </p>
      )}
      {/* The step-up decision is answered where it is asked. It is a titration
          call, not a schedule edit, and sending someone to another screen to
          say "yes, that felt fine" is how a prompt gets ignored for weeks. */}
      {stepDue && !stepOpen && (
        <button onClick={() => setStepOpen(true)} data-testid="stepup-prompt"
          className="mt-3 flex w-full items-center justify-between gap-2 rounded-full px-3 py-2 text-xs font-bold"
          style={{ background: 'color-mix(in srgb, var(--violet) 16%, transparent)', color: 'var(--violet)' }}>
          <span className="flex items-center gap-2"><Zap size={13} /> Step-up ready — tolerating well?</span>
          <ChevronRight size={14} />
        </button>
      )}
      {stepDue && stepOpen && (
        <div className="mt-3 rounded-2xl p-3" data-testid="stepup-confirm"
          style={{ background: 'color-mix(in srgb, var(--violet) 14%, transparent)' }}>
          <p className="text-[11px] font-black" style={{ color: 'var(--violet)' }}>
            {p.ladder.intervalWeeks} week{p.ladder.intervalWeeks === 1 ? '' : 's'} at {formatDose(dose, p.ladder.unit)} —
            tolerating well?
          </p>
          <p className="mt-1 text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            Advancing moves you to the next rung. Holding keeps this dose and asks again next interval.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button onClick={() => { holdStepUp(p.id); setStepOpen(false) }} data-testid="stepup-hold"
              className="flex-1 rounded-full py-2 text-[11px] font-black"
              style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
              Hold here
            </button>
            <button onClick={() => { confirmStepUp(p.id); setStepOpen(false) }} data-testid="stepup-advance"
              className="btn-primary flex-1 rounded-full py-2 text-[11px] font-black">
              Advance
            </button>
          </div>
        </div>
      )}
    </motion.div>
  )
}
