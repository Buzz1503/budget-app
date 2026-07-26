import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Flame, Zap, Check, Info, Clock, AlertTriangle, Combine } from 'lucide-react'
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
      <motion.div layout className="card p-4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <div className="flex items-center gap-4">
          <Ring pct={ringPct} size={86} stroke={9}>
            <div className="text-center leading-tight">
              <p className="text-lg font-extrabold">
                <CountUp value={doneCount} />/{due.length}
              </p>
              <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>doses</p>
            </div>
          </Ring>
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-extrabold leading-tight">
                  {ringPct === 1 && due.length > 0 ? 'Stack complete 💪' : 'Today'}
                </p>
                <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                  {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                </p>
              </div>
              <div className="chip" style={{ color: 'var(--amber)' }}>
                <Flame size={13} />
                <CountUp value={gamification.currentStreak} /> day{gamification.currentStreak === 1 ? '' : 's'}
              </div>
            </div>
            {/* XP bar */}
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] font-bold">
                <span className="flex items-center gap-1" style={{ color: 'var(--violet)' }}>
                  <Zap size={12} /> Lvl {lp.level} · {rankForLevel(lp.level)}
                </span>
                <span style={{ color: 'var(--muted)' }}>{lp.current}/{lp.needed} XP</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface2)' }}>
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
          />
        ))}
      </div>
    </div>
  )
}

function DueCard({ peptide: p, index, done, dueList, titration, knownGood, onLog, goTo, today }) {
  const tState = titration[p.id]
  const { dose, level, maxLevel } = currentRung(p, tState)
  const doseMg = toMg(dose, p.ladder.unit)
  const conc = concentration(p.recon.vialMg, p.recon.bacMl)
  const units = doseToUnits(doseMg, conc)
  const cyc = cycleInfo(p, today)
  const stepDue = stepUpDue(p, tState, today)

  // co-draw hint against other peptides due today
  const partners = dueList.filter((o) => o.id !== p.id && mixVerdict(p.name, o.name, knownGood).verdict === 'green')
  const hint = partners.length
    ? { ok: true, text: `Co-draw OK with ${partners.map((x) => x.name).join(', ')}` }
    : { ok: false, text: 'Inject separately' }

  return (
    <motion.div
      layout
      className="card p-4"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: index * 0.04 }}
      style={done ? { borderColor: 'color-mix(in srgb, var(--lime) 35%, transparent)' } : undefined}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-bold">{p.name}</h3>
            <span className="chip" style={{ color: 'var(--violet)' }}>Lvl {level + 1}{level === maxLevel ? ' · max' : ''}</span>
          </div>
          <p className="mt-0.5 text-2xl font-extrabold tracking-tight">
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
          onClick={onLog}
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold ${done ? '' : 'btn-primary'}`}
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
          className="mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold"
          style={{ background: 'color-mix(in srgb, var(--violet) 16%, transparent)', color: 'var(--violet)' }}
        >
          <Zap size={13} /> Step-up ready — tolerating well? Review in Schedule →
        </button>
      )}
    </motion.div>
  )
}
