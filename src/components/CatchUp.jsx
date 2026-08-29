import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, CalendarClock, ChevronRight, Plus, SkipForward } from 'lucide-react'
import useStore, { todayStr } from '../store/useStore'
import Modal from './ui/Modal'
import BackfillSheet from './BackfillSheet'
import { useCalendarRange } from '../lib/useCalendarRange'
import { missedDays, catchUpRun } from '../lib/backfill'
import { addDaysStr, prettyDate } from '../lib/schedule'

// How far back a gap is worth offering to close. Beyond a month it isn't a
// lapse to catch up on any more, it's a different chapter.
const LOOKBACK = 30

export function useMissedRecently() {
  const t = todayStr()
  const cal = useCalendarRange(addDaysStr(t, -LOOKBACK), addDaysStr(t, -1))
  return useMemo(() => {
    const days = missedDays(cal.days)
    return { days, run: catchUpRun(cal.days, t), total: days.reduce((s, d) => s + d.count, 0) }
  }, [cal.days, t])
}

/**
 * The way back in when days have gone unrecorded.
 *
 * Sits on Home rather than only on the calendar, because the person who forgot
 * to log is not the person who goes looking through a calendar for the day they
 * forgot. The badge is the entry point.
 */
export default function CatchUpCard() {
  const { days, run, total } = useMissedRecently()
  const [sheet, setSheet] = useState(null)     // 'run' | 'add'
  const [day, setDay] = useState(null)

  if (total === 0) {
    return (
      <>
        <button onClick={() => setSheet('add')} data-testid="home-add-past-dose"
          className="card flex w-full items-center gap-3 p-3 text-left">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            <Plus size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-black">Add a past dose</span>
            <span className="block text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
              Took something and forgot to log it
            </span>
          </span>
          <ChevronRight size={15} style={{ color: 'var(--text-2)' }} />
        </button>
        <BackfillSheet open={sheet === 'add'} onClose={() => setSheet(null)} />
      </>
    )
  }

  return (
    <>
      <motion.div layout className="card p-3" data-testid="catch-up-card">
        <p className="flex items-center gap-1.5 text-xs font-black" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={13} strokeWidth={3} />
          {total} missed dose{total === 1 ? '' : 's'} over {days.length} day{days.length === 1 ? '' : 's'}
        </p>
        <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Nothing was recorded either way on {days.length === 1 ? prettyDate(days[0].date) : `${prettyDate(days[0].date)} – ${prettyDate(days[days.length - 1].date)}`}.
          Add what you took, or say you skipped it — either one is better than a hole.
        </p>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setSheet('add')} data-testid="catch-up-single"
            className="rounded-full px-3 py-2 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
            One day
          </button>
          <button onClick={() => setSheet('run')} data-testid="catch-up-open"
            className="btn-primary flex-1 rounded-full py-2 text-xs font-black">
            Catch up{run && run.days > 1 ? ` — ${run.days} days` : ''}
          </button>
        </div>
      </motion.div>

      <CatchUpSheet open={sheet === 'run'} days={days} run={run}
        onClose={() => setSheet(null)} onPickDay={(d) => { setSheet(null); setDay(d) }} />
      <BackfillSheet open={sheet === 'add' || !!day} date={day} onClose={() => { setSheet(null); setDay(null) }} />
    </>
  )
}

/**
 * The gap, day by day.
 *
 * Skipping the whole run is one tap, because "I was away" needs no further
 * detail. Logging is not, and is not pretended to be: every injection has to
 * say where it went, or the rotation history it feeds becomes fiction. So each
 * day opens its own list rather than being swept in behind a single button.
 */
function CatchUpSheet({ open, days, run, onClose, onPickDay }) {
  const skipMany = useStore((s) => s.skipMany)
  const showToast = useStore((s) => s.showToast)
  const [confirmSkip, setConfirmSkip] = useState(false)

  const skipRun = () => {
    let n = 0
    for (const d of days) {
      for (const g of d.groups) {
        skipMany(g.items.map((i) => i.peptideId), 'Catch-up — away', d.date)
        n += g.items.length
      }
    }
    showToast(`${n} dose${n === 1 ? '' : 's'} marked skipped`)
    setConfirmSkip(false)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Catch up">
      {confirmSkip ? (
        <div className="space-y-3" data-testid="catch-up-confirm-skip">
          <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Every missed dose across{' '}
            <span className="font-black" style={{ color: 'var(--text)' }}>
              {days.length} day{days.length === 1 ? '' : 's'}
            </span>{' '}
            is recorded as deliberately skipped. Nothing comes out of any vial, because nothing was
            taken — your run-out dates stay where they are, and those days stop reading as lapses.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmSkip(false)} className="flex-1 rounded-full py-3 text-xs font-black"
              style={{ background: 'var(--surface-sunk)', color: 'var(--text-2)' }}>
              Go back
            </button>
            <button onClick={skipRun} data-testid="catch-up-skip-yes"
              className="flex-1 rounded-full py-3 text-xs font-black"
              style={{ background: 'color-mix(in srgb, var(--warn) 22%, transparent)', color: 'var(--warn)' }}>
              Mark them all skipped
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {run && run.days > 1 && (
            <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }}>
              <p className="flex items-center gap-1.5 text-xs font-black">
                <CalendarClock size={13} style={{ color: 'var(--text-2)' }} />
                {run.days} days in a row, {prettyDate(run.from)} to {prettyDate(run.to)}
              </p>
            </div>
          )}

          <div className="space-y-2" data-testid="catch-up-days">
            {days.map((d) => (
              <button key={d.date} onClick={() => onPickDay(d.date)} data-testid="catch-up-day"
                className="flex w-full items-center gap-2 rounded-[14px] p-3 text-left"
                style={{ background: 'var(--surface-sunk)' }}>
                <AlertCircle size={13} className="shrink-0" strokeWidth={3} style={{ color: 'var(--danger)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-black">{prettyDate(d.date)}</span>
                  <span className="block truncate text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                    {d.groups.map((g) => g.items.map((i) => i.name).join(' + ')).concat(d.orals.map((o) => o.name)).join(', ')}
                  </span>
                </span>
                <ChevronRight size={14} style={{ color: 'var(--text-2)' }} />
              </button>
            ))}
          </div>

          <button onClick={() => setConfirmSkip(true)} data-testid="catch-up-skip-all"
            className="flex w-full items-center justify-center gap-2 rounded-full py-3 text-xs font-black"
            style={{ background: 'var(--surface-sunk)', color: 'var(--warn)' }}>
            <SkipForward size={13} /> I was away — mark them all skipped
          </button>

          <p className="pb-1 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Skipping is one tap because it needs no detail. Logging isn't: each injection still has to say
            where it went, or the rotation history it feeds stops being true.
          </p>
        </div>
      )}
    </Modal>
  )
}
