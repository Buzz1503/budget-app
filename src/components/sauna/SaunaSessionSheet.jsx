import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import useStore from '../../store/useStore'
import Modal from '../ui/Modal'
import SessionDetail from './SessionDetail'
import SaunaRatingSheet from './SaunaRatingSheet'

const SOURCE = { manual: 'Logged by hand', timer: 'From the timer', watch: 'From Apple Watch' }

/** One session in full: the detail with its heart rate line, then edit or delete. */
export default function SaunaSessionSheet({ id, onClose, onEdit }) {
  const session = useStore((s) => s.saunaSessions.find((x) => x.id === id))
  const deleteSaunaSession = useStore((s) => s.deleteSaunaSession)
  const showToast = useStore((s) => s.showToast)
  const [rating, setRating] = useState(false)
  if (!session) return null
  if (rating) return <SaunaRatingSheet id={session.id} onClose={() => setRating(false)} />
  const remove = () => {
    const undo = deleteSaunaSession(session.id)
    showToast('Session deleted', undo)
    onClose?.()
  }
  return (
    <Modal open onClose={onClose} title={format(parseISO(session.date), 'EEEE d MMMM')}>
      <div className="space-y-4" data-testid="sauna-session-sheet">
        <SessionDetail session={session} full onRate={() => setRating(true)} />
        <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>{SOURCE[session.source] || ''}</p>
        <div className="flex gap-2">
          <button onClick={() => onEdit?.(session.id)} className="btn-primary flex-1 rounded-full py-2.5 text-sm font-black" data-testid="sauna-edit">Edit</button>
          <button onClick={remove} className="flex-1 rounded-full py-2.5 text-sm font-black" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }} data-testid="sauna-delete">Delete</button>
        </div>
      </div>
    </Modal>
  )
}
