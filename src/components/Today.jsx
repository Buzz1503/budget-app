import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Zap, Check, Info, Clock, AlertTriangle, Combine, ChevronRight } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import { isDueOn, cycleInfo, currentRung, stepUpDue } from '../lib/schedule'
import { toMg, doseToUnits, concentration, formatDose, formatUnits } from '../lib/calc'
import { mixVerdict } from '../lib/mixing'
import { levelProgress, rankForLevel } from '../lib/gamification'
import { expiryInfo, runOutInfo } from '../lib/inventory'
import Ring from './ui/Ring'
import CountUp from './ui/CountUp'

const spring = { type: 'spring', stiffness: 260, damping: 22 }

export default function Today({ goTo }) {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const doseLogs = useStore((s) => s.doseLogs)
  const knownGood = useStore((s) => s.knownGoodMixes)
  const openVials = useStore((s) => s.openVials)
  const vials = useStore((s) => s.vials)
  const gamification = useStore((s) => s.gamification)
  const settings = useStore((s) => s.settings)
  const logDose = useStore((s) => s.logDose)
  const updateSettings = useStore((s) => s.updateSettings)

  const t = todayStr()
  const due = useMemo(() => peptides.filter((p) => isDueOn(p, t)), [peptides, t])
  const loggedToday = useMemo(
    () => new Set(doseLogs.filter((l) => l.date === t).map((l) => l.peptideId)),
    [doseLogs, t]
  )
  const doneCount = due.filter((p) => loggedToday.has(p.id)).length
  const ringPct = due.length ? doneCount / due.length : 0
  const lp = levelProgress(gamification.xp)
  const firstRun = (gamification.totalLogs || 0) === 0
  const nextIdx = due.findIndex((p) => !loggedToday.has(p.id))
  const evening = new Date().getHours() >= 18
  const atRisk = evening && doneCount < due.length && gamification.currentStreak > 0

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

  return (
    <div className="space-y-4">
      {/* disclaimer */}
      {!settings.disclaimerDismissed && (
        <motion.div layout className="card flex items-start gap-3 p-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Info size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--indigo)' }} />
          <div className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            <span className="font-semibold" style={{ color: 'var(--text)' }}>Personal tracking tool — not medical advice.</span>{' '}
            All doses, ladders and cycles are editable anecdotal starting points. Verify everything for yourself.
            <button
              className="ml-2 font-bold underline"
              style={{ color: 'var(--text)' }}
              onClick={() => updateSettings({ disclaimerDismissed: true })}
            >
              Got it
            </button>
          </div>
        </motion.div>
      )}

      {/* header: ring + streak + XP */}
      <motion.div layout className="card p-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}
        style={ringPct === 1 && due.length > 0 ? { backgroundImage: 'linear-gradient(135deg, color-mix(in srgb, var(--lime) 16%, var(--surface)), var(--surface))' } : undefined}>
        <div className="flex items-center gap-4">
          <Ring pct={ringPct} size={88} stroke={9}>
            <div className="text-center leading-tight">
              <p className="text-lg font-black">
                <CountUp value={doneCount} />/{due.length}
              </p>
              <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>doses</p>
            </div>
          </Ring>
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xl font-black leading-tight">
                  {ringPct === 1 && due.length > 0 ? 'Stack complete 💪' : due.length === 0 ? 'Rest day 🌿' : 'Today'}
                </p>
                <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                  {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                </p>
              </div>
              <StreakFlame streak={gamification.currentStreak} atRisk={atRisk} />
            </div>
            {/* XP bar */}
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] font-bold">
                <span className="flex items-center gap-1" style={{ color: 'var(--violet)' }}>
                  <Zap size={12} /> Lvl {lp.level} · {rankForLevel(lp.level)}
                </span>
                <span style={{ color: 'var(--muted)' }} className="tabular-nums">{lp.current}/{lp.needed} XP</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--surface2)' }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundImage: 'linear-gradient(90deg, var(--violet), var(--indigo))' }}
                  initial={false}
                  animate={{ width: `${Math.max(2, lp.pct * 100)}%` }}
                  transition={spring}
                />
              </div>
            </div>
          </div>
        </div>
        {atRisk && (
          <p className="mt-3 flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--amber)' }}>
            <Flame size={13} /> Don't break the chain — {due.length - doneCount} dose{due.length - doneCount > 1 ? 's' : ''} left to keep your {gamification.currentStreak}-day streak.
          </p>
        )}
      </motion.div>

      {/* alerts */}
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

      {/* first-run invite */}
      {firstRun && due.length > 0 && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-1 text-center text-xs font-bold" style={{ color: 'var(--lime)' }}>
          👋 Log your first dose to start your streak — swipe a card or tap Log.
        </motion.p>
      )}

      {/* due list */}
      <div className="space-y-3">
        {due.length === 0 && (
          <div className="card p-6 text-center text-sm font-medium" style={{ color: 'var(--muted)' }}>
            Nothing due today — enjoy the rest day 🌿
          </div>
        )}
        {due.map((p, i) => (
          <DueCard
            key={p.id}
            peptide={p} index={i}
            done={loggedToday.has(p.id)}
            dueList={due}
            titration={titration}
            knownGood={knownGood}
            onLog={() => logDose(p.id)}
            goTo={goTo}
            today={t}
            beckon={firstRun && i === nextIdx}
          />
        ))}
      </div>
    </div>
  )
}

