import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ShoppingCart, Check, Truck, AlertTriangle, Clock, Package, Wind, RotateCcw, Pencil,
} from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import { restockPlan, HORIZONS, DEFAULT_UNIT_COSTS } from '../lib/restock'
import { loadMatrix, LIB_TO_COMPOUND } from '../lib/mixMatrix'
import { formatDose, round } from '../lib/calc'
import CoachTip from './ui/CoachTip'

const money = (n) => `$${(Math.round((n || 0) * 100) / 100).toFixed(2)}`

const PRIORITY = {
  now: { label: 'Order now', tone: 'var(--coral)' },
  soon: { label: 'Coming up', tone: 'var(--amber)' },
  ok: { label: 'Covered', tone: 'var(--muted)' },
}

export default function RestockTab() {
  const peptides = useStore((s) => s.peptides)
  const titration = useStore((s) => s.titration)
  const vials = useStore((s) => s.vials)
  const openVials = useStore((s) => s.openVials)
  const restock = useStore((s) => s.restock)
  const leadDays = useStore((s) => s.settings.restockLeadDays)
  const setRestockHorizon = useStore((s) => s.setRestockHorizon)
  const resetRestock = useStore((s) => s.resetRestock)
  const t = todayStr()

  // The syringe count collapses co-draws, which needs the chemistry matrix.
  // Until it resolves each dose counts as its own syringe — the safe over-count,
  // and the UI says which of the two it is.
  const [matrix, setMatrix] = useState(null)
  useEffect(() => {
    let alive = true
    loadMatrix().then((m) => { if (alive) setMatrix(m) }).catch(() => { /* over-count stands */ })
    return () => { alive = false }
  }, [])

  const verdictOf = useMemo(() => {
    if (!matrix) return null
    return (a, b) => matrix.lookup(LIB_TO_COMPOUND[a] || a, LIB_TO_COMPOUND[b] || b)?.verdict || null
  }, [matrix])

  const plan = useMemo(
    () => restockPlan({ peptides, titration, vials, openVials, todayStr: t, restock, leadDays, verdictOf }),
    [peptides, titration, vials, openVials, t, restock, leadDays, verdictOf]
  )

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-black tracking-tight">Restock</h1>
        <p className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          What to order for {plan.label.toLowerCase()} — through {plan.until}
        </p>
      </div>

      <CoachTip id="restock-intro" tone="indigo">
        Counted from your actual schedule, not an average: doses that fall in an off-cycle stretch cost nothing,
        and a co-draw needs one syringe between them. Every quantity is editable.
      </CoachTip>

      {/* horizon */}
      <div className="flex gap-1.5">
        {HORIZONS.map((h) => (
          <button key={h.id} onClick={() => setRestockHorizon(h.id)}
            className="flex-1 rounded-lg py-2 text-[11px] font-black"
            style={plan.horizon === h.id
              ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
              : { background: 'var(--surface2)', color: 'var(--muted)' }}>
            {h.label}
          </button>
        ))}
      </div>

      {/* total */}
      <motion.div layout className="card p-4"
        style={{ backgroundImage: 'linear-gradient(135deg, color-mix(in srgb, var(--lime) 12%, var(--surface)), var(--surface))' }}>
        <div className="flex items-center gap-3">
          <ShoppingCart size={20} className="shrink-0" style={{ color: 'var(--lime)' }} />
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-black tracking-tight">{money(plan.totalAud)} <span className="text-sm">AUD</span></p>
            <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
              {money(plan.vialCost)} compounds · {money(plan.consumableCost)} consumables
            </p>
          </div>
        </div>
        {plan.orderNow.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs font-bold" style={{ color: 'var(--coral)' }}>
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              {plan.orderNow.length} item{plan.orderNow.length === 1 ? '' : 's'} to order now — within your {leadDays}-day lead time.
            </span>
          </p>
        )}
      </motion.div>

      {/* compounds */}
      <p className="px-1 pt-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>
        Compounds · soonest to run out first
      </p>
      {plan.rows.length === 0 && (
        <div className="card p-5 text-center text-sm font-bold" style={{ color: 'var(--muted)' }}>
          Nothing with a set protocol yet — build your schedule first.
        </div>
      )}
      {plan.rows.map((r) => <VialRow key={r.key} row={r} days={plan.days} />)}

      {/* consumables */}
      <p className="px-1 pt-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--amber)' }}>
        Consumables · {plan.consumables.syringes} syringe{plan.consumables.syringes === 1 ? '' : 's'} for {plan.consumables.injections} dose{plan.consumables.injections === 1 ? '' : 's'}
        {plan.consumables.grouped ? ' (co-draws counted as one)' : ' (co-draws not yet counted)'}
      </p>
      {plan.consumables.rows.map((r) => <ConsumableRow key={r.key} row={r} />)}

      <button onClick={resetRestock}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold"
        style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>
        <RotateCcw size={13} /> Clear ticks, quantities and delivery dates
      </button>

      <p className="px-1 pb-2 text-[10px] font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>
        Costs come from what you've recorded paying per vial, plus editable unit prices for consumables.
        Personal tracking tool — not medical advice, and not a purchasing recommendation.
      </p>
    </div>
  )
}

function Row({ children, checked, onToggle, checkLabel }) {
  return (
    <motion.div layout className="card p-3" style={checked ? { opacity: 0.6 } : undefined}>
      <div className="flex items-start gap-2.5">
        <button onClick={onToggle} aria-label={checkLabel}
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={checked
            ? { background: 'var(--lime)', color: '#0c1200' }
            : { background: 'var(--surface2)', color: 'var(--muted)' }}>
          {checked ? <Check size={14} strokeWidth={3} /> : null}
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </motion.div>
  )
}

