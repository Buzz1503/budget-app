import { useState, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { Plus, ChevronDown, Trash2, Search, Check, AlertTriangle } from 'lucide-react'
import useStore from '../store/useStore'
import { currentRung, cycleInfo } from '../lib/schedule'
import { formatDose } from '../lib/calc'
import { WEEKDAYS, weekdayPickCount, scheduledWeekdaySet, slotOf, needsProtocolSetup } from '../lib/daily'
import { loadMatrix, compoundColor } from '../lib/mixMatrix'
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
  const [expandId, setExpandId] = useState(null)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Library</h1>
        <motion.button whileTap={{ scale: 0.92 }} onClick={() => setAdding(true)}
          className="btn-violet flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-bold">
          <Plus size={16} /> Add
        </motion.button>
      </div>
      {peptides.map((p, i) => (
        <PeptideCard key={p.id} peptide={p} index={i}
          defaultOpen={expandId === p.id} onOpened={() => setExpandId(null)} />
      ))}
      <AddPeptideModal open={adding} onClose={() => setAdding(false)} onAdded={setExpandId} />
    </div>
  )
}

function PeptideCard({ peptide: p, index, defaultOpen, onOpened }) {
  const titration = useStore((s) => s.titration)
  const [open, setOpen] = useState(false)
  const cardRef = useRef(null)
  const { dose, level, maxLevel } = currentRung(p, titration[p.id])
  const setupNeeded = needsProtocolSetup(p)

  // A freshly added peptide opens straight to its protocol fields and scrolls
  // into view (new entries append to the bottom of a long list). Guarded by a
  // ref and left uncancelled: clearing expandId re-renders this card, and a
  // dep-tied cleanup would cancel the scroll before it ever ran.
  const handledRef = useRef(false)
  useEffect(() => {
    if (!defaultOpen || handledRef.current) return
    handledRef.current = true
    setOpen(true)
    // let the card mount + its entrance animation start before scrolling
    setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      onOpened?.()
    }, 260)
  }, [defaultOpen, onOpened])

  return (
    <motion.div ref={cardRef} layout className="card overflow-hidden"
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, delay: index * 0.03 }}>
      <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(!open)}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold">{p.name}</h3>
            {setupNeeded ? (
              <span className="chip" style={{ color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 18%, transparent)' }}>
                <AlertTriangle size={11} /> Set your protocol
              </span>
            ) : (
              <span className="chip" style={{ color: 'var(--violet)' }}>Lvl {level + 1}/{maxLevel + 1}</span>
            )}
          </div>
          {setupNeeded ? (
            <p className="mt-1 text-sm font-medium" style={{ color: 'var(--muted)' }}>
              Tap to set dose, frequency, cycle and reconstitution.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm font-semibold">
                {formatDose(dose, p.ladder.unit)}
                <span className="font-medium" style={{ color: 'var(--muted)' }}>
                  {' '}· {FREQ_LABELS[p.frequency] || p.frequency}{p.timing ? ` · ${p.timing}` : ''} · {p.route}
                </span>
              </p>
              <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{cycleLabel(p)}</p>
            </>
          )}
          {(p.compoundClass || p.charge) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {p.compoundClass && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{p.compoundClass}</span>}
              {p.charge && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{p.charge}</span>}
              {(p.flags || []).slice(0, 2).map((f) => (
                <span key={f} className="rounded px-1.5 py-0.5 text-[9px] font-semibold" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{f}</span>
              ))}
            </div>
          )}
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }}><ChevronDown size={18} style={{ color: 'var(--muted)' }} /></motion.div>
      </button>
      {open && <PeptideEditor peptide={p} />}
    </motion.div>
  )
}

