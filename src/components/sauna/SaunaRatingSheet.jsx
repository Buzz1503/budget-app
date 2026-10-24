import { useEffect, useState } from 'react'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import { Stepper } from './SaunaLogSheet'

const chip = (on) => (on ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' })
const TOGGLES = [['lightheaded', 'Lightheaded'], ['headache', 'Headache'], ['cramps', 'Cramps'], ['electrolytes', 'Electrolytes after']]

/**
 * The optional quick step after saving a session: how it felt 1 to 5, three
 * toggles, electrolytes after, and water in ml (written to Apple Health as
 * dietary water). Everything here becomes a Sleep Lab factor.
 */
export default function SaunaRatingSheet({ id, onClose }) {
  const session = useStore((s) => s.saunaSessions.find((x) => x.id === id))
  const rate = useStore((s) => s.rateSaunaSession)
  const [f, setF] = useState(null)
  useEffect(() => {
    if (!session) return
    const r = session.rating || {}
    setF({ feel: r.feel ?? null, lightheaded: !!r.lightheaded, headache: !!r.headache, cramps: !!r.cramps, electrolytes: !!session.electrolytes, waterMl: session.waterMl ?? 0 })
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!session || !f) return null
  const set = (patch) => setF((cur) => ({ ...cur, ...patch }))
  const save = () => { rate(id, f); onClose?.() }
  return (
    <Modal open onClose={onClose} title="How was it?">
      <div className="space-y-4" data-testid="sauna-rating-sheet">
        <div>
          <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>How it felt (1 to 5)</p>
          <div className="grid grid-cols-5 gap-1.5" data-testid="sauna-feel">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => set({ feel: f.feel === n ? null : n })} aria-pressed={f.feel === n}
                className="min-h-[44px] rounded-full text-sm font-black tabular-nums" style={chip(f.feel === n)} data-testid={`sauna-feel-${n}`}>{n}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TOGGLES.map(([k, label]) => (
            <button key={k} type="button" onClick={() => set({ [k]: !f[k] })} aria-pressed={f[k]}
              className="min-h-[36px] rounded-full px-3 text-xs font-bold" style={chip(f[k])} data-testid={`sauna-rate-${k}`}>{label}</button>
          ))}
        </div>
        <Stepper label="Water after" unit="ml" value={f.waterMl} onChange={(v) => set({ waterMl: v })} step={100} min={0} max={3000} testid="sauna-water" />
        {__NATIVE__ && <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>Water is saved to Apple Health as water.</p>}
        <div className="flex gap-2">
          <button type="button" onClick={save} className="btn-primary flex-1 rounded-full py-2.5 text-sm font-black" data-testid="sauna-rate-save">Save</button>
          <button type="button" onClick={onClose} className="flex-1 rounded-full py-2.5 text-sm font-black" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="sauna-rate-skip">Skip</button>
        </div>
      </div>
    </Modal>
  )
}

/** "Felt 4 of 5 · Lightheaded · Electrolytes after · 500 ml water", or null. */
export function ratingWords(session) {
  const r = session.rating
  const parts = []
  if (r?.feel != null) parts.push(`Felt ${r.feel} of 5`)
  if (r?.lightheaded) parts.push('Lightheaded')
  if (r?.headache) parts.push('Headache')
  if (r?.cramps) parts.push('Cramps')
  if (session.electrolytes) parts.push('Electrolytes after')
  if (session.waterMl) parts.push(`${session.waterMl} ml water`)
  return parts.length ? parts.join(' · ') : null
}
