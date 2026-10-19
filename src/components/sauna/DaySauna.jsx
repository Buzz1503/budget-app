import { useState } from 'react'
import { Flame } from 'lucide-react'
import useStore from '../../store/useStore'
import SaunaLogSheet from './SaunaLogSheet'

/** The day sheet's sauna part: that day's sessions, each with an edit link. */
export default function DaySauna({ date }) {
  const sessions = useStore((s) => s.saunaSessions)
  const [editId, setEditId] = useState(null)
  const day = sessions.filter((s) => s.date === date).sort((a, b) => a.start.localeCompare(b.start))
  if (!day.length) return null
  return (
    <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="day-sauna">
      <p className="flex items-center gap-1 t-caption" style={{ color: 'var(--text-2)' }}><Flame size={11} /> Sauna</p>
      {day.map((s) => (
        <div key={s.id} className="mt-1 flex items-center gap-2" data-testid="day-sauna-row">
          <p className="min-w-0 flex-1 text-xs font-bold tabular-nums">{s.start} · {s.lengthMin} min at {s.tempC} C</p>
          <button onClick={() => setEditId(s.id)} className="shrink-0 text-xs font-black" style={{ color: 'var(--text-2)' }} data-testid="day-sauna-edit">Edit</button>
        </div>
      ))}
      <SaunaLogSheet open={!!editId} editId={editId} onClose={() => setEditId(null)} />
    </div>
  )
}
