import LongList from '../ui/LongList'
import { useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronRight } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import { totals } from '../../sauna/sauna'
import { targetWeeks } from '../../sauna/analytics'
import { compactGrid, weekHeader } from '../../sauna/insights'

const SHADE = [0, 0.3, 0.55, 0.8, 1]
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * The compact grid: 12 week columns, Monday at the top, one hue, darker for more heat
 * minutes. The first sauna week is the leftmost column until there are 12; weeks to come
 * are empty cells. After 12 weeks it shows the latest 12, and a swipe goes back 12 at a time.
 */
function Heatmap({ sessions, today }) {
  const [page, setPage] = useState(0)
  const touch = useRef(null)
  const g = useMemo(() => compactGrid(sessions, today, page), [sessions, today, page])
  const cell = 20
  const gap = 3
  const L = 16
  const W = L + 12 * (cell + gap)
  const H = 7 * (cell + gap)
  const swipe = (dx) => {
    if (dx > 40 && page < g.pages - 1) setPage(page + 1)
    if (dx < -40 && page > 0) setPage(page - 1)
  }
  return (
    <div onTouchStart={(e) => { touch.current = e.touches[0].clientX }} onTouchEnd={(e) => { if (touch.current != null) swipe(e.changedTouches[0].clientX - touch.current); touch.current = null }}>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full" style={{ maxHeight: 180 }} role="img" aria-label="Heat minutes by day, 12 weeks from your first sauna week" data-testid="sauna-heatmap" data-page={g.page} data-pages={g.pages}>
        {DOW.map((d, i) => (i % 2 === 0 ? <text key={i} x={0} y={i * (cell + gap) + cell - 5} fontSize="11" fontWeight="700" fill="var(--text-3)">{d}</text> : null))}
        {g.weeks.map((wk, w) => wk.map((day, i) => (
          <rect key={day.date} x={L + w * (cell + gap)} y={i * (cell + gap)} width={cell} height={cell} rx="4"
            fill={day.level ? 'var(--series-sauna)' : 'var(--surface-sunk)'}
            opacity={day.future ? 0.35 : day.before ? 0.45 : day.level ? SHADE[day.level] : 1}
            stroke={day.future ? 'var(--border)' : 'none'}
            data-testid="heat-cell" data-level={day.level} data-future={day.future ? 'true' : 'false'}>
            <title>{`${format(parseISO(day.date), 'd MMM')}: ${day.minutes} min`}</title>
          </rect>
        )))}
        <text x={L} y={H + 12} fontSize="11" fontWeight="600" fill="var(--text-3)">{format(parseISO(g.from), 'd MMM')}</text>
        <text x={W} y={H + 12} fontSize="11" fontWeight="600" textAnchor="end" fill="var(--text-3)">{format(parseISO(g.weeks[11][0].date), 'd MMM')}</text>
      </svg>
      {g.pages > 1 && (
        <div className="mt-1 flex items-center justify-between text-[13px] font-semibold" style={{ color: 'var(--text-2)' }}>
          <button onClick={() => setPage(Math.min(g.pages - 1, page + 1))} disabled={page >= g.pages - 1} className="disabled:opacity-30" data-testid="heat-earlier">‹ Earlier</button>
          <span style={{ color: 'var(--text-3)' }}>{page === 0 ? 'Latest 12 weeks' : `${page * 12} weeks back`}</span>
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="disabled:opacity-30" data-testid="heat-later">Later ›</button>
        </div>
      )}
    </div>
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
  const header = useMemo(() => weekHeader(sessions, t, target), [sessions, t, target])
  const months = useMemo(() => totals(sessions, 'month').slice(0, 6), [sessions])
  const years = useMemo(() => totals(sessions, 'year'), [sessions])
  return (
    <section className="card space-y-4 p-4" data-testid="sauna-consistency">
      <div>
        <p className="text-[17px] font-semibold tabular-nums" data-testid="sauna-week-header">{header}</p>
        {weeks.text && <p className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }} data-testid="sauna-target-weeks">{weeks.text}</p>}
      </div>
      {sessions.length > 0
        ? <Heatmap sessions={sessions} today={t} />
        : <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }} data-testid="sauna-heatmap-empty">Needs 1 session. You have 0.</p>}
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
