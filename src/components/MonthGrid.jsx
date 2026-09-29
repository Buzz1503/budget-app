import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { format, parseISO } from 'date-fns'
import { ChevronDown, ChevronRight, Droplet, HeartPulse } from 'lucide-react'
import { monthSummary } from '../lib/calendarView'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * A month at a glance.
 *
 * A cell is about fifty pixels across, which is room for a date and almost
 * nothing else — so this does not try to name compounds. The ring says how much
 * of the day got logged, and the dots underneath say what the rest of it did.
 * Anything more specific belongs in the day sheet, one tap away.
 *
 * Colour is the only thing carrying status here, which would normally be a
 * problem, so every cell's aria-label spells the day out in words and the
 * legend names each colour rather than expecting it to be learned.
 */

export const DOT_META = {
  logged: { label: 'Logged', tone: 'var(--good)' },
  missed: { label: 'Missed', tone: 'var(--danger)' },
  skipped: { label: 'Skipped', tone: 'var(--warn)' },
  pushed: { label: 'Pushed', tone: 'var(--info)' },
  paused: { label: 'Paused', tone: 'var(--text-3)' },
}
const DOT_ORDER = ['missed', 'logged', 'skipped', 'pushed', 'paused']
const MAX_DOTS = 4

/** The dots one day earns, worst first, capped so a busy day still fits. */
export function dotsFor(day) {
  if (!day) return { dots: [], extra: 0 }
  const counts = {
    logged: day.done || 0,
    missed: day.missed || 0,
    skipped: day.skipped || 0,
    pushed: day.pushedOff || 0,
    paused: day.paused || 0,
  }
  const present = DOT_ORDER.filter((k) => counts[k] > 0)
  const dots = present.slice(0, MAX_DOTS).map((k) => ({ kind: k, count: counts[k] }))
  const extra = present.slice(MAX_DOTS).reduce((n, k) => n + counts[k], 0)
  return { dots, extra }
}

/** How much of what the day owed actually got logged, 0–1. */
export function completion(day) {
  if (!day) return 0
  const owed = day.owed ?? day.scheduled
  if (!(owed > 0)) return 0
  return Math.min(1, (day.done || 0) / owed)
}