function StreakFlame({ streak, atRisk }) {
  if (streak === 0) {
    return (
      <div className="chip" style={{ color: 'var(--muted)' }}>
        <Flame size={13} /> Start your streak
      </div>
    )
  }
  const scale = Math.min(1.4, 1 + streak * 0.03)
  return (
    <div className="chip" style={{ color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 16%, transparent)' }}>
      <motion.span
        animate={atRisk ? { rotate: [-8, 8, -8], scale } : { scale: [scale, scale * 1.08, scale] }}
        transition={{ duration: atRisk ? 0.4 : 1.6, repeat: Infinity }}
        style={{ display: 'inline-flex' }}
      >
        <Flame size={13 + Math.min(6, streak * 0.4)} fill={streak >= 3 ? 'var(--amber)' : 'none'} />
      </motion.span>
      <CountUp value={streak} /> day{streak === 1 ? '' : 's'}
    </div>
  )
}

function DueCard({ peptide: p, index, done, dueList, titration, knownGood, onLog, goTo, today, beckon }) {
  const tState = titration[p.id]
  const { dose, level, maxLevel } = currentRung(p, tState)
  const doseMg = toMg(dose, p.ladder.unit)
  const conc = concentration(p.recon.vialMg, p.recon.bacMl)
  const units = doseToUnits(doseMg, conc)
  const cyc = cycleInfo(p, today)
  const stepDue = stepUpDue(p, tState, today)
  const [float, setFloat] = useState(null)
  const [swipe, setSwipe] = useState(0)

  const doLog = () => {
    if (done) return
    onLog()
    try {
      const c = useStore.getState().celebration
      setFloat(c?.xp || 10)
      setTimeout(() => setFloat(null), 950)
    } catch { /* ignore */ }
  }

  const partners = dueList.filter((o) => o.id !== p.id && mixVerdict(p.name, o.name, knownGood).verdict === 'green')
  const hint = partners.length
    ? { ok: true, text: `Co-draw OK with ${partners.map((x) => x.name).join(', ')}` }
    : { ok: false, text: 'Inject separately' }

  return (
    <div className="relative">
      {/* swipe-to-log track hint */}
      {!done && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-start overflow-hidden rounded-[20px] pl-5"
          style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--lime) 30%, transparent), transparent)', opacity: Math.min(1, swipe / 90) }}>
          <span className="flex items-center gap-1 text-sm font-black" style={{ color: 'var(--lime)' }}>
            <Check size={18} strokeWidth={3} /> Release to log
          </span>
        </div>
      )}
      <motion.div
        layout
        className={`card relative p-4 ${beckon ? 'beckon' : ''}`}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: index * 0.04 }}
        style={done ? { borderColor: 'color-mix(in srgb, var(--lime) 40%, transparent)' } : undefined}
        drag={done ? false : 'x'}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.6 }}
        dragSnapToOrigin
        onDrag={(e, info) => setSwipe(Math.max(0, info.offset.x))}
        onDragEnd={(e, info) => { setSwipe(0); if (info.offset.x > 100) doLog() }}
      >
        {/* floating +XP */}
        <AnimatePresence>
          {float != null && (
            <motion.span
              key="float"
              className="pointer-events-none absolute right-6 top-2 text-sm font-black"
              style={{ color: 'var(--lime)' }}
              initial={{ y: 0, opacity: 0, scale: 0.7 }}
              animate={{ y: -40, opacity: [0, 1, 0], scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.95, ease: 'easeOut' }}
            >
              +{float} XP
            </motion.span>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3">
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
              <span>
                {cyc.ongoing ? `day ${cyc.cycleDay} · ongoing` : `day ${cyc.cycleDay}/${cyc.onDays + cyc.offDays}`}
              </span>
              <button className="flex items-center gap-1" style={{ color: hint.ok ? 'var(--lime)' : 'var(--muted)' }} onClick={() => goTo('mix')}>
                <Combine size={11} /> {hint.text}
              </button>
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            disabled={done}
            onClick={doLog}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-sm font-black ${done ? '' : 'btn-primary'}`}
            style={done ? { background: 'var(--surface2)', color: 'var(--lime)' } : undefined}
            aria-label={done ? `${p.name} logged` : `Log ${p.name}`}
          >
            {done ? (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
                <Check size={26} strokeWidth={3} />
              </motion.span>
            ) : (
              'Log'
            )}
          </motion.button>
        </div>
        {stepDue && (
          <button
            onClick={() => goTo('schedule')}
            className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-bold"
            style={{ background: 'color-mix(in srgb, var(--violet) 16%, transparent)', color: 'var(--violet)' }}
          >
            <span className="flex items-center gap-2"><Zap size={13} /> Step-up ready — tolerating well?</span>
            <ChevronRight size={14} />
          </button>
        )}
      </motion.div>
    </div>
  )
}
