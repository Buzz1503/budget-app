import useStore from '../../store/useStore'

/**
 * Yes/no habits for a day. A tapped habit is a yes; once anything is answered,
 * the untapped ones count as no. "None" records a day with none of them.
 */
export function HabitChips({ date }) {
  const habits = useStore((s) => s.habits)
  const log = useStore((s) => s.habitLogs[date]) || {}
  const setHabit = useStore((s) => s.setHabit)
  const answered = Object.keys(log).length > 0
  const noneDay = answered && habits.every((h) => log[h.id] === false)
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="habit-chips" data-date={date}>
      {habits.map((h) => {
        const on = log[h.id] === true
        return (
          <button key={h.id} onClick={() => setHabit(date, h.id, on ? false : true)} aria-pressed={on}
            data-testid={`habit-${h.id}`} data-on={on ? 'true' : 'false'}
            className="min-h-[30px] rounded-full px-2.5 text-xs font-bold"
            style={on ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            {h.name}
          </button>
        )
      })}
      <button onClick={() => habits.forEach((h) => setHabit(date, h.id, noneDay ? null : false))} aria-pressed={noneDay}
        data-testid="habit-none"
        className="min-h-[30px] rounded-full px-2.5 text-xs font-bold"
        style={noneDay ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-3)' }}>
        None of these
      </button>
    </div>
  )
}
