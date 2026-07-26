import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Zap, Pause, ChevronUp, SlidersHorizontal } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import {
  currentRung, stepUpDue, nextStepUpDate, projectSchedule, cycleInfo,
} from '../lib/schedule'
import { formatDose } from '../lib/calc'
import Ring from './ui/Ring'

export default function Schedule() {
  const peptides = useStore((s) => s.peptides)
  const [selectedId, setSelectedId] = useState(peptides[0]?.id)
  const selected = peptides.find((p) => p.id === selectedId) || peptides[0]

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Schedule</h1>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {peptides.map((p) => (
          <motion.button key={p.id} whileTap={{ scale: 0.94 }} onClick={() => setSelectedId(p.id)}
            className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold"
            style={selectedId === p.id
              ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
              : { background: 'var(--surface2)', color: 'var(--muted)' }}>
            {p.name}
          </motion.button>
        ))}
      </div>
      {selected && <PeptideSchedule key={selected.id} peptide={selected} />}
    </div>
  )
}

function PeptideSchedule({ peptide: p }) {
  const titration = useStore((s) => s.titration)
  const confirmStepUp = useStore((s) => s.confirmStepUp)
  const holdStepUp = useStore((s) => s.holdStepUp)
  const setRungLevel = useStore((s) => s.setRungLevel)
  const [showOverride, setShowOverride] = useState(false)

  const t = todayStr()
  const tState = titration[p.id] || { level: 0, levelStartDate: p.startDate }
  const { dose, level, maxLevel, rungs } = currentRung(p, tState)
  const due = stepUpDue(p, tState, t)
  const nextDate = nextStepUpDate(p, tState)
  const cyc = cycleInfo(p, t)

  const projection = useMemo(() => projectSchedule(p, tState, t, 12 * 7, t), [p, tState, t])
  const chartData = useMemo(
    () => projection.filter((_, i) => i % 2 === 0).map((d) => ({
      date: format(parseISO(d.date), 'd MMM'),
      dose: d.isOn ? d.dose : 0,
    })),
    [projection]
  )
  const upcoming = useMemo(() => {
    const out = []
    let prevOn = true
    for (const d of projection) {
      if (d.stepUp) out.push({ ...d, kind: 'stepup' })
      if (!d.isOn && prevOn) out.push({ ...d, kind: 'rest' })
      if (d.isOn && !prevOn) out.push({ ...d, kind: 'resume' })
      prevOn = d.isOn
    }
    return out.slice(0, 6)
  }, [projection])

  const cyclePct = cyc.ongoing ? 1 : cyc.isOn ? cyc.cycleDay / cyc.onDays : 1

  return (
    <div className="space-y-4">
      {/* current state */}
      <motion.div layout className="card p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-4">
          <Ring pct={cyclePct} size={76} stroke={8} color={cyc.isOn ? 'var(--lime)' : 'var(--amber)'}>
            <div className="text-center leading-tight">
              <p className="text-sm font-extrabold">{cyc.isOn ? `d${cyc.onDay ?? cyc.cycleDay}` : 'rest'}</p>
              <p className="text-[8px] font-bold uppercase" style={{ color: 'var(--muted)' }}>
                {cyc.ongoing ? 'ongoing' : cyc.isOn ? `of ${cyc.onDays}` : `${cyc.onDays + cyc.offDays - cyc.cycleDay + 1}d left`}
              </p>
            </div>
          </Ring>
          <div className="flex-1">
            <p className="text-lg font-extrabold">{p.name}</p>
            <p className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--lime)' }}>
              {formatDose(dose, p.ladder.unit)}
            </p>
            <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
              Level {level + 1} of {maxLevel + 1}
              {level < maxLevel && nextDate && ` · next step-up ${format(parseISO(nextDate), 'd MMM')}`}
              {level === maxLevel && ' · at ceiling 🏔️'}
            </p>
          </div>
        </div>

        {/* ladder rungs */}
        <div className="mt-4 flex items-end gap-1.5">
          {rungs.map((r, i) => (
            <motion.button
              key={i}
              onClick={() => setRungLevel(p.id, i)}
              whileTap={{ scale: 0.9 }}
              className="flex-1 rounded-t-md"
              initial={false}
              animate={{ height: 14 + (i / Math.max(1, rungs.length - 1)) * 34 }}
              style={{
                background: i <= level
                  ? 'linear-gradient(180deg, var(--violet), var(--indigo))'
                  : 'var(--surface2)',
                opacity: i <= level ? 1 : 0.7,
              }}
              title={`Set level ${i + 1}: ${formatDose(r, p.ladder.unit)}`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] font-bold" style={{ color: 'var(--muted)' }}>
          <span>{formatDose(rungs[0], p.ladder.unit)}</span>
          <span>tap a rung to hand-set</span>
          <span>{formatDose(rungs[maxLevel], p.ladder.unit)}</span>
        </div>
      </motion.div>

      {/* tolerance gate */}
      {due && (
        <motion.div
          className="card p-4"
          initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          style={{ borderColor: 'color-mix(in srgb, var(--violet) 45%, transparent)' }}
        >
          <p className="flex items-center gap-2 text-sm font-extrabold">
            <Zap size={16} style={{ color: 'var(--violet)' }} />
            Tolerating well — advance to {formatDose(rungs[level + 1], p.ladder.unit)}?
          </p>
          <p className="mt-1 text-xs font-medium" style={{ color: 'var(--muted)' }}>
            You've held {formatDose(dose, p.ladder.unit)} for {p.ladder.intervalWeeks} week{p.ladder.intervalWeeks > 1 ? 's' : ''}.
            Declining holds the dose and asks again next interval.
          </p>
          <div className="mt-3 flex gap-2">
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => confirmStepUp(p.id)}
              className="btn-violet flex-1 rounded-xl py-2.5 text-sm font-extrabold">
              <span className="flex items-center justify-center gap-1"><ChevronUp size={16} /> Advance — Lvl {level + 2}</span>
            </motion.button>
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => holdStepUp(p.id)}
              className="flex-1 rounded-xl py-2.5 text-sm font-extrabold" style={{ background: 'var(--surface2)' }}>
              <span className="flex items-center justify-center gap-1"><Pause size={15} /> Hold dose</span>
            </motion.button>
          </div>
        </motion.div>
      )}

      {/* overrides */}
      <div className="card p-4">
        <button className="flex w-full items-center justify-between text-sm font-bold" onClick={() => setShowOverride(!showOverride)}>
          <span className="flex items-center gap-2"><SlidersHorizontal size={15} style={{ color: 'var(--amber)' }} /> Per-step override</span>
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{showOverride ? 'hide' : 'show'}</span>
        </button>
        {showOverride && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40"
              style={{ background: 'var(--surface2)' }}
              disabled={level >= maxLevel}
              onClick={() => confirmStepUp(p.id)}
            >
              Advance early → {level < maxLevel ? formatDose(rungs[level + 1], p.ladder.unit) : '—'}
            </button>
            <button
              className="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40"
              style={{ background: 'var(--surface2)' }}
              disabled={level >= maxLevel}
              onClick={() => setRungLevel(p.id, Math.min(level + 2, maxLevel))}
            >
              Skip a rung → {formatDose(rungs[Math.min(level + 2, maxLevel)], p.ladder.unit)}
            </button>
            <button
              className="rounded-xl px-3 py-2 text-xs font-bold"
              style={{ background: 'var(--surface2)' }}
              onClick={() => holdStepUp(p.id)}
            >
              Hold — restart interval
            </button>
            <button
              className="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40"
              style={{ background: 'var(--surface2)' }}
              disabled={level === 0}
              onClick={() => setRungLevel(p.id, level - 1)}
            >
              Step back down
            </button>
            <p className="col-span-2 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
              Any override re-anchors the interval to today and regenerates the downstream schedule. Tap a ladder rung above to hand-set any level.
            </p>
          </motion.div>
        )}
      </div>

      {/* titration climb chart */}
      <div className="card p-4">
        <p className="mb-2 text-sm font-bold">12-week projection <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>(assumes you confirm each step)</span></p>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="doseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--violet)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--violet)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--muted)' }} tickLine={false} axisLine={false} interval={6} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--muted)' }} tickLine={false} axisLine={false} domain={[0, p.ladder.ceiling * 1.1]} />
              <Tooltip
                contentStyle={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: 'var(--muted)' }}
                formatter={(v) => [v ? formatDose(v, p.ladder.unit) : 'rest', 'dose']}
              />
              <ReferenceLine y={p.ladder.ceiling} stroke="var(--coral)" strokeDasharray="4 4"
                label={{ value: 'ceiling', fontSize: 9, fill: 'var(--coral)', position: 'insideTopRight' }} />
              <Area type="stepAfter" dataKey="dose" stroke="var(--violet)" strokeWidth={2} fill="url(#doseGrad)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* upcoming milestones */}
      <div className="card p-4">
        <p className="mb-2 text-sm font-bold">Upcoming</p>
        {upcoming.length === 0 && <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>No changes in the next 12 weeks — cruising at this dose.</p>}
        <div className="space-y-2">
          {upcoming.map((u, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 text-xs font-bold" style={{ color: 'var(--muted)' }}>
                {format(parseISO(u.date), 'd MMM')}
              </span>
              {u.kind === 'stepup' && (
                <span className="font-semibold" style={{ color: 'var(--violet)' }}>
                  ⬆ Step up to {formatDose(u.dose, p.ladder.unit)} (Lvl {u.level + 1}) — if tolerating
                </span>
              )}
              {u.kind === 'rest' && <span className="font-semibold" style={{ color: 'var(--amber)' }}>⏸ Off-cycle rest begins</span>}
              {u.kind === 'resume' && <span className="font-semibold" style={{ color: 'var(--lime)' }}>▶ Back on cycle</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
