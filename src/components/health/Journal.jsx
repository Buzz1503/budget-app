import useStore from '../../store/useStore'
import { CHECKIN_ITEMS } from '../../lib/healthDefaults'

/** Four 1–5 rows. Tapping the chosen number again clears it. */
export function CheckinRows({ date }) {
  const day = useStore((s) => s.checkins[date]) || {}
  const setCheckin = useStore((s) => s.setCheckin)
  return (
    <div className="space-y-1.5" data-testid="checkin-rows" data-date={date}>
      {CHECKIN_ITEMS.map((item) => (
        <div key={item.key} className="flex items-center gap-2" data-testid={`checkin-${item.key}`}>
          <span className="w-[72px] shrink-0 text-xs font-bold" style={{ color: 'var(--text-2)' }}>{item.label}</span>
          <div className="flex flex-1 gap-1">
            {[1, 2, 3, 4, 5].map((n) => {
              const on = day[item.key] === n
              return (
                <button key={n} onClick={() => setCheckin(date, item.key, n)} aria-pressed={on}
                  aria-label={`${item.label} ${n} of 5`} data-testid={`checkin-${item.key}-${n}`}
                  className="h-8 flex-1 rounded-[10px] text-xs font-black tabular-nums"
                  style={on ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
                  {n}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

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
