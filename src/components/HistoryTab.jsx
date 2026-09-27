import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { History, Syringe, FileText, Filter, CalendarArrowDown } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { adherenceSummary, historyEvents, WINDOWS, windowRange } from '../lib/adherence'
import { formatDose } from '../lib/calc'
import { SymptomHistory } from './SymptomsTab'
import { skipsInRange, splitAdherence } from '../lib/skips'
import { pushesInRange } from '../lib/pushes'
import CatchUpCard from './CatchUp'
import SummarySheet from './SummarySheet'
import { TenureTable, CompoundDetail, DoseSparkline, TenureLine } from './Tenure'
import { displayName } from '../lib/naming'

/**
 * What have I been on, for how long, at what doses, and how has the dose moved.
 *
 * That question is the page. It used to open with an adherence percentage,
 * which answers a different and much smaller one — whether you remembered to
 * press a button — and buried the dose history under supplement rates and a
 * list of days off. Adherence is still here, below, where a supporting figure
 * belongs.
 */
export default function HistoryTab() {
  const peptides = useStore((s) => s.peptides)
  const doseLogs = useStore((s) => s.doseLogs)
  const skips = useStore((s) => s.skips)
  const pushes = useStore((s) => s.pushes)
  const t = todayStr()

  const [days, setDays] = useState(30)
  const [peptideId, setPeptideId] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const { from, to } = useMemo(() => windowRange(days, t), [days, t])

  // pushes are handed in so a moved dose is not reported as a missed one
  const summary = useMemo(
    () => adherenceSummary(peptides, doseLogs, from, to, pushes),
    [peptides, doseLogs, from, to, pushes]
  )
  const events = useMemo(
    () => historyEvents(doseLogs, peptides, { peptideId, from, to }),
    [doseLogs, peptides, peptideId, from, to]
  )
  // Skips stay their own category wherever they are counted. A deliberate pause
  // is not the same failure as forgetting, and averaging them together would say
  // something untrue about a week somebody chose to take off.
  const skipRows = useMemo(() => skipsInRange(skips, from, to), [skips, from, to])
  const split = useMemo(() => splitAdherence({
    scheduled: summary.overall.scheduled,
    taken: summary.overall.taken,
    skipped: skipRows.filter((k) => k.kind === 'peptide').length,
  }), [summary, skipRows])

  // Doses moved rather than taken or skipped. Listed in their own right,
  // because after the week has passed "I put that one off three times" is a
  // thing the log should be able to say.
  const pushRows = useMemo(() => {
    const rows = pushesInRange(pushes, from, to)
    return peptideId ? rows.filter((x) => x.peptideId === peptideId) : rows
  }, [pushes, from, to, peptideId])

  const pct = summary.overall.pct
  const picked = peptideId ? peptides.find((p) => p.id === peptideId) : null

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-black tracking-tight">History</h1>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          What I've been on, for how long, and at what dose
        </p>
      </div>

      {/* A gap in the record is worth knowing about and is not an emergency.
          One quiet line with a way to close it. */}
      <CatchUpCard quiet />

      {/* the page */}
      <TenureTable onOpen={setDetailId} />

      <button onClick={() => setSummaryOpen(true)} data-testid="open-summary"
        className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black">
        <FileText size={16} /> Shareable summary
      </button>
      <p className="-mt-2 px-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        Opens here, leading with time on compound and dose history. Print or save it as a PDF from inside.
      </p>

      {/* ------------------------------------------------ secondary, below */}

      <p className="px-1 pt-2 t-caption" style={{ color: 'var(--text-2)' }}>The log</p>

      <div className="flex gap-2">
        {WINDOWS.map((w) => (
          <button key={w.id} onClick={() => setDays(w.id)}
            className="flex min-h-[40px] flex-1 items-center justify-center rounded-full text-xs font-black"
            style={days === w.id
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            {w.label}
          </button>
        ))}
      </div>

      {/* peptide filter */}
      <div>
        <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
          <Filter size={11} /> Filter
        </p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <button onClick={() => setPeptideId(null)}
            className="flex min-h-[40px] shrink-0 items-center rounded-full px-3 text-xs font-bold"
            style={!peptideId
              ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
              : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            All
          </button>
          {peptides.map((p) => (
            <button key={p.id} onClick={() => setPeptideId(p.id)}
              className="flex min-h-[40px] shrink-0 items-center rounded-full px-3 text-xs font-bold"
              style={peptideId === p.id
                ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              {displayName(p)}
            </button>
          ))}
        </div>
      </div>

      {/* the filtered compound in its own terms, which a flat event list cannot show */}
      {picked && (
        <button onClick={() => setDetailId(picked.id)} data-testid="history-compound"
          className="card flex w-full items-center gap-2 p-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{displayName(picked)}</span>
            <TenureLine peptide={picked} />
          </span>
          <DoseSparkline peptide={picked} width={72} height={18} />
        </button>
      )}

      {pushRows.length > 0 && (
        <div className="card p-3" data-testid="push-list">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>
            Pushed to the next day · {pushRows.length}
          </p>
          <div className="mt-2 space-y-1">
            {pushRows.slice(0, 12).map((x) => (
              <p key={x.id} className="flex items-center gap-2 text-xs font-medium tabular-nums leading-tight"
                data-testid="push-row" style={{ color: 'var(--text-2)' }}>
                <CalendarArrowDown size={11} className="shrink-0" style={{ color: 'var(--text-3)' }} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-bold" style={{ color: 'var(--text)' }}>{x.name || x.peptideId}</span>
                  {' · '}{format(parseISO(x.from), 'EEE d MMM')} → {format(parseISO(x.to), 'EEE d MMM')}
                </span>
              </p>
            ))}
          </div>
          <p className="mt-2 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
            Moved, not missed and not skipped — nothing came out of stock, and adherence counts the day the
            dose landed on rather than the one it left.
          </p>
        </div>
      )}

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
                  <span className="text-xs font-black tabular-nums">{format(parseISO(ev.date), 'EEE d MMM')}</span>
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
                      <span className="font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
                        {' '}· {formatDose(it.doseValue, it.unit)}{it.insulinUnits ? ` · ${it.insulinUnits} u` : ''}
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Adherence: a measure of whether you pressed a button, kept because it
          is worth knowing and demoted because it is not what this page is for. */}
      <div className="card p-3" data-testid="adherence-block">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">Adherence</p>
          <span className="text-2xl font-black tabular-nums"
            style={{ color: pct == null ? 'var(--text-2)' : pct >= 80 ? 'var(--good)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)' }}>
            {pct == null ? '—' : `${pct}%`}
          </span>
        </div>
        <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
          {summary.overall.taken} of {summary.overall.scheduled} scheduled doses · last {days} days
        </p>
        {/* the figure counts records, not history. Someone on a compound for a
            year and logging for a month should not read this as a year. */}
        <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }} data-testid="adherence-basis">
          Since logging began — it counts what you recorded, not how long you have been on anything.
        </p>
        {split.skipped > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs font-bold tabular-nums" data-testid="skip-summary">
            <span style={{ color: 'var(--text)' }}>{split.skipped} skipped</span>
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
        {summary.rows.length > 0 && (
          <div className="mt-3 space-y-2">
            {summary.rows.map((r) => (
              <div key={r.peptideId}>
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 tabular-nums" style={{ color: 'var(--text-2)' }}>
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
        )}
      </div>

      {/* symptoms — the 14-day heatmap lives here, not on the logging screen */}
      <SymptomHistory />

      <CompoundDetail peptideId={detailId} open={!!detailId} onClose={() => setDetailId(null)} />
      <SummarySheet open={summaryOpen} onClose={() => setSummaryOpen(false)} from={from} to={to} summary={summary} />
    </div>
  )
}