export default function MonthGrid({ cal, anchor, todayStr: t, onOpenDay }) {
  const inMonth = (date) => date.slice(0, 7) === anchor.slice(0, 7)
  const monthDays = useMemo(() => cal.days.filter((d) => inMonth(d.date)), [cal.days, anchor]) // eslint-disable-line react-hooks/exhaustive-deps
  const sum = useMemo(() => monthSummary(monthDays, t), [monthDays, t])
  const [legend, setLegend] = useState(false)

  return (
    <div className="space-y-3" data-testid="month-grid">
      {/* the month in numbers */}
      <div className="card p-3" data-testid="month-summary">
        <div className="flex items-baseline gap-2">
          <p className="t-metric-sm tabular-nums">
            {sum.logged}<span className="text-sm font-bold" style={{ color: 'var(--text-3)' }}>/{sum.scheduled}</span>
          </p>
          <p className="min-w-0 flex-1 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
            doses logged{sum.pct != null ? ` · ${sum.pct}%` : ''}
          </p>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold tabular-nums"
          style={{ color: 'var(--text-3)' }}>
          <span data-testid="sum-complete">{sum.complete} full day{sum.complete === 1 ? '' : 's'}</span>
          {sum.missed > 0 && <span data-testid="sum-missed" style={{ color: 'var(--danger)' }}>{sum.missed} missed</span>}
          {sum.skipped > 0 && <span data-testid="sum-skipped">{sum.skipped} skipped</span>}
          {sum.pushed > 0 && <span data-testid="sum-pushed">{sum.pushed} pushed</span>}
          {sum.pausedDays > 0 && <span data-testid="sum-paused">{sum.pausedDays} day{sum.pausedDays === 1 ? '' : 's'} paused</span>}
        </div>
        <p className="mt-1 text-xs font-medium" style={{ color: 'var(--text-3)' }}>
          Counted over the {sum.days} day{sum.days === 1 ? '' : 's'} of this month that have happened.
        </p>
      </div>

      {/* the grid */}
      <div className="card p-2">
        <div className="grid grid-cols-7 gap-1">
          {DOW.map((w, i) => (
            <p key={i} className="pb-1 text-center text-xs font-black" style={{ color: 'var(--text-3)' }}>{w}</p>
          ))}
          {cal.days.map((d) => (
            <DayCell key={d.date} day={d} muted={!inMonth(d.date)} onOpen={() => onOpenDay(d.date)} />
          ))}
        </div>
      </div>

      {/* legend — folded away, because it is read once and then never again */}
      <div className="card overflow-hidden">
        <button onClick={() => setLegend((v) => !v)} aria-expanded={legend} data-testid="legend-toggle"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
          {legend ? <ChevronDown size={14} style={{ color: 'var(--text-3)' }} />
            : <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />}
          <span className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>What the marks mean</span>
        </button>
        <AnimatePresence initial={false}>
          {legend && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} className="overflow-hidden" data-testid="legend">
              <div className="space-y-2 px-3 pb-3" style={{ borderTop: '1px solid var(--border)' }}>
                <p className="pt-2.5 text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  The ring around a date fills with the share of that day's doses you logged.
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {DOT_ORDER.map((k) => (
                    <span key={k} className="flex items-center gap-1.5 text-xs font-bold">
                      <span className="h-2 w-2 rounded-full" style={{ background: DOT_META[k].tone }} />
                      {DOT_META[k].label}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <HeartPulse size={11} style={{ color: 'var(--violet)' }} /> Symptoms logged
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <Droplet size={11} style={{ color: 'var(--info)' }} /> Blood test
                  </span>
                </div>
                <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  A day the protocol was paused is greyed out across the whole cell — nothing on it counts
                  as missed.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

const R = 15           // ring radius
const C = 2 * Math.PI * R

function DayCell({ day: d, muted, onOpen }) {
  const pct = completion(d)
  const { dots, extra } = dotsFor(d)
  const owed = d.owed ?? d.scheduled
  const hasSymptom = !!d.symptom
  const hasBlood = !!d.bloodTests?.length

  // said in words, because the ring and the dots are colour and shape only
  const label = [
    format(parseISO(d.date), 'd MMMM'),
    d.wholeDayPaused ? `paused${d.pauseReason ? ` — ${d.pauseReason}` : ''}`
      : owed > 0 ? `${d.done} of ${owed} logged` : 'nothing scheduled',
    d.missed > 0 ? `${d.missed} missed` : null,
    hasSymptom ? 'symptoms logged' : null,
    hasBlood ? 'blood test' : null,
  ].filter(Boolean).join(', ')

  return (
    <button onClick={onOpen} data-testid={`cal-cell-${d.date}`} aria-label={label}
      data-paused={d.wholeDayPaused ? 'true' : 'false'}
      data-adherence={d.adherence}
      className="relative flex aspect-square flex-col items-center justify-center rounded-[12px]"
      style={{
        opacity: muted ? 0.28 : d.wholeDayPaused ? 0.55 : 1,
        // a paused day is greyed across the whole cell rather than marked in a
        // corner: the fact is about the day, not about one dose on it
        background: d.wholeDayPaused ? 'var(--surface-sunk)' : 'transparent',
      }}>
      <span className="relative flex h-[34px] w-[34px] items-center justify-center">
        {owed > 0 && (
          <svg className="absolute inset-0" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r={R} fill="none" stroke="var(--surface-sunk)" strokeWidth="3" />
            {pct > 0 && (
              <circle cx="18" cy="18" r={R} fill="none" stroke="var(--good)" strokeWidth="3"
                strokeLinecap="round" data-testid="day-ring"
                strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 18 18)" />
            )}
          </svg>
        )}
        <span className="relative text-xs font-black leading-none tabular-nums"
          style={d.isToday ? { color: 'var(--accent-fg)' } : undefined}>
          {d.isToday && (
            <span className="absolute left-1/2 top-1/2 -z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: 'var(--accent)' }} />
          )}
          {format(parseISO(d.date), 'd')}
        </span>
      </span>

      {/* what happened, at two pixels a fact */}
      <span className="mt-0.5 flex h-2 items-center justify-center gap-[2px]" data-testid="day-dots">
        {dots.map((dot) => (
          <span key={dot.kind} data-testid="day-dot" data-kind={dot.kind}
            className="h-[5px] w-[5px] rounded-full" style={{ background: DOT_META[dot.kind].tone }} />
        ))}
        {extra > 0 && (
          <span className="text-[7px] font-black leading-none" style={{ color: 'var(--text-3)' }}>+{extra}</span>
        )}
      </span>

      {/* not doses, so deliberately not dots — they sit in the corner instead */}
      {(hasSymptom || hasBlood) && (
        <span className="absolute right-0.5 top-0.5 flex gap-px">
          {hasSymptom && <HeartPulse size={8} data-testid="day-symptom" style={{ color: 'var(--violet)' }} />}
          {hasBlood && <Droplet size={8} data-testid="day-blood" style={{ color: 'var(--info)' }} />}
        </span>
      )}
    </button>
  )
}
