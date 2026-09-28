import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronDown, Plus, AlertTriangle, FlaskConical, CalendarClock } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import { prettyDate } from '../lib/schedule'
import {
  watchList, outOfRangeNow, panelsWithData, panelRows, retestDue,
  SEED_DISCLAIMER, DEFAULT_RETEST_DAYS,
} from '../lib/bloods'
import { MarkerRow } from './bloods/RangeBar'
import MarkerDetail from './bloods/MarkerDetail'
import AddTestSheet from './bloods/AddTestSheet'

/**
 * What the lab measured.
 *
 * Deliberately not a wall of numbers: seventy markers across fifteen visits is
 * a spreadsheet, and a spreadsheet is something you scroll past. So the screen
 * leads with the handful this protocol has a reason to watch, then anything
 * outside its interval whatever panel it lives in, and only then the full set —
 * folded away, in the order a report prints them.
 *
 * Nothing here interprets anything. It will say a number is outside the lab's
 * interval and which way it moved since last time; it will not say why, or what
 * to do about it, or which compound to blame. That reading belongs to a doctor
 * and the app is not qualified to pretend otherwise.
 */
export default function BloodsTab() {
  const bloods = useStore((s) => s.bloods)
  const peptides = useStore((s) => s.peptides)
  const t = todayStr()

  const [openPanels, setOpenPanels] = useState(() => new Set())
  const [marker, setMarker] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)

  const tests = bloods?.tests || []
  const custom = bloods?.customMarkers || []
  const overrides = bloods?.rangeOverrides || {}
  const ctx = { tests, custom, overrides }

  const watch = useMemo(() => watchList({ ...ctx, peptides }), [tests, custom, overrides, peptides]) // eslint-disable-line react-hooks/exhaustive-deps
  const flagged = useMemo(() => outOfRangeNow(ctx), [tests, custom, overrides]) // eslint-disable-line react-hooks/exhaustive-deps
  const panels = useMemo(() => panelsWithData({ tests, custom }), [tests, custom])
  const latest = tests.length ? tests[tests.length - 1] : null

  const togglePanel = (p) => setOpenPanels((prev) => {
    const next = new Set(prev)
    if (next.has(p)) next.delete(p); else next.add(p)
    return next
  })

  return (
    <div className="space-y-3" data-testid="bloods-tab">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight">Bloods</h1>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            What the lab measured, and how it has moved
          </p>
        </div>
        <span className="chip shrink-0 !py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>
          {tests.length} test{tests.length === 1 ? '' : 's'}
        </span>
      </div>

      {latest && (
        <div className="card p-3" data-testid="latest-test">
          <p className="t-caption" style={{ color: 'var(--text-2)' }}>Most recent</p>
          <p className="mt-0.5 text-sm font-black tabular-nums">{prettyDate(latest.date)}</p>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
            {latest.lab || 'lab not recorded'}
            {latest.ref ? ` · ref ${latest.ref}` : ''}
            {' · '}{Object.keys(latest.values || {}).length} markers
          </p>
          {latest.notes && (
            <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {latest.notes}
            </p>
          )}
        </div>
      )}

      <button onClick={() => setAdding(true)} data-testid="add-test"
        className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black">
        <Plus size={16} /> Add a test
      </button>

      {/* ------------------------------------------------ out of range */}
      {flagged.length > 0 && (
        <div className="card p-3" data-testid="out-of-range">
          <p className="flex items-center gap-1.5 t-caption" style={{ color: 'var(--warn)' }}>
            <AlertTriangle size={12} /> Outside the lab's interval · {flagged.length}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {flagged.map((r) => (
              <button key={r.marker.name} onClick={() => setMarker(r.marker.name)}
                data-testid="flagged-marker"
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold tabular-nums"
                style={{ background: 'var(--surface-sunk)', color: 'var(--warn)' }}>
                {r.marker.name} {r.latest.value}
                <span style={{ color: 'var(--text-3)' }}>{r.status === 'high' ? '↑' : '↓'}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
            Flagged against the interval printed on the report, nothing more. What any of it means is a
            question for your doctor.
          </p>
        </div>
      )}

      {/* ------------------------------------------------- watch list */}
      {watch.length > 0 && (
        <div className="space-y-2" data-testid="watch-list">
          <p className="px-1 t-caption" style={{ color: 'var(--text-2)' }}>
            Worth watching on this protocol
          </p>
          <div className="card rows overflow-hidden">
            {watch.map((row) => (
              <MarkerRow key={row.marker.name} row={row} compounds={row.compounds}
                onOpen={() => setMarker(row.marker.name)} />
            ))}
          </div>
          <p className="px-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
            These are the markers your compounds list as worth keeping an eye on. Appearing here is not a
            claim that anything has affected them.
          </p>
        </div>
      )}

      {/* ---------------------------------------------------- panels */}
      <p className="px-1 pt-1 t-caption" style={{ color: 'var(--text-2)' }}>All panels</p>
      <div className="space-y-2" data-testid="panels">
        {panels.map((panel) => (
          <Panel key={panel} panel={panel} open={openPanels.has(panel)} onToggle={() => togglePanel(panel)}
            ctx={ctx} todayStr={t} onOpenMarker={setMarker} />
        ))}
      </div>

      {tests.length > 0 && (
        <div className="space-y-2" data-testid="test-list">
          <p className="px-1 pt-1 t-caption" style={{ color: 'var(--text-2)' }}>Every test</p>
          <div className="card rows overflow-hidden">
            {[...tests].reverse().map((test) => (
              <button key={test.id} onClick={() => setEditing(test.id)} data-testid="test-row"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                <FlaskConical size={14} className="shrink-0" style={{ color: 'var(--text-3)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold tabular-nums">{prettyDate(test.date)}</span>
                  <span className="block truncate text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                    {test.lab || 'lab not recorded'} · {Object.keys(test.values || {}).length} markers
                    {test.attachment ? ' · report attached' : ''}
                  </span>
                </span>
                <ChevronRight size={15} className="shrink-0" style={{ color: 'var(--text-2)' }} />
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="px-1 pb-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
        {SEED_DISCLAIMER || 'Reference intervals are the lab’s.'} This is a personal tracking tool, not
        medical advice — it records what was measured and shows how it has moved, and interpreting any of it
        belongs to a doctor.
      </p>

      <MarkerDetail name={marker} open={!!marker} onClose={() => setMarker(null)} />
      <AddTestSheet open={adding} onClose={() => setAdding(false)} />
      <AddTestSheet open={!!editing} testId={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

/** One panel, folded away until it is asked for. */
function Panel({ panel, open, onToggle, ctx, todayStr: t, onOpenMarker }) {
  const setRetestInterval = useStore((s) => s.setRetestInterval)
  const intervals = useStore((s) => s.bloods?.retestIntervals || {})
  const rows = useMemo(() => panelRows(panel, ctx), [panel, ctx])
  const due = retestDue(panel, { ...ctx, intervals, todayStr: t })
  const measured = rows.filter((r) => r.latest)
  const flagged = measured.filter((r) => r.status === 'low' || r.status === 'high').length

  return (
    <div className="card overflow-hidden" data-testid="panel" data-panel={panel}>
      <button onClick={onToggle} aria-expanded={open} data-testid="panel-toggle"
        className="flex w-full items-center gap-3 p-3 text-left">
        {open ? <ChevronDown size={15} className="shrink-0" style={{ color: 'var(--text-2)' }} />
          : <ChevronRight size={15} className="shrink-0" style={{ color: 'var(--text-2)' }} />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{panel}</span>
          <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
            {measured.length} marker{measured.length === 1 ? '' : 's'}
            {flagged ? ` · ${flagged} outside` : ''}
            {due ? ` · last ${prettyDate(due.last)}` : ''}
          </span>
        </span>
        {flagged > 0 && (
          <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-black tabular-nums"
            style={{ background: 'color-mix(in srgb, var(--warn) 18%, transparent)', color: 'var(--warn)' }}>
            {flagged}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="rows" style={{ borderTop: '1px solid var(--border)' }}>
              {measured.map((row) => (
                <MarkerRow key={row.marker.name} row={row} onOpen={() => onOpenMarker(row.marker.name)} />
              ))}
              {measured.length === 0 && (
                <p className="px-3 py-3 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                  Nothing recorded in this panel yet.
                </p>
              )}
            </div>

            {/* how often this panel is meant to come round again — the app has
                no opinion on the number, it just holds the one you set */}
            <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderTop: '1px solid var(--border)' }}>
              <CalendarClock size={13} className="shrink-0" style={{ color: 'var(--text-3)' }} />
              <span className="min-w-0 flex-1 text-xs font-medium tabular-nums" data-testid="retest-line"
                style={{ color: due?.overdue ? 'var(--warn)' : 'var(--text-3)' }}>
                {due
                  ? due.overdue
                    ? `Retest was due ${prettyDate(due.due)}`
                    : `Retest due ${prettyDate(due.due)} · in ${due.daysLeft} days`
                  : 'No retest interval set'}
              </span>
              <select className="input !w-auto !py-1 text-xs" aria-label={`Retest interval for ${panel}`}
                data-testid="retest-interval"
                value={intervals[panel] ?? DEFAULT_RETEST_DAYS}
                onChange={(e) => setRetestInterval(panel, Number(e.target.value))}>
                {[90, 120, 180, 270, 365].map((d) => (
                  <option key={d} value={d}>{d === 365 ? 'yearly' : `${Math.round(d / 30)} months`}</option>
                ))}
              </select>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
