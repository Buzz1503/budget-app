import { useEffect, useState } from 'react'
import { ArrowRight, Info } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import NumberField from './ui/NumberField'
import { currentRung, prettyDate, resolveDoseChange } from '../lib/schedule'
import { formatDose, formatUnitsLong, unitsFor, isNasal } from '../lib/calc'
import { displayName } from '../lib/naming'

/**
 * Change the dose, here, now.
 *
 * This used to mean walking back through Build / rebuild — six screens to
 * change one number, for the most ordinary edit in the app. Everything else
 * about the protocol stays where it is edited; this is the one field that
 * changes often enough to deserve its own door.
 *
 * The new dose is accepted whatever it is. If it does not land on a rung the
 * ladder is reshaped around it, because an app that refuses the number in the
 * syringe is an app that is now wrong about the syringe.
 */
export default function DoseChangeSheet({ peptideId, open, onClose }) {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const setDose = useStore((s) => s.setDose)
  const revertDose = useStore((s) => s.revertDose)
  const showToast = useStore((s) => s.showToast)

  const peptide = peptides.find((p) => p.id === peptideId)
  const rung = peptide ? currentRung(peptide, titration[peptideId]) : null
  const [value, setValue] = useState(rung?.dose ?? 0)
  const [reason, setReason] = useState('')

  // The sheet is mounted before it is ever opened, so its initial value was
  // read when there was no compound to read it from. Load the real dose each
  // time it opens instead — otherwise the field says 0 and "now → new" compares
  // the dose against nothing.
  useEffect(() => {
    if (!open) return
    setValue(rung?.dose ?? 0)
    setReason('')
  }, [open, peptideId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !peptide) return null

  const unit = peptide.ladder?.unit || 'mcg'
  const nasal = isNasal(peptide)
  const changed = Number(value) > 0 && Math.abs(Number(value) - rung.dose) > 1e-9
  const rungs = rung.rungs || []
  // What the store will actually do with this number, asked of the same
  // function that will do it — so the explanation cannot drift from the effect.
  const plan = changed ? resolveDoseChange(peptide.ladder, Number(value)) : null

  const save = () => {
    const change = setDose(peptide.id, Number(value), reason.trim())
    if (!change) return
    showToast(
      `${displayName(peptide)} now ${formatDose(change.to, unit)}`,
      () => revertDose(peptide.id, change),
    )
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={`${displayName(peptide)} — change dose`}>
      <div className="space-y-3" data-testid="dose-change-sheet">
        {/* where you are, and where you are going */}
        <div className="flex items-center gap-3 rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
          <span className="min-w-0 flex-1">
            <span className="t-caption block" style={{ color: 'var(--text-3)' }}>Now</span>
            <span className="t-metric-sm block tabular-nums">{formatDose(rung.dose, unit)}</span>
            {!nasal && (
              <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
                {formatUnitsLong(unitsFor(peptide, rung.dose))}
              </span>
            )}
          </span>
          <ArrowRight size={16} className="shrink-0" style={{ color: 'var(--text-3)' }} />
          <span className="min-w-0 flex-1 text-right">
            <span className="t-caption block" style={{ color: 'var(--text-3)' }}>New</span>
            <span className="t-metric-sm block tabular-nums" style={{ color: changed ? 'var(--good)' : 'var(--text-3)' }}>
              {Number(value) > 0 ? formatDose(Number(value), unit) : '—'}
            </span>
            {!nasal && Number(value) > 0 && (
              <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
                {formatUnitsLong(unitsFor(peptide, Number(value)))}
              </span>
            )}
          </span>
        </div>

        <label className="block">
          <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>
            New dose ({unit})
          </span>
          <NumberField value={value} min={0} aria-label="New dose"
            data-testid="new-dose" onChange={(v) => setValue(v ?? 0)} />
        </label>

        {/* the ladder's own steps, as one tap each */}
        {rungs.length > 1 && (
          <div className="flex flex-wrap gap-1.5" data-testid="dose-rungs">
            {rungs.map((r) => (
              <button key={r} onClick={() => setValue(r)}
                className="flex min-h-[36px] items-center rounded-full px-3 text-xs font-black tabular-nums"
                style={Math.abs(r - Number(value)) < 1e-9
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {formatDose(r, unit)}
              </button>
            ))}
          </div>
        )}

        {plan && !plan.onLadder && (
          <p className="flex items-start gap-2 rounded-[14px] p-3 text-xs font-medium leading-relaxed"
            data-testid="off-ladder" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            <Info size={13} className="mt-px shrink-0" />
            <span>
              {plan.raisedCeiling
                ? `That is above the top of the ladder, so the ceiling moves up to ${formatDose(Number(value), unit)}.`
                : plan.movedFloor
                  ? 'That is between the ladder’s steps, so it becomes the new bottom of the ladder — everything above it stays.'
                  : `This compound has no titration ladder, so ${formatDose(Number(value), unit)} simply becomes the dose.`}
            </span>
          </p>
        )}

        <label className="block">
          <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>Why (optional)</span>
          <input className="input" value={reason} aria-label="Reason" data-testid="dose-reason"
            placeholder="sides, plateau, doctor said…" onChange={(e) => setReason(e.target.value)} />
        </label>

        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
          Saved as a dose change on {prettyDate(todayStr())}. It lands on this compound's timeline, restarts
          time-at-this-dose, and units, vial draw-down and run-out all follow the new number. Nothing that is
          already logged changes.
        </p>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>Cancel</button>
          <button onClick={save} disabled={!changed} data-testid="dose-change-save"
            className="btn-primary flex-1 rounded-full py-3 text-xs font-black disabled:opacity-40">
            Change dose
          </button>
        </div>
      </div>
    </Modal>
  )
}
