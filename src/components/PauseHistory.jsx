import { useState } from 'react'
import { Pause, Play, Trash2, ChevronRight } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import {
  pauseHistory, pausesFor, pauseEnd, pausedDays, pauseLength,
  reasonWords, scopeWords, pauseDates,
} from '../lib/pauses'

/**
 * Every break there has been.
 *
 * Kept rather than cleared on resume, because a fortnight off in October is
 * still a fact about October afterwards — and it is the fact that explains a
 * thin patch in the adherence figure, a vial that lasted longer than it should
 * have, and a blood test whose numbers moved for reasons that had nothing to do
 * with the compound.
 *
 * `peptideId` narrows it to the breaks that touched one compound; without it,
 * the lot.
 */
export default function PauseHistory({ peptideId = null, max = null, compact = false }) {
  const pauses = useStore((s) => s.pauses)
  const peptides = useStore((s) => s.peptides)
  const removePause = useStore((s) => s.removePause)
  const endPause = useStore((s) => s.endPause)
  const showToast = useStore((s) => s.showToast)
  const restorePause = useStore((s) => s.restorePause)
  const t = todayStr()
  const [confirm, setConfirm] = useState(null)

  const all = peptideId ? pausesFor(pauses, peptideId) : pauseHistory(pauses)
  const rows = max ? all.slice(0, max) : all

  if (!rows.length) {
    return compact ? null : (
      <p className="px-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
        No breaks recorded. Pausing keeps a holiday or a run of bad luck out of your adherence figure,
        and out of the calendar as a fortnight of red.
      </p>
    )
  }

  return (
    <div className="card rows overflow-hidden" data-testid="pause-history">
      {rows.map((p) => {
        const running = !pauseEnd(p)
        const len = pauseLength(p) ?? pausedDays(p, t)
        return (
          <div key={p.id} className="px-3 py-2.5" data-testid="pause-row" data-reason={p.reason}
            data-running={running ? 'true' : 'false'}>
            <div className="flex items-start gap-2.5">
              {running
                ? <Pause size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }} />
                : <Play size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--text-3)' }} />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold">
                  {reasonWords(p)}
                  {running && <span className="ml-1.5 font-black" style={{ color: 'var(--warn)' }}>· running</span>}
                </p>
                <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
                  {pauseDates(p)} · {len} day{len === 1 ? '' : 's'} · {scopeWords(p, peptides)}
                </p>
                {p.note && (
                  <p className="mt-0.5 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
                    {p.note}
                  </p>
                )}
              </div>
              {running ? (
                <button onClick={() => {
                  const r = endPause(p.id)
                  if (r) showToast('Back on the protocol', () => restorePause(r.removed ? r.pause : { ...r.pause, endedOn: null }))
                }} data-testid="pause-row-resume"
                  className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-black"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                  Resume
                </button>
              ) : (
                <button onClick={() => setConfirm(confirm === p.id ? null : p.id)}
                  aria-label="Remove this pause" data-testid="pause-row-remove"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'var(--surface-sunk)', color: 'var(--text-3)' }}>
                  <Trash2 size={11} />
                </button>
              )}
            </div>

            {confirm === p.id && (
              <div className="mt-2 flex items-center gap-2" data-testid="pause-remove-confirm">
                <p className="min-w-0 flex-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                  Those days go back to counting as missed.
                </p>
                <button onClick={() => { removePause(p.id); setConfirm(null); showToast('Pause removed') }}
                  data-testid="pause-row-remove-yes"
                  className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-black"
                  style={{ background: 'color-mix(in srgb, var(--danger) 22%, transparent)', color: 'var(--danger)' }}>
                  Remove
                </button>
              </div>
            )}
          </div>
        )
      })}
      {max && all.length > max && (
        <p className="flex items-center gap-1 px-3 py-2 text-xs font-bold" style={{ color: 'var(--text-3)' }}>
          {all.length - max} more <ChevronRight size={11} />
        </p>
      )}
    </div>
  )
}
