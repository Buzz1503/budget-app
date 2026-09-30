import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Pause, Play, ChevronDown, ChevronRight, SkipForward, Check } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { prettyDate } from '../../lib/schedule'
import {
  STEP_TYPES, LOCK_WORDS, currentStep, stepProgress, stepResult,
} from '../../lib/investigation'
import { useReactionAnalysis } from './SuspectBoard'

/**
 * One step at a time, and what it would mean either way.
 *
 * The card says what changes, what is held still and what each outcome would
 * tell you — before the step runs, not after. Knowing in advance what a result
 * would mean is the difference between an experiment and a fortnight of
 * collecting numbers.
 */
export default function InvestigationPanel() {
  const investigations = useStore((s) => s.investigations)
  const steps = useStore((s) => s.investigationSteps)
  const advanceStep = useStore((s) => s.advanceStep)
  const skipStep = useStore((s) => s.skipStep)
  const pauseInvestigation = useStore((s) => s.pauseInvestigation)
  const resumeInvestigation = useStore((s) => s.resumeInvestigation)
  const showToast = useStore((s) => s.showToast)
  const a = useReactionAnalysis()
  const t = todayStr()
  const [open, setOpen] = useState(false)

  const inv = investigations.find((i) => i.status !== 'archived') || investigations[0] || null
  const mine = useMemo(
    () => steps.filter((s) => !inv || s.investigationId === inv.id).sort((x, y) => x.order - y.order),
    [steps, inv]
  )
  const step = currentStep(mine)
  const type = step ? STEP_TYPES[step.type] : null
  const p = step ? stepProgress(step, { ...a, todayStr: t }) : null
  const result = step && p?.ready ? stepResult(step, { ...a, todayStr: t }) : null

  if (!inv || !step || !type) return null
  const paused = inv.status === 'paused'

  return (
    <div className="space-y-2" data-testid="investigation-panel" data-step={step.type}>
      <div className="card p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="t-caption" style={{ color: 'var(--text-2)' }}>
              Step {step.order + 1} of {mine.length}
              {p?.dayOf ? ` · day ${p.dayOf}${p.days ? ` of ${p.days}` : ''}` : ''}
            </p>
            <p className="text-sm font-black">{type.name}</p>
          </div>
          <button onClick={() => (paused ? resumeInvestigation(inv.id) : pauseInvestigation(inv.id))}
            data-testid="investigation-pause"
            className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: paused ? 'var(--warn)' : 'var(--text-2)' }}>
            {paused ? <><Play size={11} /> Paused</> : <Pause size={11} />}
          </button>
        </div>

        <p className="mt-1.5 text-xs font-bold">{type.what}</p>
        <p className="mt-0.5 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {type.why}
        </p>

        {step.lockedVars.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="locked-chips">
            {step.lockedVars.map((l) => (
              <span key={l} className="rounded-full px-2 py-1 text-xs font-bold" data-testid="lock-chip" data-lock={l}
                style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {LOCK_WORDS[l] || l}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="text-xs font-black tabular-nums" data-testid="step-progress">
            {p.n} of {p.required || '—'} injections
          </span>
          {p.confounded > 0 && (
            <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--warn)' }}>
              {p.confounded} left out
            </span>
          )}
        </div>
        {p.required > 0 && (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunk)' }}>
            <div className="h-full rounded-full"
              style={{ width: `${Math.min(100, (p.n / p.required) * 100)}%`, background: 'var(--accent)' }} />
          </div>
        )}

        <p className="mt-2 text-xs font-medium leading-relaxed" data-testid="what-next"
          style={{ color: 'var(--text-2)' }}>
          {paused
            ? 'Paused. Timers are frozen and nothing logged meanwhile counts towards this step.'
            : p.ready
              ? 'Enough logged — read the result and move on, or keep going for a firmer answer.'
              : `What happens next: log ${Math.max(0, p.required - p.n)} more injection${p.required - p.n === 1 ? '' : 's'} that follow the rules above.`}
        </p>

        {result && (
          <div className="mt-2 rounded-[12px] p-2.5" data-testid="step-result"
            style={{ background: 'var(--surface-sunk)' }}>
            <p className="text-xs font-black">{result.text}</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => { advanceStep(step.id, result.text); showToast('Next step started') }}
                data-testid="step-advance"
                className="btn-primary flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-black">
                <Check size={12} /> Next step
              </button>
              <button onClick={() => showToast('Carrying on with this step')}
                data-testid="step-extend"
                className="flex-1 rounded-full py-2.5 text-xs font-black"
                style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>
                Keep going
              </button>
            </div>
          </div>
        )}
      </div>

      {/* the whole plan, folded away */}
      <div className="card overflow-hidden">
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="plan-toggle"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
          {open ? <ChevronDown size={14} style={{ color: 'var(--text-3)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />}
          <span className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>The whole plan</span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} className="overflow-hidden" data-testid="plan">
              <div className="rows" style={{ borderTop: '1px solid var(--border)' }}>
                {mine.map((s) => {
                  const st = STEP_TYPES[s.type]
                  return (
                    <div key={s.id} className="px-3 py-2.5" data-testid="plan-step"
                      data-type={s.type} data-status={s.status}>
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 text-xs font-bold">{st?.name || s.type}</span>
                        <span className="shrink-0 text-xs font-bold capitalize"
                          style={{ color: s.status === 'done' ? 'var(--good)' : s.status === 'running' ? 'var(--accent)' : 'var(--text-3)' }}>
                          {s.status}
                        </span>
                        {s.status === 'running' && (
                          <button onClick={() => skipStep(s.id)} aria-label="Skip this step"
                            data-testid="plan-skip" style={{ color: 'var(--text-3)' }}>
                            <SkipForward size={12} />
                          </button>
                        )}
                      </div>
                      {s.result && (
                        <p className="mt-0.5 text-xs font-medium leading-relaxed" data-testid="plan-result"
                          style={{ color: 'var(--text-3)' }}>{s.result}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
