import { useMemo, useState } from 'react'
import { Pencil, RotateCcw } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import NumberField from '../ui/NumberField'
import { prettyDate } from '../../lib/schedule'
import { displayName } from '../../lib/naming'
import { doseTimeline } from '../../lib/tenure'
import {
  markerByName, rangeOf, seriesFor, statusOf, fmtRange, deltaWords, deltaFor,
} from '../../lib/bloods'
import { RangeBar } from './RangeBar'
import MarkerChart from './MarkerChart'

/**
 * One marker, over everything that has been recorded of it.
 *
 * The reference interval is drawn as a band behind the line rather than as two
 * numbers beside it, so in and out is a thing you see rather than a thing you
 * work out. The compound overlay is the reason this screen exists: a marker
 * that moved is only interesting next to what you were taking when it moved.
 *
 * The overlay draws lines, and stops. It will not tell you a compound caused
 * anything — two events sharing a date is a coincidence until somebody
 * qualified says otherwise, and the app is not that.
 */
export default function MarkerDetail({ name, open, onClose }) {
  const bloods = useStore((s) => s.bloods)
  const peptides = useStore((s) => s.peptides)
  const doseEvents = useStore((s) => s.doseEvents)
  const runs = useStore((s) => s.runs)
  const setMarkerNote = useStore((s) => s.setMarkerNote)
  const setRangeOverride = useStore((s) => s.setRangeOverride)
  const clearRangeOverride = useStore((s) => s.clearRangeOverride)
  const t = todayStr()

  const [overlay, setOverlay] = useState(() => new Set())
  const [editRange, setEditRange] = useState(false)

  const tests = bloods?.tests || []
  const custom = bloods?.customMarkers || []
  const overrides = bloods?.rangeOverrides || {}
  const marker = name ? markerByName(name, custom) : null
  const range = marker ? rangeOf(marker, overrides) : null
  const series = useMemo(() => (name ? seriesFor(name, tests) : []), [name, tests])
  const delta = name ? deltaFor(name, tests) : null

  // Every compound event that could be drawn behind the line: when each one
  // started, stopped, or had its dose moved.
  const events = useMemo(() => {
    if (!series.length) return []
    const first = series[0].date
    const out = []
    for (const p of peptides) {
      const tl = doseTimeline(p, { doseEvents, runs, todayStr: t })
      for (const pt of tl.points) {
        if (pt.date < first) continue
        if (!['start', 'step-up', 'override', 'stop', 'prior'].includes(pt.kind)) continue
        out.push({ peptideId: p.id, name: displayName(p), date: pt.date, kind: pt.kind, to: pt.to, unit: pt.unit })
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  }, [peptides, doseEvents, runs, series, t])

  const overlayable = useMemo(() => {
    const ids = new Map()
    for (const e of events) if (!ids.has(e.peptideId)) ids.set(e.peptideId, e.name)
    return [...ids].map(([id, n]) => ({ id, name: n }))
  }, [events])

  if (!open || !marker) return null

  const latest = series.length ? series[series.length - 1] : null
  const note = bloods?.markerNotes?.[marker.name] || ''

  return (
    <Modal open onClose={onClose} title={marker.name} wide>
      <div className="space-y-3" data-testid="marker-detail" data-marker={marker.name}>
        {/* the number, and where it sits */}
        <div className="card p-3">
          <div className="flex items-baseline gap-2">
            <span className="t-metric tabular-nums"
              style={{ color: latest && statusOf(latest.value, range) !== 'in' ? 'var(--warn)' : 'var(--text)' }}>
              {latest ? latest.value : '—'}
            </span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-3)' }}>{marker.unit}</span>
          </div>
          <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
            {latest ? prettyDate(latest.date) : 'never measured'}
            {latest?.lab ? ` · ${latest.lab}` : ''}
          </p>
          {latest && <div className="mt-2"><RangeBar value={latest.value} range={range} height={8} /></div>}
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="min-w-0 flex-1 text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
              {marker.panel} · {fmtRange(range, marker.unit)}{range.edited ? ' · edited' : ''}
            </span>
            {delta && (
              <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: 'var(--text-2)' }}>
                {deltaWords(delta, prettyDate)}
              </span>
            )}
          </div>
        </div>

        {/* ------------------------------------------------- the graph */}
        {series.length >= 2 ? (
          <MarkerChart name={marker.name} series={series} range={range} events={events} today={t}
            overlay={overlay} overlayable={overlayable}
            onToggleOverlay={(id) => setOverlay((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id); else next.add(id)
              return next
            })} />
        ) : (
          <div className="card p-4" data-testid="marker-graph-empty">
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {series.length === 1
                ? 'Only one result so far — a second gives this a line to draw.'
                : 'Nothing recorded for this marker yet.'}
            </p>
          </div>
        )}

        {/* ------------------------------------------------ every value */}
        {series.length > 0 && (
          <div className="card overflow-hidden" data-testid="marker-table">
            <p className="px-3 pt-3 t-caption" style={{ color: 'var(--text-2)' }}>Every result</p>
            <div className="mt-1 rows">
              {[...series].reverse().map((s) => {
                const st = statusOf(s.value, range)
                return (
                  <div key={s.date} className="flex items-baseline gap-3 px-3 py-2"
                    data-testid="marker-value-row" data-status={st} data-date={s.date}>
                    <span className="shrink-0 text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }}>
                      {prettyDate(s.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                      {s.lab}
                    </span>
                    <span className="shrink-0 text-xs font-black tabular-nums"
                      style={{ color: st === 'in' ? 'var(--text)' : 'var(--warn)' }}>
                      {s.value}
                    </span>
                    <span className="w-8 shrink-0 text-right text-xs font-bold"
                      style={{ color: st === 'in' ? 'var(--good)' : 'var(--warn)' }}>
                      {st === 'in' ? 'in' : st === 'high' ? 'high' : st === 'low' ? 'low' : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ------------------------------------------ the lab's interval */}
        <div className="card p-3">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 t-caption" style={{ color: 'var(--text-2)' }}>Reference interval</p>
            <button onClick={() => setEditRange((v) => !v)} data-testid="edit-range"
              className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-black"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              <Pencil size={11} /> {editRange ? 'Done' : 'Edit'}
            </button>
          </div>
          {editRange ? (
            <div className="mt-2 space-y-2" data-testid="range-editor">
              <div className="flex gap-2">
                <label className="min-w-0 flex-1">
                  <span className="t-caption mb-1 block" style={{ color: 'var(--text-3)' }}>Low</span>
                  <NumberField value={range.low ?? ''} allowEmpty aria-label="Reference low"
                    onChange={(v) => setRangeOverride(marker.name, { refLow: v ?? null })} />
                </label>
                <label className="min-w-0 flex-1">
                  <span className="t-caption mb-1 block" style={{ color: 'var(--text-3)' }}>High</span>
                  <NumberField value={range.high ?? ''} allowEmpty aria-label="Reference high"
                    onChange={(v) => setRangeOverride(marker.name, { refHigh: v ?? null })} />
                </label>
              </div>
              {range.edited && (
                <button onClick={() => clearRangeOverride(marker.name)} data-testid="reset-range"
                  className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-black"
                  style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                  <RotateCcw size={12} /> Back to the lab's
                </button>
              )}
              <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Two labs running the same assay publish different intervals. The one that counts is the one
                printed on your report.
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm font-bold tabular-nums">{fmtRange(range, marker.unit)}</p>
          )}
        </div>

        {marker.note && (
          <p className="px-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {marker.note}
          </p>
        )}

        <div>
          <p className="mb-1 t-caption" style={{ color: 'var(--text-2)' }}>My notes</p>
          <textarea className="input min-h-[64px] resize-y" value={note} aria-label="My notes on this marker"
            data-testid="marker-note" placeholder="Anything you want to remember about this one…"
            onChange={(e) => setMarkerNote(marker.name, e.target.value)} />
        </div>

        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
          Personal tracking record, not medical advice. Interpreting a result belongs to a doctor.
        </p>
      </div>
    </Modal>
  )
}
