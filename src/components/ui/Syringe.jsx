import { motion } from 'framer-motion'

// Horizontal U-100 insulin syringe with an animated fill to `units` (0–100).
export default function Syringe({ units }) {
  const clamped = Math.max(0, Math.min(100, units || 0))
  const over = units > 100
  const barrelX = 30
  const barrelW = 240
  const fillW = (clamped / 100) * barrelW
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox="0 0 340 84" className="w-full" style={{ maxWidth: 480 }}>
        {/* needle */}
        <rect x="2" y="40" width="22" height="2.5" rx="1" fill="var(--text-2)" />
        {/* barrel */}
        <rect x={barrelX} y="26" width={barrelW} height="30" rx="6" fill="var(--surface-sunk)" stroke="var(--border)" />
        {/* fill */}
        <motion.rect
          x={barrelX} y="26" height="30" rx="6"
          fill={over ? 'var(--danger)' : 'var(--good)'} opacity="0.55"
          initial={false}
          animate={{ width: fillW }}
          transition={{ type: 'spring', stiffness: 70, damping: 16 }}
        />
        {/* draw line */}
        <motion.line
          y1="20" y2="62" stroke={over ? 'var(--danger)' : 'var(--good)'} strokeWidth="2.5"
          initial={false}
          animate={{ x1: barrelX + fillW, x2: barrelX + fillW }}
          transition={{ type: 'spring', stiffness: 70, damping: 16 }}
        />
        {/* ticks every 10u, minor every 5u */}
        {Array.from({ length: 21 }, (_, i) => {
          const x = barrelX + (i * barrelW) / 20
          const major = i % 2 === 0
          return (
            <g key={i}>
              <line x1={x} y1={major ? 30 : 33} x2={x} y2={major ? 42 : 39} stroke="var(--text-2)" strokeWidth="1" opacity="0.7" />
              {major && (
                <text x={x} y="70" textAnchor="middle" fontSize="8.5" fill="var(--text-2)" fontWeight="600">
                  {i * 5}
                </text>
              )}
            </g>
          )
        })}
        {/* plunger */}
        <motion.g initial={false} animate={{ x: fillW }} transition={{ type: 'spring', stiffness: 70, damping: 16 }}>
          <rect x={barrelX + 2} y="28" width="4" height="26" rx="1.5" fill="var(--text)" opacity="0.85" />
          <rect x={barrelX + 6} y="38" width={barrelW * 0.28} height="6" rx="3" fill="var(--text-2)" opacity="0.5" />
        </motion.g>
      </svg>
      {over && (
        <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--danger)' }}>
          Over 100 u — split into multiple syringes or reconstitute stronger.
        </p>
      )}
    </div>
  )
}
