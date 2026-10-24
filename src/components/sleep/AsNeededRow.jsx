import { useMemo } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { asNeededLine } from '../../sleep/logging'

const clock = (iso) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ').toLowerCase()

/**
 * The last row of a slot on Home: one line naming the as-needed items, and
 * anything logged from them today. Tap opens the quick sheet. Never due,
 * never counted, never a reminder.
 */
export default function AsNeededRow({ slot, onOpen }) {
  const items = useStore((s) => s.asNeededItems)
  const logs = useStore((s) => s.asNeededLogs)
  const t = todayStr()
  const line = asNeededLine(items, slot)
  const today = useMemo(() => {
    const ids = new Set(items.filter((i) => i.slot === slot).map((i) => i.id))
    // tonight's run from noon (a dose after midnight still shows until the next noon); the morning's from midnight
    const noon = new Date(`${t}T12:00:00`).getTime()
    const since = slot === 'PM' ? (Date.now() < noon ? noon - 86400000 : noon) : new Date(`${t}T00:00:00`).getTime()
    return logs.filter((l) => ids.has(l.itemId) && Date.parse(l.at) >= since).sort((a, b) => a.at.localeCompare(b.at))
  }, [items, logs, slot, t])
  if (!line) return null
  return (
    <button type="button" onClick={onOpen} className="card flex w-full items-center gap-3 p-3 text-left" data-testid="as-needed-row" data-slot={slot}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px]" style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}><Plus size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{line}</span>
        {today.length > 0 && (
          <span className="block truncate text-xs font-semibold tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="as-needed-today">
            {today.map((l) => `${l.name.split(' ')[0]} ${l.amount} ${l.unit} ${clock(l.at)}`).join(' · ')}
          </span>
        )}
      </span>
      <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
    </button>
  )
}
