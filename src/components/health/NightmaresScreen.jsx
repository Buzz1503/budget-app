import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import Modal from '../ui/Modal'
import { todayStr } from '../../store/useStore'
import { addDays } from '../../health/tz'
import { agreement, NIGHTMARE_LABEL, HR_NOTE, NIGHTMARES } from '../../sleep/nightmares'
import { BackHeader, Updating } from './SleepAnalysis'
import useSleepAnalysis from './useSleepAnalysis'

const muted = { color: 'var(--text-3)' }
const soft = { color: 'var(--text-2)' }
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Six weeks of nights: confirmed by your answer, Likely, or Possible. */
function NightsCalendar({ marks }) {
  const t = todayStr()
  const dow = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7
  const start = addDays(t, -dow - 35)
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  return (
    <div data-testid="nightmare-calendar">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold" style={muted}>{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((d) => {
          const m = marks.get(d)
          const fill = m === 'confirmed' ? 'var(--text)' : m === 'Likely' ? 'var(--text-2)' : m === 'Possible' ? 'var(--surface2)' : 'var(--surface-sunk)'
          return (
            <div key={d} className="flex aspect-square items-center justify-center rounded-[10px] text-[11px] font-bold tabular-nums"
              style={{ background: fill, color: m === 'confirmed' || m === 'Likely' ? 'var(--bg)' : d > t ? 'var(--text-3)' : 'var(--text-2)', opacity: d > t ? 0.3 : 1 }}
              data-testid="nightmare-day" data-mark={m || ''} title={m ? `${format(parseISO(d), 'd MMM')}: ${m === 'confirmed' ? 'your answer' : m}` : undefined}>
              {Number(d.slice(8))}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] font-medium" style={muted}>Darkest: you answered Nightmare or Vivid. Then Likely, then Possible.</p>
    </div>
  )
}

/** Sleep › Nightmares: likely and confirmed nights, agreement with your answers, and what goes with them. */
export default function NightmaresScreen({ lab, onBack }) {
  const { result: r, updating } = useSleepAnalysis(lab)
  const [info, setInfo] = useState(false)
  const nights = useMemo(() => [...lab.extras.values()].filter((e) => e.rating), [lab])
  const marks = useMemo(() => new Map(nights.map((e) => [e.night.date, e.truth ? 'confirmed' : e.rating === 'Unlikely' ? null : e.rating])), [nights])
  const agree = agreement(nights.map((e) => ({ rating: e.rating, truth: e.truth })))
  const rows = useMemo(() => (r ? [...r.factors.comparisons, ...r.carryOver].filter((c) => c.outcome === 'nightmare')
    .sort((a, b) => (a.label === b.label ? Math.abs(b.diff) - Math.abs(a.diff) : a.label === 'Clear' ? -1 : 1)) : []), [r])
  const recent = nights.filter((e) => e.rating !== 'Unlikely' || e.truth).sort((a, b) => b.night.date.localeCompare(a.night.date)).slice(0, 8)
  return (
    <div className="space-y-4" data-testid="lab-nightmares">
      <BackHeader title="Nightmares" onBack={onBack} info={() => setInfo(true)} sub={`${NIGHTMARE_LABEL}. From heart rate surges in sleep, checked against your morning answers.`} />
      <section className="card p-4">
        <NightsCalendar marks={marks} />
      </section>
      <section className="card p-4" data-testid="nightmare-agreement">
        <p className="t-label">How well it matches you</p>
        <p className="mt-1 text-sm font-medium" style={soft}>{agree.text || 'Answer Dreams in the morning check and the estimate is checked against it here.'}</p>
        <p className="mt-1 text-[11px] font-medium" style={muted}>
          {lab.calibration.personal
            ? `Thresholds fitted to your ${lab.calibration.confirmed} confirmed nights.`
            : `Thresholds are fitted to you once ${NIGHTMARES.calibrateFrom} nights are confirmed (you have ${lab.calibration.confirmed}).`}
        </p>
      </section>
      {recent.length > 0 && (
        <section className="card rows p-0" data-testid="nightmare-nights">
          {recent.map((e) => (
            <div key={e.night.date} className="px-4 py-3">
              <p className="text-sm font-bold">{format(parseISO(e.night.date), 'EEE d MMM')}<span className="ml-2 text-xs font-medium" style={muted}>{e.truth ? 'You answered yes' : e.rating}</span></p>
              {(e.events || []).length > 0 && (
                <p className="text-xs font-medium tabular-nums" style={soft}>
                  {e.events.map((ev) => `${format(new Date(ev.t), 'h:mm a').toLowerCase()} +${ev.surge} bpm${ev.rem ? ', REM' : ''}${ev.awakeAfter ? ', woke' : ''}${ev.movement ? ', moved' : ''}`).join(' · ')}
                </p>
              )}
            </div>
          ))}
        </section>
      )}
      <section className="card p-4" data-testid="nightmare-goes">
        <p className="t-label">What goes with nightmare nights</p>
        <Updating on={updating} />
        {rows.length ? rows.slice(0, 8).map((c) => (
          <div key={`${c.factor}-${c.outcome}`} className="mt-2">
            <p className="text-sm font-medium" style={soft}>{c.text}</p>
            <p className="text-[11px] font-bold tabular-nums" style={muted}>{c.label} · {c.nWith} nights with, {c.nWithout} without</p>
          </div>
        )) : <p className="mt-1 text-sm font-medium" style={soft}>Appears once a factor has 7 nights with and 7 without, each with a nightmare answer or estimate.</p>}
      </section>
      <p className="px-1 text-[11px] font-medium" style={muted}>{HR_NOTE}</p>
      <Modal open={info} onClose={() => setInfo(false)} title="How nightmares are estimated">
        <div className="space-y-2 text-sm font-medium" style={soft} data-testid="nightmare-info">
          <p>An event is a heart rate jump of {NIGHTMARES.surgeBpm} bpm or more over your sleeping heart rate of the half hour before, rising within {NIGHTMARES.riseWithinMin} minutes and lasting at least a minute.</p>
          <p>It counts for more when it happens in or just after REM sleep, is followed by waking within 5 minutes, comes with wrist movement, or your breathing rate that night was above your usual.</p>
          <p>Your morning answers are the ground truth. Once {NIGHTMARES.calibrateFrom} nights are confirmed, the thresholds are fitted to you.</p>
          <p>{HR_NOTE}</p>
        </div>
      </Modal>
    </div>
  )
}
