import { useState } from 'react'
import useStore from '../../store/useStore'
import { WAKE_REASONS, shouldAskWhy } from '../../sleep/wakeDetail'

/**
 * One small row on the Today card the morning after 2 or more wake-ups:
 * "Why did you wake?" with chips, several at once, skippable. Never a
 * notification, never asked twice for the same night.
 */
export default function WhyWokeRow({ date, wakeCount }) {
  const saved = useStore((s) => s.wakeReasons)
  const save = useStore((s) => s.setWakeReasons)
  const skip = useStore((s) => s.skipWakeReasons)
  const [picked, setPicked] = useState([])
  if (!shouldAskWhy(date, wakeCount, saved)) return null
  const toggle = (t) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))
  return (
    <div className="mt-3 rounded-[10px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid="why-woke">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-semibold">Why did you wake?</p>
        <button onClick={() => skip(date)} className="text-[13px] font-semibold" style={{ color: 'var(--text-3)' }} data-testid="why-woke-skip">Skip</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {WAKE_REASONS.map((t) => (
          <button key={t} onClick={() => toggle(t)} aria-pressed={picked.includes(t)} data-testid={`why-${t}`}
            className="min-h-[32px] rounded-full px-3 text-xs font-bold"
            style={picked.includes(t) ? { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' } : { background: 'var(--surface)', color: 'var(--text-2)', border: '1px solid transparent' }}>
            {t}
          </button>
        ))}
      </div>
      {picked.length > 0 && (
        <button onClick={() => save(date, picked)} className="btn-primary mt-2 w-full rounded-full py-2 text-sm font-black" data-testid="why-woke-save">Save</button>
      )}
    </div>
  )
}
