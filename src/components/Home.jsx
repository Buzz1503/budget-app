import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Zap, Check, Info, Clock, AlertTriangle, Combine, Sun, Moon, ChevronRight, MapPin, Syringe, X, Circle, CheckCircle2, ShieldCheck, Ban, Layers, Wind } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import { cycleInfo, currentRung, stepUpDue } from '../lib/schedule'
import { isDueToday, slotOf, isDueSlot, currentSlot, slotIsFlexible, needsProtocolSetup } from '../lib/daily'
import { formatDose, formatUnitsLong, unitsFor, round, isNasal } from '../lib/calc'
import { loadMatrix, LIB_TO_COMPOUND } from '../lib/mixMatrix'
import { planShots, shotsHeadline, MAX_GROUP_ML } from '../lib/grouping'
import { levelProgress, rankForLevel } from '../lib/gamification'
import { expiryInfo, runOutInfo } from '../lib/inventory'
import { daysSince, SITE_BY_ID } from '../lib/sites'
import { backupNudge, countEntries } from '../lib/backup'
import Ring from './ui/Ring'
import CountUp from './ui/CountUp'
import CoachTip from './ui/CoachTip'
import Term from './ui/Term'
import SitePicker from './SitePicker'
import CoDrawModal from './CoDrawModal'

const spring = { type: 'spring', stiffness: 260, damping: 22 }

