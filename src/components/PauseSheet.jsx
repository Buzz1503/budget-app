import { useEffect, useMemo, useState } from 'react'
import { Pause, Check, CalendarClock } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import { prettyDate, addDaysStr } from '../lib/schedule'
import { displayName } from '../lib/naming'
import { PAUSE_REASONS } from '../lib/pauses'

/**
 * Stopping for a while, and saying why.
 *
 * The reason is asked for rather than optional because it is the whole
 * difference between a useful record and a gap. Two weeks with no doses tells
 * you nothing in six months' time; two weeks marked "out of stock" tells you
 * your reorder point is wrong, and two weeks marked "holiday" tells you not to
 * read anything into the bloods taken after it.
 *
 * Nothing here writes to the log or moves any stock. A pause is a statement
 * about the protocol, not about a dose.
 */
export default function PauseSheet({ open, onClose }) {
  const peptides = useStore((s) => s.peptides)
  const startPause = useStore((s) => s.startPause)
  const showToast = useStore((s) => s.showToast)
  const removePause = useStore((s) => s.removePause)
  const t = todayStr()

  const [reason, setReason] = useState('holiday')
  const [reasonText, setReasonText] = useState('')
  const [note, setNote] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [scope, setScope] = useState('all')
  const [picked, setPicked] = useState(() => new Set())

  useEffect(() => {
    if (!open) return
    setReason('holiday'); setReasonText(''); setNote('')
    setEndsOn(''); setScope('all'); setPicked(new Set())
  }, [open])

  const sorted = useMemo(
    () => [...peptides].sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [peptides]
  )

  if (!open) return null

  const needsText = reason === 'other' && !reasonText.trim()
  const needsPick = scope === 'some' && picked.size === 0
  const canSave = !needsText && !needsPick

  const save = () => {
    const id = startPause({
      reason, reasonText, note,
      endsOn: endsOn || null,
      peptideIds: scope === 'some' ? [...picked] : null,
    })
    if (!id) {
      showToast('Something is already paused — resume that first')
      return
    }
    showToast(
      scope === 'some' ? `${picked.size} paused` : 'Protocol paused',
      () => removePause(id),
    )
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="Pause the protocol" wide>
      <div className="space-y-3" data-testid="pause-sheet">
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Days inside a pause are not counted as missed and do not touch your stock. Log a dose during
          one if you take it — that records normally and the pause carries on.
        </p>

        {/* why */}
        <div>
          <p className="mb-1.5 t-caption" style={{ color: 'var(--text-2)' }}>Why</p>
          <div className="flex flex-wrap gap-1.5" data-testid="pause-reasons">
            {PAUSE_REASONS.map((r) => (
              <button key={r.id} onClick={() => setReason(r.id)} data-testid="pause-reason"
                data-reason={r.id} data-on={reason === r.id ? 'true' : 'false'}
                className="flex min-h-[36px] items-center rounded-full px-3 text-xs font-black"
                style={reason === r.id
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {r.label}
              </button>
            ))}
          </div>
          {reason === 'other' && (
            <input className="input mt-2" value={reasonText} autoFocus
              aria-label="Reason" data-testid="pause-reason-text" placeholder="Say what it is…"
              onChange={(e) => setReasonText(e.target.value)} />
          )}
        </div>

        <label className="block">
          <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>Note (optional)</span>
          <input className="input" value={note} aria-label="Note" data-testid="pause-note"
            placeholder="Anything worth remembering about it…"
            onChange={(e) => setNote(e.target.value)} />
        </label>

        {/* until when */}
        <div>
          <p className="mb-1.5 t-caption" style={{ color: 'var(--text-2)' }}>Until</p>
          <div className="flex items-center gap-2">
            <input type="date" className="input" value={endsOn} min={addDaysStr(t, 1)}
              aria-label="End date" data-testid="pause-ends-on"
              onChange={(e) => setEndsOn(e.target.value)} />
            {endsOn && (
              <button onClick={() => setEndsOn('')} data-testid="pause-clear-end"
                className="shrink-0 rounded-full px-3 py-2 text-xs font-black"
                style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                Clear
              </button>
            )}
          </div>
          <p className="mt-1 flex items-start gap-1.5 text-xs font-medium leading-relaxed"
            style={{ color: 'var(--text-3)' }}>
            <CalendarClock size={12} className="mt-px shrink-0" />
            {endsOn
              ? `Comes back on its own on ${prettyDate(addDaysStr(endsOn, 1))}.`
              : 'Leave it empty and it runs until you press Resume.'}
          </p>
        </div>

        {/* what */}
        <div>
          <p className="mb-1.5 t-caption" style={{ color: 'var(--text-2)' }}>What</p>
          <div className="flex gap-1.5" data-testid="pause-scope">
            {[['all', 'Everything'], ['some', 'Only some of it']].map(([id, label]) => (
              <button key={id} onClick={() => setScope(id)} data-testid="pause-scope-option"
                data-scope={id} data-on={scope === id ? 'true' : 'false'}
                className="flex-1 rounded-full py-2.5 text-xs font-black"
                style={scope === id
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {label}
              </button>
            ))}
          </div>

          {scope === 'some' && (
            <div className="card rows mt-2 overflow-hidden" data-testid="pause-picker">
              {sorted.map((p) => {
                const on = picked.has(p.id)
                return (
                  <button key={p.id} data-testid="pause-pick" data-compound={p.id}
                    data-on={on ? 'true' : 'false'}
                    onClick={() => setPicked((prev) => {
                      const next = new Set(prev)
                      if (next.has(p.id)) next.delete(p.id); else next.add(p.id)
                      return next
                    })}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                      style={on
                        ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                        : { background: 'var(--surface-sunk)' }}>
                      {on && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-bold">{displayName(p)}</span>
                  </button>
                )
              })}
              {sorted.length === 0 && (
                <p className="px-3 py-3 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
                  Nothing on the protocol to pause yet.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Cancel</button>
          <button onClick={save} disabled={!canSave} data-testid="pause-save"
            className="btn-primary flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-xs font-black disabled:opacity-40">
            <Pause size={13} /> Pause
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * The question a pause defers: a step-up that came due while nothing was
 * being taken.
 *
 * Asked on the way back in rather than applied on the way out, because the
 * interval between rungs is meant to be time at a dose and a fortnight not
 * taking it is not time at it. Either answer restarts the clock from today, so
 * this is not asked again tomorrow.
 */
export function HeldStepUpSheet({ peptideId, open, onClose }) {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const resolveHeldStepUp = useStore((s) => s.resolveHeldStepUp)
  const showToast = useStore((s) => s.showToast)
  const p = peptides.find((x) => x.id === peptideId)
  if (!open || !p) return null

  const answer = (take) => {
    const r = resolveHeldStepUp(p.id, take)
    showToast(r?.advanced ? `${displayName(p)} stepped up to ${r.to} ${p.ladder?.unit || ''}`.trim() : 'Held where it was')
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="A step-up was held">
      <div className="space-y-3" data-testid="held-step-up">
        <p className="text-sm font-bold leading-relaxed">
          {displayName(p)} was due to step up while the protocol was paused.
        </p>
        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          It stayed where it was, because the wait between rungs is meant to be time at the dose and
          those days were not. Take it now, or hold and start the interval again from today.
        </p>
        <div className="flex gap-2">
          <button onClick={() => answer(false)} data-testid="hold-step-up"
            className="flex-1 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            Hold for now
          </button>
          <button onClick={() => answer(true)} data-testid="take-step-up"
            className="btn-primary flex-1 rounded-full py-3 text-xs font-black">
            Step up
          </button>
        </div>
      </div>
    </Modal>
  )
}
