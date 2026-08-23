import { motion } from 'framer-motion'

/**
 * A progress ring. One flat stroke on a visible track — no gradient, no glow,
 * because a shadow that carries a colour is decoration and the system spends
 * colour only on meaning. pct: 0..1
 */
export default function Ring({
  pct, size = 72, stroke = 6,
  color = 'var(--text)', track = 'var(--surface-sunk)', children,
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, pct || 0))

  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - clamped) }}
          transition={{ type: 'spring', stiffness: 60, damping: 15 }}
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  )
}
