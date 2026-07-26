import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, ChevronDown, Trash2 } from 'lucide-react'
import useStore from '../store/useStore'
import { currentRung, cycleInfo } from '../lib/schedule'
import { formatDose } from '../lib/calc'
import Modal from './ui/Modal'

const FREQ_LABELS = {
  daily: 'Daily', nightly: 'Nightly', weekly: 'Weekly', '3xweek': '3×/week', '5on2off': '5 on / 2 off',
}

function cycleLabel(p) {
  if (!p.cycleOnDays || !p.cycleOffDays) return 'Ongoing'
  const f = (d) => (d % 7 === 0 ? `${d / 7} wk` : `${d} d`)
  return `${f(p.cycleOnDays)} on / ${f(p.cycleOffDays)} off`
}

export default function Library() {
  const peptides = useStore((s) => s.peptides)
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Library</h1>
        <motion.button whileTap={{ scale: 0.92 }} onClick={() => setAdding(true)}
          className="btn-violet flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-bold">
          <Plus size={16} /> Add
        </motion.button>
      </div>
      {peptides.map((p, i) => <PeptideCard key={p.id} peptide={p} index={i} />)}
      <AddPeptideModal open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function PeptideCard({ peptide: p, index }) {
  const titration = useStore((s) => s.titration)
  const [open, setOpen] = useState(false)
  const { dose, level, maxLevel } = currentRung(p, titration[p.id])

  return (
    <motion.div layout className="card overflow-hidden"
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, delay: index * 0.03 }}>
      <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(!open)}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold">{p.name}</h3>
            <span className="chip" style={{ color: 'var(--violet)' }}>Lvl {level + 1}/{maxLevel + 1}</span>
          </div>
          <p className="mt-1 text-sm font-semibold">
            {formatDose(dose, p.ladder.unit)}
            <span className="font-medium" style={{ color: 'var(--muted)' }}>
              {' '}· {FREQ_LABELS[p.frequency] || p.frequency} · {p.timing} · {p.route}
            </span>
          </p>
          <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{cycleLabel(p)}</p>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }}><ChevronDown size={18} style={{ color: 'var(--muted)' }} /></motion.div>
      </button>
      {open && <PeptideEditor peptide={p} />}
    </motion.div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>{label}</span>
      {children}
    </label>
  )
}

function Num({ value, onChange, step = 'any', min = 0 }) {
  return (
    <input type="number" inputMode="decimal" className="input" value={value} step={step} min={min}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
  )
}

