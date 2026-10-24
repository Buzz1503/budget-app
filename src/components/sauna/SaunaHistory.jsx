import LongList from '../ui/LongList'
import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronRight } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { heatmap, totals } from '../../sauna/sauna'
import { targetWeeks } from '../../sauna/analytics'

const SHADE = [0, 0.3, 0.55, 0.8, 1]
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Twelve weeks as columns, Monday at the top; one hue, darker for more heat minutes. */
function Heatmap({ sessions, today }) {
  const weeks = heatmap(sessions, today)
  const cell = 18
  const gap = 4
  const L = 14
  const W = L + weeks.length * (cell + gap)
  const H = 7 * (cell + gap)
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" role="img" aria-label="Heat minutes by day over the last 12 weeks" data-testid="sauna-heatmap">
      {DOW.map((d, i) => <text key={i} x={0} y={i * (cell + gap) + cell - 5} fontSize="8" fontWeight="700" fill="var(--text-3)">{d}</text>)}
      {weeks.map((wk, w) => wk.map((day, i) => (
        <rect key={day.date} x={L + w * (cell + gap)} y={i * (cell + gap)} width={cell} height={cell} rx="4"
          fill={day.level ? 'var(--series-sauna)' : 'var(--surface-sunk)'} opacity={day.future ? 0.25 : day.level ? SHADE[day.level] : 1}
          data-testid="heat-cell" data-level={day.level}>
          <title>{`${format(parseISO(day.date), 'd MMM')}: ${day.minutes} min`}</title>
        </rect>
      )))}
      <text x={L} y={H + 10} fontSize="8" fontWeight="600" fill="var(--text-3)">{format(parseISO(weeks[0][0].date), 'd MMM')}</text>
      <text x={W} y={H + 10} fontSize="8" fontWeight="600" textAnchor="end" fill="var(--text-3)">This week</text>
    </svg>
  )
}

function Totals({ rows, label, fmt }) {
  return (
    <div>
      <p className="t-caption" style={{ color: 'var(--text-3)' }}>{label}</p>
      {rows.map((m) => (
        <p key={m.key} className="mt-1 flex justify-between text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
          <span>{fmt(m.key)}</span><span style={{ color: 'var(--text)' }}>{m.sessions} · {m.hours} h</span>
        </p>
      ))}
    </div>
  )
}

/** Weeks hitting the target in the last 8, the 12-week heatmap, and monthly and yearly totals. */
export function Consistency() {
  const sessions = useStore((s) => s.saunaSessions)
  const target = useStore((s) => s.saunaSettings.weeklyTarget)
  const t = todayStr()
  const weeks = useMemo(() => targetWeeks(sessions, t, target), [sessions, t, target])
  const months = useMemo(() => totals(sessions, 'month').slice(0, 6), [sessions])
  const years = useMemo(() => totals(sessions, 'year'), [sessions])
  return (
    <section className="card space-y-4 p-4" data-testid="sauna-consistency">
      {weeks.text && <p className="text-sm font-bold tabular-nums" data-testid="sauna-target-weeks">{weeks.text}</p>}
      <Heatmap sessions={sessions} today={t} />
      {sessions.length > 0 && (
        <div data-testid="sauna-totals">
          <div className="grid grid-cols-2 gap-4">
            <Totals rows={months} label="By month" fmt={(k) => format(parseISO(`${k}-01`), 'MMM yyyy')} />
            <Totals rows={years} label="By year" fmt={(k) => k} />
          </div>
          <p className="mt-2 text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Sessions · hours</p>
        </div>
      )}
    </section>
  )
}

const PAGE = 20

/** Every session, newest first; tap one for its detail, edit and delete. */
export function HistoryList({ onOpen }) {
  const sessions = useStore((s) => s.saunaSessions)
  const list = useMemo(() => [...sessions].sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)), [sessions])
  if (!list.length) return <p className="px-1 text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="sauna-history-empty">No sessions yet.</p>
  return (
    <LongList as="section" items={list} keyOf={(s) => s.id} step={PAGE} rowHeight={60} className="card rows overflow-hidden" testid="sauna-list"
      renderItem={(s) => (
        <button onClick={() => onOpen(s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left" data-testid="sauna-list-row">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold tabular-nums">{format(parseISO(s.date), 'EEE d MMM yyyy')} · {s.start}</span>
            <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>
              {s.lengthMin} min at {s.tempC} C · {s.type}{s.hr?.samples?.length ? ' · Watch' : ''}{s.rating?.feel != null ? ` · felt ${s.rating.feel} of 5` : ''}
            </span>
          </span>
          <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
        </button>
      )} />
  )
}
