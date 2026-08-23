import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  PackageOpen, AlertTriangle, ArrowRight, Trash2, Plus, CheckCircle2, Info,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import { replacementsFor, activationPreview } from '../lib/stock'
import { formatDose } from '../lib/calc'
import Modal from './ui/Modal'

const money = (n) => `$${Math.round((n || 0) * 100) / 100}`

/**
 * What happens after a vial runs out.
 *
 * Two honest outcomes and no third: put another vial in, or stop running this
 * compound. Leaving it in my protocol with nothing to draw from is the state that
 * produces a due dose you cannot take, so the screen does not offer it.
 *
 * Replacing with a different size is normal and handled: the dose, ladder and
 * cycle carry over untouched, the vial size follows the batch, and the units to
 * draw are recomputed. That change is shown before it is committed, because a
 * dose that silently becomes a different number of units is exactly the kind of
 * surprise this app exists to prevent.
 */
export default function ReplaceVial({ open, peptideId, onClose, goTo }) {
  const peptides = useStore((s) => s.peptides)
  const vials = useStore((s) => s.vials)
  const titration = useStore((s) => s.titration)
  const activateBatch = useStore((s) => s.activateBatch)
  const removePeptide = useStore((s) => s.removePeptide)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [done, setDone] = useState(null)

  const peptide = peptides.find((p) => p.id === peptideId)
  const options = useMemo(
    () => (peptideId ? replacementsFor(vials, peptideId) : []),
    [vials, peptideId]
  )

  if (!peptide) return null

  const close = () => { setConfirmRemove(false); setDone(null); onClose() }

  const pick = (batch) => {
    const preview = activationPreview(peptide, titration[peptide.id], batch)
    const ok = activateBatch(peptide.id, batch.id)
    if (ok) setDone({ batch, preview })
  }

  const drop = () => {
    // The vials you own stay on the shelf — you have stopped running this, not
    // thrown the boxes out. Stock lists it as "not in my protocol".
    removePeptide(peptide.id)
    close()
  }

  return (
    <Modal open={open} onClose={close} title={done ? 'New vial in use' : `${peptide.name} — finished`}>
      {done ? (
        <div className="space-y-3" data-testid="replace-done">
          <div className="rounded-2xl p-4 text-center"
            style={{ background: 'color-mix(in srgb, var(--lime) 14%, transparent)' }}>
            <CheckCircle2 size={26} className="mx-auto mb-1.5" style={{ color: 'var(--lime)' }} />
            <p className="text-sm font-black">
              {done.batch.vialMg} mg{done.batch.vendor ? ` · ${done.batch.vendor}` : ''} is now your active vial
            </p>
            <p className="mt-1 text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
              One taken off that batch. Your dose, ladder and cycle are unchanged.
            </p>
          </div>

          {done.preview && !done.preview.sameSize && (
            <div className="card p-3" data-testid="units-changed"
              style={{ background: 'color-mix(in srgb, var(--amber) 12%, var(--surface))' }}>
              <p className="flex items-start gap-2 text-[11px] font-semibold leading-relaxed">
                <AlertTriangle size={14} className="mt-px shrink-0" style={{ color: 'var(--amber)' }} />
                <span>
                  Different vial size, so the same dose is now a different draw.{' '}
                  <span className="font-black">
                    {formatDose(done.preview.dose, done.preview.unit)} was {done.preview.oldUnits} units,
                    now {done.preview.newUnits} units
                  </span>{' '}
                  ({done.preview.oldConc} → {done.preview.newConc} mg/mL in {done.preview.bacMl} mL).
                </span>
              </p>
            </div>
          )}

          <button onClick={close} className="btn-primary w-full rounded-full py-3 text-sm font-black">
            Done
          </button>
        </div>
      ) : confirmRemove ? (
        <div className="space-y-3" data-testid="confirm-remove">
          <p className="text-[12px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            <span className="font-black" style={{ color: 'var(--text)' }}>{peptide.name}</span> comes out of
            my protocol, so it stops appearing on Home and in the calendar.
          </p>
          <p className="flex items-start gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--lime)' }}>
            <Info size={13} className="mt-px shrink-0" />
            <span>Your vials stay in stock and your logged doses stay in history — you can put it back any time.</span>
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmRemove(false)}
              className="flex-1 rounded-full py-2.5 text-xs font-black"
              style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
              Cancel
            </button>
            <button onClick={drop} data-testid="confirm-remove-yes"
              className="flex-1 rounded-full py-2.5 text-xs font-black"
              style={{ background: 'color-mix(in srgb, var(--coral) 22%, transparent)', color: 'var(--coral)' }}>
              Remove from protocol
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="replace-view">
          <p className="text-[12px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            That vial is marked finished. Nothing else was taken off the shelf — picking a
            replacement below is what does that.
          </p>

          {options.length > 0 ? (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--lime)' }}>
                In stock · {options.length} batch{options.length === 1 ? '' : 'es'}
              </p>
              <div className="space-y-1.5" data-testid="replacement-options">
                {options.map((b) => {
                  const preview = activationPreview(peptide, titration[peptide.id], b)
                  return (
                    <button key={b.id} onClick={() => pick(b)} data-testid="replacement-option"
                      className="flex w-full items-center gap-2.5 rounded-full p-3 text-left"
                      style={{ background: 'var(--surface2)' }}>
                      <PackageOpen size={16} className="shrink-0" style={{ color: 'var(--lime)' }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-black">
                          {b.vialMg} mg{b.vendor ? ` · ${b.vendor}` : ''}
                        </p>
                        <p className="truncate text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
                          {b.qtyOnHand} sealed · {money(b.costAud)} each
                          {b.lot ? ` · lot ${b.lot}` : ''}
                        </p>
                        {preview && !preview.sameSize && (
                          <p className="mt-0.5 truncate text-[10px] font-bold" style={{ color: 'var(--amber)' }}>
                            {preview.oldUnits} → {preview.newUnits} units per dose
                          </p>
                        )}
                      </div>
                      <ArrowRight size={15} className="shrink-0" style={{ color: 'var(--muted)' }} />
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="card p-4 text-center" data-testid="no-stock"
              style={{ background: 'color-mix(in srgb, var(--coral) 10%, var(--surface))' }}>
              <AlertTriangle size={20} className="mx-auto mb-1.5" style={{ color: 'var(--coral)' }} />
              <p className="text-sm font-black">No {peptide.name} left in stock</p>
              <p className="mt-1 text-[11px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
                There is no sealed vial to fall back on. Add stock if you have some the app doesn't
                know about, or take it out of my protocol until you reorder.
              </p>
              <button onClick={() => { close(); goTo?.('supplies') }} data-testid="go-add-stock"
                className="btn-primary mt-3 flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-black">
                <Plus size={14} /> Add stock
              </button>
            </div>
          )}

          <div className="h-px" style={{ background: 'var(--border)' }} />

          <button onClick={() => setConfirmRemove(true)} data-testid="dont-replace"
            className="flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-black"
            style={{ background: 'var(--surface2)', color: 'var(--coral)' }}>
            <Trash2 size={13} /> Don't replace — take it out of my protocol
          </button>

          <p className="flex items-start gap-1.5 text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
            <Info size={12} className="mt-px shrink-0" />
            <span>
              A different vial size is fine — dosing carries over and the units to draw are
              recalculated from the new concentration.
            </span>
          </p>
        </div>
      )}
    </Modal>
  )
}
