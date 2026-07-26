import { useState } from 'react'
import { motion } from 'framer-motion'
import { Pencil, Check } from 'lucide-react'
import useStore from '../store/useStore'

export default function NeedleTab() {
  const notes = useStore((s) => s.needleNotes)
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-extrabold">Needle guide</h1>
      <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
        Editable reference — tap the pencil to make it yours.
      </p>
      {notes.map((n, i) => <NoteCard key={n.id} note={n} index={i} />)}
    </div>
  )
}

function NoteCard({ note, index }) {
  const updateNeedleNote = useStore((s) => s.updateNeedleNote)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.body)

  const save = () => {
    updateNeedleNote(note.id, { body: draft })
    setEditing(false)
  }

  return (
    <motion.div layout className="card p-4"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">{note.title}</h3>
        <button
          onClick={() => (editing ? save() : (setDraft(note.body), setEditing(true)))}
          className="rounded-full p-1.5" style={{ background: 'var(--surface2)' }}
          aria-label={editing ? 'Save note' : 'Edit note'}
        >
          {editing ? <Check size={14} style={{ color: 'var(--lime)' }} /> : <Pencil size={13} style={{ color: 'var(--muted)' }} />}
        </button>
      </div>
      {editing ? (
        <textarea className="input mt-2 min-h-24 leading-relaxed" value={draft} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <p className="mt-1.5 text-xs font-medium leading-relaxed" style={{ color: 'var(--muted)' }}>{note.body}</p>
      )}
    </motion.div>
  )
}
