import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import Modal from '../ui/Modal'
import PickerField from '../ui/PickerField'
import { addDays } from '../../health/tz'
import { EVENING_FACTORS, WOKEN_BY, defaultMealTime, eveningAnswered } from '../../sleep/logging'

const chip = (on) => (on ? { background: 'var(--text)', color: 'var(--bg)' } : { background: 'var(--surface-sunk)', color: 'var(--text-2)' })

/**
 * The evening factors for one date, grouped and all optional: drinks and the
 * last one's time, the last meal, then one-tap yes or no for the rest. Shared
 * by the evening sheet and the calendar day sheet.
 */
export function EveningFactors({ date }) {
  const habits = useStore((s) => s.habits)
  const row = useStore((s) => s.habitLogs[date]) || {}
  const details = useStore((s) => s.eveningDetails)
  const detail = details[date] || {}
  const setHabit = useStore((s) => s.setHabit)
  const setDetail = useStore((s) => s.setEveningDetail)
  const nothing = useStore((s) => s.answerNothingUnusual)
  const shown = habits.filter((h) => !h.hidden && h.id !== 'alcohol')
  const drinks = detail.drinks ?? null
  const mealDefault = useMemo(() => defaultMealTime(details, date, addDays), [details, date])
  const allNo = eveningAnswered(row, detail) && shown.every((h) => row[h.id] === false) && !drinks

  const setDrinks = (n) => {
    const v = Math.max(0, n)
    setDetail(date, { drinks: v, ...(v === 0 ? { lastDrinkAt: null } : {}) })
    setHabit(date, 'alcohol', v > 0)
  }
  const toggle = (h) => {
    const on = row[h.id] === true
    setHabit(date, h.id, !on)
    if (h.id === 'woken' && on) setDetail(date, { wokenBy: [] })
  }
  const who = (w) => {
    const list = detail.wokenBy || []
    const next = list.includes(w) ? list.filter((x) => x !== w) : [...list, w]
    setDetail(date, { wokenBy: next })
    if (next.length && row.woken !== true) setHabit(date, 'woken', true)
  }

  return (
    <div className="space-y-4" data-testid="evening-factors" data-date={date}>
      <button type="button" onClick={() => nothing(date)} aria-pressed={allNo} data-testid="evening-nothing"
        className="w-full rounded-full py-2.5 text-sm font-black" style={chip(allNo)}>
        Nothing unusual
      </button>

      <div>
        <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Alcohol</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDrinks((drinks || 0) - 1)} aria-label="Fewer drinks" data-testid="evening-drinks-minus"
            className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'var(--surface-sunk)' }}><Minus size={16} /></button>
          <p className="min-w-[96px] text-center text-lg font-black tabular-nums" data-testid="evening-drinks">
            {drinks == null ? 'Not set' : `${drinks} drink${drinks === 1 ? '' : 's'}`}
          </p>
          <button type="button" onClick={() => setDrinks((drinks || 0) + 1)} aria-label="More drinks" data-testid="evening-drinks-plus"
            className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'var(--surface-sunk)' }}><Plus size={16} /></button>
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>standard drinks</span>
        </div>
        {drinks > 0 && (
          <div className="mt-2">
            <PickerField kind="time" value={detail.lastDrinkAt || null} onChange={(v) => setDetail(date, { lastDrinkAt: v })}
              label="Last drink" emptyText="Time of last drink" testid="evening-last-drink" />
          </div>
        )}
      </div>

      <div>
        <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Last meal</p>
        <PickerField kind="time" value={detail.lastMealAt || null} onChange={(v) => setDetail(date, { lastMealAt: v })}
          label="Last meal" emptyText={mealDefault ? `Usual ${mealDefault}` : 'Time of last meal'} fallback={mealDefault || undefined} testid="evening-last-meal" />
        {!detail.lastMealAt && mealDefault && (
          <button type="button" onClick={() => setDetail(date, { lastMealAt: mealDefault })} data-testid="evening-meal-usual"
            className="mt-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>Use {mealDefault}</button>
        )}
      </div>

      <div>
        <p className="t-caption mb-1" style={{ color: 'var(--text-3)' }}>Anything else</p>
        <div className="flex flex-wrap gap-1.5">
          {shown.map((h) => {
            const on = row[h.id] === true
            return (
              <button key={h.id} type="button" onClick={() => toggle(h)} aria-pressed={on} data-testid={`evening-${h.id}`} data-on={on ? 'true' : 'false'}
                className="min-h-[34px] rounded-full px-3 text-xs font-bold" style={chip(on)}>{h.name}</button>
            )
          })}
        </div>
        {row.woken === true && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="evening-woken-by">
            <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>By</span>
            {WOKEN_BY.map((w) => {
              const on = (detail.wokenBy || []).includes(w)
              return <button key={w} type="button" onClick={() => who(w)} aria-pressed={on} className="min-h-[30px] rounded-full px-2.5 text-xs font-bold" style={chip(on)}>{w}</button>
            })}
          </div>
        )}
      </div>
      <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
        All optional. Once anything is answered, the rest count as no. Edit the list in More › Health.
      </p>
    </div>
  )
}

/** The evening sheet: today's evening (or any past one) in one place. */
export default function EveningSheet({ open, onClose, initialDate = null }) {
  const t = todayStr()
  const [date, setDate] = useState(initialDate || t)
  return (
    <Modal open={open} onClose={onClose} title="This evening">
      <div className="space-y-3" data-testid="evening-sheet">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setDate(addDays(date, -1))} aria-label="Previous evening" className="rounded-full p-2" style={{ background: 'var(--surface-sunk)' }} data-testid="evening-prev"><ChevronLeft size={16} /></button>
          <p className="flex-1 text-center text-sm font-black" data-testid="evening-date">{date === t ? 'Tonight' : date === addDays(t, -1) ? 'Last night' : format(parseISO(date), 'EEE d MMM')}</p>
          <button type="button" onClick={() => setDate(addDays(date, 1))} disabled={date >= t} aria-label="Next evening" className="rounded-full p-2 disabled:opacity-30" style={{ background: 'var(--surface-sunk)' }} data-testid="evening-next"><ChevronRight size={16} /></button>
        </div>
        <EveningFactors date={date} />
        <button type="button" onClick={onClose} className="btn-primary w-full rounded-full py-3 text-base font-black" data-testid="evening-done">Done</button>
      </div>
    </Modal>
  )
}

/** Names for the factor ids, for the analysis and the night view. */
export const factorName = (id) => EVENING_FACTORS.find((f) => f.id === id)?.name || id
