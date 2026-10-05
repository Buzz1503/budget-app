import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import NumberField from '../ui/NumberField'
import {
  CATEGORIES, CATEGORY_FIELDS, STATUSES, UNIT_KEY, OTHER,
  optionsFor, validateItem, cleanItem, findDuplicate, describeItem, blankItem,
  effectiveVolume, quantityWords,
} from '../../lib/gear'

const ADD = '__add__'
const NUMERIC = new Set(['pen_needle_length_mm', 'syringe_needle_length_mm', 'syringe_volume_ml'])

const label = (text) => (
  <span className="t-caption mb-1 block" style={{ color: 'var(--text-2)' }}>{text}</span>
)

/**
 * A dropdown that never leaves you stuck.
 *
 * The last entry is "Add new option", which opens a small field in place; what
 * is typed there is tidied (28 becomes 28G, a length of "abc" is refused), saved
 * to the list for next time, and selected. So a needle that is not in the file's
 * list is one extra step, not a dead end — and it still arrives as a clean value
 * that will match the next box of the same thing.
 */
export function OptionSelect({ optionKey, value, onChange, suffix, testId, placeholder = 'Choose…', ariaLabel }) {
  const items = useStore((s) => s.gearItems)
  const extras = useStore((s) => s.gearOptions)
  const addOption = useStore((s) => s.addGearOption)
  const options = useMemo(() => optionsFor(optionKey, { extras, items }), [optionKey, extras, items])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)

  const show = (o) => (suffix ? `${o} ${suffix}` : String(o))
  const commit = () => {
    const stored = addOption(optionKey, draft)
    if (stored == null) { setError('That is not a value this list can take.'); return }
    onChange(stored)
    setAdding(false); setDraft(''); setError(null)
  }

  return (
    <div>
      <select
        className="input"
        data-testid={testId}
        aria-label={ariaLabel}
        value={value == null ? '' : String(value)}
        onChange={(e) => {
          if (e.target.value === ADD) { setAdding(true); return }
          setAdding(false)
          const raw = e.target.value
          if (raw === '') { onChange(''); return }
          const match = options.find((o) => String(o) === raw)
          onChange(match !== undefined ? match : raw)
        }}
      >
        <option value="">{placeholder}</option>
        {value != null && value !== '' && !options.some((o) => String(o) === String(value)) && (
          <option value={String(value)}>{show(value)}</option>
        )}
        {options.map((o) => <option key={String(o)} value={String(o)}>{show(o)}</option>)}
        <option value={ADD}>Add a new option…</option>
      </select>
      {adding && (
        <div className="mt-2 flex gap-2" data-testid={`${testId}-adder`}>
          <input
            className="input min-w-0 flex-1"
            autoFocus
            value={draft}
            data-testid={`${testId}-new`}
            placeholder={NUMERIC.has(optionKey) ? `e.g. 7${suffix ? ` ${suffix}` : ''}` : 'New option'}
            inputMode={NUMERIC.has(optionKey) ? 'decimal' : undefined}
            onChange={(e) => { setDraft(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          />
          <button type="button" className="chip shrink-0" data-testid={`${testId}-add`} onClick={commit}>Add</button>
          <button type="button" className="chip shrink-0" onClick={() => { setAdding(false); setDraft(''); setError(null) }}>Cancel</button>
        </div>
      )}
      {error && <p className="text-xs font-medium leading-snug mt-1" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}

/**
 * Add an item, or change one.
 *
 * One form for both, so an edit can never validate differently from an add. Every
 * field a category is described by is a dropdown (Other is the one free-text
 * name). Saving a new item first checks whether it duplicates a row that is
 * already there, and offers to top that up instead.
 */
export default function GearForm({ open, onClose, itemId = null, prefill = null, onSaved }) {
  const items = useStore((s) => s.gearItems)
  const addItem = useStore((s) => s.addGearItem)
  const updateItem = useStore((s) => s.updateGearItem)
  const deleteItem = useStore((s) => s.deleteGearItem)
  const editing = itemId ? items.find((i) => i.id === itemId) : null

  const [form, setForm] = useState(() => blankItem())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dup, setDup] = useState(null)

  useEffect(() => {
    if (!open) return
    if (editing) setForm({ ...editing, cost: editing.cost ?? '' })
    else setForm(prefill ? { ...blankItem(prefill.category, prefill.status), ...prefill } : blankItem())
    setConfirmDelete(false)
    setDup(null)
  }, [open, itemId]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const fields = CATEGORY_FIELDS[form.category] || []
  const problems = validateItem(form)

  const changeCategory = (category) => {
    // a fresh set of defaults for the new category, keeping what is shared
    const next = blankItem(category, form.status)
    set({
      ...next,
      qty: form.qty, unit: form.unit, brand: form.brand, vendor: form.vendor,
      cost: form.cost, note: form.note, id: form.id, usedFrom: form.usedFrom,
    })
  }

  const changeSyringeType = (syringeType) => {
    // the volume is usually in the name; read it so the two cannot disagree
    const vol = effectiveVolume({ syringeType })
    set({ syringeType, ...(vol != null ? { volumeMl: vol } : {}) })
  }

  const save = (mergeInto = null) => {
    if (problems.length) return
    if (editing) {
      updateItem(editing.id, cleanItem(form))
      onClose()
      return
    }
    const candidate = cleanItem(form)
    if (!mergeInto && !dup) {
      const found = findDuplicate(items, candidate)
      if (found) { setDup(found); return }
    }
    const { item } = addItem(candidate, { mergeInto })
    onSaved?.(item)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit item' : 'Add an item'} wide>
      <div className="space-y-4" data-testid="gear-form">
        {dup ? (
          <div className="space-y-3" data-testid="gear-dup">
            <p className="text-sm font-bold">You already have this.</p>
            <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-2)' }}>
              {describeItem(dup)} is already in {dup.status === 'in_use' ? 'use' : 'spare stock'}
              {' '}({quantityWords(dup)}). Add {Number(form.qty) || 0} to that row, or keep it as a separate row?
            </p>
            <button className="btn-primary w-full rounded-full py-3 text-sm font-black" data-testid="gear-dup-merge" onClick={() => save(dup.id)}>
              Add {Number(form.qty) || 0} to the existing row
            </button>
            <button className="w-full rounded-full py-3 text-sm font-black" data-testid="gear-dup-separate"
              style={{ background: 'var(--surface-sunk)' }} onClick={() => { setDup(null); const { item } = addItem(cleanItem(form)); onSaved?.(item); onClose() }}>
              Keep it as a separate row
            </button>
            <button className="t-caption underline" style={{ color: 'var(--text-3)' }} onClick={() => setDup(null)}>Back to the form</button>
          </div>
        ) : (
          <>
            <label className="block">
              {label('Category')}
              <select className="input" data-testid="gear-category" value={form.category} onChange={(e) => changeCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            <div>
              {label('State')}
              <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--surface-sunk)' }} role="radiogroup">
                {STATUSES.map((s) => (
                  <button
                    key={s.id} type="button" role="radio" aria-checked={form.status === s.id}
                    data-testid={`gear-status-${s.id}`} data-on={form.status === s.id ? 'true' : 'false'}
                    onClick={() => set({ status: s.id })}
                    className="flex-1 rounded-full py-2 text-sm font-bold"
                    style={form.status === s.id ? { background: 'var(--accent)', color: 'var(--accent-fg)' } : { color: 'var(--text-2)' }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={fields.length > 1 ? 'grid grid-cols-2 gap-3' : ''}>
              {fields.map((f) => (
                <div key={f.key}>
                  {label(`${f.label}${f.suffix ? ` (${f.suffix})` : ''}`)}
                  {f.free ? (
                    <input
                      className="input" data-testid={`gear-field-${f.key}`} value={form[f.key] || ''}
                      placeholder="What is it?" onChange={(e) => set({ [f.key]: e.target.value })}
                    />
                  ) : (
                    <OptionSelect
                      optionKey={f.options} testId={`gear-field-${f.key}`} ariaLabel={f.label}
                      value={form[f.key]} suffix={f.suffix}
                      onChange={(v) => (f.key === 'syringeType' ? changeSyringeType(v) : set({ [f.key]: v }))}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                {label('Quantity')}
                <NumberField
                  min={0} allowEmpty value={form.qty === '' ? undefined : form.qty} aria-label="Quantity"
                  data-testid="gear-qty" onChange={(n) => set({ qty: n === undefined ? '' : n })}
                />
              </div>
              <div>
                {label('Unit')}
                <OptionSelect optionKey={UNIT_KEY} testId="gear-unit" ariaLabel="Unit" value={form.unit} onChange={(v) => set({ unit: v })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                {label('Brand (optional)')}
                <input className="input" data-testid="gear-brand" value={form.brand || ''} onChange={(e) => set({ brand: e.target.value })} />
              </label>
              <label className="block">
                {label('Vendor (optional)')}
                <input className="input" data-testid="gear-vendor" value={form.vendor || ''} onChange={(e) => set({ vendor: e.target.value })} />
              </label>
            </div>
            <label className="block">
              {label('Cost per unit (optional)')}
              <NumberField min={0} allowEmpty value={form.cost === '' ? undefined : form.cost}
                aria-label="Cost per unit" data-testid="gear-cost" onChange={(n) => set({ cost: n === undefined ? '' : n })} />
            </label>
            <label className="block">
              {label('Note (optional)')}
              <textarea className="input min-h-16" data-testid="gear-note" value={form.note || ''} onChange={(e) => set({ note: e.target.value })} />
            </label>

            {problems.length > 0 && (
              <p className="text-xs font-medium leading-snug" data-testid="gear-problems" style={{ color: 'var(--text-2)' }}>{problems.join(' · ')}</p>
            )}
            <button
              className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-40"
              data-testid="gear-save" disabled={problems.length > 0} onClick={() => save()}
            >
              {editing ? 'Save changes' : 'Add item'}
            </button>

            {editing && (
              <div>
                {confirmDelete ? (
                  <div className="space-y-2 text-center">
                    <p className="text-xs font-bold" style={{ color: 'var(--danger)' }}>Delete this item?</p>
                    <div className="flex gap-2">
                      <button className="flex-1 rounded-full py-2 text-sm font-extrabold" data-testid="gear-delete-confirm"
                        style={{ background: 'var(--danger)', color: 'var(--accent-fg)' }}
                        onClick={() => { deleteItem(editing.id); onClose() }}>
                        Yes, delete
                      </button>
                      <button className="flex-1 rounded-full py-2 text-sm font-extrabold" style={{ background: 'var(--surface-sunk)' }}
                        onClick={() => setConfirmDelete(false)}>
                        Keep it
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="flex w-full items-center justify-center gap-2 rounded-full py-2 text-sm font-bold" data-testid="gear-delete"
                    style={{ background: 'var(--surface-sunk)', color: 'var(--danger)' }} onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={14} /> Delete item
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

export { OTHER }