export function PeptideEditor({ peptide: p }) {
  const updatePeptide = useStore((s) => s.updatePeptide)
  const updateLadder = useStore((s) => s.updateLadder)
  const updateRecon = useStore((s) => s.updateRecon)
  const removePeptide = useStore((s) => s.removePeptide)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="overflow-hidden">
      <div className="space-y-3 border-t p-4" style={{ borderColor: 'var(--border)' }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className="input" value={p.name} onChange={(e) => updatePeptide(p.id, { name: e.target.value })} />
          </Field>
          <Field label="Timing">
            <input className="input" value={p.timing} onChange={(e) => updatePeptide(p.id, { timing: e.target.value })} />
          </Field>
          <Field label="Frequency">
            <select className="input" value={p.frequency} onChange={(e) => updatePeptide(p.id, { frequency: e.target.value })}>
              {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Start date">
            <input type="date" className="input" value={p.startDate} onChange={(e) => e.target.value && updatePeptide(p.id, { startDate: e.target.value })} />
          </Field>
          <Field label="Cycle on (days, 0 = ongoing)">
            <Num value={p.cycleOnDays} step="1" onChange={(v) => updatePeptide(p.id, { cycleOnDays: Math.round(v) })} />
          </Field>
          <Field label="Cycle off (days)">
            <Num value={p.cycleOffDays} step="1" onChange={(v) => updatePeptide(p.id, { cycleOffDays: Math.round(v) })} />
          </Field>
        </div>

        <p className="pt-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--violet)' }}>Titration ladder</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Floor (${p.ladder.unit})`}><Num value={p.ladder.floor} onChange={(v) => updateLadder(p.id, { floor: v })} /></Field>
          <Field label={`Step (${p.ladder.unit})`}><Num value={p.ladder.step} onChange={(v) => updateLadder(p.id, { step: v })} /></Field>
          <Field label="Interval (weeks)"><Num value={p.ladder.intervalWeeks} step="1" onChange={(v) => updateLadder(p.id, { intervalWeeks: Math.max(1, Math.round(v)) })} /></Field>
          <Field label={`Ceiling (${p.ladder.unit})`}><Num value={p.ladder.ceiling} onChange={(v) => updateLadder(p.id, { ceiling: v })} /></Field>
          <Field label="Unit">
            <select className="input" value={p.ladder.unit} onChange={(e) => updateLadder(p.id, { unit: e.target.value })}>
              <option value="mcg">mcg</option><option value="mg">mg</option>
            </select>
          </Field>
        </div>

        <p className="pt-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--lime)' }}>Reconstitution</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Vial (mg)"><Num value={p.recon.vialMg} onChange={(v) => updateRecon(p.id, { vialMg: v })} /></Field>
          <Field label="BAC water (mL)"><Num value={p.recon.bacMl} onChange={(v) => updateRecon(p.id, { bacMl: v })} /></Field>
          <Field label="Expiry (days)"><Num value={p.recon.expiryDays} step="1" onChange={(v) => updateRecon(p.id, { expiryDays: Math.round(v) })} /></Field>
        </div>

        {confirmDelete ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold" style={{ color: 'var(--coral)' }}>Delete {p.name} and all its logs?</span>
            <button className="rounded-lg px-3 py-1.5 font-bold" style={{ background: 'var(--coral)', color: '#fff' }}
              onClick={() => removePeptide(p.id)}>Delete</button>
            <button className="rounded-lg px-3 py-1.5 font-bold" style={{ background: 'var(--surface2)' }}
              onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        ) : (
          <button className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--coral)' }} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={13} /> Remove peptide
          </button>
        )}
      </div>
    </motion.div>
  )
}

function AddPeptideModal({ open, onClose }) {
  const addPeptide = useStore((s) => s.addPeptide)
  const [form, setForm] = useState({ name: '', floor: 100, step: 100, ceiling: 500, unit: 'mcg', vialMg: 10, bacMl: 2 })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target?.value ?? e })

  const submit = () => {
    if (!form.name.trim()) return
    addPeptide({
      name: form.name.trim(),
      ladder: { floor: +form.floor || 100, step: +form.step || 100, intervalWeeks: 1, ceiling: +form.ceiling || 500, unit: form.unit },
      recon: { vialMg: +form.vialMg || 10, bacMl: +form.bacMl || 2, expiryDays: 28 },
    })
    setForm({ name: '', floor: 100, step: 100, ceiling: 500, unit: 'mcg', vialMg: 10, bacMl: 2 })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Add peptide">
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={form.name} onChange={set('name')} placeholder="e.g. TB-500" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Floor dose"><input type="number" className="input" value={form.floor} onChange={set('floor')} /></Field>
          <Field label="Step"><input type="number" className="input" value={form.step} onChange={set('step')} /></Field>
          <Field label="Ceiling"><input type="number" className="input" value={form.ceiling} onChange={set('ceiling')} /></Field>
          <Field label="Unit">
            <select className="input" value={form.unit} onChange={set('unit')}>
              <option value="mcg">mcg</option><option value="mg">mg</option>
            </select>
          </Field>
          <Field label="Vial (mg)"><input type="number" className="input" value={form.vialMg} onChange={set('vialMg')} /></Field>
          <Field label="BAC water (mL)"><input type="number" className="input" value={form.bacMl} onChange={set('bacMl')} /></Field>
        </div>
        <button className="btn-primary w-full rounded-xl py-2.5 text-sm font-extrabold" onClick={submit}>
          Add to stack
        </button>
      </div>
    </Modal>
  )
}
