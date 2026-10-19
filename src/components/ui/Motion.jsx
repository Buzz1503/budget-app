import { useEffect, useRef } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'

/**
 * A number that counts up from zero when it first appears (about 600 ms) and
 * eases to new values after that. With Reduce Motion on it simply shows.
 */
export function CountIn({ value, decimals = 0, className, style }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(reduce ? value : 0)
  const text = useTransform(mv, (v) => Number(v).toFixed(decimals))
  const first = useRef(true)
  useEffect(() => {
    if (reduce) { mv.set(value); return undefined }
    const c = animate(mv, value, { duration: first.current ? 0.6 : 0.4, ease: 'easeOut' })
    first.current = false
    return c.stop
  }, [value, mv, reduce])
  return <motion.span className={className} style={style}>{text}</motion.span>
}

/** Children enter one after another, 40 ms apart; all at once with Reduce Motion. */
export function Stagger({ children, className, as = 'div', ...rest }) {
  const reduce = useReducedMotion()
  const Tag = motion[as]
  return (
    <Tag className={className} initial={reduce ? false : 'hidden'} animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }} {...rest}>
      {children}
    </Tag>
  )
}

export function StaggerItem({ children, className, as = 'div', ...rest }) {
  const Tag = motion[as]
  return (
    <Tag className={className} variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: 0.24 } } }} {...rest}>
      {children}
    </Tag>
  )
}

/** A ring that fills to `value` of `max` over about 600 ms. */
export function FillRing({ value, max = 100, size = 64, stroke = 6, color = 'var(--text)', track = 'var(--surface-sunk)', children }) {
  const reduce = useReducedMotion()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, (value || 0) / max))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        initial={reduce ? false : { strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }}
        transition={{ duration: reduce ? 0 : 0.6, ease: 'easeOut' }} />
      {children}
    </svg>
  )
}
