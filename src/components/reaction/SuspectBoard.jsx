import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronRight, AlertTriangle, ArrowRight } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { displayName } from '../../lib/naming'
import { ZONE_BY_ID } from '../../lib/reactionZones'
import { reactionScore, RS_POSITIVE, escalationFor, rsWords } from '../../lib/reactionScore'
import {
  suspectBoard, evidence, compare, FACTORS, FACTOR_BY_ID, groupsFor, trendFor,
} from '../../lib/reactionAnalysis'
import { STEP_TYPES, currentStep, stepProgress, remainingForVerdict } from '../../lib/investigation'

/**
 * Everything the data will support, and nothing it will not.
 *
 * The board leads with one or two names because a list of eleven ranked
 * suspects is not a finding, it is a spreadsheet. The confidence badge is
 * doing the real work: most of the time the honest answer is "not yet", and a
 * feature that hid that behind a confident-looking bar would be worse than one
 * that said nothing at all.
 */

export function useReactionAnalysis() {
  const records = useStore((s) => s.injectionRecords)
  const reactions = useStore((s) => s.reactions)
  const checkins = useStore((s) => s.reactionCheckins)
  const steps = useStore((s) => s.investigationSteps)
  const settings = useStore((s) => s.reactionSettings)
  const peptides = useStore((s) => s.peptides)

  return useMemo(() => {
    const scoreCache = new Map()
    const scoreOf = (rx) => {
      if (!scoreCache.has(rx.id)) scoreCache.set(rx.id, reactionScore(rx, checkins).score)
      return scoreCache.get(rx.id)
    }
    const positiveOf = (rx) => scoreOf(rx) >= RS_POSITIVE
    const nameOf = (id) => peptides.find((p) => p.id === id)?.name || id
    const controlStep = steps.find((s) => s.type === 'control')
    const controlDone = controlStep?.status === 'done'
    const ctx = { records, reactions, checkins, scoreOf, positiveOf }
    return {
      ...ctx,
      nameOf,
      controlDone,
      board: suspectBoard({ ...ctx, suspects: settings?.suspects || [], nameOf, controlDone }),
      steps,
      settings,
      peptides,
    }
  }, [records, reactions, checkins, steps, settings, peptides])
}

// ------------------------------------------------------------ suspect board