export default function Home({ goTo }) {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const openVials = useStore((s) => s.openVials)
  const vials = useStore((s) => s.vials)
  const gamification = useStore((s) => s.gamification)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)

  const t = todayStr()
  const [slot, setSlot] = useState(() => currentSlot())
  const [picker, setPicker] = useState(null) // peptide being logged (single)
  const [selected, setSelected] = useState(() => new Set()) // co-draw selection
  const [coDraw, setCoDraw] = useState(false)

  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const scheduledToday = useMemo(() => peptides.filter((p) => isDueToday(p, t)), [peptides, t])
  const slotDue = useMemo(() => scheduledToday.filter((p) => slotOf(p) === slot), [scheduledToday, slot])
  const otherSlot = slot === 'AM' ? 'PM' : 'AM'
  const otherCount = scheduledToday.filter((p) => slotOf(p) === otherSlot).length

  const loggedToday = useMemo(
    () => new Set(doseLogs.filter((l) => l.date === t).map((l) => l.peptideId)),
    [doseLogs, t]
  )
  const slotDone = slotDue.filter((p) => loggedToday.has(p.id)).length
  const dayDone = scheduledToday.filter((p) => loggedToday.has(p.id)).length
  const unlogged = useMemo(() => slotDue.filter((p) => !loggedToday.has(p.id)), [slotDue, loggedToday])
  const unloggedCount = unlogged.length
  // selection resolved against the live slot list so done/removed ids drop out
  const selectedPeptides = slotDue.filter((p) => selected.has(p.id) && !loggedToday.has(p.id))
  const ringPct = slotDue.length ? slotDone / slotDue.length : (scheduledToday.length === 0 ? 0 : 1)
  const lp = levelProgress(gamification.xp)
  const firstRun = (gamification.totalLogs || 0) === 0
  const evening = new Date().getHours() >= 18
  const atRisk = evening && dayDone < scheduledToday.length && gamification.currentStreak > 0

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
      const ro = runOutInfo(p, titration[p.id], vials, openVials[p.id], t)
      if (ro.daysLeft <= settings.restockLeadDays && isFinite(ro.daysLeft)) {
        out.push({ id: `stock-${p.id}`, kind: 'stock', text: `${p.name} runs out in ~${ro.daysLeft}d — restock soon` })
      }
    }
    return out
  }, [peptides, openVials, vials, titration, settings.restockLeadDays, t])

  const now = new Date()

  return (
    <div className="space-y-4">
      {!settings.disclaimerDismissed && (
        <motion.div layout className="card flex items-start gap-3 p-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Info size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--indigo)' }} />
          <div className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            <span className="font-semibold" style={{ color: 'var(--text)' }}>Personal tracking tool — not medical advice.</span>{' '}
            All doses, ladders and cycles are editable anecdotal starting points. Verify everything for yourself.
            <button className="ml-2 font-bold underline" style={{ color: 'var(--text)' }}
              onClick={() => updateSettings({ disclaimerDismissed: true })}>Got it</button>
          </div>
        </motion.div>
      )}

      {/* date + slot toggle */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: 'transparent', backgroundImage: 'linear-gradient(100deg, var(--lime), var(--violet))', backgroundClip: 'text', WebkitBackgroundClip: 'text' }}>
            Pepito +
          </p>
          <p className="text-2xl font-black leading-tight tracking-tight">
            {now.toLocaleDateString(undefined, { weekday: 'long' })}
          </p>
          <p className="text-sm font-bold" style={{ color: 'var(--muted)' }}>
            {now.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="flex rounded-xl p-1" style={{ background: 'var(--surface2)' }}>
          {['AM', 'PM'].map((s) => (
            <button key={s} onClick={() => setSlot(s)}
              className="relative flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-black">
              {slot === s && <motion.span layoutId="slot-pill" className="absolute inset-0 rounded-lg"
                style={{ backgroundImage: s === 'AM' ? 'linear-gradient(135deg, var(--amber), #ff8a1a)' : 'linear-gradient(135deg, var(--indigo), var(--violet))' }} />}
              <span className="relative flex items-center gap-1" style={{ color: slot === s ? '#fff' : 'var(--muted)' }}>
                {s === 'AM' ? <Sun size={14} /> : <Moon size={14} />}{s}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* hero: slot ring + streak + XP */}
      <motion.div layout className="card p-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}
        style={ringPct === 1 && slotDue.length > 0 ? { backgroundImage: 'linear-gradient(135deg, color-mix(in srgb, var(--lime) 14%, var(--surface)), var(--surface))' } : undefined}>
        <div className="flex items-center gap-4">
          <Ring pct={ringPct} size={88} stroke={9}
            from={slot === 'AM' ? 'var(--amber)' : 'var(--indigo)'}
            to={slot === 'AM' ? '#ff8a1a' : 'var(--violet)'}>
            <div className="text-center leading-tight">
              <p className="text-lg font-black"><CountUp value={slotDone} />/{slotDue.length}</p>
              <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>this {slot === 'AM' ? 'AM' : 'PM'}</p>
            </div>
          </Ring>
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-lg font-black leading-tight">
                  {slotDue.length === 0 ? (slot === 'AM' ? 'Clear morning' : 'Clear evening')
                    : ringPct === 1 ? `${slot} done 💪` : `${slotDue.length - slotDone} to inject`}
                </p>
                <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  {dayDone}/{scheduledToday.length} today · {otherCount} this {otherSlot}
                </p>
              </div>
              <StreakFlame streak={gamification.currentStreak} atRisk={atRisk} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] font-bold">
                <span className="flex items-center gap-1" style={{ color: 'var(--violet)' }}>
                  <Zap size={12} /> Lvl {lp.level} · {rankForLevel(lp.level)}
                </span>
                <span style={{ color: 'var(--muted)' }} className="tabular-nums">{lp.current}/{lp.needed} XP</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--surface2)' }}>
                <motion.div className="h-full rounded-full"
                  style={{ backgroundImage: 'linear-gradient(90deg, var(--violet), var(--indigo))' }}
                  initial={false} animate={{ width: `${Math.max(2, lp.pct * 100)}%` }} transition={spring} />
              </div>
            </div>
          </div>
        </div>
        {atRisk && (
          <p className="mt-3 flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--amber)' }}>
            <Flame size={13} /> Don't break the chain — {scheduledToday.length - dayDone} dose{scheduledToday.length - dayDone > 1 ? 's' : ''} left to keep your {gamification.currentStreak}-day streak.
          </p>
        )}
      </motion.div>

      {nudge && (
        <motion.div layout className="card flex items-start gap-2.5 p-3"
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          style={{ background: 'color-mix(in srgb, var(--indigo) 12%, var(--surface))' }}>
          <ShieldCheck size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--indigo)' }} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold">{nudge.text}</p>
            <div className="mt-1.5 flex gap-2">
              <button onClick={() => goTo('settings')}
                className="rounded-lg px-2.5 py-1 text-[11px] font-black"
                style={{ background: 'var(--indigo)', color: '#fff' }}>
                Back up now
              </button>
              <button onClick={dismissBackupNudge}
                className="rounded-lg px-2.5 py-1 text-[11px] font-bold" style={{ background: 'var(--surface2)' }}>
                Later
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {alerts.length > 0 && (
        <motion.div layout className="card space-y-2 p-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {alerts.map((a) => (
            <button key={a.id} onClick={() => goTo('inventory')} className="flex w-full items-center gap-2 text-left text-xs font-semibold">
              <AlertTriangle size={14} className="shrink-0" style={{ color: a.kind === 'expired' ? 'var(--coral)' : 'var(--amber)' }} />
              <span style={{ color: a.kind === 'expired' ? 'var(--coral)' : 'var(--text)' }}>{a.text}</span>
            </button>
          ))}
        </motion.div>
      )}

      {firstRun && slotDue.length > 0 && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-1 text-center text-xs font-bold" style={{ color: 'var(--lime)' }}>
          👋 Tap Log to record your first injection and start your streak.
        </motion.p>
      )}

      {/* combine-your-shots plan */}
      {plan && selected.size === 0 && (
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
        {slotDue.length === 0 && (
          <div className="card p-6 text-center" style={{ color: 'var(--muted)' }}>
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
        {slotDue.map((p, i) => (
          <DueCard key={p.id} peptide={p} index={i} done={loggedToday.has(p.id)}
            titration={titration} partners={partnersById[p.id]} slot={slot}
            onLog={() => setPicker(p)} goTo={goTo} today={t} doseLogs={doseLogs}
            selected={selected.has(p.id)} onToggleSelect={() => toggleSelect(p.id)}
            selectMode={selected.size > 0}
            beckon={firstRun && i === slotDue.findIndex((x) => !loggedToday.has(x.id))} />
        ))}
      </div>

      {/* keeps the last card clear of the floating co-draw bar */}
      {selected.size > 0 && <div aria-hidden className="h-20" />}

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
              <motion.button whileTap={{ scale: 0.95 }} disabled={selected.size < 2}
                onClick={() => setCoDraw(true)}
                className="btn-primary flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-black disabled:opacity-40">
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

// Fewest-syringes plan for the selected slot. Accepting a group hands straight
// off to the existing co-draw flow, which re-runs the mix check, gates CAUTION
// on visual inspection, and takes one site for the whole group.
function ShotPlan({ plan, slot, onAccept }) {
  const headline = shotsHeadline(plan, slot)
  const combinable = plan.groups.filter((g) => g.items.length > 1)

  return (
    <motion.div layout className="card space-y-2.5 p-4"
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      style={{ backgroundImage: 'linear-gradient(135deg, color-mix(in srgb, var(--lime) 12%, var(--surface)), var(--surface))' }}>
      <div className="flex items-center gap-2">
        <Layers size={16} className="shrink-0" style={{ color: 'var(--lime)' }} />
        <p className="text-sm font-black leading-tight">{headline}</p>
      </div>

      <div className="space-y-2">
        {plan.groups.map((g, i) => (
          <ShotRow key={g.items.map((x) => x.id).join('+') || i} group={g} onAccept={onAccept} />
        ))}
      </div>

      <p className="text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
        {combinable.length > 0
          ? <>Only pairs the matrix rates <span className="font-bold">safe to mix</span> are combined, capped at {MAX_GROUP_ML} mL a syringe. That still isn't proof of compatibility — inspect every draw.</>
          : <>Nothing here shares a syringe: a pair is combined only on a confirmed “safe to mix”, so caution, don't-mix and unrated pairs all get their own shot.</>}
      </p>
    </motion.div>
  )
}

function ShotRow({ group, onAccept }) {
  const many = group.items.length > 1
  const names = group.items.map((i) => i.name).join(' + ')

  return (
    <div className="rounded-xl p-2.5" style={{ background: 'var(--surface2)' }}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-black uppercase tracking-wide"
            style={{ color: many ? 'var(--lime)' : 'var(--muted)' }}>
            {many ? `Combine into 1 shot · ${group.items.length}` : group.separate ? 'Separate shot' : 'On its own'}
          </span>
          <span className="block truncate text-sm font-bold">{names}</span>
          <span className="block text-[11px] font-bold" style={{ color: 'var(--lime)' }}>
            {formatUnitsLong(group.units)}{many ? ' total' : ''}
            <span className="font-semibold" style={{ color: 'var(--muted)' }}> · {round(group.ml, 2)} mL</span>
          </span>
        </span>
        {many && (
          <motion.button whileTap={{ scale: 0.94 }} onClick={() => onAccept(group)}
            className="btn-primary shrink-0 rounded-xl px-3 py-2 text-xs font-black">
            Log together
          </motion.button>
        )}
      </div>

      {group.separate && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[10px] font-bold" style={{ color: 'var(--rose)' }}>
          <Ban size={12} className="mt-0.5 shrink-0" />
          <span>{group.separateReason || 'Always injected on its own.'}</span>
        </p>
      )}
    </div>
  )
}

export function StreakFlame({ streak, atRisk }) {
  if (streak === 0) {
    return <div className="chip" style={{ color: 'var(--muted)' }}><Flame size={13} /> Start your streak</div>
  }
  const scale = Math.min(1.4, 1 + streak * 0.03)
  return (
    <div className="chip" style={{ color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 16%, transparent)' }}>
      <motion.span animate={atRisk ? { rotate: [-8, 8, -8], scale } : { scale: [scale, scale * 1.08, scale] }}
        transition={{ duration: atRisk ? 0.4 : 1.6, repeat: Infinity }} style={{ display: 'inline-flex' }}>
        <Flame size={13 + Math.min(6, streak * 0.4)} fill={streak >= 3 ? 'var(--amber)' : 'none'} />
      </motion.span>
      <CountUp value={streak} /> day{streak === 1 ? '' : 's'}
    </div>
  )
}

function DueCard({ peptide: p, index, done, titration, partners, slot, onLog, goTo, today, doseLogs, beckon, selected, onToggleSelect, selectMode }) {
  const tState = titration[p.id]
  const { dose, level, maxLevel } = currentRung(p, tState)
  const nasal = isNasal(p)
  const units = nasal ? null : unitsFor(p, dose)
  const cyc = cycleInfo(p, today)
  const stepDue = stepUpDue(p, tState, today)
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
    <motion.div layout className={`card p-4 ${beckon ? 'beckon' : ''}`}
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: index * 0.04 }}
      style={selected
        ? { borderColor: 'var(--lime)', boxShadow: '0 0 0 1.5px var(--lime), var(--shadow)' }
        : done ? { borderColor: 'color-mix(in srgb, var(--lime) 40%, transparent)' } : undefined}>
      <div className="flex items-center gap-3">
        {/* co-draw select toggle */}
        {!done && (noCoDraw ? (
          <span className="shrink-0"
            title={nasal ? 'Sprayed, not injected — cannot be co-drawn' : 'Always injected on its own — cannot be co-drawn'}
            aria-label={`${p.name} cannot be co-drawn`}
            style={{ color: nasal ? 'var(--indigo)' : 'var(--rose)', opacity: 0.8 }}>
            {nasal ? <Wind size={24} /> : <Ban size={24} />}
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
            <h3 className="truncate text-base font-bold">{p.name}</h3>
            <span className="chip" style={{ color: 'var(--violet)' }}>Lvl {level + 1}{level === maxLevel ? ' · max' : ''}</span>
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
          </div>
        </div>
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
      {stepDue && (
        <button onClick={() => goTo('schedule')}
          className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-bold"
          style={{ background: 'color-mix(in srgb, var(--violet) 16%, transparent)', color: 'var(--violet)' }}>
          <span className="flex items-center gap-2"><Zap size={13} /> Step-up ready — tolerating well?</span>
          <ChevronRight size={14} />
        </button>
      )}
    </motion.div>
  )
}
