import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Droplets, AlertTriangle, DollarSign, Trash2, ChevronRight } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import useStore, { todayStr } from '../store/useStore'
import { runOutInfo, costPerDose, totalSpend, expiryInfo, vialsFor } from '../lib/inventory'
import { round } from '../lib/calc'

export default function InventoryTab({ goTo }) {
  const peptides = useStore((s) => s.peptides)
  const vials = useStore((s) => s.vials)
  const settings = useStore((s) => s.settings)
  const t = todayStr()

  const spend = useMemo(() => totalSpend(vials), [vials])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Stock</h1>
        <div className="chip !py-1.5" style={{ color: 'var(--amber)' }}>
          <DollarSign size={13} /> {round(spend, 0)} {settings.currency} total
        </div>
      </div>

      <button onClick={() => goTo?.('restock')}
        className="flex w-full items-center justify-between gap-2 rounded-xl p-3 text-left"
        style={{ background: 'color-mix(in srgb, var(--coral) 12%, var(--surface))', border: '1px solid var(--border)' }}>
        <span className="min-w-0">
          <span className="block text-sm font-black">Restock list</span>
          <span className="block text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
            What to order for the next cycle, with syringes and consumables
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0" style={{ color: 'var(--muted)' }} />
      </button>
      {peptides.map((p, i) => <StockCard key={p.id} peptide={p} index={i} today={t} />)}
    </div>
  )
}

function StockCard({ peptide: p, index, today }) {
  const vials = useStore((s) => s.vials)
  const titration = useStore((s) => s.titration)
  const openVials = useStore((s) => s.openVials)
  const settings = useStore((s) => s.settings)
  const addVial = useStore((s) => s.addVial)
  const updateVial = useStore((s) => s.updateVial)
  const removeVial = useStore((s) => s.removeVial)
  const reconstituteVial = useStore((s) => s.reconstituteVial)
  const [expanded, setExpanded] = useState(false)

  const mine = vialsFor(vials, p.id)
  const open = openVials[p.id]
  const ro = runOutInfo(p, titration[p.id], vials, open, today)
  const cpd = costPerDose(p, titration[p.id], vials)
  const exp = expiryInfo(p, open, today)
  const low = isFinite(ro.daysLeft) && ro.daysLeft <= settings.restockLeadDays

  return (
    <motion.div layout className="card p-4"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}
      style={low ? { borderColor: 'color-mix(in srgb, var(--amber) 40%, transparent)' } : undefined}>
      <button className="w-full text-left" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-bold">{p.name}</h3>
          {low && (
            <span className="chip" style={{ color: 'var(--amber)' }}>
              <AlertTriangle size={12} /> restock
            </span>
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <Stat label="on hand" value={`${round(ro.mg, 1)} mg`} />
          <Stat label="runs out" value={isFinite(ro.daysLeft) ? `~${ro.daysLeft}d` : '—'} sub={ro.runOutDate ? format(parseISO(ro.runOutDate), ro.daysLeft > 300 ? 'MMM yyyy' : 'd MMM') : ''} warn={low} />
          <Stat label="cost/dose" value={cpd != null ? `$${round(cpd, 2)}` : '—'} />
        </div>
        {exp && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold"
            style={{ color: exp.daysLeft < 0 ? 'var(--coral)' : exp.daysLeft <= 5 ? 'var(--amber)' : 'var(--muted)' }}>
            <Droplets size={12} />
            Open vial ({round(open?.remainingMg ?? 0, 1)} mg left) — {exp.daysLeft < 0 ? `expired ${-exp.daysLeft}d ago` : `expires ${format(parseISO(exp.expiresAt), 'd MMM')} (${exp.daysLeft}d)`}
          </p>
        )}
        {!exp && open && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
            <Droplets size={12} /> Open vial: {round(open.remainingMg, 1)} mg — not reconstituted yet
          </p>
        )}
      </button>

      {!exp && (
        <button className="mt-2 rounded-lg px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--surface2)', color: 'var(--lime)' }}
          onClick={() => reconstituteVial(p.id)}>
          Mark reconstituted today → starts {p.recon.expiryDays}d fridge timer
        </button>
      )}

      {expanded && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          {mine.map((v) => (
            <div key={v.id} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2">
              <VField label="qty">
                <input type="number" className="input !px-2 !py-1.5 text-center" value={v.qtyOnHand} min="0" step="1"
                  onChange={(e) => updateVial(v.id, { qtyOnHand: Math.max(0, Math.round(+e.target.value || 0)) })} />
              </VField>
              <VField label="mg/vial">
                <input type="number" className="input !px-2 !py-1.5 text-center" value={v.vialMg}
                  onChange={(e) => updateVial(v.id, { vialMg: +e.target.value || 0 })} />
              </VField>
              <VField label={`cost (${settings.currency})`}>
                <input type="number" className="input !px-2 !py-1.5 text-center" value={v.costAud}
                  onChange={(e) => updateVial(v.id, { costAud: +e.target.value || 0 })} />
              </VField>
              <VField label="vendor">
                <input className="input !px-2 !py-1.5" value={v.vendor} placeholder="—"
                  onChange={(e) => updateVial(v.id, { vendor: e.target.value })} />
              </VField>
              <button className="pb-1" onClick={() => removeVial(v.id)} aria-label="Remove vial row">
                <Trash2 size={15} style={{ color: 'var(--coral)' }} />
              </button>
            </div>
          ))}
          <button className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold"
            style={{ background: 'var(--surface2)' }}
            onClick={() => addVial(p.id, { vialMg: p.recon.vialMg })}>
            <Plus size={13} /> Add vial purchase
          </button>
        </motion.div>
      )}
    </motion.div>
  )
}

function Stat({ label, value, sub, warn }) {
  return (
    <div className="rounded-xl py-2" style={{ background: 'var(--surface2)' }}>
      <p className="text-sm font-extrabold" style={warn ? { color: 'var(--amber)' } : undefined}>{value}</p>
      <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>{label}{sub ? ` · ${sub}` : ''}</p>
    </div>
  )
}

function VField({ label, children }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[9px] font-bold uppercase" style={{ color: 'var(--muted)' }}>{label}</span>
      {children}
    </label>
  )
}