function ScheduleConfig({ peptide: p, onPatch }) {
  const pickCount = weekdayPickCount(p.frequency)
  const days = scheduledWeekdaySet(p)
  const slot = slotOf(p)

  const toggleDay = (d) => {
    const cur = new Set(days)
    if (cur.has(d)) cur.delete(d)
    else {
      if (pickCount === 1) { cur.clear() } // weekly = single day
      else if (cur.size >= pickCount) return // cap for N×week / 5-2
      cur.add(d)
    }
    onPatch({ scheduleWeekdays: [...cur].sort((a, b) => a - b) })
  }

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--surface2)' }}>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--amber)' }}>Daily schedule</p>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold">Inject in the</span>
        <div className="flex rounded-lg p-0.5" style={{ background: 'var(--surface-solid)' }}>
          {['AM', 'PM'].map((s) => (
            <button key={s} onClick={() => onPatch({ slot: s })}
              className="rounded-md px-3 py-1 text-xs font-black"
              style={slot === s
                ? { backgroundImage: s === 'AM' ? 'linear-gradient(135deg, var(--amber), #ff8a1a)' : 'linear-gradient(135deg, var(--indigo), var(--violet))', color: '#fff' }
                : { color: 'var(--muted)' }}>
              {s}
            </button>
          ))}
        </div>
      </div>
      {pickCount > 0 ? (
        <>
          <p className="mb-1.5 text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>
            {pickCount === 1 ? 'Which day each week?' : `Pick ${pickCount} day${pickCount > 1 ? 's' : ''}`}
          </p>
          <div className="flex gap-1">
            {WEEKDAYS.map((label, d) => {
              const on = days.has(d)
              return (
                <button key={d} onClick={() => toggleDay(d)}
                  className="flex-1 rounded-lg py-1.5 text-[10px] font-black"
                  style={on
                    ? { backgroundImage: 'linear-gradient(135deg, var(--lime), var(--lime-deep))', color: '#0c1200' }
                    : { background: 'var(--surface-solid)', color: 'var(--muted)' }}>
                  {label[0]}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <p className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>Every day (daily frequency).</p>
      )}
    </div>
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

        <ScheduleConfig peptide={p} onPatch={(patch) => updatePeptide(p.id, patch)} />

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

// Blank protocol — the matrix has no dosing data, so we never invent values.
const BLANK_PROTOCOL = {
  frequency: 'daily', timing: '', cycleOnDays: 0, cycleOffDays: 0,
  ladder: { floor: 0, step: 0, intervalWeeks: 1, ceiling: 0, unit: 'mcg' },
  recon: { vialMg: 0, bacMl: 0, expiryDays: 28 },
}

function AddPeptideModal({ open, onClose, onAdded }) {
  const peptides = useStore((s) => s.peptides)
  const addPeptide = useStore((s) => s.addPeptide)
  const [mode, setMode] = useState('list')
  const [matrix, setMatrix] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [customName, setCustomName] = useState('')

  // lazy-load the compound matrix only when the picker opens
  useEffect(() => {
    if (!open || matrix) return
    let alive = true
    loadMatrix().then((m) => alive && setMatrix(m)).catch(() => alive && setLoadFailed(true))
    return () => { alive = false }
  }, [open, matrix])

  const existingIds = useMemo(() => new Set(peptides.map((p) => p.id)), [peptides])
  const existingNames = useMemo(
    () => new Set(peptides.map((p) => p.name.trim().toLowerCase())), [peptides]
  )

  const results = useMemo(() => {
    if (!matrix) return []
    const q = query.trim().toLowerCase()
    if (!q) return matrix.compounds
    return matrix.compounds.filter(
      (c) => c.name.toLowerCase().includes(q) || c.class.toLowerCase().includes(q) || c.id.includes(q)
    )
  }, [matrix, query])

  const addFromCompound = (c) => {
    if (existingIds.has(c.id)) return
    // keeping the compound id as the peptide id wires Mix + co-draw automatically
    const id = addPeptide({
      ...BLANK_PROTOCOL,
      id: c.id, name: c.name,
      compoundClass: c.class, charge: c.charge, flags: c.flags || [],
    })
    if (id) { setQuery(''); onClose(); onAdded?.(id) }
  }

  const addCustom = () => {
    const name = customName.trim()
    if (!name || existingNames.has(name.toLowerCase())) return
    const id = addPeptide({ ...BLANK_PROTOCOL, name })
    if (id) { setCustomName(''); onClose(); onAdded?.(id) }
  }

  const customDupe = customName.trim() && existingNames.has(customName.trim().toLowerCase())

  return (
    <Modal open={open} onClose={onClose} title="Add peptide" wide>
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {[['list', 'From list'], ['custom', 'Custom']].map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className="flex-1 rounded-lg py-1.5 text-xs font-black"
              style={mode === m
                ? { backgroundImage: 'linear-gradient(135deg, var(--violet), var(--indigo))', color: '#fff' }
                : { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'list' ? (
          <>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
              <input className="input !pl-9" autoFocus placeholder={`Search ${matrix ? matrix.compounds.length : 86} compounds…`}
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>

            {loadFailed ? (
              <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--amber)' }}>
                Couldn't load the compound list — use Custom to add by name.
              </p>
            ) : !matrix ? (
              <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>Loading compounds…</p>
            ) : (
              <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-0.5">
                {results.map((c) => {
                  const added = existingIds.has(c.id)
                  return (
                    <button key={c.id} onClick={() => addFromCompound(c)} disabled={added}
                      className="flex w-full items-center gap-2 rounded-xl p-2.5 text-left"
                      style={{ background: 'var(--surface2)', opacity: added ? 0.55 : 1 }}>
                      <span className="h-6 w-6 shrink-0 rounded-full" style={{ background: compoundColor(c) }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{c.name}</span>
                        <span className="flex flex-wrap gap-1 pt-0.5">
                          <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase" style={{ background: 'var(--surface-solid)', color: 'var(--muted)' }}>{c.class}</span>
                          <span className="rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: 'var(--surface-solid)', color: 'var(--muted)' }}>{c.charge}</span>
                          {(c.flags || []).slice(0, 2).map((f) => (
                            <span key={f} className="rounded px-1 py-0.5 text-[9px] font-semibold" style={{ background: 'var(--surface-solid)', color: 'var(--muted)' }}>{f}</span>
                          ))}
                        </span>
                      </span>
                      {added ? (
                        <span className="flex shrink-0 items-center gap-1 text-[10px] font-black" style={{ color: 'var(--lime)' }}>
                          <Check size={13} /> Added
                        </span>
                      ) : (
                        <Plus size={16} className="shrink-0" style={{ color: 'var(--violet)' }} />
                      )}
                    </button>
                  )
                })}
                {results.length === 0 && (
                  <p className="py-6 text-center text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                    No compound matches “{query}”. Use Custom to add it by name.
                  </p>
                )}
              </div>
            )}
            <p className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
              Picking from the list links the compound to the Mix tab and co-draw checks automatically. You'll set your own dose, frequency and cycle next — the list carries no dosing data.
            </p>
          </>
        ) : (
          <>
            <Field label="Name">
              <input className="input" value={customName} autoFocus placeholder="e.g. My blend"
                onChange={(e) => setCustomName(e.target.value)} />
            </Field>
            {customDupe && (
              <p className="text-[11px] font-bold" style={{ color: 'var(--amber)' }}>That name is already in your Library.</p>
            )}
            <p className="text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
              A custom peptide isn't in the chemistry matrix, so the Mix tab will show “no data” for it. You'll set your protocol next.
            </p>
            <button className="btn-primary w-full rounded-xl py-2.5 text-sm font-extrabold disabled:opacity-40"
              disabled={!customName.trim() || !!customDupe} onClick={addCustom}>
              Add to stack
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
