import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { reasonFx } from '../lib/mixMatrix'

// Verdict-driven vial animation that *teaches* the chemistry. Every effect is
// additive; nothing here gates the verdict text, and reduced-motion falls back
// to the settled result state.
const TONE = {
  MIX: 'var(--good)',
  CAUTION: 'var(--warn)',
  DONT_MIX: 'var(--danger)',
  NEVER: 'var(--danger)',
}

// deterministic pseudo-random so particles don't jump between renders
function rng(seed) {
  let s = seed
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
}

export default function ReactionChamber({ verdict, reasonCode, colorA, colorB, playKey }) {
  const tone = TONE[verdict] || 'var(--text-2)'
  const { fx } = reasonFx(reasonCode)
  const merged = verdict === 'MIX'
  const shakes = verdict === 'NEVER'

  // particle sets for precipitate/clump/haze flavors
  const particles = useMemo(() => {
    const cloudy = ['precipitate', 'clump', 'haze', 'cosolvent', 'denature', 'redox', 'copperReduce'].includes(fx)
    if (!cloudy) return []
    const r = rng(playKey?.length ? playKey.charCodeAt(0) * 97 + playKey.length * 13 : 7)
    const n = fx === 'haze' ? 26 : 16
    return Array.from({ length: n }, (_, i) => ({
      id: i,
      x: 24 + r() * 92,
      settleY: fx === 'clump' ? 118 : 60 + r() * 96,
      startY: 40 + r() * 40,
      size: fx === 'haze' ? 3 + r() * 4 : 4 + r() * 6,
      delay: r() * 0.5,
    }))
  }, [fx, playKey])

  // gel strands for R01 coacervate
  const strands = useMemo(() => {
    if (fx !== 'gel') return []
    const r = rng((playKey?.charCodeAt(1) || 3) * 41)
    return Array.from({ length: 5 }, (_, i) => ({ id: i, x: 34 + i * 22 + r() * 8, wobble: 4 + r() * 6 }))
  }, [fx, playKey])

  const resultColor =
    fx === 'copperOxidise' ? '#7c5a2e' :
    fx === 'redox' ? '#5b3b6e' :
    merged ? tone : '#8a94a6'

  return (
    <div className="relative mx-auto" style={{ width: 160, height: 200 }}>
      <motion.svg
        key={playKey}
        viewBox="0 0 160 200"
        width="160" height="200"
        animate={shakes ? { x: [0, -6, 6, -5, 5, -3, 3, 0] } : {}}
        transition={shakes ? { duration: 0.6, repeat: Infinity, repeatDelay: 0.8 } : {}}
      >
        <defs>
          <linearGradient id={`liqA-${playKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorA} stopOpacity="0.9" />
            <stop offset="100%" stopColor={colorA} stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id={`liqB-${playKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorB} stopOpacity="0.9" />
            <stop offset="100%" stopColor={colorB} stopOpacity="0.6" />
          </linearGradient>
          <clipPath id={`vialClip-${playKey}`}>
            <path d="M52 26 h56 v8 l-6 10 v112 a22 22 0 0 1 -22 22 h0 a22 22 0 0 1 -22 -22 v-112 l-6 -10 z" />
          </clipPath>
          <radialGradient id={`glow-${playKey}`} cx="50%" cy="60%" r="55%">
            <stop offset="0%" stopColor={tone} stopOpacity={merged ? 0.5 : 0.28} />
            <stop offset="100%" stopColor={tone} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* glow halo */}
        <motion.ellipse
          cx="80" cy="130" rx="70" ry="80" fill={`url(#glow-${playKey})`}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: [0, 1, 0.7], scale: [0.7, 1.05, 1] }}
          transition={{ duration: 1.4, times: [0, 0.6, 1] }}
        />

        {/* liquid, clipped to the vial body */}
        <g clipPath={`url(#vialClip-${playKey})`}>
          {merged ? (
            /* one clean blended body — fill only, width fixed (never animated) */
            <motion.rect
              x="52" width="56" y="70" height="108"
              initial={{ scaleY: 0, originY: 1, opacity: 0.4 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              fill={resultColor} style={{ transformOrigin: '80px 178px' }}
            />
          ) : (
            <>
              <motion.rect
                x="52" width="28" y="70" height="108"
                initial={{ scaleY: 0, opacity: 0.5 }}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
                fill={`url(#liqA-${playKey})`} style={{ transformOrigin: '66px 178px' }}
              />
              <motion.rect
                x="80" width="28" y="70" height="108"
                initial={{ scaleY: 0, opacity: 0.5 }}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
                fill={`url(#liqB-${playKey})`} style={{ transformOrigin: '94px 178px' }}
              />
            </>
          )}

          {/* cloudiness veil for hazy/denature/redox flavors */}
          {['haze', 'denature', 'redox', 'copperOxidise'].includes(fx) && (
            <motion.rect
              x="52" y="70" width="56" height="108"
              fill={resultColor}
              initial={{ opacity: 0 }} animate={{ opacity: 0.55 }}
              transition={{ duration: 1, delay: 0.9 }}
            />
          )}

          {/* dropping / clumping particulate */}
          {particles.map((p) => (
            <motion.circle
              key={p.id} cx={p.x} r={p.size}
              fill={fx === 'copperReduce' ? '#b87333' : resultColor}
              initial={{ cy: p.startY, opacity: 0 }}
              animate={{ cy: p.settleY, opacity: [0, 0.9, 0.85] }}
              transition={{ duration: 1.1, delay: 0.8 + p.delay, ease: 'easeIn' }}
            />
          ))}

          {/* stringy coacervate strands for R01 */}
          {strands.map((s) => (
            <motion.path
              key={s.id}
              d={`M${s.x} 74 q ${s.wobble} 26 -${s.wobble} 52 q ${s.wobble} 26 0 52`}
              stroke={resultColor} strokeWidth="5" fill="none" strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.85 }}
              transition={{ duration: 1, delay: 1 }}
            />
          ))}

          {/* rising bubbles on a clean blend */}
          {merged && [0, 1, 2, 3, 4].map((i) => (
            <motion.circle
              key={i} cx={60 + i * 10} r={2.5 + (i % 2)}
              fill="#ffffff" opacity="0.6"
              initial={{ cy: 170 }}
              animate={{ cy: [170, 80], opacity: [0, 0.7, 0] }}
              transition={{ duration: 1.6, delay: 1 + i * 0.15, repeat: Infinity, repeatDelay: 0.6 }}
            />
          ))}
        </g>

        {/* vial outline */}
        <path
          d="M52 26 h56 v8 l-6 10 v112 a22 22 0 0 1 -22 22 h0 a22 22 0 0 1 -22 -22 v-112 l-6 -10 z"
          fill="none" stroke="var(--border)" strokeWidth="2.5"
        />
        {/* neck highlight */}
        <rect x="50" y="20" width="60" height="7" rx="3" fill="var(--surface-sunk)" stroke="var(--border)" />

        {/* NEVER: locking X-slash */}
        {shakes && (
          <motion.g
            initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.5, type: 'spring', stiffness: 300, damping: 14 }}
          >
            <circle cx="80" cy="118" r="34" fill="var(--danger)" opacity="0.16" />
            <line x1="58" y1="96" x2="102" y2="140" stroke="var(--danger)" strokeWidth="7" strokeLinecap="round" />
            <line x1="102" y1="96" x2="58" y2="140" stroke="var(--danger)" strokeWidth="7" strokeLinecap="round" />
          </motion.g>
        )}
      </motion.svg>
    </div>
  )
}
