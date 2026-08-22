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
        <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Your record — every dose, site and co-draw
        </p>
      </div>

      {/* window picker */}
      <div className="flex gap-1.5">
        {WINDOWS.map((w) => (
          <button key={w.id} onClick={() => setDays(w.id)}
            className="flex-1 rounded-lg py-1.5 text-xs font-black"
            style={days === w.id
              ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
              : { background: 'var(--surface2)', color: 'var(--muted)' }}>
            {w.label}
          </button>
        ))}
      </div>

      {/* adherence */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">Adherence</p>
          <span className="text-2xl font-black tabular-nums"
            style={{ color: pct == null ? 'var(--muted)' : pct >= 80 ? 'var(--lime)' : pct >= 50 ? 'var(--amber)' : 'var(--coral)' }}>
            {pct == null ? '—' : `${pct}%`}
          </span>
        </div>
        <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
          {summary.overall.taken} of {summary.overall.scheduled} scheduled doses · last {days} days
        </p>
        {split.skipped > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] font-bold" data-testid="skip-summary">
            <span className="flex items-center gap-1" style={{ color: 'var(--violet)' }}>
              <SkipForward size={11} /> {split.skipped} skipped
            </span>
            <span style={{ color: 'var(--muted)' }}>·</span>
            <span style={{ color: 'var(--muted)' }}>{split.missed} missed</span>
            {split.ofAttempted != null && (
              <>
                <span style={{ color: 'var(--muted)' }}>·</span>
                <span style={{ color: 'var(--lime)' }}>{split.ofAttempted}% of what you attempted</span>
              </>
            )}
          </p>
        )}
        {summary.rows.length > 0 ? (
          <div className="mt-3 space-y-2">
            {summary.rows.map((r) => (
              <div key={r.peptideId}>
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span>{r.name}</span>
                  <span className="tabular-nums" style={{ color: 'var(--muted)' }}>
                    {skippedPerPeptide[r.peptideId] > 0 && (
                      <span style={{ color: 'var(--violet)' }}>{skippedPerPeptide[r.peptideId]} skipped · </span>
                    )}
                    {r.taken}/{r.scheduled} · {r.pct}%
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface2)' }}>
                  <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${r.pct}%` }}
                    style={{ background: r.pct >= 80 ? 'var(--lime)' : r.pct >= 50 ? 'var(--amber)' : 'var(--coral)' }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs font-medium" style={{ color: 'var(--muted)' }}>
            Nothing scheduled in this window yet.
          </p>
        )}
      </div>

      {/* skipped — listed, not hidden: the record is the point */}
      {skipRows.length > 0 && (
        <div className="card p-4" data-testid="skip-list">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
            <SkipForward size={14} style={{ color: 'var(--violet)' }} /> Skipped · {skipRows.length}
          </p>
          <div className="space-y-1.5">
            {skipRows.slice(0, 12).map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-2 text-[11px] font-bold">
                <span className="min-w-0 flex-1 truncate">{k.name || k.peptideId || k.supplementId}</span>
                <span className="shrink-0 font-semibold" style={{ color: 'var(--muted)' }}>
                  {k.reason ? `${REASON_LABEL[k.reason] || k.reason} · ` : ''}{format(parseISO(k.date), 'd MMM')}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
            Recorded as a decision, not a lapse — and nothing came out of stock for these.
          </p>
        </div>
      )}

      {/* supplements — counted separately from injections, on purpose */}
      {supps.rows.length > 0 && (
        <div className="card p-4" data-testid="supplement-adherence">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <Pill size={14} style={{ color: 'var(--amber)' }} /> Supplements
            </p>
            <span className="text-2xl font-black tabular-nums"
              style={{ color: supps.overall.pct == null ? 'var(--muted)' : supps.overall.pct >= 80 ? 'var(--lime)' : supps.overall.pct >= 50 ? 'var(--amber)' : 'var(--coral)' }}>
              {supps.overall.pct == null ? '—' : `${supps.overall.pct}%`}
            </span>
          </div>
          <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
            {supps.overall.taken} of {supps.overall.scheduled} daily doses · last {days} days
          </p>
          <div className="mt-3 space-y-2">
            {supps.rows.map((r) => (
              <div key={r.supplementId}>
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 tabular-nums" style={{ color: 'var(--muted)' }}>{r.taken}/{r.scheduled} · {r.pct}%</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface2)' }}>
                  <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${r.pct}%` }}
                    style={{ background: r.pct >= 80 ? 'var(--lime)' : r.pct >= 50 ? 'var(--amber)' : 'var(--coral)' }} />
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
        className="btn-violet flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black">
        <FileText size={16} /> Shareable summary
      </button>
      <p className="-mt-2 px-1 text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
        Opens a clean printable page — save as PDF to hand to a doctor or coach.
      </p>

      {/* peptide filter */}
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          <Filter size={11} /> Filter
        </p>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <button onClick={() => setPeptideId(null)}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
            style={!peptideId
              ? { backgroundImage: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#0c1200' }
              : { background: 'var(--surface2)', color: 'var(--muted)' }}>
            All
          </button>
          {peptides.map((p) => (
            <button key={p.id} onClick={() => setPeptideId(p.id)}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
              style={peptideId === p.id
                ? { backgroundImage: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#0c1200' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* log */}
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <History size={15} style={{ color: 'var(--lime)' }} /> {events.length} injection{events.length === 1 ? '' : 's'}
        </p>
        {events.length === 0 && (
          <div className="card p-6 text-center text-sm font-medium" style={{ color: 'var(--muted)' }}>
            No doses logged in this window.
          </div>
        )}
        {events.map((ev, i) => (
          <motion.div key={ev.key} className="card p-3"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-black">{format(parseISO(ev.date), 'EEE d MMM')}</span>
                  {ev.coDraw && (
                    <span className="rounded-md px-1.5 py-0.5 text-[9px] font-black"
                      style={{ background: 'color-mix(in srgb, var(--violet) 20%, transparent)', color: 'var(--violet)' }}>
                      <Syringe size={9} className="mr-0.5 inline" />CO-DRAW · {ev.items.length}
                    </span>
                  )}
                </div>
                <div className="mt-1 space-y-0.5">
                  {ev.items.map((it) => (
                    <p key={it.logId} className="text-[11px] font-semibold">
                      {it.name}
                      <span className="font-medium" style={{ color: 'var(--muted)' }}>
                        {' '}· {formatDose(it.doseValue, it.unit)}{it.insulinUnits ? ` · ${it.insulinUnits} u` : ''}
                      </span>
                    </p>
                  ))}
                </div>
                {ev.siteLabel && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] font-bold" style={{ color: 'var(--lime)' }}>
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
