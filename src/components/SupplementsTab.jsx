import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Pill, Plus, Search, X, Sun, Moon, AlertTriangle, Info, Trash2, Check,
  SprayCan, Droplet, Beaker, ChevronRight,
} from 'lucide-react'
import useStore from '../store/useStore'
import {
  FORMS, FORM_LABEL, SUPPLEMENT_NOTE, searchLibrary, fromLibrary, blankSupplement,
  bySlot, allCautions, defaultSlotFor, SLOTS,
} from '../lib/supplements'
import Modal from './ui/Modal'

/** One monochrome icon per form — a powder should never read as a tablet. */
export function FormIcon({ form, size = 14, ...rest }) {
  const Icon = form === 'spray' ? SprayCan
    : form === 'liquid' ? Droplet
      : form === 'powder' ? Beaker
        : Pill
  return <Icon size={size} {...rest} />
}

export default function SupplementsTab() {
  const supplements = useStore((s) => s.supplements)
  const removeSupplement = useStore((s) => s.removeSupplement)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)

  const slots = useMemo(() => bySlot(supplements), [supplements])
  const cautions = useMemo(() => allCautions(supplements), [supplements])

  return (
    <div className="space-y-3" data-testid="supplements-view">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
          <Pill size={22} style={{ color: 'var(--warn)' }} /> Supplements
        </h1>
        <p className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
          What you take by mouth — {supplements.length} on the shelf
        </p>
      </div>

      {/* combinations worth knowing about, before the list rather than after */}
      {cautions.length > 0 && (
        <div className="space-y-2" data-testid="supplement-cautions">
          {cautions.map((c) => (
            <div key={c.id} className="card p-3"
              style={{ background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))' }}>
              <p className="flex items-start gap-2 text-xs font-semibold leading-relaxed">
                <AlertTriangle size={14} className="mt-px shrink-0" style={{ color: 'var(--warn)' }} />
                <span>
                  <span className="font-black">{c.name}</span> — {c.text}
                </span>
              </p>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setAdding(true)} data-testid="add-supplement"
        className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-black">
        <Plus size={16} /> Add a supplement
      </button>

      {supplements.length === 0 && (
        <div className="card p-5 text-center">
          <Pill size={22} className="mx-auto mb-2" style={{ color: 'var(--text-2)' }} />
          <p className="text-sm font-black">Nothing on the shelf yet</p>
          <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Add from the library — the ones you already own are listed first — or enter your own.
          </p>
        </div>
      )}

      {SLOTS.map((slot) => slots[slot].length > 0 && (
        <div key={slot} data-testid={`supplement-slot-${slot}`}>
          <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide"
            style={{ color: slot === 'AM' ? 'var(--warn)' : 'var(--info)' }}>
            {slot === 'AM' ? <Sun size={12} /> : <Moon size={12} />} {slot === 'AM' ? 'Morning' : 'Evening'} · {slots[slot].length}
          </p>
          <div className="space-y-2">
            {slots[slot].map((s) => (
              <SupplementRow key={s.id} supplement={s}
                onEdit={() => setEditing(s)} onRemove={() => removeSupplement(s.id)} />
            ))}
          </div>
        </div>
      ))}

      <p className="px-1 pb-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
        {SUPPLEMENT_NOTE}
      </p>

      <AddSupplement open={adding} onClose={() => setAdding(false)} />
      <EditSupplement supplement={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function SupplementRow({ supplement: s, onEdit, onRemove }) {
  const [open, setOpen] = useState(false)
  return (
    <motion.div layout className="card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 p-3 text-left">
        <div className="flex shrink-0 items-center justify-center" style={{ color: 'var(--text-3)' }}>
          <FormIcon form={s.form} size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold leading-tight">{s.name}</p>
          <p className="truncate text-xs font-semibold leading-tight" style={{ color: 'var(--text-2)' }}>
            {s.dose || 'no dose set'}{s.brand ? ` · ${s.brand}` : ''} · {FORM_LABEL[s.form] || s.form}
          </p>
        </div>
        {s.caution && <AlertTriangle size={14} className="shrink-0" style={{ color: 'var(--warn)' }} />}
        <ChevronRight size={16} className="shrink-0 transition-transform"
          style={{ color: 'var(--text-2)', transform: open ? 'rotate(90deg)' : 'none' }} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-2 px-3 pb-3">
              {s.doseNote && (
                <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
                  {s.doseNote}
                </p>
              )}
              {s.caution && (
                <p className="flex items-start gap-2 rounded-[10px] p-2 text-xs font-semibold leading-relaxed"
                  style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'var(--warn)' }}>
                  <AlertTriangle size={12} className="mt-px shrink-0" /> <span>{s.caution}</span>
                </p>
              )}
              <div className="flex gap-2">
                <button onClick={onEdit} className="flex-1 rounded-full py-2 text-xs font-black"
                  style={{ background: 'var(--surface-sunk)' }}>
                  Edit
                </button>
                <button onClick={onRemove} aria-label={`Remove ${s.name}`}
                  className="rounded-full px-3 py-2" style={{ background: 'var(--surface-sunk)', color: 'var(--danger)' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ------------------------------------------------------------------- adding

function AddSupplement({ open, onClose }) {
  const addSupplement = useStore((s) => s.addSupplement)
  const supplements = useStore((s) => s.supplements)
  const [mode, setMode] = useState('library')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(blankSupplement)

  const have = new Set(supplements.map((s) => s.libraryId).filter(Boolean))
  const results = useMemo(() => searchLibrary(query), [query])
  const owned = results.filter((r) => r.owned)
  const rest = results.filter((r) => !r.owned)

  const close = () => { setQuery(''); setDraft(blankSupplement()); setMode('library'); onClose() }

  return (
    <Modal open={open} onClose={close} title="Add a supplement"
      pinned={(
        <div className="space-y-3">
          <div className="flex rounded-full p-1" style={{ background: 'var(--surface-sunk)' }}>
            {[['library', 'From the library'], ['manual', 'Enter my own']].map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)} aria-label={label}
                className="relative flex-1 rounded-full py-2 text-xs font-black">
                {mode === m && (
                  <motion.span layoutId="sup-add-pill" className="absolute inset-0 rounded-full"
                    style={{ background: 'var(--accent)' }} />
                )}
                <span className="relative" style={{ color: mode === m ? 'var(--accent-fg)' : 'var(--text-2)' }}>{label}</span>
              </button>
            ))}
          </div>
          {mode === 'library' && (
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-2)' }} />
              {/* !pl-10: .input applies its own px-3 further down the stylesheet,
                  so a plain pl-10 loses the cascade and the glass lands on the text */}
              <input className="input !pl-10" placeholder="Search supplements…" aria-label="Search supplements"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
        </div>
      )}>
      {mode === 'library' ? (
        <div className="space-y-3" data-testid="supplement-library">
          <LibraryGroup title="Your shelf" testid="library-owned" hint="What you already have"
            rows={owned} have={have} onPick={(r) => { addSupplement(fromLibrary(r)); close() }} />
          <LibraryGroup title="Could add later" testid="library-available" hint="Common men's-health supplements"
            rows={rest} have={have} onPick={(r) => { addSupplement(fromLibrary(r)); close() }} />

          {results.length === 0 && (
            <p className="py-4 text-center text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
              Nothing matches “{query}”. Enter it yourself instead.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3" data-testid="supplement-manual">
          <Field label="Name">
            <input className="input" value={draft.name} aria-label="Supplement name"
              placeholder="e.g. Magnesium glycinate"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Brand (optional)">
            <input className="input" value={draft.brand} aria-label="Brand"
              onChange={(e) => setDraft({ ...draft, brand: e.target.value })} />
          </Field>
          <Field label="Form">
            <select className="input" value={draft.form} aria-label="Form"
              onChange={(e) => setDraft({ ...draft, form: e.target.value })}>
              {FORMS.map((f) => <option key={f} value={f}>{FORM_LABEL[f] || f}</option>)}
            </select>
          </Field>
          <Field label="Dose">
            <input className="input" value={draft.dose} aria-label="Dose"
              placeholder="e.g. 2 capsules, or 3 g"
              onChange={(e) => setDraft({ ...draft, dose: e.target.value })} />
          </Field>
          <Field label="When">
            <div className="flex gap-2">
              {SLOTS.map((sl) => (
                <button key={sl} onClick={() => setDraft({ ...draft, slot: sl })}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full py-2 text-xs font-black"
                  style={draft.slot === sl
                    ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                    : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                  {sl === 'AM' ? <Sun size={13} /> : <Moon size={13} />} {sl === 'AM' ? 'Morning' : 'Evening'}
                </button>
              ))}
            </div>
          </Field>
          <button disabled={!draft.name.trim()}
            onClick={() => { addSupplement({ ...draft, name: draft.name.trim() }); close() }}
            className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-40">
            Add to shelf
          </button>
        </div>
      )}
    </Modal>
  )
}

function LibraryGroup({ title, hint, rows, have, onPick, testid }) {
  if (!rows.length) return null
  return (
    <div data-testid={testid}>
      <p className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
        {title} · {rows.length}
      </p>
      <p className="mb-2 text-xs font-medium" style={{ color: 'var(--text-2)' }}>{hint}</p>
      <div className="space-y-2">
        {rows.map((r) => {
          const added = have.has(r.id)
          return (
            <button key={r.id} disabled={added} onClick={() => onPick(r)}
              className="flex w-full items-center gap-3 rounded-full p-3 text-left disabled:opacity-45"
              style={{ background: 'var(--surface-sunk)' }}>
              <FormIcon form={r.form} size={15} style={{ color: 'var(--warn)', flexShrink: 0 }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold leading-tight">{r.name}</p>
                <p className="truncate text-xs font-semibold leading-tight" style={{ color: 'var(--text-2)' }}>
                  {r.optimal_dose} · {defaultSlotFor(r)}{r.brand && r.brand !== '(any)' ? ` · ${r.brand}` : ''}
                </p>
              </div>
              {r.caution && <AlertTriangle size={12} className="shrink-0" style={{ color: 'var(--warn)' }} />}
              {added
                ? <Check size={14} className="shrink-0" style={{ color: 'var(--good)' }} />
                : <Plus size={14} className="shrink-0" style={{ color: 'var(--text-2)' }} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ editing

function EditSupplement({ supplement, onClose }) {
  const updateSupplement = useStore((s) => s.updateSupplement)
  const [draft, setDraft] = useState(null)
  const current = draft && supplement && draft.id === supplement.id ? draft : supplement
  if (!supplement) return null

  const set = (patch) => setDraft({ ...current, ...patch })
  const save = () => {
    updateSupplement(supplement.id, {
      name: current.name.trim(), brand: current.brand, form: current.form,
      dose: current.dose, slot: current.slot,
    })
    setDraft(null)
    onClose()
  }

  return (
    <Modal open={!!supplement} onClose={() => { setDraft(null); onClose() }} title={supplement.name}>
      <div className="space-y-3">
        <Field label="Name">
          <input className="input" value={current.name} aria-label="Supplement name"
            onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Brand">
          <input className="input" value={current.brand || ''} aria-label="Brand"
            onChange={(e) => set({ brand: e.target.value })} />
        </Field>
        <Field label="Form">
          <select className="input" value={current.form} aria-label="Form"
            onChange={(e) => set({ form: e.target.value })}>
            {FORMS.map((f) => <option key={f} value={f}>{FORM_LABEL[f] || f}</option>)}
          </select>
        </Field>
        <Field label="Dose">
          <input className="input" value={current.dose || ''} aria-label="Dose"
            onChange={(e) => set({ dose: e.target.value })} />
        </Field>
        <Field label="When">
          <div className="flex gap-2">
            {SLOTS.map((sl) => (
              <button key={sl} onClick={() => set({ slot: sl })}
                className="flex flex-1 items-center justify-center gap-2 rounded-full py-2 text-xs font-black"
                style={current.slot === sl
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                {sl === 'AM' ? <Sun size={13} /> : <Moon size={13} />} {sl === 'AM' ? 'Morning' : 'Evening'}
              </button>
            ))}
          </div>
        </Field>
        {current.doseNote && (
          <p className="flex items-start gap-2 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            <Info size={12} className="mt-px shrink-0" style={{ color: 'var(--text-2)' }} />
            <span>{current.doseNote}</span>
          </p>
        )}
        <button onClick={save} className="btn-primary w-full rounded-full py-3 text-sm font-black">
          Save
        </button>
      </div>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}
