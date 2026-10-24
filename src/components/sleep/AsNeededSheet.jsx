import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import NumberField from '../ui/NumberField'
import PickerField from '../ui/PickerField'
import { asNeededInSlot, lastAmount } from '../../sleep/logging'

const pad = (n) => String(n).padStart(2, '0')
export const nowHhmm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

/** A clock time said now: today, or yesterday when it is still ahead of now (23:30 logged at 00:40). */
export function instantOf(hhmm, now = new Date()) {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  if (d.getTime() - now.getTime() > 5 * 60000) d.setDate(d.getDate() - 1)
  return d
}

const round = (v) => Math.round(v * 1000) / 1000

/**
 * The quick sheet for an as-needed item or a supplement taken in a variable
 * amount: pick the item, the amount (your last amount filled in, or empty),
 * the time (now unless changed), then Log.
 *
 * target: { kind: 'asNeeded', slot, itemId? } | { kind: 'supplement', id }
 */
export default function AsNeededSheet({ target, onClose }) {
  const items = useStore((s) => s.asNeededItems)
  const logs = useStore((s) => s.asNeededLogs)
  const supplements = useStore((s) => s.supplements)
  const suppLogs = useStore((s) => s.supplementLogs)
  const logAsNeeded = useStore((s) => s.logAsNeeded)
  const logSupplementAmount = useStore((s) => s.logSupplementAmount)
  const showToast = useStore((s) => s.showToast)
  const open = !!target
  const isSupp = target?.kind === 'supplement'
  const choices = useMemo(() => (isSupp ? [] : asNeededInSlot(items, target?.slot || 'PM')), [items, target, isSupp])
  const [itemId, setItemId] = useState(null)
  const [amount, setAmount] = useState(null)
  const [unit, setUnit] = useState(null)
  const [time, setTime] = useState(nowHhmm())

  const item = isSupp ? null : choices.find((i) => i.id === itemId) || null
  const supp = isSupp ? supplements.find((x) => x.id === target.id) : null
  const units = item ? item.units : supp ? [supp.amountUnit || 'g'] : []
  const step = item ? item.step : supp?.amountStep || 0.1

  // a fresh sheet: the first item (or the one asked for), its last amount, now
  useEffect(() => {
    if (!open) return
    const id = isSupp ? target.id : (target.itemId || choices[0]?.id || null)
    setItemId(isSupp ? null : id)
    const last = isSupp ? lastAmount(suppLogs, id) : lastAmount(logs, id)
    setAmount(last?.amount ?? null)
    setUnit(last?.unit || null)
    setTime(nowHhmm())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target])

  const pick = (id) => {
    setItemId(id)
    const last = lastAmount(logs, id)
    setAmount(last?.amount ?? null)
    setUnit(last?.unit || null)
  }
  const shownUnit = unit && units.includes(unit) ? unit : units[0]
  const bump = (dir) => setAmount((a) => Math.max(0, round((a || 0) + dir * step)))

  const save = () => {
    const at = instantOf(time).toISOString()
    if (isSupp) {
      const row = logSupplementAmount(supp.id, { amount, at })
      if (row) showToast(`${supp.name} ${row.amount} ${row.unit} logged`)
    } else if (item) {
      logAsNeeded(item.id, { amount, unit: shownUnit, at, source: 'phone' })
    }
    onClose()
  }
  const title = isSupp ? supp?.name || 'Log' : target?.slot === 'AM' ? 'As needed this morning' : 'As needed tonight'
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4" data-testid="as-needed-sheet">
        {!isSupp && (
          <div className="flex flex-wrap gap-1.5" data-testid="as-needed-items">
            {choices.map((i) => (
              <button key={i.id} type="button" onClick={() => pick(i.id)} aria-pressed={i.id === itemId} data-testid={`as-needed-item-${i.id}`}
                className="min-h-[36px] rounded-full px-3 text-sm font-bold"
                style={i.id === itemId ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {i.name}
              </button>
            ))}
          </div>
        )}
        <div>
          <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Amount</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => bump(-1)} aria-label="Less" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--surface-sunk)' }}><Minus size={18} /></button>
            <NumberField value={amount ?? ''} allowEmpty emptyValue={null} onChange={(v) => setAmount(v)} className="input text-center text-xl font-black tabular-nums"
              inputMode="decimal" aria-label="Amount" data-testid="as-needed-amount" placeholder="Amount" />
            <button type="button" onClick={() => bump(1)} aria-label="More" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--surface-sunk)' }}><Plus size={18} /></button>
          </div>
          <div className="mt-2 flex gap-1.5" data-testid="as-needed-units">
            {units.map((u) => (
              <button key={u} type="button" onClick={() => setUnit(u)} aria-pressed={u === shownUnit}
                className="min-h-[32px] rounded-full px-3 text-xs font-bold"
                style={u === shownUnit ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>{u}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Time</p>
          <PickerField kind="time" value={time} onChange={(v) => setTime(v || nowHhmm())} label="Time taken" clearable={false} testid="as-needed-time" />
        </div>
        <button type="button" onClick={save} disabled={!(amount > 0) || (!isSupp && !item)} data-testid="as-needed-log"
          className="btn-primary w-full rounded-full py-3 text-base font-black disabled:opacity-50">
          Log
        </button>
      </div>
    </Modal>
  )
}
