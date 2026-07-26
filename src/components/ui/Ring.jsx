import { motion } from 'framer-motion'
import { useId } from 'react'

// Animated SVG progress ring with a gradient stroke + soft glow. At 0 it gently
// pulses to beckon; at 1 the glow intensifies. pct: 0..1
export default function Ring({
  pct, size = 64, stroke = 7,
  from = 'var(--lime)', to = 'var(--lime-deep)',
  track = 'var(--surface2)', glow = true, children,
}) {
  const uid = useId().replace(/:/g, '')
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, pct || 0))
  const full = clamped >= 0.999
  const empty = clamped <= 0.001

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      {glow && (
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-full"
          initial={false}
          animate={{
            boxShadow: full
              ? `0 0 26px 4px color-mix(in srgb, ${from} 55%, transparent)`
              : empty
                ? [`0 0 0px 0px color-mix(in srgb, ${from} 30%, transparent)`, `0 0 16px 2px color-mix(in srgb, ${from} 22%, transparent)`, `0 0 0px 0px color-mix(in srgb, ${from} 30%, transparent)`]
                : `0 0 14px 1px color-mix(in srgb, ${from} 30%, transparent)`,
          }}
          transition={empty && !full ? { duration: 2.2, repeat: Infinity } : { duration: 0.5 }}
          style={{ margin: stroke / 2 }}
        />
      )}
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={`ring-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={`url(#ring-${uid})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - clamped) }}
          transition={{ type: 'spring', stiffness: 60, damping: 15 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}
