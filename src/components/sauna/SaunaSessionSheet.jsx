import { Suspense } from 'react'
import { format, parseISO } from 'date-fns'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import { fluidLost } from '../../sauna/sauna'
import { SaunaSessionHR } from '../../health/ui'

const SOURCE = { manual: 'Logged by hand', timer: 'From the timer', watch: 'From Apple Watch' }

/** One session: what was logged, fluid lost, heart rate if the Watch had it, and edit or delete. */
export default function SaunaSessionSheet({ id, onClose, onEdit }) {
  const session = useStore((s) => s.saunaSessions.find((x) => x.id === id))
  const deleteSaunaSession = useStore((s) => s.deleteSaunaSession)
  const showToast = useStore((s) => s.showToast)
  if (!session) return null
  const fluid = fluidLost(session.weightBeforeKg, session.weightAfterKg)
  const remove = () => {
    const undo = deleteSaunaSession(session.id)
    showToast('Session deleted', undo)
    onClose?.()
  }
  return (
    <Modal open onClose={onClose} title={format(parseISO(session.date), 'EEEE d MMMM')}>
      <div className="space-y-4" data-testid="sauna-session-sheet">
        <div>
          <p className="text-3xl font-black tabular-nums">{session.lengthMin} min<span className="ml-2 text-lg font-bold" style={{ color: 'var(--text-3)' }}>at {session.tempC} C</span></p>
          <p className="mt-1 text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
            {session.start} · {session.type}{session.rounds > 1 ? ` · ${session.rounds} rounds` : ''}{session.coldMin != null ? ` · ${session.coldMin} min cold after` : ''}
          </p>
          <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{SOURCE[session.source] || ''}</p>
          {session.notes && <p className="mt-2 text-sm font-medium" style={{ color: 'var(--text-2)' }}>{session.notes}</p>}
        </div>
        {fluid && (
          <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="sauna-fluid">
            <p className="text-sm font-black">Fluid lost: {fluid.text}</p>
            <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>{session.weightBeforeKg} kg before, {session.weightAfterKg} kg after. Weigh in the same clothes.</p>
          </div>
        )}
        <Suspense fallback={null}><SaunaSessionHR session={session} /></Suspense>
        <div className="flex gap-2">
          <button onClick={() => onEdit?.(session.id)} className="btn-primary flex-1 rounded-full py-2.5 text-sm font-black" data-testid="sauna-edit">Edit</button>
          <button onClick={remove} className="flex-1 rounded-full py-2.5 text-sm font-black" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="sauna-delete">Delete</button>
        </div>
      </div>
    </Modal>
  )
}
