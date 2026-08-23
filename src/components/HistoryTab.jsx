import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { History, Syringe, MapPin, FileText, Filter, Pill, SkipForward } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { adherenceSummary, historyEvents, WINDOWS, windowRange } from '../lib/adherence'
import { formatDose } from '../lib/calc'
import { openSummaryDocument } from '../lib/summaryDoc'
import { SymptomHistory } from './SymptomsTab'
import { supplementAdherence } from '../lib/supplements'
import { skipsInRange, skipCounts, splitAdherence, REASON_LABEL } from '../lib/skips'

export default function HistoryTab() {
  const peptides = useStore((s) => s.peptides)
  const doseLogs = useStore((s) => s.doseLogs)
  const titration = useStore((s) => s.titration)
  const measurements = useStore((s) => s.measurements)
  const supplements = useStore((s) => s.supplements)
  const supplementLogs = useStore((s) => s.supplementLogs)
  const skips = useStore((s) => s.skips)
  const t = todayStr()

  const [days, setDays] = useState(30)
  const [peptideId, setPeptideId] = useState(null)
  const { from, to } = useMemo(() => windowRange(days, t), [days, t])

  const summary = useMemo(
    () => adherenceSummary(peptides, doseLogs, from, to),
    [peptides, doseLogs, from, to]
  )
  const events = useMemo(
    () => historyEvents(doseLogs, peptides, { peptideId, from, to }),
    [doseLogs, peptides, peptideId, from, to]
  )
  // Kept as its own figure rather than folded into the injection rate: one is
  // a needle and the other is a capsule, and averaging them hides both.
  const supps = useMemo(
    () => supplementAdherence(supplements, supplementLogs, from, to),
    [supplements, supplementLogs, from, to]
  )
  // Skips are reported as their own category. A deliberate pause is not the
  // same failure as forgetting, and averaging them together would tell the user
  // something untrue about a week they chose to take off.
  const skipRows = useMemo(() => skipsInRange(skips, from, to), [skips, from, to])
  const skippedPerPeptide = useMemo(() => skipCounts(skips, from, to), [skips, from, to])
  const split = useMemo(() => splitAdherence({
    scheduled: summary.overall.scheduled,
    taken: summary.overall.taken,
    skipped: skipRows.filter((k) => k.kind === 'peptide').length,
  }), [summary, skipRows])

  const pct = summary.overall.pct

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-black tracking-tight">History</h1>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          Your record — every dose, site and co-draw
        </p>
      </div>

      {/* window picker */}
      <div className="flex gap-2">
        {WINDOWS.map((w) => (
          <button key={w.id} onClick={() => setDays(w.id)}
            className="flex-1 rounded-full py-2 text-xs font-black"
            style={days === w.id
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            {w.label}
          </button>
        ))}
      </div>

      {/* adherence */}
      <div className="card p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">Adherence</p>
          <span className="text-2xl font-black tabular-nums"
            style={{ color: pct == null ? 'var(--text-2)' : pct >= 80 ? 'var(--good)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)' }}>
            {pct == null ? '—' : `${pct}%`}
          </span>
        </div>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          {summary.overall.taken} of {summary.overall.scheduled} scheduled doses · last {days} days
        </p>
        {split.skipped > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs font-bold" data-testid="skip-summary">
            <span className="flex items-center gap-1" style={{ color: 'var(--text)' }}>
              <SkipForward size={11} /> {split.skipped} skipped
            </span>
            <span style={{ color: 'var(--text-2)' }}>·</span>
            <span style={{ color: 'var(--text-2)' }}>{split.missed} missed</span>
            {split.ofAttempted != null && (
              <>
                <span style={{ color: 'var(--text-2)' }}>·</span>
                <span style={{ color: 'var(--good)' }}>{split.ofAttempted}% of what you attempted</span>
              </>
            )}
          </p>
        )}
        {summary.rows.length > 0 ? (
          <div className="mt-3 space-y-2">
            {summary.rows.map((r) => (
              <div key={r.peptideId}>
                <div className="flex items-center justify-between text-xs font-bold">
                  <span>{r.name}</span>
                  <span className="tabular-nums" style={{ color: 'var(--text-2)' }}>
                    {skippedPerPeptide[r.peptideId] > 0 && (
                      <span style={{ color: 'var(--text)' }}>{skippedPerPeptide[r.peptideId]} skipped · </span>
                    )}
                    {r.taken}/{r.scheduled} · {r.pct}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunk)' }}>
                  <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${r.pct}%` }}
                    style={{ background: r.pct >= 80 ? 'var(--good)' : r.pct >= 50 ? 'var(--warn)' : 'var(--danger)' }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
            Nothing scheduled in this window yet.
          </p>
        )}
      </div>

      {/* skipped — listed, not hidden: the record is the point */}
      {skipRows.length > 0 && (
        <div className="card p-3" data-testid="skip-list">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold">
            <SkipForward size={14} style={{ color: 'var(--text)' }} /> Skipped · {skipRows.length}
          </p>
          <div className="space-y-2">
            {skipRows.slice(0, 12).map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-2 text-xs font-bold">
                <span className="min-w-0 flex-1 truncate leading-tight">{k.name || k.peptideId || k.supplementId}</span>
                <span className="shrink-0 font-semibold" style={{ color: 'var(--text-2)' }}>
                  {k.reason ? `${REASON_LABEL[k.reason] || k.reason} · ` : ''}{format(parseISO(k.date), 'd MMM')}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
            Recorded as a decision, not a lapse — and nothing came out of stock for these.
          </p>
        </div>
      )}

      {/* supplements — counted separately from injections, on purpose */}
      {supps.rows.length > 0 && (
        <div className="card p-3" data-testid="supplement-adherence">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Pill size={14} style={{ color: 'var(--warn)' }} /> Supplements
            </p>
            <span className="text-2xl font-black tabular-nums"
              style={{ color: supps.overall.pct == null ? 'var(--text-2)' : supps.overall.pct >= 80 ? 'var(--good)' : supps.overall.pct >= 50 ? 'var(--warn)' : 'var(--danger)' }}>
              {supps.overall.pct == null ? '—' : `${supps.overall.pct}%`}
            </span>
          </div>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            {supps.overall.taken} of {supps.overall.scheduled} daily doses · last {days} days
          </p>
          <div className="mt-3 space-y-2">
            {supps.rows.map((r) => (
              <div key={r.supplementId}>
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="min-w-0 flex-1 truncate leading-tight">{r.name}</span>
                  <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-2)' }}>{r.taken}/{r.scheduled} · {r.pct}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunk)' }}>
                  <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${r.pct}%` }}
                    style={{ background: r.pct >= 80 ? 'var(--good)' : r.pct >= 50 ? 'var(--warn)' : 'var(--danger)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* symptoms — the 14-day heatmap lives here, not on the logging screen */}
      <SymptomHistory />

      {/* shareable summary */}
      <button
        onClick={() => openSummaryDocument({ peptides, titration, doseLogs, measurements, summary, from, to })}
        className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black">
        <FileText size={16} /> Shareable summary
      </button>
      <p className="-mt-2 px-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        Opens a clean printable page — save as PDF to hand to a doctor or coach.
      </p>

      {/* peptide filter */}
      <div>
        <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
          <Filter size={11} /> Filter
        </p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <button onClick={() => setPeptideId(null)}
            className="shrink-0 rounded-full px-3 py-2 text-xs font-bold"
            style={!peptideId
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            All
          </button>
          {peptides.map((p) => (
            <button key={p.id} onClick={() => setPeptideId(p.id)}
              className="shrink-0 rounded-full px-3 py-2 text-xs font-bold"
              style={peptideId === p.id
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* log */}
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-bold">
          <History size={15} style={{ color: 'var(--good)' }} /> {events.length} injection{events.length === 1 ? '' : 's'}
        </p>
        {events.length === 0 && (
          <div className="card p-5 text-center text-sm font-medium" style={{ color: 'var(--text-2)' }}>
            No doses logged in this window.
          </div>
        )}
        {events.map((ev, i) => (
          <motion.div key={ev.key} className="card p-3"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black">{format(parseISO(ev.date), 'EEE d MMM')}</span>
                  {ev.coDraw && (
                    <span className="rounded-[10px] px-2 py-1 text-xs font-black"
                      style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
                      <Syringe size={9} className="mr-1 inline" />CO-DRAW · {ev.items.length}
                    </span>
                  )}
                </div>
                <div className="mt-1 space-y-1">
                  {ev.items.map((it) => (
                    <p key={it.logId} className="text-xs font-semibold">
                      {it.name}
                      <span className="font-medium" style={{ color: 'var(--text-2)' }}>
                        {' '}· {formatDose(it.doseValue, it.unit)}{it.insulinUnits ? ` · ${it.insulinUnits} u` : ''}
                      </span>
                    </p>
                  ))}
                </div>
                {ev.siteLabel && (
                  <p className="mt-1 flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--good)' }}>
                    <MapPin size={10} /> {ev.siteLabel}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
