import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { ChevronRight } from 'lucide-react'
import useStore, { todayStr } from '../../store/useStore'
import TrendChart from '../charts/TrendChart'
import useChartEvents from '../charts/useChartEvents'
import { heatmap, totals } from '../../sauna/sauna'

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

const dailyMean = (sessions, key) => {
  const by = new Map()
  for (const s of sessions) by.set(s.date, [...(by.get(s.date) || []), s[key]])
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, xs]) => ({ date, value: xs.reduce((a, b) => a + b, 0) / xs.length }))
}

export default function SaunaHistory({ onOpen }) {
  const sessions = useStore((s) => s.saunaSessions)
  const events = useChartEvents()
  const t = todayStr()
  const months = useMemo(() => totals(sessions, 'month').slice(0, 6), [sessions])
  const years = useMemo(() => totals(sessions, 'year'), [sessions])
  const list = useMemo(() => [...sessions].sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)), [sessions])
  const length = useMemo(() => dailyMean(sessions, 'lengthMin'), [sessions])
  const temp = useMemo(() => dailyMean(sessions, 'tempC'), [sessions])
  return (
    <div className="space-y-3" data-testid="sauna-history">
      <section className="card p-4"><Heatmap sessions={sessions} today={t} /></section>
      {sessions.length > 0 && (
        <section className="card p-4" data-testid="sauna-totals">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="t-caption" style={{ color: 'var(--text-3)' }}>By month</p>
              {months.map((m) => (
                <p key={m.key} className="mt-1 flex justify-between text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
                  <span>{format(parseISO(`${m.key}-01`), 'MMM yyyy')}</span><span style={{ color: 'var(--text)' }}>{m.sessions} · {m.hours} h</span>
                </p>
              ))}
            </div>
            <div>
              <p className="t-caption" style={{ color: 'var(--text-3)' }}>By year</p>
              {years.map((y) => (
                <p key={y.key} className="mt-1 flex justify-between text-sm font-medium tabular-nums" style={{ color: 'var(--text-2)' }}>
                  <span>{y.key}</span><span style={{ color: 'var(--text)' }}>{y.sessions} · {y.hours} h</span>
                </p>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[11px] font-medium" style={{ color: 'var(--text-3)' }}>Sessions · hours</p>
        </section>
      )}
      {list.length > 0 && (
        <section className="card rows overflow-hidden" data-testid="sauna-list">
          {list.slice(0, 30).map((s) => (
            <button key={s.id} onClick={() => onOpen(s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left" data-testid="sauna-list-row">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold tabular-nums">{format(parseISO(s.date), 'EEE d MMM')} · {s.start}</span>
                <span className="block text-xs font-medium tabular-nums" style={{ color: 'var(--text-3)' }}>{s.lengthMin} min at {s.tempC} C · {s.type}</span>
              </span>
              <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
            </button>
          ))}
        </section>
      )}
      {sessions.length > 1 && (
        <>
          <TrendChart metric="saunaLength" title="Session length" unit="min" dp={0} series={length} events={events} defaultRange="90D" />
          <TrendChart metric="saunaTemp" title="Temperature" unit="C" dp={0} series={temp} events={events} defaultRange="90D" />
        </>
      )}
    </div>
  )
}