export function SuspectBoard({ onOpenStep }) {
  const a = useReactionAnalysis()
  const { board } = a
  const step = currentStep(a.steps)
  const remaining = step ? remainingForVerdict(step, { ...a, todayStr: todayStr() }) : 0

  if (!a.records.length) {
    return (
      <div className="card p-4" data-testid="suspect-board-empty">
        <p className="t-caption" style={{ color: 'var(--text-2)' }}>Suspects</p>
        <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Nothing logged yet. Log a few injections and this fills in with what the data actually shows —
          not before.
        </p>
      </div>
    )
  }

  const tone = { low: 'var(--text-3)', medium: 'var(--warn)', high: 'var(--good)' }[board.confidence.id]

  return (
    <div className="space-y-2" data-testid="suspect-board">
      <div className="card p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>Most likely</p>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-black" data-testid="confidence-badge"
            data-confidence={board.confidence.id}
            style={{ background: `color-mix(in srgb, ${tone} 18%, transparent)`, color: tone }}>
            {board.confidence.label} confidence
          </span>
        </div>

        {board.rows.slice(0, 2).map((r, i) => (
          <div key={r.id} className={i ? 'mt-3' : 'mt-1.5'} data-testid="suspect-row" data-suspect={r.id}>
            <div className="flex items-baseline gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-black">{r.name}</p>
              <p className="shrink-0 text-xs font-black tabular-nums" style={{ color: 'var(--text-2)' }}>
                {r.rate == null ? '—' : `${Math.round(r.rate * 100)}%`}
              </p>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunk)' }}>
              <div className="h-full rounded-full" data-testid="likelihood-bar"
                style={{ width: `${Math.round((r.rate || 0) * 100)}%`, background: i === 0 ? 'var(--danger)' : 'var(--warn)' }} />
            </div>
            <p className="mt-1 text-xs font-medium leading-relaxed" data-testid="suspect-evidence"
              style={{ color: 'var(--text-3)' }}>
              {r.evidence}
            </p>
          </div>
        ))}

        <p className="mt-2.5 text-xs font-bold" data-testid="verdict-line">
          {board.verdict}
          {step && <span style={{ color: 'var(--text-2)' }}> · next: {STEP_TYPES[step.type]?.name.toLowerCase()}</span>}
        </p>
        <p className="mt-0.5 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {board.confidence.words}
        </p>
      </div>

      {remaining > 0 && <CountdownRing remaining={remaining} step={step} ctx={a} />}

      {board.blocked.length > 0 && (
        <div className="card p-3" data-testid="confounding-detector"
          style={{ background: 'color-mix(in srgb, var(--warn) 12%, transparent)' }}>
          <p className="flex items-center gap-1.5 t-caption" style={{ color: 'var(--warn)' }}>
            <AlertTriangle size={12} /> Cannot be separated yet
          </p>
          {board.blocked.slice(0, 2).map((c, i) => (
            <div key={i} className="mt-1.5">
              <p className="text-xs font-bold">
                Can't separate {a.nameOf(c.a.value)} from {a.nameOf(c.b.value)} yet
              </p>
              <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
                They have only ever appeared together, across {c.n} injections. {c.fix.words}.
              </p>
              {onOpenStep && (
                <button onClick={() => onOpenStep(c.fix.step)} data-testid="confounding-fix"
                  className="mt-1 flex items-center gap-1 text-xs font-black" style={{ color: 'var(--info)' }}>
                  Go to that step <ArrowRight size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** "4 more injections until a verdict", drawn as a ring because it is a count. */
function CountdownRing({ remaining, step, ctx }) {
  const p = stepProgress(step, { ...ctx, todayStr: todayStr() })
  const done = p.required ? Math.min(1, p.n / p.required) : 0
  const R = 22
  const C = 2 * Math.PI * R
  return (
    <div className="card flex items-center gap-3 p-3" data-testid="verdict-countdown">
      <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0" aria-hidden="true">
        <circle cx="28" cy="28" r={R} fill="none" stroke="var(--surface-sunk)" strokeWidth="5" />
        <circle cx="28" cy="28" r={R} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${C * done} ${C}`} transform="rotate(-90 28 28)" />
        <text x="28" y="32" textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--text)">{remaining}</text>
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-black">
          {remaining} more injection{remaining === 1 ? '' : 's'} until a verdict
        </p>
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {p.n} of {p.required} logged for {STEP_TYPES[step?.type]?.name.toLowerCase()}
          {p.confounded > 0 ? ` · ${p.confounded} left out` : ''}
        </p>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ compare mode

export function CompareMode() {
  const a = useReactionAnalysis()
  const [factorId, setFactorId] = useState('compound')
  const groups = useMemo(() => groupsFor(factorId, a), [factorId, a])
  const [x, setX] = useState(null)
  const [y, setY] = useState(null)

  const av = x ?? groups[0]?.value ?? null
  const bv = y ?? groups[1]?.value ?? null
  const c = av && bv ? compare(factorId, av, bv, a) : null

  return (
    <div className="space-y-2" data-testid="compare-mode">
      <div className="flex flex-wrap gap-1.5">
        {FACTORS.filter((f) => groupsFor(f.id, a).length > 1).map((f) => (
          <button key={f.id} onClick={() => { setFactorId(f.id); setX(null); setY(null) }}
            data-testid="compare-factor" data-factor={f.id} data-on={factorId === f.id ? 'true' : 'false'}
            className="flex min-h-[30px] items-center rounded-full px-2.5 text-xs font-black"
            style={factorId === f.id
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {[[av, setX], [bv, setY]].map(([val, setter], i) => (
          <select key={i} className="input !w-auto min-w-0 flex-1 text-xs" value={val || ''}
            aria-label={`Compare ${i === 0 ? 'first' : 'second'}`} data-testid="compare-pick"
            onChange={(e) => setter(e.target.value)}>
            {groups.map((g) => (
              <option key={g.value} value={g.value}>{a.nameOf(g.value)}</option>
            ))}
          </select>
        ))}
      </div>

      {c && (
        <div className="card overflow-hidden" data-testid="compare-table">
          {[
            ['Injections', (g) => g.n],
            ['Reacted', (g) => `${g.positive}${g.rate == null ? '' : ` · ${Math.round(g.rate * 100)}%`}`],
            ['Average score', (g) => (g.meanRs == null ? '—' : g.meanRs)],
            ['Average duration', (g) => (g.meanDurationH == null ? '—' : `${Math.round(g.meanDurationH)} h`)],
          ].map(([label, get]) => (
            <div key={label} className="flex items-baseline gap-2 px-3 py-2"
              style={{ borderTop: '1px solid var(--border)' }} data-testid="compare-row">
              <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: 'var(--text-3)' }}>{label}</span>
              <span className="w-16 shrink-0 text-right text-xs font-black tabular-nums">{get(c.a)}</span>
              <span className="w-16 shrink-0 text-right text-xs font-black tabular-nums">{get(c.b)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- evidence

export function Evidence() {
  const a = useReactionAnalysis()
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => (open ? evidence(a) : []), [open, a])

  return (
    <div className="card overflow-hidden" data-testid="evidence">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="evidence-toggle"
        className="flex w-full items-center gap-2 px-3 py-3 text-left">
        {open ? <ChevronDown size={14} style={{ color: 'var(--text-3)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />}
        <span className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>See evidence</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden" data-testid="evidence-pane">
            <div className="space-y-3 p-3" style={{ borderTop: '1px solid var(--border)' }}>
              <CompareMode />
              <p className="t-caption pt-1" style={{ color: 'var(--text-2)' }}>Every variable</p>
              {rows.map(({ factor, groups }) => (
                <div key={factor.id} data-testid="evidence-factor" data-factor={factor.id}>
                  <p className="text-xs font-black">{factor.label}</p>
                  <div className="mt-1 space-y-0.5">
                    {groups.slice(0, 6).map((g) => (
                      <div key={g.value} className="flex items-baseline gap-2" data-testid="evidence-group">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                          {a.nameOf(g.value)}
                        </span>
                        <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: 'var(--text-2)' }}>
                          n {g.n} · {g.rate == null ? '—' : `${Math.round(g.rate * 100)}%`} · RS {g.meanRs ?? '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <EscalationList />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function EscalationList() {
  const a = useReactionAnalysis()
  const rows = useMemo(() => {
    const ids = [...new Set(a.records.flatMap((r) => [...(r.compoundIds || []), ...(r.componentIds || [])]))]
    return ids
      .map((id) => ({ id, name: a.nameOf(id), ...escalationFor(id, a) }))
      .filter((r) => r.escalating)
  }, [a])
  if (!rows.length) return null
  return (
    <div data-testid="escalation-list">
      <p className="text-xs font-black" style={{ color: 'var(--warn)' }}>Getting worse each time</p>
      {rows.map((r) => (
        <p key={r.id} className="text-xs font-medium tabular-nums" data-testid="escalation-row"
          data-compound={r.id} style={{ color: 'var(--text-3)' }}>
          {r.name}: {r.scores.slice(-3).join(' → ')}
        </p>
      ))}
    </div>
  )
}
