import { useState } from 'react'
import { Flame, Check } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { weekSummary } from '../../sauna/sauna'
import SaunaLogSheet from './SaunaLogSheet'

/** The last row of Home's log: this week's sessions, and a tap to log one. */
export default function SaunaHomeRow() {
  const sessions = useStore((s) => s.saunaSessions)
  const target = useStore((s) => s.saunaSettings.weeklyTarget)
  const [open, setOpen] = useState(false)
  const t = todayStr()
  const week = weekSummary(sessions, t, target)
  const doneToday = sessions.some((s) => s.date === t)
  return (
    <>
      <button onClick={() => setOpen(true)} className="card flex w-full items-center gap-3 p-4 text-left" data-testid="home-sauna-row">
        <Flame size={18} className="shrink-0" style={{ color: 'var(--text-2)' }} />
        <span className="min-w-0 flex-1">
          <span className="t-label block">Sauna</span>
          <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }} data-testid="home-sauna-week">
            {week.count} of {week.target} this week{doneToday ? ' · done today' : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black" style={{ background: 'var(--surface-sunk)', color: 'var(--text)' }}>
          {doneToday && <Check size={12} />} Log
        </span>
      </button>
      <SaunaLogSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
