import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Activity, Moon, Zap } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import { currentRung } from '../lib/schedule'
import { formatDose } from '../lib/calc'
import { phaseFor, narrativeFor, nextPhaseText, PHASES, PHASE_ORDER } from '../lib/rightNow'

export default function RightNowTab() {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const t = todayStr()

  const rows = useMemo(
    () => peptides.map((p) => ({ p, info: phaseFor(p, titration[p.id], t) })),
    [peptides, titration, t]
  )
  const active = rows.filter((r) => r.info.phase !== 'Off')
  const resting = rows.filter((r) => r.info.phase === 'Off')

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Right Now</h1>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          What my protocol is doing for me today · {active.length} active
        </p>
      </div>

      <div className="card flex items-start gap-2 p-3" style={{ background: 'color-mix(in srgb, var(--good) 8%, var(--surface))' }}>
        <Activity size={14} className="mt-1 shrink-0" style={{ color: 'var(--good)' }} />
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          A live, anecdotal read of expected effects by cycle phase — <span className="font-bold" style={{ color: 'var(--text)' }}>not a clinical promise</span>. Everyone responds differently.
        </p>
      </div>

      {active.length === 0 && (
        <div className="card p-5 text-center text-sm font-medium" style={{ color: 'var(--text-2)' }}>
          Nothing active today — my whole protocol is resting. 🌙
        </div>
      )}

      {active.map(({ p, info }, i) => <PhaseCard key={p.id} peptide={p} info={info} tState={titration[p.id]} index={i} />)}

      {resting.length > 0 && (
        <div className="card p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--text-2)' }}>
            <Moon size={14} /> Resting off-cycle
          </p>
          <div className="flex flex-wrap gap-2">
            {resting.map(({ p }) => (
              <span key={p.id} className="chip" style={{ color: 'var(--text-2)' }}>{p.name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PhaseCard({ peptide: p, info, tState, index }) {
  const phaseMeta = PHASES[info.phase]
  const narr = narrativeFor(p, info)
  const next = nextPhaseText(info)
  const { dose, level, maxLevel } = currentRung(p, tState)

  return (
    <motion.div
      layout className="card overflow-hidden p-3"
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, delay: index * 0.05 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold">{p.name}</h3>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{narr.tagline}</p>
        </div>
        <span className="chip !py-1 font-extrabold" style={{ background: `color-mix(in srgb, ${phaseMeta.color} 20%, transparent)`, color: phaseMeta.color }}>
          <Zap size={12} /> {phaseMeta.label}
        </span>
      </div>

      {/* phase timeline */}
      <div className="mt-3">
        <div className="flex gap-1">
          {PHASE_ORDER.map((ph) => {
            const isCur = ph === info.phase
            const passed = PHASES[ph].order < phaseMeta.order
            return (
              <div key={ph} className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunk)' }}>
                <motion.div
                  className="h-full rounded-full"
                  initial={false}
                  animate={{ width: isCur ? `${clampSeg(info.pct, PHASES[ph].order)}%` : passed ? '100%' : '0%' }}
                  transition={{ type: 'spring', stiffness: 60, damping: 15 }}
                  style={{ background: isCur ? phaseMeta.color : PHASES[ph].color, opacity: passed ? 0.55 : 1 }}
                />
              </div>
            )
          })}
        </div>
        <div className="mt-1 flex justify-between text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
          {PHASE_ORDER.map((ph) => (
            <span key={ph} style={ph === info.phase ? { color: phaseMeta.color } : undefined}>{ph}</span>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm font-medium leading-relaxed">{narr.text}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
        <span>
          {info.ongoing ? `Day ${info.onDay} · ongoing` : `Day ${info.onDay}/${info.onDays} on-cycle`}
        </span>
        <span style={{ color: 'var(--text)' }}>Rung {level + 1}/{maxLevel + 1} · {formatDose(dose, p.ladder.unit)}</span>
        <span className="rounded-[10px] px-2 py-1" style={{ background: 'var(--surface-sunk)' }}>{narr.tempo === 'per-dose' ? 'acts per dose' : 'cumulative'}</span>
      </div>

      {next && (
        <p className="mt-2 text-xs font-bold" style={{ color: phaseMeta.color }}>{next}</p>
      )}
    </motion.div>
  )
}

// portion of a single phase segment to fill given overall pct (0..1)
function clampSeg(pct, order) {
  const bounds = [[0, 0.15], [0.15, 0.45], [0.45, 0.8], [0.8, 1]]
  const [lo, hi] = bounds[order]
  if (pct <= lo) return 0
  if (pct >= hi) return 100
  return ((pct - lo) / (hi - lo)) * 100
}