function QtyStepper({ value, onChange, onReset, suggested }) {
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => onChange(Math.max(0, value - 1))}
        className="h-7 w-7 rounded-lg text-sm font-black" style={{ background: 'var(--surface2)' }} aria-label="One fewer">−</button>
      <span className="min-w-8 text-center text-sm font-black tabular-nums">{value}</span>
      <button onClick={() => onChange(value + 1)}
        className="h-7 w-7 rounded-lg text-sm font-black" style={{ background: 'var(--surface2)' }} aria-label="One more">+</button>
      {value !== suggested && (
        <button onClick={onReset} className="ml-1 text-[10px] font-bold underline" style={{ color: 'var(--muted)' }}>
          suggested {suggested}
        </button>
      )}
    </div>
  )
}

function DeliveryField({ value, onChange }) {
  const [open, setOpen] = useState(!!value)
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-[11px] font-bold" style={{ color: 'var(--indigo)' }}>
        <Truck size={12} /> Add expected delivery
      </button>
    )
  }
  return (
    <label className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: 'var(--indigo)' }}>
      <Truck size={12} className="shrink-0" />
      <input type="date" className="input !py-1 !text-[11px]" value={value || ''}
        aria-label="Expected delivery date"
        onChange={(e) => { onChange(e.target.value); if (!e.target.value) setOpen(false) }} />
    </label>
  )
}

function VialRow({ row, days }) {
  const restock = useStore((s) => s.restock)
  const setRestockQty = useStore((s) => s.setRestockQty)
  const clearRestockQty = useStore((s) => s.clearRestockQty)
  const toggleRestockChecked = useStore((s) => s.toggleRestockChecked)
  const setRestockDelivery = useStore((s) => s.setRestockDelivery)
  const checked = !!restock.checked?.[row.key]
  const eta = restock.delivery?.[row.key] || ''
  const pri = PRIORITY[row.priority]

  return (
    <Row checked={checked} onToggle={() => toggleRestockChecked(row.key)}
      checkLabel={`${checked ? 'Un-tick' : 'Tick'} ${row.name} as ordered`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-black">
            {row.nasal && <Wind size={12} style={{ color: 'var(--indigo)' }} />}
            <span className="truncate">{row.name}</span>
          </p>
          <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
            {row.doses} dose{row.doses === 1 ? '' : 's'} in {days} days at {formatDose(row.dose, row.unit)}
          </p>
        </div>
        <span className="chip shrink-0 !py-0.5 text-[10px] font-black" style={{ color: pri.tone }}>{pri.label}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1">
          <Package size={11} />
          {row.nasal ? `${row.spraysLeft} sprays left` : `${round(row.stockMg, 2)} mg on hand`}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={11} />
          {row.runOutDate ? `runs out ${row.runOutDate}` : 'no burn rate yet'}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <QtyStepper value={row.qty} suggested={row.suggestedVials}
          onChange={(n) => setRestockQty(row.key, n)} onReset={() => clearRestockQty(row.key)} />
        <span className="text-xs font-black tabular-nums">
          {row.unitCost > 0 ? money(row.qty * row.unitCost) : <span style={{ color: 'var(--muted)' }}>no price set</span>}
        </span>
      </div>

      <div className="mt-1.5">
        <DeliveryField value={eta} onChange={(d) => setRestockDelivery(row.key, d)} />
      </div>
    </Row>
  )
}

function ConsumableRow({ row }) {
  const restock = useStore((s) => s.restock)
  const setRestockQty = useStore((s) => s.setRestockQty)
  const clearRestockQty = useStore((s) => s.clearRestockQty)
  const toggleRestockChecked = useStore((s) => s.toggleRestockChecked)
  const setRestockUnitCost = useStore((s) => s.setRestockUnitCost)
  const setRestockDelivery = useStore((s) => s.setRestockDelivery)
  const checked = !!restock.checked?.[row.key]
  const [editing, setEditing] = useState(false)

  return (
    <Row checked={checked} onToggle={() => toggleRestockChecked(row.key)}
      checkLabel={`${checked ? 'Un-tick' : 'Tick'} ${row.label} as ordered`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black">{row.label}</p>
          <p className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
            suggested {row.suggestedVials} {row.unitLabel}
          </p>
        </div>
        <span className="text-xs font-black tabular-nums">{money(row.qty * row.unitCost)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <QtyStepper value={row.qty} suggested={row.suggestedVials}
          onChange={(n) => setRestockQty(row.key, n)} onReset={() => clearRestockQty(row.key)} />
        {editing ? (
          <label className="flex items-center gap-1 text-[11px] font-bold">
            $
            <input type="number" inputMode="decimal" step="0.01" className="input !w-20 !py-1 !text-[11px]"
              aria-label={`Unit cost for ${row.label}`}
              value={row.unitCost}
              onChange={(e) => setRestockUnitCost(row.id, parseFloat(e.target.value) || 0)}
              onBlur={() => setEditing(false)} autoFocus />
            each
          </label>
        ) : (
          <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-[11px] font-bold" style={{ color: 'var(--muted)' }}>
            <Pencil size={11} /> {money(row.unitCost)} each
            {row.unitCost === DEFAULT_UNIT_COSTS[row.id] ? ' (default)' : ''}
          </button>
        )}
      </div>
      <div className="mt-1.5">
        <DeliveryField value={restock.delivery?.[row.key] || ''} onChange={(d) => setRestockDelivery(row.key, d)} />
      </div>
    </Row>
  )
}
