import { motion } from 'framer-motion'

// Parametric silhouette: torso/limb girth scales with body-fat % (and waist as a
// fallback). Honest scope — a metric-driven stylized model, NOT a photoreal morph.
// bf: body-fat %, muscle: 0..1 muscle emphasis.
export default function BodyModel({ bf = 25, muscle = 0.5, color = 'var(--violet)', size = 200 }) {
  // Map bf (10–40%) to a girth factor. Higher bf → wider waist/limbs.
  const f = clamp((bf - 12) / 26, 0, 1) // 0 lean .. 1 heavy
  const waistW = lerp(11, 22, f)
  const chestW = lerp(15, 22, f) + muscle * 3
  const thighW = lerp(6, 11, f)
  const armW = lerp(3.5, 6.5, f) + muscle * 1.2
  const shoulder = 18 + muscle * 4

  // torso outline (front view), centred at x=50
  const cx = 50
  const torso = `
    M ${cx - shoulder} 30
    Q ${cx - chestW} 40 ${cx - waistW} 60
    Q ${cx - waistW - 1} 70 ${cx - thighW * 1.4} 74
    L ${cx + thighW * 1.4} 74
    Q ${cx + waistW + 1} 70 ${cx + waistW} 60
    Q ${cx + chestW} 40 ${cx + shoulder} 30
    Q ${cx} 22 ${cx - shoulder} 30 Z`

  const legL = `M ${cx - thighW * 1.4} 74 Q ${cx - thighW} 92 ${cx - thighW * 0.7} 112 L ${cx - 1} 112 Q ${cx - 2} 92 ${cx - 1} 74 Z`
  const legR = `M ${cx + thighW * 1.4} 74 Q ${cx + thighW} 92 ${cx + thighW * 0.7} 112 L ${cx + 1} 112 Q ${cx + 2} 92 ${cx + 1} 74 Z`
  const armL = `M ${cx - shoulder + 1} 32 Q ${cx - shoulder - armW} 48 ${cx - shoulder - armW + 1} 66 L ${cx - shoulder + armW - 1} 64 Q ${cx - shoulder + armW - 2} 46 ${cx - shoulder + 2} 34 Z`
  const armR = `M ${cx + shoulder - 1} 32 Q ${cx + shoulder + armW} 48 ${cx + shoulder + armW - 1} 66 L ${cx + shoulder - armW + 1} 64 Q ${cx + shoulder - armW + 2} 46 ${cx + shoulder - 2} 34 Z`

  const t = { type: 'spring', stiffness: 80, damping: 18 }

  return (
    <svg viewBox="0 0 100 118" width={size} height={size * 1.18} className="mx-auto">
      <defs>
        <linearGradient id="bm-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.9" />
          <stop offset="100%" stopColor={color} stopOpacity="0.5" />
        </linearGradient>
      </defs>
      {/* head */}
      <circle cx={cx} cy="14" r="8" fill="url(#bm-grad)" />
      {/* neck */}
      <rect x={cx - 3} y="20" width="6" height="6" fill="url(#bm-grad)" />
      {[armL, armR, legL, legR].map((d, i) => (
        <motion.path key={i} d={d} fill="url(#bm-grad)" initial={false} animate={{ d }} transition={t} />
      ))}
      <motion.path d={torso} fill="url(#bm-grad)" initial={false} animate={{ d: torso }} transition={t} />
    </svg>
  )
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
function lerp(a, b, t) { return a + (b - a) * t }
