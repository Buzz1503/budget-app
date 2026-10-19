import { useEffect, useState } from 'react'
import { Minus, Plus, ChevronDown } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import PickerField from '../ui/PickerField'
import NumberField from '../ui/NumberField'
import { SAUNA_TYPES, usualFor, defaultStart } from '../../sauna/sauna'

const nowLocal = () => { const d = new Date(); return { date: todayStr(), minutes: d.getHours() * 60 + d.getMinutes() } }

/** A big minus, the value, a big plus. Holds a number between min and max. */
export function Stepper({ label, value, onChange, step = 1, min = 0, max = 999, unit, testid }) {
  const set = (v) => onChange(Math.min(max, Math.max(min, v)))
  return (
    <div data-testid={testid}>
      <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
      <div className="flex items-center gap-3 rounded-[14px] p-2" style={{ background: 'var(--surface-sunk)' }}>
        <button type="button" onClick={() => set(value - step)} aria-label={`Less ${label.toLowerCase()}`} data-testid={testid && `${testid}-minus`}
          className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'var(--surface2)' }}><Minus size={20} /></button>
        <p className="flex-1 text-center text-3xl font-black tabular-nums" data-testid={testid && `${testid}-value`}>
          {value}<span className="ml-1 text-sm font-bold" style={{ color: 'var(--text-3)' }}>{unit}</span>
        </p>
        <button type="button" onClick={() => set(value + step)} aria-label={`More ${label.toLowerCase()}`} data-testid={testid && `${testid}-plus`}
          className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'var(--surface2)' }}><Plus size={20} /></button>
      </div>
    </div>
  )
}

function Chips({ options, value, onChange, testid }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testid}>
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)} aria-pressed={value === o}
          className="min-h-[34px] rounded-full px-3 text-xs font-bold"
          style={value === o ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>{o}</button>
      ))}
    </div>
  )
}

/**
 * Log or edit a sauna session. Prefilled with your usual length and
 * temperature and a start of "now minus the length", so a normal session is
 * Log session, then Save. `prefill` overrides any field (a stopped timer, a
 * Watch workout); `tempOnly` asks just the temperature (a confirmed Watch
 * workout already knows the rest).
 */
export default function SaunaLogSheet({ open, onClose, prefill = null, editId = null, tempOnly = false, onSaved }) {
  const sessions = useStore((s) => s.saunaSessions)
  const settings = useStore((s) => s.saunaSettings)
  const addSaunaSession = useStore((s) => s.addSaunaSession)
  const updateSaunaSession = useStore((s) => s.updateSaunaSession)
  const [f, setF] = useState(null)
  const [more, setMore] = useState(false)

  useEffect(() => {
    if (!open) { setF(null); setMore(false); return }
    const editing = editId ? sessions.find((x) => x.id === editId) : null
    if (editing) { setF({ ...editing }); return }
    const usual = usualFor(sessions, settings)
    const lengthMin = prefill?.lengthMin ?? usual.lengthMin
    setF({
      ...defaultStart(nowLocal(), lengthMin),
      lengthMin,
      tempC: usual.tempC,
      type: 'Infrared',
      rounds: 1,
      coldMin: null,
      weightBeforeKg: null,
      weightAfterKg: null,
      notes: '',
      source: 'manual',
      workoutId: null,
      ...(prefill || {}),
    })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !f) return null
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }))
  const save = () => {
    const clean = { ...f, notes: (f.notes || '').trim() }
    const saved = editId ? (updateSaunaSession(editId, clean), { ...clean, id: editId }) : addSaunaSession(clean)
    onSaved?.(saved)
    onClose?.()
  }

  return (
    <Modal open onClose={onClose} title={editId ? 'Edit session' : tempOnly ? 'Confirm sauna' : 'Log sauna'}>
      <div className="space-y-4" data-testid="sauna-log-sheet">
        {!tempOnly && (
          <div className="grid grid-cols-2 gap-2">
            <PickerField kind="date" label="Date" value={f.date} onChange={(v) => v && set({ date: v })} clearable={false} max={todayStr()} testid="sauna-date" />
            <PickerField kind="time" label="Start" value={f.start} onChange={(v) => v && set({ start: v })} clearable={false} testid="sauna-start" />
          </div>
        )}
        {tempOnly && (
          <p className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>{f.start}, {f.lengthMin} min, from Apple Watch.</p>
        )}
        {!tempOnly && <Stepper label="Length" unit="min" value={f.lengthMin} onChange={(v) => set({ lengthMin: v })} min={1} max={180} testid="sauna-length" />}
        <Stepper label="Temperature" unit="C" value={f.tempC} onChange={(v) => set({ tempC: v })} min={30} max={120} testid="sauna-temp" />

        {!tempOnly && (
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} data-testid="sauna-more"
            className="flex w-full items-center gap-1 text-sm font-bold" style={{ color: 'var(--text-2)' }}>
            More details <ChevronDown size={16} style={{ transform: more ? 'rotate(180deg)' : undefined }} />
          </button>
        )}
        {more && (
          <div className="space-y-4" data-testid="sauna-details">
            <div>
              <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Type</p>
              <Chips options={SAUNA_TYPES} value={f.type} onChange={(v) => set({ type: v })} testid="sauna-type" />
            </div>
            <Stepper label="Rounds" value={f.rounds} onChange={(v) => set({ rounds: v })} min={1} max={10} testid="sauna-rounds" />
            <div>
              <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Cold exposure after</p>
              <Chips options={['None', 'Yes']} value={f.coldMin == null ? 'None' : 'Yes'} onChange={(v) => set({ coldMin: v === 'None' ? null : (f.coldMin ?? 3) })} testid="sauna-cold" />
              {f.coldMin != null && <div className="mt-2"><Stepper label="Cold, minutes" unit="min" value={f.coldMin} onChange={(v) => set({ coldMin: v })} min={1} max={60} testid="sauna-cold-min" /></div>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Weight before (kg)</p>
                <NumberField value={f.weightBeforeKg ?? ''} allowEmpty aria-label="Weight before" onChange={(v) => set({ weightBeforeKg: v ?? null })} />
              </div>
              <div>
                <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Weight after (kg)</p>
                <NumberField value={f.weightAfterKg ?? ''} allowEmpty aria-label="Weight after" onChange={(v) => set({ weightAfterKg: v ?? null })} />
              </div>
            </div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Weigh in the same clothes before and after.</p>
            <div>
              <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Notes</p>
              <input className="input" value={f.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Notes" data-testid="sauna-notes" />
            </div>
          </div>
        )}

        <button type="button" onClick={save} className="btn-primary w-full rounded-full py-3 text-base font-black" data-testid="sauna-save">
          {editId ? 'Save changes' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
