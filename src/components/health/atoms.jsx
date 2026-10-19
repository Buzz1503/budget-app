import { HEALTH_BANDS } from './bands'

/** The readiness number in a ring. Colour only says which band it is in. */
export function ReadinessRing({ score, band, size = 64, stroke = 6 }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = score == null ? 0 : score / 100
  const tone = band ? HEALTH_BANDS[band].tone : 'var(--text-3)'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={score == null ? 'No readiness score' : `Readiness ${score}`} data-testid="readiness-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunk)" strokeWidth={stroke} />
      {pct > 0 && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      )}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.32} fontWeight="900" fill="var(--text)" className="tabular-nums">
        {score == null ? '–' : score}
      </text>
    </svg>
  )
}

/** A tiny line of the last few weeks, neutral. */
export function Sparkline({ values, width = 72, height = 22 }) {
  const pts = values.filter((v) => v != null)
  if (pts.length < 2) return <span style={{ width, height, display: 'inline-block' }} />
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const step = width / (values.length - 1 || 1)
  const y = (v) => height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4)
  const path = values.map((v, i) => (v == null ? null : `${(i * step).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ')
  return (
    <svg width={width} height={height} aria-hidden="true" data-testid="sparkline">
      <polyline points={path} fill="none" stroke="var(--text-2)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

/** "+3 vs usual" in neutral text: the number, not a judgement. */
export function Delta({ value, unit = '', dp = 0 }) {
  if (value == null) return <span style={{ color: 'var(--text-3)' }}>no baseline yet</span>
  const v = Number(value.toFixed(dp))
  return <span className="tabular-nums" style={{ color: 'var(--text-2)' }}>{v > 0 ? '+' : ''}{v}{unit ? ` ${unit}` : ''} vs usual</span>
}

export function minutesWords(min) {
  if (min == null) return '–'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`
}

export function Stat({ label, value, sub, testid }) {
  return (
    <div className="rounded-[14px] p-3" style={{ background: 'var(--surface-sunk)' }} data-testid={testid}>
      <p className="t-caption" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="mt-0.5 text-lg font-black tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-3)' }}>{sub}</p>}
    </div>
  )
}
