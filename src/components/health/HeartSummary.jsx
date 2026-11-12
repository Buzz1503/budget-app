import { InfoButton } from '../ui/Glance'
import { heartSummary, timeToLowWords, SLEEP_HR_INFO } from '../../health/heart'
import { clockOf } from '../../health/engine/sleepView'
import { clockFromNoon } from '../../health/engine/sleep'

const TONE = { better: 'var(--good)', worse: 'var(--warn)' }

/**
 * Last night's heart rate in plain sentences, from the Heart data (useHeart):
 * the numbers, the dip against the typical range, the good sleep period and
 * a run of nights rising or falling. Only the key words carry colour.
 */
export function HeartSummaryText({ heart, date = null, className = 'mt-2' }) {
  const d = date || [...heart.hearts.keys()].sort().at(-1)
  const h = d ? heart.hearts.get(d) : null
  if (!h) return null
  const recent = [...heart.lookups.sleepHR.entries()].filter(([x]) => x <= d).sort((a, b) => a[0].localeCompare(b[0])).slice(-8).map(([, v]) => v)
  const parts = heartSummary({ heart: h, clock: (ms) => clockOf(clockFromNoon(ms, heart.tz)), refAvg: heart.table.ref.sleepHR?.mean ?? null, recentAvgs: recent })
  const low = timeToLowWords(h.timeToLowMin)
  return (
    <div className={`flex items-start gap-1 ${className}`}>
      <p className="min-w-0 flex-1 text-sm font-medium leading-relaxed" style={{ color: 'var(--text-2)' }} data-testid="heart-summary">
        {parts.map((p, i) => <span key={i} style={p.tone ? { color: TONE[p.tone], fontWeight: 600 } : undefined}>{p.text}</span>)}
        {low && <span className="block" data-testid="heart-time-to-low">{low}</span>}
      </p>
      <InfoButton title="Heart rate while you sleep">
        {SLEEP_HR_INFO.map((x) => <p key={x}>{x}</p>)}
      </InfoButton>
    </div>
  )
}
