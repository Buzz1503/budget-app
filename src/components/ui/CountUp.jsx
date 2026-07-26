import { useEffect, useRef } from 'react'
import { animate, useMotionValue, useTransform, motion } from 'framer-motion'

// Number that springs to its new value.
export default function CountUp({ value, decimals = 0, className }) {
  const mv = useMotionValue(value)
  const rounded = useTransform(mv, (v) => v.toFixed(decimals))
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; mv.set(value); return }
    const controls = animate(mv, value, { duration: 0.6, ease: 'easeOut' })
    return controls.stop
  }, [value, mv])
  return <motion.span className={className}>{rounded}</motion.span>
}
