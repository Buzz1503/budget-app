import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Zap, Check, Info, Clock, AlertTriangle, Combine, Sun, Moon, ChevronRight, MapPin, Syringe, X, Circle, CheckCircle2 } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import { cycleInfo, currentRung, stepUpDue } from '../lib/schedule'
import { isScheduledToday, slotOf, isDueSlot, currentSlot, slotIsFlexible } from '../lib/daily'
import { toMg, doseToUnits, concentration, formatDose, formatUnits } from '../lib/calc'
import { mixVerdict } from '../lib/mixing'
import { levelProgress, rankForLevel } from '../lib/gamification'
import { expiryInfo, runOutInfo } from '../lib/inventory'
import { daysSince, SITE_BY_ID } from '../lib/sites'
import Ring from './ui/Ring'
import CountUp from './ui/CountUp'
import SitePicker from './SitePicker'
import CoDrawModal from './CoDrawModal'

const spring = { type: 'spring', stiffness: 260, damping: 22 }

export default function Home({ goTo }) {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const knownGood = useStore((s) => s.knownGoodMixes)
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

  const scheduledToday = useMemo(() => peptides.filter((p) => isScheduledToday(p, t)), [peptides, t])
  const slotDue = useMemo(() => scheduledToday.filter((p) => slotOf(p) === slot), [scheduledToday, slot])
  const otherSlot = slot === 'AM' ? 'PM' : 'AM'
  const otherCount = scheduledToday.filter((p) => slotOf(p) === otherSlot).length

  const loggedToday = useMemo(
    () => new Set(doseLogs.filter((l) => l.date === t).map((l) => l.peptideId)),
    [doseLogs, t]
  )
  const slotDone = slotDue.filter((p) => loggedToday.has(p.id)).length
  const dayDone = scheduledToday.filter((p) => loggedToday.has(p.id)).length
  const unloggedCount = slotDue.filter((p) => !loggedToday.has(p.id)).length
  // selection resolved against the live slot list so done/removed ids drop out
  const selectedPeptides = slotDue.filter((p) => selected.has(p.id) && !loggedToday.has(p.id))
  const ringPct = slotDue.length ? slotDone / slotDue.length : (scheduledToday.length === 0 ? 0 : 1)
  const lp = levelProgress(gamification.xp)
  const firstRun = (gamification.totalLogs || 0) === 0
  const evening = new Date().getHours() >= 18
  const atRisk = evening && dayDone < scheduledToday.length && gamification.currentStreak > 0

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

      {/* co-draw hint */}
      {unloggedCount >= 2 && selected.size === 0 && (
        <p className="px-1 text-center text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
          Injecting more than one? Tap the circles to <span className="font-bold" style={{ color: 'var(--lime)' }}>log them together</span> as one co-draw.
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
            slotList={slotDue} titration={titration} knownGood={knownGood}
            onLog={() => setPicker(p)} goTo={goTo} today={t} doseLogs={doseLogs}
            selected={selected.has(p.id)} onToggleSelect={() => toggleSelect(p.id)}
            selectMode={selected.size > 0}
            beckon={firstRun && i === slotDue.findIndex((x) => !loggedToday.has(x.id))} />
        ))}
      </div>

      {/* co-draw action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="fixed inset-x-0 bottom-[76px] z-40 px-4"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl p-2.5 shadow-lg"
              style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)' }}>
              <button onClick={() => setSelected(new Set())} className="rounded-full p-2" style={{ background: 'var(--surface2)' }} aria-label="Clear selection">
                <X size={16} />
              </button>
              <div className="flex-1 text-xs font-bold">
                {selected.size} selected{selected.size < 2 ? ' · pick 1 more to co-draw' : ' · one shot, one site'}
              </div>
              <motion.button whileTap={{ scale: 0.95 }} disabled={selected.size < 2}
                onClick={() => setCoDraw(true)}
                className="btn-primary flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-40">
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
        units={picker ? doseToUnits(toMg(currentRung(picker, titration[picker.id]).dose, picker.ladder.unit), concentration(picker.recon.vialMg, picker.recon.bacMl)) : 0}
      />

      <CoDrawModal
        open={coDraw}
        onClose={() => { setCoDraw(false); setSelected(new Set()) }}
        peptides={selectedPeptides}
      />
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

function DueCard({ peptide: p, index, done, slotList, titration, knownGood, onLog, goTo, today, doseLogs, beckon, selected, onToggleSelect, selectMode }) {
  const tState = titration[p.id]
  const { dose, level, maxLevel } = currentRung(p, tState)
  const doseMg = toMg(dose, p.ladder.unit)
  const conc = concentration(p.recon.vialMg, p.recon.bacMl)
  const units = doseToUnits(doseMg, conc)
  const cyc = cycleInfo(p, today)
  const stepDue = stepUpDue(p, tState, today)

  const partners = slotList.filter((o) => o.id !== p.id && mixVerdict(p.name, o.name, knownGood).verdict === 'green')
  const hint = partners.length
    ? { ok: true, text: `Co-draw OK with ${partners.map((x) => x.name).join(', ')}` }
    : { ok: false, text: 'Inject separately' }

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
        {!done && (
          <motion.button whileTap={{ scale: 0.85 }} onClick={onToggleSelect}
            className="shrink-0" aria-label={selected ? `Deselect ${p.name}` : `Select ${p.name} to co-draw`}
            style={{ color: selected ? 'var(--lime)' : 'var(--muted)' }}>
            {selected ? <CheckCircle2 size={24} /> : <Circle size={24} />}
          </motion.button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-bold">{p.name}</h3>
            <span className="chip" style={{ color: 'var(--violet)' }}>Lvl {level + 1}{level === maxLevel ? ' · max' : ''}</span>
          </div>
          <p className="mt-0.5 text-2xl font-black tracking-tight">
            {formatDose(dose, p.ladder.unit)}
            <span className="ml-2 text-sm font-bold" style={{ color: 'var(--lime)' }}>{formatUnits(units)}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
            <span className="flex items-center gap-1"><Clock size={11} /> {p.timing}</span>
            <span>{cyc.ongoing ? `day ${cyc.cycleDay} · ongoing` : `day ${cyc.cycleDay}/${cyc.onDays + cyc.offDays}`}</span>
            <button className="flex items-center gap-1" style={{ color: hint.ok ? 'var(--lime)' : 'var(--muted)' }} onClick={() => goTo('mix')}>
              <Combine size={11} /> {hint.text}
            </button>
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
