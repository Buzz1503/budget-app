import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Clock, CalendarDays } from 'lucide-react'
import Modal from './Modal'

/**
 * A time or date that can also be empty.
 *
 * iOS draws an empty <input type="time"> as the current time, its own Reset
 * does not always reach React, and the control refuses to shrink inside a
 * card. So the value lives on a plain button row instead: it says "Auto" or
 * "None" in words when empty, opens the system picker in a small sheet with a
 * Done button, and has its own clear button when a value is set.
 */
export default function PickerField({
  kind = 'time', value, onChange, label, emptyText, clearText = 'Clear',
  clearable = true, fallback, min, max, testid,
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const Icon = kind === 'time' ? Clock : CalendarDays
  const shown = !value ? emptyText : kind === 'time' ? value : format(parseISO(value), 'd MMM yyyy')

  const start = () => { setDraft(value || fallback || ''); setOpen(true) }
  const done = () => { if (draft) onChange(draft); setOpen(false) }

  return (
    <div className="min-w-0">
      <button type="button" onClick={start} data-testid={testid} data-value={value || ''} aria-label={label ? `${label}: ${shown}` : shown}
        className="input flex min-h-[44px] items-center gap-2 text-left">
        <Icon size={15} className="shrink-0" style={{ color: 'var(--text-3)' }} />
        <span className="min-w-0 flex-1 truncate tabular-nums" style={value ? undefined : { color: 'var(--text-3)' }}>{shown}</span>
      </button>
      {clearable && value && (
        <button type="button" onClick={() => onChange(null)} data-testid={testid ? `${testid}-clear` : undefined}
          className="mt-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
          {clearText}
        </button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={label || (kind === 'time' ? 'Time' : 'Date')}>
        <div className="space-y-3">
          <input type={kind} className="input" value={draft} min={min} max={max} autoFocus
            aria-label={label || kind} data-testid={testid ? `${testid}-input` : undefined}
            onChange={(e) => setDraft(e.target.value)} />
          <button type="button" onClick={done} disabled={!draft} data-testid={testid ? `${testid}-done` : undefined}
            className="btn-primary w-full rounded-full py-3 text-sm font-black disabled:opacity-50">
            Done
          </button>
        </div>
      </Modal>
    </div>
  )
}
